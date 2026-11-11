/**
 * A state Guardian card carried from the approver's phone to the person's (approver/guardian-evidence/0.1) and checked
 * there with sedi/guardian's verifyGuardian, over the K0 kit's real chain (sedi/__tests__/fixtures/k0-utah-v2). Each
 * refusal has a control that differs from it in the one thing refused; the screen rows render the real Who approves
 * over the same stored records.
 *
 * The K0 Guardian credential expires 2030-11-10; these rows read the real clock.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, render } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'
import { trustTaskPayloadValidator } from '@bifold/trust-tasks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as guardianModule from '../../sedi/guardian'
import * as stateRoots from '../../sedi/guardian/stateRoots'
import * as approverRole from '../approverRole'
import {
  GUARDIAN_EVIDENCE_MAX_BYTES,
  GUARDIAN_EVIDENCE_SPEC,
  GUARDIAN_EVIDENCE_TYPE_URI,
  TYPE_URI,
  type GuardianEvidencePayload,
} from '../approverRoleSpec'
import {
  GUARDIAN_EVIDENCE_HELD,
  checkGuardianEvidence,
  evidenceBytes,
  guardianStandings,
  handleGuardianEvidence,
  holdGuardianEvidence,
  sendGuardianEvidence,
  setStateWard,
  type GuardianEvidence,
  type GuardianOnAsk,
} from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { setTrustTestStateEnabled } from '../module/trustTestStateFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'
import VtaTrustedApprovers, { TrustedApproversIds } from '../screens/VtaTrustedApprovers'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../documentProof', () => ({
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: { p: 1 } })),
  verifyDocumentProof: jest.fn(async () => true),
}))
const sent: Record<string, unknown>[] = []
jest.mock('../ceremony', () => ({
  getTrustTasksService: () => ({ retain: jest.fn(async () => undefined) }),
  sendTrustTaskDocument: jest.fn(async (_agent: unknown, _conn: string, doc: Record<string, unknown>) => {
    sent.push(doc)
  }),
}))

// ---------------------------------------------------------------------------------------------------------------
// The K0 chain

const FX = join(__dirname, '..', '..', 'sedi', '__tests__', 'fixtures', 'k0-utah-v2')
const text = (f: string) => readFileSync(join(FX, f), 'utf8')
const prov = JSON.parse(text('PROVENANCE.json')) as {
  aids: Record<string, string>
  creds: Record<string, { said: string }>
}
const SAM_WARD = prov.aids.sam
const OTHER_WARD = prov.aids['other-ward']
const JORDAN_AID = prov.aids.jordan

const tel = (stem: string, states: string[]) => ({
  ripText: text(`tel-${stem}-rip.json`),
  updateTexts: states.map((s) => text(`tel-${stem}-${s}.json`)),
})
/** The card for one of K0's Guardian credentials, with exactly the chain it needs. */
function card(name: 'G-ok' | 'G-revoked' | 'G-untrusted'): GuardianEvidence {
  const mal = name === 'G-untrusted'
  const [unit, agent] = mal ? ['mal-unit', 'mal-agent'] : ['unit', 'agent']
  const states = name === 'G-revoked' ? ['issued', 'revoked'] : ['issued']
  return {
    guardianSaid: prov.creds[name].said,
    holder: JORDAN_AID,
    kels: (mal ? ['mal-root', 'mal-org', 'mal-agent', 'jordan'] : ['roy', 'deb', 'sue', 'jordan']).map((k) =>
      text(`kel-${k}.cesr`)
    ),
    tels: [tel(unit, ['issued']), tel(agent, ['issued']), tel(name, states)],
    creds: [
      text(`acdc-${unit}-issued-proofed.cesr`),
      text(`acdc-${agent}-issued-proofed.cesr`),
      text(`acdc-${name}-${states[states.length - 1]}-proofed.cesr`),
    ],
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A phone

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const AMY = 'did:peer:2.amys-phone'
const CONN = 'c-jordan'

type Row = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

function phone() {
  const rows: Row[] = []
  let n = 0
  const warn = jest.fn()
  const update = jest.fn(async (record: Row) => {
    const i = rows.findIndex((r) => r.id === record.id)
    rows[i] = { ...record, content: JSON.parse(JSON.stringify(record.content)) }
  })
  const consume = jest.fn(async (_ctx: unknown, _opts: { document: Record<string, unknown> }) => ({
    kind: 'handled' as const,
  }))
  const agent = {
    context: {},
    config: { logger: { warn, info: jest.fn() } },
    genericRecords: {
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        rows
          .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
          .map((r) => ({ ...r, content: JSON.parse(JSON.stringify(r.content)) }))
      ),
      save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        rows.push({ id: `r${++n}`, content: JSON.parse(JSON.stringify(content)), tags })
      }),
      update,
      deleteById: jest.fn(),
      delete: jest.fn(),
    },
    dependencyManager: {
      resolve: () => ({
        getAll: async () => [
          {
            connectionId: CONN,
            myRelationshipDid: 'did:peer:2.mine',
            counterpartyRelationshipDid: 'did:peer:2.theirs',
          },
        ],
      }),
    },
    modules: { didcomm: { connections: { getById: async () => ({ did: 'did:peer:me', theirDid: 'did:peer:them' }) } } },
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(7) },
  }
  const service = { consume } as never
  const ask = (over: Partial<approverRole.RoleOfferAsk> = {}) =>
    rows.push({
      id: `r${++n}`,
      tags: { recordType: approverRole.ROLE_OFFER_ASK, connectionId: CONN },
      content: {
        state: 'accepted',
        connectionId: CONN,
        threadId: 't-1',
        agentDid: SAM_AGENT,
        actions: ['joinCommunity'],
        challenge: 'c'.repeat(43),
        askedAt: new Date().toISOString(),
        acceptedAs: JORDAN,
        ...over,
      },
    })
  const askRecord = () =>
    rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)?.content as unknown as approverRole.RoleOfferAsk
  return { agent: agent as never, rows, warn, update, consume, service, ask, askRecord, raw: agent }
}

