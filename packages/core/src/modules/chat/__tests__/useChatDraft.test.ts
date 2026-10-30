/**
 * A sent draft doesn't come back: the empty field a send leaves is saved at once, and a read of the kept draft that
 * answers after the field was touched is ignored (a slow first read, or a re-read when the agent restarts on lock and
 * unlock). A chat nobody has touched still gets its draft back.
 */
import { act, renderHook } from '@testing-library/react-native'

import { DRAFT_SAVE_DELAY_MS, useChatDraft } from '../useChatDraft'

const mockLoad = jest.fn()
const mockSave = jest.fn(async (_agent: unknown, _connectionId: string, _text: string) => undefined)
jest.mock('../draft', () => ({
  loadChatDraft: (...args: unknown[]) => mockLoad(...args),
  saveChatDraft: (...args: [unknown, string, string]) => mockSave(...args),
}))

const newAgent = () => ({ config: { logger: { warn: jest.fn() } } }) as never
const deferred = () => {
  let resolve: (text: string | undefined) => void = () => undefined
  const promise = new Promise<string | undefined>((r) => (resolve = r))
  return { promise, resolve }
}
const flush = () => act(async () => undefined)

beforeEach(() => {
  jest.useFakeTimers()
  mockLoad.mockReset()
  mockSave.mockClear()
})
afterEach(() => jest.useRealTimers())

test('a send saves the empty field at once; typed text still waits for the pause', async () => {
  mockLoad.mockResolvedValue(undefined)
  const { result } = renderHook(() => useChatDraft(newAgent(), 'c1'))
  await flush()
  act(() => result.current.onTextChange('half a thought'))
  act(() => jest.advanceTimersByTime(DRAFT_SAVE_DELAY_MS - 1))
  expect(mockSave).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(1))
  expect(mockSave.mock.calls.map(([, , text]) => text)).toEqual(['half a thought'])

  act(() => result.current.onTextChange(''))
  expect(mockSave.mock.calls.map(([, , text]) => text)).toEqual(['half a thought', ''])
})

test('an untouched chat gets its kept draft back', async () => {
  mockLoad.mockResolvedValue('half a thought')
  const { result } = renderHook(() => useChatDraft(newAgent(), 'c1'))
  await flush()
  expect(result.current.saved).toBe('half a thought')
})

test('a first read that answers after a send is ignored', async () => {
  const read = deferred()
  mockLoad.mockReturnValue(read.promise)
  const { result } = renderHook(() => useChatDraft(newAgent(), 'c1'))
  act(() => result.current.onTextChange(''))
  await act(async () => read.resolve('half a thought'))
  await flush()
  expect(result.current.saved).toBeUndefined()
})

test('a re-read when the agent restarts does not bring back a draft already sent', async () => {
  mockLoad.mockResolvedValue('half a thought')
  const { result, rerender } = renderHook(({ agent }) => useChatDraft(agent, 'c1'), {
    initialProps: { agent: newAgent() },
  })
  await flush()
  expect(result.current.saved).toBe('half a thought')
  act(() => result.current.onTextChange(''))
  // The restarted agent reads before the cleared draft is gone.
  rerender({ agent: newAgent() })
  await flush()
  expect(mockLoad).toHaveBeenCalledTimes(2)
  expect(result.current.saved).toBeUndefined()
})

test('another chat on the same screen gets its own kept draft, though the last one was touched', async () => {
  mockLoad.mockImplementation(async (_agent: unknown, connectionId: string) => `draft for ${connectionId}`)
  const agent = newAgent()
  const { result, rerender } = renderHook(({ id }) => useChatDraft(agent, id), { initialProps: { id: 'c1' } })
  await flush()
  act(() => result.current.onTextChange(''))
  rerender({ id: 'c2' })
  await flush()
  expect(result.current.saved).toBe('draft for c2')
})
