/**
 * Rooms on the agent home, as the screen wires them: with the rooms flag on, "Your rooms" and a member's
 * community card's Rooms row, each opening the rooms list (the card's for its community); with it off,
 * neither (the flag-on case is the positive control).
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { sampleCapabilities } from '../../rooms/capabilities'
import { toInertText } from '../../rooms/inertText'
import type { RoomsService } from '../../rooms/types'
import { vtaAgent } from '../module/vtaAgent'
import { communityCardKey } from '../screens/CommunityCard'
import VtaAgentHome, { forgetAgentHoldings } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
jest.mock('../module/vtiGrantState', () => ({ ownVetterGrantState: async () => ({ state: 'none' }) }))
let mockRoomsService: RoomsService | undefined
jest.mock('../../rooms/useRoomsService', () => ({ useRoomsService: () => mockRoomsService }))

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
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
]
const service = {
  isSample: false,
  label: 'test',
  capabilities: async () => sampleCapabilities(),
  listMyRooms: async () => [
    {
      roomId: 'did:webvh:room:planning',
      name: toInertText('Planning'),
      nameFrom: 'community',
      source: 'community',
      communityDid,
      communityName: toInertText('Example'),
      tier: 'attributed',
      verbs: ['read'],
      standing: 'member',
    },
  ],
  listOffers: async () => [],
} as unknown as RoomsService

const renderHome = async () => {
  ;(useAgent as jest.Mock).mockReturnValue({
    agent: {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  })
  const tree = render(
    <BasicAppContext>
      <VtaAgentHome />
    </BasicAppContext>
  )
  await act(async () => {
    jest.advanceTimersByTime(10)
  })
  return tree
}

describe('rooms on the agent home', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-23T04:00:00Z'))
    forgetAgentHoldings()
    ;(vtaAgent as unknown as { set(next: Record<string, unknown>): void }).set({
      introSeen: true,
      activity: [],
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => jest.useRealTimers())

  it('rooms flag on: "Your rooms" and the card\'s Rooms row, each opening the rooms list', async () => {
    mockRoomsService = service
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = await renderHome()
    const cardRow = testIdWithKey(`CommunityRoomsRow_${communityCardKey(communityDid)}`)
    await waitFor(() => expect(tree.getByTestId(cardRow)).toBeTruthy())
    fireEvent.press(tree.getByTestId(cardRow))
    expect(navigate).toHaveBeenCalledWith(Screens.RoomsList, { communityDid })
    fireEvent.press(tree.getByTestId(testIdWithKey('YourRoomsRow')))
    expect(navigate).toHaveBeenCalledWith(Screens.RoomsList)
  })

  it('rooms flag off: neither row on the same holdings', async () => {
    mockRoomsService = undefined
    const tree = await renderHome()
    // The card itself is there, so an absent row is not an absent card.
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('AgentMembershipRow'))).toBeTruthy())
    expect(tree.queryByTestId(testIdWithKey('YourRoomsRow'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey(`CommunityRoomsRow_${communityCardKey(communityDid)}`))).toBeNull()
  })
})
