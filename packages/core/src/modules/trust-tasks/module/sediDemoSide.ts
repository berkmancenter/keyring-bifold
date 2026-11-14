/**
 * Which side of the SEDI demo this phone took: the guardian (holds the card) or the ward (the person the card names),
 * or none. Set by "Set up as the guardian" / "Set up as the ward" and cleared by "Turn off the SEDI demo"
 * (developerTestState); the app sets it again at start-up from its saved Developer switches, as it does every switch
 * here (in memory only). The codes for a state office show only this side's code; with none set, both.
 *
 * @module trust-tasks/module/sediDemoSide
 */
export type SediDemoSide = 'guardian' | 'ward'

let side: SediDemoSide | null = null

/** Set this phone's demo side (null: none). */
export function setSediDemoSide(next: SediDemoSide | null): void {
  side = next
}

/** This phone's demo side, or null when none is set. */
export function sediDemoSide(): SediDemoSide | null {
  return side
}
