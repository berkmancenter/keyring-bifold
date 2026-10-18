/**
 * Contacts with a Conversations segment, for the Contacts tab of the
 * developer preview of the new navigation (option C1): Conversations
 * (today's Messages screen) first and open, then All contacts (today's
 * contact list). Passed to ContactStack only by the preview.
 *
 * @module trust-tasks/preview/ContactsWithConversations
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { useUnreadMessages } from '../../../hooks/useUnreadMessages'
import Messages from '../../../screens/Messages'
import { testIdWithKey } from '../../../utils/testable'
import ListContacts from '../../vrc/screens/ListContacts'

type Segment = 'contacts' | 'conversations'

const ContactsWithConversations: React.FC<{ navigation: unknown }> = ({ navigation }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { totalUnread } = useUnreadMessages()
  const [segment, setSegment] = useState<Segment>('conversations')
  const styles = StyleSheet.create({
    bar: {
      flexDirection: 'row',
      margin: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: ColorPalette.brand.primary,
      overflow: 'hidden',
    },
    tab: { flex: 1, paddingVertical: 8, alignItems: 'center' },
    on: { backgroundColor: ColorPalette.brand.primary },
    onText: { color: ColorPalette.grayscale.white },
  })
  const tab = (key: Segment, label: string) => (
    <Pressable
      style={[styles.tab, segment === key ? styles.on : undefined]}
      onPress={() => setSegment(key)}
      accessibilityRole="tab"
      accessibilityState={{ selected: segment === key }}
      testID={testIdWithKey(key === 'contacts' ? 'PreviewSegmentContacts' : 'PreviewSegmentConversations')}
    >
      <ThemedText variant="bold" style={segment === key ? styles.onText : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  )
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar} accessibilityRole="tablist">
        {tab(
          'conversations',
          totalUnread > 0 ? `${t('Preview.SegmentConversations')} (${totalUnread})` : t('Preview.SegmentConversations')
        )}
        {tab('contacts', t('Preview.SegmentContacts'))}
      </View>
      <View style={{ flex: 1 }}>
        {segment === 'contacts' ? (
          <ListContacts />
        ) : (
          <Messages navigation={navigation as React.ComponentProps<typeof Messages>['navigation']} />
        )}
      </View>
    </View>
  )
}

export default ContactsWithConversations
