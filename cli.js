#!/usr/bin/env node
'use strict';

const { parse, summarize, toJSON, checkThreshold } = require('./index.js');
const { readFileSync } = require('fs');

function usage() {
  return [
    'tap-report — Parse TAP output into clean summaries',
    '',
    'Usage:',
    '  tap-report [options] [file]',
    '  cat test.tap | tap-report [options]',
    '',
    'Options:',
    '  --json             Output as JSON',
    '  --no-color         Disable ANSI colors',
    '  --no-fails         Hide failure details',
    '  --no-todo          Hide TODO items',
    '  --ci               CI mode: exit 1 on any failure',
    '  --max-fail <n>     Max failures allowed (default: 0)',
    '  --max-skip <n>     Max skips allowed',
    '  --require-plan     Require a test plan',
    '  --min-tests <n>    Minimum test count',
    '  --compact          One-line summary only',
    '  -h, --help         Show this help',
    '  -v, --version      Show version',
  ].join('\n');
}

function main() {
  const argv = process.argv.slice(2);

  // Parse flags
  const opts = {
    json: false,
    color: true,
    showFails: true,
    showTodo: true,
    ci: false,
    compact: false,
    maxFail: 0,
    maxSkip: Infinity,
    requirePlan: false,
    minTests: 0,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--json': opts.json = true; break;
      case '--no-color': opts.color = false; break;
      case '--no-fails': opts.showFails = false; break;
      case '--no-todo': opts.showTodo = false; break;
      case '--ci': opts.ci = true; break;
      case '--compact': opts.compact = true; break;
      case '--require-plan': opts.requirePlan = true; break;
      case '--max-fail': opts.maxFail = parseInt(argv[++i], 10); break;
      case '--max-skip': opts.maxSkip = parseInt(argv[++i], 10); break;
      case '--min-tests': opts.minTests = parseInt(argv[++i], 10); break;
      case '-h':
      case '--help': console.log(usage()); process.exit(0);
      case '-v':
      case '--version': console.log(require('./package.json').version); process.exit(0);
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          console.error(usage());
          process.exit(2);
        }
        positional.push(arg);
    }
  }

  // Get input
  let input;
  if (positional.length > 0) {
    try {
      input = readFileSync(positional[0], 'utf8');
    } catch (err) {
      console.error(`Cannot read file: ${positional[0]}`);
      process.exit(2);
    }
  } else {
    // Read stdin
    input = readFileSync(0, 'utf8').toString();
  }

  if (!input.trim()) {
    console.error('No input provided.');
    process.exit(2);
  }

  const result = parse(input);

  // Output
  if (opts.json) {
    console.log(JSON.stringify(toJSON(result), null, 2));
  } else if (opts.compact) {
    const icon = result.ok ? '✓' : '✗';
    console.log(`${icon} ${result.total} tests: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped, ${result.todo} todo`);
  } else {
    console.log(summarize(result, {
      showFails: opts.showFails,
      showTodo: opts.showTodo,
      color: opts.color,
    }));
  }

  // CI threshold check
  if (opts.ci) {
    const check = checkThreshold(result, {
      maxFail: opts.maxFail,
      maxSkip: opts.maxSkip,
      requirePlan: opts.requirePlan,
      minTests: opts.minTests,
    });
    if (!check.pass) {
      if (!opts.json && !opts.compact) {
        console.error(`\nCI FAIL: ${check.reason}`);
      }
      process.exit(1);
    }
  }

  // Non-CI mode: still exit 1 if tests failed
  if (!opts.ci && !result.ok) {
    process.exit(1);
  }
}

main();
