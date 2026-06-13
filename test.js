'use strict';

const { parse, summarize, toJSON, checkThreshold, tokenizeLine, TOK } = require('./index.js');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg);
}

function ok(cond, msg) {
  assert.ok(cond, msg);
}

// ─── Tokenizer Tests ──────────────────────────────────────────

test('tokenize: TAP version line', () => {
  const t = tokenizeLine('TAP version 13');
  eq(t.type, TOK.VERSION);
  eq(t.value, '13');
});

test('tokenize: TAP version 14', () => {
  const t = tokenizeLine('TAP version 14');
  eq(t.type, TOK.VERSION);
  eq(t.value, '14');
});

test('tokenize: pragma positive', () => {
  const t = tokenizeLine('pragma +strict');
  eq(t.type, TOK.PRAGMA);
  eq(t.sign, '+');
  eq(t.name, 'strict');
});

test('tokenize: pragma negative', () => {
  const t = tokenizeLine('pragma -strict');
  eq(t.type, TOK.PRAGMA);
  eq(t.sign, '-');
  eq(t.name, 'strict');
});

test('tokenize: plan simple', () => {
  const t = tokenizeLine('1..5');
  eq(t.type, TOK.PLAN);
  eq(t.start, 1);
  eq(t.end, 5);
  ok(!t.directive);
});

test('tokenize: plan with skip', () => {
  const t = tokenizeLine('1..0 # SKIP why not');
  eq(t.type, TOK.PLAN);
  eq(t.start, 1);
  eq(t.end, 0);
});

test('tokenize: plan with SKIP directive', () => {
  const t = tokenizeLine('1..3 # SKIP');
  eq(t.type, TOK.PLAN);
  eq(t.directive, 'SKIP');
});

test('tokenize: bailout with reason', () => {
  const t = tokenizeLine('Bail out! something went wrong');
  eq(t.type, TOK.BAILOUT);
  eq(t.reason, 'something went wrong');
});

test('tokenize: bailout without reason', () => {
  const t = tokenizeLine('Bail out!');
  eq(t.type, TOK.BAILOUT);
  eq(t.reason, '');
});

test('tokenize: yaml start', () => {
  const t = tokenizeLine('---');
  eq(t.type, TOK.YAML_START);
});

test('tokenize: yaml end', () => {
  const t = tokenizeLine('...');
  eq(t.type, TOK.YAML_END);
});

test('tokenize: comment', () => {
  const t = tokenizeLine('# this is a comment');
  eq(t.type, TOK.COMMENT);
  eq(t.text, 'this is a comment');
});

test('tokenize: ok test with number and description', () => {
  const t = tokenizeLine('ok 1 - test description');
  eq(t.type, TOK.TEST);
  eq(t.ok, true);
  eq(t.num, 1);
  eq(t.text, 'test description');
});

test('tokenize: not ok test with number and description', () => {
  const t = tokenizeLine('not ok 2 - failing test');
  eq(t.type, TOK.TEST);
  eq(t.ok, false);
  eq(t.num, 2);
  eq(t.text, 'failing test');
});

test('tokenize: ok test without number', () => {
  const t = tokenizeLine('ok some test');
  eq(t.type, TOK.TEST);
  eq(t.ok, true);
  ok(t.num === undefined);
  eq(t.text, 'some test');
});

test('tokenize: test with SKIP directive', () => {
  const t = tokenizeLine('ok 3 - skipped test # SKIP not ready');
  eq(t.type, TOK.TEST);
  eq(t.ok, true);
  eq(t.directive, 'SKIP');
  eq(t.reason, 'not ready');
});

test('tokenize: test with TODO directive', () => {
  const t = tokenizeLine('not ok 4 - todo test # TODO need to implement');
  eq(t.type, TOK.TEST);
  eq(t.ok, false);
  eq(t.directive, 'TODO');
  eq(t.reason, 'need to implement');
});

test('tokenize: test with dash separator but no description', () => {
  const t = tokenizeLine('ok 1 -');
  eq(t.type, TOK.TEST);
  eq(t.ok, true);
  eq(t.num, 1);
});

test('tokenize: empty line', () => {
  const t = tokenizeLine('');
  eq(t.type, TOK.UNKNOWN);
});

test('tokenize: whitespace only', () => {
  const t = tokenizeLine('   ');
  eq(t.type, TOK.UNKNOWN);
});

// ─── Parser Tests ─────────────────────────────────────────────

