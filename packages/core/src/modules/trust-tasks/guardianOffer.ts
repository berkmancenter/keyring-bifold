/**
 * Guardian offers (docs/plans/keri-holder-plan/2026-11-16-al.md §3, A+B): a guardian's phone offers to be a person's
 * trusted approver, with its state Guardian card; the person's phone checks the card and asks the person.
 *
 * Who decides, and who writes, stay as in today's ask (approverRole.ts):
 * - The guardian proposes the actions. "Changes who approves" is always among them, as in every ask (ApproverAskRow's
 *   LOCKED): a person can untick the others, never add one.
 * - The person's phone checks the card against its own ward BEFORE anything is shown. A card that fails a check that
 *   waiting will not fix is never shown, and the guardian is told "couldn't check" and in which group. A state that
 *   could not be reached is checked again later, unseen.
 * - A yes goes back as an ordinary role offer from the person's phone (their agent, the actions they kept). The
 *   guardian's phone answers yes to it without asking again, within what it offered, as the DID it named when the
 *   guardian sent the offer (an owner act there). The person's phone then writes the rule on its own agent, as today.
 * - A no is never sent. The guardian's phone cannot tell a no from a lapse: both read "didn't accept".
 *
 * Nothing here runs unless guardian offers, trusted approvers and state-verified approvers are all on
 * ({@link isGuardianOffersOn}).
 *
 * @module trust-tasks/guardianOffer
 */
import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { sameChallenge } from '../vrc/contacts/continuityCrypto'
import { resolveContactDisplayInfo } from '../vrc/utils/rcardDisplayUtils'

import {
  OFFER_OPEN_FOR,
  offerApproverRole,
  proofUnder,
  relationshipOn,
  type OfferResult,
  type RoleAction,
} from './approverRole'
import { GUARDIAN_EVIDENCE_MAX_BYTES, ROLE_ACTIONS } from './approverRoleSpec'
import { signDocumentProof } from './documentProof'
import {
  cardWithItsExtras,
  checkGuardianEvidenceResolving,
  evidenceBytes,
  evidenceOf,
  heldGuardianEvidence,
  phoneWardsOf,
  rootAidOf,
  setCardConsent,
  wardToCheck,
  type GuardianEvidence,
  type GuardianVerdict,
} from './guardianEvidence'
import {
  GUARDIAN_OFFER_RESPONSE_SPEC,
  GUARDIAN_OFFER_SPEC,
  GUARDIAN_OFFER_TYPE_URI,
  type GuardianOfferPayload,
  type GuardianOfferResponsePayload,
  type UnverifiableGroup,
} from './guardianOfferSpec'
import { isGuardianOffersOn } from './module/guardianOffersFlag'
import type { InboundContext } from './registry'
import { respondWith, type TrustTasksService } from './services/TrustTasksService'
import { checkSocialAuthorization, splitSocial, type SocialVerdict } from './socialAuthorization'

const LOG_PREFIX = '[TrustTasks:GuardianOffer]'

export const GUARDIAN_OFFER_SENT = 'keyring.approver-guardian-offer-sent'
export const GUARDIAN_OFFER_PROMPT = 'keyring.approver-guardian-offer-prompt'

/** Always offered, never untickable: every ask covers who approves (ApproverAskRow's LOCKED). */
export const ALWAYS_OFFERED: RoleAction = 'changeApprovers'

const CHALLENGE_BYTES = 32
const DID = /^did:[a-z0-9]+:.+/
const OFF = 'guardian offers are switched off on this phone (Settings › Developer)'

const warn = (agent: Pick<Agent, 'config'>, message: string) => agent.config?.logger?.warn(`${LOG_PREFIX} ${message}`)
const dropped = (agent: Pick<Agent, 'config'>, what: string, connectionId: string, why: string) =>
  warn(agent, `${what} on connection ${connectionId} not taken: ${why}`)
const lapsed = (at: string, now = Date.now()) => !(now - Date.parse(at) < OFFER_OPEN_FOR)

/** `offer`/`cleared`: the person's side (an offer to show, or one answered); `sent`: the guardian's side changed. */
export const guardianOfferEvents = new EventEmitter()

// ---------------------------------------------------------------------------------------------------------------
// The guardian's side

/** An offer this phone sent, one per contact; a newer offer replaces it. */
export interface GuardianOfferSent {
  connectionId: string
  /** The contact's name, from the relationship. */
  ward: string
  actions: RoleAction[]
  challenge: string
  threadId: string
  /** The DID this phone approves as, named when the guardian sent the offer; the yes to their ask names it. */
  approverDid: string
  sentAt: string
  state: 'open' | 'accepted' | 'unverifiable'
  /** With `unverifiable`: why, in the group the person's phone said. */
  group?: UnverifiableGroup
  answeredAt?: string
}

