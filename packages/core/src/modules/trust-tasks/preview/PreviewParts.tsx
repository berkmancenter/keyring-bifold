/**
 * The pieces of the developer preview of the new navigation, shaped to the
 * navigation mockups' option C (C2 Communities, C3 You) and the recommended
 * frames R1–R3:
 * - Communities: the vetting desk as one row with its badge, one compact row
 *   per community, a next step when there is one, Your rooms, and Join a
 *   community; with no membership, a plain empty state.
 * - You: Requests, one compact "Your agent" card that opens the agent's page,
 *   and Settings as a short list of groups.
 * Rendered only by VtaAgentHome's preview parts, which only the preview passes.
 *
 * @module trust-tasks/preview/PreviewParts
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { TOKENS, useServices } from '../../../container-api'
import { useTheme } from '../../../contexts/theme'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'

import type { EmptyListProps } from '../../../components/misc/EmptyList'
import { communityTarget } from '../module/vtiCommunityLink'

import { useDeskWaitingCount } from './deskWaiting'
import { joinAfterLink } from './joinAfterLink'
import { AiAccessRow, usePreviewStyles } from './RoomsPreview'

type Nav = { navigate: (name: string, params?: object) => void }

/** One row of a grouped list: an icon, a title, a quieter line, and what sits at its end. */
export const ListRow: React.FC<{
  icon?: string
  title: string
  subtitle?: string
  end?: React.ReactNode
  onPress?: () => void
  testID: string
}> = ({ icon, title, subtitle, end, onPress, testID }) => {
  const styles = usePreviewStyles()
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={testIdWithKey(testID)}
    >
      {icon ? <Icon name={icon} size={22} color={ColorPalette.brand.primary} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bold">{title}</ThemedText>
        {subtitle ? (
          <ThemedText variant="caption" style={styles.muted}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {end}
      {onPress ? <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} /> : null}
    </Pressable>
  )
}

/** A titled group of rows, as the mockups draw Requests, Your agent and Settings. */
export const Group: React.FC<{ title?: string; testID?: string; children: React.ReactNode }> = ({
  title,
  testID,
  children,
}) => {
  const styles = usePreviewStyles()
  return (
    <View style={{ gap: 6 }} testID={testID ? testIdWithKey(testID) : undefined}>
      {title ? (
        <ThemedText variant="labelTitle" style={styles.muted} accessibilityRole="header">
          {title}
        </ThemedText>
      ) : null}
      <View style={[styles.card, { gap: 0, paddingVertical: 4 }]}>{children}</View>
    </View>
  )
}

const Badge: React.FC<{ count: number; testID: string }> = ({ count, testID }) => {
  const styles = usePreviewStyles()
  return (
    <View style={styles.badge} testID={testIdWithKey(testID)}>
      <ThemedText style={styles.badgeText}>{count}</ThemedText>
    </View>
  )
}

/**
 * "Vetting desk", one row at the top of Communities, with how many requests
 * wait on it. With one community it opens that desk; with several it lists them.
 */
export const DeskRow: React.FC<{
  vetterFor: string[]
  nameOf: (communityDid: string) => string
  onOpen: (communityDid: string) => void
}> = ({ vetterFor, nameOf, onOpen }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const waiting = useDeskWaitingCount(agent)
  const [open, setOpen] = useState(false)
  const names = vetterFor.map(nameOf)
  const youVet =
    names.length > 1
      ? t('Preview.YouVetForMany', {
          first: names.slice(0, -1).join(', '),
          last: names[names.length - 1],
          interpolation: { escapeValue: false },
        })
      : t('Preview.YouVetFor', { community: names[0], interpolation: { escapeValue: false } })
  return (
    <Group testID="PreviewDeskRow">
      <ListRow
        icon="clipboard-check-outline"
        title={t('Preview.Desk')}
        subtitle={`${waiting > 0 ? t('Preview.DeskRequests', { count: waiting }) : t('Preview.DeskNone')} · ${youVet}`}
        end={waiting > 0 ? <Badge count={waiting} testID="PreviewDeskBadge" /> : null}
        onPress={() => (vetterFor.length === 1 ? onOpen(vetterFor[0]) : setOpen(!open))}
        testID="PreviewDeskOpen"
      />
      {open
        ? vetterFor.map((did, i) => (
            <ListRow key={did} title={names[i]} onPress={() => onOpen(did)} testID={`PreviewDeskOpen_${i}`} />
          ))
        : null}
    </Group>
  )
}

export interface CommunityRowItem {
  communityDid: string
  name: string
  vetter: boolean
}

/** One compact row per community the person belongs to, each opening the community. */
export const CommunityRows: React.FC<{ items: CommunityRowItem[]; onOpen: (communityDid: string) => void }> = ({
  items,
  onOpen,
}) => {
  const { t } = useTranslation()
  return (
    <Group testID="PreviewCommunityRows">
      {items.map((item, i) => (
        <ListRow
          key={item.communityDid}
          icon="account-group-outline"
          title={item.name}
          subtitle={t(item.vetter ? 'Preview.RoleVetter' : 'Preview.RoleMember')}
          onPress={() => onOpen(item.communityDid)}
          testID={`PreviewCommunityRow_${i}`}
        />
      ))}
    </Group>
  )
}

/**
 * Communities with no membership, linked or not: the Wallet's own empty
 * state, from the container, with the Communities icon and one button, Join
 * a community (Alberto, 10-18). With no agent linked, the button links one
 * first, then goes on to Join.
 */
export const CommunitiesEmpty: React.FC<{ linked: boolean }> = ({ linked }) => {
  const { t } = useTranslation()
  const navigation = useNavigation() as unknown as Nav
  const [EmptyState] = useServices([TOKENS.COMPONENT_CRED_EMPTY_LIST])
  const Empty = EmptyState as React.FC<EmptyListProps>
  return (
    <Empty
      icon={<Icon name="account-group" size={80} color="#000000" />}
      message={t('Preview.CommunitiesEmptyTitle')}
      description={t('Preview.CommunitiesEmpty')}
      actionTitle={t('Preview.JoinCommunity')}
      onAction={() => {
        if (linked) {
          // From the beginning: which community, not the last one a link opened.
          communityTarget.clearViewing()
          navigation.navigate(Screens.VtiJoin)
        } else {
          joinAfterLink.ask()
          navigation.navigate(Screens.VtaLink)
        }
      }}
      actionTestID="PreviewCommunitiesJoin"
      testID="PreviewCommunitiesEmpty"
    />
  )
}

/** On You: one compact card for the agent, opening its page (switcher, devices, settings). */
export const YourAgentCard: React.FC<{ name: string; status: React.ReactNode }> = ({ name, status }) => {
  const { t } = useTranslation()
  const navigation = useNavigation() as unknown as Nav
  return (
    <Group title={t('Preview.YourAgent')} testID="PreviewYourAgentCard">
      <ListRow
        icon="shield-account-outline"
        title={name}
        subtitle={t('Preview.YourAgentLine')}
        onPress={() => navigation.navigate(Screens.PreviewYourAgent)}
        testID="PreviewYourAgentOpen"
      />
      <View style={{ paddingHorizontal: 34, paddingBottom: 8 }}>{status}</View>
    </Group>
  )
}

/** On the agent's own page, after its devices: AI-agent room access and agent settings. */
export const AgentPageRows: React.FC<{ onAgentSettings: () => void }> = ({ onAgentSettings }) => {
  const { t } = useTranslation()
  return (
    <View style={{ gap: 12 }}>
      <AiAccessRow />
      <Group>
        <ListRow
          icon="cog-outline"
          title={t('Preview.AgentSettings')}
          subtitle={t('Preview.AgentSettingsLine')}
          onPress={onAgentSettings}
          testID="PreviewAgentSettingsRow"
        />
      </Group>
    </View>
  )
}

export type SettingsGroupKey = 'security' | 'exchanges' | 'general'

/**
 * Settings on You, as groups: each opens a short list of today's setting
 * screens. "All settings" is today's Menu, where log-out, Developer settings
 * (and the preview's own switch) and the rest stay. Reachable in every state,
 * linked or not.
 */
export const YouSettingsSection: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation() as unknown as Nav
  const [{ enablePushNotifications }] = useServices([TOKENS.CONFIG])
  const group = (key: SettingsGroupKey) => () => navigation.navigate(Screens.PreviewSettingsGroup, { group: key })
  return (
    <Group title={t('Preview.Settings')} testID="PreviewYouSettings">
      <ListRow
        icon="lock-outline"
        title={t('Preview.SettingsSecurity')}
        subtitle={t('Preview.SettingsSecurityLine')}
        onPress={group('security')}
        testID="PreviewSettingsSecurity"
      />
      <ListRow
        icon="swap-horizontal"
        title={t('Preview.SettingsExchanges')}
        subtitle={t('Preview.SettingsExchangesLine')}
        onPress={group('exchanges')}
        testID="PreviewSettingsExchanges"
      />
      {enablePushNotifications ? (
        <ListRow
          icon="bell-outline"
          title={t('Settings.Notifications')}
          onPress={() => navigation.navigate(Screens.TogglePushNotifications)}
          testID="PreviewSettingsNotifications"
        />
      ) : null}
      <ListRow
        icon="translate"
        title={t('Preview.SettingsGeneral')}
        subtitle={t('Preview.SettingsGeneralLine')}
        onPress={group('general')}
        testID="PreviewSettingsGeneral"
      />
      {/* Today's Menu, unchanged: log out, Developer settings and the rest. */}
      <ListRow
        icon="tune-variant"
        title={t('Preview.SettingsAll')}
        subtitle={t('Preview.SettingsAllLine')}
        onPress={() => navigation.navigate(TabStacks.SettingStack)}
        testID="PreviewAppSettingsRow"
      />
    </Group>
  )
}

/** A next step, as one row: an invitation to accept or a vetting to continue. */
export const NextStepRow: React.FC<{ text: string; onPress: () => void; testID: string }> = ({
  text,
  onPress,
  testID,
}) => {
  const { t } = useTranslation()
  return (
    <Group>
      <ListRow
        icon="arrow-right-circle-outline"
        title={t('VtaLink.NextStep')}
        subtitle={text}
        onPress={onPress}
        testID={testID}
      />
    </Group>
  )
}

/** "Join a community", the last row of Communities. */
export const JoinCommunityRow: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation()
  return (
    <Group>
      <ListRow
        icon="plus-circle-outline"
        title={t('Preview.JoinCommunity')}
        onPress={onPress}
        testID="PreviewJoinCommunity"
      />
    </Group>
  )
}
