/**
 * The phone's UV key over a faked react-native-keychain: made once, named
 * without a prompt, readable only through the biometric prompt (current
 * biometrics, no passcode fallback), and refused when the item is gone.
 */
import * as Attestation from '@bifold/react-native-attestation'
import { ed25519 } from '@noble/curves/ed25519.js'
import { Platform } from 'react-native'
import * as Keychain from 'react-native-keychain'

import { didKeyVerificationMethod, getUvDid, resetUvKey, uvSign, UvKeyError } from '../module/uvKey'

jest.mock('react-native-keychain', () => {
  const items = new Map<string, { username: string; password: string; options: Record<string, unknown> }>()
  return {
    __items: items,
    ACCESS_CONTROL: {
      BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
      BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
    },
    ACCESSIBLE: {
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    STORAGE_TYPE: { AES_GCM: 'KeystoreAESGCM' },
    setGenericPassword: jest.fn(async (username: string, password: string, options: { service: string }) => {
      items.set(options.service, { username, password, options })
      return { service: options.service, storage: 'keychain' }
    }),
    getGenericPassword: jest.fn(async (options: { service: string }) => {
      const item = items.get(options.service)
      return item ? { username: item.username, password: item.password, service: options.service } : false
    }),
    resetGenericPassword: jest.fn(async (options: { service: string }) => items.delete(options.service)),
  }
})

// The Android approval key (ApprovalKey.kt): what it was given to keep, released once the prompt is answered.
jest.mock('@bifold/react-native-attestation', () => {
  const kept: { secretHex?: string } = {}
  return {
    __kept: kept,
    approvalKeyWrap: jest.fn(async (secretHex: string) => {
      kept.secretHex = secretHex
      return true
    }),
    approvalKeyUnwrap: jest.fn(async () => {
      if (!kept.secretHex) throw Object.assign(new Error('this phone keeps no approval key'), { code: 'lost' })
      return kept.secretHex
    }),
    approvalKeyForget: jest.fn(async () => {
      delete kept.secretHex
      return true
    }),
  }
})
const approval = Attestation as unknown as {
  __kept: { secretHex?: string }
  approvalKeyWrap: jest.Mock
  approvalKeyUnwrap: jest.Mock
  approvalKeyForget: jest.Mock
}
let os = 'ios'
Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os })

const mock = Keychain as unknown as {
  __items: Map<string, { username: string; password: string; options: Record<string, unknown> }>
  setGenericPassword: jest.Mock
  getGenericPassword: jest.Mock
}

const verifyWith = (did: string, bytes: Uint8Array, signature: Uint8Array) => {
  // did:key:z6Mk… → the raw public key after the 0xed01 prefix.
  const { TypedArrayEncoder } = jest.requireActual('@credo-ts/core')
  const raw = TypedArrayEncoder.fromBase58(did.slice('did:key:z'.length)).slice(2)
  return ed25519.verify(signature, bytes, raw)
}

const readItem = mock.getGenericPassword.getMockImplementation()!

beforeEach(async () => {
  os = 'ios'
  delete approval.__kept.secretHex
  mock.__items.clear()
  jest.clearAllMocks()
  mock.getGenericPassword.mockImplementation(readItem)
})

