/**
 * "Add Jordan as your approver" — the asking phone's half after the contact's yes (mock E, Alberto's pick Q4 (a),
 * 2026-11-13): one prompt, once the yes lands, in place of finding Who approves by hand. The yes is kept
 * (approverRole.ts `acceptedRoleOffers`), so a yes that landed while the app was closed shows on the next open.
 *
 * Add reads the agent's rules and writes them with the contact in (`nextTrustedRules`, as Who approves does), through
 * `vtaAgent.setTrustedApprovers`, which asks for Face ID first (`confirmOwner`). There is no silent path: nothing is
 * written on the agent without that confirmation. Cancelled at Face ID: nothing changes and the prompt stays. Not
 * now: hidden until the app starts again; Who approves still offers Add meanwhile. Written: the offer closes as written.
 *
 * Known gap, shared with Who approves (ac's review, 11-13; a setTrustedApprovers backlog item): the whole trusted set
 * is replaced from the rules read here, BEFORE Face ID. setTrustedApprovers checks the agent's version only after Face
 * ID, so a change made on the agent during the Face ID window (an approver removed on another device) is overwritten
 * by this snapshot, and the check below sees only that this contact is in, not that nobody else moved. The fix belongs
 * in setTrustedApprovers (take the change, or the version this view was read at), not here.
 *
 * Shown by ApproverOfferModal (one sheet at the root), after an open offer and a card question, only with trusted
 * approvers on and this phone linked to its agent (the rules live there).
 *
 * @module trust-tasks/components/ApproverAddSheet
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  acceptedRoleOffers,
  approverNames,
  approverRoleEvents,
  closeRoleOffer,
  nextTrustedRules,
  type RoleOfferAsk,
} from '../approverRole'
import { releaseWarn } from '../module/releaseLog'
import type { OwnerLockKind } from '../module/ownerConfirm'
import { vtaAgent } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'

export const ApproverAddIds = {
  title: 'ApproverAdd',
  add: 'ApproverAddYes',
  notNow: 'ApproverAddNotNow',
  failed: 'ApproverAddFailed',
  lock: 'ApproverAddLock',
} as const

/** Yeses put off with Not now this run, by connection and the DID of the yes. */
const putOff = new Set<string>()
const keyOf = (ask: RoleOfferAsk) => `${ask.connectionId}|${ask.acceptedAs}`

/** Tests only. */
export const resetAddPutOff = () => putOff.clear()

export interface ApproverToAdd {
  ask: RoleOfferAsk
  name?: string
}

/** The first kept yes not yet on the agent and not put off; none with the switch off or this phone not linked. */
export function useApproverToAdd(on: boolean, linked: boolean): { pending?: ApproverToAdd; refresh: () => void } {
  const { agent } = useAgent()
  const [pending, setPending] = useState<ApproverToAdd>()
  const [round, setRound] = useState(0)
  const refresh = useCallback(() => setRound((n) => n + 1), [])

  useEffect(() => {
    if (!agent || !on || !linked) {
      setPending(undefined)
      return
    }
    let live = true
    void (async () => {
      const ask = (await acceptedRoleOffers(agent)).find((yes) => !putOff.has(keyOf(yes)))
      if (!ask) {
        if (live) setPending(undefined)
        return
      }
      const names = await approverNames(agent).catch(() => ({}) as Record<string, string>)
      if (live) setPending({ ask, name: names[ask.acceptedAs as string] })
    })().catch((error: unknown) => {
      releaseWarn(`[VTI] approver yeses not read (${(error as Error)?.name ?? 'error'})`)
      if (live) setPending(undefined)
    })
    return () => {
      live = false
    }
  }, [agent, on, linked, round])

  useEffect(() => {
    if (!on) return
    approverRoleEvents.on('answered', refresh)
    approverRoleEvents.on('asked', refresh)
    return () => {
      approverRoleEvents.off('answered', refresh)
      approverRoleEvents.off('asked', refresh)
    }
  }, [on, refresh])

  return { pending, refresh }
}

export const ApproverAddBody: React.FC<{ pending: ApproverToAdd; lockKind: OwnerLockKind; onDone: () => void }> = ({
  pending,
  lockKind,
  onDone,
}) => {
  const { agent } = useAgent()
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const { ask } = pending
  const words = { name: pending.name || t('Approver.UnnamedContact'), interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    centred: { textAlign: 'center' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error, textAlign: 'center' },
  })

  const add = async () => {
    if (!agent || busy || !ask.acceptedAs) return
    setBusy(true)
    setFailed(false)
    try {
      const state = await vtaAgent.trustedApprovers(agent)
      const rules = nextTrustedRules(state.view, ask)
      // Face ID is asked inside, before anything is written; the set written is this read's (see the module's known gap).
      const written = await vtaAgent.setTrustedApprovers(agent, rules.approvers, rules.keys)
      if (!written.view.approvers.includes(ask.acceptedAs)) throw new Error('the rules came back without them')
      await closeRoleOffer(agent, ask.connectionId, true)
      releaseWarn('[VTI] approver added from the prompt')
      onDone()
    } catch (error) {
      releaseWarn(`[VTI] approver not added (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`)
      // Cancelled at Face ID: the person chose not to, so nothing failed; the prompt simply stays.
      if (!(error instanceof OwnerNotConfirmed && error.reason === 'cancelled')) setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const notNow = () => {
    putOff.add(keyOf(ask))
    setFailed(false)
    onDone()
  }

  return (
    <>
      <ThemedText
        variant="headingThree"
        style={styles.centred}
        accessibilityRole="header"
        testID={testIdWithKey(ApproverAddIds.title)}
      >
        {t('Approver.AddTitle', words)}
      </ThemedText>
      <ThemedText>{t('Approver.AddBody', words)}</ThemedText>
      {ask.actions.map((action) => (
        <ThemedText key={action}>• {t(`Approver.Action.${action}`)}</ThemedText>
      ))}
      {failed ? (
        <ThemedText style={styles.error} testID={testIdWithKey(ApproverAddIds.failed)}>
          {t('Approver.AddFailed', words)}
        </ThemedText>
      ) : null}
      <Button
        title={t('Approver.Add', words)}
        buttonType={ButtonType.Primary}
        onPress={() => void add()}
        disabled={busy}
        testID={testIdWithKey(ApproverAddIds.add)}
      />
      <Button
        title={t('Approver.OfferNotNow')}
        buttonType={ButtonType.Tertiary}
        onPress={notNow}
        disabled={busy}
        testID={testIdWithKey(ApproverAddIds.notNow)}
      />
      <ThemedText style={[styles.muted, styles.centred]} testID={testIdWithKey(ApproverAddIds.lock)}>
        {t('Approver.AddAsksLock', { method: t(`CreateAgent.Lock.${lockKind}`) })}
      </ThemedText>
    </>
  )
}
