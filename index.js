'use strict';

/**
 * tap-report — Parse TAP (Test Anything Protocol) output into clean summaries.
 *
 * Supports TAP 13 and TAP 14:
 *   - ok / not ok lines with test numbers
 *   - directives: # SKIP and # TODO
 *   - YAML diagnostic blocks (indented --- ... )
 *   - pragma lines (+tap / -tap)
 *   - subtest plans
 *   - bailout messages
 *   - comments (# ...)
 *
 * Zero dependencies. Works on Node 14+.
 */

// ─── Token types ──────────────────────────────────────────────
const TOK = {
  PLAN: 'plan',
  TEST: 'test',
  PRAGMA: 'pragma',
  VERSION: 'version',
  BAILOUT: 'bailout',
  COMMENT: 'comment',
  YAML_START: 'yaml_start',
  YAML_END: 'yaml_end',
  UNKNOWN: 'unknown',
};

// ─── Tokenizer ────────────────────────────────────────────────

/**
 * Tokenize a single raw line of TAP output.
 * @param {string} line
 * @returns {{type: string, raw: string, value?: string, ok?: boolean, num?: number, directive?: string, reason?: string, diagnostic?: string}}
 */
function tokenizeLine(line) {
  const raw = line;
  const trimmed = line.trim();
  const indented = /^	|^	? +/.test(line) && line.trim() !== '';

  // Empty line
  if (trimmed === '') return { type: TOK.UNKNOWN, raw };

  // TAP version (must be first meaningful line)
  const versionMatch = trimmed.match(/^TAP version (\d+)$/);
  if (versionMatch) return { type: TOK.VERSION, raw, value: versionMatch[1] };

  // Pragma
  const pragmaMatch = trimmed.match(/^pragma ([+-])(\S+)$/);
  if (pragmaMatch) return { type: TOK.PRAGMA, raw, sign: pragmaMatch[1], name: pragmaMatch[2] };

  // Plan: 1..N (optionally with # skip/todo reason)
  const planMatch = trimmed.match(/^(\d+)\.\.(\d+)(?:\s*#\s*(?:(SKIP|skip|TODO|todo)\s*.*)?)?$/);
  if (planMatch) {
    const start = parseInt(planMatch[1], 10);
    const end = parseInt(planMatch[2], 10);
    const directive = planMatch[3] ? planMatch[3].toUpperCase() : null;
    return { type: TOK.PLAN, raw, start, end, directive };
  }

  // Bail out!
  const bailMatch = trimmed.match(/^Bail out!(?:\s+(.*))?$/);
  if (bailMatch) return { type: TOK.BAILOUT, raw, reason: bailMatch[1] || '' };

  // YAML block start (only when indented or exactly ---)
  if (/^---\s*$/.test(trimmed)) return { type: TOK.YAML_START, raw };

  // YAML block end
  if (/^\.\.\.\s*$/.test(trimmed)) return { type: TOK.YAML_END, raw };

  // Comment line (starts with #)
  if (/^#/.test(trimmed)) return { type: TOK.COMMENT, raw, text: trimmed.replace(/^#\s?/, '') };

  // Test line: ok|not ok [num] [- description] [# directive: reason]
  // Only match non-indented lines as top-level tests
  const testMatch = !indented && trimmed.match(/^(ok|not ok)\s+(?:(\d+)\s+)?(.*)$/);
  if (testMatch) {
    const ok = testMatch[1] === 'ok';
    const num = testMatch[2] ? parseInt(testMatch[2], 10) : undefined;
    const rest = testMatch[3] || '';

    // Strip and capture directive
    let directive = null;
    let reason = null;
    let text = rest;

    // description may have leading dash separator
    text = text.replace(/^-\s*/, '');

    // Check for # SKIP or # TODO at end
    const dirMatch = text.match(/#\s*(SKIP|skip|TODO|todo)(?:\s+(.*))?$/);
    if (dirMatch) {
      directive = dirMatch[1].toUpperCase();
      reason = dirMatch[2] || '';
      text = text.replace(/#\s*(SKIP|skip|TODO|todo).*$/, '').trim();
    } else {
      // Check for general comment in test line
      const commentMatch = text.match(/#\s+(.*)$/);
      if (commentMatch) {
        text = text.replace(/#\s+.*$/, '').trim();
      }
    }

    return { type: TOK.TEST, raw, ok, num, text: text.trim(), directive, reason };
  }

  // Indented content (subtest lines, YAML content outside blocks, etc.)
  return { type: TOK.UNKNOWN, raw };
}

// ─── Parser ───────────────────────────────────────────────────

/**
 * Parse a TAP string into a structured result.
 * @param {string} tapText
 * @returns {{version?: number, plan?: {start: number, end: number, directive?: string, skipAll?: boolean}, tests: Array, bailouts: Array, comments: Array, pragmas: Array, passed: number, failed: number, skipped: number, todo: number, total: number}}
 */
function parse(tapText) {
  const lines = tapText.split('\n');
  const result = {
    version: undefined,
    plan: undefined,
    tests: [],
    bailouts: [],
    comments: [],
    pragmas: [],
  };

  let inYaml = false;
  let yamlBuffer = [];
  let currentTest = null;

  for (const line of lines) {
    const tok = tokenizeLine(line);

    // If we're inside a YAML block, collect until ...
    if (inYaml) {
      if (tok.type === TOK.YAML_END) {
        inYaml = false;
        if (currentTest) {
          currentTest.diagnostic = yamlBuffer.join('\n').trim();
        }
        yamlBuffer = [];
        continue;
      }
      // Collect YAML content
      if (tok.raw.trim() !== '') {
        yamlBuffer.push(tok.raw.trim());
      }
      continue;
    }

    switch (tok.type) {
      case TOK.VERSION:
        result.version = parseInt(tok.value, 10);
        break;

      case TOK.PRAGMA:
        result.pragmas.push({ sign: tok.sign, name: tok.name });
        break;


      case TOK.PLAN:
        result.plan = {
          start: tok.start,
          end: tok.end,
          directive: tok.directive || null,
          skipAll: tok.directive === 'SKIP',
        };
        break;
        break;

      case TOK.BAILOUT:
        result.bailouts.push({ reason: tok.reason });
        break;

      case TOK.TEST:
        currentTest = {
          ok: tok.ok,
          num: tok.num,
          description: tok.text || '',
          directive: tok.directive,
          reason: tok.reason || '',
          diagnostic: null,
          raw: tok.raw,
        };
        result.tests.push(currentTest);
        break;

      case TOK.YAML_START:
        inYaml = true;
        yamlBuffer = [];
        break;

      case TOK.COMMENT:
        result.comments.push(tok.text);
        break;

      default:
        // Unknown / empty line — ignore
        break;
    }
  }

  // Compute summary
  result.passed = result.tests.filter((t) => t.ok && !t.directive).length;
  result.failed = result.tests.filter((t) => !t.ok && !t.directive).length;
  result.skipped = result.tests.filter((t) => t.directive === 'SKIP').length;
  result.todo = result.tests.filter((t) => t.directive === 'TODO').length;
  result.total = result.tests.length;

  // If plan says skip all and there are no tests
  if (result.plan && result.plan.skipAll && result.total === 0) {
    result.passed = 0;
    result.failed = 0;
  }

  // Check plan validity
  result.planValid = true;
  if (result.plan && !result.plan.skipAll) {
    const expected = result.plan.end - result.plan.start + 1;
    if (result.total !== expected) {
      result.planValid = false;
      result.planError = `Planned ${expected} tests (${result.plan.start}..${result.plan.end}), ran ${result.total}`;
    }
  }

  // Overall pass/fail
  result.ok = result.bailouts.length === 0 && result.failed === 0 && result.planValid;

  return result;
}

// ─── Summarize ────────────────────────────────────────────────

/**
 * Generate a human-readable summary string from a parsed result.
 * @param {object} result
 * @param {object} [opts]
 * @param {boolean} [opts.showFails=true] — Include detail of failures
 * @param {boolean} [opts.showTodo=true] — Include TODO items
 * @param {boolean} [opts.color=true] — Use ANSI colors
 * @returns {string}
 */
function summarize(result, opts = {}) {
  const { showFails = true, showTodo = true, color = true } = opts;

  const c = {
    green: color ? '\x1b[32m' : '',
    red: color ? '\x1b[31m' : '',
    yellow: color ? '\x1b[33m' : '',
    cyan: color ? '\x1b[36m' : '',
    gray: color ? '\x1b[90m' : '',
    reset: color ? '\x1b[0m' : '',
    bold: color ? '\x1b[1m' : '',
  };

  const lines = [];

  // Header
  const statusIcon = result.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const statusText = result.ok ? 'PASS' : 'FAIL';
  lines.push(`${statusIcon} ${c.bold}${statusText}${c.reset}  ${result.total} tests`);

  // Breakdown
  const parts = [];
  if (result.passed > 0) parts.push(`${c.green}${result.passed} passed${c.reset}`);
  if (result.failed > 0) parts.push(`${c.red}${result.failed} failed${c.reset}`);
  if (result.skipped > 0) parts.push(`${c.yellow}${result.skipped} skipped${c.reset}`);
  if (result.todo > 0) parts.push(`${c.cyan}${result.todo} todo${c.reset}`);
  if (parts.length > 0) lines.push(`  ${parts.join(c.gray + ' · ' + c.reset)}`);

  // Plan issues
  if (!result.planValid) {
    lines.push(`  ${c.red}⚠ ${result.planError}${c.reset}`);
  }

  // Bailouts
  if (result.bailouts.length > 0) {
    for (const b of result.bailouts) {
      lines.push(`  ${c.red}🛑 Bail out! ${b.reason}${c.reset}`);
    }
  }

  // Failures detail
  if (showFails) {
    const fails = result.tests.filter((t) => !t.ok && !t.directive);
    if (fails.length > 0) {
      lines.push('');
      lines.push(`${c.bold}Failures:${c.reset}`);
      for (const f of fails) {
        const num = f.num !== undefined ? ` ${f.num}` : '';
        lines.push(`  ${c.red}✗${c.reset}${num} ${f.description}`);
        if (f.diagnostic) {
          const diagLines = f.diagnostic.split('\n');
          for (const dl of diagLines) {
            lines.push(`    ${c.gray}${dl}${c.reset}`);
          }
        }
      }
    }
  }

  // TODO items
  if (showTodo) {
    const todos = result.tests.filter((t) => t.directive === 'TODO');
    if (todos.length > 0) {
      lines.push('');
      lines.push(`${c.bold}TODO:${c.reset}`);
      for (const t of todos) {
        const icon = t.ok ? `${c.cyan}○${c.reset}` : `${c.yellow}●${c.reset}`;
        const num = t.num !== undefined ? ` ${t.num}` : '';
        let line = `  ${icon}${num} ${t.description}`;
        if (t.reason) line += ` ${c.gray}— ${t.reason}${c.reset}`;
        lines.push(line);
      }
    }
  }

  // Skipped (brief)
  const skipped = result.tests.filter((t) => t.directive === 'SKIP');
  if (skipped.length > 0 && skipped.length <= 10) {
    lines.push('');
    for (const s of skipped) {
      const num = s.num !== undefined ? ` ${s.num}` : '';
      let line = `  ${c.yellow}−${c.reset}${num} ${s.description}`;
      if (s.reason) line += ` ${c.gray}— ${s.reason}${c.reset}`;
      lines.push(line);
    }
  } else if (skipped.length > 10) {
    lines.push(`  ${c.gray}(${skipped.length} tests skipped)${c.reset}`);
  }

  return lines.join('\n');
}

// ─── Format as JSON ───────────────────────────────────────────

/**
 * Produce a JSON-compatible plain object (no ANSI, no functions).
 * @param {object} result
 * @returns {object}
 */
function toJSON(result) {
  return {
    ok: result.ok,
    version: result.version || null,
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    todo: result.todo,
    planValid: result.planValid,
    planError: result.planError || null,
    bailouts: result.bailouts,
    tests: result.tests.map((t) => ({
      ok: t.ok,
      num: t.num ?? null,
      description: t.description,
      directive: t.directive,
      reason: t.reason,
      diagnostic: t.diagnostic,
    })),
  };
}

// ─── Check CI threshold ──────────────────────────────────────

/**
 * Evaluate CI thresholds. Returns { pass: boolean, reason: string }.
 * @param {object} result — Parsed TAP result
 * @param {object} [opts]
 * @param {number} [opts.maxFail=0] — Max failures allowed
 * @param {number} [opts.maxSkip=Infinity] — Max skips allowed
 * @param {boolean} [opts.requirePlan=false] — Require a plan
 * @param {number} [opts.minTests=0] — Minimum test count
 */
function checkThreshold(result, opts = {}) {
  const {
    maxFail = 0,
    maxSkip = Infinity,
    requirePlan = false,
    minTests = 0,
  } = opts;

  if (result.bailouts.length > 0) {
    return { pass: false, reason: `Bailed out: ${result.bailouts[0].reason || '(no reason)'}` };
  }
  if (result.failed > maxFail) {
    return { pass: false, reason: `${result.failed} failures (max ${maxFail})` };
  }
  if (result.skipped > maxSkip) {
    return { pass: false, reason: `${result.skipped} skipped (max ${maxSkip})` };
  }
  if (requirePlan && !result.plan) {
    return { pass: false, reason: 'No plan declared' };
  }
  if (result.total < minTests) {
    return { pass: false, reason: `${result.total} tests (min ${minTests})` };
  }
  return { pass: true, reason: 'OK' };
}

module.exports = {
  parse,
  summarize,
  toJSON,
  checkThreshold,
  tokenizeLine,
  TOK,
};
