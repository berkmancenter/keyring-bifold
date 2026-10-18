/**
 * The tabs of the developer preview of the new navigation (Developer
 * settings, "Preview: new navigation", off by default): Wallet · Contacts ·
 * QR · Communities · You. Today's screens, moved: Contacts carries
 * Conversations (today's Messages) as a segment, Communities and You are the
 * two parts of the agent's page, and You ends with the app's settings and
 * backup. Today's Messages, My Agent and Menu stacks stay registered as hidden
 * tabs, so links and notifications that open them still land. TabStack renders
 * this instead of its own tabs only while the preference is on.
 *
 * @module navigators/PreviewTabNavigator
 */
import { useAgent } from '@bifold/react-hooks'
import type { BottomTabNavigationOptions, createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../contexts/theme'
import { useDeskWaitingCount } from '../modules/trust-tasks/preview/deskWaiting'
import { TabStackParams, TabStacks } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

import ContactStack from './ContactStack'
import CredentialStack from './CredentialStack'
import MessageStack from './MessageStack'
import MyAgentStack from './MyAgentStack'
import SettingStack from './SettingStack'

type Tab = ReturnType<typeof createBottomTabNavigator<TabStackParams>>

/** The tabs that show a button: Wallet, Contacts, QR, Communities, You. */
export const PREVIEW_VISIBLE_TABS = 5
/**
 * The smallest a tab's label shrinks to, relative to its Dynamic Type size.
 * Labels show only below 18 pt scaled (TabStack's showLabels), and at that
 * size "Communautés" needs 0.64 of it on a 375-pt phone (about 11.5 pt).
 */
export const TAB_LABEL_MIN_SCALE = 0.6

const hidden: BottomTabNavigationOptions = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }

export interface PreviewTabNavigatorProps {
  Tab: Tab
  showLabels: boolean
  styles: { tabBarIcon: StyleProp<ViewStyle>; tabBarBadge: StyleProp<TextStyle> }
  totalUnread: number
  /** Requests waiting for this person's decision: the badge on You, as on My Agent today. */
  waitingRequests: number
  onQrPress: () => void
}

const CommunitiesStack: React.FC = () => <MyAgentStack part="communities" preview />
const YouStack: React.FC = () => <MyAgentStack part="you" preview />
const HiddenMyAgentStack: React.FC = () => <MyAgentStack preview />
const ContactsAndConversations: React.FC = () => <ContactStack conversations />

