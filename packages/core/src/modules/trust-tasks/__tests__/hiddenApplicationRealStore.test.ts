/**
 * A private application ended by a join, run on a real Askar store: the records are written by the shipping code, in
 * the order the shipping code writes them, and read back from sqlite. hiddenApplicationClosed.test.ts tests the same
 * rules on an in-memory store; this suite is here because an in-memory store answers in whatever order the test
 * implies, and a read rule can pass there while the real write order defeats it (#865: every departure hidden).
 *
 * What is real: the Askar store and every record in it; keepForPersona and everything it writes (the membership card,
 * the role card, the member's acknowledgement); startHiddenApplication; the sweep; VtaClient's own
 * createPcsApplication and deletePcsApplication, down to the task they send.
 *
 * What is not, and why:
 * - The agent. No VTA answers in jest, so `FakeVta` stands in for one at VtaClient.task. It routes on the task URIs
 *   in the vendored upstream schemas (fixtures/pcs-schemas, which match vta-service v0.69.1's bundles for these
 *   tasks), grades the delete payload against upstream's schema, and refuses as the real client reports a refusal:
 *   a VtiRefusal carrying the wire code (VtaClient.ts, the trust-task-error branch). The refusals it gives are
 *   vta-service v0.69.1's for this task: `permissionDenied` from require_capability (Capability::PcsApplicant), then
 *   `vta/pcs/applications/delete:notFound` (trust_tasks/pcs.rs handle_applications_delete).
 * - The card's proof and status check (deliveredCardCheck): signatures and a status list over the network.
 * - Signing the member's acknowledgement, and sending it: the persona's key is at its agent.
 *
 * The order. Each message is delivered by awaiting keepForPersona, one after the other, as the mediator session does
 * (VtiMediatorTransport awaits onMessage before taking the next). The sweep and the acknowledgement are started by
 * keepForPersona itself and not awaited by it, as on a phone; the test never awaits them or calls into them, and only
 * waits, by polling the store, for what they leave. The one thing the test sets is how long the agent takes to answer
 * the delete: at once, or not until the other card and the acknowledgement are kept. Both happen on a phone.
 *
 * Device rows this stands in for (the #924 device run):
 * - Case 2, a live application is left alone: yes, the app's half (no delete sent, the record still open).
 * - Case 3, an ended application is destroyed and the join stands: yes, the app's half (the delete sent, upstream's
 *   shape, the record replaced by a note, the membership whole).
 * - A refusal at the agent, including a relinked identity the agent no longer lets apply: the app's half.
 * NOT covered here: that a real VTA destroys the application when told to. That is upstream's: vta-service
 * trust_tasks/pcs.rs handle_applications_delete and its tests in pcs_tests.rs (which assert the notFound code). Nor
 * the unlink-then-relink row as a sequence on a phone.
 */
import '../../../../__tests__/helpers/realAskar'

import { AskarModule } from '@credo-ts/askar'
import { Agent } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import Ajv from 'ajv/dist/2020'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockLogged: string[] = []
let mockClient: unknown
const VTA_DID = 'did:webvh:QmAgent:agent.example:keyring-test-agent'
// A new identity for each phone. The acknowledgement keeps its work in flight per community and identity, in the
// module, beyond any one agent, so one test's would otherwise stand in for the next one's.
let mockMe = 'did:webvh:QmMe:dids.example:me-0'
let ME = mockMe
let identities = 0

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// A store write announces itself on a timer, which could fire after the suite has gone.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))
// Signing the member's acknowledgement: the persona's key is at its agent.
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({
    ...doc,
    proof: { type: 'DataIntegrityProof' },
  })),
}))
// The session: signed in as this identity, so the acknowledgement is owed and sent. Sending is the network.
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    get did() {
      return mockMe
    },
    isConnected: true,
    getState: () => ({ status: 'connected', did: mockMe }),
    onInbound: () => () => undefined,
    subscribe: () => () => undefined,
    send: jest.fn(async () => undefined),
    sendMemberVmc: jest.fn(async () => ({ status: 'stored' })),
  },
}))
// The agent's sign-in is the network; the client the sweep gets is the real VtaClient, answered by FakeVta.
jest.mock('../module/vtaAgent', () => ({
  ...jest.requireActual('../module/vtaAgent'),
  vtaAgent: {
    installKeyFetcher: jest.fn(),
    refetchPersonaKeys: jest.fn(async () => undefined),
    agentAddress: () => 'did:webvh:QmAgent:agent.example:keyring-test-agent',
    connect: jest.fn(async () => undefined),
    client: () => mockClient,
  },
}))
// A card's proof and status list: signatures and the network.
jest.mock('../module/vtiDeliveredCheck', () => ({
  ...jest.requireActual('../module/vtiDeliveredCheck'),
  deliveredCardCheck: () => async () => undefined,
}))
jest.mock('../module/releaseLog', () => ({
  ...jest.requireActual('../module/releaseLog'),
  releaseWarn: (line: string) => void mockLogged.push(line),
}))

