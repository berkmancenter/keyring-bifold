/**
 * The record as chat/plainNotSent.ts marks it, through the real timeline, to the bubble. The key is written out here on
 * purpose: changing it would orphan the marks already stored on people's phones.
 */
import { useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import {
  DidCommBasicMessageRecord,
  DidCommBasicMessageRole,
  DidCommConnectionRecord,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import * as network from '../../src/contexts/network'
import Chat from '../../src/screens/Chat'
import navigationContext from '../contexts/navigation'
import { BasicAppContext } from '../helpers/app'

jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: jest.fn(() => 100) }))

const connection = new DidCommConnectionRecord({
  id: '1',
  createdAt: new Date(2024, 1, 1),
  state: DidCommDidExchangeState.Completed,
  role: DidCommDidExchangeRole.Requester,
  theirDid: 'did:example:123',
  theirLabel: 'Alice',
})

const mine = (content: string, notSent: boolean, role = DidCommBasicMessageRole.Sender) => {
  const record = new DidCommBasicMessageRecord({
    threadId: content,
    connectionId: '1',
    role,
    content,
    sentTime: new Date(2026, 9, 25).toISOString(),
  })
  if (notSent) record.metadata.set('keyringNotSent', true)
  return record
}

const renderWith = (records: DidCommBasicMessageRecord[]) => {
  ;(useBasicMessagesByConnectionId as jest.Mock).mockReturnValue(records)
  const tree = render(
    <BasicAppContext>
      <Chat navigation={navigationContext} route={{ params: { connectionId: '1' } } as any} />
    </BasicAppContext>
  )
  fireEvent(tree.getByTestId('GC_WRAPPER'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
  })
  return tree
}

beforeEach(() => {
  ;(useConnectionById as jest.Mock).mockReturnValue(connection)
  jest.spyOn(network, 'useNetwork').mockImplementation(() => ({
    silentAssertConnectedNetwork: () => true,
    assertNetworkConnected: () => true,
    assertInternetReachable: jest.fn(),
    assertMediatorReachable: jest.fn(),
    displayNetInfoModal: jest.fn(),
    hideNetInfoModal: jest.fn(),
  }))
})

test('a marked record’s bubble says it was not sent', async () => {
  const tree = renderWith([mine('never went', true)])
  await waitFor(() => expect(tree.getByText('never went')).toBeTruthy())
  expect(tree.getByText('Chat.NotSent')).toBeTruthy()
})

// Control: the same record unmarked, as every message stored before this mark.
test('an unmarked one reads as it always did', async () => {
  const tree = renderWith([mine('went fine', false)])
  await waitFor(() => expect(tree.getByText('went fine')).toBeTruthy())
  expect(tree.queryByText('Chat.NotSent')).toBeNull()
})
