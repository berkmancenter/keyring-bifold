/**
 * Connecting with someone from a code they shared (shared-connect,
 * dtgwg-vti-spec#86; keyring-wallet #853 WP3): one screen, in steps.
 *
 *  1. Confirm, from the code alone, read offline: the name they gave, marked
 *     as not checked, or "No name given"; their ID as a short prefix with the
 *     whole of it behind Details; the relay's host; how long the code has
 *     left. Connect and Cancel. Nothing is sent before Connect (VTI-LNK-052).
 *     The name is never the heading: anyone can type any name, so the screen
 *     must not read as "Connect with Your Bank?".
 *  2. Connecting: the expiry is checked again, then the exchange is started
 *     (`sharedConnectStarter`, registered by the code that carries it).
 *  3. How it ended: started, could not start, not in this version, expired.
 *
 * A code that cannot be used says why on its first frame, in the words the
 * scanner uses. Nothing the code carries is logged.
 *
 * @module trust-tasks/screens/SharedConnect
 */
import { useNavigation } from '@react-navigation/native'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  didPrefix,
  readSharedConnect,
  sharedConnectStarter,
  timeLeftWords,
  type SharedConnectOffer,
  type SharedConnectStarter,
} from '../module/sharedConnect'
import { TRIGGER_UI_MESSAGE_KEYS, type TriggerUi } from '../module/triggerLink'

import { DidDetails } from './DidDetails'
import { SharedConnectIds } from './SharedConnect.ids'

const id = (key: string) => testIdWithKey(key)
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** How it ended, or why it never started. */
export type SharedConnectEnd =
  | { kind: 'started' }
  | { kind: 'failed' }
  | { kind: 'notBuilt' }
  | { kind: 'cantUse'; ui: Exclude<TriggerUi, 'pass-on'> }

type Step =
  | { kind: 'confirm'; offer: SharedConnectOffer }
  | { kind: 'connecting'; offer: SharedConnectOffer }
  | { kind: 'ended'; end: SharedConnectEnd }

/** The words for an ending, as a localization key. */
export function sharedConnectEndKey(end: SharedConnectEnd): string {
  switch (end.kind) {
    case 'started':
      return 'SharedConnect.Started'
    case 'failed':
      return 'SharedConnect.Failed'
    case 'notBuilt':
      return 'SharedConnect.NotBuilt'
    case 'cantUse':
      return TRIGGER_UI_MESSAGE_KEYS[end.ui]
  }
}

/** The first step, from the code alone: Confirm, or why the code can't be used. */
function firstStep(link: string | undefined, at: number): Step {
  if (!link) return { kind: 'ended', end: { kind: 'cantUse', ui: 'invalid' } }
  const read = readSharedConnect(link, { now: at })
  if (read.outcome === 'offer') return { kind: 'confirm', offer: read.offer }
  // Off, or a code of another flow: the scanner never sends one here, but say what it would.
  return { kind: 'ended', end: { kind: 'cantUse', ui: read.outcome === 'refuse' ? read.ui : 'update' } }
}

export type SharedConnectFlowProps = {
  link?: string
  /** What Connect starts; by default the registered one. Undefined: "not in this version". */
  start?: SharedConnectStarter | null
  now?: () => number
  onClose: () => void
}

