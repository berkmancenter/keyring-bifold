/**
 * The eventIds this phone is sending right now, per connection.
 *
 * A sent event's record is stored only after its send succeeds (send.ts), so
 * a failed send leaves nothing that looks delivered. Between the two, a fast
 * peer could answer with the same eventId before the record exists, and
 * inbound's check for a reused eventId would not see it. inbound.ts checks
 * this set as well as the stored records.
 *
 * @module chat/sending
 */

const inFlight = new Set<string>()
const key = (connectionId: string, eventId: string) => `${connectionId}\u0000${eventId}`

/** Run `send` with `eventId` marked as being sent on `connectionId`, until it settles. */
export async function whileSending<T>(connectionId: string, eventId: string, send: () => Promise<T>): Promise<T> {
  const k = key(connectionId, eventId)
  inFlight.add(k)
  try {
    return await send()
  } finally {
    inFlight.delete(k)
  }
}

/** Whether `eventId` is being sent on `connectionId` right now. */
export function isBeingSent(connectionId: string, eventId: string): boolean {
  return inFlight.has(key(connectionId, eventId))
}