test('parse: basic all passing', () => {
  const tap = [
    'TAP version 13',
    '1..3',
    'ok 1 - first test',
    'ok 2 - second test',
    'ok 3 - third test',
  ].join('\n');
  const r = parse(tap);
  eq(r.version, 13);
  eq(r.total, 3);
  eq(r.passed, 3);
  eq(r.failed, 0);
  eq(r.skipped, 0);
  eq(r.todo, 0);
  ok(r.ok);
  ok(r.planValid);
});

test('parse: mixed results', () => {
  const tap = [
    '1..4',
    'ok 1 - passes',
    'not ok 2 - fails',
    'ok 3 - skip # SKIP',
    'not ok 4 - todo # TODO',
  ].join('\n');
  const r = parse(tap);
  eq(r.total, 4);
  eq(r.passed, 1);
  eq(r.failed, 1);
  eq(r.skipped, 1);
  eq(r.todo, 1);
  ok(!r.ok);
});

test('parse: skip all via plan', () => {
  const tap = '1..0 # SKIP all tests skipped';
  const r = parse(tap);
  eq(r.total, 0);
  eq(r.passed, 0);
  eq(r.failed, 0);
  eq(r.skipped, 0);
  ok(r.plan.skipAll);
});

test('parse: skip all is ok', () => {
  const tap = '1..0 # SKIP';
  const r = parse(tap);
  ok(r.ok);
});

test('parse: plan mismatch', () => {
  const tap = [
    '1..5',
    'ok 1 - a',
    'ok 2 - b',
  ].join('\n');
  const r = parse(tap);
  ok(!r.planValid);
  ok(r.planError.includes('Planned 5'));
  ok(!r.ok);
});

test('parse: bailout stops everything', () => {
  const tap = [
    '1..3',
    'ok 1 - a',
    'Bail out! database connection failed',
    'ok 2 - b',
  ].join('\n');
  const r = parse(tap);
  eq(r.bailouts.length, 1);
  eq(r.bailouts[0].reason, 'database connection failed');
  ok(!r.ok);
});

test('parse: YAML diagnostics captured', () => {
  const tap = [
    '1..1',
    'not ok 1 - something failed',
    '  ---',
    '  operator: equal',
    '  expected: 5',
    '  actual: 3',
    '  ...',
  ].join('\n');
  const r = parse(tap);
  eq(r.tests[0].diagnostic, 'operator: equal\nexpected: 5\nactual: 3');
});

test('parse: comments collected', () => {
  const tap = [
    '1..1',
    '# suite setup',
    'ok 1 - a',
    '# suite teardown',
  ].join('\n');
  const r = parse(tap);
  eq(r.comments.length, 2);
  eq(r.comments[0], 'suite setup');
  eq(r.comments[1], 'suite teardown');
});

test('parse: pragmas collected', () => {
  const tap = [
    'pragma +strict',
    'pragma -loose',
    '1..1',
    'ok 1 - a',
  ].join('\n');
  const r = parse(tap);
  eq(r.pragmas.length, 2);
  eq(r.pragmas[0].sign, '+');
  eq(r.pragmas[0].name, 'strict');
  eq(r.pragmas[1].sign, '-');
  eq(r.pragmas[1].name, 'loose');
});

test('parse: test numbers optional', () => {
  const tap = [
    '1..2',
    'ok first',
    'not ok second',
  ].join('\n');
  const r = parse(tap);
  eq(r.tests[0].num, undefined);
  eq(r.tests[0].description, 'first');
  eq(r.tests[1].num, undefined);
  eq(r.tests[1].description, 'second');
});

test('parse: no plan is fine', () => {
  const tap = [
    'ok 1 - a',
    'ok 2 - b',
  ].join('\n');
  const r = parse(tap);
  eq(r.passed, 2);
  ok(r.ok);
});

test('parse: SKIP with reason', () => {
  const tap = [
    '1..1',
    'ok 1 - test # SKIP browser not available',
  ].join('\n');
  const r = parse(tap);
  eq(r.skipped, 1);
  eq(r.tests[0].reason, 'browser not available');
});

test('parse: TODO passing (unexpected pass)', () => {
  const tap = [
    '1..1',
    'ok 1 - feature # TODO not done yet',
  ].join('\n');
  const r = parse(tap);
  eq(r.todo, 1);
  eq(r.passed, 0); // TODO doesn't count as passed
});

test('parse: empty string', () => {
  const r = parse('');
  eq(r.total, 0);
  eq(r.passed, 0);
});

