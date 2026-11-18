/**
 * Guardian offers (guardianOffer.ts): Jordan, a guardian holding the K0 test Guardian card naming Sam as ward, offers to
 * be Sam's approver; Sam's phone checks the card against its ward, and only then asks Sam. Two phones, the real Trust
 * Task pipeline (schemas, recipients), stand-in signatures, and the real K0 chain checked offline.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  approverRoleEvents,
  handleRoleOfferRequest,
  handleRoleOfferResponse,
  isBeingAnswered,
  listeningFor,
  offerApproverRole,
  OFFER_OPEN_FOR,
  ROLE_OFFER_ASK,
  roleOfferPromptStore,
  type RoleAction,
  type RoleOfferAsk,
} from '../../../src/modules/trust-tasks/approverRole'
import {
  GUARDIAN_EVIDENCE_TYPE_URI,
  GUARDIAN_EVIDENCE_V2_TYPE_URI,
  RESPONSE_TYPE_URI,
  TYPE_URI,
} from '../../../src/modules/trust-tasks/approverRoleSpec'
import { signDocumentProof } from '../../../src/modules/trust-tasks/documentProof'
import * as evidenceModule from '../../../src/modules/trust-tasks/guardianEvidence'
import {
  cardConsentOn,
  handleGuardianEvidence,
  holdGuardianEvidence,
  resetGuardianCheckMemo,
  setStateWard,
  type GuardianEvidence,
} from '../../../src/modules/trust-tasks/guardianEvidence'
import {
  GUARDIAN_OFFER_PROMPT,
  GUARDIAN_OFFER_SENT,
  acceptGuardianOffer,
  currentApproverDid,
  declineGuardianOffer,
  guardianOfferEvents,
  guardianOfferPrompts,
  guardianOfferStatus,
  guardianOffersSent,
  handleGuardianOffer,
  handleGuardianOfferResponse,
  offerAsGuardian,
  recheckGuardianOffers,
  restoreGuardianOffers,
  unverifiableGroupOf,
  type GuardianOfferPrompt,
} from '../../../src/modules/trust-tasks/guardianOffer'
import {
  GUARDIAN_OFFER_RESPONSE_TYPE_URI,
  GUARDIAN_OFFER_TYPE_URI,
} from '../../../src/modules/trust-tasks/guardianOfferSpec'
import {
  GUARDIAN_OFFERS_REMOTE_OFF,
  isGuardianOffersOn,
  setGuardianOffersEnabled,
} from '../../../src/modules/trust-tasks/module/guardianOffersFlag'
import { SEDI_KERI_REMOTE_OFF } from '../../../src/modules/trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../../src/modules/trust-tasks/module/stateVerifiedApproversFlag'
import {
  TRUSTED_APPROVERS_REMOTE_OFF,
  setTrustedApproversEnabled,
} from '../../../src/modules/trust-tasks/module/trustedApproversFlag'
import { setTrustTestStateEnabled } from '../../../src/modules/trust-tasks/module/trustTestStateFlag'
import { TrustTasksService } from '../../../src/modules/trust-tasks/services/TrustTasksService'
import { memoryGenericRecords } from '../vrc/fixtures/memoryGenericRecords'

const mockSent: { connectionId: string; document: Record<string, unknown> }[] = []
jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  sendTrustTaskDocument: async (_agent: unknown, connectionId: string, document: Record<string, unknown>) => {
    mockSent.push({ connectionId, document })
  },
  getTrustTasksService: () => ({ retain: async () => undefined }),
}))

// A stand-in signature: names the DID that made it and the document it was made over.
jest.mock('../../../src/modules/trust-tasks/documentProof', () => {
  const over = (doc: Record<string, unknown>) => {
    const { proof: _proof, ...rest } = doc
    return JSON.stringify(rest)
  }
  return {
    signDocumentProof: async (_agent: unknown, doc: Record<string, unknown>, did: string) => ({
      ...doc,
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', by: did, over: over(doc) },
    }),
    verifyDocumentProof: async (_agent: unknown, doc: Record<string, unknown>, controller: string) => {
      const proof = doc.proof as { by?: string; over?: string } | undefined
      return proof?.by === controller && proof.over === over(doc)
    },
  }
})

jest.mock('../../../src/modules/vrc/utils/rcardDisplayUtils', () => ({
  resolveContactDisplayInfo: (_credentials: unknown, did: string) => ({
    name: ({ 'did:peer:jordan-rel': 'Jordan', 'did:peer:sam-rel': 'Sam' } as Record<string, string>)[did],
  }),
}))

// ---------------------------------------------------------------------------------------------------------------
// The K0 chain

const FX = join(__dirname, '..', '..', '..', 'src', 'modules', 'sedi', '__tests__', 'fixtures', 'k0-utah-v2')
const text = (f: string) => readFileSync(join(FX, f), 'utf8')
const prov = JSON.parse(text('PROVENANCE.json')) as {
  aids: Record<string, string>
  creds: Record<string, { said: string }>
}
const SAM_WARD = prov.aids.sam
const OTHER_WARD = prov.aids['other-ward']

const tel = (stem: string, states: string[]) => ({
  ripText: text(`tel-${stem}-rip.json`),
  updateTexts: states.map((s) => text(`tel-${stem}-${s}.json`)),
})
function card(name: 'G-ok' | 'G-revoked' | 'G-untrusted'): GuardianEvidence {
  const mal = name === 'G-untrusted'
  const [unit, agent] = mal ? ['mal-unit', 'mal-agent'] : ['unit', 'agent']
  const states = name === 'G-revoked' ? ['issued', 'revoked'] : ['issued']
  return {
    guardianSaid: prov.creds[name].said,
    holder: prov.aids.jordan,
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
// Two phones

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN_APPROVES_AS = 'did:peer:2.jordans-phone'

interface Side {
  connectionId: string
  mine: string
  theirs: string
  myRel: string
  theirRel: string
}
/** Sam's phone: its connection with Jordan. */
const SAM: Side = {
  connectionId: 'c-sam',
  mine: 'did:conn:sam',
  theirs: 'did:conn:jordan',
  myRel: 'did:peer:sam-rel',
  theirRel: 'did:peer:jordan-rel',
}
/** Jordan's phone: its connection with Sam. */
const JORDAN: Side = {
  connectionId: 'c-jordan',
  mine: 'did:conn:jordan',
  theirs: 'did:conn:sam',
  myRel: 'did:peer:jordan-rel',
  theirRel: 'did:peer:sam-rel',
}