describe('the UV key', () => {
  it('is made once, behind current biometrics with no passcode fallback, and named without a prompt', async () => {
    const did = await getUvDid()
    expect(did).toMatch(/^did:key:z6Mk/)
    expect(didKeyVerificationMethod(did)).toBe(`${did}#${did.slice(8)}`)

    const secretItem = mock.__items.get('keyring.signin-uv-key')!
    expect(secretItem.options).toMatchObject({
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenPasscodeSetThisDeviceOnly',
      storage: 'KeystoreAESGCM',
    })
    expect(secretItem.password).toMatch(/^[0-9a-f]{64}$/)
    // The DID is kept apart, with no access control: naming the key reads only that.
    expect(mock.__items.get('keyring.signin-uv-key.did')!.options).not.toHaveProperty('accessControl')

    mock.getGenericPassword.mockClear()
    await expect(getUvDid()).resolves.toBe(did)
    expect(mock.setGenericPassword).toHaveBeenCalledTimes(2)
    expect(mock.getGenericPassword).toHaveBeenCalledWith({ service: 'keyring.signin-uv-key.did' })
    expect(mock.getGenericPassword).not.toHaveBeenCalledWith(
      expect.objectContaining({ service: 'keyring.signin-uv-key' })
    )
  })

  it('signs only by reading the key through the biometric prompt', async () => {
    const did = await getUvDid()
    const bytes = new Uint8Array(64).fill(1)
    const signature = await uvSign(bytes, 'Approve signing in')
    expect(mock.getGenericPassword).toHaveBeenCalledWith({
      service: 'keyring.signin-uv-key',
      accessControl: 'BiometryCurrentSet',
      authenticationPrompt: { title: 'Approve signing in' },
    })
    expect(verifyWith(did, bytes, signature)).toBe(true)
  })

  it('says cancelled when the person cancels the prompt', async () => {
    await getUvDid()
    mock.getGenericPassword.mockImplementation(async (options: { service: string }) => {
      if (options.service === 'keyring.signin-uv-key') throw new Error('User canceled the operation.')
      const item = mock.__items.get(options.service)
      return item ? { username: item.username, password: item.password } : false
    })
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('says lost when biometrics changed and the item no longer reads, or there is no key', async () => {
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toBeInstanceOf(UvKeyError)
    await getUvDid()
    mock.__items.delete('keyring.signin-uv-key')
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'lost' })
  })

  it('says lost when the stored key is not the one its DID names', async () => {
    await getUvDid()
    mock.__items.get('keyring.signin-uv-key')!.password = '11'.repeat(32)
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'lost' })
  })

  it('is made afresh after a reset', async () => {
    const first = await getUvDid()
    await resetUvKey()
    const second = await getUvDid()
    expect(second).not.toBe(first)
  })
})

// Android kept the secret with react-native-keychain, whose Keystore key opens for a few seconds after any unlock,
// the device PIN's too, and outlives a new enrolment. It is kept by the approval key now: one strong biometric per use.
describe('the UV key on Android', () => {
  beforeEach(() => {
    os = 'android'
  })

  it('is kept by the approval key, not the keychain: only its DID is in the keychain', async () => {
    const did = await getUvDid('Set up approving')
    expect(approval.approvalKeyWrap).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
      'Set up approving',
      'Cancel'
    )
    expect(mock.__items.has('keyring.signin-uv-key')).toBe(false)
    expect(mock.__items.get('keyring.signin-uv-key.did')?.password).toBe(did)
  })

  it('signs with the secret the approval key releases for this one use', async () => {
    const did = await getUvDid()
    const bytes = new TextEncoder().encode('grant digest')
    const signature = await uvSign(bytes, 'Approve signing in')
    expect(approval.approvalKeyUnwrap).toHaveBeenCalledWith('Approve signing in', 'Cancel')
    expect(verifyWith(did, bytes, signature)).toBe(true)
  })

  it.each([
    ['lost', 'lost'],
    ['cancelled', 'cancelled'],
    ['unavailable', 'unavailable'],
    [undefined, 'unavailable'],
  ])('a release refused with code %s says %s', async (code, reason) => {
    await getUvDid()
    approval.approvalKeyUnwrap.mockRejectedValueOnce(Object.assign(new Error('refused'), { code }))
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason })
  })

  it('a phone that cannot hold a biometric-only key is refused when the key is made', async () => {
    approval.approvalKeyWrap.mockRejectedValueOnce(
      Object.assign(new Error('this phone cannot keep a biometric-only approval key: usable for 5s'), {
        code: 'unavailable',
      })
    )
    await expect(getUvDid()).rejects.toMatchObject({ reason: 'unavailable' })
    // Nothing names a key that was never made.
    expect(mock.__items.has('keyring.signin-uv-key.did')).toBe(false)
  })

  it('a key kept the earlier way reads as lost, and a reset forgets both, so a new one is made', async () => {
    // As an earlier build left it: the secret in the keychain, the approval key empty.
    os = 'ios'
    const earlier = await getUvDid()
    os = 'android'
    await expect(uvSign(new Uint8Array(64), 'Approve')).rejects.toMatchObject({ reason: 'lost' })
    await resetUvKey()
    expect(approval.approvalKeyForget).toHaveBeenCalled()
    expect(mock.__items.size).toBe(0)
    const fresh = await getUvDid()
    expect(fresh).not.toBe(earlier)
    expect(approval.approvalKeyWrap).toHaveBeenCalledTimes(1)
  })
})
