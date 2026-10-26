import { t } from 'i18next'
import React from 'react'
import { Actions } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { testIdWithKey } from '../../utils/testable'
import { ChatIds } from './Chat.ids'
import { COMPOSER_BUTTON } from './MessageInput'

export const renderActions = (
  props: any,
  theme: any,
  actions?: { text: string; icon: React.FC; onPress: () => void }[]
) => {
  return actions ? (
    <Actions
      {...props}
      // v3 prop names. It took `containerStyle` and `optionTintColor` in v2 and
      // silently ignores both now — v3 reads wrapperStyle and
      // actionSheetOptionTintColor (see Actions.d.ts). Nothing errored; the
      // styling simply never applied.
      // A plain "+" outside the field, in a full tap target (chat redesign C2): it was a boxed 40-point icon inside
      // the field (272).
      wrapperStyle={{
        width: COMPOSER_BUTTON,
        height: COMPOSER_BUTTON,
        marginBottom: 0,
        marginLeft: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      icon={() => (
        <Icon
          name={'plus'}
          size={26}
          color={'#4A4A4A'}
          accessible={true}
          accessibilityLabel={t('Chat.Actions')}
          accessibilityRole="button"
          testID={testIdWithKey(ChatIds.actionsButton)}
        />
      )}
      actionSheetOptionTintColor={theme.optionsText}
    />
  ) : null
}
