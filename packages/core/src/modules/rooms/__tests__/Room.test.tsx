/**
 * The room screen (R3). Each section's words come from the room's statuses; a custody-only room says
 * "Details not loaded" and is never asked for notes or files; the host check warns only on `conflict`;
 * one part failing leaves the rest; a note's key is never shown as its title.
 */
import { useNavigation } from '@react-navigation/native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { toInertText } from '../inertText'
import { roomHandle } from '../components/RoomRow'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { HostCheck, NoteList, Room as RoomRecord, RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomsList = require('../screens/RoomsList').default

const id = (key: string) => testIdWithKey(key)
const show = (Screen: React.FC = Room) =>
  render(
    <BasicAppContext>
      <Screen />
    </BasicAppContext>
  )

const PLANNING = 'did:webvh:sample:planning'
const CUSTODY = 'did:webvh:sample:3f9a7c21e0'

/** A service whose one room is open to the member, with notes as given. */
const withNotes = (list: Partial<NoteList> | Error): RoomsService => {
  const room: RoomRecord = {
    roomId: 'did:webvh:r:one',
    name: toInertText('One'),
    nameFrom: 'community',
    source: 'community',
    communityDid: 'did:webvh:c',
    communityName: toInertText('C'),
    tier: 'open',
    verbs: ['read'],
    standing: 'member',
    actingAs: { did: 'did:peer:2.me-1234567890' },
  }
  return {
    isSample: false,
    capabilities: async () => sampleCapabilities(),
    getRoom: async () => room,
    roomCapabilities: async () => deriveRoomCapabilities(sampleCapabilities(), room),
    listNotes: async () => {
      if (list instanceof Error) throw list
      return { notes: [], complete: true, check: { verdict: 'consistent', detail: '' }, ...list }
    },
    listFiles: async () => [],
  } as unknown as RoomsService
}

beforeEach(() => {
  mockService = undefined
  mockParams = undefined
})

describe('a room, on sample data', () => {
  test('Planning: title, tier and who reads it, who the member acts as, notes pinned first, files, access, chat', async () => {
    mockService = createSampleRoomsService()
    mockParams = { roomId: PLANNING }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('Planning'))
    expect(tree.getByTestId(id('RoomsSampleDataBanner'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomTier'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomTierHint'))).toHaveTextContent('Rooms.TierAttributedHint')
    expect(tree.getByTestId(id('RoomActingAs'))).toHaveTextContent('Rooms.ActingAs')
    await waitFor(() => expect(tree.getByText('Agenda for Thursday')).toBeTruthy())
    const order = tree.getAllByTestId(/RoomNoteRow_/).map((n) => n.props.testID)
    expect(order[0]).toBe(id(`RoomNoteRow_${roomHandle('n1')}`)) // the pinned one
    expect(tree.getByText(/Rooms\.NoteRetracted/)).toBeTruthy()
    expect(tree.getByText('Agenda, Oct 30.pdf')).toBeTruthy()
    expect(tree.getByTestId(id('RoomYourAccess'))).toHaveTextContent('Rooms.AccessWrite')
    expect(tree.getByTestId(id('RoomMembersNote'))).toHaveTextContent('Rooms.AdminOnly')
    expect(tree.getByText('Rooms.NotAvailableYet')).toBeTruthy()
    expect(tree.getByTestId(id('RoomGroupChat')).props.accessibilityState).toEqual({ disabled: true })
  })

  test('a custody-only room: an ID for a name, "Details not loaded" throughout, and no notes or files asked for', async () => {
    const sample = createSampleRoomsService()
    const listNotes = jest.spyOn(sample, 'listNotes')
    const listFiles = jest.spyOn(sample, 'listFiles')
    mockService = sample
    mockParams = { roomId: CUSTODY }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('Rooms.RoomById'))
    expect(tree.queryByTestId(id('RoomTier'))).toBeNull()
    expect(tree.queryByTestId(id('RoomTierHint'))).toBeNull()
    expect(tree.getByTestId(id('RoomNotesUnavailable'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(tree.getByTestId(id('RoomFilesUnavailable'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(tree.getByTestId(id('RoomYourAccess'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(listNotes).not.toHaveBeenCalled()
    expect(listFiles).not.toHaveBeenCalled()
  })
})

describe("the host's answer", () => {
  test.each<[HostCheck['verdict'], boolean]>([
    ['conflict', true],
    ['unverified', false],
    ['consistent', false],
  ])('%s: warning shown = %s', async (verdict, warned) => {
    mockService = withNotes({ check: { verdict, detail: 'test' } })
    mockParams = { roomId: 'did:webvh:r:one' }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomNotesNone'))).toBeTruthy())
    expect(!!tree.queryByTestId(id('RoomHostConflict'))).toBe(warned)
  })

  test('a list the host stopped early says some notes may be missing', async () => {
    mockService = withNotes({ complete: false })
    mockParams = { roomId: 'did:webvh:r:one' }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomNotesIncomplete'))).toBeTruthy())
  })

  test("notes that couldn't be read say so, and the room still shows", async () => {
    mockService = withNotes(new Error('host down'))
    mockParams = { roomId: 'did:webvh:r:one' }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomNotesFailed'))).toBeTruthy())
    expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('One')
    expect(tree.getByTestId(id('RoomFilesNone'))).toBeTruthy()
  })

  test('a note with no title visible to the host is "Encrypted note", never its key', async () => {
    mockService = withNotes({ notes: [{ key: 'k-opaque-123', version: 1, status: 'active', pinned: false }] })
    mockParams = { roomId: 'did:webvh:r:one' }
    const tree = show()
    await waitFor(() => expect(tree.getByText('Rooms.NoteEncrypted')).toBeTruthy())
    expect(tree.queryByText(/k-opaque-123/)).toBeNull()
  })
})

describe('reaching a room', () => {
  test("a room that couldn't be read says so and offers to try again", async () => {
    let fail = true
    const service = withNotes({})
    const getRoom = service.getRoom
    service.getRoom = async (roomId: string) => {
      if (fail) throw new Error('down')
      return getRoom(roomId)
    }
    mockService = service
    mockParams = { roomId: 'did:webvh:r:one' }
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    fail = false
    fireEvent.press(tree.getByTestId(id('RoomTryAgain')))
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('One'))
  })

  test('rooms flag off: says so, and nothing is read (no service)', () => {
    mockParams = { roomId: PLANNING }
    const tree = show()
    expect(tree.getByTestId(id('RoomsOff'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomReading'))).toBeNull()
  })

  test('"Your rooms" opens a room by its ID', async () => {
    mockService = createSampleRoomsService()
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = show(RoomsList)
    await waitFor(() => expect(tree.getByText('Planning')).toBeTruthy())
    fireEvent.press(tree.getByTestId(id(`RoomRow_${roomHandle(PLANNING)}`)))
    expect(navigate).toHaveBeenCalledWith(Screens.Room, { roomId: PLANNING })
  })
})
