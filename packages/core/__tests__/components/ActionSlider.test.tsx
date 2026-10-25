import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Modal, StyleSheet, TouchableOpacity } from 'react-native'

import ActionSlider from '../../src/components/chat/ActionSlider'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

/**
 * The sheet sits below a tap-outside layer in a column. Jest has no layout engine, so these tests check the styles
 * that decide where the sheet lands, not its position: a layer of the full height put the sheet just below the
 * screen, laid out but never seen (the RC's "+" sheet, 10-25). Only a device or simulator run shows the position.
 */
describe('ActionSlider', () => {
  const renderSlider = ({ visible = true, onDismiss = jest.fn(), onClosed = jest.fn() } = {}) => {
    const actions = [{ text: 'Photo library', testID: 'ChatAttachLibrary', icon: () => null, onPress: jest.fn() }]
    const tree = render(
      <BasicAppContext>
        <ActionSlider actions={actions} visible={visible} onDismiss={onDismiss} onClosed={onClosed} />
      </BasicAppContext>
    )
    return { tree, actions }
  }

  const outsideListener = (tree: ReturnType<typeof render>) => {
    const layers = tree.UNSAFE_getAllByType(TouchableOpacity).filter((node) => node.props.accessible === false)
    expect(layers).toHaveLength(1)
    return layers[0]
  }

  test('the tap-outside layer takes only the space the sheet leaves', () => {
    const style = StyleSheet.flatten(outsideListener(renderSlider().tree).props.style)

    expect(style.flex).toBe(1)
    expect(style.height).toBeUndefined()
  })

  test('a tap outside the sheet dismisses it', () => {
    const onDismiss = jest.fn()
    const { tree } = renderSlider({ onDismiss })

    fireEvent.press(outsideListener(tree))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test('shows each action under its stable test id', () => {
    const { tree, actions } = renderSlider()

    fireEvent.press(tree.getByTestId(testIdWithKey('ChatAttachLibrary')))

    expect(actions[0].onPress).toHaveBeenCalledTimes(1)
  })

  // Chat opens the photo picker only once the sheet has closed, which on iOS is the modal's onDismiss.
  test('is shown and hidden through the modal, which says when it has closed', () => {
    const onClosed = jest.fn()
    const { tree } = renderSlider({ onClosed })
    const modal = tree.UNSAFE_getByType(Modal)

    expect(modal.props.visible).toBe(true)
    expect(modal.props.onDismiss).toBe(onClosed)
    expect(renderSlider({ visible: false }).tree.queryByTestId(testIdWithKey('ChatAttachLibrary'))).toBeNull()
  })
})
