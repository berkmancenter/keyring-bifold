/**
 * Guardian offers on screen (row G): the guardian's row on a contact's page (GuardianOfferRow) and the person's sheet
 * (GuardianOfferSheet). The module under them (guardianOffer.ts) has its own suite; here it is spied on, and what is
 * checked is what each screen shows, what it asks Face ID for, and what it passes down.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en'
import { testIdWithKey } from '../../../utils/testable'
import { OFFER_OPEN_FOR } from '../approverRole'
import * as evidenceModule from '../guardianEvidence'
import * as offerModule from '../guardianOffer'
import { guardianOfferPrompts, type GuardianOfferPrompt, type GuardianOfferSent } from '../guardianOffer'
import GuardianOfferSheet, { GuardianOfferSheetIds, resetGuardianOfferPutOff } from '../components/GuardianOfferSheet'
import { GUARDIAN_OFFERS_REMOTE_OFF, setGuardianOffersEnabled } from '../module/guardianOffersFlag'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'
import GuardianOfferRow, { GuardianOfferRowIds } from '../screens/GuardianOfferRow'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = {} as never
const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const CONN = 'c-sam'

const linked = (vtaDid?: string) => {
  const real = vtaAgent.getState()
  jest.spyOn(vtaAgent, 'getState').mockReturnValue({
    ...real,
    link: vtaDid ? ({ kind: 'linked', vtaDid } as never) : ({ kind: 'unlinked' } as never),
  })
}

/** The app's owner check, answering as given. */
const owner = (answer: { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' }) => {
  const confirmOwner = jest.fn(async () => answer as never)
  vtaAgent.setOwnerChecks({ confirmOwner, deviceCanOwn: async () => true })
  return confirmOwner
}

/** The real English, with values unescaped as the screens ask: the words the person reads. */
const realEnglish = () => {
  const i18n = i18next.createInstance()
  void i18n.init({ lng: 'en', resources: { en: { translation: en } }, initAsync: false })
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  jest.spyOn(require('react-i18next'), 'useTranslation').mockReturnValue({ t: i18n.t.bind(i18n), i18n } as never)
}

const show = async (element: React.ReactElement) => {
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}

const sentOffer = (over: Partial<GuardianOfferSent> = {}): GuardianOfferSent => ({
  connectionId: CONN,
  ward: 'Sam',
  actions: ['joinCommunity', 'changeApprovers'],
  challenge: 'c'.repeat(43),
  threadId: 't-1',
  approverDid: JORDAN,
  sentAt: new Date().toISOString(),
  state: 'open',
  ...over,
})

const incoming = (over: Partial<GuardianOfferPrompt> = {}): GuardianOfferPrompt => ({
  connectionId: 'c-jordan',
  guardian: 'Jordan',
  actions: ['joinCommunity', 'addDevice', 'changeApprovers'],
  challenge: 'c'.repeat(43),
  threadId: 't-1',
  request: {},
  receivedAt: new Date().toISOString(),
  state: 'open',
  verdict: {
    ok: true,
    root: 'r',
    state: 'Example State',
    demo: true,
    checkedAt: new Date().toISOString(),
    expires: '2030-11-01T00:00:00Z',
  },
  ...over,
})

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  GUARDIAN_OFFERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setGuardianOffersEnabled(true)
  guardianOfferPrompts.clear()
  resetGuardianOfferPutOff()
  jest.spyOn(offerModule, 'restoreGuardianOffers').mockResolvedValue(undefined)
})
afterAll(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setGuardianOffersEnabled(false)
})

// ---------------------------------------------------------------------------------------------------------------