let random = 0
function phone(side: Side) {
  const store = memoryGenericRecords()
  const warned: string[] = []
  const agent = {
    context: {},
    config: { logger: { info: () => undefined, warn: (line: string) => warned.push(line) } },
    genericRecords: store,
    w3cCredentials: { getAll: async () => [] },
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(++random) },
    dependencyManager: {
      resolve: () => ({
        getAll: async () => [
          {
            connectionId: side.connectionId,
            myRelationshipDid: side.myRel,
            counterpartyRelationshipDid: side.theirRel,
          },
        ],
      }),
    },
    modules: {
      didcomm: { connections: { getById: async (id: string) => ({ id, did: side.mine, theirDid: side.theirs }) } },
    },
  } as any
  return { agent, store, side, warned }
}
type Phone = ReturnType<typeof phone>

let pipeline: TrustTasksService
const contextOf = (to: Phone) => ({
  connectionId: to.side.connectionId,
  senderDid: to.side.theirs,
  recipientDid: to.side.mine,
})

/** Deliver a document to the other phone, as its dispatch would, by its type. */
async function deliver(to: Phone, document: Record<string, unknown>) {
  const type = String(document.type)
  const handle =
    type === TYPE_URI
      ? handleRoleOfferRequest
      : type === RESPONSE_TYPE_URI
        ? handleRoleOfferResponse
        : type === GUARDIAN_OFFER_TYPE_URI
          ? handleGuardianOffer
          : type === GUARDIAN_OFFER_RESPONSE_TYPE_URI
            ? handleGuardianOfferResponse
            : type === GUARDIAN_EVIDENCE_TYPE_URI || type === GUARDIAN_EVIDENCE_V2_TYPE_URI
              ? handleGuardianEvidence
              : undefined
  if (!handle) throw new Error(`no handler for ${type}`)
  await handle(to.agent, pipeline, document, contextOf(to))
}
/** Everything sent since `from` (an index into mockSent), delivered in order to `to`. */
async function deliverAll(to: Phone, from: number) {
  for (const { document } of mockSent.slice(from)) await deliver(to, document)
}
const sentTypes = (from = 0) => mockSent.slice(from).map((s) => String(s.document.type))