test('parse: multiple YAML blocks', () => {
  const tap = [
    '1..2',
    'not ok 1 - first',
    '  ---',
    '  message: error 1',
    '  ...',
    'not ok 2 - second',
    '  ---',
    '  message: error 2',
    '  ...',
  ].join('\n');
  const r = parse(tap);
  eq(r.tests[0].diagnostic, 'message: error 1');
  eq(r.tests[1].diagnostic, 'message: error 2');
});

test('parse: YAML block with nested content', () => {
  const tap = [
    '1..1',
    'not ok 1 - complex failure',
    '  ---',
    '  operator: deepEqual',
    '  expected:',
    '    a: 1',
    '    b: 2',
    '  actual:',
    '    a: 1',
    '    b: 3',
    '  ...',
  ].join('\n');
  const r = parse(tap);
  ok(r.tests[0].diagnostic.includes('expected:'));
  ok(r.tests[0].diagnostic.includes('a: 1'));
  ok(r.tests[0].diagnostic.includes('b: 3'));
});

test('parse: test with comment after description', () => {
  const tap = [
    '1..1',
    'ok 1 - my test # some note',
  ].join('\n');
  const r = parse(tap);
  eq(r.tests[0].description, 'my test');
  eq(r.tests[0].directive, null);
});

test('parse: directive case insensitive', () => {
  const tap = [
    '1..2',
    'ok 1 - a # skip low prio',
    'not ok 2 - b # todo later',
  ].join('\n');
  const r = parse(tap);
  eq(r.skipped, 1);
  eq(r.todo, 1);
});

// ─── Summarize Tests ──────────────────────────────────────────

test('summarize: all passing', () => {
  const tap = '1..2\nok 1 - a\nok 2 - b';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('PASS'));
  ok(s.includes('2 tests'));
  ok(s.includes('2 passed'));
});

test('summarize: with failures', () => {
  const tap = '1..2\nok 1 - a\nnot ok 2 - b failed';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('FAIL'));
  ok(s.includes('1 failed'));
  ok(s.includes('Failures:'));
  ok(s.includes('b failed'));
});

test('summarize: hide failures', () => {
  const tap = '1..2\nok 1 - a\nnot ok 2 - b failed';
  const r = parse(tap);
  const s = summarize(r, { color: false, showFails: false });
  ok(!s.includes('Failures:'));
});

test('summarize: with TODO', () => {
  const tap = '1..1\nnot ok 1 - feat # TODO implement';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('TODO:'));
  ok(s.includes('feat'));
});

test('summarize: hide TODO', () => {
  const tap = '1..1\nnot ok 1 - feat # TODO implement';
  const r = parse(tap);
  const s = summarize(r, { color: false, showTodo: false });
  ok(!s.includes('TODO:'));
});

test('summarize: skipped tests shown', () => {
  const tap = '1..1\nok 1 - a # SKIP reason';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('1 skipped'));
  ok(s.includes('reason'));
});

test('summarize: many skips collapsed', () => {
  let tap = '1..15';
  for (let i = 1; i <= 15; i++) tap += `\nok ${i} - test${i} # SKIP`;
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('15 tests skipped'));
});

test('summarize: plan mismatch shown', () => {
  const tap = '1..5\nok 1 - a';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('Planned 5'));
});

test('summarize: bailout shown', () => {
  const tap = '1..1\nBail out! catastrophic';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(s.includes('Bail out!'));
  ok(s.includes('catastrophic'));
});

test('summarize: color output includes ANSI codes', () => {
  const tap = '1..1\nok 1 - a';
  const r = parse(tap);
  const s = summarize(r, { color: true });
  ok(s.includes('\x1b[32m')); // green
});

test('summarize: no color output has no ANSI codes', () => {
  const tap = '1..1\nok 1 - a';
  const r = parse(tap);
  const s = summarize(r, { color: false });
  ok(!s.includes('\x1b['));
});

// ─── toJSON Tests ─────────────────────────────────────────────

test('toJSON: produces clean object', () => {
  const tap = '1..2\nok 1 - a\nnot ok 2 - b';
  const r = parse(tap);
  const j = toJSON(r);
  eq(j.ok, false);
  eq(j.total, 2);
  eq(j.passed, 1);
  eq(j.failed, 1);
  eq(j.tests[0].ok, true);
  eq(j.tests[1].ok, false);
  ok(j.version === null); // no version declared
});

