/**
 * sharedConnectCeremony — the document-level pieces of the shared-connect
 * sequence that need no connection (plan WP7): the challenge-shaped
 * `propose.id`, the `ceremony` member every step carries, and the proof.
 *
 * Six documents travel (the plan's table): 1 `propose` (scanner), 2
 * `propose#response` (inviter), 3 `issue` (inviter), 4 `issue#response`
 * receipt (scanner), 5 `issue` (scanner), 6 `issue#response` receipt (inviter).
 * All carry `threadId` equal to the `propose` id and a `ceremony` member whose
 * `enactment` is the link's `_id`; all are signed. `issuer` and `recipient`
 * are the encounter VIDs, in band.
 *
 * Pure apart from {@link signSharedConnectDocument}, which asks the agent's
 * KMS for the signature. No `definition` or `definitionDigest` is sent until the
 * definition is published (plan D7).
 *
 * @module trust-tasks/module/sharedConnectCeremony
 */

import type { Agent } from '@credo-ts/core'

import { signDocumentProof } from '../documentProof'

import { SHARED_CONNECT_PROOF_SIGNER } from './sharedConnectDecisions'

/** The six steps, numbered as in the plan's table. */
export type SharedConnectStep = 1 | 2 | 3 | 4 | 5 | 6

/**
 * What we send: `{enactment, step}` and nothing else. The envelope schema
 * (SPEC section 4.11.1) requires `definitionDigest` whenever `definition` is
 * present, and the definition is not published, so neither is sent. The
 * `{ceremony, challenges}` binding is not a member of `ceremony` (which is
 * closed); it belongs in the credential.
 */
export interface CeremonyMember {
  enactment: string
  step: SharedConnectStep
}

/** The members the envelope schema's closed `ceremony` object allows. */
const CEREMONY_KEYS = new Set([
  'enactment',
  'step',
  'definition',
  'definitionDigest',
  'parentEnactment',
  'round',
  'terminal',
  'prev',
])

/**
 * Whether an inbound `ceremony` member has the shape the registry schema
 * accepts: an object with only the schema's members, a non-empty `enactment`
 * string, a `step`, and a `definitionDigest` whenever `definition` is present.
 */
export function isWellFormedCeremony(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const member = value as Record<string, unknown>
  if (Object.keys(member).some((key) => !CEREMONY_KEYS.has(key))) return false
  if (typeof member.enactment !== 'string' || member.enactment.length === 0) return false
  if (typeof member.step !== 'number' && typeof member.step !== 'string') return false
  if (member.definition !== undefined && typeof member.definition !== 'string') return false
  if (member.definitionDigest !== undefined && typeof member.definitionDigest !== 'string') return false
  if (member.definition !== undefined && member.definitionDigest === undefined) return false
  return true
}

const B64URL = /^[A-Za-z0-9_-]{22}$/

/** A 16-byte challenge as 22 characters of unpadded base64url: what `propose.id` is in this ceremony. */
export function newProposeId(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(16)
  if (bytes.length !== 16) throw new Error('newProposeId needs 16 random bytes')
  return Buffer.from(bytes).toString('base64url')
}

export const isChallengeShaped = (value: unknown): value is string => typeof value === 'string' && B64URL.test(value)

export function ceremonyMember(enactment: string, step: SharedConnectStep): CeremonyMember {
  return { enactment, step }
}

export interface SharedConnectDocumentInput {
  /** The document's own id: the propose id for step 1, a fresh id for the rest. */
  id: string
  /** The type URI, e.g. `propose.TYPE_URI`, or that plus `#response`. */
  type: string
  /** The propose id, on every document. */
  threadId: string
  issuer: string
  recipient: string
  /** The link's `_id`. */
  enactment: string
  step: SharedConnectStep
  payload: Record<string, unknown>
  issuedAt?: string
}

/** An unsigned document with its thread and `ceremony` member in place. */
export function buildSharedConnectDocument(input: SharedConnectDocumentInput): Record<string, unknown> {
  return {
    id: input.id,
    type: input.type,
    threadId: input.threadId,
    issuer: input.issuer,
    recipient: input.recipient,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    ceremony: ceremonyMember(input.enactment, input.step),
    payload: input.payload,
  }
}

/** Why an inbound document does not belong to this encounter, or undefined when it does. */
export function encounterMismatch(
  document: Record<string, unknown>,
  expected: { enactment: string; threadId: string; myVid: string; theirVid: string }
): string | undefined {
  const ceremony = document.ceremony as Partial<CeremonyMember> | undefined
  if (!ceremony) return 'enactment'
  if (!isWellFormedCeremony(ceremony)) return 'ceremony'
  if (ceremony.enactment !== expected.enactment) return 'enactment'
  if (document.threadId !== expected.threadId) return 'thread'
  if (document.recipient !== expected.myVid) return 'recipient'
  if (document.issuer !== expected.theirVid) return 'issuer'
  return undefined
}

/**
 * The DID that signs a document's proof, per decision 3: the issuer VID by
 * default. `relationshipDid` is used only when the decision is switched.
 */
export function proofSignerFor(document: Record<string, unknown>, relationshipDid?: string): string {
  if (SHARED_CONNECT_PROOF_SIGNER === 'relationship-did') {
    if (!relationshipDid) throw new Error('the relationship DID signs this document and none was given')
    return relationshipDid
  }
  return String(document.issuer)
}

/**
 * The DIDs whose proof an inbound document may carry: either key is accepted
 * inbound (plan D3), the issuer VID or the relationship DID if one is known.
 */
export function acceptableProofSigners(document: Record<string, unknown>, relationshipDid?: string): string[] {
  return [String(document.issuer), ...(relationshipDid ? [relationshipDid] : [])]
}

/** Sign a document (every step carries a proof, receipts included). Returns a new document with its `proof` (whole-second timestamps, as a verifier rebuilds them). */
export async function signSharedConnectDocument(
  agent: Agent,
  document: Record<string, unknown>,
  relationshipDid?: string
): Promise<Record<string, unknown>> {
  return signDocumentProof(agent, document, proofSignerFor(document, relationshipDid))
}
