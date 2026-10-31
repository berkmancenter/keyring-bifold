/**
 * The main stack exists only while the person is signed in and an agent is running, and a lock-out unmounts it.
 * Services an app registers as an agent starts depend on this: rooms (the wallet's registerRealRooms) builds its
 * service on the agent, and screens resolve that service once as they mount (rooms/useRoomsService memoises on the
 * container). They are right only because every screen in the main stack mounts again, fresh, after a new agent
 * starts, and because the agent is started only from the onboarding stack, which is what RootStack shows while the
 * main stack is down.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { EventTypes } from '../../src/constants'

const mockMainStackMounts: string[] = []
const mockMainStackUnmounts: string[] = []
let mockOnboardingProps: { agent: unknown; initializeAgent?: unknown } | undefined

let mockAgent: { id: string } | null = null
let mockDidAuthenticate = true
const mockInitializeAgent = jest.fn(async () => undefined)
const mockShutdownAndClear = jest.fn(async () => undefined)

// Records each mount and unmount, with the agent it was given, so a fresh mount tells apart from a re-render.
jest.mock('../../src/navigators/MainStack', () => {
  const ReactActual = jest.requireActual('react')
  return function MockMainStack() {
    const { useAgent } = require('@bifold/react-hooks')
    // The agent it mounted with: a re-render with another agent records nothing, only a fresh mount does.
    const [id] = ReactActual.useState((useAgent().agent as { id?: string } | undefined)?.id ?? 'unknown')
    ReactActual.useEffect(() => {
      mockMainStackMounts.push(id)
      return () => {
        mockMainStackUnmounts.push(id)
      }
    }, [])
    return null
  }
})

jest.mock('@bifold/react-hooks', () => {
  const ReactActual = jest.requireActual('react')
  const AgentContext = ReactActual.createContext({ agent: undefined })
  return {
    __esModule: true,
    default: ({ agent, children }: { agent: unknown; children?: React.ReactNode }) =>
      ReactActual.createElement(AgentContext.Provider, { value: { agent } }, children),
    useAgent: () => ReactActual.useContext(AgentContext),
  }
})
jest.mock('../../src/contexts/biometric-confirmation', () => ({
  BiometricConfirmationProvider: ({ children }: { children?: React.ReactNode }) => children,
}))
jest.mock('../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  OpenIDCredentialRecordProvider: ({ children }: { children?: React.ReactNode }) => children,
}))
jest.mock('../../src/modules/vrc/context/WitnessConnectionProvider', () => ({
  WitnessConnectionProvider: ({ children }: { children?: React.ReactNode }) => children,
}))
jest.mock('../../src/contexts/activity', () => ({
  ActivityProvider: ({ children }: { children?: React.ReactNode }) => children,
}))
jest.mock('../../src/modules/vrc/components/RelationshipProposalModal', () => () => null)
jest.mock('../../src/modules/vrc/components/ContinuityCheckModal', () => () => null)
jest.mock('../../src/modules/vrc/components/LocalityPreflightModal', () => () => null)
jest.mock('../../src/modules/trust-tasks/components/CredentialExchangeQueryModal', () => () => null)
jest.mock('../../src/hooks/deep-links', () => ({ keepLinksUntilMainStack: jest.fn() }))
jest.mock('../../src/modules/chat/draft', () => ({
  afterChatDrafts: (shutdown: () => unknown) => Promise.resolve(shutdown()).then(() => undefined),
}))

jest.mock('../../src/contexts/store', () => ({
  useStore: () => [{ stateLoaded: true, authentication: { didAuthenticate: mockDidAuthenticate } }, jest.fn()],
}))

jest.mock('../../src/container-api', () => {
  const actual = jest.requireActual('../../src/container-api')
  const OnboardingStack = (props: { agent: unknown; initializeAgent?: unknown }) => {
    mockOnboardingProps = props
    return null
  }
  const useAgentSetup = () => ({
    agent: mockAgent,
    initializeAgent: mockInitializeAgent,
    shutdownAndClearAgentIfExists: mockShutdownAndClear,
  })
  return { ...actual, useServices: () => [useAgentSetup, OnboardingStack, jest.fn(async () => undefined)] }
})

// eslint-disable-next-line import/first
import RootStack from '../../src/navigators/RootStack'

const finishOnboarding = () => act(async () => void DeviceEventEmitter.emit(EventTypes.DID_COMPLETE_ONBOARDING))

beforeEach(() => {
  mockMainStackMounts.length = 0
  mockMainStackUnmounts.length = 0
  mockOnboardingProps = undefined
  mockAgent = { id: 'first' }
  mockDidAuthenticate = true
  jest.clearAllMocks()
})

describe('RootStack mounts the main stack fresh for each agent', () => {
  it('shows the main stack only once onboarding is done, the person is signed in and an agent runs', async () => {
    const tree = render(<RootStack />)
    expect(mockMainStackMounts).toEqual([])
    expect(mockOnboardingProps?.agent).toEqual({ id: 'first' })
    await finishOnboarding()
    expect(mockMainStackMounts).toEqual(['first'])
    tree.unmount()
  })

  it('a lock-out unmounts the main stack at once, and then shuts the agent down', async () => {
    const tree = render(<RootStack />)
    await finishOnboarding()
    expect(mockMainStackMounts).toEqual(['first'])

    mockDidAuthenticate = false
    await act(async () => tree.rerender(<RootStack />))

    expect(mockMainStackUnmounts).toEqual(['first'])
    expect(mockShutdownAndClear).toHaveBeenCalledTimes(1)
    tree.unmount()
  })

  it('the agent is started only from the onboarding stack, which is what shows while the main stack is down', async () => {
    const tree = render(<RootStack />)
    expect(typeof mockOnboardingProps?.initializeAgent).toBe('function')
    await finishOnboarding()
    // While the main stack is up nothing can reach a start: the onboarding stack is not rendered.
    mockOnboardingProps = undefined
    await act(async () => tree.rerender(<RootStack />))
    expect(mockOnboardingProps).toBeUndefined()
    tree.unmount()
  })

  it('after a lock-out and a new agent, every main-stack screen mounts again rather than re-rendering', async () => {
    const tree = render(<RootStack />)
    await finishOnboarding()

    mockDidAuthenticate = false
    await act(async () => tree.rerender(<RootStack />))
    mockAgent = null
    await act(async () => tree.rerender(<RootStack />))

    mockAgent = { id: 'second' }
    mockDidAuthenticate = true
    await act(async () => tree.rerender(<RootStack />))

    expect(mockMainStackMounts).toEqual(['first', 'second'])
    expect(mockMainStackUnmounts).toEqual(['first'])
    tree.unmount()
  })

  it('no agent while signed in: the main stack is down', async () => {
    const tree = render(<RootStack />)
    await finishOnboarding()
    mockAgent = null
    await act(async () => tree.rerender(<RootStack />))
    expect(mockMainStackUnmounts).toEqual(['first'])
    expect(mockOnboardingProps?.agent).toBeNull()
    tree.unmount()
  })
})
