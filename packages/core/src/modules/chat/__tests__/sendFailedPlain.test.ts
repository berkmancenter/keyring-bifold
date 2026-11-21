/**
 * A plain BasicMessage goes through Credo, which stores the record as sent BEFORE it sends. Real Credo classes, only
 * the storage and the transport faked: does a message that could not be delivered leave a record, and so a normal
 * bubble (hooks/chat-messages.tsx maps every record to one, with no sent state)?
 */
import { DidCommBasicMessageService, DidCommBasicMessagesApi } from '@credo-ts/didcomm'

const makeApi = (sendMessage: () => Promise<void>) => {
  const saved: { content: string; role: string }[] = []
  const service = new DidCommBasicMessageService(
    { save: async (_ctx: unknown, record: { content: string; role: string }) => void saved.push(record) } as never,
    { emit: jest.fn() } as never
  )
  const api = new DidCommBasicMessagesApi(
    service,
    {} as never,
    { sendMessage } as never,
    { getById: async (_ctx: unknown, id: string) => ({ id, assertReady: () => undefined, isReady: true }) } as never,
    { config: { logger: { debug: jest.fn() } } } as never,
    { protocols: ['v1'] } as never,
    { didcommVersions: ['v1'] } as never
  )
  return { api, saved }
}

test('a message that could not be delivered leaves no record that reads as sent', async () => {
  const { api, saved } = makeApi(async () => {
    throw new Error('Message is undeliverable')
  })
  await expect(api.sendMessage('conn-1', 'the door code is 4512')).rejects.toThrow('undeliverable')
  expect(saved).toEqual([])
})

// Control: the fake storage does see a record, so an empty list above means something.
test('a message that went leaves its record', async () => {
  const { api, saved } = makeApi(async () => undefined)
  await api.sendMessage('conn-1', 'the door code is 4512')
  expect(saved.map((r) => r.content)).toEqual(['the door code is 4512'])
})
