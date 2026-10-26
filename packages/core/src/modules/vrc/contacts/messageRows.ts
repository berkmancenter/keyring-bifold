/**
 * The Messages list's rows: one per contact, as the Contacts list groups them (contactLinks.ts), not one per
 * connection. Every exchange with someone is its own connection and relationship DID, so a merged contact has
 * several; the list showed each as its own conversation.
 *
 * A row stands for its contact's connections together: it shows and opens the one with the newest activity, and
 * carries every connection's id, for the unread count summed over them and for anything else that acts on the
 * whole contact. A connection whose relationship is not known (not read yet, or none recorded) is its own row:
 * grouping only ever joins rows, never hides one.
 *
 * @module vrc/contacts/messageRows
 */
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { type ContactLinks, contactIdOf } from './contactLinks'

export interface MessageRow {
  /** The contact's id, or the connection's own for a connection with no known relationship. */
  key: string
  /** The connection the row shows and opens: the one with the newest activity. */
  connection: DidCommConnectionRecord
  /** Every connection of the contact, the shown one included, in list order. */
  connectionIds: string[]
}

/**
 * Group `connections` (already filtered, in list order) by contact. `lastActivity` gives a connection's newest
 * activity in ms; ties keep the earlier connection. Rows keep the order of each contact's first connection.
 */
export function messageRows(
  connections: readonly DidCommConnectionRecord[],
  relationshipOf: ReadonlyMap<string, string> | undefined,
  links: ContactLinks,
  lastActivity: (connection: DidCommConnectionRecord) => number
): MessageRow[] {
  const groups = new Map<string, DidCommConnectionRecord[]>()
  for (const connection of connections) {
    const relationship = relationshipOf?.get(connection.id)
    const key = relationship ? `contact:${contactIdOf(links, relationship)}` : `connection:${connection.id}`
    groups.set(key, [...(groups.get(key) ?? []), connection])
  }
  return [...groups].map(([key, members]) => {
    let newest = members[0]
    for (const member of members.slice(1)) if (lastActivity(member) > lastActivity(newest)) newest = member
    return { key, connection: newest, connectionIds: members.map((m) => m.id) }
  })
}