const documentOf = (evidence: GuardianEvidence, over: Partial<GuardianEvidencePayload> = {}) => ({
  id: 'doc-1',
  type: GUARDIAN_EVIDENCE_TYPE_URI,
  threadId: 'doc-1',
  issuer: 'did:peer:them',
  recipient: 'did:peer:me',
  issuedAt: new Date().toISOString(),
  payload: { agent: SAM_AGENT, approver: JORDAN, ...evidence, sentAt: new Date().toISOString(), ...over },
})
const schemaTakes = (payload: unknown) =>
  trustTaskPayloadValidator.validate(GUARDIAN_EVIDENCE_SPEC.payloadSchema, payload) === true
const context = { connectionId: CONN, recipientDid: 'did:peer:me', senderDid: 'did:peer:them' } as never

/** Sam's phone, its ward set to `ward` (null: none set), an accepted ask from Jordan, and `evidence` arriving. */
async function arrives(evidence: GuardianEvidence, ward: string | null = SAM_WARD, over = {}) {
  const sam = phone()
  if (ward !== null) await setStateWard(sam.agent, ward)
  sam.ask()
  await handleGuardianEvidence(sam.agent, sam.service, documentOf(evidence, over), context)
  return sam
}

const allOn = () => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}

beforeEach(() => {
  jest.restoreAllMocks()
  sent.length = 0
  allOn()
})
afterAll(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
})

// ---------------------------------------------------------------------------------------------------------------

