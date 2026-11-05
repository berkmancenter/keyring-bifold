/**
 * A plain BasicMessage that failed to send. Credo stores its record as sent before it sends (DidCommBasicMessagesApi
 * `sendMessage`) and leaves it there when the send throws, so without a mark it draws as an ordinary sent bubble. The
 * record is kept and marked, never deleted: an undeliverable message may still have reached someone, and the person
 * keeps what they wrote. Records from before this mark can't be told apart, so they stay as they are.
 *
 * @module chat/plainNotSent
 */
import type { Agent } from '@credo-ts/core'
import { DidCommBasicMessageRecord, DidCommBasicMessageRepository, MessageSendingError } from '@credo-ts/didcomm'

const NOT_SENT = 'keyringNotSent'

export const isPlainNotSent = (record: DidCommBasicMessageRecord): boolean => record.metadata.get(NOT_SENT) === true

/** Send `text` as a plain message; on failure, mark its record if there is one, and rethrow the send's own error. */
export async function sendPlainMessage(agent: Agent, connectionId: string, text: string): Promise<void> {
  try {
    await agent.modules.didcomm.basicMessages.sendMessage(connectionId, text)
  } catch (error) {
    await markNotSent(agent, error)
    throw error
  }
}

// Only Credo's send error says which record it was about; any other throw leaves the record unmarked. A mark that
// can't be written must not replace the send's error: the Chat screen acts on that.
async function markNotSent(agent: Agent, error: unknown): Promise<void> {
  if (!(error instanceof MessageSendingError)) return
  const record = error.outboundMessageContext.associatedRecord
  if (!(record instanceof DidCommBasicMessageRecord)) return
  try {
    record.metadata.set(NOT_SENT, true)
    await agent.dependencyManager.resolve(DidCommBasicMessageRepository).update(agent.context, record)
  } catch {
    agent.config?.logger?.warn('[Chat] a plain message not sent could not be marked')
  }
}
