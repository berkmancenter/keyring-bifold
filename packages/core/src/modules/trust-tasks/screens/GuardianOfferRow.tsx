/**
 * "Offer to be {{name}}'s approver", on a contact's page (row G, frames G1/G2/G6): a guardian holding a state Guardian
 * card offers to approve for this contact, with the card attached (guardianOffer.ts). The contact's phone checks the
 * card and asks them; this row says where the offer stands.
 *
 * Shown only with guardian offers on (which needs trusted approvers and state-verified approvers on too), a Guardian
 * card held on this phone, and this phone linked to its own agent: the yes names this phone's DID on that agent.
 *
 * Send offer is an owner act (Face ID, `vtaAgent.acceptAsApprover`) before anything goes: it is the guardian's yes to
 * approving, and to sending the card. "Changes who approves" is always in the offer, as in every ask.
 *
 * What the row says, by guardianOfferStatus: waiting; accepted ("Your Guardian card: sent"); not accepted (a no and a
 * lapse read the same, on purpose); couldn't check, the same words whatever failed: the contact's phone never says why
 * (guardianOfferSpec.ts).
 *
 * @module trust-tasks/screens/GuardianOfferRow
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoleAction } from '../approverRole'
import { cardToShare } from '../guardianEvidence'
import {
  ALWAYS_OFFERED,
  guardianOfferEvents,
  guardianOfferStatus,
  guardianOffersSent,
  offerAsGuardian,
  type GuardianOfferSent,
} from '../guardianOffer'
import { isGuardianOffersOn } from '../module/guardianOffersFlag'
import { releaseWarn } from '../module/releaseLog'
import { vtaAgent } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'
import { DemoPill } from '../components/DemoPill'

export const GuardianOfferRowIds = {
  row: 'GuardianOffer',
  offer: 'GuardianOfferButton',
  pick: (action: RoleAction) => `GuardianOfferPick_${action}`,
  card: 'GuardianOfferCard',
  cardDemo: 'GuardianOfferCardDemo',
  send: 'GuardianOfferSend',
  cancel: 'GuardianOfferCancel',
  status: 'GuardianOfferStatus',
  detail: 'GuardianOfferDetail',
  sentPill: 'GuardianOfferSentPill',
  actions: 'GuardianOfferActions',
  again: 'GuardianOfferAgain',
  error: 'GuardianOfferError',
} as const

/** The order the choice shows them in (the ask's, ApproverAskRow). */
const PICK_ORDER: RoleAction[] = ['joinCommunity', 'shareCredential', 'addDevice', 'changeApprovers']

type HeldCard = Awaited<ReturnType<typeof cardToShare>>

interface Props {
  connectionId: string | null
  /** The contact's name, as the page shows it. */
  name: string
}

