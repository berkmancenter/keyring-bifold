/**
 * Becoming someone's trusted approver (docs/plans/trusted-approver-plan.md §4),
 * both phones: Sam asks Jordan over their VRC relationship, Jordan's phone
 * shows the offer, Jordan's answer goes back, and Sam's phone keeps a yes until
 * Sam writes the rule on Sam's agent (`VtaAgentController.setTrustedApprovers`,
 * which asks Sam to confirm).
 *
 * Every leg is signed under the sender's relationship DID and verified under
 * the DID the relationship established. Unlike the Approver demo's request,
 * nothing here is read unverified: with no relationship on the connection, the
 * document is dropped. An answer counts only against an offer this phone sent
 * on that connection, on that thread, carrying its challenge back.
 *
 * Off unless the trusted-approvers switch is on (trustedApproversFlag.ts).
 *
 * @module trust-tasks/approverRole
 */

import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo } from '../vrc/utils/rcardDisplayUtils'
import { sameChallenge } from '../vrc/contacts/continuityCrypto'

import {
  RESPONSE_SPEC,
  ROLE_ACTIONS,
  SPEC,
  TYPE_URI,
  type RoleOfferPayload,
  type RoleOfferResponsePayload,
} from './approverRoleSpec'
import { signDocumentProof, verifyDocumentProof } from './documentProof'
import { isTrustedApproversEnabled } from './module/trustedApproversFlag'
import type { InboundContext } from './registry'
import { respondWith, type TrustTasksService } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:ApproverRole]'

/** genericRecords recordType of an offer this phone sent, kept until it is answered (and, on a yes, applied). */
export const ROLE_OFFER_ASK = 'keyring.approver-role-offer-ask'
/** genericRecords recordType of an offer waiting for this phone's person. */
export const ROLE_OFFER_PROMPT = 'keyring.approver-role-offer-prompt'

const DAY = 24 * 60 * 60 * 1000
/** How long an offer can be answered. After that the asking phone forgets it, and the asked phone stops showing it. */
export const OFFER_OPEN_FOR = 14 * DAY
const CHALLENGE_BYTES = 32
const DID = /^did:[a-z0-9]+:.+/

export type RoleAction = (typeof ROLE_ACTIONS)[number]

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}

/** 'offer' (a prompt arrived), 'answered' (an answer to one of my offers arrived). */
export const approverRoleEvents = new EventEmitter()

interface Relationship {
  connectionId?: string
  myRelationshipDid?: string
  counterpartyRelationshipDid?: string
}

async function relationshipOn(agent: Agent, connectionId: string): Promise<Relationship | undefined> {
  const all: Relationship[] = await agent.dependencyManager.resolve(RelationshipDidRepository).getAll(agent.context)
  const found = all.find((record) => record.connectionId === connectionId)
  return found?.myRelationshipDid && found.counterpartyRelationshipDid ? found : undefined
}

const proofUnder = (agent: Agent, controller: string) => ({
  kind: 'verify' as const,
  verify: { verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, controller) },
})

const lapsed = (at: string, now = Date.now()) => !(now - Date.parse(at) < OFFER_OPEN_FOR)

// ---------------------------------------------------------------------------------------------------------------
// Asking (Sam's phone)

/** An offer this phone sent, as kept until it is answered. */
export interface RoleOfferAsk {
  connectionId: string
  threadId: string
  agentDid: string
  actions: RoleAction[]
  challenge: string
  askedAt: string
  /** Set when the contact said yes: the DID their phone approves as. */
  acceptedAs?: string
}

export type OfferResult = 'sent' | 'off' | 'noRelationship'

/**
 * Ask the contact on `connectionId` to approve `actions` on the agent `agentDid`. A new offer replaces an earlier
 * unanswered one on the same connection. Refuses an unknown action or an agent that is not a DID before sending.
 */
