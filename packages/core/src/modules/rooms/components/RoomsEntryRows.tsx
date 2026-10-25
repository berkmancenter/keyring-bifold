/**
 * The ways into rooms from My Agent, shown only while the rooms flag is on (no service, no row):
 * - "Your rooms" on the agent home, across every community;
 * - a community card's Rooms row, when that community has rooms or offers for the member.
 * Both read one `useMyRooms` result from their screen, so a card adds no read of its own.
 *
 * @module rooms/components/RoomsEntryRows
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomsService } from '../types'
import type { MyRooms } from '../useMyRooms'

import { roomsStatusText } from './roomsStatusText'
import { SampleDataBanner } from './SampleDataBanner'

/** "2 rooms · 1 offer", leaving out offers when there are none. */
export const roomsCount = (t: TFunction, rooms: number, offers: number): string =>
  [
    t('Rooms.RoomCount', { count: rooms }) as string,
    ...(offers > 0 ? [t('Rooms.OfferCount', { count: offers }) as string] : []),
  ].join(' · ')

const useRowStyles = () => {
  const { ColorPalette } = useTheme()
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
}

export interface YourRoomsRowProps {
  service?: RoomsService
  myRooms: MyRooms
  onOpen: () => void
}

/** "Your rooms" on the agent home. Opens the list when rooms can be listed; otherwise says why, disabled. */
export const YourRoomsRow: React.FC<YourRoomsRowProps> = ({ service, myRooms, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = useRowStyles()
  if (!service) return null
  const status = myRooms.capabilities?.listMyRooms
  const unavailable = status ? roomsStatusText(t, status, 'listMyRooms') : undefined
  const detail = myRooms.failed
    ? (t('Rooms.AgentUnknown') as string)
    : (unavailable ??
      (myRooms.rooms
        ? roomsCount(t, myRooms.rooms.length, myRooms.offers?.length ?? 0)
        : (t('Rooms.Reading') as string)))
  const enabled = !!status && !unavailable
  return (
    <View style={{ gap: 8, paddingHorizontal: 16 }}>
      <SampleDataBanner service={service} />
      <Pressable
        style={[styles.row, { opacity: enabled ? 1 : 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t('Rooms.YourRooms')}, ${detail}`}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={enabled ? onOpen : undefined}
        testID={testIdWithKey('YourRoomsRow')}
      >
        <Icon name="door" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('Rooms.YourRooms')}</ThemedText>
          <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('YourRoomsDetail')}>
            {detail}
          </ThemedText>
        </View>
        {enabled ? <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} /> : null}
      </Pressable>
    </View>
  )
}

export interface CommunityRoomsRowProps {
  service?: RoomsService
  myRooms: MyRooms
  communityDid: string
  /** A short, stable handle for the card's test IDs (the card's own). */
  handle: string
  onOpen: (communityDid: string) => void
}

/** A community card's Rooms row: only when the member has rooms or offers in that community. */
export const CommunityRoomsRow: React.FC<CommunityRoomsRowProps> = ({
  service,
  myRooms,
  communityDid,
  handle,
  onOpen,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = useRowStyles()
  if (!service) return null
  const rooms = (myRooms.rooms ?? []).filter((r) => r.communityDid === communityDid).length
  const offers = (myRooms.offers ?? []).filter((o) => o.communityDid === communityDid).length
  if (rooms === 0 && offers === 0) return null
  const detail = roomsCount(t, rooms, offers)
  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${t('Rooms.Rooms')}, ${detail}`}
      onPress={() => onOpen(communityDid)}
      testID={testIdWithKey(`CommunityRoomsRow_${handle}`)}
    >
      <Icon name="door" size={20} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1 }}>
        <ThemedText>{t('Rooms.Rooms')}</ThemedText>
        <ThemedText variant="caption" style={styles.muted}>
          {detail}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}
