/**
 * The agent's page with no part is today's page, section for section, in
 * today's order. The preview of the new navigation shapes its parts to the
 * mockups' option C and R1–R3: Communities (desk row, community rows, Your
 * rooms, Join; a plain empty state with no membership), You (Requests, Your
 * agent, Settings) and the agent's own page. And a light render of each
 * preview screen: rooms with sample data marked "Preview, not connected",
 * whose buttons send nothing.
 */
import { useIsFocused, useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { defaultState, StoreProvider } from '../../../contexts/store'
import { buildRCardTemplate } from '../../vrc/types/rcard'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { GenericRecordsVettingStore, type VettingDeskRequest } from '../module/vtiVetting'
import ContactsWithConversations from '../preview/ContactsWithConversations'
import { deskWaiting } from '../preview/deskWaiting'
import PreviewAiAccess from '../preview/PreviewAiAccess'
import { DeskRow, ProfilesSection } from '../preview/PreviewParts'
import PreviewRoom from '../preview/PreviewRoom'
import { CommunityRoomsSection, YourRoomsSection } from '../preview/RoomsPreview'
import { stackLandsOn } from '../screens/agentHome'
import VtaAgentHome, { forgetAgentHoldings, type AgentHomePart } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
const mockGrantState = jest.fn(async () => ({ state: 'active', statusChecked: true }))
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: () => mockGrantState(),
}))
jest.mock('../../vrc/screens/ListContacts', () => {
  const { Text } = jest.requireActual('react-native')
  return { __esModule: true, default: () => <Text>ListContacts</Text> }
})
jest.mock('../../../screens/Messages', () => {
  const { Text } = jest.requireActual('react-native')
  return { __esModule: true, default: () => <Text>Messages</Text> }
})

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const id = (key: string) => testIdWithKey(key)

const communityDid = 'did:webvh:QmCommunity:vtc.example.org'
const personaDid = 'did:webvh:QmPersona:vta.example.org:p'
const records: Rec[] = [
  {
    tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
    content: {
      communityDid,
      vtaDid: 'did:webvh:example:vta',
      did: personaDid,
      contextId: 'vta',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
      createdAt: '2026-09-22T00:00:00Z',
    },
  },
  {
    tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
    content: { communityDid, personaDid, role: 'member', vmc: {}, grantedAt: '2026-09-22T00:00:00Z', via: 'vetting' },
  },
  {
    tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'g1' },
    content: {
      kind: 'vetter-grant',
      communityDid,
      subjectDid: personaDid,
      credential: {},
      receivedAt: '2026-09-22T00:00:00Z',
    },
  },
]
const fakeAgent = (held: Rec[] = records) => ({
  agent: {
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) =>
        held.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map((r) => ({ ...r, id: 'r' })),
    },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  },
})

/** The page's sections, by the testIDs the e2e drivers and the gate read. */
const SECTIONS = [
  'AgentHomeTitle',
  'AgentSeat',
  'AgentJourneyJoined',
  'AgentJourney',
  'WhatIsMyAgent',
  'AgentDoors',
  'PreviewDeskRow',
  'AgentVetterCard',
  'AgentRequestsRow',
  'AgentHolds',
  'PreviewCommunityRows',
  'AgentDevices',
  'PreviewYourRooms',
  'AgentJoinAnother',
  'PreviewJoinCommunity',
  'PreviewYourAgentCard',
  'PreviewAiAccessRow',
  'PreviewAgentSettingsRow',
  'PreviewProfiles',
  'PreviewCommunitiesEmpty',
]
const ANY_SECTION = new RegExp(`^com\\.ariesbifold:id/(${SECTIONS.join('|')})$`)
const sectionsOf = (tree: ReturnType<typeof render>) =>
  Array.from(new Set(tree.getAllByTestId(ANY_SECTION).map((n) => String(n.props.testID).split('/')[1])))

const renderHome = async (part?: AgentHomePart, held: Rec[] = records) => {
  ;(useAgent as jest.Mock).mockReturnValue(fakeAgent(held))
  const tree = render(<BasicAppContext>{part ? <VtaAgentHome part={part} /> : <VtaAgentHome />}</BasicAppContext>)
  await act(async () => {
    jest.advanceTimersByTime(10)
  })
  return tree
}