describe('the card and its cap', () => {
  test('the K0 chain is 13,234 bytes of raw text and well under the cap', () => {
    const c = card('G-ok')
    const raw = [...c.kels, ...c.tels.flatMap((t) => [t.ripText, ...t.updateTexts]), ...c.creds]
    expect(raw.reduce((sum, s) => sum + Buffer.byteLength(s, 'utf8'), 0)).toBe(13234)
    expect(evidenceBytes(c)).toBeLessThan(GUARDIAN_EVIDENCE_MAX_BYTES / 2)
  })

  test("the schema takes the K0 card and refuses one text over the cap or an extra field (control: K0's passes)", () => {
    expect(schemaTakes(documentOf(card('G-ok')).payload)).toBe(true)
    const big = { ...card('G-ok'), creds: ['x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES + 1)] }
    expect(schemaTakes(documentOf(big).payload)).toBe(false)
    expect(schemaTakes({ ...documentOf(card('G-ok')).payload, state: 'Utah' })).toBe(false)
  })

  test('a release trusts no root; a Developer build, or the test-state setting, only the K0 test root', () => {
    expect(stateRoots.stateRootsFor(false, false)).toEqual([])
    expect(stateRoots.stateRootsFor(true, false)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.stateRootsFor(false, true)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.stateRootsFor(true, true)).toEqual([stateRoots.K0_TEST_ROOT])
    expect(stateRoots.K0_TEST_ROOT.aid).toBe(JSON.parse(text('PROVENANCE.json')).trustedRoot)
    expect(stateRoots.K0_TEST_WARD).toBe(SAM_WARD)
  })
})

describe("on the person's phone: a card arrives", () => {
  test('a valid K0 card is kept on the ask in place, valid, named by our list', async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.consume).toHaveBeenCalledTimes(1)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: true, state: 'Test state (K0)' })
    expect(sam.askRecord().guardian?.approver).toBe(JORDAN)
    expect(sam.raw.genericRecords.deleteById).not.toHaveBeenCalled()
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test("the wrong ward: kept, couldn't verify as wardMismatch (control: the same card, Sam's ward, is valid)", async () => {
    const sam = await arrives(card('G-ok'), OTHER_WARD)
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'wardMismatch' })
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'wardMismatch' } })
  })

  test("no ward set on this phone: couldn't verify as noWard, never valid", async () => {
    const sam = await arrives(card('G-ok'), null)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'noWard' } })
  })

  test("a root not on our list: couldn't verify as untrustedRoot (control: the same card with its root listed is valid)", async () => {
    const sam = await arrives(card('G-untrusted'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' },
    })
    jest
      .spyOn(stateRoots, 'trustedStateRoots')
      .mockReturnValue([stateRoots.K0_TEST_ROOT, { aid: prov.aids['mal-root'], name: 'Another state' }])
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Another state' } })
  })

  test("a release's empty list verifies nothing: the valid K0 card reads couldn't verify", async () => {
    jest.spyOn(stateRoots, 'trustedStateRoots').mockReturnValue(stateRoots.stateRootsFor(false, false))
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({
      [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' },
    })
  })

  test("a revoked card: couldn't verify as revoked (control: G-ok on the same chain is valid)", async () => {
    const sam = await arrives(card('G-revoked'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'revoked' } })
  })

  test('over the cap: refused before its check, nothing kept, and logged (control: the K0 card above is taken)', async () => {
    const padded = { ...card('G-ok'), creds: [...card('G-ok').creds, 'x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES)] }
    const sam = await arrives(padded)
    expect(sam.consume).not.toHaveBeenCalled()
    expect(sam.askRecord().guardian).toBeUndefined()
    expect(sam.warn.mock.calls.map(String).join()).toMatch(/over the 65536 cap/)
  })

  test('a card that names another agent, or comes with no offer on the connection, is not kept', async () => {
    const sam = await arrives(card('G-ok'), SAM_WARD, { agent: 'did:webvh:someone-else.example' })
    expect(sam.askRecord().guardian).toBeUndefined()
    const none = phone()
    await handleGuardianEvidence(none.agent, none.service, documentOf(card('G-ok')), context)
    expect(none.rows.filter((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK)).toHaveLength(0)
  })

  test('a card that fails its proof check is not kept (control: handled, it is)', async () => {
    const sam = phone()
    sam.ask()
    sam.consume.mockResolvedValueOnce({ kind: 'rejected' } as never)
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.askRecord().guardian).toBeUndefined()
  })

  test.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: nothing is read or kept, and nothing is shown for a card kept earlier', async (_, off) => {
    const earlier = await arrives(card('G-ok'))
    expect(await guardianStandings(earlier.agent)).not.toEqual({})
    off()
    expect(await guardianStandings(earlier.agent)).toEqual({})
    const sam = phone()
    sam.ask()
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.consume).not.toHaveBeenCalled()
    expect(sam.askRecord().guardian).toBeUndefined()
  })
})

