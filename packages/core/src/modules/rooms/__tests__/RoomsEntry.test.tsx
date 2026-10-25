/**
 * The ways into rooms (R2): a room's row, the list's states, "Your rooms" and a card's Rooms row, and the
 * read behind them. Words come from the service's reasons; a room known only from the agent's keys reads
 * as an ID with "Details not loaded" and no tier; nothing shows without a service.
 */
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { sampleCapabilities } from '../capabilities'
import { toInertText } from '../inertText'
import RoomRow, { roomHandle } from '../components/RoomRow'
import RoomsListBody, { groupRooms } from '../components/RoomsListBody'
import { CommunityRoomsRow, YourRoomsRow } from '../components/RoomsEntryRows'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { OperationStatus, RoomOffer, RoomsCapabilities, RoomsService, RoomSummary } from '../types'
import { useMyRooms, type MyRooms } from '../useMyRooms'

const inApp = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const id = (key: string) => testIdWithKey(key)

const room = (over: Partial<RoomSummary> = {}): RoomSummary => ({
  roomId: 'did:webvh:c:planning',
  name: toInertText('Planning'),
  nameFrom: 'community',
  source: 'community',
  communityDid: 'did:webvh:c',
  communityName: toInertText('Test VTC'),
  tier: 'attributed',
  verbs: ['read'],
  validUntil: '2027-01-15T00:00:00Z',
  standing: 'member',
  ...over,
})
const custody = room({
  roomId: 'did:webvh:sample:3f9a7c21e0',
  name: toInertText('3f9a7c21'),
  nameFrom: 'roomId',
  source: 'custody',
  communityDid: undefined,
  communityName: undefined,
  tier: 'unknown',
  verbs: undefined,
  validUntil: undefined,
})
const offer: RoomOffer = {
  offerId: 'o1',
  roomId: 'did:webvh:c:kernel',
  roomName: toInertText('Kernel notes'),
  communityDid: 'did:webvh:c',
  communityName: toInertText('Test VTC'),
  tier: 'open',
  verbs: ['read'],
}
const no = (reason: OperationStatus['reason']): OperationStatus => ({ status: 'unavailable', reason, detail: 'test' })
const caps = (over: Partial<RoomsCapabilities> = {}): RoomsCapabilities => ({ ...sampleCapabilities(), ...over })
const myRooms = (over: Partial<MyRooms> = {}): MyRooms => ({ failed: false, reload: jest.fn(), ...over })

describe('a room row', () => {
  test('a community room: its name, tier and expiry; not a button without onPress', () => {
    const tree = inApp(<RoomRow room={room()} />)
    expect(tree.getByText('Planning')).toBeTruthy()
    expect(tree.getByTestId(id('RoomTier'))).toBeTruthy()
    expect(tree.getByText('Rooms.Until')).toBeTruthy()
    expect(tree.getByTestId(id(`RoomRow_${roomHandle(room().roomId)}`)).props.accessibilityRole).toBeUndefined()
  })

  test('a custody-only room: named as an ID, "Details not loaded", and no tier badge (control above)', () => {
    const tree = inApp(<RoomRow room={custody} />)
    expect(tree.getByText('Rooms.RoomById')).toBeTruthy()
    expect(tree.queryByText('3f9a7c21')).toBeNull()
    expect(tree.getByText('Rooms.DetailsNotLoaded')).toBeTruthy()
    expect(tree.queryByTestId(id('RoomTier'))).toBeNull()
  })

  test('a lapsed membership says so instead of an expiry', () => {
    const tree = inApp(<RoomRow room={room({ standing: 'lapsed' })} />)
    expect(tree.getByText('Rooms.StandingLapsed')).toBeTruthy()
    expect(tree.queryByText('Rooms.Until')).toBeNull()
  })

  test('with onPress: a button that opens that room', () => {
    const onPress = jest.fn()
    const tree = inApp(<RoomRow room={room()} onPress={onPress} />)
    fireEvent.press(tree.getByTestId(id(`RoomRow_${roomHandle(room().roomId)}`)))
    expect(onPress).toHaveBeenCalledWith(room())
  })
})

