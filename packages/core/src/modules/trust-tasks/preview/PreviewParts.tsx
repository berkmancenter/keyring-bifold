/**
 * Rows the developer preview of the new navigation adds around the agent's
 * page parts: the vetter desk's heading with the waiting-requests badge on
 * Communities, and on You the way to agent settings, AI-agent room access and
 * the app's own settings and backup (today's Menu). Rendered only by
 * VtaAgentHome's `communities` and `you` parts, which only the preview passes.
 *
 * @module trust-tasks/preview/PreviewParts
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import Button, { ButtonType } from '../../../components/buttons/Button'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'

import { useDeskWaitingCount } from './deskWaiting'
import { AiAccessRow, usePreviewStyles } from './RoomsPreview'

/** "Vetting desk", with how many requests wait on it, as the top row of Communities. */
export const DeskWaitingRow: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  const waiting = useDeskWaitingCount(agent)
  return (
    <View
      style={[styles.row, { paddingHorizontal: 4 }]}
      accessible
      accessibilityLabel={
        waiting > 0 ? (t('Preview.DeskWaiting', { count: waiting }) as string) : (t('Preview.Desk') as string)
      }
      testID={testIdWithKey('PreviewDeskRow')}
    >
      <Icon name="clipboard-check-outline" size={22} color={ColorPalette.brand.primary} />
      <ThemedText variant="labelTitle" style={{ flex: 1 }}>
        {t('Preview.Desk')}
      </ThemedText>
      {waiting > 0 ? (
        <View style={styles.badge} testID={testIdWithKey('PreviewDeskBadge')}>
          <ThemedText style={styles.badgeText}>{waiting}</ThemedText>
        </View>
      ) : null}
    </View>
  )
}

const Row: React.FC<{ icon: string; label: string; onPress: () => void; testID: string }> = ({
  icon,
  label,
  onPress,
  testID,
}) => {
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      style={[styles.card, styles.row]}
      onPress={onPress}
      accessibilityRole="button"
      testID={testIdWithKey(testID)}
    >
      <Icon name={icon} size={24} color={ColorPalette.brand.primary} />
      <ThemedText variant="bold" style={{ flex: 1 }}>
        {label}
      </ThemedText>
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}

/**
 * On You, after the agent and its devices: agent settings, AI-agent access,
 * then the app's settings and backup. With no agent linked, only the app's
 * settings: they are reachable in every state.
 */
export const YouSettingsRows: React.FC<{ onAgentSettings: () => void; linked: boolean }> = ({
  onAgentSettings,
  linked,
}) => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  return (
    <View style={{ gap: 12 }} testID={testIdWithKey('PreviewYouSettings')}>
      {linked ? (
        <>
          <Row
            icon="cog-outline"
            label={t('Preview.AgentSettings')}
            onPress={onAgentSettings}
            testID="PreviewAgentSettingsRow"
          />
          <AiAccessRow />
        </>
      ) : null}
      {/* Today's Menu, unchanged: app settings and wallet backup. */}
      <Row
        icon="tune-variant"
        label={t('Preview.AppSettings')}
        onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate(TabStacks.SettingStack)}
        testID="PreviewAppSettingsRow"
      />
    </View>
  )
}

/**
 * Communities with no agent linked: its own empty state. Joining and vetting
 * go through the agent, so the way on is You's link flow, plus "I was
 * invited" for a person who came with an invitation.
 */
export const CommunitiesUnlinked: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void }
  return (
    <View style={{ gap: 16 }} testID={testIdWithKey('PreviewCommunitiesUnlinked')}>
      <ThemedText variant="headingThree" accessibilityRole="header">
        {t('Preview.CommunitiesTitle')}
      </ThemedText>
      <ThemedText>{t('Preview.CommunitiesUnlinkedBody')}</ThemedText>
      <Button
        title={t('Preview.ConnectAgent')}
        buttonType={ButtonType.Primary}
        onPress={() => nav.navigate(TabStacks.YouStack, { screen: Screens.VtaLink, initial: false })}
        testID={testIdWithKey('PreviewCommunitiesConnect')}
      />
      <Pressable
        style={[styles.card, styles.row]}
        onPress={() => nav.navigate(Screens.VtiInvited)}
        accessibilityRole="button"
        testID={testIdWithKey('PreviewCommunitiesInvited')}
      >
        <Icon name="email-open-outline" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
          <ThemedText style={styles.muted}>{t('VtaLink.IWasInvitedHint')}</ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
    </View>
  )
}