/** What the guardian sees: still waiting, taken up, never taken up in time (or declined), or the card not checked. */
export type GuardianOfferStatus = 'waiting' | 'accepted' | 'notAccepted' | 'unverifiable'

export const guardianOfferStatus = (sent: GuardianOfferSent, now = Date.now()): GuardianOfferStatus =>
  sent.state === 'open' ? (lapsed(sent.sentAt, now) ? 'notAccepted' : 'waiting') : sent.state

export type GuardianOfferResult = 'sent' | 'off' | 'none' | 'tooLarge' | 'noRelationship'

/**
 * Offer to approve `actions` for the contact on `connectionId`, with the Guardian card this phone holds, as
 * `approverDid` (the caller has it from the owner act: vtaAgent.acceptAsApprover). "Changes who approves" is added if
 * missing. Sending the card with the offer is the yes to sending it to this contact, so it is kept as that answer
 * (guardianEvidence.setCardConsent) and the card goes again after the yes without asking. Nothing goes with any of the
 * switches off, no card held, or over the cap.
 */
export async function offerAsGuardian(
  agent: Agent,
  connectionId: string,
  actions: readonly RoleAction[],
  approverDid: string
): Promise<GuardianOfferResult> {
  if (!isGuardianOffersOn()) return 'off'
  if (!DID.test(approverDid)) throw new Error(`${LOG_PREFIX} the approver is not a DID: ${approverDid}`)
  const chosen = [...new Set([...actions, ALWAYS_OFFERED])]
  for (const action of chosen)
    if (!ROLE_ACTIONS.includes(action)) throw new Error(`${LOG_PREFIX} unknown action: ${String(action)}`)

  const held = await heldGuardianEvidence(agent)
  if (!held) return 'none'
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'
  const { card } = await cardWithItsExtras(agent, held, connectionId)
  if (evidenceBytes(card) > GUARDIAN_EVIDENCE_MAX_BYTES) {
    warn(agent, `the card is over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes; no offer sent on ${connectionId}`)
    return 'tooLarge'
  }

  const challenge = TypedArrayEncoder.toBase64Url(agent.kms.randomBytes({ length: CHALLENGE_BYTES }))
  const id = utils.uuid()
  const sentAt = new Date().toISOString()
  const payload: GuardianOfferPayload = { actions: chosen, challenge, ...card, offeredAt: sentAt }
  const document: Record<string, unknown> = {
    id,
    type: GUARDIAN_OFFER_TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: sentAt,
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)

  await setCardConsent(agent, connectionId, 'yes', rootAidOf(held))
  const credentials = await agent.w3cCredentials.getAll()
  const sent: GuardianOfferSent = {
    connectionId,
    ward: resolveContactDisplayInfo(credentials, relationship.counterpartyRelationshipDid as string).name ?? '',
    actions: chosen,
    challenge,
    threadId: id,
    approverDid,
    sentAt,
    state: 'open',
  }
  await keepOn(agent, GUARDIAN_OFFER_SENT, connectionId, sent)
  agent.config?.logger?.info(`${LOG_PREFIX} guardian offer sent on connection ${connectionId}`)
  guardianOfferEvents.emit('sent', { connectionId })
  return 'sent'
}

/** Every offer this phone sent, newest first. */
export async function guardianOffersSent(agent: Pick<Agent, 'genericRecords'>): Promise<GuardianOfferSent[]> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_SENT })) ?? []
  return records
    .map((record) => record.content as unknown as GuardianOfferSent)
    .filter((sent) => !!sent?.connectionId)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
}

/**
 * A role offer from the contact on `connectionId` arrived (approverRole.handleRoleOfferRequest): if it takes up this
 * phone's open offer to them, the DID to say yes as. Only within what was offered, and only while the offer is open:
 * anything else is asked about as any role offer is.
 */
export async function guardianOfferTakenUp(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string,
  actions: readonly RoleAction[]
): Promise<string | undefined> {
  if (!isGuardianOffersOn()) return undefined
  const sent = await sentOn(agent, connectionId)
  if (!sent || guardianOfferStatus(sent) !== 'waiting') return undefined
  if (actions.length === 0 || !actions.every((action) => sent.actions.includes(action))) return undefined
  return sent.approverDid
}

