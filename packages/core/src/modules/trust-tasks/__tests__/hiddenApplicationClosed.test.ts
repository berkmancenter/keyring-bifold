/**
 * A private application is destroyed at the agent once it has ended, and only then.
 * `vta/pcs/applications/delete/0.1` says a client MUST, and the agent keeps it until
 * told, so from 2026-10-15 (private vetting moved into the one vetting flow, the
 * cleanup stayed on a screen nothing opens) every private join left its key path and
 * attestations there. The agent doesn't list applications, so the local record is the
 * only handle: it goes only once the agent confirms.
 *
 * The stores and the hidden-vetting module are the shipping ones. Deleting too early
 * can't be undone and sends a person back to their vetters, so what must NOT delete is
 * tested as hard as what must.
 */
import { DeviceEventEmitter } from 'react-native'

const mockSent: { type: string; body: { payload?: Record<string, unknown> } }[] = []
const mockConnects: string[] = []
let mockClient: Record<string, unknown> = {}
let mockAddress: string | undefined = 'did:webvh:agent:current'
const mockLogged: string[] = []
const mockReceiveIssue = jest.fn(async (): Promise<Array<{ kind: string }>> => [])
const mockReceiveNotice = jest.fn(async (): Promise<string> => 'ignored')

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// A store write announces itself on a timer, which could fire after the suite has gone and fail the run.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: {} })),
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    send: jest.fn(async (_to: string, type: string, body: { payload?: Record<string, unknown> }) => {
      mockSent.push({ type, body })
    }),
    onInbound: () => () => undefined,
    subscribe: () => () => undefined,
    getState: () => ({ status: 'connected', did: 'did:webvh:me:now' }),
    isConnected: true,
    connect: jest.fn(async () => undefined),
    withdraw: jest.fn(async () => undefined),
    selfRemove: jest.fn(async () => ({ disposition: 'purge' })),
    fetchManifest: jest.fn(async () => mockPrivateWay()),
  },
}))
jest.mock('../module/vtaAgent', () => ({
  ...jest.requireActual('../module/vtaAgent'),
  vtaAgent: {
    installKeyFetcher: jest.fn(),
    refetchPersonaKeys: jest.fn(async () => undefined),
    agentAddress: () => mockAddress,
    connect: jest.fn(async (_agent: unknown, vtaDid: string) => {
      mockConnects.push(vtaDid)
    }),
    client: () => mockClient,
  },
}))
jest.mock('../module/releaseLog', () => ({
  ...jest.requireActual('../module/releaseLog'),
  releaseWarn: (line: string) => void mockLogged.push(line),
}))
jest.mock('../module/vtiInbox', () => ({
  ...jest.requireActual('../module/vtiInbox'),
  receiveIssue: (...a: unknown[]) => mockReceiveIssue(...(a as [])),
}))
jest.mock('../module/vtiCommunityNotices', () => ({
  ...jest.requireActual('../module/vtiCommunityNotices'),
  receiveCommunityNotice: (...a: unknown[]) => mockReceiveNotice(...(a as [])),
}))

// eslint-disable-next-line import/order
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
// eslint-disable-next-line import/order
import {
  beginHiddenApplication,
  loadClosedHiddenApplication,
  loadHiddenVettingRecord,
  startHiddenApplication,
} from '../module/hiddenVetting'
// eslint-disable-next-line import/order
import { REMOVAL_NOTICE } from '../module/vtiCommunityNotices'
// eslint-disable-next-line import/order
import { leaveCommunity } from '../module/vtiJoin'
// eslint-disable-next-line import/order
import { keepForPersona, startPersonaInbox } from '../module/vtiPersonaInbox'
// eslint-disable-next-line import/order
import {
  GenericRecordsVettingStore,
  VtiApplicant,
  closeEndedHiddenApplications,
  hiddenApplicationEnd,
  type VettingApplication,
} from '../module/vtiVetting'

const COMMUNITY = 'did:webvh:QmCommunity:dids.example:hidden-vtc'
const ME = 'did:webvh:me:now'
const EARLIER_ME = 'did:webvh:me:earlier'
const VETTER = 'did:webvh:vetter:one'
const at = (offsetMinutes: number) => new Date(Date.parse('2026-11-04T12:00:00Z') + offsetMinutes * 60000).toISOString()
const CREATED = at(0)

