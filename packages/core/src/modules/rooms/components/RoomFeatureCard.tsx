/**
 * A rooms feature that is on its way: the feature's icon, its name, one line on what it will do, and a "Coming soon"
 * badge shaped as the tier badge is. It shows only for a status that says the feature is coming (Keyring has not built
 * it, or nothing upstream serves it yet); for any other status it shows nothing, and the screen keeps its plain line
 * ("Your agent needs an update", "You can't post here"), since nothing is on its way there. When a feature ships,
 * its status turns available and the card stops showing: nothing to remove.
 *
 * One element to a screen reader ("Room files. Share documents…. Coming soon"), never a button. `strip` is the
 * composer's slot: at least the composer's own height, so the chat does not jump when posting arrives, and no bottom
 * padding of its own, since the room's keyboard view handles the inset.
 *
 * @module rooms/components/RoomFeatureCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { COMPOSER_FIELD } from '../../../components/chat/MessageInput'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { OperationStatus } from '../types'

/** The features a card can stand for, each with its icon and its words. */
const FEATURES = {
  write: { icon: 'message-text-clock-outline', title: 'Rooms.SoonWriteTitle', line: 'Rooms.SoonWriteLine' },
  files: { icon: 'folder-clock-outline', title: 'Rooms.SoonFilesTitle', line: 'Rooms.SoonFilesLine' },
  notes: { icon: 'note-text-outline', title: 'Rooms.SoonNotesTitle', line: 'Rooms.SoonNotesLine' },
  curate: { icon: 'pin-outline', title: 'Rooms.SoonCurateTitle', line: 'Rooms.SoonCurateLine' },
  agent: { icon: 'robot-outline', title: 'Rooms.SoonAgentTitle', line: 'Rooms.SoonAgentLine' },
  chat: { icon: 'forum-outline', title: 'Rooms.SoonChatTitle', line: 'Rooms.SoonChatLine' },
  members: { icon: 'account-group-outline', title: 'Rooms.SoonMembersTitle', line: 'Rooms.SoonMembersLine' },
} as const

export type RoomFeature = keyof typeof FEATURES

/** Whether a status says the feature is on its way: the one case a card stands in for. */
export const isComingSoon = (status: OperationStatus | undefined): boolean => status?.status === 'comingSoon'

export interface RoomFeatureCardProps {
  status: OperationStatus | undefined
  feature: RoomFeature
  /** The composer's slot rather than a tab's. */
  strip?: boolean
}

export const RoomFeatureCard: React.FC<RoomFeatureCardProps> = ({ status, feature, strip = false }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!isComingSoon(status)) return null
  const words = FEATURES[feature]
  const title = t(words.title) as string
  const line = t(words.line) as string
  const soon = t('Rooms.ComingSoon') as string
  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      gap: 12,
      padding: 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderColor: ColorPalette.grayscale.lightGrey,
      ...(strip
        ? // The composer bar's height: its field plus 6 above and 8 below.
          { borderTopWidth: 1, minHeight: COMPOSER_FIELD + 14, alignItems: 'center' as const }
        : // The lists it sits in already have their side padding.
          { alignItems: 'flex-start' as const, marginVertical: 12, borderWidth: 1, borderRadius: 10 }),
    },
    disc: {
      width: strip ? 32 : 36,
      height: strip ? 32 : 36,
      borderRadius: strip ? 16 : 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    words: { flex: 1, gap: 6 },
    line: { color: ColorPalette.grayscale.mediumGrey },
    // The tier badge's shape, so the room's header and the card speak the same badge.
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
  })
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${title}. ${line}. ${soon}`}
      testID={testIdWithKey(`RoomFeatureCard_${feature}`)}
    >
      <View style={styles.disc}>
        <Icon name={words.icon} size={strip ? 18 : 20} color={ColorPalette.brand.primary} />
      </View>
      <View style={styles.words}>
        <ThemedText variant="bold" maxFontSizeMultiplier={1.5}>
          {title}
        </ThemedText>
        <ThemedText variant="caption" style={styles.line} maxFontSizeMultiplier={1.5}>
          {line}
        </ThemedText>
        <View style={styles.badge}>
          <ThemedText variant="caption" maxFontSizeMultiplier={1.5}>
            {soon}
          </ThemedText>
        </View>
      </View>
    </View>
  )
}

export default RoomFeatureCard
