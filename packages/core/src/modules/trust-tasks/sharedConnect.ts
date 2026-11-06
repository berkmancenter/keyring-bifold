/**
 * TEST BRANCH ONLY (test/shared-connect-rungs): the thinnest connectionless encounter path that lets the
 * shared-connect rungs run Keyring's real code end to end. NOT wired into the app: nothing imports this
 * module outside its test. It exists to find where the spec (trust-tasks #1034, dtgwg-vti-spec#86 as
 * revised 2026-11-05) and Keyring disagree, under plan wallet #853 (WP1, WP2, WP4, WP5, WP6 thin, WP7).
 *
 * Keyring is the RESPONDER (scanner): read the link, resolve the inviter, mint an encounter VID and a
 * relationship DID, and on Connect send XRFI then a signed `propose`. Every inbound document goes through
 * the TSP identity check (`unpackTrustTaskFromPeer`), then the framework pipeline (`consumeInbound` with
 * Keyring's payload validator), then the step's own checks. Real pieces reused: readTrigger/triggerAction,
 * selectService, signDocumentProof/verifyDocumentProof, digestMultibase, greetPeerOverTsp,
 * packTrustTaskForPeer, unpackTrustTaskFromPeer, tspSessionForManager.
 *
 * Decisions taken here only so the rungs can run (each is a #853 §8 question, not a settled answer):
 * - documents are signed by the ISSUER VID (decision 3's suggestion); inbound, either the issuer VID or the
 *   sender's relationship DID is accepted;
 * - `ceremony` is `{enactment, step}`: no `definition` until a published one has a `definitionDigest`
 *   (framework 0.5 schema `dependentRequired`, found in rung R2);
 * - `threadId` is `propose.id` on every document (#853 WP7);
 * - our VRC is VC 2.0, `eddsa-jcs-2022` under the relationship DID, no `validUntil` (WP8 profile);
 * - an `issue` that arrives before `propose#response` is HELD and replayed after it.
 */
import type { Agent } from '@credo-ts/core'
import { DidDocumentService, PeerDidNumAlgo, createPeerDidDocumentFromServices, Kms } from '@credo-ts/core'
import { tsp } from '@bifold/trust-tasks'
import {
  consumeInbound,
  notConsequentialChecks,
  respondWith,
  StaticTransport,
  type ProofPolicy,
} from '@openvtc/trust-tasks/runtime'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import {
  readTrigger,
  selectService,
  SHARED_CONNECT_SELECTION,
  SHARED_CONNECT_TRIGGER_CONFIG,
  triggerAction,
  type TriggerAccept,
} from './module/triggerLink'
import { greetPeerOverTsp, packTrustTaskForPeer, tspSessionForManager, unpackTrustTaskFromPeer } from './module/vtiTsp'
import { trustTaskPayloadValidator } from './validator'

export const SHARED_CONNECT_CEREMONY = 'https://trusttasks.org/ceremony/shared-connect/0.1'

export type EncounterState =
  | 'ready' // read, resolved, minted; nothing sent (VTI-LNK-052: nothing before Connect)
  | 'proposed'
  | 'accepted' // their propose#response arrived
  | 'complete' // both VRCs delivered and both receipts matched
  | 'failed'

/** Everything a resumed app needs: persisted after every step, so a killed app picks up where it was. */
export interface EncounterRecord {
  key: string // 'enc:' + enactment
  enactment: string
  theirVid: string
  myVid: string
  relay: string
  binding: string
  exp: number
  label?: string
  state: EncounterState
  myRelationshipDid: string
  theirRelationshipDid?: string
  proposeId?: string
  greeted: boolean
  myVrcDigest?: string
  myVrcAcked: boolean
  theirVrc?: Record<string, unknown>
  /** An `issue` that came before the `propose#response`, held as raw frame bytes (base64url). */
  held: string[]
  why?: string
}

export interface EncounterStore {
  get(key: string): Promise<EncounterRecord | undefined>
  put(record: EncounterRecord): Promise<void>
}

/** Sends one TSP frame to the encounter's relay. */
export type SendFrame = (bytes: Uint8Array) => Promise<void>

const b64u = (bytes: Uint8Array) => tsp.toBase64Url(bytes)
const freshId = () => b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)))
const now = () => new Date().toISOString()

export type ReadOutcome =
  | { ok: true; trigger: TriggerAccept }
  | { ok: false; reason: string; ui: string }

