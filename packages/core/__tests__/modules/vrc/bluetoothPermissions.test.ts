import { Platform } from 'react-native'

import { missingBluetoothPermissions, requestBluetoothPermissions } from '../../../src/modules/vrc/bluetoothPermissions'

const ADVERTISE = 'android.permission.BLUETOOTH_ADVERTISE'
const CONNECT = 'android.permission.BLUETOOTH_CONNECT'

const mockRequest = jest.fn()
const mockCheck = jest.fn()
jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    ANDROID: {
      BLUETOOTH_ADVERTISE: 'android.permission.BLUETOOTH_ADVERTISE',
      BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
    },
    IOS: { BLUETOOTH: 'ios.permission.BLUETOOTH' },
  },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' },
  request: (...args: unknown[]) => mockRequest(...args),
  check: (...args: unknown[]) => mockCheck(...args),
}))

const setPlatform = (os: string, version: number | string) => {
  Platform.OS = os as typeof Platform.OS
  // A getter in the react-native preset: plain assignment does not stick.
  Object.defineProperty(Platform, 'Version', { get: () => version, configurable: true })
}

describe('the Bluetooth permissions the locality radio phase needs', () => {
  const originalOs = Platform.OS
  const originalVersion = Platform.Version
  beforeEach(() => {
    jest.clearAllMocks()
  })
  afterEach(() => {
    setPlatform(originalOs, originalVersion as number)
  })

  describe('on Android 12 and later', () => {
    beforeEach(() => setPlatform('android', 34))

    it('asks for ADVERTISE and CONNECT, and never SCAN (IN-128)', async () => {
      mockRequest.mockResolvedValue('granted')
      await expect(requestBluetoothPermissions()).resolves.toBe(true)
      expect(mockRequest.mock.calls.map(([p]) => p)).toEqual([ADVERTISE, CONNECT])
    })

    it('is not granted unless both are: CONNECT refused is a refusal', async () => {
      mockRequest.mockImplementation(async (p: string) => (p === CONNECT ? 'denied' : 'granted'))
      await expect(requestBluetoothPermissions()).resolves.toBe(false)
    })

    it('names what is missing without asking: the tester phones held ADVERTISE but not CONNECT', async () => {
      mockCheck.mockImplementation(async (p: string) => (p === ADVERTISE ? 'granted' : 'denied'))
      await expect(missingBluetoothPermissions()).resolves.toEqual([CONNECT])
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('nothing missing when both are held', async () => {
      mockCheck.mockResolvedValue('granted')
      await expect(missingBluetoothPermissions()).resolves.toEqual([])
    })

    it('a check that throws counts as missing, so the reason still reaches the log', async () => {
      mockCheck.mockRejectedValue(new Error('no activity'))
      await expect(missingBluetoothPermissions()).resolves.toEqual([ADVERTISE, CONNECT])
    })
  })

  it('before Android 12 both are install-time: nothing to ask for, nothing missing', async () => {
    setPlatform('android', 30)
    await expect(requestBluetoothPermissions()).resolves.toBe(true)
    await expect(missingBluetoothPermissions()).resolves.toEqual([])
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('on iOS asks for the one Bluetooth authorization, and reports nothing missing', async () => {
    setPlatform('ios', '17.0')
    mockRequest.mockResolvedValue('granted')
    await expect(requestBluetoothPermissions()).resolves.toBe(true)
    expect(mockRequest).toHaveBeenCalledWith('ios.permission.BLUETOOTH')
    await expect(missingBluetoothPermissions()).resolves.toEqual([])
  })
})