// eslint-disable-next-line import/order
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
// eslint-disable-next-line import/order
import { VtaClient } from '../module/VtaClient'
// eslint-disable-next-line import/order
import { loadHiddenVettingRecord, startHiddenApplication } from '../module/hiddenVetting'
// eslint-disable-next-line import/order
import { VtiRefusal } from '../module/vtiAgent'
// eslint-disable-next-line import/order
import { COMMUNITY_ROLE_ENDORSEMENT_TYPE, CREDENTIAL_EXCHANGE_ISSUE } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { keepForPersona } from '../module/vtiPersonaInbox'
// eslint-disable-next-line import/order
import * as vetting from '../module/vtiVetting'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
const EARLIER_ME = 'did:webvh:QmMe:dids.example:me-earlier'

// --- upstream's schemas, as vendored (fixtures/pcs-schemas/README.md) ---------------------------------------------

const SCHEMA_DIR = join(__dirname, 'fixtures', 'pcs-schemas')
const schemaFile = (f: string) => JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')) as { $id: string }
const CREATE = schemaFile('vta-pcs-applications-create.payload.schema.json').$id
const DELETE = schemaFile('vta-pcs-applications-delete.payload.schema.json').$id

/** Upstream's delete payload schema, with its framework reference resolvable (as pcsVtaPayloads.test.ts does). */
function deletePayloadValidator() {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.json'))) {
    if (f === 'vta-pcs-applications-delete.payload.schema.json') continue
    const s = schemaFile(f)
    const ids = [
      s.$id,
      ...(f === 'framework-0.2.schema.json' ? ['https://trusttasks.org/_framework/0.2/framework.schema.json'] : []),
    ]
    for (const id of ids.filter(Boolean)) {
      try {
        ajv.addSchema(s, id)
      } catch {
        // already registered under an equivalent id
      }
    }
  }
  return ajv.compile(schemaFile('vta-pcs-applications-delete.payload.schema.json'))
}
const validDelete = deletePayloadValidator()

// --- the agent ------------------------------------------------------------------------------------------------------

/** An agent holding applications, answering the two tasks this suite sends as vta-service v0.69.1 does. */
class FakeVta {
  readonly held = new Set<string>()
  readonly sent: { type: string; payload: Record<string, unknown> }[] = []
  /** Whether this phone still carries PcsApplicant at the agent. */
  mayApply = true
  /** When set, a delete is answered only once this settles. */
  answerDeleteAfter?: Promise<void>
  private next = 1

  async task(type: string, payload: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ type, payload })
    if (type === CREATE) {
      const applicationId = `app-${this.next++}`
      this.held.add(applicationId)
      return { application: { applicationId, id: `pcs-${applicationId}`, attestations: [{}, {}] } }
    }
    if (type === DELETE) {
      if (this.answerDeleteAfter) await this.answerDeleteAfter
      if (!this.mayApply)
        throw new VtiRefusal(
          'permissionDenied',
          `pcs applicant denied: ${ME} does not carry the PcsApplicant capability`
        )
      if (!validDelete(payload)) throw new VtiRefusal('malformedPayload', JSON.stringify(validDelete.errors))
      const id = String(payload.applicationId)
      if (!this.held.has(id))
        throw new VtiRefusal(
          'vta/pcs/applications/delete:notFound',
          'No application has this handle in a context the caller may act in.'
        )
      this.held.delete(id)
      return { applicationId: id, deleted: true }
    }
    throw new VtiRefusal('unsupportedType', `no handler for ${type}`)
  }

  deletesSent() {
    return this.sent.filter((s) => s.type === DELETE).map((s) => String(s.payload.applicationId))
  }
}

