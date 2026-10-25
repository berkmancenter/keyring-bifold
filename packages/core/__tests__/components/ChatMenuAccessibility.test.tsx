/**
 * The chat header's menu (InfoIcon): iOS treats an accessible element as one, so anything inside it is out of
 * VoiceOver's reach and the e2e driver's. The RC found the menu read as one merged element while its overlay
 * Pressable wrapped the items. The walk is the one the message actions sheet uses (ChatActions.test.tsx).
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import InfoIcon from '../../src/modules/vrc/components/InfoIcon'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

type Node = { parent: Node | null; props: Record<string, unknown> }
// Above the item itself: a touchable is several nodes (host View, Animated View, the touchable), all carrying its
// testID or its own accessible flag, so the walk starts above the outermost node that still carries the testID.
const insideAnAccessibleElement = (node: Node) => {
  let top = node
  while (top.parent && top.parent.props?.testID === node.props.testID) top = top.parent
  for (let at = top.parent; at; at = at.parent) {
    if (at.props?.accessible === true) return true
  }
  return false
}

const id = (key: string) => testIdWithKey(key)
const openMenu = () => {
  const tree = render(
    <BasicAppContext>
      <InfoIcon connectionId="1" />
    </BasicAppContext>
  )
  fireEvent.press(tree.getByTestId(id('ContactMenu')))
  return tree
}

test('every menu item is its own element: none sits inside an accessible element', () => {
  const tree = openMenu()
  for (const key of ['ContactMenuDisappearing', 'ContactMenuClearChat', 'ContactMenuRemoveContact']) {
    expect(insideAnAccessibleElement(tree.getByTestId(id(key)) as never)).toBe(false)
  }
})

test('the menu still closes when the overlay behind it is tapped', () => {
  const tree = openMenu()
  fireEvent.press(tree.getByTestId(id('ContactMenuOverlay')))
  expect(tree.queryByTestId(id('ContactMenuDisappearing'))).toBeNull()
})

test('the overlay says what tapping it does', () => {
  const tree = openMenu()
  expect(tree.getByTestId(id('ContactMenuOverlay')).props.accessibilityLabel).toBe('Global.Close')
})