describe('tester builds: the Developer setting "Trust the test state (K0)"', () => {
  // jest runs as a Developer build (__DEV__ true); a TestFlight or OTA build is not one. Each row sets it.
  const g = globalThis as { __DEV__?: boolean }
  const wasDev = g.__DEV__
  const asBuild = (developer: boolean) => {
    g.__DEV__ = developer
  }
  afterEach(() => {
    g.__DEV__ = wasDev
    setTrustTestStateEnabled(false)
  })

  test('a release with the setting off verifies nothing (control: a Developer build verifies the same card)', async () => {
    asBuild(false)
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
    asBuild(true)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test('a release with the setting on verifies the K0 card as "Test state (K0)" (control: switched off again, it does not)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
    setTrustTestStateEnabled(false)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
  })

  test.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: a release trusts no root even with the setting on (control: all on, the K0 root)', (_, off) => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    expect(stateRoots.trustedStateRoots()).toEqual([stateRoots.K0_TEST_ROOT])
    off()
    expect(stateRoots.trustedStateRoots()).toEqual([])
  })

  test('it adds the K0 root only: a card from another root still reads untrustedRoot (control: the K0 card verifies)', async () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    const other = await arrives(card('G-untrusted'))
    expect(await guardianStandings(other.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'untrustedRoot' } })
    const sam = await arrives(card('G-ok'))
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test('the name shown is the test state, never one the card claims (control: the K0 root is named so)', () => {
    asBuild(false)
    setTrustTestStateEnabled(true)
    expect(stateRoots.K0_TEST_ROOT.name).toBe('Test state (K0)')
    const claims = { ...card('G-ok'), state: 'Utah', name: 'Utah' } as unknown as GuardianEvidence
    const verdict = checkGuardianEvidence(claims, SAM_WARD, new Date(), () => undefined)
    expect(verdict).toMatchObject({ ok: true, state: 'Test state (K0)', root: stateRoots.K0_TEST_ROOT.aid })
  })
})

describe('shown only beside the DID it was sent as, and checked again on open', () => {
  test('a card that overtakes the yes is kept and shown once the yes is in (control: before it, nothing)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'open', acceptedAs: undefined })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    expect(await guardianStandings(sam.agent)).toEqual({})
    const record = sam.rows.find((r) => r.tags.recordType === approverRole.ROLE_OFFER_ASK) as Row
    record.content = { ...record.content, state: 'accepted', acceptedAs: JORDAN }
    expect(Object.keys(await guardianStandings(sam.agent))).toEqual([JORDAN])
  })

  test('a valid card sent as one DID is never shown beside another (control: sent as the yes, it is)', async () => {
    const sam = await arrives(card('G-ok'), SAM_WARD, { approver: AMY })
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    expect(await guardianStandings(sam.agent)).toEqual({})
  })

  test('once written on the agent, it is shown beside the written DID', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })
  })

  test("on open the card is checked again: a changed ward turns a kept valid into couldn't verify, written in place", async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    sam.update.mockClear()
    await setStateWard(sam.agent, OTHER_WARD)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'wardMismatch' } })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'wardMismatch' })
    expect(sam.raw.genericRecords.deleteById).not.toHaveBeenCalled()
    // Control: unchanged, nothing is written.
    sam.update.mockClear()
    await guardianStandings(sam.agent)
    expect(sam.update).not.toHaveBeenCalled()
  })

  test("verifyGuardian throwing reads couldn't verify, is logged, and replaces a kept valid (control: no throw, valid)", async () => {
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'unverified', outcome: 'checkFailed' } })
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'checkFailed' })
    expect(sam.warn.mock.calls.map(String).join()).toMatch(/the check stopped on an error: boom/)
  })

  test('a re-offer keeps the card of the approver in force (control: a card sent as another DID does not stay)', async () => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(sam.agent, sam.service, documentOf(card('G-ok')), context)
    await approverRole.offerApproverRole(sam.agent, CONN, SAM_AGENT, ['joinCommunity', 'addDevice'])
    expect(sam.askRecord().state).toBe('open')
    expect(sam.askRecord().guardian?.approver).toBe(JORDAN)
    expect(await guardianStandings(sam.agent)).toEqual({ [JORDAN]: { kind: 'verified', state: 'Test state (K0)' } })

    const other = phone()
    other.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    await handleGuardianEvidence(other.agent, other.service, documentOf(card('G-ok'), { approver: AMY }), context)
    expect(other.askRecord().guardian?.approver).toBe(AMY)
    await approverRole.offerApproverRole(other.agent, CONN, SAM_AGENT, ['joinCommunity'])
    expect(other.askRecord().guardian).toBeUndefined()
  })

  test('verifyGuardian throwing on arrival keeps it as checkFailed, never valid', async () => {
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    const sam = await arrives(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict).toMatchObject({ ok: false, reason: 'checkFailed' })
  })
})

