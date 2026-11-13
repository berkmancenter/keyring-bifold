/**
 * Where making a contact my approver stands, on their contact page (mock E3/E5, Alberto's pick 2026-11-13): asked,
 * they accepted, added to your agent, and their state card checked. Each step from what this phone knows; a step it
 * can't know yet is "not yet", never "done", and a card check that failed is never "no card".
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as approverRole from '../approverRole'
import * as guardianEvidence from '../guardianEvidence'
import { type GuardianStanding } from '../guardianEvidence'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'
import { DeviceActionRefused } from '../module/vtaOwner'
import ApproverAskRow from '../screens/ApproverAskRow'
import { ApproverStepsIds, approverSteps, type StepKey } from '../screens/approver/ApproverSteps'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const CONN = 'c-jordan'
const t = (key: string) => key

const ask = (over: Partial<approverRole.RoleOfferAsk> = {}): approverRole.RoleOfferAsk => ({
  state: 'open',
  connectionId: CONN,
  threadId: 't-1',
  agentDid: SAM_AGENT,
  actions: ['joinCommunity', 'changeApprovers'],
  challenge: 'c'.repeat(43),
  askedAt: '2026-11-13T10:40:00.000Z',
  ...over,
})
const ACCEPTED = ask({ state: 'accepted', acceptedAs: JORDAN })
const WRITTEN = ask({ state: 'closed', acceptedAs: JORDAN, written: true })
const steps = (over: Partial<Parameters<typeof approverSteps>[1]>) =>
  approverSteps(t, { ask: ask(), name: 'Jordan', listed: false, cardRead: false, showCard: true, ...over })
const states = (over: Partial<Parameters<typeof approverSteps>[1]>) =>
  Object.fromEntries(steps(over).map((s) => [s.key, s.state])) as Record<StepKey, string>
const cardOf = (over: Partial<Parameters<typeof approverSteps>[1]>) => steps(over).find((s) => s.key === 'card')

describe('the steps, from what this phone knows', () => {
  test('asked, waiting: accepted is now, added and card not yet', () => {
    expect(states({})).toEqual({ asked: 'done', accepted: 'now', added: 'wait', card: 'wait' })
  })

  test('they said yes, not yet added: added is now, with how (control: written, done)', () => {
    expect(states({ ask: ACCEPTED })).toMatchObject({ accepted: 'done', added: 'now' })
    expect(steps({ ask: ACCEPTED }).find((s) => s.key === 'added')?.sub).toBe('Approver.StepAddedHow')
    expect(states({ ask: WRITTEN })).toMatchObject({ accepted: 'done', added: 'done' })
    expect(steps({ ask: WRITTEN }).find((s) => s.key === 'added')?.sub).toBeUndefined()
  })

  test("the agent lists them though the record was never marked written: added (the agent's rules decide)", () => {
    expect(states({ ask: ACCEPTED, listed: true })).toMatchObject({ added: 'done' })
  })

  test('a closed ask with no yes is not "accepted" (control: open is now)', () => {
    expect(states({ ask: ask({ state: 'closed' }) })).toMatchObject({ accepted: 'wait', added: 'wait' })
  })

  test('state-verified approvers off: no card step at all', () => {
    expect(steps({ showCard: false }).map((s) => s.key)).toEqual(['asked', 'accepted', 'added'])
  })

  test('the card: not read is "not yet", read and none is "no state card", never the other way round', () => {
    expect(cardOf({ cardRead: false })).toMatchObject({ state: 'wait', title: 'Approver.StepCard' })
    expect(cardOf({ cardRead: true })).toMatchObject({ state: 'done', title: 'Approver.StepCardNone' })
  })

  test.each<[string, GuardianStanding, string, string]>([
    ['verified', { kind: 'verified', state: 'Example State' }, 'done', 'Approver.StepCard'],
    ['unreachable', { kind: 'unreachable', state: 'Example State' }, 'warn', 'Approver.GuardianStateUnreachable'],
    ['revoked', { kind: 'unverified', outcome: 'revokedInStateRecord' }, 'fail', 'Approver.GuardianRevoked'],
    ['noWard', { kind: 'unverified', outcome: 'noWard' }, 'fail', 'Approver.GuardianCouldNotVerify'],
  ])('a card that is %s', (_label, card, state, title) => {
    expect(cardOf({ cardRead: true, card })).toMatchObject({ state, title })
  })

  test('a card that did not check out says why in plain words, never the code', () => {
    const sub = cardOf({ cardRead: true, card: { kind: 'unverified', outcome: 'noWard' } })?.sub
    expect(sub).toBe('Approver.Reason.noWard Approver.ReasonDo.noWard')
  })
})

describe('on the contact page', () => {
  const show = async () => {
    const tree = render(
      <BasicAppContext>
        <ApproverAskRow connectionId={CONN} name="Jordan" />
      </BasicAppContext>
    )
    await act(async () => undefined)
    await act(async () => undefined)
    return tree
  }
  const stepState = (tree: ReturnType<typeof render>, key: StepKey) =>
    tree.getByTestId(id(ApproverStepsIds.step(key))).props.accessibilityValue.text

  beforeEach(() => {
    jest.restoreAllMocks()
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
    TRUSTED_APPROVERS_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = false
    setTrustedApproversEnabled(true)
    setStateVerifiedApproversEnabled(true)
    const real = vtaAgent.getState()
    jest.spyOn(vtaAgent, 'getState').mockReturnValue({ ...real, link: { kind: 'linked', vtaDid: SAM_AGENT } as never })
    jest.spyOn(vtaAgent, 'trustedApprovers').mockRejectedValue(new DeviceActionRefused('unreachable'))
  })
  afterAll(() => {
    setTrustedApproversEnabled(false)
    setStateVerifiedApproversEnabled(false)
  })

  test('waiting for Jordan: the steps show, with no card read (control: no ask, no steps)', async () => {
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(ask())
    const cards = jest.spyOn(guardianEvidence, 'guardianStandings').mockResolvedValue({})
    const tree = await show()
    expect(stepState(tree, 'accepted')).toBe('Approver.StepState.now')
    expect(stepState(tree, 'card')).toBe('Approver.StepState.wait')
    expect(cards).not.toHaveBeenCalled()
    tree.unmount()
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(undefined)
    const none = await show()
    expect(none.queryByTestId(id(ApproverStepsIds.steps))).toBeNull()
  })

  test("added, with Jordan's card checked on this open: every step done", async () => {
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(WRITTEN)
    jest.spyOn(guardianEvidence, 'guardianStandings').mockResolvedValue({
      [JORDAN]: { kind: 'verified', state: 'Example State' },
    })
    const tree = await show()
    for (const key of ['asked', 'accepted', 'added', 'card'] as const)
      expect(stepState(tree, key)).toBe('Approver.StepState.done')
    expect(tree.getByText('Example State')).toBeTruthy()
  })

  test('the card check failing reads "not yet", never "no state card" (control: it answers empty, "no state card")', async () => {
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(WRITTEN)
    jest.spyOn(guardianEvidence, 'guardianStandings').mockRejectedValue(new Error('offline'))
    const failed = await show()
    expect(stepState(failed, 'card')).toBe('Approver.StepState.wait')
    expect(failed.queryByText('Approver.StepCardNone')).toBeNull()
    failed.unmount()
    jest.spyOn(guardianEvidence, 'guardianStandings').mockResolvedValue({})
    const empty = await show()
    expect(empty.getByText('Approver.StepCardNone')).toBeTruthy()
  })

  test('state-verified approvers off: no card step, and no card check run', async () => {
    setStateVerifiedApproversEnabled(false)
    jest.spyOn(approverRole, 'roleOfferAskOn').mockResolvedValue(WRITTEN)
    const cards = jest.spyOn(guardianEvidence, 'guardianStandings').mockResolvedValue({})
    const tree = await show()
    expect(tree.getByTestId(id(ApproverStepsIds.step('added')))).toBeTruthy()
    expect(tree.queryByTestId(id(ApproverStepsIds.step('card')))).toBeNull()
    expect(cards).not.toHaveBeenCalled()
  })
})