const parameters = {
  suite: 'ps-ddh-bls12381',
  helperKey: 'z6MkhelperKey',
  tokenKey: 'z6MktokenKey',
  vetterLabels: ['vetter/2026-10'],
  tokenLabels: ['token/2026-10'],
  dripPerTick: 3,
  tickLength: 'P3D',
  events: [],
}
function mockPrivateWay() {
  return {
    wire: '0.3',
    criteria: [
      {
        id: 'Vetted-Member',
        requirementsDigest: 'zQmDigest',
        vetting: {
          version: '0.1',
          statementType: 'https://registry.trustoverip.org/dtg/vsc/vetted/1',
          minStatements: 2,
          acceptedMethods: ['inPerson', 'video'],
          requiredClaims: ['name.legal'],
          maxStatementAge: 'P120D',
          eligibleVetters: { role: 'vetter' },
          independence: { requireConsistentIdentityCommitment: true },
          invitation: 'none',
          ext: { 'org.openvtc.hidden-vetting': parameters },
        },
      },
    ],
  }
}

const notFound = () =>
  Object.assign(new Error('notFound'), { document: { payload: { code: 'vta/pcs/applications/delete:notFound' } } })

type Rec = { id: string; content: Record<string, unknown>; tags: Record<string, string>; createdAt: Date }

function phone(personas: string[] = [ME]) {
  const records: Rec[] = []
  let next = 0
  const unreadable = new Set<string>()
  const warnings: string[] = []
  const agent = {
    config: {
      logger: {
        warn: (m: string) => warnings.push(m),
        info: (m: string) => warnings.push(m),
        debug: (m: string) => warnings.push(m),
        error: (m: string) => warnings.push(m),
      },
    },
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) => {
        if (unreadable.has(query.recordType)) throw new Error('store unreadable')
        return records
          .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
          .map((r) => ({ ...r, content: JSON.parse(JSON.stringify(r.content)) }))
      },
      save: async ({ content, tags }: Pick<Rec, 'content' | 'tags'>) =>
        void records.push({
          id: `r${next++}`,
          content: JSON.parse(JSON.stringify(content)),
          tags,
          createdAt: new Date(),
        }),
      update: async (record: Rec) => {
        const held = records.find((r) => r.id === record.id)
        if (held) held.content = JSON.parse(JSON.stringify(record.content))
      },
      delete: async (record: Rec) =>
        void records.splice(
          records.findIndex((r) => r.id === record.id),
          1
        ),
    },
  }
  for (const did of personas) {
    records.push({
      id: `r${next++}`,
      content: {
        did,
        communityDid: COMMUNITY,
        vtaDid: 'did:webvh:agent:current',
        kmsKeyIds: { signing: 's', keyAgreement: 'k' },
      },
      tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: `${COMMUNITY}-${did}` },
      createdAt: new Date(),
    })
  }
  const asAgent = agent as never
  const vetting = new GenericRecordsVettingStore(asAgent)
  const community = new GenericRecordsCommunityStore(asAgent)
  const persona = {
    did: ME,
    communityDid: COMMUNITY,
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 's', keyAgreement: 'k' },
  }
  const held = () => records.filter((r) => r.tags.recordType === 'keyring/hidden-vetting')
  const begin = async (joinDid = ME, applicationId = 'app-1') => {
    const created = await startHiddenApplication(
      asAgent,
      fakeClient({
        createPcsApplication: async () => ({
          applicationId,
          id: `pcs-${applicationId}`,
          attestations: [{ meta: {} }, { meta: {} }],
        }),
      }) as never,
      {
        contextId: 'vta',
        community: COMMUNITY,
        joinDid,
        requirementsDigest: 'zQmDigest',
        parameters: parameters as never,
        minimum: 2,
      }
    )
    // A fixed time, so a decision can be placed before or after it.
    held()[0].content = { ...held()[0].content, createdAt: CREATED }
    return created
  }
  const application = (extra: Partial<VettingApplication> = {}) =>
    vetting.saveApplication({
      communityDid: COMMUNITY,
      joinDid: ME,
      minStatements: 2,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: 'salt',
      claims: {},
      requests: [],
      startedAt: CREATED,
      ...extra,
    } as VettingApplication)
  const member = (extra: Record<string, unknown> = {}) =>
    community.saveMembership({
      communityDid: COMMUNITY,
      personaDid: ME,
      grantedAt: at(5),
      role: 'member',
      via: 'vetting',
      ...extra,
    } as never)
  return {
    agent: asAgent,
    records,
    warnings,
    vetting,
    community,
    persona,
    held,
    begin,
    application,
    member,
    unreadable,
  }
}