/** This phone said yes to the contact's ask that took up its offer: the offer is accepted. */
export async function guardianOfferAnswered(agent: Agent, connectionId: string): Promise<void> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_SENT, connectionId })) ?? []
  const sent = record?.content as unknown as GuardianOfferSent | undefined
  if (!record || !sent || sent.state !== 'open') return
  record.content = { ...sent, state: 'accepted', answeredAt: new Date().toISOString() }
  await agent.genericRecords.update(record)
  guardianOfferEvents.emit('sent', { connectionId })
}

/** The person's phone could not check the card: the offer is kept as "couldn't check", with the group it said. */
export async function handleGuardianOfferResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const what = 'an answer to my guardian offer'
  if (!isGuardianOffersOn()) return dropped(agent, what, context.connectionId, OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, what, context.connectionId, 'no relationship to check it against')
  const outcome = await service.consume(agent.context, {
    spec: GUARDIAN_OFFER_RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return dropped(agent, what, context.connectionId, `not checked (${outcome.kind})`)

  const [record] =
    (await agent.genericRecords.findAllByQuery({
      recordType: GUARDIAN_OFFER_SENT,
      connectionId: context.connectionId,
    })) ?? []
  const sent = record?.content as unknown as GuardianOfferSent | undefined
  if (!record || !sent || guardianOfferStatus(sent) !== 'waiting' || sent.threadId !== String(document.threadId ?? ''))
    return dropped(agent, what, context.connectionId, 'it answers no offer open here')
  const answer = document.payload as GuardianOfferResponsePayload
  // Refused on an empty challenge too: sameChallenge holds for two empty strings.
  if (!sent.challenge || !sameChallenge(sent.challenge, String(answer?.challenge ?? '')))
    return dropped(agent, what, context.connectionId, 'it does not carry the offer back')
  record.content = { ...sent, state: 'unverifiable', group: answer.group, answeredAt: new Date().toISOString() }
  await agent.genericRecords.update(record)
  guardianOfferEvents.emit('sent', { connectionId: context.connectionId })
}

// ---------------------------------------------------------------------------------------------------------------
// The person's side

/** An offer that arrived, one per contact; a newer offer replaces it. */
export interface GuardianOfferPrompt {
  connectionId: string
  /** The offering contact's name, from the relationship. */
  guardian: string
  actions: RoleAction[]
  challenge: string
  threadId: string
  /** The signed offer, card included: answered from, and checked again from. */
  request: Record<string, unknown>
  receivedAt: string
  /**
   * `checking`: not shown, the state could not be reached yet; `open`: the card checked, shown to the person;
   * `unverifiable`: never shown, the guardian was told; `accepted`/`declined`: the person answered.
   */
  state: 'checking' | 'open' | 'unverifiable' | 'accepted' | 'declined'
  verdict?: GuardianVerdict
  /** Only with a card carrying a Social Authorization: whether it stands. */
  social?: SocialVerdict
  group?: UnverifiableGroup
  /** With `accepted`: the actions the person kept. */
  kept?: RoleAction[]
  answeredAt?: string
}

class GuardianOfferPromptStore {
  private prompts = new Map<string, GuardianOfferPrompt>()
  set(prompt: GuardianOfferPrompt) {
    this.prompts.set(prompt.connectionId, prompt)
  }
  get(connectionId: string) {
    return this.prompts.get(connectionId)
  }
  take(connectionId: string) {
    this.prompts.delete(connectionId)
  }
  first(): GuardianOfferPrompt | undefined {
    return [...this.prompts.values()][0]
  }
  clear() {
    this.prompts.clear()
  }
}

/** The offers to show now: checked, open, not lapsed. */
export const guardianOfferPrompts = new GuardianOfferPromptStore()

/** Checking it again later fixes these; everything else refused is refused for good. */
const TRANSIENT = new Set(['stateNotResolved', 'checkFailed'])
const NOT_THIS_WARD = new Set(['wardMismatch', 'noWard'])
const NOT_IN_FORCE = new Set(['revoked', 'expired', 'notIssued', 'statusNotCurrent'])
const NOT_TRUSTED = new Set(['untrustedRoot', 'stateHostRefused'])

/** The group a refusal is told to the guardian in; never the check's own detail. */
export function unverifiableGroupOf(reason: string): UnverifiableGroup {
  if (NOT_THIS_WARD.has(reason)) return 'notThisWard'
  if (NOT_IN_FORCE.has(reason)) return 'notInForce'
  if (NOT_TRUSTED.has(reason)) return 'notTrusted'
  return 'broken'
}

/**
 * A guardian offer arrives: verified under the contact's relationship DID, its card checked against this phone's ward,
 * and only then shown. Kept across a restart either way.
 */
export async function handleGuardianOffer(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const what = 'a guardian offer'
  if (!isGuardianOffersOn()) return dropped(agent, what, context.connectionId, OFF)
  const size = evidenceBytes(document?.payload as GuardianOfferPayload | undefined)
  if (size > GUARDIAN_EVIDENCE_MAX_BYTES)
    return dropped(
      agent,
      what,
      context.connectionId,
      `its card is ${size} bytes, over the ${GUARDIAN_EVIDENCE_MAX_BYTES} cap`
    )
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, what, context.connectionId, 'no relationship to check it against')
  const outcome = await service.consume(agent.context, {
    spec: GUARDIAN_OFFER_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled')
    return dropped(agent, what, context.connectionId, `not checked (${outcome.kind})`)

  const payload = document.payload as GuardianOfferPayload
  // Every ask covers who approves; an offer that does not could never be taken up (the yes would ask for more).
  if (!payload.actions.includes(ALWAYS_OFFERED))
    return dropped(agent, what, context.connectionId, `it does not offer ${ALWAYS_OFFERED}`)
  const credentials = await agent.w3cCredentials.getAll()
  const prompt: GuardianOfferPrompt = {
    connectionId: context.connectionId,
    guardian: resolveContactDisplayInfo(credentials, relationship.counterpartyRelationshipDid as string).name ?? '',
    actions: [...payload.actions],
    challenge: payload.challenge,
    threadId: String(document.threadId ?? document.id ?? ''),
    request: document,
    receivedAt: new Date().toISOString(),
    state: 'checking',
  }
  // A newer offer replaces an earlier one, shown or not.
  guardianOfferPrompts.take(context.connectionId)
  await keepOn(agent, GUARDIAN_OFFER_PROMPT, context.connectionId, prompt)
  await checkOffer(agent, prompt)
}

/**
 * The card checked now. Valid: shown. Not reached: kept, unseen, for {@link recheckGuardianOffers}. Refused for good:
 * never shown, and the guardian told in which group (if telling fails, it stays refused here all the same).
 */
async function checkOffer(agent: Agent, prompt: GuardianOfferPrompt): Promise<GuardianOfferPrompt> {
  const payload = prompt.request.payload as GuardianOfferPayload
  const said = typeof payload.social?.said === 'string' ? payload.social.said : undefined
  const split = said ? splitSocial(evidenceOf(payload), said) : undefined
  const evidence: GuardianEvidence = split ? split.card : evidenceOf(payload)
  const stateHost = typeof payload.stateHost === 'string' ? payload.stateHost : undefined
  const ward = wardToCheck(await phoneWardsOf(agent), evidence)
  const verdict = await checkGuardianEvidenceResolving(
    evidence,
    ward,
    new Date(),
    (m) => warn(agent, m),
    stateHost ? { stateHost } : {}
  )
  let next: GuardianOfferPrompt
  if (verdict.ok) {
    const social = said
      ? split?.material
        ? checkSocialAuthorization(evidence, split.material, ward, verdict, new Date(), (m) => warn(agent, m))
        : ({
            ok: false,
            reason: 'socialIncomplete',
            detail: 'the authorization named was not all there',
            checkedAt: new Date().toISOString(),
          } as SocialVerdict)
      : undefined
    next = { ...prompt, state: 'open', verdict, ...(social ? { social } : {}) }
  } else if (TRANSIENT.has(verdict.reason)) {
    next = { ...prompt, state: 'checking', verdict }
  } else {
    next = { ...prompt, state: 'unverifiable', verdict, group: unverifiableGroupOf(verdict.reason) }
  }
  await keepOn(agent, GUARDIAN_OFFER_PROMPT, prompt.connectionId, next)
  agent.config?.logger?.info(
    `${LOG_PREFIX} guardian offer on connection ${prompt.connectionId}: ${next.state}` +
      (verdict.ok ? '' : ` (${verdict.reason})`)
  )
  if (next.state === 'open') {
    guardianOfferPrompts.set(next)
    guardianOfferEvents.emit('offer', { connectionId: prompt.connectionId })
  } else if (next.state === 'unverifiable') {
    await tellUnverifiable(agent, next).catch((error: unknown) =>
      warn(agent, `could not say the card was not checked: ${(error as Error)?.message ?? error}`)
    )
  }
  return next
}

async function tellUnverifiable(agent: Agent, prompt: GuardianOfferPrompt): Promise<void> {
  const relationship = await relationshipOn(agent, prompt.connectionId)
  if (!relationship) return
  const answer: GuardianOfferResponsePayload = {
    decision: 'unverifiable',
    challenge: prompt.challenge,
    group: prompt.group as UnverifiableGroup,
    respondedAt: new Date().toISOString(),
  }
  const response = respondWith(prompt.request as never, utils.uuid(), answer as never, () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const signed = await signDocumentProof(agent, response, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'response', prompt.connectionId)
  await sendTrustTaskDocument(agent, prompt.connectionId, signed)
}

/** Offers whose state could not be reached, checked again (at start, and when the screens ask). Lapsed ones stay unseen. */
export async function recheckGuardianOffers(agent: Agent): Promise<void> {
  if (!isGuardianOffersOn()) return
  for (const prompt of await promptsKept(agent)) {
    if (prompt.state !== 'checking' || lapsed(prompt.receivedAt)) continue
    await checkOffer(agent, prompt).catch((error: unknown) =>
      warn(agent, `could not check an offer again: ${(error as Error)?.message ?? error}`)
    )
  }
}

/** At start: the open offers kept on this phone shown again, then the unchecked ones checked again. */
export async function restoreGuardianOffers(agent: Agent): Promise<void> {
  if (!isGuardianOffersOn()) return
  for (const prompt of await promptsKept(agent)) {
    if (prompt.state !== 'open' || lapsed(prompt.receivedAt) || guardianOfferPrompts.get(prompt.connectionId)) continue
    guardianOfferPrompts.set(prompt)
    guardianOfferEvents.emit('offer', { connectionId: prompt.connectionId })
  }
  await recheckGuardianOffers(agent)
}

export type GuardianOfferAcceptResult = OfferResult | 'gone'

/**
 * The person says yes, keeping `keep` of the offered actions ("changes who approves" always kept): their phone asks the
 * guardian as any ask does, for their own agent `agentDid`, and the guardian's phone says yes to it without asking
 * again. Then the person adds them as today. An action not offered cannot be kept. `gone`: the offer is no longer open
 * (answered, replaced or lapsed).
 */
export async function acceptGuardianOffer(
  agent: Agent,
  connectionId: string,
  agentDid: string,
  keep: readonly RoleAction[]
): Promise<GuardianOfferAcceptResult> {
  if (!isGuardianOffersOn()) return 'off'
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_PROMPT, connectionId })) ?? []
  const prompt = record?.content as unknown as GuardianOfferPrompt | undefined
  if (!record || !prompt || prompt.state !== 'open' || lapsed(prompt.receivedAt)) {
    guardianOfferPrompts.take(connectionId)
    return 'gone'
  }
  for (const action of keep)
    if (!prompt.actions.includes(action)) throw new Error(`${LOG_PREFIX} ${String(action)} was not offered`)
  const kept = [...new Set([...keep, ALWAYS_OFFERED])]
  const result = await offerApproverRole(agent, connectionId, agentDid, kept)
  if (result !== 'sent') return result
  record.content = { ...prompt, state: 'accepted', kept, answeredAt: new Date().toISOString() }
  await agent.genericRecords.update(record)
  guardianOfferPrompts.take(connectionId)
  guardianOfferEvents.emit('cleared', { connectionId })
  return 'sent'
}

