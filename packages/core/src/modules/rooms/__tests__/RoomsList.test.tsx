/**
 * "Your rooms": with the sample service, the "Sample data" banner and the rooms; with the rooms flag off
 * (no service), a line saying rooms are off and no list; opened for one community, only that community.
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: { communityDid?: string } | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomsList = require('../screens/RoomsList').default

const show = () =>
  render(
    <BasicAppContext>
      <RoomsList />
    </BasicAppContext>
  )

beforeEach(() => {
  mockService = undefined
  mockParams = undefined
})

describe('Your rooms', () => {
  test('on sample data: the banner, then the rooms across communities', async () => {
    mockService = createSampleRoomsService()
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeTruthy()
    await waitFor(() => expect(tree.getByText('Planning')).toBeTruthy())
    expect(tree.getByText('Rooms.CommunityNotKnown')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RoomsOff'))).toBeNull()
  })

  test('rooms flag off: says so, with no list and no banner (control above)', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsOff'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('RoomsReading'))).toBeNull()
  })

  test("opened from a community's card: that community's rooms only, not grouped", async () => {
    mockService = createSampleRoomsService()
    mockParams = { communityDid: 'did:webvh:sample:test-vtc' }
    const tree = show()
    await waitFor(() => expect(tree.getByText('Planning')).toBeTruthy())
    expect(tree.getByText('Welcome desk')).toBeTruthy()
    expect(tree.queryByText('Rooms.RoomById')).toBeNull()
    expect(tree.queryByText('Rooms.CommunityNotKnown')).toBeNull()
  })
})