export async function offerApproverRole(
  agent: Agent,
  connectionId: string,
  agentDid: string,
  actions: readonly RoleAction[]
): Promise<OfferResult> {
  if (!isTrustedApproversEnabled()) return 'off'
  if (!DID.test(agentDid)) throw new Error(`${LOG_PREFIX} the agent is not a DID: ${agentDid}`)
  const chosen = [...new Set(actions)]
  if (chosen.length === 0) throw new Error(`${LOG_PREFIX} no action to offer`)
  for (const action of chosen)
    if (!ROLE_ACTIONS.includes(action)) throw new Error(`${LOG_PREFIX} unknown action: ${String(action)}`)

  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'

  const challenge = TypedArrayEncoder.toBase64Url(agent.kms.randomBytes({ length: CHALLENGE_BYTES }))
  const id = utils.uuid()
  const payload: RoleOfferPayload = { agent: agentDid, actions: chosen, challenge }
  const document: Record<string, unknown> = {
    id,
    type: TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)

  for (const earlier of await asksOn(agent, connectionId))
    if (!(earlier.content as unknown as RoleOfferAsk).acceptedAs) await agent.genericRecords.deleteById(earlier.id)
  const ask: RoleOfferAsk = {
    connectionId,
    threadId: id,
    agentDid,
    actions: chosen,
    challenge,
    askedAt: new Date().toISOString(),
  }
  await agent.genericRecords.save({
    content: { ...ask },
    tags: { recordType: ROLE_OFFER_ASK, connectionId, threadId: id },
  })
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  agent.config?.logger?.info(`${LOG_PREFIX} offer sent on connection ${connectionId}: ${chosen.join(', ')}`)
  return 'sent'
}

async function asksOn(agent: Pick<Agent, 'genericRecords'>, connectionId?: string) {
  return (
    (await agent.genericRecords.findAllByQuery(
      connectionId ? { recordType: ROLE_OFFER_ASK, connectionId } : { recordType: ROLE_OFFER_ASK }
    )) ?? []
  )
}

/** The contact's answer to my offer arrives: a yes is kept (to be applied), a no forgets the offer. */
export async function handleRoleOfferResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isTrustedApproversEnabled()) return
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return
  const outcome = await service.consume(agent.context, {
    spec: RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return

  const [record] =
    (await agent.genericRecords.findAllByQuery({
      recordType: ROLE_OFFER_ASK,
      connectionId: context.connectionId,
      threadId: String(document.threadId ?? ''),
    })) ?? []
  if (!record) return
  const ask = record.content as unknown as RoleOfferAsk
  if (ask.acceptedAs || lapsed(ask.askedAt)) return
  const answer = document.payload as RoleOfferResponsePayload
  // An answer that does not carry this offer's challenge back answers nothing; the offer stays for the real one.
  if (!sameChallenge(ask.challenge, String(answer?.challenge ?? ''))) return

  if (answer.decision === 'accepted') {
    if (!answer.approver || !DID.test(answer.approver)) return
    record.content = { ...ask, acceptedAs: answer.approver }
    await agent.genericRecords.update(record)
  } else {
    await agent.genericRecords.deleteById(record.id)
  }
  approverRoleEvents.emit('answered', { connectionId: context.connectionId, decision: answer.decision })
}

/** The yeses waiting to be written on my agent; lapsed unanswered offers are forgotten on the way. */
export async function acceptedRoleOffers(agent: Pick<Agent, 'genericRecords'>): Promise<RoleOfferAsk[]> {
  const accepted: RoleOfferAsk[] = []
  for (const record of await asksOn(agent)) {
    const ask = record.content as unknown as RoleOfferAsk
    if (ask.acceptedAs) accepted.push(ask)
    else if (lapsed(ask.askedAt)) await agent.genericRecords.deleteById(record.id)
  }
  return accepted
}

/** Forget an offer once its yes is written on the agent (or the person chose not to). */
export async function forgetRoleOffer(agent: Pick<Agent, 'genericRecords'>, threadId: string): Promise<void> {
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, threadId })) ?? [])
    await agent.genericRecords.deleteById(record.id)
}

/**
 * Who approves, and for what, once `ask`'s yes is added to what the agent holds now: the approver joins the one
 * set, and the actions are those already held plus the ones offered. The set approves every action it holds.
 */
export function approversWithAccepted(
  held: { approvers: readonly string[]; keys: readonly RoleAction[] },
  ask: Pick<RoleOfferAsk, 'acceptedAs' | 'actions'>
): { approvers: string[]; keys: RoleAction[] } {
  if (!ask.acceptedAs) return { approvers: [...held.approvers], keys: [...held.keys] }
  const keys = ROLE_ACTIONS.filter((action) => held.keys.includes(action) || ask.actions.includes(action))
  return { approvers: [...new Set([...held.approvers, ask.acceptedAs])], keys }
}

// ---------------------------------------------------------------------------------------------------------------
// Answering (Jordan's phone)

