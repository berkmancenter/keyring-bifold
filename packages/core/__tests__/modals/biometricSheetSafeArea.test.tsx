/**
 * The biometric sheet must mount where it is actually mounted.
 *
 * BiometricConfirmationProvider renders BiometricConfirmationModal
 * unconditionally in RootStack, above the navigators that supply React
 * Navigation's SafeAreaProviderCompat. Nothing wraps that point in a
 * SafeAreaProvider, so a useSafeAreaInsets() call in the component's body
 * throws on every render -- before the early return, because hooks always run.
 * That crashed the app at main-stack mount on every build.
 *
 * It reached main green on all ten checks because core/jestSetup.js mocks
 * react-native-safe-area-context with the library's own jest mock, which
 * returns fixed insets and never throws. So this file unmocks that module and
 * uses the real one: under the global mock it cannot see this defect at all,
 * and a test that cannot fail for the right reason is not a guard.
 */

jest.unmock('react-native-safe-area-context')

import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../helpers/app'

const mockUseBiometricConfirmation = jest.fn()

jest.mock('../../src/contexts/biometric-confirmation', () => ({
  ...jest.requireActual('../../src/contexts/biometric-confirmation'),
  useBiometricConfirmation: () => mockUseBiometricConfirmation(),
}))

jest.mock('../../src/services/keychain', () => ({
  loadWalletKey: jest.fn().mockResolvedValue(true),
}))

import BiometricConfirmationModal from '../../src/components/modals/BiometricConfirmationModal'

describe('the biometric sheet outside a safe-area provider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is the real safe-area module, not the jest mock', () => {
    // Guards the guard: if the global mock were still in place, every row below
    // would pass whatever the component did. The real module throws when no
    // provider is in scope; the mock never does.
    // A plain require, NOT jest.requireMock: requireMock deliberately returns the
    // mock registry's entry, so it reports a mock whether or not jest.unmock took
    // effect and the guard could never pass.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSafeAreaInsets } = require('react-native-safe-area-context')
    expect(jest.isMockFunction(useSafeAreaInsets)).toBe(false)
  })

  it('mounts outside a safe-area provider without throwing', () => {
    // Exactly the production case: mounted by the provider in RootStack with
    // nothing pending, so the sheet is not showing. The hook still runs.
    mockUseBiometricConfirmation.mockReturnValue({
      isModalVisible: false,
      pendingRequest: null,
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      onError: jest.fn(),
    })

    expect(() =>
      render(
        <BasicAppContext>
          <BiometricConfirmationModal />
        </BasicAppContext>
      )
    ).not.toThrow()
  })

  it('still mounts without throwing when a request is pending', () => {
    // The sheet itself renders inside SafeAreaModal, which carries a provider of
    // its own, so the inset read belongs under there and this must not throw
    // either.
    mockUseBiometricConfirmation.mockReturnValue({
      isModalVisible: true,
      pendingRequest: {
        counterpartyName: 'Keyring Lab Community',
        connectionId: 'vetting',
        timestamp: '2026-09-23T12:00:00.000Z',
        skipNativeBiometric: false,
        authMode: 'biometric',
      },
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      onError: jest.fn(),
    })

    expect(() =>
      render(
        <BasicAppContext>
          <BiometricConfirmationModal />
        </BasicAppContext>
      )
    ).not.toThrow()
  })
})