/** The shipping VtaClient, with its one way out (task) answered by the agent above. */
function clientFor(vta: FakeVta): VtaClient {
  const client = Object.create(VtaClient.prototype) as VtaClient
  Object.defineProperty(client, 'vtaDid', { value: VTA_DID })
  ;(client as unknown as { task: FakeVta['task'] }).task = (type, payload) => vta.task(type, payload)
  return client
}

// --- the phone ------------------------------------------------------------------------------------------------------

const dirs: string[] = []
const agents: Agent[] = []

async function newPhone() {
  ME = mockMe = `did:webvh:QmMe:dids.example:me-${++identities}`
  const storeDir = mkdtempSync(join(tmpdir(), 'hidden-app-real-'))
  dirs.push(storeDir)
  const agent = new Agent({
    config: { label: 'hidden-application-real-store' },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: `hidden-app-${process.pid}-${Math.random().toString(36).slice(2)}`,
          key: 'test-key',
          database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
        },
      }),
    },
  }) as unknown as Agent
  await agent.initialize()
  agents.push(agent)
  const vta = new FakeVta()
  const client = clientFor(vta)
  mockClient = client
  const community = new GenericRecordsCommunityStore(agent)
  const persona = (did: string) => ({
    did,
    communityDid: COMMUNITY,
    vtaKeyIds: { signing: `${did}#key-1`, keyAgreement: `${did}#key-2` },
    kmsKeyIds: { signing: 'kms-signing', keyAgreement: 'kms-agreement' },
  })
  const apply = (joinDid = ME) =>
    startHiddenApplication(agent, client, {
      contextId: 'vta',
      community: COMMUNITY,
      joinDid,
      requirementsDigest: 'zQmDigest',
      parameters: { suite: 'ps-ddh-bls12381' } as never,
      minimum: 2,
    })
  /** What the store holds for the community, as stored: an application in progress, or the note an ended one left. */
  const stored = async () =>
    (await agent.genericRecords.findAllByQuery({ recordType: 'keyring/hidden-vetting' })).map(
      (r) => r.content as Record<string, unknown>
    )
  return { agent, vta, client, community, persona, apply, stored }
}

let messages = 0
const issue = (credential: Record<string, unknown>) => ({
  id: `urn:uuid:00000000-0000-4000-8000-${String(++messages).padStart(12, '0')}`,
  type: CREDENTIAL_EXCHANGE_ISSUE,
  from: COMMUNITY,
  body: { credential_response: { credential } },
})
const membershipCard = (subject: string) =>
  issue({
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
    id: `urn:uuid:11111111-0000-4000-8000-${String(messages).padStart(12, '0')}`,
    type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
    issuer: COMMUNITY,
    issuerScope: 'public',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    credentialSubject: { id: subject },
    proof: { type: 'DataIntegrityProof' },
  })
const roleCard = (subject: string) =>
  issue({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `urn:uuid:22222222-0000-4000-8000-${String(messages).padStart(12, '0')}`,
    type: ['VerifiableCredential', 'EndorsementCredential'],
    issuer: COMMUNITY,
    validFrom: new Date().toISOString(),
    credentialSubject: {
      id: subject,
      endorsement: { type: COMMUNITY_ROLE_ENDORSEMENT_TYPE, role: 'member', communityDid: COMMUNITY },
    },
    proof: { type: 'DataIntegrityProof' },
  })

/** Wait for what work started and not awaited leaves in the store; the test never reaches into that work. */
async function until(what: string, holds: () => Promise<boolean>, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await holds()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`waited ${ms} ms and this never held: ${what}`)
}
/** Long enough for a sweep that would wrongly delete to have done it: every step here is a local store read. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 750))
const later = () => new Promise((resolve) => setTimeout(resolve, 5))

/** The next unlock's sweep (startPersonaInbox runs it). Absent before #924, so a test using it fails there. */
const nextUnlock = (agent: Agent) =>
  (vetting as unknown as { closeEndedHiddenApplications: (a: Agent) => Promise<void> }).closeEndedHiddenApplications(
    agent
  )