/** An offer waiting for this phone's person. */
export interface RoleOfferPrompt {
  connectionId: string
  /** The asking contact's name, from the relationship. */
  asker: string
  agentDid: string
  actions: RoleAction[]
  request: Record<string, unknown>
  receivedAt: string
}

class RoleOfferPromptStore {
  private prompts = new Map<string, RoleOfferPrompt>()
  set(prompt: RoleOfferPrompt) {
    this.prompts.set(prompt.connectionId, prompt)
  }
  get(connectionId: string) {
    return this.prompts.get(connectionId)
  }
  take(connectionId: string) {
    const prompt = this.prompts.get(connectionId)
    this.prompts.delete(connectionId)
    return prompt
  }
  list() {
    return [...this.prompts.values()]
  }
  /** Tests only. */
  clear() {
    this.prompts.clear()
  }
}

export const roleOfferPromptStore = new RoleOfferPromptStore()

/** An offer arrives: verified under the asker's relationship DID, then shown (and kept across a restart). */
export async function handleRoleOfferRequest(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isTrustedApproversEnabled()) return
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return
  const outcome = await service.consume(agent.context, {
    spec: SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  // No reply is sent here (that waits for the person), so a request that passes comes back 'accepted'.
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled') return

  const payload = document.payload as RoleOfferPayload
  const credentials = await agent.w3cCredentials.getAll()
  const prompt: RoleOfferPrompt = {
    connectionId: context.connectionId,
    asker: resolveContactDisplayInfo(credentials, relationship.counterpartyRelationshipDid as string).name ?? '',
    agentDid: payload.agent,
    actions: [...payload.actions],
    request: document,
    receivedAt: new Date().toISOString(),
  }
  roleOfferPromptStore.set(prompt)
  await keepPrompt(agent, prompt).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not keep an offer: ${(error as Error)?.message ?? error}`)
  )
  approverRoleEvents.emit('offer', { connectionId: context.connectionId })
}

async function forgetPrompt(agent: Pick<Agent, 'genericRecords'>, connectionId: string): Promise<void> {
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_PROMPT, connectionId })) ??
    [])
    await agent.genericRecords.deleteById(record.id)
}

async function keepPrompt(agent: Pick<Agent, 'genericRecords'>, prompt: RoleOfferPrompt): Promise<void> {
  await forgetPrompt(agent, prompt.connectionId)
  await agent.genericRecords.save({
    content: { ...prompt },
    tags: { recordType: ROLE_OFFER_PROMPT, connectionId: prompt.connectionId },
  })
}

/** Bring back the offers kept on this phone (at start). A lapsed one is removed, not shown. */
export async function restoreRoleOfferPrompts(agent: Pick<Agent, 'genericRecords'>): Promise<void> {
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_PROMPT })) ?? []) {
    const prompt = record.content as unknown as RoleOfferPrompt
    if (!prompt?.connectionId || !prompt.receivedAt || lapsed(prompt.receivedAt)) {
      await agent.genericRecords.deleteById(record.id)
      continue
    }
    if (!roleOfferPromptStore.get(prompt.connectionId)) roleOfferPromptStore.set(prompt)
  }
}

/**
 * The person's answer to an offer, signed under this phone's relationship DID and sent back: a yes names
 * `approverDid`, the DID this phone approves as; a no is sent too. Sent first: if sending fails, the offer stays and
 * the person can answer again.
 */
export async function respondToRoleOffer(
  agent: Agent,
  connectionId: string,
  accept: boolean,
  approverDid?: string
): Promise<void> {
  const prompt = roleOfferPromptStore.get(connectionId)
  if (!prompt) return
  if (accept && !(approverDid && DID.test(approverDid)))
    throw new Error(`${LOG_PREFIX} a yes needs the DID this phone approves as`)
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) throw new Error(`${LOG_PREFIX} no relationship to sign the answer under`)

  const answer: RoleOfferResponsePayload = {
    decision: accept ? 'accepted' : 'declined',
    challenge: (prompt.request.payload as RoleOfferPayload).challenge,
    ...(accept ? { approver: approverDid } : {}),
    respondedAt: new Date().toISOString(),
  }
  const response = respondWith(prompt.request as never, utils.uuid(), answer as never, () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const signed = await signDocumentProof(agent, response, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)

  roleOfferPromptStore.take(connectionId)
  await forgetPrompt(agent, connectionId).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not drop an offer: ${(error as Error)?.message ?? error}`)
  )
}