/** Jordan holds the K0 Guardian card `name`; Sam's phone checks against `ward` (null: none set). */
async function phones(name: 'G-ok' | 'G-revoked' | 'G-untrusted' = 'G-ok', ward: string | null = SAM_WARD) {
  const jordan = phone(JORDAN)
  const sam = phone(SAM)
  await holdGuardianEvidence(jordan.agent, card(name))
  if (ward !== null) await setStateWard(sam.agent, ward)
  return { jordan, sam }
}

/** Jordan offers `actions`; the offer is delivered to Sam. */
async function offered(actions: RoleAction[] = ['joinCommunity'], name?: 'G-ok' | 'G-revoked', ward?: string | null) {
  const both = await phones(name, ward)
  expect(await offerAsGuardian(both.jordan.agent, JORDAN.connectionId, actions, JORDAN_APPROVES_AS)).toBe('sent')
  const offerAt = mockSent.length - 1
  await deliver(both.sam, mockSent[offerAt].document)
  return { ...both, offerAt }
}

const promptOn = async (p: Phone) =>
  (await p.agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_OFFER_PROMPT }))[0]?.content as
    | GuardianOfferPrompt
    | undefined
const askOn = async (p: Phone) =>
  (await p.agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK }))[0]?.content as RoleOfferAsk | undefined

const allOn = () => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setGuardianOffersEnabled(true)
  setTrustTestStateEnabled(true)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  GUARDIAN_OFFERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}

beforeEach(() => {
  jest.restoreAllMocks()
  mockSent.length = 0
  roleOfferPromptStore.clear()
  guardianOfferPrompts.clear()
  resetGuardianCheckMemo()
  allOn()
  pipeline = new TrustTasksService({ save: async () => undefined } as never)
  // Jordan's phone still approves as the DID it offered with, unless a row relinks it.
  jest.spyOn(currentApproverDid, 'read').mockResolvedValue(JORDAN_APPROVES_AS)
})
afterAll(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setGuardianOffersEnabled(false)
  setTrustTestStateEnabled(false)
})

// ---------------------------------------------------------------------------------------------------------------

describe('the switch', () => {
  test('counts only with trusted approvers and state-verified approvers on too; a remote off beats it', () => {
    expect(isGuardianOffersOn()).toBe(true)
    setStateVerifiedApproversEnabled(false)
    expect(isGuardianOffersOn()).toBe(false)
    allOn()
    setTrustedApproversEnabled(false)
    expect(isGuardianOffersOn()).toBe(false)
    allOn()
    GUARDIAN_OFFERS_REMOTE_OFF.off = true
    expect(isGuardianOffersOn()).toBe(false)
    allOn()
    SEDI_KERI_REMOTE_OFF.off = true
    expect(isGuardianOffersOn()).toBe(false)
  })

  test('off: nothing is offered, and an offer that arrives is dropped unread', async () => {
    const { jordan, sam } = await phones()
    setGuardianOffersEnabled(false)
    expect(await offerAsGuardian(jordan.agent, JORDAN.connectionId, ['joinCommunity'], JORDAN_APPROVES_AS)).toBe('off')
    expect(mockSent).toEqual([])
    setGuardianOffersEnabled(true)
    await offerAsGuardian(jordan.agent, JORDAN.connectionId, ['joinCommunity'], JORDAN_APPROVES_AS)
    setGuardianOffersEnabled(false)
    await deliver(sam, mockSent[0].document)
    expect(await promptOn(sam)).toBeUndefined()
    expect(sam.warned.join('\n')).toMatch(/guardian offers are switched off/)
  })
})

