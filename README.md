# tap-report

Parse [TAP (Test Anything Protocol)](https://testanything.org/) output into clean, readable summaries. Built for CI pipelines and local dev.

## Why

TAP is everywhere — Node's built-in test runner, Perl, PHP, Ruby, and dozens of other tools spit it out. But raw TAP is verbose and hard to scan. `tap-report` turns this:

```
TAP version 13
1..4
ok 1 - should add numbers
not ok 2 - should handle edge case
  ---
  operator: equal
  expected: 5
  actual: 3
  ...
ok 3 - old feature # SKIP deprecated
not ok 4 - new feature # TODO not implemented yet
```

Into this:

```
✓ FAIL  4 tests
  1 passed · 1 failed · 1 skipped · 1 todo

Failures:
  ✗ 2 should handle edge case
    operator: equal
    expected: 5
    actual: 3

TODO:
  ● 4 new feature — not implemented yet

  − 3 old feature — deprecated
```

## Install

```bash
npm install -g tap-report
```

Or use directly with `npx`:

```bash
node --test | npx tap-report
```

## Usage

### Pipe from any TAP-producing tool

```bash
# Node.js built-in test runner
node --test | tap-report

# tape
node test.js | tap-report

# From a file
tap-report results.tap

# JSON output for tooling
node --test | tap-report --json

# CI mode (exit 1 on failures)
node --test | tap-report --ci
```

### Options

```
--json             Output as JSON
--no-color         Disable ANSI colors
--no-fails         Hide failure details
--no-todo          Hide TODO items
--ci               CI mode: exit 1 on any failure
--max-fail <n>     Max failures allowed (default: 0)
--max-skip <n>     Max skips allowed
--require-plan     Require a test plan
--min-tests <n>    Minimum test count
--compact          One-line summary only
-h, --help         Show help
-v, --version      Show version
```

## API

```js
const { parse, summarize, toJSON, checkThreshold } = require('tap-report');

const result = parse(tapString);
// { ok, total, passed, failed, skipped, todo, tests, plan, bailouts, ... }

console.log(summarize(result));
// Human-readable summary

const json = toJSON(result);
// Clean JSON-safe object

const check = checkThreshold(result, { maxFail: 0, minTests: 10 });
// { pass: true/false, reason: '...' }
```

## What It Parses

- ✅ TAP 13 and TAP 14 version headers
- ✅ Test lines (`ok` / `not ok`) with optional numbers and descriptions
- ✅ Plans (`1..N`) including `1..0 # SKIP` for skip-all
- ✅ Directives: `# SKIP`, `# TODO` (case-insensitive)
- ✅ YAML diagnostic blocks (`---` ... `...`)
- ✅ Bail out! messages
- ✅ Pragma lines
- ✅ Comments (`# ...`)
- ✅ Plan validation (expected vs actual test count)
- ✅ CRLF line endings

## CI Integration

```yaml
# GitHub Actions
- run: node --test | tap-report --ci --min-tests 5

# With thresholds
- run: node --test | tap-report --ci --max-fail 0 --max-skip 2 --require-plan
```

Exit codes:
- `0` — All tests pass (or within thresholds in CI mode)
- `1` — Tests fail or thresholds exceeded
- `2` — Usage error / file not found

## License

MIT
