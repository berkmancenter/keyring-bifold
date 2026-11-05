/**
 * A plain BasicMessage goes through Credo, which stores the record as sent before it sends. Real Credo classes, with
 * only the storage and the transport faked, so the record the mark reaches is the one Credo's own send error carries.
 */
import { Buffer } from 'buffer'

import {
  DidCommBasicMessageRepository,
  DidCommBasicMessageService,
  DidCommBasicMessagesApi,
  MessageSendingError,
} from '@credo-ts/didcomm'

import { jpegHeader, paddedTo } from '../media/__tests__/fixtures/images'
import { isPlainNotSent } from '../plainNotSent'
import { sendChatPhoto, sendChatText } from '../send'

jest.mock('../capability', () => ({ counterpartySpeaksChat: jest.fn(async () => false) }))

const WORDS = 'the door code is 4512'
const undeliverable = async (outbound: unknown) => {
  throw new MessageSendingError('Message is undeliverable to connection conn-1 (Alice)', {
    outboundMessageContext: outbound as never,
  })
}

const makeAgent = (send: (outbound: unknown) => Promise<void>, update = jest.fn(async () => undefined)) => {
  const saved: any[] = []
  const repository = { save: async (_ctx: unknown, record: unknown) => void saved.push(record), update }
  const api = new DidCommBasicMessagesApi(
    new DidCommBasicMessageService(repository as never, { emit: jest.fn() } as never),
    {} as never,
    { sendMessage: send } as never,
    { getById: async (_ctx: unknown, id: string) => ({ id }) } as never,
    { config: { logger: { debug: jest.fn() } } } as never,
    { protocols: ['v1'] } as never,
    { didcommVersions: ['v1'] } as never
  )
  const warn = jest.fn()
  const agent = {
    context: {},
    config: { logger: { warn } },
    modules: { didcomm: { basicMessages: api } },
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === DidCommBasicMessageRepository) return repository
        throw new Error('fake agent cannot resolve this')
      },
    },
  }
  return { agent: agent as never, saved, update, warn }
}

describe('a plain message that could not be delivered', () => {
  test('stays stored, marked, and the send’s own error still reaches the caller', async () => {
    const fake = makeAgent(undeliverable)
    await expect(sendChatText(fake.agent, 'conn-1', WORDS)).rejects.toBeInstanceOf(MessageSendingError)
    expect(fake.saved.map((r) => r.content)).toEqual([WORDS])
    expect(isPlainNotSent(fake.saved[0])).toBe(true)
    expect(fake.update).toHaveBeenCalledWith(expect.anything(), fake.saved[0])
  })

  test('a photo’s plain fallback is marked the same way', async () => {
    const fake = makeAgent(undeliverable)
    const photo = {
      mediaType: 'image/jpeg',
      byteCount: 200_000,
      width: 1600,
      height: 1200,
      base64: Buffer.from(paddedTo(jpegHeader(1600, 1200), 200_000)).toString('base64'),
    }
    await expect(
      sendChatPhoto(fake.agent, 'conn-1', photo as never, { fallbackText: 'A photo' })
    ).rejects.toBeInstanceOf(MessageSendingError)
    expect(isPlainNotSent(fake.saved[0])).toBe(true)
  })

  test('a mark that cannot be written leaves the send’s own error, and the log names no one', async () => {
    const fake = makeAgent(
      undeliverable,
      jest.fn(async () => Promise.reject(new Error('store closed for Alice')))
    )
    await expect(sendChatText(fake.agent, 'conn-1', WORDS)).rejects.toBeInstanceOf(MessageSendingError)
    expect(fake.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fake.warn.mock.calls)).not.toContain('Alice')
  })
})

// Controls: a message that went is left alone; a throw that names no record marks nothing.
describe('nothing to mark', () => {
  test('a message that went', async () => {
    const fake = makeAgent(async () => undefined)
    await sendChatText(fake.agent, 'conn-1', WORDS)
    expect(fake.saved.map((r) => r.content)).toEqual([WORDS])
    expect(isPlainNotSent(fake.saved[0])).toBe(false)
    expect(fake.update).not.toHaveBeenCalled()
  })

  test('another kind of error', async () => {
    const fake = makeAgent(async () => {
      throw new Error('out of memory')
    })
    await expect(sendChatText(fake.agent, 'conn-1', WORDS)).rejects.toThrow('out of memory')
    expect(isPlainNotSent(fake.saved[0])).toBe(false)
    expect(fake.update).not.toHaveBeenCalled()
  })
})
