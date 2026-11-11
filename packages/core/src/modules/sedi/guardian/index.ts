/**
 * The Guardian check's entry points (trusted-approver plan, stage 2, S1/S2), behind the state-verified approvers switch
 * (isStateVerifiedApproversEnabled, with STATE_VERIFIED_APPROVERS_REMOTE_OFF and SEDI_KERI_REMOTE_OFF). Off, they
 * refuse with `switchedOff` and read nothing.
 *
 * Material is the raw chain a guardian's phone would present: every KEL stream involved, every registry (rip and its
 * updates), and every credential's proof (ACDC text followed by its state disclosure). How that material travels from
 * the guardian's phone is not built yet.
 *
 * @module sedi/guardian
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'

import { guardianIn, socialIn, type ChainContext, type GuardianResult, type SocialResult, type TelInput } from './chain'
import { digest, replayKel, type Replay } from './kel'

export { SEDI_SCHEMAS, type RefusalReason } from './chain'

export interface ChainMaterial {
  kels: Uint8Array[]
  tels: TelInput[]
  creds: string[]
}

export interface CheckOptions {
  /** The State roots this phone trusts (AIDs). */
  trustedRoots: string[]
  now?: Date
}

type Built =
  | { ok: true; ctx: ChainContext }
  | { ok: false; reason: 'unsupportedCesr' | 'malformedCesr'; detail: string }

function build(material: ChainMaterial, options: CheckOptions): Built {
  const kels = new Map<string, Replay>()
  for (const bytes of material.kels) {
    const r = replayKel(digest, bytes)
    // A stream this package cannot read is refused outright: never treated as if that KEL were absent.
    if (!r.ok && r.cesr) return { ok: false, reason: r.cesr, detail: r.reason }
    if (r.ok) kels.set(r.state.pre, r)
    else if (r.state) kels.set(r.state.pre, r)
  }
  const tels = new Map<string, TelInput>()
  for (const t of material.tels) tels.set((JSON.parse(t.ripText) as { d: string }).d, t)
  const creds = new Map<string, string>()
  for (const text of material.creds) {
    const end = text.lastIndexOf('}')
    const said = (JSON.parse(text.slice(0, end + 1)) as { d: string }).d
    creds.set(said, text)
  }
  return {
    ok: true,
    ctx: { digest, kels, tels, creds, trustedRoots: new Set(options.trustedRoots), now: options.now ?? new Date() },
  }
}

const switchedOff = {
  ok: false as const,
  reason: 'switchedOff' as const,
  detail: 'state-verified approvers are switched off',
}

type Unreadable = Exclude<Built, { ok: true }>

/**
 * The one place a verdict leaves this module: both entry points go through it, in this order. The switch; then every
 * KEL stream through the CESR reader, where any stream it cannot read refuses the whole check (`unsupportedCesr` or
 * `malformedCesr`) before a chain check runs; then the check itself, whose `{ ok: true }` is the only way "valid" comes
 * back. The fail-closed row in guardianK0.test.ts runs every unreadable-stream case through both entry points.
 */
function decide<R>(
  material: ChainMaterial,
  options: CheckOptions,
  check: (ctx: ChainContext) => R
): R | typeof switchedOff | Unreadable {
  if (!isStateVerifiedApproversEnabled()) return switchedOff
  const built = build(material, options)
  if (!built.ok) return built
  return check(built.ctx)
}

/** A Guardian credential `guardianSaid`, issued to `holder` and naming `ward`, chained to a trusted State root. */
export function verifyGuardian(
  material: ChainMaterial,
  guardianSaid: string,
  expect: { holder: string; ward: string },
  options: CheckOptions
): GuardianResult | typeof switchedOff | Unreadable {
  return decide(material, options, (ctx) =>
    guardianIn(ctx, guardianSaid, { guardian: expect.holder, ward: expect.ward })
  )
}

/** A Social Authorization `socialSaid` issued to `ward`, chained to its issuer's Guardian credential (S2). */
export function verifySocialAuthorization(
  material: ChainMaterial,
  socialSaid: string,
  expect: { ward: string },
  options: CheckOptions
): SocialResult | typeof switchedOff | Unreadable {
  return decide(material, options, (ctx) => socialIn(ctx, socialSaid, expect))
}
