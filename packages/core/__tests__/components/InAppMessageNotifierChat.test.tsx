/**
 * The in-app toast for a received keyring/chat message, run end to end on one event bus: the real inbound handler
 * stores the event through the real ChatEventRepository (which emits on the bus as Credo's Repository does), with
 * the real InAppMessageNotifier mounted and listening. A chat message's text shows only when it is certain not to
 * disappear (rich-messaging-plan.md §4.6); otherwise the toast says only "New message".
 *
 * Before this, a chat message raised no toast at all: the first test fails on a notifier that hears only
 * BasicMessages. A plain BasicMessage on the same bus is the positive control.
 */
import { useAgent } from '@bifold/react-hooks'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'
import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRecord,
  DidCommBasicMessageRole,
  DidCommMessageHandlerRegistry,
} from '@credo-ts/didcomm'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import InAppMessageNotifier from '../../src/components/InAppMessageNotifier'
import { CHAT_PROFILE } from '../../src/modules/chat/chatEvent'
import { receiveChatEventMessage } from '../../src/modules/chat/inbound'
import { ChatEventMessage } from '../../src/modules/chat/messages/ChatEventMessage'
import { ChatEventRecord } from '../../src/modules/chat/records/ChatEventRecord'
import { setActiveChatConnectionId } from '../../src/utils/activeChatTracker'

type Listener = (event: { type: string; payload: unknown }) => void
const listeners = new Map<string, Set<Listener>>()
const bus = {
  emit: (_ctx: unknown, event: { type: string; payload: unknown }) =>
    listeners.get(event.type)?.forEach((listener) => listener(event)),
  on: (type: string, listener: Listener) => listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
  off: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
}

let stored: ChatEventRecord[] = []
let unreadable = false
const storage = {
  save: async (_ctx: unknown, record: ChatEventRecord) => void stored.push(record),
  findByQuery: async (_ctx: unknown, _cls: unknown, query: Record<string, string>) => {
    if (unreadable) throw new Error('storage unavailable')
    return stored.filter((r) =>
      Object.entries(query).every(([k, v]) => (r.getTags() as unknown as Record<string, unknown>)[k] === v)
    )
  },
}
const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown }>()
const singletons = new Map<unknown, unknown>([
  [InjectionSymbols.StorageService, storage],
  [EventEmitter, bus],
  [DidCommMessageHandlerRegistry, { registerMessageHandler: () => undefined }],
])
const container = {
  isRegistered: (token: unknown) => registrations.has(token) || singletons.has(token),
  register: (token: unknown, provider: { useFactory: (c: unknown) => unknown }) => registrations.set(token, provider),
  resolve: (token: unknown): unknown => {
    if (singletons.has(token)) return singletons.get(token)
    const registration = registrations.get(token)
    if (!registration) throw new Error(`cannot resolve ${String(token)}`)
    const instance = registration.useFactory(container)
    singletons.set(token, instance)
    return instance
  },
}
const agent = {
  context: {},
  events: bus,
  config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
  dependencyManager: { container, resolve: container.resolve },
  modules: { didcomm: { connections: { findById: async () => ({ id: 'conn-1', theirLabel: 'Ana' }) } } },
  w3cCredentials: { getAll: async () => [] },
}

let n = 0
const eventId = () => `01JB3XKX6F8Q2W4E5R6T7Y8Z${String(++n).padStart(2, '0')}`.slice(0, 26)
const arrives = (event: Record<string, unknown>) =>
  receiveChatEventMessage(agent as never, {
    message: new ChatEventMessage({ event: { profile: CHAT_PROFILE, eventId: eventId(), ...event } as never }),
    connection: { id: 'conn-1' } as never,
    senderKey: {},
  })
const message = (text: string, extra: Record<string, unknown> = {}) =>
  arrives({ type: 'message', content: { format: 'text/plain', text }, ...extra })