export const PreviewTabNavigator: React.FC<PreviewTabNavigatorProps> = ({
  Tab,
  showLabels,
  styles,
  totalUnread,
  waitingRequests,
  onQrPress,
}) => {
  const { t } = useTranslation()
  const { TabTheme, Assets } = useTheme()
  // Vetting requests waiting on this phone's desks badge Communities (R1).
  // Room offers would add to it; they are sample data here, so they do not.
  const { agent } = useAgent()
  const deskWaiting = useDeskWaitingCount(agent)
  // Each label is one line in its tab's own width. "Communities" is wider than
  // a fifth of a 375-pt phone even in regular weight (78.5 pt at 14 pt), and
  // bold wrapped it on an iPhone 16; so one weight for both states, the active
  // tab told by its colour, and the label shrinks to fit rather than wrap.
  const { width } = useWindowDimensions()
  const labelWidth = Math.floor(width / PREVIEW_VISIBLE_TABS) - 4
  const tabIcon =
    (label: string, icon: (color: string, focused: boolean) => React.ReactNode) =>
    // eslint-disable-next-line react/display-name
    ({ color, focused }: { color: string; focused: boolean }) => (
      <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
        {icon(color, focused)}
        {showLabels && (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={TAB_LABEL_MIN_SCALE}
            style={{
              ...TabTheme.tabBarTextStyle,
              color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
              width: labelWidth,
              textAlign: 'center',
            }}
          >
            {label}
          </Text>
        )}
      </View>
    )
  return (
    <Tab.Navigator
      initialRouteName={TabStacks.ContactStack}
      screenOptions={{
        // As today's tabs. Communities relies on it: leaving the tab must unmount
        // it, or a link made from You would open Join there (joinAfterLink).
        unmountOnBlur: true,
        tabBarStyle: { ...TabTheme.tabBarStyle },
        tabBarActiveTintColor: TabTheme.tabBarActiveTintColor,
        tabBarInactiveTintColor: TabTheme.tabBarInactiveTintColor,
        header: () => null,
        tabBarShowLabel: false,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarBadgeStyle: styles.tabBarBadge,
      }}
    >
      <Tab.Screen
        name={TabStacks.CredentialStack}
        component={CredentialStack}
        options={{
          tabBarIcon: tabIcon(t('TabStack.Wallet'), (color, focused) =>
            focused ? (
              <Assets.svg.tabThreeFocusedIcon height={20} width={20} fill={color} />
            ) : (
              <Assets.svg.tabThreeIcon height={20} width={20} fill={color} />
            )
          ),
          tabBarAccessibilityLabel: t('TabStack.Wallet'),
          tabBarTestID: testIdWithKey('PreviewTabWallet'),
        }}
      />
      <Tab.Screen
        name={TabStacks.ContactStack}
        component={ContactsAndConversations}
        options={{
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarIcon: tabIcon(t('TabStack.Contacts'), (color, focused) =>
            focused ? (
              <Assets.svg.contactsIconFocused height={20} width={20} fill={color} />
            ) : (
              <Assets.svg.contactsIconOutline height={20} width={20} fill={color} />
            )
          ),
          tabBarAccessibilityLabel: t('TabStack.Contacts'),
          tabBarTestID: testIdWithKey('PreviewTabContacts'),
        }}
      />
      <Tab.Screen
        name={TabStacks.ConnectStack}
        options={{
          tabBarIcon: tabIcon(t('TabStack.QRCode'), (color) => (
            <Assets.svg.tabTwoIcon height={20} width={20} fill={color} />
          )),
          tabBarAccessibilityLabel: t('TabStack.QRCode'),
          tabBarTestID: testIdWithKey('PreviewTabQR'),
        }}
        listeners={() => ({
          tabPress: (e) => {
            e.preventDefault()
            onQrPress()
          },
        })}
      >
        {() => <View />}
      </Tab.Screen>
      <Tab.Screen
        name={TabStacks.CommunitiesStack}
        component={CommunitiesStack}
        options={{
          tabBarBadge: deskWaiting > 0 ? deskWaiting : undefined,
          tabBarIcon: tabIcon(t('TabStack.Communities'), (color, focused) => (
            <Icon name={focused ? 'account-group' : 'account-group-outline'} size={24} color={color} />
          )),
          tabBarAccessibilityLabel:
            deskWaiting > 0
              ? `${t('TabStack.Communities')}, ${t('Preview.DeskRequests', { count: deskWaiting })}`
              : t('TabStack.Communities'),
          tabBarTestID: testIdWithKey('PreviewTabCommunities'),
        }}
      />
      <Tab.Screen
        name={TabStacks.YouStack}
        component={YouStack}
        options={{
          tabBarBadge: waitingRequests > 0 ? waitingRequests : undefined,
          tabBarIcon: tabIcon(t('TabStack.You'), (color, focused) => (
            <Icon name={focused ? 'account-circle' : 'account-circle-outline'} size={26} color={color} />
          )),
          tabBarAccessibilityLabel:
            waitingRequests > 0
              ? `${t('TabStack.You')}, ${t('TabStack.RequestsWaiting', { count: waitingRequests })}`
              : t('TabStack.You'),
          tabBarTestID: testIdWithKey('PreviewTabYou'),
        }}
      />
      {/* Today's stacks, without a tab: what links, notifications and App settings open. */}
      <Tab.Screen name={TabStacks.MessageStack} component={MessageStack} options={hidden} />
      <Tab.Screen name={TabStacks.MyAgentStack} component={HiddenMyAgentStack} options={hidden} />
      <Tab.Screen name={TabStacks.SettingStack} component={SettingStack} options={hidden} />
    </Tab.Navigator>
  )
}