describe("on the approver's phone: sending the card after a yes", () => {
  const prompt = (): approverRole.RoleOfferPrompt => ({
    open: true,
    connectionId: CONN,
    asker: 'Sam',
    agentDid: SAM_AGENT,
    actions: ['joinCommunity'],
    request: {
      id: 'req-1',
      type: TYPE_URI,
      threadId: 'req-1',
      issuer: 'did:peer:them',
      recipient: 'did:peer:me',
      issuedAt: new Date().toISOString(),
      payload: { agent: SAM_AGENT, actions: ['joinCommunity'], challenge: 'c'.repeat(43) },
    },
    receivedAt: new Date().toISOString(),
  })
  const sayYes = async (jordan: ReturnType<typeof phone>) => {
    approverRole.roleOfferPromptStore.set(prompt())
    await approverRole.respondToRoleOffer(jordan.agent, CONN, true, JORDAN)
  }

  test('with a card held, the yes goes and then the card, for that agent and as that DID', async () => {
    const jordan = phone()
    expect(await holdGuardianEvidence(jordan.agent, card('G-ok'))).toBe('held')
    await sayYes(jordan)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer'), GUARDIAN_EVIDENCE_TYPE_URI])
    const payload = sent[1].payload as GuardianEvidencePayload
    expect(payload).toMatchObject({ agent: SAM_AGENT, approver: JORDAN, guardianSaid: prov.creds['G-ok'].said })
    expect(schemaTakes(payload)).toBe(true)
  })

  test('with no card held, only the yes goes (control: the row above)', async () => {
    const jordan = phone()
    await sayYes(jordan)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
  })

  test('a no sends no card', async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    approverRole.roleOfferPromptStore.set(prompt())
    await approverRole.respondToRoleOffer(jordan.agent, CONN, false)
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
  })

  test.each([
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
  ])('%s: no card is sent', async (_, off) => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    off()
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('off')
    expect(sent).toHaveLength(0)
  })

  test('over the cap: never held, and one held anyway is never sent (control: K0 is held and sent)', async () => {
    const jordan = phone()
    const padded = { ...card('G-ok'), creds: [...card('G-ok').creds, 'x'.repeat(GUARDIAN_EVIDENCE_MAX_BYTES)] }
    expect(await holdGuardianEvidence(jordan.agent, padded)).toBe('tooLarge')
    expect(jordan.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD)).toHaveLength(0)
    await jordan.raw.genericRecords.save({ content: { ...padded }, tags: { recordType: GUARDIAN_EVIDENCE_HELD } })
    expect(await sendGuardianEvidence(jordan.agent, CONN, SAM_AGENT, JORDAN)).toBe('tooLarge')
    expect(sent).toHaveLength(0)
    const ok = phone()
    await holdGuardianEvidence(ok.agent, card('G-ok'))
    expect(await sendGuardianEvidence(ok.agent, CONN, SAM_AGENT, JORDAN)).toBe('sent')
  })

  test('a card that fails to send leaves the yes standing', async () => {
    const jordan = phone()
    await holdGuardianEvidence(jordan.agent, card('G-ok'))
    const ceremony = jest.requireMock('../ceremony') as { sendTrustTaskDocument: jest.Mock }
    ceremony.sendTrustTaskDocument
      .mockImplementationOnce(async (_a: unknown, _c: string, doc: Record<string, unknown>) => {
        sent.push(doc)
      })
      .mockRejectedValueOnce(new Error('mediator down'))
    await expect(sayYes(jordan)).resolves.toBeUndefined()
    expect(sent.map((d) => d.type)).toEqual([expect.stringContaining('role-offer')])
    expect(jordan.warn.mock.calls.map(String).join()).toMatch(/could not send the guardian card: mediator down/)
  })
})