const deleted: string[] = []
function fakeClient(over: Record<string, unknown> = {}) {
  return {
    vtaDid: 'did:webvh:agent:current',
    managerDid: 'did:peer:2.Ephone',
    servesPcs: async () => true,
    whoAmI: async () => ({ roles: ['initiator'], scopes: ['ctx:vta'], capabilities: ['pcs-applicant'] }),
    listAcl: async () => [],
    listContexts: async () => [{ id: 'vta' }],
    createPcsApplication: async () => ({ applicationId: 'app-new', id: 'pcs-new', attestations: [] }),
    deletePcsApplication: async (id: string) => void deleted.push(id),
    ...over,
  }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe('whether an application has ended', () => {
  const record = { joinDid: ME, createdAt: CREATED }
  const facts = { identityHeld: true }
  const submitted = (state: string, effect?: string, when = at(5)) => ({
    application: { joinDid: ME, submission: { state, effect, at: when } } as never,
  })

  it.each([
    ['deferred, asked for more', submitted('deferred', 'requestMore')],
    ['referred', submitted('pending', 'refer')],
    ['pending', submitted('pending', 'pending')],
    ['allowed, with no card yet', submitted('decided', 'allow')],
    ['decided, outcome unknown', submitted('decided')],
    ['nothing submitted', {}],
    ['the community says pending', { submission: { status: 'pending', sentAt: at(5), privateVetting: true } as never }],
    [
      'the community says deferred',
      { submission: { status: 'deferred', sentAt: at(5), privateVetting: true } as never },
    ],
    [
      'the community says approved, with no card yet',
      { submission: { status: 'approved', sentAt: at(5), privateVetting: true } as never },
    ],
  ])('has not when %s', (_name, extra) => {
    expect(hiddenApplicationEnd(record, { ...facts, ...extra })).toBeUndefined()
  })

  it.each([
    ['joined', { membership: { personaDid: ME, grantedAt: at(5) } }],
    ['removed', { membership: { personaDid: ME, grantedAt: at(5), removal: { decidedAt: at(9) } as never } }],
    ['denied', submitted('decided', 'deny')],
    ['denied', submitted('decided', 'reject')],
    ['withdrawn', submitted('withdrawn')],
    ['denied', { submission: { status: 'rejected', sentAt: at(5), privateVetting: true } as never }],
    ['withdrawn', { submission: { status: 'withdrawn', sentAt: at(5), privateVetting: true } as never }],
  ])('has, as %s', (end, extra) => {
    expect(hiddenApplicationEnd(record, { ...facts, ...extra })).toBe(end)
  })

  it('has when the identity it is for is gone from this phone', () => {
    expect(hiddenApplicationEnd(record, { identityHeld: false })).toBe('left')
  })

  it('with no date on the record, no decision ends it, and only the identity going does', () => {
    const undated = { joinDid: ME }
    expect(hiddenApplicationEnd(undated, { ...facts, ...submitted('decided', 'deny') })).toBeUndefined()
    expect(
      hiddenApplicationEnd(undated, { ...facts, membership: { personaDid: ME, grantedAt: at(5) } })
    ).toBeUndefined()
    expect(hiddenApplicationEnd(undated, { identityHeld: false })).toBe('left')
  })

  it.each([
    ['a refusal older than the application', submitted('decided', 'deny', at(-5))],
    ['a withdrawal older than the application', submitted('withdrawn', undefined, at(-5))],
    [
      'a turned-down request older than the application',
      { submission: { status: 'rejected', sentAt: at(-5), privateVetting: true } as never },
    ],
    ['an invited request turned down alongside it', { submission: { status: 'rejected', sentAt: at(5) } as never }],
    ['an invited request withdrawn alongside it', { submission: { status: 'withdrawn', sentAt: at(5) } as never }],
    ['a membership older than the application', { membership: { personaDid: ME, grantedAt: at(-5) } }],
    ["another identity's membership", { membership: { personaDid: EARLIER_ME, grantedAt: at(5) } }],
    [
      "another identity's refusal",
      { application: { joinDid: EARLIER_ME, submission: { state: 'decided', effect: 'deny', at: at(5) } } as never },
    ],
  ])('has not on %s', (_name, extra) => {
    expect(hiddenApplicationEnd(record, { ...facts, ...extra })).toBeUndefined()
  })
})

describe('closing what has ended', () => {
  beforeEach(() => {
    deleted.length = 0
    mockSent.length = 0
    mockConnects.length = 0
    mockLogged.length = 0
    mockAddress = 'did:webvh:agent:current'
    mockClient = fakeClient()
    mockReceiveIssue.mockReset().mockResolvedValue([])
    mockReceiveNotice.mockReset().mockResolvedValue('ignored')
  })
  afterEach(async () => {
    await flush()
    DeviceEventEmitter.removeAllListeners()
  })

  it('destroys a denied application at the agent, and keeps nothing that names it', async () => {
    const p = phone()
    await p.begin()
    await p.application({ submission: { state: 'decided', effect: 'deny', at: at(5) } })

    await closeEndedHiddenApplications(p.agent)

    expect(deleted).toEqual(['app-1'])
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toBeUndefined()
    const left = JSON.stringify(p.held())
    for (const gone of ['app-1', 'pcs-app-1', 'helperKey', 'zQmDigest']) expect(left).not.toContain(gone)
    expect(await loadClosedHiddenApplication(p.agent, COMMUNITY)).toMatchObject({
      closed: 'denied',
      held: 0,
      joinDid: ME,
    })
    // Still one record: nothing stored was deleted.
    expect(p.held()).toHaveLength(1)
  })

  it.each([
    ['deferred', 'requestMore'],
    ['pending', 'refer'],
    ['pending', 'pending'],
    ['decided', 'allow'],
  ])('leaves %s/%s alone, at the agent and here', async (state, effect) => {
    const p = phone()
    await p.begin()
    await p.application({ submission: { state, effect, at: at(5) } as never })

    await closeEndedHiddenApplications(p.agent)

    expect(deleted).toEqual([])
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-1' })
  })

  it('closes a referred request when its card finally arrives', async () => {
    const p = phone()
    await p.begin()
    await p.application({ submission: { state: 'pending', effect: 'refer', at: at(5) } })
    await closeEndedHiddenApplications(p.agent)
    expect(deleted).toEqual([])

    await p.member()
    await closeEndedHiddenApplications(p.agent)

    expect(deleted).toEqual(['app-1'])
    expect(await loadClosedHiddenApplication(p.agent, COMMUNITY)).toMatchObject({ closed: 'joined', held: 2 })
  })

  it('keeps the only handle when the agent cannot confirm, and tries again', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    mockClient = fakeClient({
      deletePcsApplication: async () => {
        throw new Error(`unreachable app-1 ${ME}`)
      },
    })

    await closeEndedHiddenApplications(p.agent)

    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-1' })
    expect(mockLogged.join()).toContain('not closed at the agent')
    // By kind only: the log leaves the phone.
    expect(mockLogged.join()).not.toContain('app-1')
    expect(mockLogged.join()).not.toContain(ME)

    mockClient = fakeClient()
    await closeEndedHiddenApplications(p.agent)
    expect(deleted).toEqual(['app-1'])
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toBeUndefined()
  })

  it('takes notFound as done', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    mockClient = fakeClient({
      deletePcsApplication: async () => {
        throw notFound()
      },
    })
    await closeEndedHiddenApplications(p.agent)
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toBeUndefined()
  })

  it('does not read a failed read of the identities as the identity being gone', async () => {
    const p = phone()
    await p.begin()
    p.unreadable.add('keyring/vti-identity')
    await closeEndedHiddenApplications(p.agent)
    expect(deleted).toEqual([])
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toBeDefined()
  })

  it('asks the agent that holds it, not whichever is current', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    p.held()[0].content = { ...p.held()[0].content, vtaDid: 'did:webvh:agent:first' }
    await closeEndedHiddenApplications(p.agent)
    expect(mockConnects).toEqual(['did:webvh:agent:first'])
  })

  it('contacts no agent with nothing to close', async () => {
    const p = phone()
    await p.begin()
    await closeEndedHiddenApplications(p.agent)
    expect(mockConnects).toEqual([])
    const none = phone()
    await closeEndedHiddenApplications(none.agent)
    expect(mockConnects).toEqual([])
  })

  it('does not replace a newer application that arrived while the agent answered', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    mockClient = fakeClient({
      deletePcsApplication: async () => {
        p.held()[0].content = { ...p.held()[0].content, applicationId: 'app-2' }
      },
    })
    await closeEndedHiddenApplications(p.agent)
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-2' })
  })

  it('is not held for good by an agent that never answers: the next sweep tries again', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    mockClient = fakeClient({ deletePcsApplication: () => new Promise(() => undefined) })

    await closeEndedHiddenApplications(p.agent, 5)

    expect(mockLogged.join()).toContain('not closed at the agent')
    expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-1' })

    mockClient = fakeClient()
    await closeEndedHiddenApplications(p.agent, 5)
    expect(deleted).toEqual(['app-1'])
  })

  it('runs once at a time, and again for what ended while it ran', async () => {
    const p = phone()
    await p.begin()
    await p.member()
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    mockClient = fakeClient({
      deletePcsApplication: async () => {
        calls++
        await held
        throw new Error('unreachable')
      },
    })
    const first = closeEndedHiddenApplications(p.agent)
    await flush()
    const second = closeEndedHiddenApplications(p.agent)
    await flush()
    expect(calls).toBe(1)
    release()
    await first
    await second
    await flush()
    expect(calls).toBe(2)
  })

  describe('when it runs', () => {
    it('at an unlock: an identity gone since the last one, on a phone that never had this', async () => {
      const p = phone([])
      await p.begin(EARLIER_ME)
      const stop = startPersonaInbox(p.agent, {})
      await flush()
      stop()
      expect(deleted).toEqual(['app-1'])
    })

    it('as soon as the membership card is kept', async () => {
      const p = phone()
      await p.begin()
      await p.member()
      mockReceiveIssue.mockResolvedValue([{ kind: 'membership' }])
      await keepForPersona(p.agent, p.persona as never, { type: 'https://x/issue', from: VETTER, body: {} } as never)
      await flush()
      expect(deleted).toEqual(['app-1'])
    })

    it('as soon as a removal is applied', async () => {
      const p = phone()
      await p.begin()
      await p.member({ removal: { decidedAt: at(9) } })
      mockReceiveNotice.mockResolvedValue('removed')
      await keepForPersona(p.agent, p.persona as never, { type: REMOVAL_NOTICE, from: COMMUNITY, body: {} } as never)
      await flush()
      expect(deleted).toEqual(['app-1'])
    })

    it('without holding up the message: an agent that never answers leaves it kept', async () => {
      const p = phone()
      await p.begin()
      await p.member()
      let answer = () => undefined as void
      mockClient = fakeClient({ deletePcsApplication: () => new Promise<void>((resolve) => (answer = resolve)) })
      mockReceiveIssue.mockResolvedValue([{ kind: 'membership' }])
      await expect(
        keepForPersona(p.agent, p.persona as never, { type: 'https://x/issue', from: VETTER, body: {} } as never)
      ).resolves.toBeUndefined()
      await flush()
      answer()
      await flush()
    })

    it('as soon as the applicant withdraws', async () => {
      const p = phone()
      await p.begin()
      // After the application, as a real withdrawal is.
      await p.application({ submission: { requestId: 'q', state: 'pending', at: at(5) } })
      const applicant = new VtiApplicant(p.agent, p.persona as never, p.vetting, p.community)
      await applicant.withdraw()
      await flush()
      expect(deleted).toEqual(['app-1'])
    })

    it('as soon as the applicant leaves', async () => {
      const p = phone([])
      await p.begin()
      const persona = { ...p.persona }
      await leaveCommunity(
        {
          agent: p.agent,
          mediatorDid: 'did:peer:2.Emediator',
          identityStore: { getPersona: async () => persona, forgetPersona: async () => undefined },
          communityStore: { forgetCommunity: async () => undefined },
          vettingStore: p.vetting,
        } as never,
        COMMUNITY
      )
      await flush()
      expect(deleted).toEqual(['app-1'])
    })
  })

  describe('starting another', () => {
    const criterion = () => mockPrivateWay().criteria[0] as never

    it('destroys the one it replaces first: the new record takes the only handle', async () => {
      const p = phone()
      await p.begin(EARLIER_ME, 'app-old')
      const order: string[] = []
      const client = fakeClient({
        deletePcsApplication: async (id: string) => void order.push(`delete ${id}`),
        createPcsApplication: async () => {
          order.push('create')
          return { applicationId: 'app-new', id: 'pcs-new', attestations: [] }
        },
      })
      await beginHiddenApplication(p.agent, client as never, COMMUNITY, criterion(), ME)
      expect(order).toEqual(['delete app-old', 'create'])
      expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({
        applicationId: 'app-new',
        vtaDid: 'did:webvh:agent:current',
      })
    })

    it('still starts when that delete fails, and says so with nothing identifying', async () => {
      const p = phone()
      await p.begin(EARLIER_ME, 'app-old')
      const client = fakeClient({
        deletePcsApplication: async () => {
          throw new Error(`refused app-old ${EARLIER_ME}`)
        },
      })
      await beginHiddenApplication(p.agent, client as never, COMMUNITY, criterion(), ME)
      expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-new' })
      expect(p.warnings.join()).toContain('could not be deleted at the agent')
      expect(p.warnings.join()).not.toContain('app-old')
    })
  })

  describe('what the applicant sees after', () => {
    const applicantOf = (p: ReturnType<typeof phone>) =>
      new VtiApplicant(p.agent, p.persona as never, p.vetting, p.community)

    it('stays private, not the named numbers, and a denied one holds nothing', async () => {
      const p = phone()
      await p.begin()
      await p.application({ submission: { state: 'decided', effect: 'deny', at: at(5) } })
      await closeEndedHiddenApplications(p.agent)
      expect(await applicantOf(p).checklist()).toMatchObject({ mode: 'private', held: 0, needed: 2, meets: false })
    })

    it('a join that went through keeps what it held', async () => {
      const p = phone()
      await p.begin()
      await p.application({ submission: { state: 'decided', effect: 'allow', at: at(5) } })
      await p.member()
      await closeEndedHiddenApplications(p.agent)
      expect(await applicantOf(p).checklist()).toMatchObject({ mode: 'private', held: 2, needed: 2, meets: true })
    })

    it("an earlier identity's note isn't this application's", async () => {
      const p = phone()
      await p.begin(EARLIER_ME)
      await p.application({ joinDid: ME })
      p.held()[0].content = {
        community: COMMUNITY,
        joinDid: EARLIER_ME,
        minimum: 2,
        held: 2,
        closed: 'left',
        closedAt: at(5),
      }
      const list = await applicantOf(p).checklist()
      expect(list).not.toMatchObject({ mode: 'private' })
    })

    it('can ask a vetter again after a refusal, and that new application survives the old refusal', async () => {
      const p = phone()
      await p.begin()
      await p.application({ submission: { state: 'decided', effect: 'deny', at: at(5) } })
      await closeEndedHiddenApplications(p.agent)
      expect(deleted).toEqual(['app-1'])
      deleted.length = 0

      await applicantOf(p).requestVetter({ vetterDid: VETTER, code: 'ABCD-EFGH' })

      expect(mockSent[0].body.payload?.ext).toEqual({
        'org.openvtc.hidden-vetting': expect.objectContaining({ id: 'pcs-new' }),
      })
      await closeEndedHiddenApplications(p.agent)
      expect(deleted).toEqual([])
      expect(await loadHiddenVettingRecord(p.agent, COMMUNITY)).toMatchObject({ applicationId: 'app-new' })
    })
  })
})