beforeAll(() => {
  // jestSetup.js freezes Date.now for screen tests; a real Askar store and ordered dates need the real clock.
  jest.spyOn(Date, 'now').mockRestore()
})
beforeEach(() => {
  mockLogged.length = 0
})
afterAll(async () => {
  // Whatever a test started and left running finishes before its store closes.
  await settle()
  for (const agent of agents) await agent.shutdown().catch(() => undefined)
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

jest.setTimeout(60000)

describe('the delete is the one upstream specifies', () => {
  it("VtaClient sends upstream's task URI with a payload upstream's schema accepts", async () => {
    const vta = new FakeVta()
    vta.held.add('app-7')
    await clientFor(vta).deletePcsApplication('app-7')
    expect(vta.sent).toHaveLength(1)
    // Against the schema's own $id, not our constant: a near-miss would be refused at the agent.
    expect(vta.sent[0].type).toBe('https://trusttasks.org/spec/vta/pcs/applications/delete/0.1')
    expect(vta.sent[0].type).toBe(DELETE)
    expect(validDelete(vta.sent[0].payload) || validDelete.errors).toBe(true)
    expect(vta.held.has('app-7')).toBe(false)
  })
})

describe('case 3: a join that went through, on a real store', () => {
  it.each([
    ['the agent answers at once', false],
    ['the agent answers only after the role card and the acknowledgement are kept', true],
  ])('the application is destroyed at the agent and the membership stands whole (%s)', async (_, slow) => {
    const p = await newPhone()
    const record = await p.apply()
    expect(p.vta.held.has(record.applicationId)).toBe(true)
    let answer: () => void = () => undefined
    if (slow) p.vta.answerDeleteAfter = new Promise<void>((resolve) => (answer = resolve))

    await later()
    // The community's two cards, a few milliseconds apart, as the 241 gate measured.
    await keepForPersona(p.agent, p.persona(ME), membershipCard(ME) as never)
    await keepForPersona(p.agent, p.persona(ME), roleCard(ME) as never)

    // The acknowledgement keepForPersona started, through to the community's receipt.
    await until('the acknowledgement is recorded', async () =>
      Boolean((await p.community.getMembership(COMMUNITY, ME))?.memberVmcAckedAt)
    )
    answer()
    // The sweep keepForPersona started.
    await until('the application is closed here', async () => (await p.stored()).some((s) => s.closed !== undefined))

    expect(p.vta.deletesSent()).toEqual([record.applicationId])
    expect(p.vta.held.has(record.applicationId)).toBe(false)
    const after = await p.stored()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ community: COMMUNITY, joinDid: ME, closed: 'joined', held: 2, minimum: 2 })
    expect(after[0].applicationId).toBeUndefined()
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toBeUndefined()

    const membership = await p.community.getMembership(COMMUNITY, ME)
    expect(membership).toMatchObject({ communityDid: COMMUNITY, personaDid: ME })
    expect(membership?.removal).toBeUndefined()
    expect((membership?.vmc as { type?: string[] } | undefined)?.type).toContain('MembershipCredential')
    expect(membership?.role).toBe('member')
    expect(membership?.memberVmc).toBeDefined()
    expect(membership?.memberVmcAckedAt).toBeDefined()
    expect(mockLogged.filter((l) => l.includes('[hidden-vetting]'))).toEqual([])
  })
})

describe('case 2: an application still open is left alone, on a real store', () => {
  it("a card for another of this phone's identities in the same community sends no delete", async () => {
    const p = await newPhone()
    const record = await p.apply(ME)
    // Its request is with the community, referred, and not decided.
    await new vetting.GenericRecordsVettingStore(p.agent).saveApplication({
      communityDid: COMMUNITY,
      joinDid: ME,
      minStatements: 2,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: 'salt',
      claims: {},
      requests: [],
      startedAt: new Date().toISOString(),
      submission: { state: 'pending', effect: 'refer', at: new Date().toISOString() },
    } as never)

    await later()
    // An earlier identity of this phone is admitted: the card that starts a sweep, about someone else.
    await keepForPersona(p.agent, p.persona(EARLIER_ME), membershipCard(EARLIER_ME) as never)
    await until('the earlier identity is a member', async () =>
      Boolean(await p.community.getMembership(COMMUNITY, EARLIER_ME))
    )
    await settle()

    expect(p.vta.deletesSent()).toEqual([])
    expect(p.vta.held.has(record.applicationId)).toBe(true)
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({
      applicationId: record.applicationId,
      joinDid: ME,
    })
  })
})