/** WP1: read a scanned or pasted link under the shared-connect config. Nothing is sent. */
export function readSharedConnect(text: string, options: { now?: number } = {}): ReadOutcome {
  const result = readTrigger(text, { now: options.now, config: SHARED_CONNECT_TRIGGER_CONFIG })
  const action = triggerAction(result, SHARED_CONNECT_TRIGGER_CONFIG)
  if (action.kind === 'say') {
    return { ok: false, reason: result.outcome === 'reject' ? result.reason : 'not-implemented', ui: action.ui }
  }
  if (action.flow !== 'shared-connect') return { ok: false, reason: 'other-flow', ui: 'invalid' }
  return { ok: true, trigger: action.trigger }
}

/**
 * WP2 + WP4: resolve the inviter's self-certifying DID, choose TSP then DIDComm, mint our encounter VID
 * (did:peer:2: Ed25519 plus its X25519 agreement key, with TSPTransport and DIDCommMessaging naming the
 * same relay) and our relationship DID (did:peer:0). Persisted; nothing sent.
 */
export async function prepareEncounter(
  agent: Agent,
  store: EncounterStore,
  trigger: TriggerAccept
): Promise<EncounterRecord> {
  const existing = await store.get(`enc:${trigger.id}`)
  if (existing) return existing // a second scan of the same code resumes, never mints again

  const theirDoc = await agent.dids.resolveDidDocument(trigger.from)
  const services = (theirDoc.service ?? []).map((s) => ({
    id: s.id,
    type: s.type,
    serviceEndpoint: (s as unknown as { serviceEndpoint: unknown }).serviceEndpoint,
  }))
  // A did:peer is self-certifying: what resolves from the identifier is the document (#86's clarifying sentence).
  const selected = selectService({ verified: true, services }, SHARED_CONNECT_SELECTION)
  if (selected.outcome !== 'select') throw new SharedConnectError('no-common-transport')

  const myVid = await createEncounterDid(agent, selected.endpoint)
  const myRelationshipDid = await createRelationshipDid(agent)
  const record: EncounterRecord = {
    key: `enc:${trigger.id}`,
    enactment: trigger.id,
    theirVid: trigger.from,
    myVid,
    relay: selected.endpoint,
    binding: selected.binding,
    exp: trigger.exp ?? 0,
    ...(trigger.label ? { label: trigger.label.text } : {}),
    state: 'ready',
    myRelationshipDid,
    greeted: false,
    myVrcAcked: false,
    held: [],
  }
  await store.put(record)
  return record
}

export class SharedConnectError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code)
    this.name = 'SharedConnectError'
  }
}

async function createEncounterDid(agent: Agent, relay: string): Promise<string> {
  const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
  const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk) as Kms.PublicJwk<Kms.Ed25519PublicJwk>
  const { didDocument, keys } = createPeerDidDocumentFromServices(
    [{ id: 'enc', serviceEndpoint: 'https://unused.invalid', recipientKeys: [publicJwk], routingKeys: [] }],
    true
  )
  didDocument.service = [
    new DidDocumentService({ id: '#tsp', type: 'TSPTransport', serviceEndpoint: relay }),
    new DidDocumentService({ id: '#didcomm', type: 'DIDCommMessaging', serviceEndpoint: relay }),
  ]
  const created = await agent.dids.create({
    method: 'peer',
    didDocument,
    options: { numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc, keys },
  })
  if (!created.didState.did) throw new SharedConnectError('mint-failed', JSON.stringify(created.didState))
  return created.didState.did
}

async function createRelationshipDid(agent: Agent): Promise<string> {
  const created = await agent.dids.create({
    method: 'peer',
    options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
  } as never)
  if (!created.didState.did) throw new SharedConnectError('mint-failed', JSON.stringify(created.didState))
  return created.didState.did
}

const ceremony = (record: EncounterRecord, step: string) => ({ enactment: record.enactment, step })

/** WP5: XRFI once, then the application frame, both TSP 1.0. */
async function sendDocument(agent: Agent, record: EncounterRecord, document: Record<string, unknown>, send: SendFrame) {
  const session = await tspSessionForManager(agent, record.myVid)
  if (!record.greeted) {
    const invite = await greetPeerOverTsp(session, record.myVid, record.theirVid, [record.myVid], 'v1')
    await send(invite.bytes)
    record.greeted = true
  }
  const packed = await packTrustTaskForPeer(session, record.myVid, record.theirVid, document, 'v1')
  await send(packed.bytes)
}

