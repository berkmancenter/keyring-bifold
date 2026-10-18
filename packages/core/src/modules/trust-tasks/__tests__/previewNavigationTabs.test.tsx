/**
 * The preview of the new navigation (Developer settings, "Preview: new
 * navigation") is off unless the person turns it on: off, and on an install
 * that has never seen the setting, the tab bar is today's, tab for tab and
 * testID for testID, and My Agent gets no preview props. On, the tabs are
 * Wallet · Contacts · QR · Communities · You. The stacks themselves are
 * stand-ins here; what each tab hands its stack is what is under test.
 */
import { NavigationContainer } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { DispatchAction, reducer } from '../../../contexts/reducers/store'
import { defaultState, StoreProvider } from '../../../contexts/store'
import { PersistentStorage } from '../../../services/storage'
import TabStack from '../../../navigators/TabStack'
import type { State } from '../../../types/state'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// The stacks: stand-ins that say what they were handed.
jest.mock('../../../navigators/ContactStack', () => {
  const { Text } = jest.requireActual('react-native')
  return {
    __esModule: true,
    default: (p: { conversations?: boolean }) => <Text>{`ContactStack:${!!p.conversations}`}</Text>,
  }
})
jest.mock('../../../navigators/MyAgentStack', () => {
  const { Text } = jest.requireActual('react-native')
  return {
    __esModule: true,
    default: (p: { part?: string; preview?: boolean }) => (
      <Text>{`MyAgentStack:${p.part ?? 'today'}:${p.preview === undefined ? 'none' : String(p.preview)}`}</Text>
    ),
  }
})
jest.mock('../../../navigators/CredentialStack', () => ({ __esModule: true, default: () => null }))
jest.mock('../../../navigators/MessageStack', () => ({ __esModule: true, default: () => null }))
jest.mock('../../../navigators/SettingStack', () => ({ __esModule: true, default: () => null }))
// What TabStack starts from unlock, none of it about the tabs.
jest.mock('../module/vtiPersonaInbox', () => ({
  useVtiPersonaInbox: jest.fn(),
  PersonaAgentUnreachable: class extends Error {},
}))
jest.mock('../module/vtiIdentityListeners', () => ({ useVtiIdentityListeners: jest.fn() }))
jest.mock('../module/lookAtOtherAgents', () => ({ useLookAtOtherAgents: jest.fn() }))
jest.mock('../module/vtiCardVault', () => ({ useVtiCardVault: jest.fn() }))
jest.mock('../module/vtiWalletCards', () => ({ useVtiWalletCards: jest.fn() }))
jest.mock('../screens/cardAgentNames', () => ({ useCardAgentNames: jest.fn() }))
jest.mock('../screens/communityCardDisplay', () => ({}))
jest.mock('../screens/refusedCardNotice', () => ({ useVtiRefusedCardNotice: jest.fn() }))
jest.mock('../screens/joinedNotice', () => ({ useVtiJoinedNotice: jest.fn() }))
jest.mock('../screens/vetterNotice', () => ({ useVtiVetterGrantedNotice: jest.fn() }))
jest.mock('../screens/removedNotice', () => ({ useVtiRemovedNotice: jest.fn() }))
jest.mock('../screens/turnedDownNotice', () => ({ useVtiTurnedDownNotice: jest.fn() }))
jest.mock('../module/vtaPresence', () => ({ isLinkOnline: () => false, useAgentPresence: jest.fn() }))
jest.mock('../screens/SiblingNoticeHost', () => ({ SiblingNoticeHost: () => null }))
jest.mock('../screens/StepUpAskHost', () => ({ StepUpAskHost: () => null }))
jest.mock('../screens/VtaStatus', () => ({ VtaOfflineBanner: () => null }))
jest.mock('../hiddenVettingModules', () => ({ logHiddenVettingSeams: jest.fn() }))
jest.mock('../screens/useCommunity', () => ({ useChosenCommunityDid: () => undefined }))
jest.mock('../module/vtiCommunityLink', () => ({ communityTarget: { restore: jest.fn(async () => undefined) } }))
jest.mock('../../../hooks/useUnreadMessages', () => ({
  useUnreadMessages: () => ({ totalUnread: 2, unreadByConnection: {} }),
}))
jest.mock('../../../components/InAppMessageNotifier', () => ({ __esModule: true, default: () => null }))
jest.mock('../../vrc/components/QRCodeExchangeSlider', () => ({ __esModule: true, default: () => null }))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter

const TODAY = ['Contacts', 'Message', 'QR Code', 'Wallet', 'MyAgent', 'Settings']
const PREVIEW = ['PreviewTabWallet', 'PreviewTabContacts', 'PreviewTabQR', 'PreviewTabCommunities', 'PreviewTabYou']
const ANY_TAB = new RegExp(`^com\\.ariesbifold:id/(${[...TODAY, ...PREVIEW].join('|')})$`)

const Root = createStackNavigator()
const renderTabs = async (preferences: Partial<State['preferences']>) => {
  const state: State = { ...defaultState, preferences: { ...defaultState.preferences, ...preferences } }
  const tree = render(
    <BasicAppContext>
      <StoreProvider initialState={state}>
        <NavigationContainer>
          <Root.Navigator screenOptions={{ headerShown: false }}>
            <Root.Screen name="TabStack" component={TabStack} />
          </Root.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
const tabIds = (tree: ReturnType<typeof render>) =>
  Array.from(
    new Set(tree.getAllByTestId(ANY_TAB).map((n) => String(n.props.testID).replace('com.ariesbifold:id/', '')))
  )
const pressTab = async (tree: ReturnType<typeof render>, key: string) =>
  act(async () => fireEvent.press(tree.getAllByTestId(testIdWithKey(key))[0]))

beforeEach(() => {
  ;(useAgent as jest.Mock).mockReturnValue({ agent: undefined })
  controller.set({
    approvals: [
      {
        id: 'a',
        requester: 'did:peer:2.Vz6Mkrequester',
        taskType: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
        receivedAt: new Date(Date.now() - 60000).toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        status: 'pending',
      },
    ],
  })
})
afterEach(() => controller.set({ approvals: [] }))

describe('Preview: new navigation, off', () => {
  it('is off on an install that never saw the setting: nothing in the default state turns it on', () => {
    expect(defaultState.preferences.previewNavigation).toBeUndefined()
  })

  it.each([
    ['never set', {}],
    ['turned off', { previewNavigation: false }],
  ])('%s: today’s tab bar, in today’s order, with today’s testIDs and no preview tab', async (_, prefs) => {
    const tree = await renderTabs(prefs)
    expect(tabIds(tree)).toEqual(TODAY)
    expect(tree.getByText('ContactStack:false')).toBeTruthy()
  })

  it('My Agent gets no preview props, and its tab still says a request waits', async () => {
    const tree = await renderTabs({})
    await pressTab(tree, 'MyAgent')
    expect(tree.getByText('MyAgentStack:today:none')).toBeTruthy()
    expect(tree.getAllByTestId(testIdWithKey('MyAgent'))[0].props.accessibilityLabel).toMatch(/RequestsWaiting/)
  })
})

describe('Preview: new navigation, on', () => {
  it('Wallet · Contacts · QR · Communities · You, and none of today’s tab buttons', async () => {
    const tree = await renderTabs({ previewNavigation: true })
    expect(tabIds(tree)).toEqual(PREVIEW)
  })

  it('Contacts carries Conversations, with the unread count on its tab', async () => {
    const tree = await renderTabs({ previewNavigation: true })
    expect(tree.getByText('ContactStack:true')).toBeTruthy()
    expect(tree.getByText('2')).toBeTruthy()
  })

  it('Communities and You are the two parts of the agent’s page; You carries the requests badge', async () => {
    const tree = await renderTabs({ previewNavigation: true })
    await pressTab(tree, 'PreviewTabCommunities')
    expect(tree.getByText('MyAgentStack:communities:true')).toBeTruthy()
    await pressTab(tree, 'PreviewTabYou')
    expect(tree.getByText('MyAgentStack:you:true')).toBeTruthy()
    expect(tree.getAllByTestId(testIdWithKey('PreviewTabYou'))[0].props.accessibilityLabel).toMatch(/RequestsWaiting/)
  })
})

describe('the setting itself', () => {
  afterEach(() => jest.restoreAllMocks())

  it('opening the app with it off writes nothing to the phone’s store', async () => {
    const write = jest.spyOn(PersistentStorage, 'storeValueForKey').mockResolvedValue(undefined)
    await renderTabs({})
    expect(write).not.toHaveBeenCalled()
  })

  it('only the Developer switch sets it, and it is kept with the other preferences', () => {
    const write = jest.spyOn(PersistentStorage, 'storeValueForKey').mockResolvedValue(undefined)
    const on = reducer(defaultState, { type: DispatchAction.PREVIEW_NAVIGATION, payload: [true] })
    expect(on.preferences.previewNavigation).toBe(true)
    expect(write).toHaveBeenCalledWith(expect.anything(), on.preferences)
    const off = reducer(on, { type: DispatchAction.PREVIEW_NAVIGATION, payload: [false] })
    expect(off.preferences.previewNavigation).toBe(false)
  })
})
