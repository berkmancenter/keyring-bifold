/**
 * The phone's holder controller (sedi/holder/controller): one AID made once, a KEL that replays under this package's
 * own replay after every change, interactions that anchor seals, signatures by the current key, and nothing made,
 * signed or kept with the switches off. The key store is a fake KMS over @noble/curves, signing as Askar does (ES256,
 * raw r || s); the record store throws on delete, so a delete anywhere fails the row.
 */
import { p256 } from '@noble/curves/nist.js'
import { ed25519 } from '@noble/curves/ed25519.js'

import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import { verifySignature } from '../cesr/signatures'
import { digest, replayKel } from '../guardian/kel'
import {
  HOLDER_IDENTITY,
  HolderSwitchedOff,
  appendInteraction,
  holderCodeOf,
  holderKel,
  holderSign,
} from '../holder/controller'
import { WARD_IDENTITY, becomeOwnWard, wardCodeOf } from '../identity/phoneIdentity'

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')

/** An in-memory record store (genericRecords), throwing on any delete. */
export function fakeRecords() {
  const records: { id: string; content: Record<string, unknown>; tags: Record<string, string> }[] = []
  let n = 0
  const store = {
    records,
    findAllByQuery: jest.fn(async (q: Record<string, string>) =>
      records.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v))
    ),
    save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
      const r = { id: `r${++n}`, content: { ...content }, tags: { ...tags } }
      records.push(r)
      return r
    }),
    update: jest.fn(async (r: { id: string; content: Record<string, unknown> }) => {
      const kept = records.find((x) => x.id === r.id)
      if (!kept) throw new Error('no such record')
      kept.content = { ...r.content }
    }),
    delete: jest.fn(async () => {
      throw new Error('a record was deleted')
    }),
    deleteById: jest.fn(async () => {
      throw new Error('a record was deleted')
    }),
  }
  return store
}

/** A fake KMS: P-256 and Ed25519 keys, ES256 signatures as raw r || s over SHA-256 of the data. */
export function fakeKms() {
  const keys = new Map<string, { crv: 'P-256' | 'Ed25519'; secret: Uint8Array }>()
  let n = 0
  return {
    keys,
    createKey: jest.fn(async ({ type }: { type: { kty: string; crv: 'P-256' | 'Ed25519' } }) => {
      const keyId = `k${++n}`
      if (type.crv === 'P-256') {
        const secret = p256.utils.randomSecretKey()
        const pub = p256.getPublicKey(secret, false)
        keys.set(keyId, { crv: 'P-256', secret })
        return { keyId, publicJwk: { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) } }
      }
      const secret = ed25519.utils.randomSecretKey()
      keys.set(keyId, { crv: 'Ed25519', secret })
      return { keyId, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(ed25519.getPublicKey(secret)) } }
    }),
    sign: jest.fn(async ({ keyId, algorithm, data }: { keyId: string; algorithm: string; data: Uint8Array }) => {
      const key = keys.get(keyId)
      if (!key || algorithm !== 'ES256' || key.crv !== 'P-256') throw new Error('cannot sign')
      return { signature: p256.sign(data, key.secret, { prehash: true }) }
    }),
  }
}

const phone = () => {
  const genericRecords = fakeRecords()
  const kms = fakeKms()
  return { genericRecords, kms, agent: { genericRecords, kms } as never }
}

const te = new TextEncoder()
const SEAL = { i: 'E' + 'A'.repeat(43), s: '0', d: 'E' + 'B'.repeat(43) }

