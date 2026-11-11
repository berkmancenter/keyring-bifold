/**
 * The State roots this phone trusts for a Guardian card (trusted-approver plan, stage 2, S1), each with the name Who
 * approves shows. A card is shown as verified only when its chain ends at one of these, and the name shown is ours,
 * never the sender's.
 *
 * A release trusts none: empty, so nothing verifies and every card reads "Couldn't verify the state card". A
 * Developer build (`__DEV__`) trusts the K0 test root only, the keripy kit the tests check against
 * (sedi/__tests__/fixtures/k0-utah-v2). Real State roots come from did:webs (IN-619), not from this list.
 *
 * @module sedi/guardian/stateRoots
 */

export interface StateRoot {
  /** The root's KERI AID. */
  aid: string
  /** What Who approves calls it: "Guardian, verified by <name>". */
  name: string
}

/** The K0 kit's State root ("roy"): a test root, trusted in Developer builds only. */
export const K0_TEST_ROOT: StateRoot = { aid: 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6', name: 'K0 test state' }

/**
 * The K0 kit's ward ("sam"): what a Developer sets as this phone's ward to check K0 cards. Not a binding to the
 * person: a real ward is the person's own KERI AID, which waits for stage 3 (KH-P3).
 */
export const K0_TEST_WARD = 'IFDf7z58Wp19EQ-EjCviVU2sgmFnjecWqCEaNsAz8lq6'

/** The roots for a build: Developer builds the K0 test root, a release none. */
export function stateRootsFor(developerBuild: boolean): StateRoot[] {
  return developerBuild ? [K0_TEST_ROOT] : []
}

/** The roots this build trusts (read at each check, never at load). */
export function trustedStateRoots(): StateRoot[] {
  return stateRootsFor(typeof __DEV__ !== 'undefined' && __DEV__ === true)
}
