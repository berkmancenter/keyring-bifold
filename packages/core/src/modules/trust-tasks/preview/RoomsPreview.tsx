/**
 * The rooms pieces of the developer preview of the new navigation: "Your
 * rooms" on Communities, the Rooms section with an offer on a community's
 * screen, and the way to AI-agent room access on You. Sample data only,
 * marked "Preview, not connected"; no button sends anything. Rendered only
 * while Preview: new navigation is on (Developer settings).
 *
 * @module trust-tasks/preview/RoomsPreview
 */
import { useNavigation } from '@react-navigation/native'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'

import { SAMPLE_OFFER, SAMPLE_ROOMS, sampleDate, type RoomTier, type SampleRoom } from './roomsSample'

export const usePreviewStyles = () => {
  const { ColorPalette } = useTheme()
  return StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
    },
    tier: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    badge: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.semantic.error,
    },
    badgeText: { color: ColorPalette.grayscale.white, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  })
}

/** The mark on every preview surface: sample data, nothing reaches a community or the agent. */
export const PreviewNotConnected: React.FC<{ testID?: string }> = ({ testID = 'PreviewNotConnected' }) => {
  const { t } = useTranslation()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  return (
    <View style={styles.tag} testID={testIdWithKey(testID)} accessible accessibilityLabel={t('Preview.NotConnected')}>
      <Icon name="flask-outline" size={14} color={ColorPalette.grayscale.mediumGrey} />
      <ThemedText variant="caption" style={styles.muted}>
        {t('Preview.NotConnected')}
      </ThemedText>
    </View>
  )
}

export const tierKey = (tier: RoomTier) =>
  tier === 'open' ? 'Preview.TierOpen' : tier === 'sealed' ? 'Preview.TierSealed' : 'Preview.TierAttributed'

export const TierBadge: React.FC<{ tier: RoomTier }> = ({ tier }) => {
  const { t } = useTranslation()
  const styles = usePreviewStyles()
  return (
    <View style={styles.tier}>
      <ThemedText variant="caption">{t(tierKey(tier))}</ThemedText>
    </View>
  )
}

const navigateTo = (navigation: unknown, screen: Screens, params?: object) =>
  (navigation as { navigate: (name: string, params?: object) => void }).navigate(screen, params)

const RoomRow: React.FC<{ room: SampleRoom; withCommunity: boolean }> = ({ room, withCommunity }) => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  const access = t(room.write ? 'Preview.AccessReadWrite' : 'Preview.AccessRead')
  return (
    <Pressable
      style={styles.row}
      onPress={() => navigateTo(navigation, Screens.PreviewRoom, { roomId: room.id })}
      accessibilityRole="button"
      testID={testIdWithKey(`PreviewRoomRow_${room.id}`)}
    >
      <Icon name="door-open" size={22} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ThemedText variant="bold">{room.name}</ThemedText>
          <TierBadge tier={room.tier} />
        </View>
        <ThemedText variant="caption" style={styles.muted}>
          {withCommunity
            ? t('Preview.RoomLine', {
                community: room.community,
                access,
                until: sampleDate(room.until),
                interpolation: { escapeValue: false },
              })
            : t('Preview.RoomLineHere', {
                access,
                until: sampleDate(room.until),
                interpolation: { escapeValue: false },
              })}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}

/** "Your rooms" on Communities: a shortcut to the rooms the person has, each named with its community. */
export const YourRoomsSection: React.FC = () => {
  const { t } = useTranslation()
  const styles = usePreviewStyles()
  return (
    <View style={styles.card} testID={testIdWithKey('PreviewYourRooms')}>
      <ThemedText variant="labelTitle" accessibilityRole="header">
        {t('Preview.YourRooms')}
      </ThemedText>
      <PreviewNotConnected />
      {SAMPLE_ROOMS.map((room) => (
        <RoomRow key={room.id} room={room} withCommunity />
      ))}
    </View>
  )
}

/** The offer, at the top of a community's Rooms section until it is answered. Accept and Decline send nothing. */
export const RoomOfferCard: React.FC = () => {
  const { t } = useTranslation()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  const [answered, setAnswered] = useState(false)
  const o = SAMPLE_OFFER
  const until = sampleDate(o.until)
  const access = t(o.write ? 'Preview.AccessReadWrite' : 'Preview.AccessRead')
  // As R2 draws it: the offer, who joins, and Decline / Accept, with no step before.
  return (
    <View
      style={[styles.card, { borderLeftWidth: 4, borderLeftColor: ColorPalette.brand.primary }]}
      testID={testIdWithKey('PreviewRoomOffer')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ThemedText variant="bold">{o.room}</ThemedText>
        <TierBadge tier={o.tier} />
        <ThemedText variant="caption" style={styles.muted}>
          {t('Preview.OfferBadge')}
        </ThemedText>
      </View>
      <ThemedText testID={testIdWithKey('PreviewRoomOfferDetails')}>
        {t('Preview.OfferLine', { community: o.community, access, until, interpolation: { escapeValue: false } })}
      </ThemedText>
      <ThemedText style={styles.muted}>
        {t('Preview.JoiningAsLine', { persona: o.persona, interpolation: { escapeValue: false } })}
      </ThemedText>
      <ThemedText variant="caption" style={styles.muted}>
        {t('Preview.OfferEnds', { until, community: o.community, interpolation: { escapeValue: false } })}
      </ThemedText>
      {answered ? (
        <ThemedText variant="bold" testID={testIdWithKey('PreviewNothingSent')}>
          {t('Preview.NothingSent')}
        </ThemedText>
      ) : (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button
              title={t('Preview.Decline')}
              buttonType={ButtonType.Secondary}
              onPress={() => setAnswered(true)}
              testID={testIdWithKey('PreviewRoomOfferDecline')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('Preview.Accept')}
              buttonType={ButtonType.Primary}
              onPress={() => setAnswered(true)}
              testID={testIdWithKey('PreviewRoomOfferAccept')}
            />
          </View>
        </View>
      )}
    </View>
  )
}

/** A community's Rooms section, beside membership and vetting: the offer first, then the rooms held there. */
export const CommunityRoomsSection: React.FC = () => {
  const { t } = useTranslation()
  const styles = usePreviewStyles()
  return (
    <View style={styles.card} testID={testIdWithKey('PreviewCommunityRooms')}>
      <ThemedText variant="labelTitle" accessibilityRole="header">
        {t('Preview.Rooms')}
      </ThemedText>
      <PreviewNotConnected />
      <RoomOfferCard />
      {SAMPLE_ROOMS.map((room) => (
        <RoomRow key={room.id} room={room} withCommunity={false} />
      ))}
    </View>
  )
}

/** The way into AI-agent room access, on You beside the agent's devices. */
export const AiAccessRow: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      style={[styles.card, styles.row]}
      onPress={() => navigateTo(navigation, Screens.PreviewAiAccess)}
      accessibilityRole="button"
      testID={testIdWithKey('PreviewAiAccessRow')}
    >
      <Icon name="robot-outline" size={24} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bold">{t('Preview.AiAccess')}</ThemedText>
        <ThemedText variant="caption" style={styles.muted}>
          {`${t('Preview.AiAgentName')} · ${t('Preview.AiAgentLine', {
            room: SAMPLE_ROOMS[0].name,
            left: '3 h 40 min',
            interpolation: { escapeValue: false },
          })}`}
        </ThemedText>
        <PreviewNotConnected testID="PreviewAiAccessRowNotConnected" />
      </View>
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}