describe("the guardian's row on a contact's page", () => {
  const holdsCard = () =>
    jest.spyOn(evidenceModule, 'cardToShare').mockResolvedValue({ state: 'Example State', demo: true })
  const sentAs = (offer?: GuardianOfferSent) =>
    jest.spyOn(offerModule, 'guardianOffersSent').mockResolvedValue(offer ? [offer] : [])

  test('shown only with a card held, this phone linked and the switch on (control: all three)', async () => {
    linked('did:webvh:jordans-agent.example')
    holdsCard()
    sentAs()
    const shown = await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)
    expect(shown.getByTestId(id(GuardianOfferRowIds.offer))).toBeTruthy()
    shown.unmount()

    setGuardianOffersEnabled(false)
    expect(
      (await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)).queryByTestId(id(GuardianOfferRowIds.row))
    ).toBeNull()
    setGuardianOffersEnabled(true)

    jest.spyOn(evidenceModule, 'cardToShare').mockResolvedValue(undefined)
    expect(
      (await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)).queryByTestId(id(GuardianOfferRowIds.row))
    ).toBeNull()
    holdsCard()

    linked()
    expect(
      (await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)).queryByTestId(id(GuardianOfferRowIds.row))
    ).toBeNull()
  })

  test('Send offer asks Face ID first, then offers what was chosen, "changes who approves" always in', async () => {
    linked('did:webvh:jordans-agent.example')
    holdsCard()
    sentAs()
    const confirm = owner({ ok: true })
    jest.spyOn(vtaAgent, 'approverDid').mockResolvedValue(JORDAN)
    const offer = jest.spyOn(offerModule, 'offerAsGuardian').mockResolvedValue('sent')
    const tree = await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.offer))))
    expect(tree.getByTestId(id(GuardianOfferRowIds.card))).toBeTruthy()
    // Untick two; the locked one cannot be.
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.pick('shareCredential')))))
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.pick('addDevice')))))
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.pick('changeApprovers')))))
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.send))))
    expect(confirm).toHaveBeenCalledWith('GuardianOffer.SendReason')
    expect(offer).toHaveBeenCalledWith(
      AGENT,
      CONN,
      expect.arrayContaining(['joinCommunity', 'changeApprovers']),
      JORDAN
    )
    expect([...(offer.mock.calls[0][2] as string[])].sort()).toEqual(['changeApprovers', 'joinCommunity'])
  })

  test('cancelled at Face ID: nothing offered and no error (control: unavailable is said)', async () => {
    linked('did:webvh:jordans-agent.example')
    holdsCard()
    sentAs()
    owner({ ok: false, reason: 'cancelled' })
    const offer = jest.spyOn(offerModule, 'offerAsGuardian').mockResolvedValue('sent')
    const tree = await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.offer))))
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.send))))
    expect(offer).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id(GuardianOfferRowIds.error))).toBeNull()
    owner({ ok: false, reason: 'unavailable' })
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferRowIds.send))))
    expect(offer).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(GuardianOfferRowIds.error))).toBeTruthy()
  })

  test.each([
    ['waiting', sentOffer(), 'Waiting for Sam', undefined],
    ['accepted', sentOffer({ state: 'accepted' }), 'Sam took up your offer', 'Your Guardian card: sent'],
    [
      'not accepted (a lapse, read as a no would be)',
      sentOffer({ sentAt: new Date(Date.now() - OFFER_OPEN_FOR - 1000).toISOString() }),
      "Sam didn't accept",
      "Nothing changed on Sam's phone",
    ],
    [
      "couldn't check (the same words whatever failed: the reason is never sent)",
      sentOffer({ state: 'unverifiable' }),
      "Sam's phone couldn't check your Guardian card",
      "Sam wasn't asked. Check that your card is current and names Sam.",
    ],
  ])('%s: the words the guardian reads', async (_what, offer, title, detail) => {
    realEnglish()
    linked('did:webvh:jordans-agent.example')
    holdsCard()
    sentAs(offer)
    const tree = await show(<GuardianOfferRow connectionId={CONN} name="Sam" />)
    expect(tree.getByTestId(id(GuardianOfferRowIds.status)).props.children).toBe(title)
    if (detail) expect(tree.getByTestId(id(GuardianOfferRowIds.detail)).props.children).toBe(detail)
    else expect(tree.getByTestId(id(GuardianOfferRowIds.sentPill))).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------------------------

describe("the person's sheet", () => {
  test('shown only for an offer the module put up, with the switch on (control: on, it shows)', async () => {
    guardianOfferPrompts.set(incoming())
    expect((await show(<GuardianOfferSheet />)).getByTestId(id(GuardianOfferSheetIds.sheet))).toBeTruthy()
    setGuardianOffersEnabled(false)
    expect((await show(<GuardianOfferSheet />)).queryByTestId(id(GuardianOfferSheetIds.sheet))).toBeNull()
  })

  test('says what the state says, and the removal line word for word', async () => {
    realEnglish()
    guardianOfferPrompts.set(incoming())
    const tree = await show(<GuardianOfferSheet />)
    expect(tree.getByText('Jordan offered to be your approver')).toBeTruthy()
    expect(tree.getByText(/Example State says Jordan is your guardian/)).toBeTruthy()
    expect(tree.getByTestId(id(GuardianOfferSheetIds.demo))).toBeTruthy()
    expect(tree.getByTestId(id(GuardianOfferSheetIds.removing)).props.children).toBe(
      "Removing Jordan later needs your approvers' yes."
    )
  })

  test("Accept asks Face ID first, then takes up the offer for this phone's agent with what was kept", async () => {
    linked(SAM_AGENT)
    guardianOfferPrompts.set(incoming())
    const confirm = owner({ ok: true })
    const accept = jest.spyOn(offerModule, 'acceptGuardianOffer').mockResolvedValue('sent')
    const tree = await show(<GuardianOfferSheet />)
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.pick('addDevice')))))
    // The locked one does not untick.
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.pick('changeApprovers')))))
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.accept))))
    expect(confirm).toHaveBeenCalledWith('GuardianOffer.AcceptReason')
    expect(accept).toHaveBeenCalledWith(AGENT, 'c-jordan', SAM_AGENT, ['joinCommunity', 'changeApprovers'])
  })

  test('not confirmed at Face ID: nothing taken up, and the sheet stays (control: the row above)', async () => {
    linked(SAM_AGENT)
    guardianOfferPrompts.set(incoming())
    owner({ ok: false, reason: 'cancelled' })
    const accept = jest.spyOn(offerModule, 'acceptGuardianOffer').mockResolvedValue('sent')
    const tree = await show(<GuardianOfferSheet />)
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.accept))))
    expect(accept).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(GuardianOfferSheetIds.sheet))).toBeTruthy()
    expect(tree.queryByTestId(id(GuardianOfferSheetIds.failed))).toBeNull()
  })

  test('not linked: Accept is off and it says why; Decline still works, with no Face ID', async () => {
    linked()
    guardianOfferPrompts.set(incoming())
    const confirm = owner({ ok: true })
    const decline = jest.spyOn(offerModule, 'declineGuardianOffer').mockResolvedValue(undefined)
    const tree = await show(<GuardianOfferSheet />)
    expect(tree.getByTestId(id(GuardianOfferSheetIds.needsAgent))).toBeTruthy()
    expect(tree.getByTestId(id(GuardianOfferSheetIds.accept)).props.accessibilityState?.disabled).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.decline))))
    expect(decline).toHaveBeenCalledWith(AGENT, 'c-jordan')
    expect(confirm).not.toHaveBeenCalled()
  })

  test('Not now hides it until the app starts again, and shows the next one', async () => {
    guardianOfferPrompts.set(incoming())
    guardianOfferPrompts.set(incoming({ connectionId: 'c-riley', guardian: 'Riley' }))
    realEnglish()
    const tree = await show(<GuardianOfferSheet />)
    expect(tree.getByText('Jordan offered to be your approver')).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(id(GuardianOfferSheetIds.notNow))))
    expect(tree.getByText('Riley offered to be your approver')).toBeTruthy()
  })
})
