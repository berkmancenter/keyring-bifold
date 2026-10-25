import { NativeAskar, Scan } from '@openwallet-foundation/askar-shared'
import type { Askar } from '@openwallet-foundation/askar-shared'

import { ASKAR_SHARED_VERSION_MIRRORED, installAskarScanListFree } from '../askarScanFreesLists'

// A fake native layer: scanNext hands out one list per page, and every free is counted, so a test can see which
// lists the real Scan class releases. The rows are what a Credo findByQuery would read.
type FakeList = { rows: { name: string; value: string; tags: Record<string, string> }[] }

function fakeNative(pages: FakeList[]) {
  const lists = new Map<string, FakeList>()
  const freed: string[] = []
  let scansFreed = 0
  let next = 0
  const entry = (o: { entryListHandle: { handle: string }; index: number }) =>
    lists.get(o.entryListHandle.handle)!.rows[o.index]
  const native = {
    scanStart: async () => ({ handle: 'scan-1' }),
    scanNext: async () => {
      if (next >= pages.length) return null
      const id = `list-${next}`
      lists.set(id, pages[next++])
      // The real binding returns an EntryListHandle; its free() calls entryListFree.
      const { EntryListHandle } = jest.requireActual('@openwallet-foundation/askar-shared')
      return new EntryListHandle(id)
    },
    scanFree: () => {
      scansFreed++
    },
    entryListCount: (o: { entryListHandle: { handle: string } }) => lists.get(o.entryListHandle.handle)!.rows.length,
    entryListGetName: (o: { entryListHandle: { handle: string }; index: number }) => entry(o).name,
    entryListGetCategory: () => 'DidRecord',
    entryListGetValue: (o: { entryListHandle: { handle: string }; index: number }) =>
      new TextEncoder().encode(entry(o).value),
    entryListGetTags: (o: { entryListHandle: { handle: string }; index: number }) => JSON.stringify(entry(o).tags),
    entryListFree: (o: { entryListHandle: { handle: string } }) => {
      freed.push(o.entryListHandle.handle)
    },
  }
  NativeAskar.register(native as unknown as Askar)
  return { freed, scansFreed: () => scansFreed }
}

const row = (n: number) => ({ name: `did:peer:${n}`, value: JSON.stringify({ n }), tags: { recipientKey: `k${n}` } })
const scanOver = () =>
  new Scan({ store: { handle: 'store-1' } as never, category: 'DidRecord', tagFilter: { recipientKey: 'k1' } })

// Captured before any install, for the control.
const originalForEachRow = Scan.prototype.forEachRow

describe('installAskarScanListFree', () => {
  it('control: askar-shared 0.6.0 as shipped frees the scan but none of its lists', async () => {
    const native = fakeNative([{ rows: [row(1), row(2)] }, { rows: [row(3)] }])
    const scan = scanOver()
    const rows: unknown[] = []
    await originalForEachRow.call(scan, (e) => rows.push(e.toJson()))
    expect(rows).toHaveLength(3)
    expect(native.scansFreed()).toBe(1)
    expect(native.freed).toEqual([]) // the leak
  })

  it('installs once on the version it mirrors, and only there', () => {
    expect(installAskarScanListFree({ scanPrototype: {}, version: '0.6.1' })).toBe('skipped-version')
    const proto = {}
    expect(installAskarScanListFree({ scanPrototype: proto, version: ASKAR_SHARED_VERSION_MIRRORED })).toBe('installed')
    expect(installAskarScanListFree({ scanPrototype: proto, version: ASKAR_SHARED_VERSION_MIRRORED })).toBe('already')
    // The installed tree's own askar-shared is the version mirrored, so the default call installs on Scan itself.
    expect(installAskarScanListFree()).toBe('installed')
  })

  it('fetchAll returns every row and frees every list exactly once, and the scan', async () => {
    installAskarScanListFree()
    const native = fakeNative([{ rows: [row(1), row(2)] }, { rows: [row(3)] }])
    const rows = await scanOver().fetchAll()
    expect(rows.map((r) => r.name)).toEqual(['did:peer:1', 'did:peer:2', 'did:peer:3'])
    expect(rows[2]).toMatchObject({
      value: JSON.stringify({ n: 3 }),
      tags: { recipientKey: 'k3' },
      category: 'DidRecord',
    })
    expect(native.freed).toEqual(['list-0', 'list-1'])
    expect(native.scansFreed()).toBe(1)
  })

  it('a callback that throws still frees the list and the scan', async () => {
    installAskarScanListFree()
    const native = fakeNative([{ rows: [row(1)] }, { rows: [row(2)] }])
    await expect(
      scanOver().forEachRow(() => {
        throw new Error('row handler failed')
      })
    ).rejects.toThrow('row handler failed')
    expect(native.freed).toEqual(['list-0'])
    expect(native.scansFreed()).toBe(1)
  })

  it('with the store patch also present, each list is still freed once: the shim replaces, never wraps', async () => {
    // 273's .yarn patch frees inside forEachRow and keeps the version at 0.6.0, so a build that forgot to remove
    // the shim has both. The patched method must never run, or every list would be freed twice.
    let patchedCalls = 0
    class PatchedScan extends Scan {
      public async forEachRow(cb: Parameters<Scan['forEachRow']>[0]): Promise<void> {
        patchedCalls++
        const fields = this as unknown as { _handle?: unknown }
        const native = NativeAskar.instance
        fields._handle ??= await native.scanStart({ storeHandle: 'store-1' as never, category: 'DidRecord' })
        for (;;) {
          const listHandle = await native.scanNext({ scanHandle: fields._handle as never })
          if (!listHandle) break
          const { EntryList } = jest.requireActual('@openwallet-foundation/askar-shared')
          const list = new EntryList({ handle: listHandle })
          for (let index = 0; index < list.length; index++) cb(list.getEntryByIndex(index))
          listHandle.free()
        }
        native.scanFree({ scanHandle: fields._handle as never })
      }
    }
    expect(
      installAskarScanListFree({ scanPrototype: PatchedScan.prototype, version: ASKAR_SHARED_VERSION_MIRRORED })
    ).toBe('installed')
    const native = fakeNative([{ rows: [row(1), row(2)] }, { rows: [row(3)] }])
    const rows = await new PatchedScan({ store: { handle: 'store-1' } as never, category: 'DidRecord' }).fetchAll()
    expect(rows).toHaveLength(3)
    expect(patchedCalls).toBe(0)
    expect(native.freed).toEqual(['list-0', 'list-1'])
    expect(native.scansFreed()).toBe(1)
  })

  it('stops at the limit, as 0.6.0 does, and frees what it read', async () => {
    installAskarScanListFree()
    const native = fakeNative([{ rows: [row(1), row(2)] }, { rows: [row(3)] }])
    const scan = new Scan({ store: { handle: 'store-1' } as never, category: 'DidRecord', limit: 2 })
    const rows = await scan.fetchAll()
    expect(rows).toHaveLength(2)
    expect(native.freed).toEqual(['list-0'])
    expect(native.scansFreed()).toBe(1)
  })
})