describe("the guardian offers, the person's phone checks the card, the person says yes", () => {
  test('end to end: offer, check, Accept, the yes without asking Jordan again, then the card on the ask', async () => {
    const { jordan, sam, offerAt } = await offered(['joinCommunity'])
    // The offer always covers who approves, and carries the card.
    expect(mockSent[offerAt].document).toMatchObject({
      type: GUARDIAN_OFFER_TYPE_URI,
      payload: { actions: ['joinCommunity', 'changeApprovers'], guardianSaid: prov.creds['G-ok'].said },
    })
    // Sending the card with the offer is the yes to sending it to Sam.
    expect(await cardConsentOn(jordan.agent, JORDAN.connectionId)).toBe('yes')
    expect((await guardianOffersSent(jordan.agent)).map((s) => [s.ward, guardianOfferStatus(s)])).toEqual([
      ['Sam', 'waiting'],
    ])

    // Sam's phone checked the card against its ward, and shows the offer.
    expect(guardianOfferPrompts.get(SAM.connectionId)).toMatchObject({ guardian: 'Jordan', state: 'open' })
    expect((await promptOn(sam))?.verdict).toMatchObject({ ok: true })

    // Sam says yes: an ordinary ask goes back, for Sam's agent.
    const asked = mockSent.length
    expect(await acceptGuardianOffer(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])).toBe('sent')
    expect(sentTypes(asked)).toEqual([TYPE_URI])
    expect(mockSent[asked].document).toMatchObject({
      payload: { agent: SAM_AGENT, actions: ['joinCommunity', 'changeApprovers'] },
    })
    expect(guardianOfferPrompts.get(SAM.connectionId)).toBeUndefined()

    // Jordan's phone answers yes to it at once, never showing it, then sends the card (its yes was kept).
    const shown = jest.fn()
    approverRoleEvents.on('offer', shown)
    const answered = mockSent.length
    await deliver(jordan, mockSent[asked].document)
    approverRoleEvents.off('offer', shown)
    expect(shown).not.toHaveBeenCalled()
    expect(sentTypes(answered)).toEqual([RESPONSE_TYPE_URI, GUARDIAN_EVIDENCE_TYPE_URI])
    expect(mockSent[answered].document).toMatchObject({
      payload: { decision: 'accepted', approver: JORDAN_APPROVES_AS },
    })
    expect(guardianOfferStatus((await guardianOffersSent(jordan.agent))[0])).toBe('accepted')
    expect((await listeningFor(jordan.agent)).map((p) => [p.asker, p.actions])).toEqual([
      ['Sam', ['joinCommunity', 'changeApprovers']],
    ])

    // On Sam's phone: the yes is kept, to add as today, with Jordan's card on it, valid.
    await deliverAll(sam, answered)
    expect(await askOn(sam)).toMatchObject({ state: 'accepted', acceptedAs: JORDAN_APPROVES_AS })
    expect((await askOn(sam))?.guardian?.verdict).toMatchObject({ ok: true })
  })

  test('the person can untick: only "changes who approves" kept, and that is still taken up', async () => {
    const { jordan, sam } = await offered(['joinCommunity', 'addDevice'])
    const asked = mockSent.length
    await acceptGuardianOffer(sam.agent, SAM.connectionId, SAM_AGENT, [])
    expect(mockSent[asked].document).toMatchObject({ payload: { actions: ['changeApprovers'] } })
    const answered = mockSent.length
    await deliver(jordan, mockSent[asked].document)
    expect(mockSent[answered].document).toMatchObject({ payload: { decision: 'accepted' } })
  })

  test('the person cannot add an action the guardian did not offer: refused, nothing sent', async () => {
    const { sam } = await offered(['joinCommunity'])
    const before = mockSent.length
    await expect(acceptGuardianOffer(sam.agent, SAM.connectionId, SAM_AGENT, ['addDevice'])).rejects.toThrow(
      /addDevice was not offered/
    )
    expect(mockSent).toHaveLength(before)
    expect((await promptOn(sam))?.state).toBe('open')
  })
})

