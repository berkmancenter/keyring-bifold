// node --test scripts/tsc-ratchet.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { compare, countDiagnostics, formatBaseline, judge, parseBaseline, parseLine, runTsc } from './tsc-ratchet.mjs'

const PKG = '/repo/packages/core'
const out = (...lines) => lines.join('\n')
const e1 = "src/a.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'."
const e1Moved = "src/a.ts(42,9): error TS2339: Property 'x' does not exist on type 'Y'."
const e2 = "src/b.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'."

test('a signature is file, code and message — no line or column', () => {
  assert.deepEqual(parseLine(e1, PKG), {
    file: 'src/a.ts',
    code: 'TS2339',
    message: "Property 'x' does not exist on type 'Y'.",
  })
  assert.deepEqual(parseLine('error TS5058: The specified path does not exist.', PKG), {
    file: '<global>',
    code: 'TS5058',
    message: 'The specified path does not exist.',
  })
  assert.equal(parseLine("  Type 'A' is missing the following properties", PKG), undefined)
  assert.equal(parseLine('', PKG), undefined)
})

test('the same error moved to another line is the same signature: no churn', () => {
  const before = countDiagnostics(out(e1), PKG)
  const after = countDiagnostics(out(e1Moved), PKG)
  assert.deepEqual(compare(before, after), { rose: [], fell: [] })
})

test('an absolute path in a message is made repo-relative, so laptop and runner agree', () => {
  const at = (root) =>
    `src/c.test.ts(1,20): error TS7016: Could not find a declaration file for module 'jsonld'. '${root}/packages/core/node_modules/jsonld/lib/index.js' implicitly has an 'any' type.`
  const laptop = parseLine(at('/Users/someone/keyring-bifold'), PKG, '/Users/someone/keyring-bifold')
  const runner = parseLine(at('/home/runner/work/keyring-bifold'), PKG, '/home/runner/work/keyring-bifold')
  assert.deepEqual(laptop, runner)
  assert.match(laptop.message, / 'packages\/core\/node_modules\/jsonld\/lib\/index\.js' /)
})

test("a 'Did you mean' suggestion does not change the signature (tsc caps suggestions per program)", () => {
  const pairs = [
    [
      "a.test.ts(1,1): error TS2552: Cannot find name 'getter'. Did you mean '_getter'?",
      "a.test.ts(1,1): error TS2304: Cannot find name 'getter'.",
    ],
    [
      "a.test.ts(1,1): error TS2551: Property 'nme' does not exist on type 'User'. Did you mean 'name'?",
      "a.test.ts(1,1): error TS2339: Property 'nme' does not exist on type 'User'.",
    ],
    [
      "a.test.ts(1,1): error TS2724: '\"m\"' has no exported member named 'Foo'. Did you mean 'Fooo'?",
      "a.test.ts(1,1): error TS2305: Module '\"m\"' has no exported member 'Foo'.",
    ],
    [
      "a.test.ts(1,1): error TS2561: Object literal may only specify known properties, but 'nme' does not exist in type 'User'. Did you mean to write 'name'?",
      "a.test.ts(1,1): error TS2353: Object literal may only specify known properties, and 'nme' does not exist in type 'User'.",
    ],
  ]
  for (const [suggesting, plain] of pairs) assert.deepEqual(parseLine(suggesting, PKG), parseLine(plain, PKG))
})

test('fails on a NEW signature', () => {
  const r = judge({ status: 2, output: out(e1, e2) }, countDiagnostics(out(e1), PKG), PKG)
  assert.equal(r.ok, false)
  assert.match(r.lines.join('\n'), /NEW {2}0 -> 1 {2}src\/b\.ts {2}TS2322/)
})

test('fails when a COUNT rises: a second error of a kind the file already has', () => {
  const baseline = countDiagnostics(out(e1), PKG)
  const r = judge({ status: 2, output: out(e1, e1Moved) }, baseline, PKG)
  assert.equal(r.ok, false)
  assert.match(r.lines.join('\n'), /NEW {2}1 -> 2 {2}src\/a\.ts {2}TS2339/)
})

test('fails when tsc exits non-zero with NO output: a crash is not "zero new errors"', () => {
  for (const output of ['', 'Error: Cannot find module typescript\n    at …']) {
    const r = judge({ status: 1, output }, new Map(), PKG)
    assert.equal(r.ok, false, JSON.stringify(output))
    assert.match(r.lines[0], /exited 1 but reported no diagnostic/)
  }
  assert.equal(judge({ status: null, signal: 'SIGKILL', output: '' }, new Map(), PKG).ok, false)
  assert.equal(judge({ error: new Error('ENOENT'), output: '' }, new Map(), PKG).ok, false)
})

test('a tsc that cannot even start is a failure, by exit status (real spawn)', () => {
  const r = judge(runTsc(path.resolve('.'), { tscPath: '/usr/bin/false' }), new Map(), PKG)
  assert.equal(r.ok, false)
})

test('a missing tsconfig (TS5058) is a new signature, so it fails', () => {
  const r = judge({ status: 1, output: 'error TS5058: The specified path does not exist.' }, new Map(), PKG)
  assert.equal(r.ok, false)
})

test('passes when errors are fixed, and asks for the baseline to be updated in the same PR', () => {
  const baseline = countDiagnostics(out(e1, e1Moved, e2), PKG)
  const r = judge({ status: 2, output: out(e1) }, baseline, PKG)
  assert.equal(r.ok, true)
  assert.match(r.lines.join('\n'), /FIXED 2 -> 1/)
  assert.match(r.lines.join('\n'), /FIXED 1 -> 0/)
  assert.match(r.lines.join('\n'), /Update the baseline in this PR/)
  // The reminder names the command that ran, project included, so following it
  // cannot record a baseline from a different project.
  const named = judge({ status: 2, output: out(e1) }, baseline, PKG, 'node x --project p.json --write')
  assert.match(named.lines.join('\n'), /Update the baseline in this PR: node x --project p\.json --write/)
  // All fixed: tsc exits 0 with nothing to say, and that passes too.
  assert.equal(judge({ status: 0, output: '' }, baseline, PKG).ok, true)
})

test('clean and baseline empty: passes quietly', () => {
  const r = judge({ status: 0, output: '' }, new Map(), PKG)
  assert.equal(r.ok, true)
  assert.equal(r.lines.length, 1)
})

test('the baseline round-trips, sorted, with its header and counts', () => {
  const counts = countDiagnostics(out(e2, e1, e1Moved), PKG)
  const text = formatBaseline(counts)
  assert.match(text, /^# tsc-ratchet baseline/)
  const body = text.split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(body, [
    "2\tsrc/a.ts\tTS2339\tProperty 'x' does not exist on type 'Y'.",
    "1\tsrc/b.ts\tTS2322\tType 'string' is not assignable to type 'number'.",
  ])
  assert.deepEqual(parseBaseline(text), counts)
  assert.throws(() => parseBaseline('two\tsrc/a.ts\tTS1\tm'), /unreadable baseline line/)
})
