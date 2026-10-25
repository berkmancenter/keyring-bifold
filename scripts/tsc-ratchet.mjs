#!/usr/bin/env node
/* eslint-disable no-console -- a command-line gate: its output is console output */
// tsc-ratchet.mjs — a type-check gate for a package that may carry known errors.
//
// A package's build type-checks its src, but its tsconfig excludes the test
// files, and jest strips types, so nothing type-checks the tests. This runs
// `tsc --noEmit` over a project that includes them (tsconfig.ratchet.json) and
// compares what it reports with a committed baseline.
//
//   node scripts/tsc-ratchet.mjs [--package packages/core] [--project tsconfig.ratchet.json] [--write]
//
// A diagnostic's signature is its file, its TS code and its message, with no
// line or column (those move with unrelated edits). The baseline keeps a COUNT
// per signature, so a second error of a kind a file already has is still seen.
//
// Fails (exit 1) when:
//   - a signature appears that the baseline does not have, or a count rises;
//   - tsc exits non-zero but reports no diagnostic (a crash, a missing tsc):
//     judged by tsc's exit status, so "no output" never reads as "no errors".
// Passes (exit 0) when nothing rose. If counts fell or signatures went away,
// it says so and asks for the baseline to be updated in the same PR
// (`--write`), so the ratchet tightens.
//
// POLICY: src has no type errors (the build enforces it). Test files get no
// new ones: the baseline records the errors they had when the gate arrived and
// only shrinks. Adding an entry is an exception: it needs a named reason in the
// PR body and the review lane's explicit agreement. `--write` is for recording
// fixes; using it to absorb a new error without that is not allowed.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Some messages name a file by absolute path (TS7016 names the module's .js), which
// differs between a laptop and the runner; the signature keeps it repo-relative.
const relativeMessage = (message, root) => message.split(root + path.sep).join('').trim()

/** One diagnostic line of `tsc --pretty false`, or undefined for anything else. */
export function parseLine(line, pkgDir, root = repoRoot) {
  const withFile = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
  if (withFile) {
    const file = path.relative(pkgDir, path.resolve(pkgDir, withFile[1])).split(path.sep).join('/')
    return { file, code: withFile[4], message: relativeMessage(withFile[5], root) }
  }
  const global = /^error (TS\d+): (.*)$/.exec(line)
  if (global) return { file: '<global>', code: global[1], message: relativeMessage(global[2], root) }
  return undefined
}

const key = (d) => `${d.file}\t${d.code}\t${d.message}`

/** Count diagnostics by signature. Continuation lines (indented) are not diagnostics. */
export function countDiagnostics(output, pkgDir) {
  const counts = new Map()
  for (const line of output.split(/\r?\n/)) {
    const d = parseLine(line, pkgDir)
    if (d) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1)
  }
  return counts
}

export function formatBaseline(counts) {
  const header = [
    '# tsc-ratchet baseline: <count> TAB <file> TAB <TS code> TAB <message>, sorted.',
    '# Policy: src has no type errors (the build enforces it); test files get no new ones, and',
    '# this list only shrinks. A new line is an exception: it needs a named reason in the PR',
    "# body and the review lane's explicit agreement. `--write` only to record fixes.",
  ]
  const lines = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${n}\t${k}`)
  return [...header, ...lines].join('\n') + '\n'
}

export function parseBaseline(text) {
  const counts = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const [n, ...rest] = line.split('\t')
    const count = Number(n)
    if (!Number.isInteger(count) || count < 1 || rest.length < 3)
      throw new Error(`tsc-ratchet: unreadable baseline line: ${line}`)
    counts.set(rest.join('\t'), count)
  }
  return counts
}

/** What rose (fails the gate) and what fell (asks for a baseline update). */
export function compare(baseline, current) {
  const rose = []
  const fell = []
  for (const [k, n] of current) {
    const was = baseline.get(k) ?? 0
    if (n > was) rose.push({ signature: k, was, now: n })
  }
  for (const [k, was] of baseline) {
    const n = current.get(k) ?? 0
    if (n < was) fell.push({ signature: k, was, now: n })
  }
  return { rose, fell }
}

/** Run tsc for the package. Judged by exit status first: a failed run with no diagnostic is a failure. */
export function runTsc(pkgDir, { project = 'tsconfig.json', tscPath = process.env.TSC_RATCHET_TSC } = {}) {
  const tsc = tscPath ?? createRequire(path.join(pkgDir, 'package.json')).resolve('typescript/bin/tsc')
  const args = tscPath ? [] : [tsc]
  const command = tscPath ? tsc : process.execPath
  const result = spawnSync(command, [...args, '--noEmit', '--pretty', 'false', '-p', path.join(pkgDir, project)], {
    cwd: pkgDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

export function judge({ status, signal, error, output }, baseline, pkgDir) {
  if (error) return { ok: false, lines: [`tsc-ratchet: tsc could not be started: ${error.message}`] }
  if (signal) return { ok: false, lines: [`tsc-ratchet: tsc was killed by ${signal}`] }
  const current = countDiagnostics(output, pkgDir)
  const total = [...current.values()].reduce((a, b) => a + b, 0)
  if (status !== 0 && total === 0) {
    return {
      ok: false,
      lines: [
        `tsc-ratchet: tsc exited ${status} but reported no diagnostic — not a pass. Output tail:`,
        ...output.trim().split('\n').slice(-20),
      ],
    }
  }
  if (status === 0 && total > 0)
    return { ok: false, lines: ['tsc-ratchet: tsc exited 0 with diagnostics; refusing to guess'] }
  const { rose, fell } = compare(baseline, current)
  const lines = [
    `tsc-ratchet: ${total} diagnostic(s) now; baseline ${[...baseline.values()].reduce((a, b) => a + b, 0)}`,
  ]
  for (const r of rose) lines.push(`NEW  ${r.was} -> ${r.now}  ${r.signature.replace(/\t/g, '  ')}`)
  for (const f of fell) lines.push(`FIXED ${f.was} -> ${f.now}  ${f.signature.replace(/\t/g, '  ')}`)
  if (rose.length) {
    lines.push(
      "tsc-ratchet: new type errors. Fix them. A baseline exception needs a named reason in the PR body and the review lane's agreement."
    )
    return { ok: false, lines, current }
  }
  if (fell.length)
    lines.push('tsc-ratchet: errors were fixed. Update the baseline in this PR: node scripts/tsc-ratchet.mjs --write')
  return { ok: true, lines, current }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const pkgDir = path.resolve(repoRoot, arg('--package') ?? 'packages/core')
  const baselinePath = path.join(pkgDir, 'tsc-baseline.txt')
  const baseline = existsSync(baselinePath) ? parseBaseline(readFileSync(baselinePath, 'utf8')) : new Map()
  const result = judge(runTsc(pkgDir, { project: arg('--project') }), baseline, pkgDir)
  for (const line of result.lines) console.log(line)
  if (process.argv.includes('--write')) {
    if (!result.current) {
      console.log('tsc-ratchet: not writing a baseline from a failed tsc run')
      process.exit(1)
    }
    writeFileSync(baselinePath, formatBaseline(result.current))
    console.log(`tsc-ratchet: wrote ${path.relative(repoRoot, baselinePath)}`)
    process.exit(0)
  }
  process.exit(result.ok ? 0 : 1)
}