test('toJSON: is JSON serializable', () => {
  const tap = 'TAP version 13\n1..1\nok 1 - a';
  const r = parse(tap);
  const j = toJSON(r);
  const str = JSON.stringify(j);
  ok(typeof str === 'string');
  const parsed = JSON.parse(str);
  eq(parsed.total, 1);
});

test('toJSON: includes diagnostic', () => {
  const tap = [
    '1..1',
    'not ok 1 - fail',
    '  ---',
    '  error: oops',
    '  ...',
  ].join('\n');
  const r = parse(tap);
  const j = toJSON(r);
  eq(j.tests[0].diagnostic, 'error: oops');
});

// ─── checkThreshold Tests ─────────────────────────────────────

test('checkThreshold: all pass', () => {
  const r = parse('1..1\nok 1 - a');
  const c = checkThreshold(r);
  ok(c.pass);
});

test('checkThreshold: fails on failure', () => {
  const r = parse('1..2\nok 1 - a\nnot ok 2 - b');
  const c = checkThreshold(r);
  ok(!c.pass);
  ok(c.reason.includes('1 failures'));
});

test('checkThreshold: maxFail allows N fails', () => {
  const r = parse('1..2\nok 1 - a\nnot ok 2 - b');
  const c = checkThreshold(r, { maxFail: 1 });
  ok(c.pass);
});

test('checkThreshold: fails on too many skips', () => {
  const r = parse('1..3\nok 1 - a # SKIP\nok 2 - b # SKIP\nok 3 - c # SKIP');
  const c = checkThreshold(r, { maxSkip: 2 });
  ok(!c.pass);
  ok(c.reason.includes('3 skipped'));
});

test('checkThreshold: requirePlan fails without plan', () => {
  const r = parse('ok 1 - a');
  const c = checkThreshold(r, { requirePlan: true });
  ok(!c.pass);
  ok(c.reason.includes('No plan'));
});

test('checkThreshold: minTests enforced', () => {
  const r = parse('1..1\nok 1 - a');
  const c = checkThreshold(r, { minTests: 5 });
  ok(!c.pass);
  ok(c.reason.includes('1 tests'));
});

test('checkThreshold: bailout fails', () => {
  const r = parse('1..1\nBail out! nope');
  const c = checkThreshold(r);
  ok(!c.pass);
  ok(c.reason.includes('Bailed out'));
});

test('checkThreshold: skipAll passes', () => {
  const r = parse('1..0 # SKIP');
  const c = checkThreshold(r);
  ok(c.pass);
});

// ─── Edge Cases ───────────────────────────────────────────────

test('parse: subtests (indented TAP)', () => {
  // Subtests appear as indented lines before a parent test result
  const tap = [
    'TAP version 13',
    '1..1',
    '    ok 1 - subtest A',
    '    ok 2 - subtest B',
    'ok 1 - parent # subtests: 2 passed',
  ].join('\n');
  const r = parse(tap);
  // Only the parent (non-indented) test should be captured
  eq(r.total, 1);
  eq(r.passed, 1);
});

test('parse: realistic Node TAP output', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: test/addition.js',
    '    # Subtest: should add two numbers',
    '    ok 1 - should add two numbers',
    '    # Subtest: should handle negatives',
    '    ok 2 - should handle negatives',
    '    1..2',
    'ok 1 - test/addition.js # time=12.345ms',
    '# Subtest: test/subtraction.js',
    '    # Subtest: should subtract',
    '    not ok 1 - should subtract',
    '      ---',
    '      operator: equal',
    '      expected: 3',
    '      actual: 5',
    '      ...',
    '    1..1',
    'not ok 2 - test/subtraction.js # time=8.123ms',
    '1..2',
    '# failed 1 of 2 test files',
  ].join('\n');
  const r = parse(tap);
  // Only non-indented test lines count
  eq(r.total, 2);
  eq(r.passed, 1);
  eq(r.failed, 1);
  ok(!r.ok);
});

test('parse: handles CRLF line endings', () => {
  const tap = '1..1\r\nok 1 - a\r\n';
  const r = parse(tap);
  eq(r.total, 1);
  eq(r.passed, 1);
});

test('parse: description with special chars', () => {
  const tap = '1..1\nok 1 - handles "quotes" & <html> tags';
  const r = parse(tap);
  eq(r.tests[0].description, 'handles "quotes" & <html> tags');
});

test('parse: trailing newline', () => {
  const tap = '1..1\nok 1 - a\n';
  const r = parse(tap);
  eq(r.total, 1);
});

// ─── Results ──────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
