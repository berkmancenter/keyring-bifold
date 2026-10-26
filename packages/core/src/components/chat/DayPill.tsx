/**
 * A chat's day marker: one small centered pill per day ("Today", "Yesterday", "Wed 15 Oct"). The same pill
 * marks the day in the list and floats at the top while the list scrolls (gifted-chat's renderDay), so a
 * day is never said twice in two different ways.
 *
 * @module components/chat/DayPill
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { dayLabel } from '../../modules/chat/dayLabel'
import { testIdWithKey } from '../../utils/testable'

import { ChatIds } from './Chat.ids'

const styles = StyleSheet.create({
  row: { alignItems: 'center', marginVertical: 10 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: '#E6E0E6' },
  // #4A4A4A on #E6E0E6 is 7:1.
  text: { color: '#4A4A4A', fontSize: 13, lineHeight: 18, fontWeight: '600' },
})

export interface DayPillProps {
  date: Date
  /** The copy that floats while scrolling: drawn over messages, so it carries a light shadow. */
  floating?: boolean
}

export const DayPill: React.FC<DayPillProps> = ({ date, floating = false }) => {
  const { t, i18n } = useTranslation()
  const label = dayLabel(date, t, i18n.language)
  return (
    <View style={styles.row} pointerEvents="none">
      <View
        style={[
          styles.pill,
          floating
            ? {
                shadowColor: '#010B13',
                shadowOpacity: 0.12,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              }
            : null,
        ]}
      >
        <Text
          style={styles.text}
          // The theme's cap for text (keyring-theme maxFontSizeMultiplier).
          maxFontSizeMultiplier={2}
          accessibilityRole="header"
          testID={testIdWithKey(floating ? ChatIds.dayPillFloating : ChatIds.dayPill)}
        >
          {label}
        </Text>
      </View>
    </View>
  )
}

/**
 * gifted-chat's renderDay: the floating copy of the pill, for the day at the top of what is on screen.
 * gifted-chat's DayProps is not exported from the package root; only createdAt is read.
 */
export const renderFloatingDay = (props: { createdAt?: Date | number }): React.ReactNode =>
  props.createdAt ? <DayPill date={new Date(props.createdAt)} floating /> : null

export default DayPill
