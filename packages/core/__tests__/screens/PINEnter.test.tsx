import { render, fireEvent, waitFor, act } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { Keyboard } from 'react-native'

import { ContainerProvider, TOKENS } from '../../src/container-api'
import { MainContainer } from '../../src/container-impl'
import { AuthContext } from '../../src/contexts/auth'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import reducer from '../../src/contexts/reducers/store'
import PINEnter, { biometricFailureKind } from '../../src/screens/PINEnter'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'

// Create a stable reducer reference for testing
const stableReducer = reducer

describe('PINEnter Screen', () => {
  test('PIN Enter renders correctly', () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    expect(tree).toMatchSnapshot()
  })

  test('PIN Enter renders correctly when logged out message is present', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
            lockout: {
              displayNotification: true,
            },
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const textNotice = await tree.findByText('PINEnter.LockedOut')
    expect(textNotice).not.toBeNull()
    expect(tree).toMatchSnapshot()
  })

  test('PIN Enter button exists', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const EnterButton = await tree.getByTestId(testIdWithKey('Enter'))
    expect(EnterButton).not.toBeNull()
  })

  test('Forgot PIN link exists', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    expect(forgotPinLink).not.toBeNull()
  })

  test('Forgot PIN link displays popup modal on press', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    act(() => {
      forgotPinLink.props.onPress()
    })
    const popupModal = await tree.getByTestId(testIdWithKey('ForgotPINModalDescription'))
    expect(popupModal).not.toBeNull()
  })

  test('Forgot PIN modal is closed on close button press', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const forgotPinLink = await tree.getByTestId(testIdWithKey('ForgotPINLink'))
    act(() => {
      forgotPinLink.props.onPress()
    })
    const okayButton = await tree.getByLabelText('Global.Okay')
    act(() => {
      fireEvent.press(okayButton)
    })
    expect(tree.queryByTestId(testIdWithKey('ForgotPINModalDescription'))).toBeNull()
  })

  test('Vesion number is displayed', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const versionText = await tree.getByTestId(testIdWithKey('Version'))
    expect(versionText).not.toBeNull()
  })

  test('keyboard dismiss is called when pin input is filled', async () => {
    jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})

    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
          reducer={stableReducer}
        >
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '123456') // minpinlength is 6
    })
    expect(Keyboard.dismiss).toHaveBeenCalled()
  })

  // IN-257: after a wrong PIN on the unlock screen the six dots stayed filled.
  test('a wrong PIN empties the field so the person can start over', async () => {
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(false),
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '123456')
    })
    await waitFor(() => expect(mockAuthContext.checkWalletPIN).toHaveBeenCalledWith('123456'))
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('EnterPIN')).props.value).toBe(''))
  })

  // smoke's wrong-pin-clears (gate efficiency item 12), as a component test: a wrong PIN says so (inline, or in the
  // Incorrect PIN popup, whichever the build configures) and empties the field; the right PIN then unlocks.
  test('a wrong PIN is said and cleared, and the right one then unlocks', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={setAuthenticatedMock} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '111111')
    })
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('EnterPIN')).props.value).toBe(''))
    expect(tree.queryAllByText(/PINEnter\.IncorrectPIN/).length).toBeGreaterThan(0)
    expect(setAuthenticatedMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '123456')
    })
    await waitFor(() => expect(setAuthenticatedMock).toHaveBeenCalled())
    expect(mockAuthContext.checkWalletPIN).toHaveBeenNthCalledWith(1, '111111')
    expect(mockAuthContext.checkWalletPIN).toHaveBeenNthCalledWith(2, '123456')
  })

  test('pin is submitted when pin input is filled', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
          reducer={stableReducer}
        >
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={mockAuthContext.setAuthenticated} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '123456') // minpinlength is 6
    })
    await waitFor(() => {
      expect(setAuthenticatedMock).toHaveBeenCalled()
    })
  })

  test('Keyboard enter button submits PIN', async () => {
    const setAuthenticatedMock = jest.fn()
    const mockAuthContext = {
      ...authContext,
      checkWalletPIN: jest.fn().mockResolvedValue(true),
      setAuthenticated: setAuthenticatedMock,
    }
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{
            ...defaultState,
          }}
        >
          <AuthContext.Provider value={mockAuthContext}>
            <PINEnter setAuthenticated={mockAuthContext.setAuthenticated} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    const pinInput = tree.getByTestId(testIdWithKey('EnterPIN'))
    await act(async () => {
      fireEvent.changeText(pinInput, '12345') // only 5 characters so the pin isnt autosubmitted
    })

    await act(async () => {
      fireEvent(pinInput, 'submitEditing')
    })
    await waitFor(
      () => {
        // look for inline error message
        expect(tree.queryByText('PINCreate.PINTooShort')).not.toBeNull()
      },
      { timeout: 1000 }
    )
  })
})

