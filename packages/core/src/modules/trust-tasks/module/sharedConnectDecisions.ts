/**
 * The shared-connect decisions that belong to Alberto (docs/plans/
 * relationship-over-tsp-plan.md §8), each taken here at the plan's recommended
 * default and kept in this one file so that changing one is a one-line edit.
 * Nothing below is agreed; the pull request lists each as an assumption.
 *
 * @module trust-tasks/module/sharedConnectDecisions
 */

import type { VrcProfile } from '../../vrc/vrc-manager'

/**
 * Decision 2, the TSP revision Keyring packs on this path: 1.0 (Alberto, PR
 * #853), the codec's `'v1'`. Sent on every frame, the XRFI included, because
 * the codec packs Rev 3 unless told `'v1'`. Inbound frames of 1.0 are read.
 */
export const SHARED_CONNECT_TSP_REVISION = '1.0' as const

/**
 * Decision 3, the key that signs each document's proof. Default
 * `issuer-vid`: the encounter VID, which matches the TSP sender, with either
 * key accepted inbound. The alternative, `relationship-did`, is what the
 * connection ceremony signs with today (`ceremony.ts` signDocumentProof).
 */
export const SHARED_CONNECT_PROOF_SIGNER: 'issuer-vid' | 'relationship-did' = 'issuer-vid'

/**
 * Decision 4, the credential profile toward non-Keyring peers, selected by
 * path rather than by the peer's RCE announcement (plan D4). Default: VCDM
 * 2.0, Data Integrity, `eddsa-jcs-2022`, no `validUntil`, no hardware
 * `evidence` (smaller frames toward RLTP). Applied by `sharedConnectCredential`.
 */
export const SHARED_CONNECT_VRC_PROFILE: VrcProfile = {
  vc20: true,
  dataIntegrity: true,
  suite: 'eddsa-jcs-2022',
  validUntil: false,
  evidence: false,
}

/**
 * Decision 1, whether the flow uses `propose/0.1` and `issue/0.1` unchanged
 * with a `ceremony` member on every step: yes (Alberto). The definition is
 * not published, so the member carries `{enactment, step}` only: `definition`
 * without `definitionDigest` fails the envelope schema (plan D7). Not sent
 * today; kept as the name to publish.
 */
export const SHARED_CONNECT_CEREMONY_DEFINITION = 'https://trusttasks.org/ceremony/shared-connect/0.1'

/**
 * Decision 5, who owns the flow on the reader side (VTI-LNK-046): default is
 * core, behind the developer flag, rather than a demo profile registered
 * through `registerTrustTask`.
 */
export const SHARED_CONNECT_FLOW_OWNER: 'core' | 'demo-profile' = 'core'

/**
 * Timing, in milliseconds (plan WP10). The wait for a `propose#response` or a
 * receipt, how often the document is re-sent in that time, and the grace after
 * `_exp` for which an already-started encounter stays open.
 */
export const SHARED_CONNECT_ANSWER_WAIT_MS = 2 * 60 * 1000
export const SHARED_CONNECT_SEND_ATTEMPTS = 2
export const SHARED_CONNECT_EXP_GRACE_MS = 5 * 60 * 1000