const timerSet = (expiresIn: number) => arrives({ type: 'timer', timer: { expiresIn, version: 1 } })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const toasted = () => (Toast.show as jest.Mock).mock.calls.map(([options]) => options)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  ;(useAgent as jest.Mock).mockReturnValue({ agent })
  stored = []
  unreadable = false
  setActiveChatConnectionId(undefined)
  render(<InAppMessageNotifier />)
})

describe('a received chat message', () => {
  test('in a chat with no timer: a toast with its sender and its text', async () => {
    expect(await message('see you at noon')).toBe('stored')
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text1: 'Ana', text2: 'see you at noon' })])
  })

  test('sent with a timer: "New message", and its text nowhere in the toast', async () => {
    await message('the door code is 4512', { expiresIn: 3600 })
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text1: 'Ana', text2: 'Chat.NewMessage' })])
    expect(JSON.stringify(toasted())).not.toContain('4512')
  })

  test('in a chat whose timer is on, even one sent without: "New message"', async () => {
    await timerSet(86400)
    await message('the door code is 4512')
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text2: 'Chat.NewMessage' })])
    expect(JSON.stringify(toasted())).not.toContain('4512')
  })

  test('a timer turned off again: the text shows', async () => {
    await timerSet(86400)
    await arrives({ type: 'timer', timer: { expiresIn: 0, version: 2 } })
    await message('see you at noon')
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text2: 'see you at noon' })])
  })

  test("the chat's records cannot be read: never the text", async () => {
    await message('the door code is 4512')
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text2: 'the door code is 4512' })])
    unreadable = true
    // Stored before storage failed; the toast reads the chat's timer as it fires.
    ;(Toast.show as jest.Mock).mockClear()
    bus.emit(agent.context, { type: 'RecordSaved', payload: { record: stored[stored.length - 1] } })
    await settle()
    expect(toasted()).toEqual([expect.objectContaining({ text2: 'Chat.NewMessage' })])
  })

  test('in the chat someone is looking at: no toast', async () => {
    setActiveChatConnectionId('conn-1')
    await message('see you at noon')
    await settle()
    expect(Toast.show).not.toHaveBeenCalled()
  })
})

describe('never a toast', () => {
  test('for a reaction, a redaction or a timer change', async () => {
    const target = eventId()
    await arrives({ type: 'reaction', target, emoji: '👍' })
    await arrives({ type: 'redaction', target })
    await timerSet(3600)
    await settle()
    expect(Toast.show).not.toHaveBeenCalled()
  })

  test('for what this phone sent', async () => {
    const sent = new ChatEventRecord({
      connectionId: 'conn-1',
      role: 'sent',
      eventId: eventId(),
      eventType: 'message',
      content: { format: 'text/plain', text: 'on my way' },
    })
    bus.emit(agent.context, { type: 'RecordSaved', payload: { record: sent } })
    await settle()
    expect(Toast.show).not.toHaveBeenCalled()
  })

  test('for a duplicate: it is never saved again', async () => {
    const event = { type: 'message', eventId: eventId(), content: { format: 'text/plain', text: 'hi' } }
    const deliver = () =>
      receiveChatEventMessage(agent as never, {
        message: new ChatEventMessage({ event: { profile: CHAT_PROFILE, ...event } as never }),
        connection: { id: 'conn-1' } as never,
        senderKey: {},
      })
    expect(await deliver()).toBe('stored')
    expect(await deliver()).toBe('duplicate')
    await settle()
    expect(Toast.show).toHaveBeenCalledTimes(1)
  })
})

// The positive control: the notifier is mounted and listening on this bus.
test('a received plain BasicMessage on the same bus: a toast, with its text', async () => {
  const record = new DidCommBasicMessageRecord({
    connectionId: 'conn-1',
    role: DidCommBasicMessageRole.Receiver,
    content: 'see you at noon',
    sentTime: new Date().toISOString(),
  })
  bus.emit(agent.context, {
    type: DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged,
    payload: { basicMessageRecord: record },
  })
  await settle()
  expect(toasted()).toEqual([expect.objectContaining({ text1: 'Ana', text2: 'see you at noon' })])
})