describe('when a biometric unlock does not complete (IN-491, IN-452)', () => {
  const SECRET_WORDS = 'keychain said something private'
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const setAuthenticated = jest.fn()
  const auth = {
    ...authContext,
    isBiometricsActive: jest.fn(async () => true),
    getWalletSecret: jest.fn(),
  }

  const show = async () => {
    const child = container.createChildContainer()
    const main = new MainContainer(child).init()
    child.registerInstance(TOKENS.UTIL_LOGGER, logger as never)
    const tree = render(
      <ContainerProvider value={main}>
        <StoreProvider
          initialState={{ ...defaultState, preferences: { ...defaultState.preferences, useBiometry: true } }}
          reducer={stableReducer}
        >
          <AuthContext.Provider value={auth as never}>
            <PINEnter setAuthenticated={setAuthenticated} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
    await act(async () => undefined)
    return tree
  }

  const tapTheButton = async (tree: ReturnType<typeof render>) => {
    // Not returned to act: the press's own promise is what some of these leave unresolved.
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('BiometricsUnlock')))
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    // The prompt on arriving is cancelled, so what follows is the button's own.
    auth.getWalletSecret.mockReset()
    auth.getWalletSecret.mockRejectedValueOnce(new Error('User canceled the operation.'))
  })

  test('the button logs a keychain failure, and nothing else changes on screen', async () => {
    const tree = await show()
    auth.getWalletSecret.mockRejectedValueOnce(new Error('Wallet secret is missing key property'))
    await tapTheButton(tree)
    expect(logger.warn).toHaveBeenCalledWith('[PIN] biometric unlock did not complete: no key')
    expect(tree.queryByText('PINEnter.BiometricsError')).toBeNull()
    expect(tree.getByTestId(testIdWithKey('Enter'))).toBeTruthy()
    expect(setAuthenticated).not.toHaveBeenCalled()
  })

  test('the log has the kind, never the words', async () => {
    const tree = await show()
    auth.getWalletSecret.mockRejectedValueOnce(new Error(SECRET_WORDS))
    await tapTheButton(tree)
    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls])
    expect(logged).toContain('biometric unlock did not complete: other')
    expect(logged).not.toContain(SECRET_WORDS)
  })

  test('no secret and no error is logged too', async () => {
    const tree = await show()
    auth.getWalletSecret.mockResolvedValueOnce(undefined)
    await tapTheButton(tree)
    expect(logger.warn).toHaveBeenCalledWith('[PIN] biometric unlock did not complete: no secret')
  })

  test('a read that never returns still shows it started', async () => {
    const tree = await show()
    logger.info.mockClear()
    auth.getWalletSecret.mockReturnValueOnce(new Promise(() => undefined))
    await tapTheButton(tree)
    expect(logger.info).toHaveBeenCalledWith('[PIN] biometric unlock: asking the keychain')
  })

  test('a PIN check that never returns still shows it started', async () => {
    auth.checkWalletPIN = jest.fn(() => new Promise(() => undefined)) as never
    const tree = await show()
    logger.info.mockClear()
    fireEvent.changeText(tree.getByTestId(testIdWithKey('EnterPIN')), '123456')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('Enter')))
    })
    expect(logger.info).toHaveBeenCalledWith('[PIN] checking the PIN')
    expect(logger.info).not.toHaveBeenCalledWith('[PIN] PIN checked')
  })

  test('success still unlocks', async () => {
    const tree = await show()
    auth.getWalletSecret.mockResolvedValueOnce({ id: 'i', key: 'k', salt: 's' })
    await tapTheButton(tree)
    expect(setAuthenticated).toHaveBeenCalledWith(true)
  })

  test.each([
    ['User canceled the operation.', 'cancelled'],
    ['code: 13, msg: Cancel', 'cancelled'],
    ['Wallet secret is missing key property', 'no key'],
    ['code: 7, msg: Too many attempts. Try again later.', 'locked out'],
    ['code: 9, msg: Biometric lockout', 'locked out'],
    ['anything else', 'other'],
  ])('%s reads as %s', (message, kind) => {
    expect(biometricFailureKind(new Error(message))).toBe(kind)
  })

  test('something that is not an error still has a kind', () => {
    expect(biometricFailureKind('cancel')).toBe('cancelled')
    expect(biometricFailureKind(undefined)).toBe('other')
  })
})
