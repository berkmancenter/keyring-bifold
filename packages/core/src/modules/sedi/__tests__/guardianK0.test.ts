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
import { digest, replayKel, type Replay } from '../guardian/kel'

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
})