describe('Who approves: the state card line', () => {
  const id = (key: string) => testIdWithKey(key)

  const showFor = async (sam: ReturnType<typeof phone>) => {
    ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
    ;(useAgent as jest.Mock).mockReturnValue({ agent: sam.agent })
    jest.spyOn(approverRole, 'approverNames').mockResolvedValue({ [JORDAN]: 'Jordan' })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockResolvedValue({
      view: { approvers: [JORDAN], keys: ['joinCommunity'], heldElsewhere: [] },
      version: 2,
    } as TrustedApproversState)
    const tree = render(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    await act(async () => undefined)
    return tree
  }
  const writtenWith = async (evidence: GuardianEvidence | null) => {
    const sam = phone()
    await setStateWard(sam.agent, SAM_WARD)
    sam.ask({ state: 'closed', written: true, writtenAs: JORDAN })
    if (evidence !== null) await handleGuardianEvidence(sam.agent, sam.service, documentOf(evidence), context)
    return sam
  }

  test('a valid card: "Guardian, verified by" beside the approver, with what is not checked', async () => {
    const tree = await showFor(await writtenWith(card('G-ok')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN))).props.children).toBe(
      'Approver.GuardianVerified'
    )
    expect(tree.getByText('Approver.GuardianNotTied')).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test("a revoked card: couldn't verify, with the outcome, and never verified (control: the row above)", async () => {
    const tree = await showFor(await writtenWith(card('G-revoked')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(tree.getByTestId(id(TrustedApproversIds.guardianOutcome(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
  })

  test('no card: no line at all (control: the rows above)', async () => {
    const tree = await showFor(await writtenWith(null))
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test('state-verified approvers off: a kept valid card shows nothing (control: on, it shows)', async () => {
    const sam = await writtenWith(card('G-ok'))
    setStateVerifiedApproversEnabled(false)
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeNull()
  })

  test('switched off while open: the line goes on the next render, before anything is read again (control: on, shown)', async () => {
    const tree = await showFor(await writtenWith(card('G-ok')))
    expect(tree.getByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeTruthy()
    STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true
    tree.rerender(
      <BasicAppContext>
        <VtaTrustedApprovers />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect(tree.getByTestId(id(TrustedApproversIds.approver(JORDAN)))).toBeTruthy()
  })

  test("verifyGuardian throwing on open: couldn't verify, and the kept verdict is no longer valid (control: no throw, verified)", async () => {
    const sam = await writtenWith(card('G-ok'))
    expect(sam.askRecord().guardian?.verdict.ok).toBe(true)
    jest.spyOn(guardianModule, 'verifyGuardian').mockImplementation(() => {
      throw new Error('boom')
    })
    const tree = await showFor(sam)
    expect(tree.getByTestId(id(TrustedApproversIds.guardianUnverified(JORDAN)))).toBeTruthy()
    expect(tree.queryByTestId(id(TrustedApproversIds.guardianVerified(JORDAN)))).toBeNull()
    expect((sam.askRecord().guardian as GuardianOnAsk).verdict.ok).toBe(false)
  })
})
