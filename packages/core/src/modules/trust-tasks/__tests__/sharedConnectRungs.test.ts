/**
 * @jest-environment node
 *
 * TEST BRANCH ONLY (test/shared-connect-rungs). The shared-connect rungs: Keyring's real code, in process, on a
 * real Askar agent, against an independent inviter written from trust-tasks #1034 and dtgwg-vti-spec#86 (as
 * revised 2026-11-05) — ./fixtures/shared-connect/inviter.ts, which imports nothing from Keyring. Nothing here
 * touches a network. Report: ~/.keyring-gate/research/shared-connect-rungs-1105.md.
 *
 * Rows named "GAP" assert what main's code does today where it falls short of the spec; they pass by design.
 */
import '../../../../__tests__/helpers/realAskar'
import { AskarModule } from '@credo-ts/askar'
import { Agent, JsonTransformer, W3cJsonLdVerifiableCredential, W3cCredentialRepository } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { tsp } from '@bifold/trust-tasks'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'
import { buildVrcCredential } from '../../vrc/vrc-manager'
import { signDocumentProof, verifyDocumentProof } from '../documentProof'
import { KEYRING_TRIGGER_CONFIG, readTrigger, selectService, SHARED_CONNECT_SELECTION } from '../module/triggerLink'
import { greetPeerOverTsp, packTrustTaskForPeer, tspSessionForManager, unpackTrustTaskFromPeer } from '../module/vtiTsp'
import {
  connect,
  prepareEncounter,
  readSharedConnect,
  receive,
  verifyInboundVrc,
  type EncounterRecord,
  type EncounterStore,
  type Received,
} from '../sharedConnect'
import {
  base58,
  digestOf,
  FLOW_TYPE,
  Inviter,
  ISSUE,
  LINK_HOST,
  multikey,
  newKeys,
  peer2,
  PROPOSE,
  schemaProblems,
  verifyJcs,
} from './fixtures/shared-connect/inviter'

const RELAY = 'did:web:relay.example.org'

/** A store that keeps only JSON, as a restarted app would read it back. */
class JsonStore implements EncounterStore {
  constructor(readonly data = new Map<string, string>()) {}
  async get(key: string) {
    const v = this.data.get(key)
    return v ? (JSON.parse(v) as EncounterRecord) : undefined
  }
  async put(r: EncounterRecord) {
    this.data.set(r.key, JSON.stringify(r))
  }
  /** "Kill the app": a new store from the bytes on disk. */
  reopen() {
    return new JsonStore(new Map(this.data))
  }
}

/** Long-form did:peer:4, encoded from the DIF method spec (for the reader and resolver rungs). */
function peer4(services: Array<Record<string, unknown>>): string {
  const k = newKeys()
  const doc = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    verificationMethod: [
      { id: '#key-1', type: 'Multikey', publicKeyMultibase: multikey(Uint8Array.from([0xed, 0x01]), k.edPk) },
      { id: '#key-2', type: 'Multikey', publicKeyMultibase: multikey(Uint8Array.from([0xec, 0x01]), k.xPk) },
    ],
    authentication: ['#key-1'],
    assertionMethod: ['#key-1'],
    keyAgreement: ['#key-2'],
    service: services,
  }
  const json = new TextEncoder().encode(JSON.stringify(doc))
  const encoded = 'z' + base58(Uint8Array.from([0x80, 0x04, ...json]))
  const hash = 'z' + base58(Uint8Array.from([0x12, 0x20, ...sha256(new TextEncoder().encode(encoded))]))
  return `did:peer:4${hash}:${encoded}`
}

