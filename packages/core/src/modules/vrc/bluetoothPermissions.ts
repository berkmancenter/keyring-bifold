/**
 * The Bluetooth runtime permissions the locality radio phase needs, asked for
 * and checked in one place.
 *
 * Android 12 (API 31) and later: the native peripheral
 * (`react-native-locality-peripheral`, `hasBluetoothPeripheralPermissions`)
 * advertises only while it holds BOTH `BLUETOOTH_ADVERTISE` and
 * `BLUETOOTH_CONNECT`, and it never scans, so `BLUETOOTH_SCAN` is neither
 * declared nor asked for. The pre-flight sheet used to ask for ADVERTISE and
 * SCAN: CONNECT was never granted on a fresh install, the module quietly
 * declined to advertise, and every witnessed exchange lost its locality
 * check with nothing said (a tester's report, IN-128, 2026-10-06). Before
 * API 31 both are install-time permissions and always held.
 *
 * iOS: the one Bluetooth authorization, which react-native-permissions raises
 * by standing up a CBCentralManager — the same per-app authorization the
 * peripheral later runs under.
 */

import { Platform } from 'react-native'
import { PERMISSIONS, RESULTS, check, request } from 'react-native-permissions'

/** Android's runtime Bluetooth permissions arrived in API 31 (Android 12). */
const ANDROID_RUNTIME_BLUETOOTH_API = 31

/** What the Android peripheral needs, both of them (its manifest declares exactly these). */
export const ANDROID_LOCALITY_PERMISSIONS = [
  PERMISSIONS.ANDROID.BLUETOOTH_ADVERTISE,
  PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
] as const

const needsAndroidRuntimeGrant = () =>
  Platform.OS === 'android' && Number(Platform.Version) >= ANDROID_RUNTIME_BLUETOOTH_API

/** Ask for what the radio phase needs. True only if all of it is granted. */
export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return (await request(PERMISSIONS.IOS.BLUETOOTH)) === RESULTS.GRANTED
  }
  if (!needsAndroidRuntimeGrant()) return true
  let granted = true
  // One at a time: Android shows both under one "Nearby devices" prompt, and
  // the second request then answers at once.
  for (const permission of ANDROID_LOCALITY_PERMISSIONS) {
    granted = (await request(permission)) === RESULTS.GRANTED && granted
  }
  return granted
}

/**
 * The Android permissions the radio phase needs and this install does not
 * hold, without asking for them. Empty on iOS and before API 31 — nothing to
 * check there that the native module would refuse over. A check that throws
 * counts as not held, so the reason still reaches the log.
 */
export async function missingBluetoothPermissions(): Promise<string[]> {
  if (!needsAndroidRuntimeGrant()) return []
  const missing: string[] = []
  for (const permission of ANDROID_LOCALITY_PERMISSIONS) {
    const status = await check(permission).catch(() => undefined)
    if (status !== RESULTS.GRANTED) missing.push(permission)
  }
  return missing
}
