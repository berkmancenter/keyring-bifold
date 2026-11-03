/**
 * A post that cannot go however often it is sent again: refused on this phone for a reason that will not pass (no
 * host known for the room, no right to write, a kind of room Keyring does not write to yet), or refused by the agent
 * or the room's host as not worth retrying. Its bubble and notice say why, and offer no "Tap to try again": a tester
 * tapped one for an hour, each tap failing the same way before anything was sent (11-03).
 *
 * A refusal that may pass (the agent or the community not reached, a host's rate limit) is not one of these: the post
 * is offered again as before.
 *
 * @module rooms/postRefusal
 */
import type { TFunction } from 'i18next'

import { roomsStatusText } from './components/roomsStatusText'
import { RoomsRefused, RoomsUnavailable, type RoomsReason } from './types'

/** Why a post can't be sent: a reason found on this phone, or the code an agent or host refused it with. */
export type PostRefusal = { reason: RoomsReason } | { code: string; twoAuthorities: boolean }

/** Reasons that may pass by themselves: a post refused for one of these is offered again. */
const PASSING: ReadonlySet<RoomsReason> = new Set(['ok', 'sample', 'agentUnknown', 'communityUnreachable'])

/**
 * The agent holds two of the room's authority credentials for one persona and will not choose between them
 * (vta `rooms` attenuation, 277.8). It refuses every read and write in that room until one is gone, so no retry helps.
 */
export const holdsTwoAuthorities = (words: string): boolean => /more than one AuthorityCredential/i.test(words)

/** The refusal when it is one no retry can pass; undefined for anything worth sending again. */
export function permanentRefusal(e: unknown): PostRefusal | undefined {
  if (e instanceof RoomsUnavailable) return PASSING.has(e.reason) ? undefined : { reason: e.reason }
  if (e instanceof RoomsRefused && !e.retryable) return { code: e.code, twoAuthorities: holdsTwoAuthorities(e.message) }
  return undefined
}

/** "Not sent." and why, in plain words. */
export function postRefusalText(t: TFunction, refusal: PostRefusal): string {
  const why =
    'reason' in refusal
      ? refusal.reason === 'detailsNotLoaded'
        ? (t('Rooms.PostNoDetails') as string)
        : (roomsStatusText(t, { status: 'unavailable', reason: refusal.reason, detail: '' }, 'write') ??
          (t('Rooms.PostNotTaken') as string))
      : (t(refusal.twoAuthorities ? 'Rooms.PostTwoAuthorities' : 'Rooms.PostNotTaken') as string)
  return t('Rooms.PostNotSentWhy', { why, interpolation: { escapeValue: false } }) as string
}