describe("the guardian's phone says yes only within what it offered, while the offer is open", () => {
  test('an ask for more than was offered is shown, as any ask, and not answered', async () => {
    const { jordan } = await offered(['joinCommunity'])
    const sam2 = phone(SAM)
    const asked = mockSent.length
    await offerApproverRole(sam2.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'addDevice', 'changeApprovers'])
    const shown = jest.fn()
    approverRoleEvents.on('offer', shown)
    await deliver(jordan, mockSent[asked].document)
    approverRoleEvents.off('offer', shown)
    expect(shown).toHaveBeenCalledTimes(1)
    expect(sentTypes(asked + 1)).toEqual([])
    expect(guardianOfferStatus((await guardianOffersSent(jordan.agent))[0])).toBe('waiting')
  })

  test('an ask after the offer lapsed is shown, not answered (control: the same ask inside the window is)', async () => {
    const { jordan } = await offered(['joinCommunity'])
    const record = jordan.store.records.find((r) => r.tags.recordType === GUARDIAN_OFFER_SENT)!
    record.content = { ...record.content, sentAt: new Date(Date.now() - OFFER_OPEN_FOR - 1000).toISOString() }
    const sam2 = phone(SAM)
    const asked = mockSent.length
    await offerApproverRole(sam2.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'changeApprovers'])
    await deliver(jordan, mockSent[asked].document)
    expect(sentTypes(asked + 1)).toEqual([])
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toBeDefined()
    expect(guardianOfferStatus((await guardianOffersSent(jordan.agent))[0])).toBe('notAccepted')
  })

  test.each([
    [
      'relinked to another agent since',
      () => jest.spyOn(currentApproverDid, 'read').mockResolvedValue('did:peer:2.new'),
    ],
    ["the DID can't be read now", () => jest.spyOn(currentApproverDid, 'read').mockRejectedValue(new Error('offline'))],
  ])('%s: the ask is shown, and no yes names the kept DID (control: the end-to-end row)', async (_what, relink) => {
    const { jordan } = await offered(['joinCommunity'])
    relink()
    const sam2 = phone(SAM)
    const asked = mockSent.length
    await offerApproverRole(sam2.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'changeApprovers'])
    await deliver(jordan, mockSent[asked].document)
    expect(sentTypes(asked + 1)).toEqual([])
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toBeDefined()
    expect(guardianOfferStatus((await guardianOffersSent(jordan.agent))[0])).toBe('waiting')
  })

  test('while answered on its own, the ask is kept off the offer sheet, and only then', async () => {
    const { jordan, sam } = await offered(['joinCommunity'])
    const asked = mockSent.length
    await acceptGuardianOffer(sam.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity'])
    const during: boolean[] = []
    const cleared = () => during.push(isBeingAnswered(JORDAN.connectionId))
    approverRoleEvents.on('promptCleared', cleared)
    await deliver(jordan, mockSent[asked].document)
    approverRoleEvents.off('promptCleared', cleared)
    expect(during).toEqual([true])
    expect(isBeingAnswered(JORDAN.connectionId)).toBe(false)
  })

  test('with guardian offers switched off after sending, the ask is shown and not answered', async () => {
    const { jordan } = await offered(['joinCommunity'])
    const sam2 = phone(SAM)
    const asked = mockSent.length
    await offerApproverRole(sam2.agent, SAM.connectionId, SAM_AGENT, ['joinCommunity', 'changeApprovers'])
    setGuardianOffersEnabled(false)
    await deliver(jordan, mockSent[asked].document)
    expect(sentTypes(asked + 1)).toEqual([])
    expect(roleOfferPromptStore.get(JORDAN.connectionId)).toBeDefined()
  })
})

