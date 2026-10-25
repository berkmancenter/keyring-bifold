/**
 * The words a screen shows for an operation that is not available, chosen from the service's reason and
 * never guessed by the screen. Three gaps are told apart so a person (and a reviewer) can see whose gap it
 * is: Keyring has not built it ("Coming soon"), nothing upstream serves it ("Not available yet"), or this
 * person's agent is too old ("Your agent needs an update"). A community too old for it has its own line.
 *
 * @module rooms/components/roomsStatusText
 */
import type { TFunction } from 'i18next'

import type { OperationStatus, RoomsReason } from '../types'

const KEY: Record<Exclude<RoomsReason, 'ok' | 'sample'>, string> = {
  clientNotBuilt: 'Rooms.ComingSoon',
  notBuiltUpstream: 'Rooms.NotAvailableYet',
  agentDoesNotServe: 'Rooms.AgentNeedsUpdate',
  communityDoesNotServe: 'Rooms.CommunityNeedsUpdate',
  adminOnly: 'Rooms.AdminOnly',
  noAgentLinked: 'Rooms.NoAgentLinked',
  agentUnknown: 'Rooms.AgentUnknown',
}

/** The status line for an operation; undefined when it is available (on real or sample data). */
export function roomsStatusText(t: TFunction, status: OperationStatus): string | undefined {
  if (status.status === 'available') return undefined
  if (status.reason === 'ok' || status.reason === 'sample') return undefined
  return t(KEY[status.reason]) as string
}
