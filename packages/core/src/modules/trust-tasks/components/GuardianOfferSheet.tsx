/**
 * "{{guardian}} offered to be your approver": the person's half of a guardian offer (guardianOffer.ts; row G, and the
 * research doc's first mock). Shown only for an offer whose Guardian card this phone checked against its own ward and
 * found valid; never one that failed, and never one still waiting on a state that could not be reached.
 *
 * The person can untick what the guardian offered, never add to it; "changes who approves" stays on, as in every ask.
 * The line about removing them later is the safeguard and stays word for word (2026-11-16-al.md §5): it is true today
 * because changing who approves needs the approvers' yes.
 *
 * Accept asks for Face ID first (an owner act), then sends this phone's ordinary ask for the person's own agent; the
 * guardian's phone answers yes to it without asking again, and the person then adds them under Who approves, as for
 * any yes (a second owner act there). It needs this phone linked to its agent: without one only Decline and Not now
 * are offered, and it says why. Decline sends nothing (the guardian cannot tell a no from a lapse). Not now hides the
 * offer until the app starts again.
 *
 * Self-contained: mounted once at the root beside ApproverOfferModal. With guardian offers off it shows nothing and
 * brings nothing back.
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoleAction } from '../approverRole'
import {
  ALWAYS_OFFERED,
  acceptGuardianOffer,
  declineGuardianOffer,
  guardianOfferEvents,
  guardianOfferPrompts,
  restoreGuardianOffers,
  type GuardianOfferPrompt,
} from '../guardianOffer'
import { DemoPill } from './DemoPill'
import { isGuardianOffersOn } from '../module/guardianOffersFlag'
import { ownerLockKind, type OwnerLockKind } from '../module/ownerConfirm'
import { releaseWarn } from '../module/releaseLog'
import { vtaAgent } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'

export const GuardianOfferSheetIds = {
  sheet: 'GuardianOfferSheet',
  state: 'GuardianOfferSheetState',
  demo: 'GuardianOfferSheetDemo',
  pick: (action: RoleAction) => `GuardianOfferSheetPick_${action}`,
  removing: 'GuardianOfferSheetRemoving',
  accept: 'GuardianOfferSheetAccept',
  decline: 'GuardianOfferSheetDecline',
  notNow: 'GuardianOfferSheetNotNow',
  needsAgent: 'GuardianOfferSheetNeedsAgent',
  failed: 'GuardianOfferSheetFailed',
  faceId: 'GuardianOfferSheetFaceId',
} as const

const PICK_ORDER: RoleAction[] = ['joinCommunity', 'shareCredential', 'addDevice', 'changeApprovers']

/** Offers put off with Not now, by connection, until the app starts again. */
const putOff = new Set<string>()

/** Tests only. */
export const resetGuardianOfferPutOff = () => putOff.clear()

const firstShown = (): GuardianOfferPrompt | undefined =>
  guardianOfferPrompts.list().find((prompt) => !putOff.has(prompt.connectionId))

