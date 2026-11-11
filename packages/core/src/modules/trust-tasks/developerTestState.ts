/**
 * The Developer actions for a tester build ("Hold the test Guardian card (K0)", "I'm the test ward (K0)", and the
 * one-tap "Set up the SEDI demo" / "Turn off the SEDI demo"), as the package exports them. The card and the ward live
 * in guardianEvidence.ts; this reaches it lazily, so importing the package index does not load the Guardian verifier
 * into every suite and every start-up.
 *
 * @module trust-tasks/developerTestState
 */
import type { Agent } from '@credo-ts/core'

import type { TestStateActionResult } from './guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from './module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from './module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from './module/trustedApproversFlag'
import { isTrustTestStateEnabled, setTrustTestStateEnabled } from './module/trustTestStateFlag'

export type { TestStateActionResult }

function guardianEvidence(): typeof import('./guardianEvidence') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./guardianEvidence')
}

/** See guardianEvidence's holdK0TestGuardianCard: nothing unless "Trust the test state (K0)" holds. */
export function holdK0TestGuardianCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().holdK0TestGuardianCard(agent)
}

/** See guardianEvidence's becomeK0TestWard: nothing unless "Trust the test state (K0)" holds. */
export function becomeK0TestWard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().becomeK0TestWard(agent)
}

/** What "Set up the SEDI demo" did: all on, or nothing because a remote off (or the SEDI/KERI umbrella) is set. */
export type SediDemoSetupResult = 'done' | 'remoteOff'

/**
 * Developer action "Set up the SEDI demo", in one tap on either phone: trusted approvers, state-verified approvers and
 * "Trust the test state (K0)" on, the K0 Guardian card held (for the approver's side) and the K0 ward set (for the
 * person's side). With any remote off or the SEDI/KERI umbrella set, it does nothing at all and says so: no switch is
 * turned on, nothing is kept. The app keeps the three switches as saved settings itself, as it does when they are
 * turned on one by one.
 */
export async function setUpSediDemo(agent: Pick<Agent, 'genericRecords'>): Promise<SediDemoSetupResult> {
  if (SEDI_KERI_REMOTE_OFF.off || TRUSTED_APPROVERS_REMOTE_OFF.off || STATE_VERIFIED_APPROVERS_REMOTE_OFF.off)
    return 'remoteOff'
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(true)
  // TODO(state card): also turn on the holder's state-card switch (setStateCardEnabled, sedi/holder/stateCardFlag.ts,
  // bifold feat/sedi-holder-card) once it is on this branch; its row in developerTestState.test.ts is a test.todo.
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  const held = await holdK0TestGuardianCard(agent)
  const ward = await becomeK0TestWard(agent)
  return held === 'done' && ward === 'done' ? 'done' : 'remoteOff'
}

/**
 * Developer action "Turn off the SEDI demo": the three switches off. Deletes nothing: the card and the ward stay kept,
 * unused while the switches are off, so turning the demo on again needs no new card.
 */
export function turnOffSediDemo(): void {
  // TODO(state card): also turn off setStateCardEnabled once sedi/holder/stateCardFlag.ts is on this branch.
  setTrustTestStateEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustedApproversEnabled(false)
}
