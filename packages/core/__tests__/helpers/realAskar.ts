/**
 * Loads askar-nodejs for a suite that runs a real Askar store. Import it first, in place of
 * `import '@openwallet-foundation/askar-nodejs'`.
 *
 * Why not import askar-nodejs directly: jest gives every test file a fresh module registry, so askar-nodejs's
 * build/ffi/structures.js runs again in each file and calls `koffi.struct('ByteBuffer', …)` again; but koffi is a
 * native addon, loaded once per worker process, and refuses a second type of the same name ("Duplicate type name
 * 'ByteBuffer'", koffi src/ffi.cc). So a second real-Askar suite to land in the same worker failed to load, which
 * jest's assignment of suites to workers made intermittent. Here the two functions askar-nodejs names its types with
 * (`koffi.struct` and `koffi.proto`) return the type this process already has under that name, and define it
 * otherwise: the same package defines them the same way each time.
 */
import { dirname } from 'path'

type Koffi = Record<'struct' | 'proto', (...args: unknown[]) => unknown> & { resolve: (name: string) => unknown }

const REUSES = Symbol.for('keyring.koffi.reusesNamedTypes')

// The copy askar-nodejs loads, so the patch reaches it even if a second copy is ever installed.
const askarDir = dirname(require.resolve('@openwallet-foundation/askar-nodejs/package.json'))
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must run before askar-nodejs loads
const koffi: Koffi = require(require.resolve('koffi', { paths: [askarDir] }))

for (const make of ['struct', 'proto'] as const) {
  const original = koffi[make] as ((...args: unknown[]) => unknown) & { [REUSES]?: true }
  if (original[REUSES]) continue
  const reusing = Object.assign(
    (...args: unknown[]) => {
      const [name] = args
      if (typeof name === 'string') {
        try {
          return koffi.resolve(name)
        } catch {
          // Not defined in this process yet.
        }
      }
      return original(...args)
    },
    { [REUSES]: true as const }
  )
  koffi[make] = reusing
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the patch above, on purpose
require('@openwallet-foundation/askar-nodejs')
