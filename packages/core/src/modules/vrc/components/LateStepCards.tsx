/**
 * What a person sees when a remote VRC step arrives late (IN-448; lateStep.ts): the inviter asked before it goes
 * on, the ready-check while it is out, the other phone asked if it is ready, and the waiting side with its age and
 * a way out. Presentational only: the Chat overlay, the global sheet and the render harness all mount these.
 *
 * @module vrc/components/LateStepCards
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { minutesOf, type HeldStep } from '../lateStep'

const styles = StyleSheet.create({
  card: { gap: 14, alignSelf: 'stretch' },
  centered: { textAlign: 'center' },
  spinner: { alignSelf: 'center' },
})

/** "Face ID" or "your fingerprint", in the person's language. */
function useUnlockWord(): string {
  const { t } = useTranslation()
  return Platform.OS === 'ios' ? t('LateStep.UnlockIos') : t('LateStep.UnlockAndroid')
}

/** The inviter, or a proposer whose acceptance came late: asked before anything is sent or signed. */
export const LateStepHeldCard: React.FC<{
  name: string
  held: HeldStep
  now: number
  onCheck: () => void
  onNotNow: () => void
  onStop: () => void
  busy?: boolean
  /** The text colour on a fixed light card (the Chat overlay); the theme's when left out. */
  textColor?: string
}> = ({ name, held, now, onCheck, onNotNow, onStop, busy, textColor }) => {
  const { t } = useTranslation()
  const unlock = useUnlockWord()
  const opts = { name, interpolation: { escapeValue: false } }
  const tone = textColor ? { color: textColor } : undefined
  if (held.phase === 'asking' && held.check) {
    const age = now - held.check.sentAt
    return (
      <View style={styles.card} testID={testIdWithKey('LateStepAsking')}>
        <ThemedText variant="headingThree" style={[styles.centered, tone]}>
          {t('LateStep.AskingTitle', opts)}
        </ThemedText>
        <ThemedText style={[styles.centered, tone]}>{t('LateStep.AskingBody', opts)}</ThemedText>
        <ThemedText variant="labelSubtitle" style={[styles.centered, tone]}>
          {age < 60_000
            ? t('LateStep.AskedSeconds', { seconds: Math.max(1, Math.round(age / 1000)) })
            : t('LateStep.AskedMinutes', { minutes: minutesOf(age) })}
        </ThemedText>
        <Button
          title={t('LateStep.StopForNow')}
          accessibilityLabel={t('LateStep.StopForNow')}
          testID={testIdWithKey('LateStepStopForNow')}
          buttonType={ButtonType.Secondary}
          onPress={onStop}
        />
      </View>
    )
  }
  const title = held.reason === 'accepted' ? 'LateStep.HeldTitleAccepted' : 'LateStep.HeldTitleConnected'
  return (
    <View style={styles.card} testID={testIdWithKey('LateStepHeld')}>
      <ThemedText variant="headingThree" style={tone}>
        {t(title, { ...opts, minutes: minutesOf(held.waitedMs) })}
      </ThemedText>
      {held.note === 'notNow' && <ThemedText style={tone}>{t('LateStep.NotReady', opts)}</ThemedText>}
      {held.note === 'lateReady' && <ThemedText style={tone}>{t('LateStep.LateReady', opts)}</ThemedText>}
      <ThemedText style={tone}>{t('LateStep.HeldBody', { unlock, interpolation: { escapeValue: false } })}</ThemedText>
      <Button
        title={t('LateStep.CheckReady', opts)}
        accessibilityLabel={t('LateStep.CheckReady', opts)}
        testID={testIdWithKey('LateStepCheckReady')}
        buttonType={ButtonType.Primary}
        onPress={onCheck}
        disabled={busy}
      />
      <Button
        title={t('LateStep.NotNow')}
        accessibilityLabel={t('LateStep.NotNow')}
        testID={testIdWithKey('LateStepNotNow')}
        buttonType={ButtonType.Secondary}
        onPress={onNotNow}
      />
      <ThemedText variant="labelSubtitle" style={tone}>
        {t('LateStep.NotNowNote')}
      </ThemedText>
    </View>
  )
}

/** The other phone, asked by a ready-check. */
export const PeerReadyCard: React.FC<{
  name: string
  waitedMs: number
  onReady: () => void
  onNotNow: () => void
  busy?: boolean
  textColor?: string
}> = ({ name, waitedMs, onReady, onNotNow, busy, textColor }) => {
  const { t } = useTranslation()
  const unlock = useUnlockWord()
  const opts = { name, interpolation: { escapeValue: false } }
  const tone = textColor ? { color: textColor } : undefined
  return (
    <View style={styles.card} testID={testIdWithKey('LateStepPeerAsked')}>
      <ThemedText variant="headingThree" style={tone}>
        {t('LateStep.PeerTitle', opts)}
      </ThemedText>
      <ThemedText style={tone}>
        {t('LateStep.PeerBody', { minutes: minutesOf(waitedMs), unlock, interpolation: { escapeValue: false } })}
      </ThemedText>
      <Button
        title={t('LateStep.ImReady')}
        accessibilityLabel={t('LateStep.ImReady')}
        testID={testIdWithKey('LateStepImReady')}
        buttonType={ButtonType.Primary}
        onPress={onReady}
        disabled={busy}
      />
      <Button
        title={t('LateStep.NotNow')}
        accessibilityLabel={t('LateStep.NotNow')}
        testID={testIdWithKey('LateStepPeerNotNow')}
        buttonType={ButtonType.Secondary}
        onPress={onNotNow}
        disabled={busy}
      />
      <ThemedText variant="labelSubtitle" style={tone}>
        {t('LateStep.PeerNotNowNote', opts)}
      </ThemedText>
    </View>
  )
}

/** The side waiting on the other phone: how long, and a way out. */
export const WaitingSinceCard: React.FC<{
  name: string
  since?: number
  now: number
  onWait: () => void
  onStop: () => void
  textColor?: string
}> = ({ name, since, now, onWait, onStop, textColor }) => {
  const { t } = useTranslation()
  const opts = { name, interpolation: { escapeValue: false } }
  const tone = textColor ? { color: textColor } : undefined
  return (
    <View style={styles.card} testID={testIdWithKey('LateStepWaiting')}>
      <ThemedText variant="headingThree" style={tone}>
        {t('Relationship.WaitingForAnswer', opts)}
      </ThemedText>
      {since !== undefined && (
        <ThemedText style={tone}>{t('LateStep.WaitingSince', { ...opts, minutes: minutesOf(now - since) })}</ThemedText>
      )}
      <Button
        title={t('LateStep.WaitInBackground')}
        accessibilityLabel={t('LateStep.WaitInBackground')}
        testID={testIdWithKey('LateStepWaitInBackground')}
        buttonType={ButtonType.Primary}
        onPress={onWait}
      />
      <Button
        title={t('LateStep.StopExchange')}
        accessibilityLabel={t('LateStep.StopExchange')}
        testID={testIdWithKey('LateStepStopExchange')}
        buttonType={ButtonType.Secondary}
        onPress={onStop}
      />
      <ThemedText variant="labelSubtitle" style={tone}>
        {t('LateStep.StopNote', opts)}
      </ThemedText>
    </View>
  )
}
