/**
 * "Join a community" pressed on the preview's Communities with no agent
 * linked: the link comes first, and once it is made, Communities goes on to
 * Join by itself. Kept here, not in the link flow, so the link screens are
 * unchanged; nothing sets it while the preview is off.
 *
 * @module trust-tasks/preview/joinAfterLink
 */
let asked = false

export const joinAfterLink = {
  /** The person asked to join before an agent was linked. */
  ask(): void {
    asked = true
  },
  /** Whether they did, once: reading it clears it. */
  take(): boolean {
    const was = asked
    asked = false
    return was
  },
}
