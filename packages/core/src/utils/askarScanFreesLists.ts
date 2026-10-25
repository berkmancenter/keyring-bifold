import { AskarError, EntryList, NativeAskar, Scan } from '@openwallet-foundation/askar-shared'
import type { ScanHandle } from '@openwallet-foundation/askar-shared'

/**
 * askar-shared 0.6.0's `Scan.forEachRow` frees the scan handle but never the native `EntryList` that each
 * `scanNext` returns (build/store/Scan.js:44-57). Nothing finalizes it: the React Native binding hands the
 * list to JS as a bare pointer string. So every Credo `findByQuery` keeps its decrypted rows in native memory
 * for the life of the app. With the app open and polling, an emulator grew about 3.4 MB of native heap a minute.
 *
 * This replaces `forEachRow` with the same code plus the free. It is a bridge for an OTA, not the fix of record.
 * The fix of record is the `.yarn/patches` patch of askar-shared (wallet branch fix/askar-scan-free-entry-list),
 * which needs a store build. Upstream is unfixed through 0.6.1 and 0.7.0-alpha.
 *
 * It mirrors 0.6.0's private fields, so it installs only on that version. Hermes cannot show a function's
 * source, so a fixed build cannot be detected that way. On any other version it does nothing, and the patch or
 * upstream has to carry the fix.
 */
export const ASKAR_SHARED_VERSION_MIRRORED = '0.6.0'

const INSTALLED = Symbol.for('keyring.askar.scanFreesEntryLists')

type Entry = ReturnType<EntryList['getEntryByIndex']>

/** The fields of askar-shared 0.6.0's `Scan` that `forEachRow` reads and writes. */
interface ScanFields {
  _handle?: ScanHandle
  _listHandle?: unknown
  store?: { handle?: unknown }
  profile?: string
  category: string
  tagFilter?: Record<string, unknown>
  limit?: number
  offset?: number
  orderBy?: string
  descending?: boolean
}

async function forEachRowFreeingLists(this: ScanFields, cb: (entry: Entry) => void): Promise<void> {
  const native = NativeAskar.instance
  if (!this._handle) {
    if (!this.store?.handle) throw AskarError.customError({ message: 'Cannot scan from closed store' })
    this._handle = await native.scanStart({
      storeHandle: this.store.handle as Parameters<typeof native.scanStart>[0]['storeHandle'],
      profile: this.profile,
      category: this.category,
      tagFilter: this.tagFilter,
      limit: this.limit,
      offset: this.offset,
      orderBy: this.orderBy as Parameters<typeof native.scanStart>[0]['orderBy'],
      descending: this.descending,
    })
  }
  if (!this._handle) throw AskarError.customError({ message: 'Handle is not set. Invalid state reached.' })
  try {
    let recordCount = 0
    // Loop while the limit is not reached (or no limit is given), as 0.6.0 does.
    while (!this.limit || recordCount < this.limit) {
      const listHandle = await native.scanNext({ scanHandle: this._handle })
      if (!listHandle) break
      this._listHandle = listHandle
      const list = new EntryList({ handle: listHandle })
      try {
        recordCount = recordCount + list.length
        for (let index = 0; index < list.length; index++) {
          cb(list.getEntryByIndex(index))
        }
      } finally {
        // The one line 0.6.0 lacks. The callback must not keep an Entry: its getters read this list.
        // fetchAll converts each row with toJson() inside the callback.
        listHandle.free()
        this._listHandle = undefined
      }
    }
  } finally {
    native.scanFree({ scanHandle: this._handle })
  }
}

function installedAskarSharedVersion(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- read at runtime, inside the try; the package has no exports map
    return require('@openwallet-foundation/askar-shared/package.json').version
  } catch {
    return undefined
  }
}

export type AskarScanFixResult = 'installed' | 'already' | 'skipped-version'

/**
 * Make `Scan.forEachRow` free each entry list. Call once at startup, before an agent opens its store. Calling it
 * again is harmless. `options` exist for tests.
 */
export function installAskarScanListFree(
  options: { scanPrototype?: object; version?: string } = {}
): AskarScanFixResult {
  const proto = (options.scanPrototype ?? Scan.prototype) as Record<string | symbol, unknown>
  if (proto[INSTALLED]) return 'already'
  const version = options.version ?? installedAskarSharedVersion()
  if (version !== ASKAR_SHARED_VERSION_MIRRORED) return 'skipped-version'
  Object.defineProperty(proto, 'forEachRow', { value: forEachRowFreeingLists, writable: true, configurable: true })
  Object.defineProperty(proto, INSTALLED, { value: true })
  return 'installed'
}
