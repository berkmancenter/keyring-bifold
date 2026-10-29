/**
 * The "on its way" card (Friday demo, option A): only for a status that says the feature is coming, never for one that
 * says something else is missing; one element to a screen reader, with the feature, what it will do and "Coming soon";
 * in the composer's slot, at least the composer's height.
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { COMPOSER_FIELD } from '../../../components/chat/MessageInput'
import { testIdWithKey } from '../../../utils/testable'
import { isComingSoon, RoomFeatureCard } from '../components/RoomFeatureCard'
import type { OperationStatus, RoomsReason } from '../types'

const at = (status: OperationStatus['status'], reason: RoomsReason): OperationStatus => ({ status, reason, detail: '' })
const card = (status: OperationStatus | undefined, strip?: boolean) =>
  render(
    <BasicAppContext>
      <RoomFeatureCard status={status} feature="files" strip={strip} />
    </BasicAppContext>
  )

describe('isComingSoon', () => {
  test('a feature Keyring has not built, or nothing upstream serves yet', () => {
    expect(isComingSoon(at('comingSoon', 'clientNotBuilt'))).toBe(true)
    expect(isComingSoon(at('comingSoon', 'notBuiltUpstream'))).toBe(true)
  })

  test('not available, available, or not known yet: no', () => {
    for (const reason of ['agentDoesNotServe', 'noRight', 'adminOnly', 'noAgentLinked', 'detailsNotLoaded'] as const)
      expect(isComingSoon(at('unavailable', reason))).toBe(false)
    expect(isComingSoon(at('available', 'ok'))).toBe(false)
    expect(isComingSoon(undefined)).toBe(false)
  })
})

describe('RoomFeatureCard', () => {
  test('coming: the feature, what it will do, and "Coming soon", as one element that is not a button', () => {
    const tree = card(at('comingSoon', 'clientNotBuilt'))
    const el = tree.getByTestId(testIdWithKey('RoomFeatureCard_files'))
    expect(el.props.accessible).toBe(true)
    expect(el.props.accessibilityRole).toBeUndefined()
    expect(el.props.accessibilityLabel).toBe('Rooms.SoonFilesTitle. Rooms.SoonFilesLine. Rooms.ComingSoon')
    for (const words of ['Rooms.SoonFilesTitle', 'Rooms.SoonFilesLine', 'Rooms.ComingSoon'])
      expect(tree.getByText(words)).toBeTruthy()
  })

  test('anything else: nothing, so the screen keeps its own line', () => {
    for (const status of [at('unavailable', 'agentDoesNotServe'), at('unavailable', 'noRight'), at('available', 'ok')])
      expect(card(status).queryByTestId(testIdWithKey('RoomFeatureCard_files'))).toBeNull()
    expect(card(undefined).queryByTestId(testIdWithKey('RoomFeatureCard_files'))).toBeNull()
  })

  test("in the composer's slot: at least the composer's height, so the chat does not jump when posting arrives", () => {
    const el = card(at('comingSoon', 'clientNotBuilt'), true).getByTestId(testIdWithKey('RoomFeatureCard_files'))
    expect(StyleSheet.flatten(el.props.style).minHeight).toBeGreaterThanOrEqual(COMPOSER_FIELD + 14)
  })
})
