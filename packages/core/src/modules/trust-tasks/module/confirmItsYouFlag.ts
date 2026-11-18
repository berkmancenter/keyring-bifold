/**
 * The switch for "Confirm it's you" (confirmItsYou.ts): asking a contact to confirm, with their phone's lock, that a
 * call or message in their name is really them. On for everyone (Alberto, 2026-11-18): it shipped behind a developer
 * setting, off unless the app turned it on at start-up, and is now part of the app. An app no longer sets it from
 * anything saved on the phone, so a phone that had saved "off" while it was a demo comes out on like every other.
 *
 * With it off, nothing is offered on a contact's page or in a chat, no request is sent, and one that arrives is
 * dropped unread (and logged).
 *
 * THE KILLS, for a release (an OTA included): {@link CONFIRM_ITS_YOU_REMOTE_OFF} turns it off for everyone, and
 * SEDI_KERI_REMOTE_OFF turns off every SEDI/KERI feature at once, this one with them. Either beats whatever was set.
 * Neither turns it on. Each is read at every check, so it takes effect at the next start with nothing to migrate.
 *
 * @module trust-tasks/module/confirmItsYouFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'

/** Set to true in a release to turn "Confirm it's you" off for everyone, whatever was saved. */
export const CONFIRM_ITS_YOU_REMOTE_OFF: { off: boolean } = { off: false }

/** What the release ships: on. */
export const CONFIRM_ITS_YOU_ON_BY_DEFAULT = true

let confirmItsYouEnabled: boolean = CONFIRM_ITS_YOU_ON_BY_DEFAULT

/**
 * Turn "Confirm it's you" on or off for this run. Nothing in the app calls it from a saved setting any more; it is
 * what a test uses, and what an app that wants its own off switch would.
 */
export function setConfirmItsYouEnabled(enabled: boolean): void {
  confirmItsYouEnabled = enabled
}

/** On (as shipped, unless this run turned it off), and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isConfirmItsYouEnabled(): boolean {
  return confirmItsYouEnabled && !CONFIRM_ITS_YOU_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
