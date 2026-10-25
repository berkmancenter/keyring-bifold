/**
 * Export on iOS, as the person reads it, through real i18next: the backup is made under the app's caches, handed to
 * the share sheet, and removed afterwards whether it was shared or not. Only a completed share says the backup went
 * anywhere; a dismissed sheet says it was not saved.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'
import { Alert, Platform, Share } from 'react-native'

import ExportWallet from '../../src/screens/ExportWallet'
import { translationResources } from '../../src/localization'
import { testIdWithKey } from '../../src/utils/testable'

let mockT: (key: string, options?: Record<string, unknown>) => string
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockT(key, options) }),
}))

const mockExportStore = jest.fn(async () => undefined)
jest.mock('@bifold/react-hooks', () => ({
  useAgent: () => ({ agent: { isInitialized: true, modules: { askar: { exportStore: mockExportStore } } } }),
}))

let mockExisting: string[] = []
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  DocumentDirectoryPath: '/documents',
  DownloadDirectoryPath: '/downloads',
  mkdir: jest.fn(async () => undefined),
  exists: jest.fn(async (p: string) => mockExisting.some((suffix) => p.endsWith(suffix))),
  unlink: jest.fn(async () => undefined),
}))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RNFS = require('react-native-fs')

const exportWith = async () => {
  const tree = render(<ExportWallet navigation={{}} />)
  fireEvent.changeText(tree.getByTestId(testIdWithKey('ExportPassword')), 'pass phrase')
  fireEvent.changeText(tree.getByTestId(testIdWithKey('ExportPasswordConfirm')), 'pass phrase')
  await act(async () => {
    fireEvent.press(tree.getByTestId(testIdWithKey('ExportButton')))
  })
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
  return tree
}

const exportedTo = () => (mockExportStore.mock.calls[0] as any)[0].exportToStore.database.config.path as string

describe('export wallet on iOS', () => {
  beforeAll(async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: translationResources })
    mockT = (key, options) => i18n.t(key, options) as string
  })
  beforeEach(() => {
    expect(Platform.OS).toBe('ios')
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    mockExisting = []
  })
  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  test('a completed share says it was handed over, and the app keeps no copy', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction })
    await exportWith()

    const path = exportedTo()
    expect(path).toMatch(/^\/caches\/wallet-backup-\d+\/wallet-backup-\d+\.db$/)
    expect(path.startsWith('/documents')).toBe(false)
    expect(share).toHaveBeenCalledWith({ url: `file://${path}`, title: 'Keyring wallet backup' })
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      "Your backup was handed over. Keep it with its password: you'll need both to restore your wallet.",
      [{ text: 'OK' }]
    )
    expect(RNFS.unlink).toHaveBeenCalledWith(path.slice(0, path.lastIndexOf('/')))
  })

  test('a dismissed share says the backup was not saved, never that it was', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction })
    await exportWith()

    expect(Alert.alert).toHaveBeenCalledTimes(1)
    expect(Alert.alert).toHaveBeenCalledWith(
      'Backup not saved',
      "The backup wasn't saved, and no copy was kept on this phone. Export again when you're ready.",
      [{ text: 'OK' }]
    )
    const path = exportedTo()
    expect(RNFS.unlink).toHaveBeenCalledWith(path.slice(0, path.lastIndexOf('/')))
  })

  test('a backup with companion files is shared as its folder, so they stay together', async () => {
    mockExisting = ['.db-wal']
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction })
    await exportWith()

    const path = exportedTo()
    expect(share).toHaveBeenCalledWith({
      url: `file://${path.slice(0, path.lastIndexOf('/'))}`,
      title: 'Keyring wallet backup',
    })
  })

  test('a failed share reports the problem and still removes the backup', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('sheet failed'))
    await exportWith()

    expect(Alert.alert).toHaveBeenCalledWith('A problem has occurred', 'sheet failed')
    const path = exportedTo()
    expect(RNFS.unlink).toHaveBeenCalledWith(path.slice(0, path.lastIndexOf('/')))
  })

  test('the words exist in French and Portuguese too', () => {
    const keys = ['ExportWalletShareTitle', 'ExportWalletShared', 'ExportWalletNotSavedTitle', 'ExportWalletNotSaved']
    for (const lng of ['fr', 'pt-BR']) {
      const settings = (translationResources as any)[lng]?.translation?.Settings
      for (const key of keys) {
        expect(typeof settings?.[key]).toBe('string')
        expect(settings[key]).not.toBe((translationResources as any).en.translation.Settings[key])
      }
    }
  })
})
