/**
 * `approver/guardian-offer/0.1`: a guardian's phone offers to be a person's trusted approver, over the VRC relationship
 * they already have, with its state Guardian card attached (docs/plans/keri-holder-plan/2026-11-16-al.md §3, A+B).
 *
 * The person's phone checks the card against its own ward before anything is shown; the person decides. A yes goes back
 * as an ordinary `approver/role-offer/0.1` from the person's phone (their agent, the actions they kept), which the
 * guardian's phone answers yes to without asking again, within what it offered (guardianOffer.ts). So the rule is
 * still written by the person's own phone, as today, and the guardian writes nothing to the person's agent.
 *
 * The only answer this type carries is "couldn't check" (the card failed a check that will not come right by waiting),
 * and never why: which check failed would tell the sender whether this phone still names them as guardian, so an offer
 * could be sent just to find out (Alberto, 2026-11-17, option b). A no is never sent, so the guardian's phone cannot
 * tell a no from a lapse.
 *
 * Minted under the private authority the other approver types use (approverRoleSpec.ts). Both legs are signed under the
 * sender's relationship DID and verified under the one the relationship established.
 *
 * @module trust-tasks/guardianOfferSpec
 */
import { GUARDIAN_EVIDENCE_V2_SPEC, ROLE_ACTIONS, type GuardianEvidencePayload } from './approverRoleSpec'

export const GUARDIAN_OFFER_TYPE_URI = 'https://keyring.appliedtechnologylab.org/spec/approver/guardian-offer/0.1'
export const GUARDIAN_OFFER_RESPONSE_TYPE_URI = `${GUARDIAN_OFFER_TYPE_URI}#response`

/** The card as a guardian-evidence 0.2 payload carries it, without the agent and approver a later yes names. */
export type GuardianOfferCard = Pick<
  GuardianEvidencePayload,
  'guardianSaid' | 'holder' | 'kels' | 'tels' | 'creds' | 'stateHost' | 'social'
>

/** The offer: the actions the guardian offers to approve, a challenge, and the card. */
export interface GuardianOfferPayload extends GuardianOfferCard {
  actions: (typeof ROLE_ACTIONS)[number][]
  /** base64url, fresh for this offer. */
  challenge: string
  offeredAt: string
}

/**
 * Why a card could not be checked, kept on the person's phone only (its record and log), never sent:
 * - `notThisWard`: the card names another ward than the one this phone checks against (or none is set here);
 * - `notInForce`: revoked, expired, not issued, or its status is not current;
 * - `notTrusted`: a state this build does not trust, or a host it refused;
 * - `broken`: anything else the chain fails on.
 */
export const UNVERIFIABLE_GROUPS = ['notThisWard', 'notInForce', 'notTrusted', 'broken'] as const
export type UnverifiableGroup = (typeof UNVERIFIABLE_GROUPS)[number]

/** The one answer: the card could not be checked, and nothing about why. Carries the offer's challenge back. */
export interface GuardianOfferResponsePayload {
  decision: 'unverifiable'
  challenge: string
  respondedAt: string
}

const CHALLENGE_PATTERN = '^[A-Za-z0-9_-]{22,}$'
const CARD = GUARDIAN_EVIDENCE_V2_SPEC.payloadSchema.properties

export const GUARDIAN_OFFER_SPEC = {
  typeUri: GUARDIAN_OFFER_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: GUARDIAN_OFFER_TYPE_URI,
    title: 'Approver Guardian Offer — payload',
    description:
      "A guardian offers, over an established VRC relationship, to approve the listed actions on the person's agent, with the state Guardian credential chain naming the person as ward, for the person's phone to check.",
    type: 'object',
    additionalProperties: false,
    required: ['actions', 'challenge', 'guardianSaid', 'holder', 'kels', 'tels', 'creds', 'offeredAt'],
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: [...ROLE_ACTIONS] },
      },
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
      guardianSaid: CARD.guardianSaid,
      holder: CARD.holder,
      kels: CARD.kels,
      tels: CARD.tels,
      creds: CARD.creds,
      stateHost: CARD.stateHost,
      social: CARD.social,
      offeredAt: { type: 'string', format: 'date-time' },
    },
  },
} as const

export const GUARDIAN_OFFER_RESPONSE_SPEC = {
  typeUri: GUARDIAN_OFFER_RESPONSE_TYPE_URI,
  isBearer: false,
  isProofRequired: true,
  isRecipientRequired: true,
  // No $id: a fragment-bearing $id ("…#response") is invalid to ajv (witnessShareSpec.ts).
  payloadSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Approver Guardian Offer — response payload',
    description: "The person's phone could not check the guardian's card. It says nothing about why.",
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'challenge', 'respondedAt'],
    properties: {
      decision: { type: 'string', enum: ['unverifiable'] },
      challenge: { type: 'string', pattern: CHALLENGE_PATTERN },
      respondedAt: { type: 'string', format: 'date-time' },
    },
  },
} as const