/** Connect (WP3's button): re-check expiry, then XRFI + a signed `propose`. */
export async function connect(
  agent: Agent,
  store: EncounterStore,
  key: string,
  send: SendFrame,
  options: { nowSeconds?: number } = {}
): Promise<EncounterRecord> {
  const record = await mustGet(store, key)
  if (record.state !== 'ready') return record // a second Connect on the same code sends nothing again
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (record.exp && record.exp <= nowSeconds) {
    record.state = 'failed'
    record.why = 'expired-at-connect'
    await store.put(record)
    return record
  }
  if (record.binding !== 'tsp') {
    // This thin path carries TSP only; the DIDComm v2 fallback is #853 WP14, not built here.
    record.state = 'failed'
    record.why = `carriage-not-built:${record.binding}`
    await store.put(record)
    return record
  }
  const id = freshId()
  const document = await signDocumentProof(
    agent,
    {
      id,
      type: propose.TYPE_URI,
      threadId: id,
      issuer: record.myVid,
      recipient: record.theirVid,
      issuedAt: now(),
      ceremony: ceremony(record, 'propose'),
      payload: { relationshipDid: record.myRelationshipDid },
    },
    record.myVid
  )
  await sendDocument(agent, record, document, send)
  record.proposeId = id
  record.state = 'proposed'
  await store.put(record)
  return record
}

/** Either key the spec's open decision 3 allows: the issuer VID, or the sender's relationship DID. */
async function proofFromEither(agent: Agent, doc: Record<string, unknown>, issuerVid: string, relationshipDid?: string) {
  if (await verifyDocumentProof(agent, doc, issuerVid)) return true
  return relationshipDid ? verifyDocumentProof(agent, doc, relationshipDid) : false
}

const verifyBoth = (agent: Agent, record: EncounterRecord): ProofPolicy => ({
  kind: 'verify',
  verify: { verify: (doc) => proofFromEither(agent, doc as never, record.theirVid, record.theirRelationshipDid) },
})

async function pipeline(
  agent: Agent,
  record: EncounterRecord,
  doc: Record<string, unknown>,
  spec: unknown,
  handler: (doc: Record<string, unknown>) => unknown
) {
  return consumeInbound({
    transport: new StaticTransport({ issuer: record.theirVid, recipient: record.myVid }),
    spec: spec as never,
    proofPolicy: verifyBoth(agent, record),
    payloadPolicy: { kind: 'validate', validate: trustTaskPayloadValidator as never },
    checks: notConsequentialChecks(),
    doc: doc as never,
    myVid: record.myVid,
    now: Date.now(),
    newErrorId: freshId,
    handler: handler as never,
  })
}

/** What happened to one inbound frame. */
export type Received =
  | { kind: 'control' } // XRFA or another relationship frame: no Trust Task
  | { kind: 'held'; type: string }
  | { kind: 'step'; type: string; state: EncounterState }
  | { kind: 'refused'; type: string; why: string }

/**
 * One inbound TSP frame for this encounter. Identity first (TSP sender = document issuer), then the
 * ceremony's own checks: the thread is our propose, the enactment is the link's `_id`.
 */
