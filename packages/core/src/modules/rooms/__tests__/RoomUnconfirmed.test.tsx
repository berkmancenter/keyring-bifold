/**
 * The room chat's "From last time · Updating…": said under the newest post (the header of the list drawn bottom up)
 * while the posts drawn are the phone's own copy from before and the room's first listing has not answered
 * (`useRoomPosts` `unconfirmed`). Gone once it has. A poll that failed meanwhile says both, with Try again. When the
 * flag flips is the hook's side (useRoomPosts' own tests).
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockUnconfirmed: boolean | undefined
let mockPollFailed = false
const mockPollNow = jest.fn()
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
}))
// The real feed, with only what the test sets laid over it.
jest.mock('../useRoomPosts', () => {
  const actual = jest.requireActual('../useRoomPosts')
  return {
    ...actual,
    useRoomPosts: (...args: unknown[]) => ({
      ...actual.useRoomPosts(...args),
      ...(mockUnconfirmed === undefined ? {} : { unconfirmed: mockUnconfirmed }),
      pollFailed: mockPollFailed,
      pollNow: mockPollNow,
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

const id = (key: string) => testIdWithKey(key)
const show = () =>
  render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
const shown = async (tree: ReturnType<typeof show>) =>
  waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))

beforeEach(() => {
  mockService = createSampleRoomsService()
  mockUnconfirmed = undefined
  mockPollFailed = false
  mockPollNow.mockReset()
})

describe("posts from the phone's copy, before the room's first listing answers", () => {
  test('say "From last time · Updating…" under the newest post', async () => {
    mockUnconfirmed = true
    const tree = show()
    await shown(tree)
    const list = tree.getByTestId(id('RoomPosts'))
    expect(list.props.inverted).toBe(true)
    expect(list.props.ListHeaderComponent.props.testID).toBe(id('RoomUnconfirmed'))
    expect(tree.getByTestId(id('RoomUnconfirmed'))).toHaveTextContent('Rooms.FromLastTimeUpdating')
    expect(tree.getByTestId(id('RoomUnconfirmed')).props.accessibilityLiveRegion).toBe('polite')
    expect(tree.queryByTestId(id('RoomPollFailed'))).toBeNull()
  })

  test('the line goes once the listing has answered', async () => {
    mockUnconfirmed = true
    const tree = show()
    await shown(tree)
    expect(tree.getByTestId(id('RoomUnconfirmed'))).toBeTruthy()
    mockUnconfirmed = false
    tree.rerender(
      <BasicAppContext>
        <Room />
      </BasicAppContext>
    )
    await waitFor(() => expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull())
    expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0)
  })

  test('control: confirmed posts say nothing', async () => {
    mockUnconfirmed = false
    const tree = show()
    await shown(tree)
    expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull()
    expect(tree.queryByTestId(id('RoomFromLastTime'))).toBeNull()
  })

  test('control: a feed that does not say (a build before the kept copy) says nothing', async () => {
    const tree = show()
    await shown(tree)
    expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull()
  })

  test('control: only `true` counts, never another truthy value', async () => {
    mockUnconfirmed = 'yes' as unknown as boolean
    const tree = show()
    await shown(tree)
    expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull()
  })

  test('nothing is said in a room with no posts drawn', async () => {
    mockUnconfirmed = true
    const sample = createSampleRoomsService()
    jest.spyOn(sample, 'listNotes').mockResolvedValue({
      notes: [],
      complete: true,
      check: { verdict: 'consistent', detail: '' },
    })
    mockService = sample
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull()
  })

  test('a poll that failed meanwhile says both, and Try again asks at once', async () => {
    mockUnconfirmed = true
    mockPollFailed = true
    const tree = show()
    await shown(tree)
    expect(tree.queryByTestId(id('RoomUnconfirmed'))).toBeNull()
    expect(tree.getByTestId(id('RoomPollFailed'))).toHaveTextContent(
      /Rooms\.FromLastTime.*Rooms\.RefreshFailed.*Rooms\.TryAgain/
    )
    expect(tree.getByTestId(id('RoomPollFailed'))).not.toHaveTextContent(/FromLastTimeUpdating/)
    fireEvent.press(tree.getByTestId(id('RoomPollTryAgain')))
    expect(mockPollNow).toHaveBeenCalledTimes(1)
  })

  test('control: a failed poll over confirmed posts does not say "From last time"', async () => {
    mockPollFailed = true
    const tree = show()
    await shown(tree)
    expect(tree.getByTestId(id('RoomPollFailed'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomFromLastTime'))).toBeNull()
  })
})
