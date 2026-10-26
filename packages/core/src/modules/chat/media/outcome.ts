/**
 * What the person is told after trying to send a photo (rich-messaging-plan.md
 * §5), wherever it was sent from: the composer's "+" today, an attachment tray
 * next. Nothing when it went or they cancelled, a toast when it was not sent.
 *
 * A missing permission gets a message that stays until it is answered, with a
 * way to Settings. A brief toast there read as the tap doing nothing (iOS 26
 * simulators, 10-25), and once access has been refused the app cannot ask
 * again: Settings is the only way back to it.
 *
 * @module chat/media/outcome
 */

import type { TFunction } from 'i18next'
import { Alert, Linking } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import type { PhotoSendOutcome } from './compose'

/** Translation keys for what to show. */
export type PhotoOutcomeNotice = { kind: 'toast'; text: string } | { kind: 'settings'; title: string; text: string }

const NOT_SENT: Partial<Record<PhotoSendOutcome, string>> = {
  'gif-too-large': 'Chat.GifTooLarge',
  'photo-too-large': 'Chat.PhotoTooLarge',
  unreadable: 'Chat.PhotoUnreadable',
  'not-sent': 'Chat.PhotoNotSent',
}

/** What to tell the person about `outcome`; undefined when there is nothing to say ('sent', 'cancelled'). */
export function explainPhotoOutcome(outcome: PhotoSendOutcome): PhotoOutcomeNotice | undefined {
  if (outcome === 'no-permission') {
    return { kind: 'settings', title: 'Chat.PhotoNoPermissionTitle', text: 'Chat.PhotoNoPermission' }
  }
  const text = NOT_SENT[outcome]
  return text ? { kind: 'toast', text } : undefined
}

/** Show what explainPhotoOutcome says. The one file in media/ that touches the screen. */
export function showPhotoOutcome(outcome: PhotoSendOutcome, t: TFunction): void {
  const notice = explainPhotoOutcome(outcome)
  if (!notice) return
  if (notice.kind === 'toast') {
    Toast.show({ type: ToastType.Error, text1: t(notice.text) })
    return
  }
  Alert.alert(t(notice.title), t(notice.text), [
    { text: t('Global.Cancel'), style: 'cancel' },
    { text: t('Chat.OpenSettings'), onPress: () => void Linking.openSettings() },
  ])
}