beforeEach(() => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
})
afterEach(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('the holder controller', () => {
  it('H01: the holder code is made once, then always the same, with one record kept and its KEL replaying', async () => {
    const p = phone()
    const [a, b] = await Promise.all([holderCodeOf(p.agent), holderCodeOf(p.agent)])
    expect(a).toBe(b)
    expect(await holderCodeOf(p.agent)).toBe(a)
    expect(p.genericRecords.records.filter((r) => r.tags.recordType === HOLDER_IDENTITY)).toHaveLength(1)
    const replay = replayKel(digest, await holderKel(p.agent))
    expect(replay).toMatchObject({ ok: true, state: { pre: a, sn: 0, ilk: 'icp' } })
    // Two keys made: the one signing now and the pre-rotated next one.
    expect(p.kms.createKey).toHaveBeenCalledTimes(2)
  })

  it('H02: an interaction anchors its seals as the next event, and the KEL still replays (the S2 anchor)', async () => {
    const p = phone()
    const aid = await holderCodeOf(p.agent)
    const first = await appendInteraction(p.agent, [SEAL])
    const second = await appendInteraction(p.agent, [{ ...SEAL, s: '1' }])
    expect([first.sn, second.sn]).toEqual([1, 2])
    const replay = replayKel(digest, await holderKel(p.agent))
    expect(replay).toMatchObject({ ok: true, state: { pre: aid, sn: 2, said: second.said } })
    expect(replay.ok && replay.history[1].seals).toEqual([SEAL])
    expect(p.genericRecords.delete).not.toHaveBeenCalled()
    expect(p.genericRecords.deleteById).not.toHaveBeenCalled()
  })

  it('H03: two interactions at once are put in order, not forked (both kept, sn 1 and 2)', async () => {
    const p = phone()
    await holderCodeOf(p.agent)
    const done = await Promise.all([appendInteraction(p.agent, [SEAL]), appendInteraction(p.agent, [SEAL])])
    expect(done.map((d) => d.sn).sort()).toEqual([1, 2])
    expect(replayKel(digest, await holderKel(p.agent))).toMatchObject({ ok: true, state: { sn: 2 } })
  })

  it('H04: holderSign is the current key: its signature verifies against the KEL key (control: another key fails)', async () => {
    const p = phone()
    await holderCodeOf(p.agent)
    const replay = replayKel(digest, await holderKel(p.agent))
    const key = replay.ok ? replay.state.keys[0] : ''
    const msg = te.encode('sign me')
    const sig = await holderSign(p.agent, msg)
    expect(verifySignature(key, { code: 'E', index: 0, raw: sig }, msg)).toBe(true)
    expect(verifySignature(key, { code: 'E', index: 0, raw: sig }, te.encode('other'))).toBe(false)
  })

  it('H05: a signature the KEL would refuse is never kept (the record stays at its last good event)', async () => {
    const p = phone()
    await holderCodeOf(p.agent)
    const before = new TextDecoder().decode(await holderKel(p.agent))
    p.kms.sign.mockImplementationOnce(async () => ({ signature: new Uint8Array(64) }))
    await expect(appendInteraction(p.agent, [SEAL])).rejects.toThrow('does not replay')
    expect(new TextDecoder().decode(await holderKel(p.agent))).toBe(before)
  })

  it('H06: with either switch off, or the SEDI/KERI kill set, nothing is made or signed (control: H01)', async () => {
    for (const off of [
      () => setTrustedApproversEnabled(false),
      () => setStateVerifiedApproversEnabled(false),
      () => (SEDI_KERI_REMOTE_OFF.off = true),
    ]) {
      const p = phone()
      off()
      await expect(holderCodeOf(p.agent)).rejects.toBeInstanceOf(HolderSwitchedOff)
      await expect(holderSign(p.agent, te.encode('x'))).rejects.toBeInstanceOf(HolderSwitchedOff)
      await expect(appendInteraction(p.agent, [SEAL])).rejects.toBeInstanceOf(HolderSwitchedOff)
      expect(p.kms.createKey).not.toHaveBeenCalled()
      expect(p.kms.sign).not.toHaveBeenCalled()
      expect(p.genericRecords.save).not.toHaveBeenCalled()
      setTrustedApproversEnabled(true)
      setStateVerifiedApproversEnabled(true)
      SEDI_KERI_REMOTE_OFF.off = false
    }
  })

  it('H07: a kill that lands after the identity exists stops the next interaction before anything is kept', async () => {
    const p = phone()
    await holderCodeOf(p.agent)
    SEDI_KERI_REMOTE_OFF.off = true
    await expect(appendInteraction(p.agent, [SEAL])).rejects.toBeInstanceOf(HolderSwitchedOff)
    expect(p.genericRecords.update).not.toHaveBeenCalled()
  })
})

describe('the ward code', () => {
  it('W01: made once, a B AID from an Ed25519 key, kept; making it does not set the ward', async () => {
    const p = phone()
    const [a, b] = await Promise.all([wardCodeOf(p.agent), wardCodeOf(p.agent)])
    expect(a).toBe(b)
    expect(a).toMatch(/^B[A-Za-z0-9_-]{43}$/)
    expect(p.genericRecords.records.filter((r) => r.tags.recordType === WARD_IDENTITY)).toHaveLength(1)
    expect(p.genericRecords.records.some((r) => r.tags.recordType === 'keyring.sedi-state-ward')).toBe(false)
  })

  it('W02: becomeOwnWard sets the ward to the code (control: before, no ward record)', async () => {
    const p = phone()
    expect(await becomeOwnWard(p.agent)).toBe('done')
    const ward = p.genericRecords.records.find((r) => r.tags.recordType === 'keyring.sedi-state-ward')
    expect(ward?.content.ward).toBe(await wardCodeOf(p.agent))
  })

  it('W03: switched off, nothing is made and the ward is not set', async () => {
    const p = phone()
    setStateVerifiedApproversEnabled(false)
    expect(await wardCodeOf(p.agent)).toBe(null)
    expect(await becomeOwnWard(p.agent)).toBe('off')
    expect(p.kms.createKey).not.toHaveBeenCalled()
    expect(p.genericRecords.save).not.toHaveBeenCalled()
  })
})
