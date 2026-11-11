/**
 * The "Confirm it's you" screens (mocks GVGac4je…), each behind its switch: the contact's row (compose, waiting,
 * confirmed, not them, no answer, cancelled) and the request sheet on the asked phone. The protocol is tested in
 * __tests__/modules/trust-tasks/confirmItsYou.test.ts; here, what each screen calls, with what, and what it says.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import * as confirmItsYou from '../confirmItsYou'
import ConfirmItsYouModal, {
  ConfirmItsYouModalIds,
  resetConfirmPutOff,
  setConfirmOwnerCheckForTests,
} from '../components/ConfirmItsYouModal'
import { CONFIRM_ITS_YOU_REMOTE_OFF, setConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import * as ownerConfirm from '../module/ownerConfirm'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import ConfirmItsYouRow, { ConfirmItsYouRowIds } from '../screens/ConfirmItsYouRow'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = {} as never
const CONN = 'c-jordan'
const NOTE = 'Is this you calling? <b>Send</b> https://pay.example now'
const MIN = 60 * 1000

const show = async (element: React.ReactElement) => {
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}
const press = async (tree: Awaited<ReturnType<typeof show>>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

const ask = (over: Partial<confirmItsYou.ConfirmAsk> = {}): confirmItsYou.ConfirmAsk => ({
  threadId: 't-1',
  challenge: 'c'.repeat(43),
  note: NOTE,
  askedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 15 * MIN).toISOString(),
  state: 'waiting',
  ...over,
})
const prompt = (over: Partial<confirmItsYou.ConfirmPrompt> = {}): confirmItsYou.ConfirmPrompt => ({
  open: true,
  connectionId: CONN,
  asker: 'Sam',
  note: NOTE,
  expiresAt: new Date(Date.now() + 15 * MIN).toISOString(),
  request: { payload: { challenge: 'c'.repeat(43) } },
  receivedAt: new Date().toISOString(),
  ...over,
})

const OFFS: [string, () => void][] = [
  ['the switch off', () => setConfirmItsYouEnabled(false)],
  ['its remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
  ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
]

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
  confirmItsYou.confirmPromptStore.clear()
  resetConfirmPutOff()
  setConfirmOwnerCheckForTests(null)
  jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('faceId')
})
afterAll(() => setConfirmItsYouEnabled(false))

describe("the contact's row", () => {
  test('with nothing asked yet: the entry and the hint; Send sends the note as typed (control: Cancel sends nothing)', async () => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByText('ConfirmItsYou.Title')).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.Hint')).toBeTruthy()

    await press(tree, ConfirmItsYouRowIds.open)
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id(ConfirmItsYouRowIds.note)), NOTE)
    })
    await press(tree, ConfirmItsYouRowIds.cancelCompose)
    expect(send).not.toHaveBeenCalled()

    await press(tree, ConfirmItsYouRowIds.open)
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id(ConfirmItsYouRowIds.note)), NOTE)
    })
    read.mockResolvedValue([ask()])
    await press(tree, ConfirmItsYouRowIds.send)
    expect(send).toHaveBeenCalledWith(AGENT, CONN, NOTE)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
  })

  test('an empty note is not sent and the row says why', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    await press(tree, ConfirmItsYouRowIds.open)
    await press(tree, ConfirmItsYouRowIds.send)
    expect(send).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.said)).props.children).toBe('ConfirmItsYou.NoteNeeded')
  })

  test('waiting: the note exactly as typed, as plain text, and Cancel the request cancels that one', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask()])
    const cancel = jest.spyOn(confirmItsYou, 'cancelConfirmRequest').mockResolvedValue('cancelled')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.asked)).props.children).toBe(NOTE)
    expect(tree.getByText('ConfirmItsYou.CancelNote')).toBeTruthy()
    await press(tree, ConfirmItsYouRowIds.cancelRequest)
    expect(cancel).toHaveBeenCalledWith(AGENT, CONN, 't-1')
  })

  test('not them is the full alert with what to do now, never read as confirmed (control: itsMe is confirmed, no alert)', async () => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'notMe' })])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.NotThemTitle')
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.steps))).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.NotThemBody')).toBeTruthy()
    expect(tree.queryByText('ConfirmItsYou.ConfirmedTitle')).toBeNull()

    read.mockResolvedValue([ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })])
    const other = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(other.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ConfirmedTitle')
    expect(other.queryByTestId(id(ConfirmItsYouRowIds.steps))).toBeNull()
    expect(other.getByText('ConfirmItsYou.ConfirmedCaveat')).toBeTruthy()
  })

  test('a waiting request turns into no answer on a clock, with no event (control: before its time it still waits)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      jest
        .spyOn(confirmItsYou, 'confirmAsksOn')
        .mockResolvedValue([ask({ expiresAt: new Date(Date.now() + 2 * MIN).toISOString() })])
      const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(2 * MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ExpiredTitle')
    } finally {
      jest.useRealTimers()
    }
  })

  test('no answer: Ask again sends a new request with the same note', async () => {
    jest
      .spyOn(confirmItsYou, 'confirmAsksOn')
      .mockResolvedValue([ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ExpiredTitle')
    expect(tree.getByText('ConfirmItsYou.AskAgainNote')).toBeTruthy()
    await press(tree, ConfirmItsYouRowIds.askAgain)
    expect(send).toHaveBeenCalledWith(AGENT, CONN, NOTE)
  })

  test('a cancelled request says so, and the entry is back to ask again', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'cancelled' })])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.CancelledTitle')
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.open))).toBeTruthy()
  })

  test.each(OFFS)('%s: no row at all, and nothing read (control: on, the row shows)', async (_name, switchOff) => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const on = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(on.queryByTestId(id(ConfirmItsYouRowIds.row))).not.toBeNull()
    on.unmount()
    read.mockClear()

    switchOff()
    const off = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(off.queryByTestId(id(ConfirmItsYouRowIds.row))).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the request sheet on the asked phone', () => {
  test('shows the note exactly as written, as plain text, with both answers and the lock line', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const tree = await show(<ConfirmItsYouModal />)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.note)).props.children).toBe(NOTE)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.notMe))).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.PinInstead')).toBeTruthy()
  })

  test.each(['itsMe', 'notMe'] as const)(
    '%s goes through the owner check, then the sheet says what was sent',
    async (decision) => {
      jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      confirmItsYou.confirmPromptStore.set(prompt())
      const check = jest.fn(async () => ({ ok: true }))
      setConfirmOwnerCheckForTests(check)
      const answer = jest
        .spyOn(confirmItsYou, 'answerConfirmRequest')
        .mockImplementation(async (_agent, _conn, _decision, confirm, reason) => {
          await confirm(reason)
          return 'sent'
        })
      const tree = await show(<ConfirmItsYouModal />)
      await press(tree, decision === 'itsMe' ? ConfirmItsYouModalIds.itsMe : ConfirmItsYouModalIds.notMe)
      expect(answer.mock.calls[0].slice(0, 3)).toEqual([AGENT, CONN, decision])
      expect(answer.mock.calls[0][4]).toBe(
        decision === 'itsMe' ? 'ConfirmItsYou.ItsMeReason' : 'ConfirmItsYou.NotMeReason'
      )
      expect(answer.mock.calls[0][5]).toBe('faceId')
      expect(check).toHaveBeenCalledTimes(1)
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.sent))).toBeTruthy()
      expect(
        tree.getByText(decision === 'itsMe' ? 'ConfirmItsYou.YouToldItsMe' : 'ConfirmItsYou.YouToldNotMe')
      ).toBeTruthy()
    }
  )

  test('cancelled at the lock: nothing failed, the request stays (control: a failure says so)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('cancelled')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.failed))).toBeNull()
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sent))).toBeNull()
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()

    answer.mockResolvedValue('failed')
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.failed)).props.children).toBe('ConfirmItsYou.Failed')
  })

  test('Not now sends nothing and hides it', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.notNow)
    expect(answer).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
  })

  test('a request past its time is not shown (control: one in time is)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    const late = await show(<ConfirmItsYouModal />)
    expect(late.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
    late.unmount()
    confirmItsYou.confirmPromptStore.set(prompt())
    const inTime = await show(<ConfirmItsYouModal />)
    expect(inTime.queryByTestId(id(ConfirmItsYouModalIds.sheet))).not.toBeNull()
  })

  test.each(OFFS)(
    '%s: no sheet, nothing brought back, even with a request waiting (control: on, it shows)',
    async (_name, switchOff) => {
      const restore = jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      confirmItsYou.confirmPromptStore.set(prompt())
      const on = await show(<ConfirmItsYouModal />)
      expect(on.queryByTestId(id(ConfirmItsYouModalIds.sheet))).not.toBeNull()
      on.unmount()
      restore.mockClear()

      switchOff()
      const off = await show(<ConfirmItsYouModal />)
      expect(off.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
      expect(restore).not.toHaveBeenCalled()
    }
  )
})
