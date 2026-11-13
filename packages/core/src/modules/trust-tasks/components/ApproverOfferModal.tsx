/**
 * "Be an approver for {{asker}}?" — the asked phone's half of the role offer (approverRole.ts). Shown when a contact's
 * offer arrives, verified under the relationship this phone has with them; never one that failed that check.
 *
 * Accept asks for Face ID first (an owner act, as Approve on a request is): not confirmed, nothing is sent and the offer
 * stays. Then it names the DID this phone approves as, its manager DID on its own linked agent (`vtaAgent.approverDid`), so a yes
 * needs this phone linked; without that only No and Not now are offered, and it says why. No sends a signed no.
 * Not now sends nothing and hides the offer until the app starts again (it is kept, and comes back then).
 *
 * With state-verified approvers on and a state Guardian card held, the offer itself carries "Also send my Guardian
 * card" as a switch, on by default (Alberto's pick Q6, 2026-11-13: the card folds into Accept, not a second sheet). A
 * kept no for this contact shows it off. Accept keeps the switch's answer (cardConsents, guardianEvidence.ts) once Face
 * ID is confirmed and before the yes is sent, so the yes then sends the card or doesn't, and asks nothing more. No and
 * Not now keep nothing. If keeping the answer fails, the yes still goes and the card falls back to the question below.
 *
 * After a yes, if this phone holds a state Guardian card and its person was never asked about this contact (a yes from
 * a build before the switch, or one whose answer was not kept), the same sheet asks once: "Also send your Guardian card
 * to <asker>?". Send keeps the answer and sends the card; Don't send keeps a no, and nothing goes. The yes already
 * stands either way.
 *
 * On the asking phone, the same sheet then prompts to add a contact whose yes landed (ApproverAddSheet.tsx, Q4 (a)):
 * after an open offer and a card question, so one sheet shows at a time.
 *
 * Self-contained: mounted once at the root beside ContinuityCheckModal. With the trusted-approvers switch off it shows
 * nothing and brings nothing back; with state-verified approvers off it asks nothing about a card.
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
import {
  approverRoleEvents,
  respondToRoleOffer,
  restoreRoleOfferPrompts,
  roleOfferPromptStore,
  type RoleOfferPrompt,
} from '../approverRole'
import {
  cardConsentOn,
  cardQuestions,
  cardToShare,
  guardianCardEvents,
  setCardConsent,
  shareGuardianCard,
  type CardQuestion,
} from '../guardianEvidence'
import { ApproverAddBody, useApproverToAdd } from './ApproverAddSheet'
import { DemoPill } from './DemoPill'
import { releaseWarn } from '../module/releaseLog'
import { ownerLockKind, type OwnerLockKind } from '../module/ownerConfirm'
import { isStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'

export const ApproverOfferIds = {
  sheet: 'ApproverOffer',
  body: 'ApproverOfferBody',
  yes: 'ApproverOfferYes',
  no: 'ApproverOfferNo',
  notNow: 'ApproverOfferNotNow',
  needsAgent: 'ApproverOfferNeedsAgent',
  failed: 'ApproverOfferFailed',
  faceId: 'ApproverOfferFaceId',
  cardAsk: 'ApproverOfferCardAsk',
  cardAskDemo: 'ApproverOfferCardAskDemo',
  cardSend: 'ApproverOfferCardSend',
  cardDont: 'ApproverOfferCardDont',
  cardSwitch: 'ApproverOfferCardSwitch',
  cardSwitchDemo: 'ApproverOfferCardSwitchDemo',
} as const

type ShareableCard = NonNullable<Awaited<ReturnType<typeof cardToShare>>>

/** Offers put off with Not now, by connection, until the app starts again. */
const putOff = new Set<string>()

/** Tests only. */
export const resetPutOff = () => putOff.clear()

const firstShown = () => roleOfferPromptStore.list().find((prompt) => prompt.open && !putOff.has(prompt.connectionId))

const ApproverOfferModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const on = isTrustedApproversEnabled()
  const [prompt, setPrompt] = useState<RoleOfferPrompt | undefined>(() => (on ? firstShown() : undefined))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // The person's own lock, named as VtaCreateAgent names it: not everyone has Face ID.
  const [lockKind, setLockKind] = useState<OwnerLockKind>('unknown')
  useEffect(() => {
    let live = true
    void ownerLockKind().then((kind) => live && setLockKind(kind))
    return () => {
      live = false
    }
  }, [])
  const [question, setQuestion] = useState<CardQuestion | undefined>(() => (on ? cardQuestions.first() : undefined))
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')
  // The card this phone could send with the yes, for the offer on screen, read again for each offer; none (no card, or
  // either switch off: cardToShare says so), no switch.
  const [withCard, setWithCard] = useState<{ card: ShareableCard; send: boolean }>()
  const offerId = prompt?.connectionId
  const { pending: toAdd, refresh: refreshToAdd } = useApproverToAdd(on, linked)
  useEffect(() => {
    setWithCard(undefined)
    if (!agent || !on || !offerId) return
    let live = true
    void (async () => {
      const card = await cardToShare(agent)
      if (!card) return
      const kept = await cardConsentOn(agent, offerId)
      if (live) setWithCard({ card, send: kept !== 'no' })
    })().catch((error: unknown) =>
      releaseWarn(`[VTI] guardian card for the offer not read (${(error as Error)?.name ?? 'error'})`)
    )
    return () => {
      live = false
    }
  }, [agent, on, offerId])

  useEffect(() => {
    if (!agent || !on) return
    restoreRoleOfferPrompts(agent).catch((error: unknown) =>
      releaseWarn(`[VTI] approver offers not brought back: ${(error as Error)?.message ?? error}`)
    )
  }, [agent, on])

  useEffect(() => {
    if (!on) return
    const ask = () => setQuestion(cardQuestions.first())
    guardianCardEvents.on('question', ask)
    return () => {
      guardianCardEvents.off('question', ask)
    }
  }, [on])

  const share = useCallback(
    async (send: boolean) => {
      if (!agent || !question || busy) return
      setBusy(true)
      try {
        await shareGuardianCard(agent, question.connectionId, send)
        releaseWarn(`[VTI] guardian card answer: ${send ? 'send' : "don't send"}`)
      } catch (error) {
        releaseWarn(`[VTI] guardian card answer not kept (${(error as Error)?.name ?? 'error'})`)
      } finally {
        setBusy(false)
        setQuestion(cardQuestions.first())
      }
    },
    [agent, question, busy]
  )

  useEffect(() => {
    if (!on) return
    const refresh = () => setPrompt(firstShown())
    approverRoleEvents.on('offer', refresh)
    approverRoleEvents.on('promptCleared', refresh)
    return () => {
      approverRoleEvents.off('offer', refresh)
      approverRoleEvents.off('promptCleared', refresh)
    }
  }, [on])

  const answer = useCallback(
    async (accept: boolean) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      setFailed(false)
      try {
        const approverDid = accept
          ? await vtaAgent.acceptAsApprover(
              agent,
              t('Approver.AcceptReason', {
                asker: prompt.asker || t('Approver.UnnamedContact'),
                interpolation: { escapeValue: false },
              })
            )
          : undefined
        // Face ID confirmed: the card switch's answer is kept first, so the yes below sends the card or doesn't.
        if (accept && withCard)
          await setCardConsent(agent, prompt.connectionId, withCard.send ? 'yes' : 'no').catch((error: unknown) =>
            releaseWarn(`[VTI] guardian card answer not kept with the yes (${(error as Error)?.name ?? 'error'})`)
          )
        await respondToRoleOffer(agent, prompt.connectionId, accept, approverDid)
        releaseWarn(`[VTI] approver offer answered: ${accept ? 'yes' : 'no'}`)
      } catch (error) {
        releaseWarn(
          `[VTI] approver answer not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`
        )
        // Cancelled at Face ID: the person chose not to, so nothing failed; the offer simply stays.
        if (!(error instanceof OwnerNotConfirmed && error.reason === 'cancelled')) setFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [agent, prompt, busy, t, withCard]
  )

  const notNow = useCallback(() => {
    if (!prompt) return
    putOff.add(prompt.connectionId)
    setFailed(false)
    setPrompt(firstShown())
  }, [prompt])

  // An offer comes first; a card question shows when no offer is open, and only with state-verified approvers on.
  const asking = !prompt && question && isStateVerifiedApproversEnabled() ? question : undefined
  // Then, on the asking phone, a contact's yes to add (Q4 (a)).
  const adding = !prompt && !asking ? toAdd : undefined
  if (!on || (!prompt && !asking && !adding)) return null

  const words = {
    asker: prompt?.asker || t('Approver.UnnamedContact'),
    interpolation: { escapeValue: false },
  }
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
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error, textAlign: 'center' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    grow: { flex: 1, gap: 2 },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.container}
            testID={testIdWithKey(ApproverOfferIds.sheet)}
          >
            {adding ? <ApproverAddBody pending={adding} lockKind={lockKind} onDone={refreshToAdd} /> : null}
            {asking ? (
              <>
                <ThemedText
                  variant="headingThree"
                  style={styles.centred}
                  accessibilityRole="header"
                  testID={testIdWithKey(ApproverOfferIds.cardAsk)}
                >
                  {asking.state
                    ? t('Approver.CardAskTitle', {
                        state: asking.state,
                        asker: asking.asker || t('Approver.UnnamedContact'),
                        interpolation: { escapeValue: false },
                      })
                    : t('Approver.CardAskTitleNoState', {
                        asker: asking.asker || t('Approver.UnnamedContact'),
                        interpolation: { escapeValue: false },
                      })}
                </ThemedText>
                {asking.state && asking.demo ? (
                  <DemoPill testID={ApproverOfferIds.cardAskDemo} test={asking.test === true} />
                ) : null}
                <ThemedText>
                  {t('Approver.CardAskBody', {
                    asker: asking.asker || t('Approver.UnnamedContact'),
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
                <Button
                  title={t('Approver.CardAskSend')}
                  buttonType={ButtonType.Primary}
                  onPress={() => void share(true)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.cardSend)}
                />
                <Button
                  title={t('Approver.CardAskDont')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => void share(false)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.cardDont)}
                />
              </>
            ) : null}
            {prompt ? (
              <>
                <ThemedText variant="headingThree" style={styles.centred} accessibilityRole="header">
                  {t('Approver.OfferTitle', words)}
                </ThemedText>
                <ThemedText testID={testIdWithKey(ApproverOfferIds.body)}>{t('Approver.OfferBody', words)}</ThemedText>
                {prompt?.actions.map((action) => (
                  <ThemedText key={action}>• {t(`Approver.Action.${action}`)}</ThemedText>
                ))}
                <ThemedText style={styles.muted}>{t('Approver.OfferHow')}</ThemedText>
                {withCard ? (
                  <Pressable
                    style={styles.cardRow}
                    onPress={() => setWithCard({ ...withCard, send: !withCard.send })}
                    disabled={busy}
                    accessibilityRole="switch"
                    accessibilityLabel={
                      withCard.card.state
                        ? t('Approver.OfferCardSend', {
                            state: withCard.card.state,
                            interpolation: { escapeValue: false },
                          })
                        : t('Approver.OfferCardSendNoState')
                    }
                    accessibilityHint={t('Approver.OfferCardNote', words)}
                    accessibilityState={{ checked: withCard.send, disabled: busy }}
                    testID={testIdWithKey(ApproverOfferIds.cardSwitch)}
                  >
                    <View style={styles.grow}>
                      <ThemedText>
                        {withCard.card.state
                          ? t('Approver.OfferCardSend', {
                              state: withCard.card.state,
                              interpolation: { escapeValue: false },
                            })
                          : t('Approver.OfferCardSendNoState')}
                      </ThemedText>
                      {withCard.card.state && withCard.card.demo ? (
                        <DemoPill testID={ApproverOfferIds.cardSwitchDemo} test={withCard.card.test === true} />
                      ) : null}
                      <ThemedText style={styles.muted}>{t('Approver.OfferCardNote', words)}</ThemedText>
                    </View>
                    {/* Shown, never pressed: the row takes the press (as on ApproverAskRow). */}
                    <View
                      pointerEvents="none"
                      importantForAccessibility="no-hide-descendants"
                      accessibilityElementsHidden
                    >
                      <Switch value={withCard.send} disabled={busy} />
                    </View>
                  </Pressable>
                ) : null}
                {!linked ? (
                  <ThemedText style={styles.muted} testID={testIdWithKey(ApproverOfferIds.needsAgent)}>
                    {t('Approver.OfferNeedsAgent')}
                  </ThemedText>
                ) : null}
                {failed ? (
                  <ThemedText style={styles.error} testID={testIdWithKey(ApproverOfferIds.failed)}>
                    {t('Approver.OfferFailed')}
                  </ThemedText>
                ) : null}
                <Button
                  title={t('Approver.OfferYes')}
                  buttonType={ButtonType.Primary}
                  onPress={() => void answer(true)}
                  disabled={busy || !linked}
                  testID={testIdWithKey(ApproverOfferIds.yes)}
                />
                <Button
                  title={t('Approver.OfferNo')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => void answer(false)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.no)}
                />
                <Button
                  title={t('Approver.OfferNotNow')}
                  buttonType={ButtonType.Tertiary}
                  onPress={notNow}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.notNow)}
                />
                <ThemedText style={[styles.muted, styles.centred]} testID={testIdWithKey(ApproverOfferIds.faceId)}>
                  {t('Approver.AcceptAsksLock', { method: t(`CreateAgent.Lock.${lockKind}`) })}
                </ThemedText>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default ApproverOfferModal
