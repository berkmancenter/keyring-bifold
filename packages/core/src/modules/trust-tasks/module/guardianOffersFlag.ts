/**
 * The switch for guardian offers (guardianOffer.ts; docs/plans/keri-holder-plan/2026-11-16-al.md §3): a guardian's
 * phone offers to be a person's approver, with its state Guardian card, and the person's phone checks the card and
 * asks the person. Off unless the app turns it on from its developer settings at start-up, like
 * setTrustedApproversEnabled (trustedApproversFlag.ts).
 *
 * It counts only with trusted approvers and state-verified approvers both on as well ({@link isGuardianOffersOn}):
 * an offer is a trusted-approver offer that carries a Guardian card. With it off, nothing is offered, no offer is sent,
 * and one that arrives is dropped unread (and logged).
 *
 * A release turns it off for everyone with {@link GUARDIAN_OFFERS_REMOTE_OFF}, or every SEDI/KERI feature at once with
 * SEDI_KERI_REMOTE_OFF; either beats a saved "on". Neither turns it on.
 *
 * @module trust-tasks/module/guardianOffersFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'
import { isStateVerifiedApproversEnabled } from './stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from './trustedApproversFlag'

/** Set to true in a release to turn guardian offers off for everyone, whatever was saved. */
export const GUARDIAN_OFFERS_REMOTE_OFF: { off: boolean } = { off: false }

let guardianOffersEnabled = false

/** Turn guardian offers on or off (developer setting). */
export function setGuardianOffersEnabled(enabled: boolean): void {
  guardianOffersEnabled = enabled
}

/** This switch alone: on, and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isGuardianOffersEnabled(): boolean {
  return guardianOffersEnabled && !GUARDIAN_OFFERS_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}

/** What every guardian-offer path checks: this switch, trusted approvers and state-verified approvers, all on. */
export function isGuardianOffersOn(): boolean {
  return isGuardianOffersEnabled() && isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()
}
