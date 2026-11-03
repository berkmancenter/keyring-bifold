/**
 * Before a remote VRC starts: ask a person whose phone could be woken to turn notifications on (IN-448).
 *
 * The other person's steps reach a phone while Keyring is closed only through a push, and a phone is wakeable
 * only when the build has push (`enablePushNotifications`), the phone is linked to an agent, and notifications
 * are allowed. So this asks only where turning them on actually makes the phone wakeable: push in the build, an
 * agent linked, permission not yet given. Anyone else is told Keyring has to stay open on both phones instead.
 *
 * "Turn on" asks for the permission and, once given, makes the phone wakeable (the app's toggle: the gateway, the
 * agent's set-wake, the mediator's device info). "Not now" puts it away for this run of the app.
 *
 * @module vrc/components/RemoteVrcNotificationsAsk
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { TOKENS, useServices } from '../../../container-api'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../../trust-tasks/module/vtaAgent'

/** Put away for this run of the app ("Not now", or done). */
let putAway = false

/** For tests. */
export function resetRemoteVrcNotificationsAsk(): void {
  putAway = false
}

type Ask = 'checking' | 'ask' | 'denied' | 'hidden'

const RemoteVrcNotificationsAsk: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [{ enablePushNotifications }] = useServices([TOKENS.CONFIG])
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')
  const [ask, setAsk] = useState<Ask>(putAway ? 'hidden' : 'checking')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (putAway || !enablePushNotifications || !linked) {
      setAsk('hidden')
      return
    }
    let live = true
    enablePushNotifications
      .status()
      .then((status) => live && setAsk(status === 'granted' ? 'hidden' : 'ask'))
      .catch(() => live && setAsk('hidden'))
    return () => {
      live = false
    }
  }, [enablePushNotifications, linked])

  if (ask === 'hidden' || ask === 'checking' || !enablePushNotifications) return null

  const turnOn = async () => {
    if (busy || !agent) return
    setBusy(true)
    try {
      const status = await enablePushNotifications.setup()
      if (status !== 'granted') {
        setAsk('denied')
        return
      }
      await enablePushNotifications.toggle(true, agent)
      putAway = true
      setAsk('hidden')
    } catch (e) {
      agent.config.logger.warn(`[VRC] notifications for a remote exchange not turned on: ${(e as Error).message}`)
      setAsk('denied')
    } finally {
      setBusy(false)
    }
  }
  const notNow = () => {
    putAway = true
    setAsk('hidden')
  }

  const styles = StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      gap: 12,
      padding: 16,
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
  })

  return (
    <View style={styles.card} testID={testIdWithKey('RemoteVrcNotificationsAsk')}>
      <ThemedText>{ask === 'denied' ? t('RemoteVrcNotify.Denied') : t('RemoteVrcNotify.Ask')}</ThemedText>
      {ask === 'ask' && (
        <Button
          title={t('RemoteVrcNotify.TurnOn')}
          accessibilityLabel={t('RemoteVrcNotify.TurnOn')}
          testID={testIdWithKey('RemoteVrcNotificationsTurnOn')}
          buttonType={ButtonType.Primary}
          onPress={() => void turnOn()}
          disabled={busy}
        />
      )}
      <Button
        title={ask === 'denied' ? t('Global.Dismiss') : t('RemoteVrcNotify.NotNow')}
        accessibilityLabel={ask === 'denied' ? t('Global.Dismiss') : t('RemoteVrcNotify.NotNow')}
        testID={testIdWithKey('RemoteVrcNotificationsNotNow')}
        buttonType={ButtonType.Secondary}
        onPress={notNow}
      />
    </View>
  )
}

export default RemoteVrcNotificationsAsk