export async function receive(
  agent: Agent,
  store: EncounterStore,
  key: string,
  bytes: Uint8Array,
  send: SendFrame
): Promise<Received> {
  const record = await mustGet(store, key)
  const session = await tspSessionForManager(agent, record.myVid)
  const opened = await unpackTrustTaskFromPeer(session, bytes, record.myVid)
  if (!opened) return { kind: 'control' }
  const doc = opened.plaintext.body as unknown as Record<string, unknown>
  const type = String(doc.type)
  const refuse = async (why: string): Promise<Received> => ({ kind: 'refused', type, why })

  if (opened.unpacked.sender !== record.theirVid) return refuse('not-this-encounter')
  if (doc.threadId !== record.proposeId) return refuse('wrong-thread')
  const c = doc.ceremony as { enactment?: unknown } | undefined
  if (c?.enactment !== record.enactment) return refuse('wrong-enactment')

  if (type === propose.RESPONSE_TYPE_URI) {
    if (record.state !== 'proposed') return refuse(`response-in-state-${record.state}`)
    const out = await pipeline(agent, record, doc, propose.RESPONSE_SPEC, (d) => d)
    if (out.kind !== 'accepted' && out.kind !== 'handled') return refuse(`pipeline:${out.kind}:${detail(out)}`)
    record.theirRelationshipDid = String((doc.payload as { relationshipDid: string }).relationshipDid)
    record.state = 'accepted'
    await store.put(record)
    // Replay anything held for this moment.
    const held = record.held.splice(0)
    await store.put(record)
    for (const h of held) await receive(agent, store, key, tsp.fromBase64Url(h), send)
    const after = await mustGet(store, key)
    return { kind: 'step', type, state: after.state }
  }

  if (type === issue.TYPE_URI) {
    if (record.state === 'proposed') {
      record.held.push(b64u(bytes))
      await store.put(record)
      return { kind: 'held', type }
    }
    if (record.state !== 'accepted') return refuse(`issue-in-state-${record.state}`)
    let receipt: Record<string, unknown> | undefined
    let handlerWhy: string | undefined
    const out = await pipeline(agent, record, doc, issue.SPEC, async (d) => {
      const vc = (d.payload as { vrc?: Record<string, unknown> }).vrc
      if (!vc) return void (handlerWhy = 'no-credential')
      const issuerOf = typeof vc.issuer === 'object' && vc.issuer ? (vc.issuer as { id?: string }).id : vc.issuer
      const subject = Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
      if (issuerOf !== record.theirRelationshipDid) return void (handlerWhy = 'vc-issuer-not-their-relationship-did')
      if ((subject as { id?: string })?.id !== record.myRelationshipDid)
        return void (handlerWhy = 'vc-subject-not-our-relationship-did')
      if (!(await verifyInboundVrc(agent, vc, String(issuerOf)))) return void (handlerWhy = 'vc-proof')
      record.theirVrc = vc
      receipt = respondWith(d as never, freshId(), { vrcDigestMultibase: digestMultibase(vc) }) as never
      return receipt
    })
    if (handlerWhy) return refuse(handlerWhy)
    if (out.kind !== 'handled' && out.kind !== 'accepted') return refuse(`pipeline:${out.kind}:${detail(out)}`)
    // Proofs on every step, receipts included (#1034's ceremony; #853 WP7).
    const r = await signDocumentProof(
      agent,
      { ...(receipt as Record<string, unknown>), ceremony: ceremony(record, 'issue-inviter') },
      record.myVid
    )
    await sendDocument(agent, record, r, send)
    await store.put(record)
    await sendOurIssue(agent, record, send)
    await store.put(record)
    return { kind: 'step', type, state: record.state }
  }

  if (type === issue.RESPONSE_TYPE_URI) {
    const out = await pipeline(agent, record, doc, issue.RESPONSE_SPEC, (d) => d)
    if (out.kind !== 'handled' && out.kind !== 'accepted') return refuse(`pipeline:${out.kind}:${detail(out)}`)
    const digest = (doc.payload as { vrcDigestMultibase?: string }).vrcDigestMultibase
    if (!record.myVrcDigest || digest !== record.myVrcDigest) return refuse('receipt-matches-no-delivery')
    record.myVrcAcked = true
    if (record.theirVrc) record.state = 'complete'
    await store.put(record)
    return { kind: 'step', type, state: record.state }
  }

  return refuse('unexpected-type')
}

/**
 * WP8: an inbound VRC. Keyring's connection path verifies with Credo's JSON-LD verifier
 * (`agent.w3cCredentials.verifyCredential`, ceremony.ts handleInboundIssue). That has no eddsa-jcs-2022
 * suite, so a JCS-signed VRC is checked here with verifyDocumentProof under its issuer, as #853 WP8 proposes.
 */
export async function verifyInboundVrc(agent: Agent, vc: Record<string, unknown>, issuerDid: string): Promise<boolean> {
  const proof = vc.proof as { cryptosuite?: string } | undefined
  if (proof?.cryptosuite === 'eddsa-jcs-2022') return verifyDocumentProof(agent, vc, issuerDid)
  return false
}

async function sendOurIssue(agent: Agent, record: EncounterRecord, send: SendFrame) {
  if (record.myVrcDigest) return
  const vc = await signDocumentProof(
    agent,
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: record.myRelationshipDid,
      issuerScope: 'pairwise',
      validFrom: now(),
      credentialSubject: { id: record.theirRelationshipDid },
    },
    record.myRelationshipDid
  )
  const digest = digestMultibase(vc)
  const document = await signDocumentProof(
    agent,
    {
      id: freshId(),
      type: issue.TYPE_URI,
      threadId: record.proposeId,
      issuer: record.myVid,
      recipient: record.theirVid,
      issuedAt: now(),
      ceremony: ceremony(record, 'issue-responder'),
      payload: { vrc: vc, vrcDigestMultibase: digest },
    },
    record.myVid
  )
  await sendDocument(agent, record, document, send)
  record.myVrcDigest = digest
}

async function mustGet(store: EncounterStore, key: string): Promise<EncounterRecord> {
  const record = await store.get(key)
  if (!record) throw new SharedConnectError('no-encounter')
  return record
}

/** The refusal's code first (what a reader needs), then a bounded dump. */
const detail = (out: unknown) => {
  const code = (out as { error?: { payload?: { code?: string } } }).error?.payload?.code
  return `${code ?? ''} ${JSON.stringify(out).slice(0, 160)}`
}
