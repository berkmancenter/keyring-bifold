/**
 * Where making a contact my approver stands, on their own contact page (mock E3/E5, Alberto's pick 2026-11-13: the
 * status lives on the contact, not only on My agent): asked, they accepted, added to your agent, and (with
 * state-verified approvers on) their state card checked.
 *
 * Each step reads only what this phone knows: the ask record (approverRole.ts) and, for the card, the same check Who
 * approves runs on open (guardianStandings, never a stored verdict shown as fresh). A step it can't know yet is shown
 * as not yet, never as done.
 *
 * @module trust-tasks/screens/approver/ApproverSteps
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../../components/texts/ThemedText'
import { useTheme } from '../../../../contexts/theme'
import { testIdWithKey } from '../../../../utils/testable'
import type { RoleOfferAsk } from '../../approverRole'
import type { GuardianStanding } from '../../guardianEvidence'
import { localClock } from '../localTime'

import { guardianReasonKeys } from './guardianReasonWords'

export type StepState = 'done' | 'now' | 'wait' | 'fail' | 'warn'
export type StepKey = 'asked' | 'accepted' | 'added' | 'card'

export const ApproverStepsIds = {
  steps: 'ApproverSteps',
  step: (key: StepKey) => `ApproverStep_${key}`,
} as const

interface Props {
  ask: RoleOfferAsk
  name: string
  /** The agent's own rules list them (a fresh read): added, even if the record was never marked written. */
  listed: boolean
  /** Their card's standing from this open's check; undefined while unread or with no card. Omit the step with `showCard` false. */
  card?: GuardianStanding
  /** Whether a card check ran and found no card (as opposed to not having run yet). */
  cardRead: boolean
  /** State-verified approvers on: the card step shows. */
  showCard: boolean
}

interface Step {
  key: StepKey
  state: StepState
  title: string
  sub?: string
}

const REVOKED = ['revoked', 'revokedInIssuerRecord', 'revokedInStateRecord']

/** The steps, in order, from what this phone knows. Exported for its rows. */
export function approverSteps(
  t: (key: string, options?: Record<string, unknown>) => string,
  { ask, name, listed, card, cardRead, showCard }: Props
): Step[] {
  const n = { name, interpolation: { escapeValue: false } }
  const said = !!ask.acceptedAs || !!ask.written || listed
  const added = !!ask.written || listed
  const steps: Step[] = [
    { key: 'asked', state: 'done', title: t('Approver.StepAsked'), sub: localClock(ask.askedAt) },
    {
      key: 'accepted',
      state: said ? 'done' : ask.state === 'open' ? 'now' : 'wait',
      title: t(said ? 'Approver.StepAccepted' : 'Approver.StepAccepts', n),
    },
    {
      key: 'added',
      state: added ? 'done' : said ? 'now' : 'wait',
      title: t('Approver.StepAdded'),
      ...(said && !added ? { sub: t('Approver.StepAddedHow', n) } : {}),
    },
  ]
  if (!showCard) return steps
  const words = { ...n, interpolation: { escapeValue: false } }
  let cardStep: Step
  if (!card)
    cardStep = cardRead
      ? { key: 'card', state: 'done', title: t('Approver.StepCardNone'), sub: t('Approver.StepCardNotNeeded') }
      : { key: 'card', state: 'wait', title: t('Approver.StepCard'), sub: t('Approver.StepCardIfAny') }
  else if (card.kind === 'verified')
    cardStep = { key: 'card', state: 'done', title: t('Approver.StepCard'), sub: card.state }
  else if (card.kind === 'unreachable')
    cardStep = { key: 'card', state: 'warn', title: t('Approver.GuardianStateUnreachable'), sub: card.state }
  else if (REVOKED.includes(card.outcome))
    cardStep = { key: 'card', state: 'fail', title: t('Approver.GuardianRevoked') }
  else {
    const keys = guardianReasonKeys(card.outcome)
    cardStep = {
      key: 'card',
      state: 'fail',
      title: t('Approver.GuardianCouldNotVerify'),
      sub: `${t(keys.what, words)} ${t(keys.todo, words)}`,
    }
  }
  return [...steps, cardStep]
}

const ICON: Record<StepState, string> = {
  done: 'check-circle',
  now: 'circle-slice-4',
  wait: 'circle-outline',
  fail: 'close-circle',
  warn: 'alert-circle',
}

const ApproverSteps: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const color: Record<StepState, string> = {
    done: ColorPalette.brand.primary,
    now: ColorPalette.brand.primary,
    wait: ColorPalette.grayscale.mediumGrey,
    fail: ColorPalette.semantic.error,
    warn: ColorPalette.semantic.focus,
  }
  const styles = StyleSheet.create({
    list: { gap: 10 },
    step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    text: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.list} testID={testIdWithKey(ApproverStepsIds.steps)}>
      {approverSteps(t as never, props).map((step) => (
        <View
          key={step.key}
          style={styles.step}
          accessible
          accessibilityLabel={[step.title, step.sub].filter(Boolean).join('. ')}
          accessibilityValue={{ text: t(`Approver.StepState.${step.state}`) }}
          testID={testIdWithKey(ApproverStepsIds.step(step.key))}
        >
          <Icon name={ICON[step.state]} size={22} color={color[step.state]} />
          <View style={styles.text}>
            <ThemedText
              variant={step.state === 'wait' ? undefined : 'bold'}
              style={step.state === 'wait' ? styles.muted : undefined}
            >
              {step.title}
            </ThemedText>
            {step.sub ? <ThemedText style={styles.muted}>{step.sub}</ThemedText> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

export default ApproverSteps
