#!/usr/bin/env node
/* eslint-disable no-console -- a build script that reports what it does */
// Rebuild the vendored `@openvtc/vti-tsp-js` tarball from an upstream clone.
//
//   node vendor/build-vti-tsp-js.mjs <path-to-vta-browser-plugin-clone> [<commit>]
//
// Reads `packages/tsp-js` at the given commit (default: the pin in README.md)
// out of the clone with `git archive`, applies `vti-tsp-js-hermes-textdecoder.patch`,
// installs the package's own dependencies, builds it with `tsc`, runs its own
// test suite, patches `package.json#exports` to add a `"require"` condition
// beside each existing `"import"` one (see README.md's "The `exports` patch"
// — upstream ships ESM-only `exports`, which breaks any CJS/`ts-node`
// consumer; Node 20.19+/22+ can `require()` the same file natively once the
// condition exists), and packs it. The result lands beside this script as
// `openvtc-vti-tsp-js-<version>-<shortsha>.tgz`, and its SHA-256 is printed so
// the README can be updated. Nothing here touches the clone.
//
// Node 20 is enough: the upstream monorepo declares `engines.node >= 24` for the
// browser extension packages, but tsp-js itself is plain `tsc`.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PIN = 'bfdb0dcbd875db56b75003c7ab89ae1b92325fd6'

const [clone, commit = PIN] = process.argv.slice(2)
if (!clone || !existsSync(join(clone, '.git'))) {
  console.error('usage: build-vti-tsp-js.mjs <vta-browser-plugin clone> [<commit>]')
  process.exit(2)
}

const run = (cmd, args, cwd, opts = {}) =>
  execFileSync(cmd, args, { cwd, stdio: opts.quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' })

const work = mkdtempSync(join(tmpdir(), 'vti-tsp-js-'))
const pkg = join(work, 'packages', 'tsp-js')
try {
  const sha = run('git', ['rev-parse', commit], clone, { quiet: true }).trim()
  console.log(`archiving packages/tsp-js at ${sha}`)
  const tar = execFileSync('git', ['archive', sha, 'packages/tsp-js', 'tsconfig.base.json'], { cwd: clone })
  execFileSync('tar', ['-x', '-C', work], { input: tar })

  console.log('applying the Hermes TextDecoder patch')
  run('patch', ['-p1', '--forward', '-i', join(here, 'vti-tsp-js-hermes-textdecoder.patch')], pkg)

  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
  const deps = Object.entries(manifest.dependencies ?? {}).map(([name, range]) => `${name}@${range}`)
  console.log('installing', deps.join(' '))
  run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--silent', 'typescript@~5.9.0', ...deps], pkg)

  console.log("building and running upstream's own tests")
  run('npx', ['tsc', '-b'], pkg)
  run(
    'node',
    [
      '--test',
      ...readdirSync(join(pkg, 'tests'))
        .filter((f) => f.endsWith('.mjs'))
        .map((f) => `tests/${f}`),
    ],
    pkg
  )

  console.log('patching package.json#exports to add a "require" condition beside each "import"')
  const manifestPath = join(pkg, 'package.json')
  const toPatch = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const key of Object.keys(toPatch.exports ?? {})) {
    const condition = toPatch.exports[key]
    if (condition && typeof condition === 'object' && condition.import && !condition.require) {
      condition.require = condition.import
    }
  }
  writeFileSync(manifestPath, JSON.stringify(toPatch, null, 2) + '\n')

  console.log('packing')
  // --ignore-scripts: the package's own "prepack" runs "clean" (rm -rf dist)
  // then "build" (tsc) — both redundant here (already built above) and
  // destructive if it ran alone, since this checkout has no devDependencies
  // installed to satisfy a second build.
  run('npm', ['pack', '--silent', '--ignore-scripts'], pkg)
  const produced = readdirSync(pkg).find((f) => f.endsWith('.tgz'))
  const out = join(here, `openvtc-vti-tsp-js-${manifest.version}-${sha.slice(0, 7)}.tgz`)
  copyFileSync(join(pkg, produced), out)
  const digest = createHash('sha256').update(readFileSync(out)).digest('hex')
  console.log(`\n${resolve(out)}\nsha256 ${digest}\nupstream ${sha} + vti-tsp-js-hermes-textdecoder.patch`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
