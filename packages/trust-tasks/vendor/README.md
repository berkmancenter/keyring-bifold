# Vendored `@openvtc/vti-tsp-js`

`@bifold/trust-tasks` depends on `@openvtc/vti-tsp-js` for the TSP wire layer
(the binary CESR tables, the version marker, the relationship state machine and
the raw-key reference `pack`/`unpack` the tests cross-check against). This
directory holds a prebuilt copy of that package, because the version this
package needs is not on npm yet.

|                        |                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarball                | `openvtc-vti-tsp-js-0.3.0-bfdb0dc.tgz`                                                                                                                                       |
| Upstream               | `OpenVTC/vta-browser-plugin`, `packages/tsp-js`, commit `bfdb0dcbd875db56b75003c7ab89ae1b92325fd6` (main, after PR #253 merged TSP Rev 3 and #249–#252, #254, #255 followed) |
| Version in the tarball | 0.3.0 — packs TSP **Rev 3** (`YTSP-AAC`), reads Rev 3 and Rev 2                                                                                                              |
| Local change           | `vti-tsp-js-hermes-textdecoder.patch`, applied to `src/` before building; plus a post-build `package.json#exports` patch (below)                                             |
| SHA-256                | `ea0a2c3dea2e97900c18cfa0b24ad94af2cc2038294e8b06b9fe2d34ad2caa8e`                                                                                                           |

## Why a tarball, not a registry version

npm has `@openvtc/vti-tsp-js` 0.1.0 and 0.2.0, both Rev 2. Rev 3 (0.3.0) is
merged on upstream `main` but unpublished. A git dependency on the upstream
monorepo would have every `yarn install` clone the whole browser-plugin
repository and run its Node 24 workspace install just to build one `tsc`
package; a prebuilt tarball pinned to the commit is the same code with none of
that cost, and it is dropped the day 0.3.x reaches npm.

## The patch

`new TextDecoder("utf-8", { fatal: true })` throws at construction on React
Native's Hermes engine, and five upstream modules construct one at import time
— so the package cannot be imported on a phone without the patch. The patch
adds `src/cesr/utf8.ts` (feature-detect `fatal`; fall back to a lenient decode
verified by re-encoding, which rejects the same inputs) and points the five
sites at it. Same fix Keyring carried against 0.1.0 as a `.yarn/patches` entry;
it is a standing request to upstream.

## The `exports` patch

Upstream publishes `"type": "module"` with an `exports` map that only
declares an `"import"` condition. Any CommonJS consumer that reaches this
package via a real `require()` — not just Jest, which has its own ESM/CJS
interop — fails at load time with `ERR_PACKAGE_PATH_NOT_EXPORTED`, before a
single line of application code runs. `@bifold/witness-server` is exactly
such a consumer: its `tsconfig.json` targets `"module": "commonjs"`, so both
`ts-node` (dev) and the plain `node dist/index.js` (production) compile every
`import` from `@openvtc/vti-tsp-js` in `@bifold/trust-tasks`'s TSP codecs
(`rev2.ts`, `rev3.ts`, `direct.ts`) down to a `require()` call. This was never
caught before 2026-09-28 because nothing had actually launched the real
witness-server _process_ with this code present — every prior verification
was Jest-based (which papers over the interop), and the one CI path that
builds and runs a real container (`staging-witness.yaml`) only triggers on a
PR into `staging`, which no branch carrying this code had opened.

The fix costs nothing on the ESM side: Node 20.19+/22+ can `require()` a
genuine ES module natively, provided the package's own `exports` map offers a
`"require"` condition to pick. `dist/index.js` (and the two subpath exports)
are plain, synchronous, no-top-level-await modules, so pointing `"require"`
at the _same_ file as `"import"` is sufficient — verified directly: `node -e
"require('@openvtc/vti-tsp-js')"` succeeds against the patched tarball and
fails against the original. No source or `dist/` output changed, only the
three `exports` entries in `package.json` gained a sibling `"require"` key
equal to their existing `"import"` value. `diff -r` against the previous
tarball confirms `package.json` is the only file that differs.

This is baked into `build-vti-tsp-js.mjs` (a post-build, pre-pack step) so a
future pin bump doesn't silently lose it. It's also a good candidate to send
upstream — see "Upstreaming" below.

## Upstreaming

This `exports` fix is generally useful, not just to Keyring: any CJS,
`ts-node`, or non-bundler consumer of `@openvtc/vti-tsp-js` on a
modern-enough Node hits the identical crash, and the fix is a
backward-compatible, zero-risk addition (existing ESM consumers are
unaffected; it only adds a resolution path that previously didn't exist).
Per this repo's upstream-contribution convention (see the `openvtc-workspace`
skill), this is a candidate to propose to `OpenVTC/vta-browser-plugin` — not
done as part of this change; needs a human decision on drafting and sending
it.

## Rebuilding

```sh
node scripts/openvtc/setup-external.mjs          # at the wallet root: clones the upstream repos
cd bifold/packages/trust-tasks
node vendor/build-vti-tsp-js.mjs ../../../external/vta-browser-plugin [<commit>]
```

The script archives `packages/tsp-js` at the commit, applies the patch,
installs the package's own three `@noble` dependencies and TypeScript, builds,
runs upstream's test suite (124 tests at this pin), packs, and prints the
tarball's SHA-256. Compare rebuilt tarballs by content (`tar -xzf` both and
`diff -r`): npm's tarball bytes are not reproducible across machines, the
extracted files are.

Bumping the pin: rebuild against the new commit, replace the tarball, update
the `file:` reference in `../package.json`, the table above, and re-run the
`tsp` test suites in `@bifold/core` — the cross-checks there are what catch a
wire change.