describe("a card that does not check is never shown; the guardian is told only that it couldn't be checked", () => {
  test.each([
    ['another ward', 'G-ok' as const, OTHER_WARD, 'notThisWard'],
    ['no ward set here', 'G-ok' as const, null, 'notThisWard'],
    ['a revoked card', 'G-revoked' as const, SAM_WARD, 'notInForce'],
  ])('%s: not shown, and Jordan reads "couldn\'t check" (%s)', async (_what, name, ward, group) => {
    const shown = jest.fn()
    guardianOfferEvents.on('offer', shown)
    const { jordan, sam, offerAt } = await offered(['joinCommunity'], name, ward)
    guardianOfferEvents.off('offer', shown)
    expect(shown).not.toHaveBeenCalled()
    expect(guardianOfferPrompts.get(SAM.connectionId)).toBeUndefined()
    expect(await promptOn(sam)).toMatchObject({ state: 'unverifiable', group })
    expect(sentTypes(offerAt + 1)).toEqual([GUARDIAN_OFFER_RESPONSE_TYPE_URI])
    // Nothing about why goes (Alberto, 11-17, option b): the same three keys whatever failed, and no group anywhere.
    const told = mockSent[offerAt + 1].document
    expect(Object.keys(told.payload as object).sort()).toEqual(['challenge', 'decision', 'respondedAt'])
    expect(JSON.stringify(told)).not.toContain(group)
    await deliver(jordan, told)
    const [sent] = await guardianOffersSent(jordan.agent)
    expect(guardianOfferStatus(sent)).toBe('unverifiable')
    expect(sent).not.toHaveProperty('group')
  })

  test('an answer that does carry a group is refused, and changes nothing (control: the rows above, without one)', async () => {
    const { jordan, sam, offerAt } = await offered(['joinCommunity'], 'G-ok', OTHER_WARD)
    const told = mockSent[offerAt + 1].document
    const { proof: _p, ...unsigned } = told
    const withGroup = await signDocumentProof(
      sam.agent,
      { ...unsigned, payload: { ...(told.payload as object), group: 'notThisWard' } },
      SAM.myRel
    )
    await deliver(jordan, withGroup as Record<string, unknown>)
    const [sent] = await guardianOffersSent(jordan.agent)
    expect(guardianOfferStatus(sent)).toBe('waiting')
    expect(sent).not.toHaveProperty('group')
  })

  test('the groups, kept on the person\'s phone only: anything unknown is "broken"', () => {
    expect(unverifiableGroupOf('wardMismatch')).toBe('notThisWard')
    expect(unverifiableGroupOf('expired')).toBe('notInForce')
    expect(unverifiableGroupOf('untrustedRoot')).toBe('notTrusted')
    expect(unverifiableGroupOf('kelNotReplaying')).toBe('broken')
    expect(unverifiableGroupOf('somethingNew')).toBe('broken')
  })

  test('a state not reached: kept unseen and untold, then shown once a later check passes', async () => {
    const real = evidenceModule.checkGuardianEvidenceResolving
    const spy = jest.spyOn(evidenceModule, 'checkGuardianEvidenceResolving').mockResolvedValue({
      ok: false,
      reason: 'stateNotResolved',
      detail: 'the host did not answer',
      checkedAt: new Date().toISOString(),
    })
    const { sam, offerAt } = await offered(['joinCommunity'])
    expect(await promptOn(sam)).toMatchObject({ state: 'checking' })
    expect(guardianOfferPrompts.get(SAM.connectionId)).toBeUndefined()
    expect(sentTypes(offerAt + 1)).toEqual([])
    spy.mockImplementation(real)
    await recheckGuardianOffers(sam.agent)
    expect(guardianOfferPrompts.get(SAM.connectionId)).toMatchObject({ state: 'open' })
  })

  test('an answer that does not carry the offer back changes nothing', async () => {
    const { jordan, sam, offerAt } = await offered(['joinCommunity'], 'G-ok', OTHER_WARD)
    const told = mockSent[offerAt + 1].document
    const { proof: _p, ...unsigned } = told
    const forged = await signDocumentProof(
      sam.agent,
      { ...unsigned, payload: { ...(told.payload as object), challenge: 'x'.repeat(43) } },
      SAM.myRel
    )
    await deliver(jordan, forged as Record<string, unknown>)
    expect(guardianOfferStatus((await guardianOffersSent(jordan.agent))[0])).toBe('waiting')
  })

  test('an offer that leaves out "changes who approves" is dropped (control: the same offer with it is shown)', async () => {
    const { jordan, sam } = await phones()
    await offerAsGuardian(jordan.agent, JORDAN.connectionId, ['joinCommunity'], JORDAN_APPROVES_AS)
    const { proof: _p, ...unsigned } = mockSent[0].document
    const without = await signDocumentProof(
      jordan.agent,
      { ...unsigned, payload: { ...(unsigned.payload as object), actions: ['joinCommunity'] } },
      JORDAN.myRel
    )
    await deliver(sam, without as Record<string, unknown>)
    expect(await promptOn(sam)).toBeUndefined()
    await deliver(sam, mockSent[0].document)
    expect(guardianOfferPrompts.get(SAM.connectionId)).toMatchObject({ state: 'open' })
  })
})