const GuardianOfferSheet: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const { t, i18n } = useTranslation()
  const on = isGuardianOffersOn()
  const [prompt, setPrompt] = useState<GuardianOfferPrompt | undefined>(() => (on ? firstShown() : undefined))
  const [kept, setKept] = useState<RoleAction[]>(() => prompt?.actions ?? [])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lockKind, setLockKind] = useState<OwnerLockKind>('unknown')
  const vtaDid = useSyncExternalStore(vtaAgent.subscribe, () => {
    const link = vtaAgent.getState().link
    return link.kind === 'linked' ? link.vtaDid : undefined
  })

  useEffect(() => {
    let live = true
    void ownerLockKind().then((kind) => live && setLockKind(kind))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!agent || !on) return
    restoreGuardianOffers(agent).catch((error: unknown) =>
      releaseWarn(`[VTI] guardian offers not brought back: ${(error as Error)?.message ?? error}`)
    )
  }, [agent, on])

  useEffect(() => {
    if (!on) return
    const refresh = () => {
      const next = firstShown()
      setPrompt(next)
      setKept(next?.actions ?? [])
      setFailed(false)
    }
    guardianOfferEvents.on('offer', refresh)
    guardianOfferEvents.on('cleared', refresh)
    return () => {
      guardianOfferEvents.off('offer', refresh)
      guardianOfferEvents.off('cleared', refresh)
    }
  }, [on])

  const guardian = prompt?.guardian || t('Approver.UnnamedContact')
  const words = { guardian, interpolation: { escapeValue: false } }

  const accept = useCallback(async () => {
    if (!agent || !prompt || !vtaDid || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await vtaAgent.confirmGuardianOffer(t('GuardianOffer.AcceptReason', words))
      const result = await acceptGuardianOffer(agent, prompt.connectionId, vtaDid, kept)
      releaseWarn(`[VTI] guardian offer taken up: ${result}`)
      if (result !== 'sent' && result !== 'gone') setFailed(true)
    } catch (error) {
      releaseWarn(`[VTI] guardian offer answer not sent (${(error as Error)?.name ?? 'error'})`)
      if (!(error instanceof OwnerNotConfirmed && error.reason === 'cancelled')) setFailed(true)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, prompt, vtaDid, busy, kept, t, guardian])

  const decline = useCallback(async () => {
    if (!agent || !prompt || busy) return
    setBusy(true)
    try {
      await declineGuardianOffer(agent, prompt.connectionId)
    } catch (error) {
      releaseWarn(`[VTI] guardian offer decline not kept (${(error as Error)?.name ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }, [agent, prompt, busy])

  const notNow = useCallback(() => {
    if (!prompt) return
    putOff.add(prompt.connectionId)
    const next = firstShown()
    setPrompt(next)
    setKept(next?.actions ?? [])
    setFailed(false)
  }, [prompt])

  if (!on || !prompt) return null

  const verdict = prompt.verdict?.ok === true ? prompt.verdict : undefined
  const until = verdict?.expires
    ? new Date(verdict.expires).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
    : undefined
  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    safeAreaView: {
      flexShrink: 1,
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 24, gap: 12 },
    centred: { textAlign: 'center' },
    line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    grow: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error, textAlign: 'center' },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.container}
            testID={testIdWithKey(GuardianOfferSheetIds.sheet)}
          >
            <ThemedText variant="headingThree" style={styles.centred} accessibilityRole="header">
              {t('GuardianOffer.IncomingTitle', words)}
            </ThemedText>
            {verdict ? (
              <View style={styles.line} testID={testIdWithKey(GuardianOfferSheetIds.state)}>
                <ThemedText>
                  {`✓ ${t('GuardianOffer.StateSays', { ...words, state: verdict.state })}`}
                  {until ? ` · ${t('GuardianOffer.Until', { date: until })}` : ''}
                </ThemedText>
                {verdict.demo ? <DemoPill testID={GuardianOfferSheetIds.demo} test={verdict.test === true} /> : null}
              </View>
            ) : null}
            <ThemedText>{t('GuardianOffer.IfYes', words)}</ThemedText>
            {PICK_ORDER.filter((action) => prompt.actions.includes(action)).map((action) => {
              const locked = action === ALWAYS_OFFERED
              const value = locked || kept.includes(action)
              return (
                <Pressable
                  key={action}
                  style={styles.pick}
                  onPress={() =>
                    setKept((now) => (now.includes(action) ? now.filter((a) => a !== action) : [...now, action]))
                  }
                  disabled={locked || busy}
                  accessibilityRole="switch"
                  accessibilityLabel={t(`Approver.Action.${action}`)}
                  accessibilityState={{ checked: value, disabled: locked || busy }}
                  testID={testIdWithKey(GuardianOfferSheetIds.pick(action))}
                >
                  <View style={styles.grow}>
                    <ThemedText>{t(`Approver.Action.${action}`)}</ThemedText>
                    {/* Today's ask says the same of it: offered always, written once there are two approvers or more. */}
                    {locked ? (
                      <ThemedText style={styles.muted}>
                        {t('Approver.AlwaysOn', { name: guardian, interpolation: { escapeValue: false } })}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                  >
                    <Switch value={value} disabled={locked || busy} />
                  </View>
                </Pressable>
              )
            })}
            <ThemedText style={styles.muted}>{t('GuardianOffer.Cant', words)}</ThemedText>
            <ThemedText testID={testIdWithKey(GuardianOfferSheetIds.removing)}>
              {t('GuardianOffer.Removing', words)}
            </ThemedText>
            {!vtaDid ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(GuardianOfferSheetIds.needsAgent)}>
                {t('Approver.OfferNeedsAgent')}
              </ThemedText>
            ) : null}
            {failed ? (
              <ThemedText style={styles.error} testID={testIdWithKey(GuardianOfferSheetIds.failed)}>
                {t('GuardianOffer.Failed')}
              </ThemedText>
            ) : null}
            <Button
              title={t('GuardianOffer.Accept')}
              buttonType={ButtonType.Primary}
              onPress={() => void accept()}
              disabled={busy || !vtaDid}
              testID={testIdWithKey(GuardianOfferSheetIds.accept)}
            />
            <Button
              title={t('GuardianOffer.Decline')}
              buttonType={ButtonType.Secondary}
              onPress={() => void decline()}
              disabled={busy}
              testID={testIdWithKey(GuardianOfferSheetIds.decline)}
            />
            <Button
              title={t('Approver.OfferNotNow')}
              buttonType={ButtonType.Tertiary}
              onPress={notNow}
              disabled={busy}
              testID={testIdWithKey(GuardianOfferSheetIds.notNow)}
            />
            <ThemedText style={[styles.muted, styles.centred]} testID={testIdWithKey(GuardianOfferSheetIds.faceId)}>
              {t('Approver.AcceptAsksLock', {
                method: t(`CreateAgent.Lock.${lockKind}`),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <ThemedText style={[styles.muted, styles.centred]}>{t('GuardianOffer.AcceptNext', words)}</ThemedText>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default GuardianOfferSheet
