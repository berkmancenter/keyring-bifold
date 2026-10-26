/**
 * A room offer's consent screen: opened from an `offerRef` alone (no offers list behind it), it shows who offers
 * which room, its tier, what the member could do, and the identity they would join as, before they agree. Join asks
 * for confirmation first and opens the room; a stale preview is read again and nothing is sent; "Not now" hides
 * the offer on this phone. With accepting not available it says why and offers nothing.
 */
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { requestBiometricConfirmationWithUI } from '../../vrc/vrc-biometric'
import { createSampleRoomsService } from '../sample/sampleRooms'
import { PREVIEW_TOKEN_TTL_MS, type RoomsService } from '../types'

let mockService: RoomsService | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
}))
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true, reason: 'confirmed' })),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomOffer = require('../screens/RoomOffer').default

const confirm = requestBiometricConfirmationWithUI as jest.Mock
// The mock's one navigation object, the same one the screen gets.
const navigation = jest.requireMock('@react-navigation/native').useNavigation() as {
  replace: jest.Mock
  goBack: jest.Mock
}

const show = (offerRef = 'o1') => {
  ;(useRoute as jest.Mock).mockReturnValue({ params: { offerRef } })
  return render(
    <BasicAppContext>
      <RoomOffer />
    </BasicAppContext>
  )
}

let clock = 0
const sample = () => createSampleRoomsService({ now: () => clock })

beforeEach(() => {
  clock = Date.parse('2026-10-26T12:00:00Z')
  mockService = undefined
  confirm.mockClear()
  confirm.mockResolvedValue({ success: true, reason: 'confirmed' })
  navigation.replace.mockClear()
  navigation.goBack.mockClear()
})

describe('RoomOffer', () => {
  test('from an offerRef alone: who offers which room, what the member could do, and who they join as', async () => {
    mockService = sample()
    const previewOffer = jest.spyOn(mockService, 'previewOffer')
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeTruthy()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferTitle'))).toBeTruthy())
    expect(previewOffer).toHaveBeenCalledWith('o1')
    expect(tree.getByText('Kernel notes')).toBeTruthy()
    expect(tree.getByText('Rooms.TierAttributedHint')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RoomOfferAccess'))).toHaveTextContent('Rooms.AccessWrite')
    expect(tree.getByTestId(testIdWithKey('RoomOfferUntil'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RoomOfferActingAs'))).toHaveTextContent('Rooms.OfferJoinAs')
    expect(tree.getByTestId(testIdWithKey('RoomOfferAccept'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RoomOfferNotNow'))).toBeTruthy()
  })

  test('Join asks first, then accepts exactly the preview and opens the room', async () => {
    mockService = sample()
    const acceptOffer = jest.spyOn(mockService, 'acceptOffer')
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferAccept'))).toBeTruthy())
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferAccept')))
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(acceptOffer).toHaveBeenCalledTimes(1)
    expect(navigation.replace).toHaveBeenCalledWith(Screens.Room, { roomId: 'did:webvh:sample:kernel-notes' })
    expect(await mockService.listOffers()).toEqual([])
  })

  test('declining the confirmation sends nothing (control: the test above accepts)', async () => {
    mockService = sample()
    const acceptOffer = jest.spyOn(mockService, 'acceptOffer')
    confirm.mockResolvedValue({ success: false, reason: 'cancelled' })
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferAccept'))).toBeTruthy())
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferAccept')))
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(acceptOffer).not.toHaveBeenCalled()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  test('a stale preview is read again and the member asked to check it; nothing is sent until they join again', async () => {
    mockService = sample()
    const previewOffer = jest.spyOn(mockService, 'previewOffer')
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferAccept'))).toBeTruthy())
    clock += PREVIEW_TOKEN_TTL_MS + 1
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferAccept')))
    })
    expect(previewOffer).toHaveBeenCalledTimes(2)
    expect(tree.getByTestId(testIdWithKey('RoomOfferRefreshed'))).toBeTruthy()
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(await mockService.listOffers()).toHaveLength(1)

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferAccept')))
    })
    expect(navigation.replace).toHaveBeenCalledWith(Screens.Room, { roomId: 'did:webvh:sample:kernel-notes' })
  })

  test('an accept that fails says so and stays on the offer', async () => {
    mockService = sample()
    jest.spyOn(mockService, 'acceptOffer').mockRejectedValue(new Error('community unreachable'))
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferAccept'))).toBeTruthy())
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferAccept')))
    })
    expect(tree.getByTestId(testIdWithKey('RoomOfferFailed'))).toHaveTextContent('Rooms.OfferAcceptFailed')
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(tree.getByTestId(testIdWithKey('RoomOfferTitle'))).toBeTruthy()
  })

  test('Not now hides the offer on this phone and goes back, without asking or accepting', async () => {
    mockService = sample()
    const acceptOffer = jest.spyOn(mockService, 'acceptOffer')
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferNotNow'))).toBeTruthy())
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferNotNow')))
    })
    expect(navigation.goBack).toHaveBeenCalledTimes(1)
    expect(await mockService.listOffers()).toEqual([])
    expect(confirm).not.toHaveBeenCalled()
    expect(acceptOffer).not.toHaveBeenCalled()
  })

  test('accepting not available: says why, reads no offer, offers no button', async () => {
    mockService = sample()
    const real = await mockService.capabilities()
    jest.spyOn(mockService, 'capabilities').mockResolvedValue({
      ...real,
      acceptOffer: { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built' },
    })
    const previewOffer = jest.spyOn(mockService, 'previewOffer')
    const tree = show()
    await waitFor(() =>
      expect(tree.getByTestId(testIdWithKey('RoomOfferUnavailable'))).toHaveTextContent('Rooms.ComingSoon')
    )
    expect(previewOffer).not.toHaveBeenCalled()
    expect(tree.queryByTestId(testIdWithKey('RoomOfferAccept'))).toBeNull()
  })

  test('an offer that cannot be read says so, and Try again reads it', async () => {
    mockService = sample()
    const previewOffer = jest.spyOn(mockService, 'previewOffer').mockRejectedValueOnce(new Error('offline'))
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferReadFailed'))).toBeTruthy())
    expect(tree.queryByTestId(testIdWithKey('RoomOfferAccept'))).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RoomOfferTryAgain')))
    })
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferTitle'))).toBeTruthy())
    expect(previewOffer).toHaveBeenCalledTimes(2)
  })

  test('rooms flag off: says so, and reads nothing', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsOff'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RoomOfferScreen'))).toBeNull()
  })
})
