import { Alert, Linking } from 'react-native'
import Toast from 'react-native-toast-message'

import { explainPhotoOutcome, showPhotoOutcome } from '../outcome'

const t = ((key: string) => key) as never

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
})

describe('explainPhotoOutcome', () => {
  it.each([
    ['sent', undefined],
    ['cancelled', undefined],
    ['gif-too-large', { kind: 'toast', text: 'Chat.GifTooLarge' }],
    ['photo-too-large', { kind: 'toast', text: 'Chat.PhotoTooLarge' }],
    ['unreadable', { kind: 'toast', text: 'Chat.PhotoUnreadable' }],
    ['not-sent', { kind: 'toast', text: 'Chat.PhotoNotSent' }],
    ['no-permission', { kind: 'settings', title: 'Chat.PhotoNoPermissionTitle', text: 'Chat.PhotoNoPermission' }],
  ] as const)('%s', (outcome, notice) => {
    expect(explainPhotoOutcome(outcome)).toEqual(notice)
  })
})

describe('showPhotoOutcome', () => {
  it('says nothing for a photo that went or a cancel', () => {
    showPhotoOutcome('sent', t)
    showPhotoOutcome('cancelled', t)
    expect(Toast.show).not.toHaveBeenCalled()
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('says in a toast why a photo was not sent', () => {
    showPhotoOutcome('not-sent', t)
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Chat.PhotoNotSent' }))
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  // A toast here read as the tap doing nothing, and once refused, access can only be given back in Settings.
  it('asks about a missing permission until answered, with a way to Settings', () => {
    showPhotoOutcome('no-permission', t)
    expect(Toast.show).not.toHaveBeenCalled()
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      { text: string; style?: string; onPress?: () => void }[],
    ]
    expect([title, body]).toEqual(['Chat.PhotoNoPermissionTitle', 'Chat.PhotoNoPermission'])
    expect(buttons.map((button) => button.text)).toEqual(['Global.Cancel', 'Chat.OpenSettings'])
    expect(Linking.openSettings).not.toHaveBeenCalled()
    buttons[1].onPress?.()
    expect(Linking.openSettings).toHaveBeenCalledTimes(1)
  })
})