/** The person says no. Nothing is sent: the guardian's phone reads it as not taken up, as it reads a lapse. */
export async function declineGuardianOffer(agent: Agent, connectionId: string): Promise<void> {
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_PROMPT, connectionId })) ?? []
  const prompt = record?.content as unknown as GuardianOfferPrompt | undefined
  guardianOfferPrompts.take(connectionId)
  if (record && prompt && prompt.state === 'open') {
    record.content = { ...prompt, state: 'declined', answeredAt: new Date().toISOString() }
    await agent.genericRecords.update(record)
  }
  guardianOfferEvents.emit('cleared', { connectionId })
}

// ---------------------------------------------------------------------------------------------------------------

async function sentOn(agent: Pick<Agent, 'genericRecords'>, connectionId: string) {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_SENT, connectionId })) ?? []
  return record?.content as unknown as GuardianOfferSent | undefined
}

async function promptsKept(agent: Pick<Agent, 'genericRecords'>): Promise<GuardianOfferPrompt[]> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_PROMPT })) ?? []
  return records.map((record) => record.content as unknown as GuardianOfferPrompt).filter((p) => !!p?.connectionId)
}

async function keepOn(
  agent: Pick<Agent, 'genericRecords'>,
  recordType: string,
  connectionId: string,
  content: object
): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType, connectionId })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType, connectionId } })
  }
}

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}
