/**
 * Stage 2 S1/S2 over the K0 kit's fixtures (fixtures/k0-utah-v2: keripy 7143832, P-256, SHA2-256 prefixes, Blake3
 * SAIDs). The rows K01–K21 of ref-21's k0ladder.mjs, on this package's own CESR reader. Each refusal has a control that
 * differs from it in the one thing it refuses.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../../trust-tasks/module/stateVerifiedApproversFlag'
import {
  SEDI_SCHEMAS,
  blidOf,
  checkEdge,
  guardianIn,
  parseProof,
  saidifyAcdcV2,
  socialIn,
  verifyAcdcV2,
  verifyTel,
  type ChainContext,
  type Sad,
} from '../guardian/chain'
import { verifyGuardian, verifySocialAuthorization, type ChainMaterial } from '../guardian'
import { ed25519 } from '@noble/curves/ed25519.js'
import { p256 } from '@noble/curves/nist.js'

import { INDEXED_SIGS } from '../cesr/codes'
import { b64Encode } from '../cesr/qb64'
import { readKelStream } from '../cesr/reader'
import { DUMMY, digest, replayKel, type Replay } from '../guardian/kel'

const FX = join(__dirname, 'fixtures', 'k0-utah-v2')
const files = readdirSync(FX)
const bytes = (f: string) => new Uint8Array(readFileSync(join(FX, f)))
const text = (f: string) => readFileSync(join(FX, f), 'utf8')
const prov = JSON.parse(text('PROVENANCE.json')) as {
  aids: Record<string, string>
  trustedRoot: string
  creds: Record<string, { said: string; states: string[] }>
}
const aids = prov.aids
const said = (n: string) => prov.creds[n].said

function buildContext(): ChainContext & { kelFiles: Map<string, Replay & { file: string }> } {
  const kels = new Map<string, Replay>()
  const kelFiles = new Map<string, Replay & { file: string }>()
  for (const f of files.filter((f) => /^kel-.*\.cesr$/.test(f)).sort()) {
    const r = replayKel(digest, bytes(f))
    kelFiles.set(f, { ...r, file: f })
    kels.set(r.ok ? r.state.pre : f, r)
  }
  const tels = new Map<string, { ripText: string; updateTexts: string[] }>()
  for (const f of files.filter((f) => /^tel-.*-rip\.json$/.test(f))) {
    const stem = f.slice(4, -9)
    const ripText = text(f)
    const updateTexts = ['issued', 'revoked']
      .map((s) => `tel-${stem}-${s}.json`)
      .filter((n) => files.includes(n))
      .map(text)
    tels.set(JSON.parse(ripText).d, { ripText, updateTexts })
  }
  const creds = new Map<string, string>()
  for (const [name, c] of Object.entries(prov.creds)) {
    const issued = `acdc-${name}-issued-proofed.cesr`
    creds.set(c.said, text(c.states.includes('revoked') ? `acdc-${name}-revoked-proofed.cesr` : issued))
  }
  return {
    digest,
    kels,
    kelFiles,
    tels,
    creds,
    trustedRoots: new Set([prov.trustedRoot]),
    now: new Date('2026-11-11T12:00:00Z'),
  }
}

const ctx = buildContext()
const asJordan = { guardian: aids.jordan, ward: aids.sam }
const verdict = (r: { ok: boolean; reason?: string }) => (r.ok ? 'valid' : r.reason)
const sadOf = (s: string) => JSON.parse((parseProof(ctx.creds.get(s)!) as { acdcText: string }).acdcText) as Sad

describe('the K0 chain, shape by shape', () => {
  it('K01: all 10 K0 KELs replay (SHA2-256 prefixes, Blake3 SAIDs, P-256)', () => {
    const bad = [...ctx.kelFiles.values()].filter((k) => !k.ok).map((k) => `${k.file}: ${!k.ok && k.reason}`)
    expect([ctx.kelFiles.size, bad]).toEqual([10, []])
  })

  it('K02: every ACDC: nested block SAIDs and the compact top-level SAID recompute', () => {
    const acdcs = files.filter((f) => /^acdc-.*\.json$/.test(f))
    expect(acdcs.length).toBeGreaterThan(5)
    expect(acdcs.filter((f) => !verifyAcdcV2(digest, text(f)).ok)).toEqual([])
  })

  it('K03: every disclosed state unblinds to its blid (Blake3 over dummy+uuid+td+ts)', () => {
    const proofs = files.filter((f) => /^acdc-.*-proofed\.cesr$/.test(f))
    expect(proofs.length).toBeGreaterThan(5)
    const bad = proofs.filter((f) => {
      const p = parseProof(text(f))
      return !p.ok || blidOf(digest, p.blinder) !== p.blinder.blid
    })
    expect(bad).toEqual([])
  })

  it('K04: every TEL chains from its rip and every event is sealed in the issuer KEL', () => {
    expect(ctx.tels.size).toBeGreaterThan(5)
    const bad = [...ctx.tels.values()]
      .map((t) => verifyTel(digest, { ...t, issuerKel: ctx.kels.get(JSON.parse(t.ripText).i) }))
      .filter((r) => !r.ok)
    expect(bad).toEqual([])
  })
})

describe('S1: the Guardian', () => {
  it('K05: G-ok, issued by the State chain to Jordan, ward Sam, current, unexpired: accepted', () => {
    expect(guardianIn(ctx, said('G-ok'), asJordan)).toMatchObject({
      ok: true,
      guardian: aids.jordan,
      ward: aids.sam,
      root: prov.trustedRoot,
    })
  })

  it('K06: G-revoked with its revoked-state proof: refused as revoked (keripy accepts this grant)', () => {
    expect(verdict(guardianIn(ctx, said('G-revoked'), asJordan))).toBe('revoked')
  })

  it('K07: G-revoked with its stale "issued" proof: refused, the state shown is not the current one', () => {
    const c = { ...ctx, creds: new Map(ctx.creds).set(said('G-revoked'), text('acdc-G-revoked-issued-proofed.cesr')) }
    expect(verdict(guardianIn(c, said('G-revoked'), asJordan))).toBe('statusNotCurrent')
  })

  it('K08: G-otherward names another ward: refused (control K05 names Sam)', () => {
    expect(verdict(guardianIn(ctx, said('G-otherward'), asJordan))).toBe('wardMismatch')
  })

  it('K09: G-untrusted ends at a root not on the trusted list: refused', () => {
    expect(verdict(guardianIn(ctx, said('G-untrusted'), asJordan))).toBe('untrustedRoot')
  })

  it('K09c: control for K09: the same card with its root trusted is accepted, so K09 is about the root', () => {
    const c = { ...ctx, trustedRoots: new Set([aids['mal-root']]) }
    expect(verdict(guardianIn(c, said('G-untrusted'), asJordan))).toBe('valid')
  })

  it('K10: G-ok after its expirationDate (2030-11-10): refused as expired (control K05 at 2026-11-11)', () => {
    expect(verdict(guardianIn({ ...ctx, now: new Date('2031-01-01T00:00:00Z') }, said('G-ok'), asJordan))).toBe(
      'expired'
    )
  })

  it("K11: G-ok checked for a different holder: refused (the card is Jordan's)", () => {
    expect(verdict(guardianIn(ctx, said('G-ok'), { guardian: aids.verifier, ward: aids.sam }))).toBe('wrongHolder')
  })

  it('K12: G-nontrans-issuee, a P-256 non-transferable issuee on the same chain: accepted', () => {
    expect(verdict(guardianIn(ctx, said('G-nontrans-issuee'), { guardian: aids['jordan-nt'], ward: aids.sam }))).toBe(
      'valid'
    )
  })
})

describe('S2: the Social Authorization', () => {
  it('K13: S2-social, Jordan to Sam, guardian edge to G-ok, Guardian chain to the State: accepted', () => {
    expect(verdict(socialIn(ctx, said('S2-social'), { ward: aids.sam }))).toBe('valid')
  })

  it("K14: an edge to another guardian's card (issued to someone else) is refused by I2I (control K14c)", () => {
    const sad = sadOf(said('S2-social'))
    const near = { ...sad, e: { ...sad.e, guardian: { ...sad.e!.guardian, n: said('G-nontrans-issuee') } } }
    expect(verdict(checkEdge(ctx, near, 'guardian', SEDI_SCHEMAS.guardian))).toBe('edgeNotI2I')
  })

  it('K14c: control for K14: the same edge check on the real Social reaches G-ok', () => {
    const r = checkEdge(ctx, sadOf(said('S2-social')), 'guardian', SEDI_SCHEMAS.guardian)
    expect(r.ok && r.sad.d).toBe(said('G-ok'))
  })

  it('K15: a re-SAIDed Social pointing at another guardian is well formed but bound by no TEL: refused', () => {
    const sad = sadOf(said('S2-social'))
    const forged = saidifyAcdcV2(digest, {
      ...sad,
      e: { ...sad.e, guardian: { ...sad.e!.guardian, n: said('G-nontrans-issuee') } },
    })
    const forgedText = JSON.stringify(forged)
    expect(verifyAcdcV2(digest, forgedText).ok).toBe(true)
    const proof = ctx.creds.get(said('S2-social'))!
    const c = { ...ctx, creds: new Map(ctx.creds).set(forged.d, forgedText + proof.slice(proof.lastIndexOf('}') + 1)) }
    expect(verdict(socialIn(c, forged.d, { ward: aids.sam }))).toBe('telBroken')
  })

  it('K16: S2-social after its expires (2026-11-17T22:00Z): refused as expired (control K13)', () => {
    expect(
      verdict(socialIn({ ...ctx, now: new Date('2026-11-18T00:00:00Z') }, said('S2-social'), { ward: aids.sam }))
    ).toBe('expired')
  })
})

describe('tampering (each one would weaken one check)', () => {
  it('K17: G-revoked with its revoked proof relabelled "issued" no longer unblinds: refused', () => {
    const t = text('acdc-G-revoked-revoked-proofed.cesr').replace(/Yrevoked$/, '0Missued')
    expect(t).not.toBe(text('acdc-G-revoked-revoked-proofed.cesr'))
    const c = { ...ctx, creds: new Map(ctx.creds).set(said('G-revoked'), t) }
    expect(verdict(guardianIn(c, said('G-revoked'), asJordan))).toBe('statusNotCurrent')
  })

  it("K18: G-ok's TEL against its issuer's KEL cut back to inception (no seals): refused as unanchored", () => {
    const sue = ctx.kels.get(aids.sue)!
    if (!sue.ok) throw new Error('fixture: Sue replays')
    const cut = { ...sue, history: sue.history.slice(0, 1) }
    const c = { ...ctx, kels: new Map(ctx.kels).set(aids.sue, cut) }
    expect(verdict(guardianIn(c, said('G-ok'), asJordan))).toBe('telUnanchored')
  })

  it("K18b: G-ok's issuance update unsealed while its registry's rip stays sealed: refused as unanchored", () => {
    // K18 cuts the KEL back so far that the rip itself is unsealed; this keeps the rip's seal and drops only the one
    // that anchors the issuance, so the update's own anchor is what refuses it (control: K05).
    const proof = ctx.creds.get(said('G-ok'))!
    const regk = (JSON.parse(proof.slice(0, proof.lastIndexOf('}') + 1)) as { rd: string }).rd
    const issued = JSON.parse(ctx.tels.get(regk)!.updateTexts[0]) as { d: string }
    const sue = ctx.kels.get(aids.sue)!
    if (!sue.ok) throw new Error('fixture: Sue replays')
    const history = sue.history.map((h) => (h ? { ...h, seals: h.seals.filter((x) => x.d !== issued.d) } : h))
    expect(history.flatMap((h) => h?.seals ?? []).some((x) => x.d === regk)).toBe(true)
    const c = { ...ctx, kels: new Map(ctx.kels).set(aids.sue, { ...sue, history }) }
    expect(verdict(guardianIn(c, said('G-ok'), asJordan))).toBe('telUnanchored')
  })

  it('K01b: a KEL with one controller signature altered does not replay (control: K01, the same stream unaltered)', () => {
    const original = new TextDecoder().decode(bytes('kel-roy.cesr'))
    const at = original.indexOf('-KAW') + 4 + 40
    const flipped = original.slice(0, at) + (original[at] === 'A' ? 'B' : 'A') + original.slice(at + 1)
    expect(flipped).not.toBe(original)
    const r = replayKel(digest, new TextEncoder().encode(flipped))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/controller signatures 0\/1/)
    expect(replayKel(digest, bytes('kel-roy.cesr')).ok).toBe(true)
  })

  it('K19: G-ok with its expirationDate.value changed inside its nested block: refused, the block SAID breaks', () => {
    const t = ctx.creds
      .get(said('G-ok'))!
      .replace('"value":"2030-11-10T00:00:00.000000+00:00"', '"value":"2099-11-10T00:00:00.000000+00:00"')
    expect(t).not.toBe(ctx.creds.get(said('G-ok')))
    const c = { ...ctx, creds: new Map(ctx.creds).set(said('G-ok'), t) }
    expect(verdict(guardianIn(c, said('G-ok'), asJordan))).toBe('saidMismatch')
  })

  it('K20: an edge that pins another schema than the one expected is refused (control K14c)', () => {
    const sad = sadOf(said('G-ok'))
    const near = { ...sad, e: { ...sad.e, utahAgent: { ...sad.e!.utahAgent, s: SEDI_SCHEMAS.orgUnit } } }
    expect(verdict(checkEdge(ctx, near, 'utahAgent', SEDI_SCHEMAS.issuingAgent))).toBe('schemaMismatch')
  })

  it("K21: G-revoked's TEL with its n=2 update re-SAIDed to name the rip as prior: refused, the chain breaks", () => {
    const proof = ctx.creds.get(said('G-revoked'))!
    const regk = (JSON.parse(proof.slice(0, proof.lastIndexOf('}') + 1)) as { rd: string }).rd
    const t = ctx.tels.get(regk)!
    const ev = JSON.parse(t.updateTexts[1])
    const moved = JSON.stringify({ ...ev, p: regk, d: '#'.repeat(44) })
    const relinked = moved.replace('#'.repeat(44), digest('E', new TextEncoder().encode(moved)))
    const c = { ...ctx, tels: new Map(ctx.tels).set(regk, { ...t, updateTexts: [t.updateTexts[0], relinked] }) }
    expect(verdict(guardianIn(c, said('G-revoked'), asJordan))).toBe('telBroken')
  })
})

describe('the entry points, behind the state-verified approvers switch', () => {
  const material = (): ChainMaterial => ({
    kels: files.filter((f) => /^kel-.*\.cesr$/.test(f)).map(bytes),
    tels: [...ctx.tels.values()],
    creds: [...ctx.creds.values()],
  })
  const options = { trustedRoots: [prov.trustedRoot], now: new Date('2026-11-11T12:00:00Z') }
  // The material with some credential texts and TEL update texts edited (keyed by credential SAID / registry SAID).
  const edited = (
    credEdits: Record<string, (text: string) => string>,
    updateEdits: Record<string, (text: string) => string>
  ): ChainMaterial => {
    const m = material()
    m.creds = m.creds.map((t) => {
      const d = (JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)) as { d: string }).d
      return credEdits[d] ? credEdits[d](t) : t
    })
    m.tels = m.tels.map((tel) => {
      const rd = (JSON.parse(tel.ripText) as { d: string }).d
      return updateEdits[rd] ? { ...tel, updateTexts: tel.updateTexts.map(updateEdits[rd]) } : tel
    })
    return m
  }
  const recode = (said: string, code: string) => code + said.slice(1)
  const registryOf = (name: string) => sadOf(said(name)).rd!
  /** Every SAID of a nested block (any object with a "d" below the top level) in a credential. */
  const nestedSaids = (name: string) => {
    const out: string[] = []
    const walk = (v: unknown, top: boolean) => {
      if (!v || typeof v !== 'object') return
      const o = v as Record<string, unknown>
      if (!top && typeof o.d === 'string') out.push(o.d)
      for (const x of Object.values(o)) walk(x, false)
    }
    walk(sadOf(said(name)), true)
    return out
  }

  afterEach(() => {
    setStateVerifiedApproversEnabled(false)
    STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = false
  })

  it('off (the default), or killed for this feature or for SEDI/KERI, they refuse with switchedOff (control: on, G-ok is valid)', () => {
    const run = () =>
      verdict(verifyGuardian(material(), said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options))
    expect(run()).toBe('switchedOff')
    setStateVerifiedApproversEnabled(true)
    expect(run()).toBe('valid')
    STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true
    expect(run()).toBe('switchedOff')
    STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = true
    expect(run()).toBe('switchedOff')
  })

  it('on, the Social entry point accepts S2 and refuses a revoked Guardian through the Guardian entry point', () => {
    setStateVerifiedApproversEnabled(true)
    expect(verdict(verifySocialAuthorization(material(), said('S2-social'), { ward: aids.sam }, options))).toBe('valid')
    expect(
      verdict(verifyGuardian(material(), said('G-revoked'), { holder: aids.jordan, ward: aids.sam }, options))
    ).toBe('revoked')
  })

  it('a KEL stream with CESR this package does not read is refused as unsupportedCesr, never treated as absent', () => {
    setStateVerifiedApproversEnabled(true)
    const m = material()
    const kel = new TextDecoder().decode(m.kels[0]).replace('-KAW', '-LAW')
    m.kels[0] = new TextEncoder().encode(kel)
    expect(verdict(verifyGuardian(m, said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options))).toBe(
      'unsupportedCesr'
    )
  })

  it('the details of unsupportedCesr and malformedCesr are refusals, worded as such, never as "the material was fine"', () => {
    setStateVerifiedApproversEnabled(true)
    const detailOf = (alter: (kel: string) => string) => {
      const m = material()
      m.kels[0] = new TextEncoder().encode(alter(new TextDecoder().decode(m.kels[0])))
      const r = verifyGuardian(m, said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options)
      return r.ok ? 'valid' : `${r.reason}: ${r.detail}`
    }
    expect(detailOf((k) => k.replace('-KAW', '-LAW'))).toMatch(
      /^unsupportedCesr: Keyring can't verify this \(unsupported: at \d+: count code -L\)$/
    )
    expect(detailOf((k) => k.slice(0, 40))).toMatch(
      /^malformedCesr: this can't be read \(at 0: body of \d+ bytes runs past the stream\)$/
    )
    for (const d of [detailOf((k) => k.replace('-KAW', '-LAW')), detailOf((k) => k.slice(0, 40))])
      expect(d).not.toMatch(/harmless|benign|only unsupported|\bfine\b|\bsafe\b/i)
  })

  it('fail closed: no unreadable or altered KEL stream, anywhere in the material, lets either entry point return valid', () => {
    // Every KEL in the material, each altered one way at a time, through BOTH entry points (G-ok and S2-social, which
    // are valid unaltered: the control below). Code cases must come back as their exact CESR refusal; fuzzed ones as any
    // refusal at all. Not covered on purpose: a cut exactly between two events (a complete, shorter KEL, not malformed;
    // whether the chain still holds is the chain checks' job, K18), and a trailing empty `-KAA` group (well formed;
    // cesr-ts 2.0.0 reads it too). A body or signature character edited is its own class: if the edited stream still
    // reads, kelNotReplaying; if it no longer reads, the reader's refusal, never kelNotReplaying.
    setStateVerifiedApproversEnabled(true)
    const enc = new TextEncoder()
    const kelNames = files.filter((f) => /^kel-.*\.cesr$/.test(f)).sort()
    let seed = 0x5ed1
    const rand = (n: number) => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0
      return seed % n
    }
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    type Case = {
      label: string
      text: string
      cls: 'cesr' | 'edit'
      expect?: 'unsupportedCesr' | 'malformedCesr' | 'kelNotReplaying'
    }
    const cases: Case[] = []
    for (const f of kelNames) {
      const t = text(f)
      // Where each attachment group opens, from the reader's own framing of the unaltered stream (checked against
      // cesr-ts above), so a "count" case alters a count and never a "-K" that happens to sit inside a body.
      const read = readKelStream(enc.encode(t))
      if (!read.ok) throw new Error(`fixture: ${f} reads`)
      const headers: number[] = []
      let pos = 0
      for (const fr of read.frames) {
        pos += fr.body.raw.length
        for (const gr of fr.groups) {
          headers.push(pos)
          pos += 4 + gr.items.reduce((n, it) => n + INDEXED_SIGS[it.code].fs, 0)
        }
      }
      expect([pos, headers.every((h) => t.slice(h, h + 2) === '-K')]).toEqual([t.length, true])
      const g = headers[0]
      expect(t.indexOf('-KAW')).toBe(g)
      const sig = t.slice(g + 4, g + 92)
      const add = (label: string, altered: string, expect?: Case['expect'], cls: Case['cls'] = 'cesr') =>
        cases.push({ label: `${f}: ${label}`, text: altered, expect, cls })
      // Codes this reader lacks, including the ones a lenient parser would skip and still find the real signatures.
      add('unknown count code', t.replace('-KAW', '-LAW'), 'unsupportedCesr')
      add('unknown signature code', t.slice(0, g + 4) + 'C' + t.slice(g + 5), 'unsupportedCesr')
      add('unknown version (CBOR)', t.replace('KERICAACAAJSON', 'KERICAACAACBOR'), 'unsupportedCesr')
      add(
        'an unknown group after the real signatures',
        t.slice(0, g + 92) + '-LAW' + sig + t.slice(g + 92),
        'unsupportedCesr'
      )
      add(
        'an unknown-code signature beside the real one',
        t.slice(0, g) + '-KAs' + sig + 'C' + sig.slice(1) + t.slice(g + 92),
        'unsupportedCesr'
      )
      // Streams that do not add up.
      add('empty stream', '', 'malformedCesr')
      add('cut inside the first body', t.slice(0, 40), 'malformedCesr')
      add('count one quadlet short', t.replace('-KAW', '-KAV'), 'malformedCesr')
      add('count one quadlet long', t.replace('-KAW', '-KAX'))
      add('trailing junk', t + 'xyz')
      add('trailing newline', t + '\n')
      add('trailing lone dash', t + '-')
      add('trailing count code cut short', t + '-KA')
      // Fuzz (seeded, so a failure reproduces): cuts strictly inside an event or its attachments, and the count
      // characters of every -K group changed to another value.
      const boundaries = new Set([t.length, ...[...t.matchAll(/\{"v":"KERI/g)].map((m) => m.index)])
      for (let k = 0; k < 6; ) {
        const at = 1 + rand(t.length - 1)
        if (boundaries.has(at)) continue
        add(`cut at ${at}`, t.slice(0, at))
        k++
      }
      const swap = (i: number, label: string) => {
        let c = b64[rand(64)]
        if (c === t[i]) c = c === 'A' ? 'B' : 'A'
        add(`${label} at ${i} -> ${c}`, t.slice(0, i) + c + t.slice(i + 1))
      }
      for (const h of headers) for (const d of [2, 3]) swap(h + d, 'count char')
      // A character outside the count codes changed (in a body or a signature). Its expected outcome comes from the
      // reader on the edited bytes: still reads, kelNotReplaying; no longer reads, that refusal.
      for (let k = 0; k < 3; ) {
        const i = rand(t.length)
        if (headers.some((h) => i >= h && i < h + 4) || !/[A-Za-z0-9_]/.test(t[i])) continue
        let c = b64[rand(64)]
        if (c === t[i]) c = c === 'A' ? 'B' : 'A'
        const edited = t.slice(0, i) + c + t.slice(i + 1)
        const r = readKelStream(enc.encode(edited))
        add(`body or signature char at ${i} -> ${c}`, edited, r.ok ? 'kelNotReplaying' : r.reason, 'edit')
        k++
      }
    }
    const unaltered = (): ChainMaterial => material()
    const withAltered = (c: Case): ChainMaterial => {
      const m = material()
      const i = kelNames.indexOf(c.label.slice(0, c.label.indexOf(':')))
      m.kels[i] = enc.encode(c.text)
      return m
    }
    // A throw is recorded as its own outcome (asserted to be none, after the valid check), so a case that throws can
    // never hide whether another one came back valid.
    const attempt = (f: () => { ok: boolean; reason?: string }) => {
      try {
        return verdict(f())
      } catch (e) {
        return `threw ${(e as Error).message}`
      }
    }
    const run = (m: ChainMaterial) => [
      attempt(() => verifyGuardian(m, said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options)),
      attempt(() => verifySocialAuthorization(m, said('S2-social'), { ward: aids.sam }, options)),
    ]
    // Control: the same two checks on the unaltered material are valid, so a refusal below is the alteration's.
    expect(run(unaltered())).toEqual(['valid', 'valid'])
    expect(material().kels).toHaveLength(kelNames.length)
    const outcomes = cases.map((c) => ({ c, got: run(withAltered(c)) }))
    expect(outcomes.filter((o) => o.got.includes('valid')).map((o) => `${o.c.label} -> ${o.got}`)).toEqual([])
    expect(
      outcomes.filter((o) => o.c.expect && o.got.some((v) => v !== o.c.expect)).map((o) => `${o.c.label} -> ${o.got}`)
    ).toEqual([])
    // Every CESR-class case is a CESR refusal: a parse failure is never reported as kelNotReplaying.
    expect(
      outcomes
        .filter((o) => o.c.cls === 'cesr' && o.got.some((v) => v !== 'unsupportedCesr' && v !== 'malformedCesr'))
        .map((o) => `${o.c.label} -> ${o.got}`)
    ).toEqual([])
    expect(outcomes.filter((o) => o.c.cls === 'edit' && o.c.expect === 'kelNotReplaying').length).toBeGreaterThan(20)
    expect(
      outcomes
        .filter((o) => o.got.some((v) => v === undefined || v.startsWith('threw')))
        .map((o) => `${o.c.label} -> ${o.got}`)
    ).toEqual([])
    expect(cases.filter((c) => c.cls === 'cesr').length).toBeGreaterThanOrEqual(kelNames.length * 21)

    // The credentials and TEL events too: every nested block SAID of every credential, and every TEL update SAID,
    // recoded to a digest code this package lacks. None throws; where the edited SAID is on an entry point's chain
    // that entry point says unsupportedCesr, and elsewhere it stays valid (credentials are checked when a chain
    // reaches them). (A credential's own top-level SAID is what the material is looked up by: the next row.)
    const onGuardian = new Set(['unit', 'agent', 'G-ok'])
    const onSocial = new Set([...onGuardian, 'S2-social'])
    const materialOutcomes: { label: string; got: string[]; want: string[] }[] = []
    for (const name of Object.keys(prov.creds)) {
      const code = ['H', 'F', 'G'][rand(3)]
      const want = [onGuardian.has(name), onSocial.has(name)].map((on) => (on ? 'unsupportedCesr' : 'valid'))
      for (const d of nestedSaids(name)) {
        const m = edited({ [said(name)]: (t) => t.split(`"d":"${d}"`).join(`"d":"${recode(d, code)}"`) }, {})
        materialOutcomes.push({ label: `${name}: nested block ${d.slice(0, 8)} -> ${code}`, got: run(m), want })
      }
      for (const u of ctx.tels.get(registryOf(name))!.updateTexts) {
        const d = (JSON.parse(u) as { d: string }).d
        const m = edited(
          {},
          { [registryOf(name)]: (t) => (t === u ? t.replace(`"d":"${d}"`, `"d":"${recode(d, code)}"`) : t) }
        )
        materialOutcomes.push({ label: `${name}: TEL update ${d.slice(0, 8)} -> ${code}`, got: run(m), want })
      }
    }
    expect(
      materialOutcomes.filter((o) => o.got.some((v) => v.startsWith('threw'))).map((o) => `${o.label} -> ${o.got}`)
    ).toEqual([])
    expect(materialOutcomes.filter((o) => o.got.join() !== o.want.join()).map((o) => `${o.label} -> ${o.got}`)).toEqual(
      []
    )
    expect(materialOutcomes.filter((o) => o.want[0] === 'unsupportedCesr').length).toBeGreaterThan(5)
  })

  it.each([
    [
      'an ACDC SAID (G-ok for the Guardian entry, S2-social for the Social entry)',
      (code: string) => ({
        m: edited(
          {
            [said('G-ok')]: (t: string) => t.split(said('G-ok')).join(recode(said('G-ok'), code)),
            [said('S2-social')]: (t: string) => t.split(said('S2-social')).join(recode(said('S2-social'), code)),
          },
          {}
        ),
        g: recode(said('G-ok'), code),
        s: recode(said('S2-social'), code),
      }),
      ['saidMismatch', 'saidMismatch'],
    ],
    [
      'a nested block SAID in G-ok (both entry points reach G-ok)',
      (code: string) => {
        const d = nestedSaids('G-ok')[0]
        return {
          m: edited({ [said('G-ok')]: (t: string) => t.split(`"d":"${d}"`).join(`"d":"${recode(d, code)}"`) }, {}),
          g: said('G-ok'),
          s: said('S2-social'),
        }
      },
      ['saidMismatch', 'saidMismatch'],
    ],
    [
      "a TEL update SAID in G-ok's registry (both entry points reach it)",
      (code: string) => {
        const u = ctx.tels.get(registryOf('G-ok'))!.updateTexts[0]
        const d = (JSON.parse(u) as { d: string }).d
        return {
          m: edited({}, { [registryOf('G-ok')]: (t: string) => t.replace(`"d":"${d}"`, `"d":"${recode(d, code)}"`) }),
          g: said('G-ok'),
          s: said('S2-social'),
        }
      },
      ['telBroken', 'telBroken'],
    ],
  ])(
    '%s under a digest code this package lacks (H) is unsupportedCesr from both entry points, never a throw (control: under a supported but wrong code, I, the check reaches the recompute and refuses as an edit)',
    (_, make, withI) => {
      setStateVerifiedApproversEnabled(true)
      const both = (x: { m: ChainMaterial; g: string; s: string }) =>
        [
          () => verifyGuardian(x.m, x.g, { holder: aids.jordan, ward: aids.sam }, options),
          () => verifySocialAuthorization(x.m, x.s, { ward: aids.sam }, options),
        ].map((f) => {
          try {
            const r = f()
            return r.ok ? 'valid' : `${r.reason}: ${r.detail}`
          } catch (e) {
            return `threw ${(e as Error).message}`
          }
        })
      expect(both({ m: material(), g: said('G-ok'), s: said('S2-social') })).toEqual(['valid', 'valid'])
      expect(both(make('I')).map((v) => v.split(':')[0])).toEqual(withI)
      const h = both(make('H'))
      expect(h.map((v) => v.split(':')[0])).toEqual(['unsupportedCesr', 'unsupportedCesr'])
      for (const v of h)
        expect(v).toBe(
          "unsupportedCesr: Keyring can't verify this (unsupported: digest code H in a credential or TEL SAID)"
        )
    }
  )

  it.each([
    ['kel-mal-root.cesr', 'mal-root'],
    ['kel-sam.cesr', 'sam'],
  ])(
    'a KEL that reads but does not replay, and is NOT on the chain checked (%s), refuses both entry points as kelNotReplaying (control: the same material without it is valid)',
    (file, aid) => {
      setStateVerifiedApproversEnabled(true)
      const kelNames = files.filter((f) => /^kel-.*\.cesr$/.test(f)).sort()
      const at = kelNames.indexOf(file)
      const t = text(file)
      // One character of its first controller signature changed: the stream still reads, the KEL no longer replays.
      const i = t.indexOf('-KAW') + 4 + 40
      const edited = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1)
      expect(readKelStream(new TextEncoder().encode(edited)).ok).toBe(true)
      const run = (m: ChainMaterial) => [
        verifyGuardian(m, said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options),
        verifySocialAuthorization(m, said('S2-social'), { ward: aids.sam }, options),
      ]
      const withEdited = material()
      withEdited.kels[at] = new TextEncoder().encode(edited)
      const without = material()
      without.kels.splice(at, 1)
      expect(run(material()).map(verdict)).toEqual(['valid', 'valid'])
      // The control: the KEL is not on either chain, so without it both are still valid; a fix that refuses
      // everything, or that needs this KEL, fails here.
      expect(run(without).map(verdict)).toEqual(['valid', 'valid'])
      // Its own outcome, carrying the prefix the KEL claims and nothing of its contents.
      const refused = run(withEdited)
      expect(refused.map(verdict)).toEqual(['kelNotReplaying', 'kelNotReplaying'])
      const firstSaid = (JSON.parse(t.slice(0, t.indexOf('-KAW'))) as { d: string }).d
      for (const r of refused) {
        expect(r).toEqual({ ok: false, reason: 'kelNotReplaying', prefix: aids[aid], detail: expect.any(String) })
        expect((r as { detail: string }).detail).not.toContain(firstSaid)
        expect((r as { detail: string }).detail).not.toContain(t.slice(i - 10, i + 10))
      }
    }
  )
  // A one-event KEL made here with a fresh P-256 key, correctly SAIDed and signed, so the only thing wrong with it is
  // the KERI feature under test. No K0 fixture uses one, which is why the stream is generated.
  function madeKel(over: {
    t?: string
    kt?: string | string[]
    bt?: string
    b?: string[]
    di?: string
    ed25519D?: true
    saidCode?: string
    n?: string[]
  }): Uint8Array {
    const enc = new TextEncoder()
    const sk = over.ed25519D ? ed25519.utils.randomSecretKey() : p256.utils.randomSecretKey()
    const key = over.ed25519D
      ? 'D' + b64Encode(new Uint8Array([0, ...ed25519.getPublicKey(sk)])).slice(1)
      : '1AAJ' + b64Encode(new Uint8Array([0, 0, 0, ...p256.getPublicKey(sk, true)])).slice(4)
    const ilk = over.t ?? 'icp'
    const n = over.n ?? []
    const ked: Record<string, unknown> = { v: 'KERICAACAAJSON' + 'AAAA' + '.', t: ilk, d: DUMMY, i: DUMMY, s: '0' }
    Object.assign(ked, {
      kt: over.kt ?? '1',
      k: [key],
      nt: String(n.length),
      n,
      bt: over.bt ?? '0',
      b: over.b ?? [],
      c: [],
      a: [],
    })
    if (over.di) ked.di = over.di
    const size = JSON.stringify(ked).length
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    ked.v = 'KERICAACAAJSON' + [18, 12, 6, 0].map((sh) => b64[(size >> sh) & 63]).join('') + '.'
    const dummied = JSON.stringify(ked)
    // icp: the prefix is self-addressing (SHA2-256, as keripy's Habery makes it); dip: any prefix, here a fixed one.
    const pre = ilk === 'icp' ? digest('I', enc.encode(dummied)) : 'I' + 'Q'.repeat(43)
    const computed = digest(
      'E',
      enc.encode(ilk === 'icp' ? dummied : dummied.replace(`"i":"${DUMMY}"`, `"i":"${pre}"`))
    )
    // saidCode: the same digest under a code this package lacks (it cannot tell; it must refuse before using it).
    const said = over.saidCode ? over.saidCode + computed.slice(1) : computed
    const body = dummied.replace(`"d":"${DUMMY}"`, `"d":"${said}"`).replace(`"i":"${DUMMY}"`, `"i":"${pre}"`)
    const msg = enc.encode(body)
    const sig = over.ed25519D ? ed25519.sign(msg, sk) : p256.sign(msg, sk, { prehash: true, lowS: false })
    const sigQb64 = (over.ed25519D ? 'AA' : 'EA') + b64Encode(new Uint8Array([0, 0, ...sig])).slice(2)
    return enc.encode(body + '-KAW' + sigQb64)
  }

  it.each([
    [
      'witnesses (bt 1)',
      { bt: '1', b: ['BO06-duiao9wxLLhTOOfl03Lavbr30WUqcc9LgzImLtd'] },
      /witnesses \(bt 1; receipts are not read\)\)$/,
    ],
    ['a weighted threshold', { kt: ['1/2', '1/2'] }, /signing threshold 1\/2,1\/2\)$/],
    ['a delegated inception (dip)', { t: 'dip', di: 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6' }, /: ilk dip\)$/],
    ['a transferable Ed25519 key (D)', { ed25519D: true }, /: key code D\)$/],
    ['a SAID under another digest code (H)', { saidCode: 'H' }, /: digest code H\)$/],
    ['a next-key digest under another digest code (H)', { n: ['H' + 'A'.repeat(43)] }, /: digest code H\)$/],
  ])(
    'a KEL using a KERI feature this package does not verify (%s) refuses both entry points as unsupportedCesr, never kelNotReplaying (control: the same KEL without it is valid)',
    (_, feature, detail) => {
      setStateVerifiedApproversEnabled(true)
      const run = (extra: Uint8Array) => {
        const m = material()
        m.kels.push(extra)
        return [
          verifyGuardian(m, said('G-ok'), { holder: aids.jordan, ward: aids.sam }, options),
          verifySocialAuthorization(m, said('S2-social'), { ward: aids.sam }, options),
        ]
      }
      // The control: the same generator without the feature makes a KEL that replays, so the material stays valid.
      expect(replayKel(digest, madeKel({})).ok).toBe(true)
      expect(run(madeKel({})).map(verdict)).toEqual(['valid', 'valid'])
      const refused = run(madeKel(feature as Parameters<typeof madeKel>[0]))
      expect(refused.map(verdict)).toEqual(['unsupportedCesr', 'unsupportedCesr'])
      for (const r of refused) {
        expect((r as { detail: string }).detail).toMatch(/^Keyring can't verify this \(unsupported: sn 0 /)
        expect((r as { detail: string }).detail).toMatch(detail)
      }
    }
  )
})
