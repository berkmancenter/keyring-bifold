# SEDI/KERI test fixtures

`k0-utah-v2/` is a copy of the K0 test kit's output (`PROVENANCE.json` inside says how it was made: keripy 7143832
run directly on a GitHub Actions runner, run 42874885513). A made-up State chain: root, Org Unit, Issuing Agent, Guardian
and Social Authorization credentials, their registries' TELs, the issuers' KELs, and the bad cases a phone must refuse.
Deviations from Utah's design, recorded there too: SAIDs are Blake3 (keripy's high-level API takes no digest code
there), not SHA2-256 everywhere; edges are I2I (keripy's verifiers refuse DI2I); the KELs have no witnesses.

`cesr-ts-reads.json` is what cesr-ts 2.0.0 reads from each KEL stream in `k0-utah-v2/` (`kel-*.cesr`, `icp-*.cesr`),
in the fields the verifier uses. It was generated once, outside this repo, with `cesr-ts-reads.gen.mjs` against an
install of `cesr-ts@2.0.0` (npm), and is the reference our own reader (`../../cesr/reader.ts`) must match byte for byte:

    node cesr-ts-reads.gen.mjs <node_modules holding cesr2 = npm:cesr-ts@2.0.0> k0-utah-v2 cesr-ts-reads.json

cesr-ts is not a dependency of this package; the generator is kept only so the reference can be remade.
