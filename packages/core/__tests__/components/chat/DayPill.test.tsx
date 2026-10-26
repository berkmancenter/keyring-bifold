/**
 * The day pill, in the list and floating while scrolling: one label for a day, the same in both, and nothing
 * floats for a day gifted-chat has not worked out yet.
 */
import { render } from '@testing-library/react-native'
import React from 'react'
import { View } from 'react-native'

import { ChatIds } from '../../../src/components/chat/Chat.ids'
import { DayPill, renderFloatingDay } from '../../../src/components/chat/DayPill'
import { testIdWithKey } from '../../../src/utils/testable'

describe('the day pill', () => {
  const day = new Date(2024, 0, 1, 9, 0)

  test('floating and in the list, a day reads the same', () => {
    const inList = render(<DayPill date={day} />).getByTestId(testIdWithKey(ChatIds.dayPill))
    const floating = render(<>{renderFloatingDay({ createdAt: day.getTime() })}</>).getByTestId(
      testIdWithKey(ChatIds.dayPillFloating)
    )
    expect(floating.props.children).toBe(inList.props.children)
    expect(inList.props.children).toMatch(/2024/)
  })

  test('nothing floats before gifted-chat knows the day (the control above shows one)', () => {
    const tree = render(<View testID="host">{renderFloatingDay({})}</View>)
    expect(tree.getByTestId('host')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey(ChatIds.dayPillFloating))).toBeNull()
  })

  test('a screen reader can move from day to day', () => {
    const pill = render(<DayPill date={day} />).getByTestId(testIdWithKey(ChatIds.dayPill))
    expect(pill.props.accessibilityRole).toBe('header')
  })
})