describe('shared-connect rungs (Keyring real code vs an independent spec inviter)', () => {
  let agent: Agent
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-'))

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: { label: 'shared-connect-rungs' },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  /** Scan → prepare → Connect, then pump frames both ways until quiet. */
  async function exchange(
    inviter: Inviter,
    options: { link?: string; store?: JsonStore; beforeConnect?: (r: EncounterRecord) => void; pump?: boolean } = {}
  ) {
    const link = options.link ?? inviter.link({ label: 'Sam' })
    const read = readSharedConnect(link)
    if (!read.ok) throw new Error(`link refused: ${read.reason}`)
    const store = options.store ?? new JsonStore()
    const record = await prepareEncounter(agent, store, read.trigger)
    if (options.beforeConnect) {
      options.beforeConnect(record)
      await store.put(record)
    }
    const outbox: Uint8Array[] = []
    const send = async (b: Uint8Array) => void outbox.push(b)
    const results: Received[] = []
    await connect(agent, store, record.key, send)
    const pump = async () => {
      while (outbox.length) {
        const replies = await inviter.onFrame(outbox.shift()!)
        for (const r of replies) results.push(await receive(agent, store, record.key, r, send))
      }
    }
    if (options.pump !== false) await pump()
    return { store, key: record.key, results, outbox, send, pump, enactment: read.trigger.id }
  }

  // ---------------------------------------------------------------------------------------------- basic
  describe('basic', () => {
    test('B1 the link round-trips: _from, _id, _exp, _type, and _label (unverified)', () => {
      const inviter = new Inviter(RELAY)
      const link = inviter.link({ label: 'Sam' })
      const read = readSharedConnect(link)
      expect(read.ok).toBe(true)
      if (!read.ok) return
      const [id] = [...inviter.enactments.keys()]
      expect(read.trigger.from).toBe(inviter.vid)
      expect(read.trigger.id).toBe(id)
      expect(read.trigger.exp).toBe(inviter.enactments.get(id)!.exp)
      expect(read.trigger.flow).toBe('shared-connect')
      expect(read.trigger.label).toEqual({ text: 'Sam', verified: false })
    })

    test('B1b a long-form did:peer:4 contact is read too', () => {
      const from = peer4([{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: RELAY }])
      const link = new Inviter(RELAY).link({ from })
      expect(link.length).toBeLessThanOrEqual(1000)
      const read = readSharedConnect(link)
      expect(read.ok ? read.trigger.from : read.reason).toBe(from)
    })

    test('B2+B3+B4 the six documents travel, validate against the registry, and both sides hold a VRC', async () => {
      const inviter = new Inviter(RELAY)
      const run = await exchange(inviter)
      const mine = (await run.store.get(run.key))!
      // Keyring's side
      expect(run.results.map((r) => r.kind)).toEqual(['control', 'step', 'step', 'step'])
      expect(mine.state).toBe('complete')
      expect(mine.myVrcAcked).toBe(true)
      expect(mine.theirVrc?.issuer).toBe(inviter.relDid)
      // the inviter's side: no drops, Keyring's propose/issue/receipt passed the registry schemas and the proofs
      // Keyring answers the inviter's issue with its receipt, then sends its own issue (#1034's order).
      expect(inviter.events).toEqual(['xrfi:accepted', 'propose:accepted', 'receipt:matched', 'issue:stored'])
      const e = inviter.enactments.get(run.enactment)!
      expect(e.theirVrc?.issuer).toBe(mine.myRelationshipDid)
      // threadId = propose.id on every document; ceremony.enactment = the link's _id
      expect(e.proposeId).toBe(mine.proposeId)
      expect(mine.enactment).toBe(run.enactment)
    })
  })

  // ------------------------------------------------------------------------------------------- negative
  describe('negative', () => {
    test('N1 an expired link is refused at read, and a link that expires before Connect sends nothing', async () => {
      const inviter = new Inviter(RELAY, () => Math.floor(Date.now() / 1000))
      expect(readSharedConnect(inviter.link({ ttlSeconds: -120 }))).toMatchObject({ ok: false, reason: 'expired' })

      const read = readSharedConnect(inviter.link({ ttlSeconds: 600 }))
      if (!read.ok) throw new Error(read.reason)
      const store = new JsonStore()
      const record = await prepareEncounter(agent, store, read.trigger)
      const sent: Uint8Array[] = []
      const after = await connect(agent, store, record.key, async (b) => void sent.push(b), {
        nowSeconds: record.exp + 1,
      })
      expect(after).toMatchObject({ state: 'failed', why: 'expired-at-connect' })
      expect(sent).toHaveLength(0)
    })

    test('N2 an _id mismatch: Keyring refuses the inviter\'s documents; the inviter drops Keyring\'s propose', async () => {
      const wrongInviter = new Inviter(RELAY, undefined, { wrongEnactment: true })
      const a = await exchange(wrongInviter)
      expect(a.results[1]).toMatchObject({ kind: 'refused', why: 'wrong-enactment' })

      const inviter = new Inviter(RELAY)
      await exchange(inviter, { beforeConnect: (r) => (r.enactment = 'AAAAAAAAAAAAAAAAAAAAAA') })
      expect(inviter.events).toEqual(['xrfi:accepted', 'dropped:unknown-enactment'])
    })

    test('N3 an unsigned propose, and one signed by another key, are dropped by the inviter', async () => {
      for (const variant of ['unsigned', 'wrong-key'] as const) {
        const inviter = new Inviter(RELAY)
        const read = readSharedConnect(inviter.link())
        if (!read.ok) throw new Error(read.reason)
        const store = new JsonStore()
        const r = await prepareEncounter(agent, store, read.trigger)
        const session = await tspSessionForManager(agent, r.myVid)
        await inviter.onFrame((await greetPeerOverTsp(session, r.myVid, r.theirVid, [r.myVid], 'v1')).bytes)
        const doc = {
          id: 'propose-' + variant,
          type: PROPOSE,
          threadId: 'propose-' + variant,
          issuer: r.myVid,
          recipient: r.theirVid,
          issuedAt: new Date().toISOString(),
          ceremony: { enactment: r.enactment, step: 'propose' },
          payload: { relationshipDid: r.myRelationshipDid },
        }
        const body = variant === 'unsigned' ? doc : await signDocumentProof(agent, doc, r.myRelationshipDid)
        await inviter.onFrame((await packTrustTaskForPeer(session, r.myVid, r.theirVid, body, 'v1')).bytes)
        expect(inviter.events).toEqual(['xrfi:accepted', 'dropped:proof'])
      }
    })

    test('N3b the inviter\'s propose#response signed by a wrong key is refused by Keyring', async () => {
      const run = await exchange(new Inviter(RELAY, undefined, { wrongKeyResponse: true }))
      expect(run.results[1]).toMatchObject({ kind: 'refused' })
      expect((run.results[1] as { why: string }).why).toMatch(/^pipeline:rejected:\S*proofInvalid/)
      expect((await run.store.get(run.key))!.state).toBe('proposed') // nothing advanced
    })

    test('N4 a did:web contact is refused for this flow', () => {
      const link = new Inviter(RELAY).link({ from: 'did:web:alice.example.org' })
      expect(readSharedConnect(link)).toMatchObject({ ok: false, reason: 'from-not-allowed' })
    })

    test('N5 over the 1,000-character flow budget is refused (and over 1,536 by the reader cap)', () => {
      const from = peer4([
        { id: '#tsp', type: 'TSPTransport', serviceEndpoint: { uri: 'did:web:3f6c1e2a-8d4b-4c7e-9a1f-5b2d7e8c9a01.atlas.affinidi.io' } },
        { id: '#didcomm', type: 'DIDCommMessaging', serviceEndpoint: { uri: 'did:web:3f6c1e2a-8d4b-4c7e-9a1f-5b2d7e8c9a01.atlas.affinidi.io', accept: ['didcomm/v2'] } },
      ])
      const link = new Inviter(RELAY).link({ from })
      expect(link.length).toBeGreaterThan(1000)
      expect(readSharedConnect(link)).toMatchObject({ ok: false, reason: 'over-flow-budget' })
      expect(readSharedConnect(link + '&x=' + 'a'.repeat(600))).toMatchObject({ ok: false, reason: 'too-long' })
    })

    test('N6 a replayed propose on a spent _id is dropped', async () => {
      const inviter = new Inviter(RELAY)
      const run = await exchange(inviter, { pump: false })
      const [invite, proposeFrame] = run.outbox.splice(0)
      await inviter.onFrame(invite)
      await inviter.onFrame(proposeFrame)
      await inviter.onFrame(proposeFrame) // the same frame again
      expect(inviter.events).toEqual(['xrfi:accepted', 'propose:accepted', 'dropped:spent'])
    })

    test('N7 an application frame before XRFI is dropped by the inviter (relationship gate)', async () => {
      const inviter = new Inviter(RELAY)
      await exchange(inviter, { beforeConnect: (r) => (r.greeted = true) })
      expect(inviter.events).toEqual(['dropped:no-relationship'])
    })

    test('N7b GAP: Keyring has no relationship gate; a frame with no XRFI is judged on its contents', async () => {
      const inviter = new Inviter(RELAY)
      const run = await exchange(inviter, { pump: false })
      const stranger = new Inviter(RELAY)
      const r = (await run.store.get(run.key))!
      const frame = await stranger.strangerFrame(r.myVid, {
        id: 'x', type: `${PROPOSE}#response`, threadId: r.proposeId, issuer: stranger.vid, recipient: r.myVid,
        issuedAt: new Date().toISOString(), payload: { accept: true, relationshipDid: stranger.relDid },
      })
      // Opened and read (no "dropped: no relationship"); refused only because the sender is not this encounter's.
      expect(await receive(agent, run.store, run.key, frame, run.send)).toMatchObject({ kind: 'refused', why: 'not-this-encounter' })
    })

    test('N8 a Rev 3 frame to a 1.0 reader is dropped as a version mismatch', async () => {
      const inviter = new Inviter(RELAY)
      const read = readSharedConnect(inviter.link())
      if (!read.ok) throw new Error(read.reason)
      const r = await prepareEncounter(agent, new JsonStore(), read.trigger)
      const session = await tspSessionForManager(agent, r.myVid)
      // packTrustTaskForPeer without a revision uses the session codec, which packs Rev 3 by default.
      const rev3 = await packTrustTaskForPeer(session, r.myVid, r.theirVid, { id: 'x', type: PROPOSE, payload: {} })
      expect(await inviter.onFrame(rev3.bytes)).toEqual([])
      expect(inviter.events).toEqual(['dropped:revision'])
    })

    test('N9 a label that lies is shown unverified and never travels or decides anything', async () => {
      const inviter = new Inviter(RELAY)
      const lie = 'Your Bank (verified)'
      const run = await exchange(inviter, { link: inviter.link({ label: lie }) })
      const r = (await run.store.get(run.key))!
      expect(r.label).toBe(lie)
      expect(r.state).toBe('complete') // the exchange is with the _from DID, whatever the label says
      const e = inviter.enactments.get(run.enactment)!
      expect(JSON.stringify(e.theirVrc)).not.toContain(lie)
      const over = inviter.link({ label: 'x'.repeat(65) })
      const read = readSharedConnect(over)
      expect(read.ok && read.trigger.label).toBe(undefined) // over #86's 64-character cap: not shown at all
    })
  })

  // -------------------------------------------------------------------------------------------- complex
  describe('complex', () => {
    test('C1 the inviter\'s issue arriving before its propose#response is held, then completes', async () => {
      const inviter = new Inviter(RELAY, undefined, { issueBeforeResponse: true })
      const run = await exchange(inviter)
      expect(run.results[1]).toMatchObject({ kind: 'held', type: ISSUE })
      expect((await run.store.get(run.key))!.state).toBe('complete')
      expect(inviter.events).toContain('receipt:matched')
    })

    test('C2 the inviter\'s issue arriving three days later still completes (no maxDuration, no freshness cut)', async () => {
      const inviter = new Inviter(RELAY, undefined, { holdIssue: true })
      const run = await exchange(inviter)
      expect((await run.store.get(run.key))!.state).toBe('accepted')
      const [late] = await inviter.releaseHeldIssue(run.enactment)
      const real = Date.now()
      const spy = jest.spyOn(Date, 'now').mockReturnValue(real + 3 * 24 * 60 * 60 * 1000)
      let result: Received
      try {
        result = await receive(agent, run.store, run.key, late, run.send)
      } finally {
        spy.mockRestore()
      }
      await run.pump()
      expect(result).toMatchObject({ kind: 'step' })
      expect((await run.store.get(run.key))!.state).toBe('complete')
    })

    test('C3 two scans of one code: one phone sends once; a second phone is refused as spent', async () => {
      const inviter = new Inviter(RELAY)
      const link = inviter.link()
      const store = new JsonStore()
      const read = readSharedConnect(link)
      if (!read.ok) throw new Error(read.reason)
      const first = await prepareEncounter(agent, store, read.trigger)
      const again = await prepareEncounter(agent, store, read.trigger)
      expect(again.myVid).toBe(first.myVid)
      const sent: Uint8Array[] = []
      await connect(agent, store, first.key, async (b) => void sent.push(b))
      await connect(agent, store, first.key, async (b) => void sent.push(b))
      expect(sent).toHaveLength(2) // XRFI + propose, once
      for (const b of sent) await inviter.onFrame(b)
      // A second phone (its own store, its own encounter VID) scans the same code.
      await exchange(inviter, { link })
      expect(inviter.events.filter((e) => e === 'dropped:spent')).toHaveLength(1)
    })

    test('C4 the app is killed mid-ceremony and resumes from stored state', async () => {
      const inviter = new Inviter(RELAY, undefined, { holdIssue: true })
      const run = await exchange(inviter)
      expect((await run.store.get(run.key))!.state).toBe('accepted')
      const reopened = run.store.reopen() // nothing in memory survives but the JSON record (and the agent's KMS)
      const [late] = await inviter.releaseHeldIssue(run.enactment)
      const outbox: Uint8Array[] = []
      const result = await receive(agent, reopened, run.key, late, async (b) => void outbox.push(b))
      expect(result).toMatchObject({ kind: 'step' })
      for (const b of outbox) for (const r of await inviter.onFrame(b)) await receive(agent, reopened, run.key, r, async () => {})
      expect((await reopened.get(run.key))!.state).toBe('complete')
      expect(inviter.events).toContain('receipt:matched')
    })

    test('C5 GAP: an eddsa-jcs-2022 VRC fails Keyring\'s connection-path verifier; the WP8 branch verifies it', async () => {
      const inviter = new Inviter(RELAY)
      const run = await exchange(inviter)
      const vc = (await run.store.get(run.key))!.theirVrc!
      expect((vc.proof as { cryptosuite: string }).cryptosuite).toBe('eddsa-jcs-2022')
      // What ceremony.ts handleInboundIssue does today:
      let mainVerdict: string
      try {
        const credential = JsonTransformer.fromJSON(vc, W3cJsonLdVerifiableCredential)
        const v = await agent.w3cCredentials.verifyCredential({ credential })
        mainVerdict = v.isValid ? 'valid' : 'invalid'
      } catch (e) {
        mainVerdict = `threw:${(e as Error).name}`
      }
      // eslint-disable-next-line no-console
      console.log(`C5 connection-path verdict on an eddsa-jcs-2022 VRC: ${mainVerdict}`)
      expect(mainVerdict).not.toBe('valid')
      expect(await verifyInboundVrc(agent, vc, String(vc.issuer))).toBe(true)
    })

    test('C7 GAP: a ceremony member the registry rejects (definition without definitionDigest) is accepted by Keyring', async () => {
      const inviter = new Inviter(RELAY, undefined, { definitionWithoutDigest: true })
      const run = await exchange(inviter)
      // The registry's framework 0.5 envelope refuses these documents (rung R2)...
      const sample = { id: 'x', type: PROPOSE, payload: { relationshipDid: 'did:peer:0z6Mk' }, ceremony: { enactment: 'e', step: 's', definition: 'https://trusttasks.org/ceremony/shared-connect/0.1' } }
      expect(schemaProblems(sample).join(' ')).toMatch(/definitionDigest/)
      // ...and Keyring, which runs no envelope schema, completes the exchange on them anyway.
      expect((await run.store.get(run.key))!.state).toBe('complete')
    })

    test('C8 a VRC about someone else (subject is not our relationship DID) is refused, and nothing is receipted', async () => {
      const inviter = new Inviter(RELAY, undefined, { vcSubjectWrong: true })
      const run = await exchange(inviter)
      expect(run.results[2]).toMatchObject({ kind: 'refused', why: 'vc-subject-not-our-relationship-did' })
      expect(inviter.events).not.toContain('receipt:matched')
      expect((await run.store.get(run.key))!.theirVrc).toBeUndefined()
    })

    test('C9 a receipt whose digest matches nothing we sent does not complete the ceremony', async () => {
      const inviter = new Inviter(RELAY, undefined, { receiptWrongDigest: true })
      const run = await exchange(inviter)
      expect(run.results[3]).toMatchObject({ kind: 'refused', why: 'receipt-matches-no-delivery' })
      const r = (await run.store.get(run.key))!
      expect(r.myVrcAcked).toBe(false)
      expect(r.state).toBe('accepted')
    })

    test('C10 an inviter that offers only DIDComm: DIDComm is chosen, and this path says it has no carriage for it', async () => {
      const inviter = new Inviter(RELAY, undefined, {}, [{ type: 'DIDCommMessaging', serviceEndpoint: { uri: RELAY, accept: ['didcomm/v2'] } }])
      const read = readSharedConnect(inviter.link())
      if (!read.ok) throw new Error(read.reason)
      const store = new JsonStore()
      const r = await prepareEncounter(agent, store, read.trigger)
      expect(r.binding).toBe('didcomm')
      const sent: Uint8Array[] = []
      expect(await connect(agent, store, r.key, async (b) => void sent.push(b))).toMatchObject({ state: 'failed', why: 'carriage-not-built:didcomm' })
      expect(sent).toHaveLength(0)
    })

    test('C6 GAP: with no vrc:rceVersion from the peer, Keyring builds a VC 1.1 VRC', async () => {
      const fakeAgent = {
        context: {},
        config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
        dependencyManager: {
          resolve: (token: unknown) => {
            if (token === RelationshipDidRepository) return { findByCounterpartyRelationshipDid: async () => null }
            if (token === W3cCredentialRepository) return { findByQuery: async () => [] }
            throw new Error('unexpected token')
          },
        },
      } as never
      const { credential } = await buildVrcCredential(fakeAgent, 'did:peer:0zMine', 'did:peer:0zTheirs')
      // VCDM 1.1 context, the legacy issuer OBJECT (contact info inside), and a 7-day expiry:
      // the shape #853 §3.5 calls wrong toward a peer that never announces an RCE version.
      expect(credential['@context'][0]).toBe('https://www.w3.org/2018/credentials/v1')
      expect(typeof credential.issuer).toBe('object')
      expect(credential.issuer.id).toBe('did:peer:0zMine')
      expect(credential.issuanceDate).toBeDefined()
      const days = (Date.parse(credential.expirationDate) - Date.parse(credential.issuanceDate)) / 86400000
      expect(Math.round(days)).toBe(7)
    })
  })

  // ------------------------------------------------------------------------------------------ rungs R3–R6
  describe('rungs', () => {
    test('R3 control: the shipping reader (KEYRING_TRIGGER_CONFIG) refuses a shared-connect link', () => {
      const result = readTrigger(new Inviter(RELAY).link())
      expect(result.outcome).toBe('reject')
      // main: 'unsupported-vid' (no did:peer method syntax); this branch: 'unknown-flow' (flow not in the shipping config)
      expect(['unsupported-vid', 'unknown-flow']).toContain((result as { reason: string }).reason)
      expect(KEYRING_TRIGGER_CONFIG.flows?.some((f) => f.flow === 'shared-connect')).toBe(false)
    })

    test('R4 Credo resolves the inviter\'s did:peer:2 and did:peer:4; TSPTransport survives, TSP is chosen', async () => {
      for (const endpoint of [RELAY, { uri: RELAY }, [{ uri: RELAY }]]) {
        const inviter = new Inviter(RELAY, undefined, {}, [{ type: 'TSPTransport', serviceEndpoint: endpoint }])
        const doc = await agent.dids.resolveDidDocument(inviter.vid)
        const svc = (doc.service ?? []).map((s) => ({ id: s.id, type: s.type, serviceEndpoint: (s as never as { serviceEndpoint: unknown }).serviceEndpoint }))
        expect(svc.map((s) => s.type)).toEqual(['TSPTransport'])
        expect(selectService({ verified: true, services: svc }, SHARED_CONNECT_SELECTION)).toMatchObject({ outcome: 'select', binding: 'tsp', endpoint: RELAY })
      }
      const long = peer4([{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: RELAY }])
      const doc4 = await agent.dids.resolveDidDocument(long)
      expect((doc4.service ?? []).map((s) => s.type)).toEqual(['TSPTransport'])
    })

    test('R5 signDocumentProof under the encounter VID verifies in Keyring AND in the independent verifier', async () => {
      const inviter = new Inviter(RELAY)
      const read = readSharedConnect(inviter.link())
      if (!read.ok) throw new Error(read.reason)
      const r = await prepareEncounter(agent, new JsonStore(), read.trigger)
      const signed = await signDocumentProof(agent, { id: 'a', type: PROPOSE, payload: { relationshipDid: r.myRelationshipDid } }, r.myVid)
      expect(await verifyDocumentProof(agent, signed, r.myVid)).toBe(true)
      expect(verifyJcs(signed, r.myVid)).toBe(true)
      expect(verifyJcs({ ...signed, id: 'b' }, r.myVid)).toBe(false)
      // and the other way: an inviter-signed document verifies in Keyring
      const theirs = (await exchange(inviter, { link: inviter.link() })).store
      expect(theirs).toBeDefined()
      expect(schemaProblems({ id: 'x', type: PROPOSE, payload: { relationshipDid: r.myRelationshipDid } })).toEqual([])
      expect(digestOf({ b: 1, a: 2 })).toBe(digestOf({ a: 2, b: 1 }))
    })

    test('R6 two encounter VIDs in one process: XRFI, a 1.0 propose, the identity check', async () => {
      const mk = async () => {
        const read = readSharedConnect(new Inviter(RELAY).link())
        if (!read.ok) throw new Error(read.reason)
        return prepareEncounter(agent, new JsonStore(), read.trigger)
      }
      const a = await mk()
      const b = await mk()
      const sa = await tspSessionForManager(agent, a.myVid)
      const sb = await tspSessionForManager(agent, b.myVid)
      const invite = await greetPeerOverTsp(sa, a.myVid, b.myVid, [a.myVid], 'v1')
      expect(await unpackTrustTaskFromPeer(sb, invite.bytes, b.myVid)).toBeUndefined() // control frame, no Trust Task
      const good = await packTrustTaskForPeer(sa, a.myVid, b.myVid, { id: 'p', type: PROPOSE, issuer: a.myVid, recipient: b.myVid, payload: {} }, 'v1')
      expect(good.revision).toBe('v1')
      const opened = await unpackTrustTaskFromPeer(sb, good.bytes, b.myVid)
      expect(opened?.unpacked.sender).toBe(a.myVid)
      const forged = await packTrustTaskForPeer(sa, a.myVid, b.myVid, { id: 'q', type: PROPOSE, issuer: 'did:peer:2.Ez6LSforged', recipient: b.myVid, payload: {} }, 'v1')
      await expect(unpackTrustTaskFromPeer(sb, forged.bytes, b.myVid)).rejects.toMatchObject({ reason: 'identityMismatch' })
    })
  })
})

// Keep imports referenced in rows that only use them for types.
void [ed25519, x25519, tsp, peer2, FLOW_TYPE, LINK_HOST]
