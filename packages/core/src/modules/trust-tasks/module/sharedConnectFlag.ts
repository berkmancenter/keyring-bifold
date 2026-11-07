/**
 * The developer switches for the shared-connect flow (relationship over TSP,
 * docs/plans/relationship-over-tsp-plan.md). The flow is a draft proposed in
 * dtgwg-vti-spec#86 and is not in the VTI links specification yet, so it is
 * off unless a developer turns it on: with it off, a shared-connect link is
 * answered exactly as any flow this build does not know ("This code needs a
 * newer version of the app.").
 *
 * A module-level pair of switches, like `setTspCarriageEnabled` in
 * `ceremony.ts`: the app sets them from its developer settings at start-up.
 *
 * A release can turn the flow off for everyone with SHARED_CONNECT_REMOTE_OFF
 * (sharedConnectRemoteOff.ts), whatever was saved; it never turns it on.
 *
 * @module trust-tasks/module/sharedConnectFlag
 */

import { SHARED_CONNECT_REMOTE_OFF } from './sharedConnectRemoteOff'

let sharedConnectEnabled = false
let sharedConnectLabelEnabled = false

/** Turn the shared-connect flow on or off (developer setting). */
export function setSharedConnectEnabled(enabled: boolean): void {
  sharedConnectEnabled = enabled
}

/** Whether a shared-connect link is read and carried to its confirm screen: switched on, and not turned off remotely. */
export function isSharedConnectEnabled(): boolean {
  return sharedConnectEnabled && !SHARED_CONNECT_REMOTE_OFF.connect
}

/**
 * Read `_label` from a shared-connect link. A separate switch because `_label`
 * is a proposed fifth reserved name that VTI-LNK-011 does not list yet (plan
 * D6): reading it before the specification adopts it is a deliberate choice.
 * Only meaningful while the flow itself is on.
 */
export function setSharedConnectLabelEnabled(enabled: boolean): void {
  sharedConnectLabelEnabled = enabled
}

export function isSharedConnectLabelEnabled(): boolean {
  return isSharedConnectEnabled() && sharedConnectLabelEnabled
}