describe('the rooms list', () => {
  test('reading: a spinner, not an empty list', () => {
    const tree = inApp(<RoomsListBody myRooms={myRooms()} acrossCommunities />)
    expect(tree.getByTestId(id('RoomsReading'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomsNone'))).toBeNull()
  })

  test('a first read that failed: says so and offers to try again', () => {
    const reload = jest.fn()
    const tree = inApp(<RoomsListBody myRooms={myRooms({ failed: true, reload })} acrossCommunities />)
    expect(tree.getByTestId(id('RoomsReadFailed'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('RoomsTryAgain')))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test("listing rooms not available: the reason's words, not an empty list", () => {
    const tree = inApp(
      <RoomsListBody
        myRooms={myRooms({ capabilities: caps({ listMyRooms: no('agentDoesNotServe') }) })}
        acrossCommunities
      />
    )
    expect(tree.getByText('Rooms.AgentNeedsUpdate')).toBeTruthy()
    expect(tree.queryByTestId(id('RoomsNone'))).toBeNull()
  })

  test('no rooms: says none, and lists offers waiting', () => {
    const tree = inApp(
      <RoomsListBody myRooms={myRooms({ capabilities: caps(), rooms: [], offers: [offer] })} acrossCommunities />
    )
    expect(tree.getByTestId(id('RoomsNone'))).toBeTruthy()
    expect(tree.getByText('Kernel notes')).toBeTruthy()
    expect(tree.getByTestId(id(`RoomOfferRow_${roomHandle('o1')}`))).toBeTruthy()
  })

  test('across communities: grouped by community, custody-only rooms last under "Community not known yet"', () => {
    expect(groupRooms([custody, room()]).map((g) => g.key)).toEqual(['did:webvh:c', 'custody'])
    const tree = inApp(
      <RoomsListBody
        myRooms={myRooms({ capabilities: caps(), rooms: [custody, room()], offers: [] })}
        acrossCommunities
      />
    )
    expect(tree.getByText('Test VTC')).toBeTruthy()
    expect(tree.getByText('Rooms.CommunityNotKnown')).toBeTruthy()
  })

  test('a re-read that failed keeps the rooms and says they are what was last read', () => {
    const tree = inApp(
      <RoomsListBody
        myRooms={myRooms({ capabilities: caps(), rooms: [room()], offers: [], failed: true })}
        acrossCommunities
      />
    )
    expect(tree.getByText('Planning')).toBeTruthy()
    expect(tree.getByTestId(id('RoomsStale'))).toBeTruthy()
  })
})

describe('the entry rows', () => {
  const service = { isSample: false } as RoomsService

  test('no service (rooms flag off): neither row, while the same data with a service shows both', () => {
    const data = myRooms({ capabilities: caps(), rooms: [room()], offers: [offer] })
    const off = inApp(
      <>
        <YourRoomsRow myRooms={data} onOpen={jest.fn()} />
        <CommunityRoomsRow myRooms={data} communityDid="did:webvh:c" handle="c" onOpen={jest.fn()} />
      </>
    )
    expect(off.queryByTestId(id('YourRoomsRow'))).toBeNull()
    expect(off.queryByTestId(id('CommunityRoomsRow_c'))).toBeNull()
    const on = inApp(
      <>
        <YourRoomsRow service={service} myRooms={data} onOpen={jest.fn()} />
        <CommunityRoomsRow service={service} myRooms={data} communityDid="did:webvh:c" handle="c" onOpen={jest.fn()} />
      </>
    )
    expect(on.getByTestId(id('YourRoomsRow'))).toBeTruthy()
    expect(on.getByTestId(id('CommunityRoomsRow_c'))).toBeTruthy()
  })

  test('"Your rooms" opens the list when rooms can be listed', () => {
    const onOpen = jest.fn()
    const tree = inApp(
      <YourRoomsRow
        service={service}
        myRooms={myRooms({ capabilities: caps(), rooms: [room()], offers: [] })}
        onOpen={onOpen}
      />
    )
    fireEvent.press(tree.getByTestId(id('YourRoomsRow')))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('"Your rooms" when listing is not available: disabled, with the reason, and does nothing', () => {
    const onOpen = jest.fn()
    const tree = inApp(
      <YourRoomsRow
        service={service}
        myRooms={myRooms({ capabilities: caps({ listMyRooms: no('noAgentLinked') }) })}
        onOpen={onOpen}
      />
    )
    expect(tree.getByText('Rooms.NoAgentLinked')).toBeTruthy()
    expect(tree.getByTestId(id('YourRoomsRow')).props.accessibilityState).toEqual({ disabled: true })
    fireEvent.press(tree.getByTestId(id('YourRoomsRow')))
    expect(onOpen).not.toHaveBeenCalled()
  })

  test("a card's Rooms row counts only its community, and is absent for a community with none", () => {
    const data = myRooms({ capabilities: caps(), rooms: [room(), custody], offers: [offer] })
    const onOpen = jest.fn()
    const tree = inApp(
      <>
        <CommunityRoomsRow service={service} myRooms={data} communityDid="did:webvh:c" handle="c" onOpen={onOpen} />
        <CommunityRoomsRow service={service} myRooms={data} communityDid="did:webvh:other" handle="o" onOpen={onOpen} />
      </>
    )
    expect(tree.queryByTestId(id('CommunityRoomsRow_o'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('CommunityRoomsRow_c')))
    expect(onOpen).toHaveBeenCalledWith('did:webvh:c')
  })
})

describe('the read behind them', () => {
  test('an operation that is not available is not called', async () => {
    const service = {
      capabilities: jest.fn(async () =>
        caps({ listMyRooms: no('agentDoesNotServe'), listOffers: no('agentDoesNotServe') })
      ),
      listMyRooms: jest.fn(),
      listOffers: jest.fn(),
    } as unknown as RoomsService
    const { result } = renderHook(() => useMyRooms(service))
    await waitFor(() => expect(result.current.capabilities).toBeDefined())
    expect(service.listMyRooms).not.toHaveBeenCalled()
    expect(service.listOffers).not.toHaveBeenCalled()
    expect(result.current.rooms).toBeUndefined()
    expect(result.current.offers).toEqual([])
  })

  test("narrowed to one community: that community's rooms and offers only", async () => {
    const service = {
      capabilities: async () => caps(),
      listMyRooms: async () => [room(), custody, room({ roomId: 'did:webvh:x:r', communityDid: 'did:webvh:x' })],
      listOffers: async () => [offer, { ...offer, offerId: 'o2', communityDid: 'did:webvh:x' }],
    } as unknown as RoomsService
    const { result } = renderHook(() => useMyRooms(service, 'did:webvh:c'))
    await waitFor(() => expect(result.current.rooms).toBeDefined())
    expect(result.current.rooms?.map((r) => r.roomId)).toEqual(['did:webvh:c:planning'])
    expect(result.current.offers?.map((o) => o.offerId)).toEqual(['o1'])
  })

  test('a failed re-read keeps what was read and marks it', async () => {
    let fail = false
    const service = {
      capabilities: async () => {
        if (fail) throw new Error('down')
        return caps()
      },
      listMyRooms: async () => [room()],
      listOffers: async () => [],
    } as unknown as RoomsService
    const { result } = renderHook(() => useMyRooms(service))
    await waitFor(() => expect(result.current.rooms).toHaveLength(1))
    fail = true
    await act(async () => result.current.reload())
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.rooms).toHaveLength(1)
  })

  test('the sample service end to end: its three rooms, the custody one last, and its offer', async () => {
    const service = createSampleRoomsService()
    const { result } = renderHook(() => useMyRooms(service))
    await waitFor(() => expect(result.current.rooms).toBeDefined())
    const tree = inApp(<RoomsListBody myRooms={result.current} acrossCommunities />)
    expect(tree.getByText('Planning')).toBeTruthy()
    expect(tree.getByText('Welcome desk')).toBeTruthy()
    expect(tree.getByText('Rooms.CommunityNotKnown')).toBeTruthy()
    expect(tree.getByText('Kernel notes')).toBeTruthy()
  })
})
