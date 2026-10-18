import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { useTheme } from '../../contexts/theme'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'
import { ThemedText } from '../texts/ThemedText'

export interface EmptyListProps {
  message?: string
  /**
   * For an empty state other than the Wallet's (the preview of the new
   * navigation's Communities): its own icon, a line under the message, one
   * button, and testIDs. Without them the list reads as it always has.
   */
  icon?: React.ReactNode
  description?: string
  actionTitle?: string
  onAction?: () => void
  actionTestID?: string
  testID?: string
}

const EmptyList: React.FC<EmptyListProps> = ({
  message,
  icon,
  description,
  actionTitle,
  onAction,
  actionTestID,
  testID,
}) => {
  const { t } = useTranslation()
  const { ListItems, Assets, ColorPalette } = useTheme()

  return (
    // Centred across the width, like the contacts tab: the icon sat against
    // the left edge while the message under it was centred, so the wallet's
    // empty state looked unlike every other tab (report #22).
    <View
      style={{
        paddingTop: 100,
        height: '100%',
        alignItems: 'center',
        backgroundColor: ColorPalette.brand.primaryBackground,
      }}
      {...(testID ? { testID: testIdWithKey(testID) } : {})}
    >
      {icon ?? <Assets.svg.emptyWallet fill={ListItems.emptyList.color} height={100} />}
      <ThemedText style={[ListItems.emptyList, { textAlign: 'center' }]} testID={testIdWithKey('NoneYet')}>
        {message || t('Global.NoneYet!')}
      </ThemedText>
      {description ? <ThemedText style={{ textAlign: 'center', marginTop: 8 }}>{description}</ThemedText> : null}
      {actionTitle && onAction ? (
        <View style={{ marginTop: 24, width: '75%' }}>
          <Button
            title={actionTitle}
            accessibilityLabel={actionTitle}
            buttonType={ButtonType.Primary}
            onPress={onAction}
            {...(actionTestID ? { testID: testIdWithKey(actionTestID) } : {})}
          />
        </View>
      ) : null}
    </View>
  )
}

export default EmptyList