const GuardianOfferRow: React.FC<Props> = ({ connectionId, name }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')
  const on = isGuardianOffersOn()
  const [card, setCard] = useState<HeldCard>()
  const [sent, setSent] = useState<GuardianOfferSent | undefined>()
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState<RoleAction[]>([...PICK_ORDER])
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | undefined>()

  const load = useCallback(async () => {
    if (!agent || !connectionId) return
    setCard(await cardToShare(agent).catch(() => undefined))
    const all = await guardianOffersSent(agent).catch(() => [] as GuardianOfferSent[])
    setSent(all.find((offer) => offer.connectionId === connectionId))
  }, [agent, connectionId])

  useEffect(() => {
    if (!on) return
    void load()
    const refresh = (event: { connectionId?: string }) => {
      if (event?.connectionId === connectionId) void load()
    }
    guardianOfferEvents.on('sent', refresh)
    return () => {
      guardianOfferEvents.off('sent', refresh)
    }
  }, [on, load, connectionId])

  const words = { name, interpolation: { escapeValue: false } }

  const send = useCallback(async () => {
    if (!agent || !connectionId || busy) return
    setSaid(undefined)
    setBusy(true)
    try {
      const approverDid = await vtaAgent.acceptAsApprover(agent, t('GuardianOffer.SendReason', words))
      const result = await offerAsGuardian(agent, connectionId, [...new Set([...chosen, ALWAYS_OFFERED])], approverDid)
      releaseWarn(`[VTI] guardian offer: ${result}`)
      if (result === 'noRelationship') setSaid(t('Approver.NoRelationship', words))
      else if (result !== 'sent') setSaid(t('GuardianOffer.NotSent', words))
      else setPicking(false)
      await load()
    } catch (error) {
      releaseWarn(`[VTI] guardian offer not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`)
      // Cancelled at Face ID: the person chose not to, so nothing failed and nothing went.
      if (!(error instanceof OwnerNotConfirmed && error.reason === 'cancelled'))
        setSaid(t('GuardianOffer.NotSent', words))
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, connectionId, busy, chosen, load, t, name])

  if (!on || !linked || !connectionId || !card) return null

  const styles = StyleSheet.create({
    row: { gap: 8 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    grow: { flex: 1, gap: 2 },
    line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    pill: {
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
    },
  })
  const actionLines = (actions: readonly RoleAction[]) => (
    <View testID={testIdWithKey(GuardianOfferRowIds.actions)}>
      {PICK_ORDER.filter((action) => actions.includes(action)).map((action) => (
        <ThemedText key={action}>{`• ${t(`Approver.Action.${action}`)}`}</ThemedText>
      ))}
    </View>
  )
  const startPicking = () => {
    setSaid(undefined)
    setChosen([...PICK_ORDER])
    setPicking(true)
  }
  const offerButton = (key: 'GuardianOffer.OfferButton' | 'GuardianOffer.OfferAgain', id: string) => (
    <Button
      title={t(key, words)}
      buttonType={key === 'GuardianOffer.OfferButton' ? ButtonType.Secondary : ButtonType.Tertiary}
      onPress={startPicking}
      disabled={busy}
      testID={testIdWithKey(id)}
    />
  )
  const status = sent ? guardianOfferStatus(sent) : undefined

  let body: React.ReactNode
  if (picking) {
    // G1: what the guardian would approve, and what goes with the offer.
    body = (
      <View style={styles.card}>
        <ThemedText variant="bold">{t('GuardianOffer.SheetTitle', words)}</ThemedText>
        <ThemedText style={styles.muted}>{t('GuardianOffer.YoudApprove')}</ThemedText>
        {PICK_ORDER.map((action) => {
          const locked = action === ALWAYS_OFFERED
          const value = locked || chosen.includes(action)
          return (
            <Pressable
              key={action}
              style={styles.pick}
              onPress={() =>
                setChosen((now) => (now.includes(action) ? now.filter((a) => a !== action) : [...now, action]))
              }
              disabled={locked || busy}
              accessibilityRole="switch"
              accessibilityLabel={t(`Approver.Action.${action}`)}
              accessibilityState={{ checked: value, disabled: locked || busy }}
              testID={testIdWithKey(GuardianOfferRowIds.pick(action))}
            >
              <View style={styles.grow}>
                <ThemedText>{t(`Approver.Action.${action}`)}</ThemedText>
                {locked ? <ThemedText style={styles.muted}>{t('GuardianOffer.AlwaysOn')}</ThemedText> : null}
              </View>
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Switch value={value} disabled={locked || busy} />
              </View>
            </Pressable>
          )
        })}
        <View style={styles.line} testID={testIdWithKey(GuardianOfferRowIds.card)}>
          <ThemedText style={styles.muted}>
            {card.state
              ? t('GuardianOffer.SentWith', { state: card.state, interpolation: { escapeValue: false } })
              : t('GuardianOffer.SentWithNoState')}
          </ThemedText>
          {card.state && card.demo ? (
            <DemoPill testID={GuardianOfferRowIds.cardDemo} test={card.test === true} />
          ) : null}
        </View>
        <Button
          title={t('GuardianOffer.Send')}
          buttonType={ButtonType.Primary}
          onPress={() => void send()}
          disabled={busy}
          testID={testIdWithKey(GuardianOfferRowIds.send)}
        >
          {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
        </Button>
        <Button
          title={t('Global.Cancel')}
          buttonType={ButtonType.Tertiary}
          onPress={() => setPicking(false)}
          disabled={busy}
          testID={testIdWithKey(GuardianOfferRowIds.cancel)}
        />
      </View>
    )
  } else if (sent && status === 'waiting') {
    // G2: sent, waiting.
    body = (
      <View style={styles.card}>
        <View style={styles.line}>
          <ThemedText variant="bold" testID={testIdWithKey(GuardianOfferRowIds.status)}>
            {t('GuardianOffer.Waiting', words)}
          </ThemedText>
          <View style={styles.pill} testID={testIdWithKey(GuardianOfferRowIds.sentPill)}>
            <ThemedText style={styles.muted}>{t('GuardianOffer.SentPill')}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.muted}>{t('GuardianOffer.WaitingBody', words)}</ThemedText>
        {actionLines(sent.actions)}
      </View>
    )
  } else if (sent && status === 'accepted') {
    body = (
      <View style={styles.card}>
        <ThemedText variant="bold" testID={testIdWithKey(GuardianOfferRowIds.status)}>
          {t('GuardianOffer.Accepted', words)}
        </ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey(GuardianOfferRowIds.detail)}>
          {t('GuardianOffer.CardSent')}
        </ThemedText>
      </View>
    )
  } else if (sent && (status === 'notAccepted' || status === 'unverifiable')) {
    // G6: a no and a lapse read the same; a card not checked reads the same whatever failed.
    const [title, detail] =
      status === 'unverifiable'
        ? ['GuardianOffer.Unverifiable', 'GuardianOffer.UnverifiableBody']
        : ['GuardianOffer.NotAccepted', 'GuardianOffer.NotAcceptedBody']
    body = (
      <View style={styles.card}>
        <ThemedText variant="bold" testID={testIdWithKey(GuardianOfferRowIds.status)}>
          {t(title, words)}
        </ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey(GuardianOfferRowIds.detail)}>
          {t(detail, words)}
        </ThemedText>
        {offerButton('GuardianOffer.OfferAgain', GuardianOfferRowIds.again)}
      </View>
    )
  } else {
    body = (
      <View style={styles.card}>
        {offerButton('GuardianOffer.OfferButton', GuardianOfferRowIds.offer)}
        <ThemedText style={styles.muted}>{t('GuardianOffer.OfferCaption', words)}</ThemedText>
      </View>
    )
  }

  return (
    <View style={styles.row} testID={testIdWithKey(GuardianOfferRowIds.row)}>
      <ThemedText variant="bold" accessibilityRole="header">
        {t('GuardianOffer.RowTitle')}
      </ThemedText>
      {body}
      {said ? (
        <ThemedText style={styles.error} testID={testIdWithKey(GuardianOfferRowIds.error)}>
          {said}
        </ThemedText>
      ) : null}
    </View>
  )
}

export default GuardianOfferRow
