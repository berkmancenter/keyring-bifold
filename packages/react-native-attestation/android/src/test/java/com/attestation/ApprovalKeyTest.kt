package com.attestation

import android.security.keystore.KeyProperties
import androidx.biometric.BiometricPrompt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The approval key's self-check and its reasons, as plain functions: what the Keystore reports of a key decides
 * whether the phone may call it biometric-gated, and every failure reaches the app as lost, cancelled or unavailable.
 */
class ApprovalKeyTest {
  @Test
  fun `a per-use, strong-biometric-only, enrolment-bound key in secure hardware passes`() {
    assertTrue(ApprovalKey.failedChecks(0, KeyProperties.AUTH_BIOMETRIC_STRONG, true, true).isEmpty())
  }

  @Test
  fun `before API 30 a per-use key reports -1 and no type, and passes`() {
    assertTrue(ApprovalKey.failedChecks(-1, null, true, true).isEmpty())
  }

  @Test
  fun `a key react-native-keychain would make fails - a window, the device PIN, no enrolment binding`() {
    val failed = ApprovalKey.failedChecks(
      5,
      KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
      false,
      true,
    )
    assertEquals(3, failed.size)
    assertTrue(failed[0].contains("5s"))
  }

  @Test
  fun `a key outside secure hardware fails, whatever else it is`() {
    assertEquals(listOf("not in secure hardware"), ApprovalKey.failedChecks(0, KeyProperties.AUTH_BIOMETRIC_STRONG, true, false))
  }

  @Test
  fun `a cancelled prompt is cancelled, any other prompt error unavailable`() {
    for (code in listOf(BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED))
      assertEquals(ApprovalKey.CANCELLED, ApprovalKey.reasonForPromptError(code))
    for (code in listOf(BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_HW_UNAVAILABLE))
      assertEquals(ApprovalKey.UNAVAILABLE, ApprovalKey.reasonForPromptError(code))
  }

  @Test
  fun `hex round-trips the 32-byte secret`() {
    val hex = "00ff10a5".repeat(8)
    assertEquals(hex, ApprovalKey.hex(ApprovalKey.unhex(hex)))
  }
}