export const SharedConnectFlow: React.FC<SharedConnectFlowProps> = ({ link, start, now = nowSeconds, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [first] = useState(() => firstStep(link, now()))
  const [step, setStep] = useState<Step>(first)
  const [clock, setClock] = useState(now)
  const live = useRef(true)
  // Set by the first press of Connect, before anything else: a second touch in
  // the same frame lands before the step changes, and must not start the
  // exchange again. One code, one start.
  const pressed = useRef(false)

  useEffect(
    () => () => {
      live.current = false
    },
    []
  )

  // The time left, ticking while the person decides.
  useEffect(() => {
    if (step.kind !== 'confirm') return
    const timer = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(timer)
  }, [step.kind, now])

  const expired = step.kind === 'confirm' && clock >= step.offer.exp

  const onConnect = async (offer: SharedConnectOffer) => {
    if (pressed.current) return
    pressed.current = true
    // Checked again here: the code may have run out while the screen was open.
    if (now() >= offer.exp) {
      setStep({ kind: 'ended', end: { kind: 'cantUse', ui: 'expired' } })
      return
    }
    const starter = start === undefined ? sharedConnectStarter() : (start ?? undefined)
    if (!starter) {
      setStep({ kind: 'ended', end: { kind: 'notBuilt' } })
      return
    }
    setStep({ kind: 'connecting', offer })
    try {
      await starter(offer)
      if (live.current) setStep({ kind: 'ended', end: { kind: 'started' } })
    } catch {
      if (live.current) setStep({ kind: 'ended', end: { kind: 'failed' } })
    }
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
        content: { padding: 20, gap: 16, flexGrow: 1 },
        card: {
          backgroundColor: ColorPalette.grayscale.white,
          borderColor: ColorPalette.grayscale.lightGrey,
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          gap: 12,
        },
        row: { gap: 2 },
        muted: { color: ColorPalette.grayscale.mediumGrey },
        actions: { gap: 12 },
        busy: { alignItems: 'center', gap: 12, paddingVertical: 24 },
      }),
    [ColorPalette]
  )

  const row = (label: string, value: string, testID: string, note?: React.ReactNode) => (
    <View style={styles.row}>
      <ThemedText style={styles.muted}>{label}</ThemedText>
      <ThemedText variant="bold" testID={id(testID)}>
        {value}
      </ThemedText>
      {note}
    </View>
  )

  const body = (): React.ReactNode => {
    switch (step.kind) {
      case 'confirm': {
        const { offer } = step
        const left = timeLeftWords(offer.exp - clock)
        return (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.confirm)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SharedConnect.Title')}
            </ThemedText>
            <ThemedText>{t('SharedConnect.Body')}</ThemedText>
            <View style={styles.card}>
              {row(
                t('SharedConnect.NameLabel'),
                offer.label ?? t('SharedConnect.NoName'),
                SharedConnectIds.name,
                offer.label ? (
                  <ThemedText style={styles.muted} testID={id(SharedConnectIds.nameUnverified)}>
                    {t('SharedConnect.NameUnverified')}
                  </ThemedText>
                ) : null
              )}
              {row(t('SharedConnect.IdLabel'), didPrefix(offer.from), SharedConnectIds.did)}
              <DidDetails did={offer.from} testIdStem={SharedConnectIds.did} />
              {row(
                t('SharedConnect.RelayLabel'),
                offer.relayHost ?? t('SharedConnect.NoRelayHost'),
                SharedConnectIds.relay
              )}
              {row(
                t('SharedConnect.ExpiresLabel'),
                left ? t(left.key, { count: left.count }) : t('SharedConnect.ExpiredShort'),
                SharedConnectIds.expires
              )}
            </View>
            {expired ? <ThemedText>{t(TRIGGER_UI_MESSAGE_KEYS.expired)}</ThemedText> : null}
            <View style={styles.actions}>
              <Button
                title={t('SharedConnect.Connect')}
                buttonType={ButtonType.Primary}
                onPress={() => void onConnect(offer)}
                disabled={expired}
                testID={id(SharedConnectIds.connect)}
              />
              <Button
                title={t('SharedConnect.Cancel')}
                buttonType={ButtonType.Secondary}
                onPress={onClose}
                testID={id(SharedConnectIds.cancel)}
              />
            </View>
          </View>
        )
      }
      case 'connecting':
        return (
          <View style={styles.busy} testID={id(SharedConnectIds.connecting)}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText>{t('SharedConnect.Connecting')}</ThemedText>
          </View>
        )
      case 'ended':
        return (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.result)}>
            <ThemedText testID={id(SharedConnectIds.resultMessage)}>{t(sharedConnectEndKey(step.end))}</ThemedText>
            <Button
              title={t('SharedConnect.Done')}
              buttonType={ButtonType.Primary}
              onPress={onClose}
              testID={id(SharedConnectIds.done)}
            />
          </View>
        )
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={id(SharedConnectIds.screen)}>
        {body()}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The screen in the My Agent stack: the code its route carries. Each scan is
 * its own route (MyAgentStack's `getId`), so the code is kept from the first
 * render.
 */
const SharedConnect: React.FC<{ link?: string; route?: { params?: { link?: string } } }> = ({ link, route }) => {
  const navigation = useNavigation()
  const [code] = useState(() => link ?? route?.params?.link)
  return <SharedConnectFlow link={code} onClose={() => navigation.goBack()} />
}

export default SharedConnect