describe('a no is never sent', () => {
  test('Decline sends nothing; Jordan reads it as waiting, then as not accepted once it lapses', async () => {
    const { jordan, sam } = await offered(['joinCommunity'])
    const before = mockSent.length
    await declineGuardianOffer(sam.agent, SAM.connectionId)
    expect(mockSent).toHaveLength(before)
    expect(await promptOn(sam)).toMatchObject({ state: 'declined' })
    const [sent] = await guardianOffersSent(jordan.agent)
    expect(guardianOfferStatus(sent)).toBe('waiting')
    expect(guardianOfferStatus(sent, Date.parse(sent.sentAt) + OFFER_OPEN_FOR + 1)).toBe('notAccepted')
    // A declined offer cannot be accepted afterwards.
    expect(await acceptGuardianOffer(sam.agent, SAM.connectionId, SAM_AGENT, [])).toBe('gone')
  })
})

describe('kept across a restart', () => {
  test('an open offer is shown again at start; a lapsed one is not', async () => {
    const { sam } = await offered(['joinCommunity'])
    guardianOfferPrompts.clear()
    await restoreGuardianOffers(sam.agent)
    expect(guardianOfferPrompts.get(SAM.connectionId)).toMatchObject({ state: 'open' })
    guardianOfferPrompts.clear()
    const record = sam.store.records.find((r) => r.tags.recordType === GUARDIAN_OFFER_PROMPT)!
    record.content = { ...record.content, receivedAt: new Date(Date.now() - OFFER_OPEN_FOR - 1000).toISOString() }
    await restoreGuardianOffers(sam.agent)
    expect(guardianOfferPrompts.get(SAM.connectionId)).toBeUndefined()
  })
})

describe('the guardian side refuses what it cannot send', () => {
  test('no card held: nothing sent', async () => {
    const jordan = phone(JORDAN)
    expect(await offerAsGuardian(jordan.agent, JORDAN.connectionId, ['joinCommunity'], JORDAN_APPROVES_AS)).toBe('none')
    expect(mockSent).toEqual([])
  })
})