describe('the agent refuses the delete, on a real store', () => {
  it('a refusal for want of authority keeps the application open here, and the next unlock closes it', async () => {
    const p = await newPhone()
    const record = await p.apply()
    // A relinked identity the agent no longer lets apply.
    p.vta.mayApply = false

    await later()
    await keepForPersona(p.agent, p.persona(ME), membershipCard(ME) as never)
    await until('the delete was tried', async () => p.vta.deletesSent().length > 0)
    await settle()

    expect(p.vta.held.has(record.applicationId)).toBe(true)
    // Not closed, not lost, not changed: the handle is still the only way to name it.
    expect(await p.stored()).toEqual([expect.objectContaining({ applicationId: record.applicationId, joinDid: ME })])
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toEqual(record)
    expect(mockLogged).toContain(
      '[hidden-vetting] an ended application was not closed at the agent; tried again at the next unlock'
    )
    expect(await p.community.getMembership(COMMUNITY, ME)).toMatchObject({ personaDid: ME })

    p.vta.mayApply = true
    await nextUnlock(p.agent)
    expect(p.vta.held.has(record.applicationId)).toBe(false)
    expect(await p.stored()).toEqual([expect.objectContaining({ closed: 'joined', joinDid: ME })])
  })

  it('an application the agent no longer holds (notFound) counts as destroyed: closed here, not retried', async () => {
    const p = await newPhone()
    const record = await p.apply()
    // Destroyed at the agent already: an earlier delete went through and the phone stopped before its note.
    p.vta.held.delete(record.applicationId)

    await later()
    await keepForPersona(p.agent, p.persona(ME), membershipCard(ME) as never)
    await until('the delete was tried', async () => p.vta.deletesSent().length > 0)
    await settle()

    expect(await p.stored()).toEqual([expect.objectContaining({ closed: 'joined', joinDid: ME })])
    expect(mockLogged.filter((l) => l.includes('[hidden-vetting]'))).toEqual([])
    await nextUnlock(p.agent)
    expect(p.vta.deletesSent()).toEqual([record.applicationId])
  })
})

describe('a lock while a sweep runs, on real stores', () => {
  it("the sweep a new agent's card asks for runs on the new agent, and closes its application then", async () => {
    // The phone before the lock: a join went through, and the agent has not answered the delete yet.
    const before = await newPhone()
    const meBefore = ME
    await before.apply()
    let answer: () => void = () => undefined
    before.vta.answerDeleteAfter = new Promise<void>((resolve) => (answer = resolve))
    await later()
    await keepForPersona(before.agent, before.persona(meBefore), membershipCard(meBefore) as never)
    await until('the first sweep is waiting on the agent', async () => before.vta.deletesSent().length > 0)

    // Locked: the agent is shut down, as a lock-out does, with that sweep still running.
    await before.agent.shutdown()

    // Unlocked: a new agent, whose own join goes through while the first sweep still runs. Its card asks for a sweep.
    const after = await newPhone()
    const meAfter = ME
    const record = await after.apply()
    await later()
    await keepForPersona(after.agent, after.persona(meAfter), membershipCard(meAfter) as never)

    // The first sweep ends (its store is closed, so it can't write its note). Nothing else asks for a sweep after
    // this: what closes the new agent's application can only be the one its card asked for.
    answer()
    await until("the new agent's application is closed", async () =>
      (await after.stored()).some((s) => s.closed !== undefined)
    )
    expect(after.vta.deletesSent()).toEqual([record.applicationId])
    expect(after.vta.held.has(record.applicationId)).toBe(false)
    expect(await after.stored()).toEqual([expect.objectContaining({ closed: 'joined', joinDid: meAfter })])
  })
})