describe('the agent’s page and the preview’s parts', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-23T04:00:00Z'))
    forgetAgentHoldings()
    jest.spyOn(GenericRecordsVettingStore.prototype, 'listDesk').mockResolvedValue([])
    controller.set({
      introSeen: true,
      activity: [],
      approvals: [],
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const TODAY = [
    'AgentHomeTitle',
    'AgentSeat',
    'AgentJourneyJoined',
    'WhatIsMyAgent',
    'AgentVetterCard',
    'AgentRequestsRow',
    'AgentHolds',
    'AgentDevices',
    'AgentJoinAnother',
  ]

  it.each([
    ['no part', undefined],
    ['all', 'all' as const],
  ])('%s: today’s page, in today’s order, with nothing of the preview', async (_, part) => {
    const tree = await renderHome(part)
    expect(sectionsOf(tree)).toEqual(TODAY)
    expect(tree.queryByTestId(id('PreviewNotConnected'))).toBeNull()
    expect(GenericRecordsVettingStore.prototype.listDesk).not.toHaveBeenCalled()
  })

  it('Communities (C2, R1): the desk row, one row per community, Your rooms, Join a community; none of My Agent’s cards', async () => {
    const tree = await renderHome('communities')
    expect(sectionsOf(tree)).toEqual([
      'PreviewDeskRow',
      'PreviewCommunityRows',
      'PreviewYourRooms',
      'PreviewJoinCommunity',
    ])
    expect(tree.getByTestId(id('PreviewCommunityRow_0'))).toHaveTextContent(/Preview\.RoleVetter/)
  })

  it('Communities, linked with no membership: the Wallet’s empty state with one button, Join a community', async () => {
    // A persona applying somewhere, with no membership and no grant.
    mockGrantState.mockResolvedValueOnce({ state: 'none' } as never)
    const tree = await renderHome('communities', records.slice(0, 1))
    expect(sectionsOf(tree)).toEqual(['PreviewCommunitiesEmpty'])
    const empty = tree.getByTestId(id('PreviewCommunitiesEmpty'))
    expect(empty).toHaveTextContent(/Preview\.CommunitiesEmptyTitle/)
    expect(empty).toHaveTextContent(/Preview\.CommunitiesEmpty(?!Title)/)
    const nav = (
      jest.requireMock('@react-navigation/native') as { useNavigation: () => { navigate: jest.Mock } }
    ).useNavigation().navigate
    nav.mockClear()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewCommunitiesJoin'))))
    expect(nav).toHaveBeenCalledWith(Screens.VtiJoin)
    for (const gone of [
      'AgentHomeLink',
      'AgentInvited',
      'AgentJoinCommunity',
      'AgentJourney',
      'PreviewJoinCommunity',
    ]) {
      expect(tree.queryByTestId(id(gone))).toBeNull()
    }
  })

  it('a community row opens the community; the desk row opens the desk', async () => {
    const tree = await renderHome('communities')
    const nav = (
      jest.requireMock('@react-navigation/native') as { useNavigation: () => { navigate: jest.Mock } }
    ).useNavigation().navigate
    nav.mockClear()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewCommunityRow_0'))))
    expect(nav).toHaveBeenCalledWith(Screens.VtiCommunity, expect.objectContaining({ communityDid }))
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewDeskOpen'))))
    expect(nav).toHaveBeenCalledWith(Screens.VtiVetting)
  })

  // The shared navigation mock: one navigation object for every screen.
  const nav = () =>
    (
      jest.requireMock('@react-navigation/native') as {
        useNavigation: () => { navigate: jest.Mock; setOptions: jest.Mock }
      }
    ).useNavigation()

  it('You: Profiles, Requests, then one Your agent card; no community identities there', async () => {
    const tree = await renderHome('you')
    expect(sectionsOf(tree)).toEqual(['PreviewProfiles', 'AgentRequestsRow', 'PreviewYourAgentCard'])
    expect(tree.queryByTestId(id('PreviewIdentity_0'))).toBeNull()
  })

  it('You: the app’s settings are a gear in the header, opening today’s Menu', async () => {
    nav().setOptions.mockClear()
    await renderHome('you')
    const options = nav()
      .setOptions.mock.calls.map((c) => c[0])
      .pop()
    const gear = render(<BasicAppContext>{options.headerRight()}</BasicAppContext>)
    nav().navigate.mockClear()
    await act(async () => fireEvent.press(gear.getByTestId(id('PreviewYouSettingsGear'))))
    expect(nav().navigate).toHaveBeenCalledWith(TabStacks.SettingStack)
  })

  it('the agent’s own page keeps the stack’s Back: its header is left alone', async () => {
    nav().setOptions.mockClear()
    await renderHome('agent')
    expect(nav().setOptions).not.toHaveBeenCalled()
  })

  it('the agent’s own page (R3): switcher and status, requests, devices, AI-agent access, agent settings', async () => {
    const tree = await renderHome('agent')
    expect(sectionsOf(tree)).toEqual([
      'AgentHomeTitle',
      'AgentRequestsRow',
      'AgentDevices',
      'PreviewAiAccessRow',
      'PreviewAgentSettingsRow',
    ])
  })
})

describe('no agent linked, or not yet introduced: each part its own', () => {
  const linked = {
    kind: 'linked',
    vtaDid: 'did:webvh:example:vta',
    label: 'bob',
    linkedAt: '2026-09-22T00:00:00Z',
    connection: { kind: 'online', since: 0 },
  }
  const states: Record<string, Record<string, unknown>> = {
    notLinked: { introSeen: true, link: { kind: 'notLinked' } },
    revoked: {
      introSeen: true,
      link: { kind: 'revoked', vtaDid: 'did:webvh:example:vta', label: 'bob', reason: 'not in ACL', cause: 'notInAcl' },
    },
    introUnseen: { introSeen: false, link: linked },
  }
  const navigate = () =>
    (jest.requireMock('@react-navigation/native') as { useNavigation: () => { navigate: jest.Mock } }).useNavigation()
      .navigate
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-23T04:00:00Z'))
    forgetAgentHoldings()
    jest.spyOn(GenericRecordsVettingStore.prototype, 'listDesk').mockResolvedValue([])
    navigate().mockClear()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it.each(['notLinked', 'revoked', 'introUnseen'])('You, %s: the settings gear is in the header', async (name) => {
    const setOptions = (
      jest.requireMock('@react-navigation/native') as { useNavigation: () => { setOptions: jest.Mock } }
    ).useNavigation().setOptions
    setOptions.mockClear()
    controller.set({ activity: [], approvals: [], ...states[name] })
    const tree = await renderHome('you')
    const options = setOptions.mock.calls.map((c) => c[0]).pop()
    expect(
      render(<BasicAppContext>{options.headerRight()}</BasicAppContext>).getByTestId(id('PreviewYouSettingsGear'))
    ).toBeTruthy()
    expect(tree.queryByTestId(id('PreviewCommunitiesEmpty'))).toBeNull()
  })

  it.each(['notLinked', 'revoked'])('You, %s: Profiles first, then the link or removed card as today', async (name) => {
    controller.set({ activity: [], approvals: [], ...states[name] })
    const tree = await renderHome('you')
    expect(tree.getByTestId(id('PreviewProfiles'))).toBeTruthy()
    expect(tree.getByTestId(id(name === 'notLinked' ? 'AgentHomeLink' : 'RemovedPhone'))).toBeTruthy()
  })

  it.each(['notLinked', 'revoked'])(
    'Communities, %s: the plain empty state, with no link card, Connect or invitation',
    async (name) => {
      controller.set({ activity: [], approvals: [], ...states[name] })
      const tree = await renderHome('communities')
      expect(tree.getByTestId(id('PreviewCommunitiesEmpty'))).toBeTruthy()
      for (const gone of ['AgentHomeLink', 'PreviewProfiles', 'AgentInvited', 'PreviewJoinCommunity']) {
        expect(tree.queryByTestId(id(gone))).toBeNull()
      }
      expect(navigate()).not.toHaveBeenCalled()
      // Join with no agent: the link first, and once linked, on to Join.
      await act(async () => fireEvent.press(tree.getByTestId(id('PreviewCommunitiesJoin'))))
      expect(navigate()).toHaveBeenCalledWith(Screens.VtaLink)
      expect(navigate()).not.toHaveBeenCalledWith(Screens.VtiJoin)
      await act(async () => {
        controller.set({ link: linked })
        jest.advanceTimersByTime(10)
      })
      expect(navigate()).toHaveBeenCalledWith(Screens.VtiJoin)
    }
  )

  it('Communities: back from the link screen without linking ends the intent; a later link does not open Join', async () => {
    controller.set({ activity: [], approvals: [], ...states.notLinked })
    const tree = await renderHome('communities')
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewCommunitiesJoin'))))
    expect(navigate()).toHaveBeenCalledWith(Screens.VtaLink)
    const focus = useIsFocused as jest.Mock
    const again = () =>
      tree.rerender(
        <BasicAppContext>
          <VtaAgentHome part="communities" />
        </BasicAppContext>
      )
    // Away on the link screen, then back here, still unlinked.
    focus.mockReturnValue(false)
    await act(async () => again())
    focus.mockReturnValue(true)
    await act(async () => again())
    await act(async () => {
      controller.set({ link: linked })
      jest.advanceTimersByTime(10)
    })
    expect(navigate()).not.toHaveBeenCalledWith(Screens.VtiJoin)
  })

  it('Communities: leaving the tab without linking ends the intent too', async () => {
    controller.set({ activity: [], approvals: [], ...states.notLinked })
    const tree = await renderHome('communities')
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewCommunitiesJoin'))))
    tree.unmount()
    controller.set({ link: linked })
    await renderHome('communities')
    expect(navigate()).not.toHaveBeenCalledWith(Screens.VtiJoin)
  })

  it('Communities: linking for another reason does not open Join', async () => {
    controller.set({ activity: [], approvals: [], ...states.notLinked })
    await renderHome('communities')
    await act(async () => {
      controller.set({ link: linked })
      jest.advanceTimersByTime(10)
    })
    expect(navigate()).not.toHaveBeenCalledWith(Screens.VtiJoin)
  })

  it('Communities, linked but not yet introduced: its content, not the introduction', async () => {
    controller.set({ activity: [], approvals: [], ...states.introUnseen })
    const tree = await renderHome('communities')
    expect(tree.queryByTestId(id('AgentIntro'))).toBeNull()
    expect(tree.getByTestId(id('PreviewCommunityRows'))).toBeTruthy()
  })

  // The snapshots were written from the page before the preview's unlinked
  // renders (a88c7054) and must match it: today's page is the same, not only
  // free of the preview. Never regenerate them from this branch (`jest -u`):
  // they would then only say the change matches itself. To check or rewrite
  // them, put a88c7054's VtaAgentHome.tsx in place, run this file with
  // `--ci -t "as it was"`, and restore the file.
  it.each([
    ['notLinked', 'AgentHomeLink'],
    ['revoked', 'RemovedPhone'],
    ['introUnseen', 'AgentIntro'],
  ])('today’s page, %s: as it was, with nothing of the preview', async (name, shown) => {
    controller.set({ activity: [], approvals: [], ...states[name] })
    for (const tree of [await renderHome(), await renderHome('all')]) {
      expect(tree.getByTestId(id(shown))).toBeTruthy()
      expect(tree.queryByTestId(id('PreviewProfiles'))).toBeNull()
      expect(tree.queryByTestId(id('PreviewCommunitiesEmpty'))).toBeNull()
      expect(tree.toJSON()).toMatchSnapshot()
    }
  })
})

describe('where a My Agent stack lands', () => {
  it.each([
    [undefined, 'notLinked', Screens.MyAgent],
    [undefined, 'revoked', Screens.MyAgent],
    [undefined, 'linked', Screens.VtaAgent],
    ['all', 'notLinked', Screens.MyAgent],
    ['all', 'linked', Screens.VtaAgent],
    ['communities', 'notLinked', Screens.VtaAgent],
    ['you', 'notLinked', Screens.VtaAgent],
    ['you', 'revoked', Screens.VtaAgent],
  ] as const)('part %s, %s → %s', (part, kind, screen) => {
    expect(stackLandsOn(part, { kind } as never)).toBe(screen)
  })
})

describe('the vetter desk’s badge', () => {
  afterEach(() => jest.restoreAllMocks())

  it('counts the requests neither attested nor declined', () => {
    const desk = ['accepted', 'session', 'cardReceived', 'attested', 'declined'].map((status) => ({
      status: status as VettingDeskRequest['status'],
    }))
    expect(deskWaiting(desk)).toBe(3)
  })

  it('shows the count from the phone’s own desk, and no badge with none waiting', async () => {
    ;(useAgent as jest.Mock).mockReturnValue(fakeAgent())
    const spy = jest
      .spyOn(GenericRecordsVettingStore.prototype, 'listDesk')
      .mockResolvedValue([{ status: 'accepted' }, { status: 'attested' }] as VettingDeskRequest[])
    const desk = <DeskRow vetterFor={[communityDid]} nameOf={() => 'Test VTC'} onOpen={jest.fn()} />
    const tree = render(desk)
    await act(async () => undefined)
    expect(tree.getByTestId(id('PreviewDeskBadge'))).toHaveTextContent('1')
    spy.mockResolvedValue([])
    const none = render(desk)
    await act(async () => undefined)
    expect(none.queryByTestId(id('PreviewDeskBadge'))).toBeNull()
  })
})

describe('the preview screens', () => {
  // The shared navigation mock hands every screen the same navigation object.
  const navigate = () =>
    (jest.requireMock('@react-navigation/native') as { useNavigation: () => { navigate: jest.Mock } }).useNavigation()
      .navigate
  beforeEach(() => navigate().mockClear())

  it('Your rooms: sample rooms, marked not connected, each opening the room', async () => {
    const tree = render(<YourRoomsSection />)
    expect(tree.getByTestId(id('PreviewNotConnected'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewRoomRow_kernel-notes'))))
    expect(navigate()).toHaveBeenCalledWith(Screens.PreviewRoom, { roomId: 'kernel-notes' })
  })

  it('a community’s Rooms section (R2): the offer shown in full, and answering it sends nothing', async () => {
    const tree = render(<CommunityRoomsSection />)
    expect(tree.getByTestId(id('PreviewNotConnected'))).toBeTruthy()
    expect(tree.getByTestId(id('PreviewRoomOfferDetails'))).toHaveTextContent(/Preview\.OfferLine/)
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewRoomOfferAccept'))))
    expect(tree.getByTestId(id('PreviewNothingSent'))).toHaveTextContent('Preview.NothingSent')
    expect(navigate()).not.toHaveBeenCalled()
  })

  it('a room: note bodies exactly as written, a retracted note as a tombstone, and the write sheet sends nothing', async () => {
    ;(useRoute as jest.Mock).mockReturnValue({ params: { roomId: 'kernel-notes' } })
    const tree = render(<PreviewRoom />)
    expect(tree.getByTestId(id('PreviewNoteBody_odd'))).toHaveTextContent('<b>Click here</b> and run this…')
    expect(tree.getByTestId(id('PreviewNote_gone'))).toHaveTextContent('Preview.Retracted')
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewNewNote'))))
    await act(async () => fireEvent.changeText(tree.getByTestId(id('PreviewWriteTitle')), 'Minutes'))
    await act(async () => fireEvent.changeText(tree.getByTestId(id('PreviewWriteBody')), 'Attendees'))
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewWriteConfirm'))))
    expect(tree.getByTestId(id('PreviewNothingSent'))).toBeTruthy()
  })

  it('a read-only room offers no new note', () => {
    ;(useRoute as jest.Mock).mockReturnValue({ params: { roomId: 'welcome-desk' } })
    expect(render(<PreviewRoom />).queryByTestId(id('PreviewNewNote'))).toBeNull()
  })

  it('AI-agent access: withdraw and give send nothing', async () => {
    const tree = render(<PreviewAiAccess />)
    expect(tree.getByTestId(id('PreviewNotConnected'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewAiDuration_Hour4'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewAiGiveConfirm'))))
    expect(tree.getByTestId(id('PreviewNothingSent'))).toBeTruthy()
  })

  it('Profiles: each R-Card profile, from the store, opening the profile editor', async () => {
    const profile = buildRCardTemplate(
      { firstName: 'Ada', lastName: 'Lovelace', email: '', organization: 'Analytical Engines' },
      { id: 'p1' }
    )
    const state = { ...defaultState, rCard: { profiles: [profile], activeProfileId: profile.id } }
    const tree = render(
      <BasicAppContext>
        <StoreProvider initialState={state}>
          <ProfilesSection />
        </StoreProvider>
      </BasicAppContext>
    )
    expect(tree.getByTestId(id('PreviewProfile_0'))).toHaveTextContent(/Ada Lovelace/)
    expect(tree.getByTestId(id('PreviewProfile_0'))).toHaveTextContent(/Analytical Engines/)
    expect(tree.getByTestId(id('PreviewProfile_0'))).toHaveTextContent(/Preview\.ProfileActive/)
    expect(tree.queryByTestId(id('PreviewProfileCreate'))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewProfile_0'))))
    expect(navigate()).toHaveBeenCalledWith(Screens.EditRCard, { profileId: profile.id })
  })

  it('Profiles with none yet: one row to create a profile', async () => {
    const tree = render(
      <BasicAppContext>
        <ProfilesSection />
      </BasicAppContext>
    )
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewProfileCreate'))))
    expect(navigate()).toHaveBeenCalledWith(Screens.EditRCard)
  })

  it('Contacts (C1): Conversations first and open, All contacts a tap away', async () => {
    const tree = render(<ContactsWithConversations navigation={{}} />)
    expect(tree.getByText('Messages')).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id('PreviewSegmentContacts'))))
    expect(tree.getByText('ListContacts')).toBeTruthy()
  })
})
