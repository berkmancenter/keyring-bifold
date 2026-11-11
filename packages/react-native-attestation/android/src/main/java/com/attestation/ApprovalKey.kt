package com.attestation

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricPrompt
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Where Keyring keeps its sign-in approval key on Android: the Ed25519 secret,
 * encrypted under an AES key the Keystore releases for one operation at a time,
 * through a strong biometric only (a CryptoObject-bound BiometricPrompt), and
 * that a new enrolment invalidates. No device credential, no time window.
 *
 * The key is checked after it is made ([failedChecks]): one that does not hold
 * all of that is deleted and refused, so the phone never says its approval key
 * is biometric-gated when it is not.
 *
 * The secret itself goes back to the app, which signs with it and wipes it
 * (core's uvKey.ts): the Keystore has Ed25519 only from API 33.
 */
object ApprovalKey {
  const val ALIAS = "keyring.signin-uv-wrap"
  const val PREFS = "keyring.approval-key"
  private const val PREF_IV = "iv"
  private const val PREF_SECRET = "secret"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_TAG_BITS = 128
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"

  /** The reasons a failure is told by, as core's uvKey.ts names them (UvKeyFailure). */
  const val LOST = "lost"
  const val CANCELLED = "cancelled"
  const val UNAVAILABLE = "unavailable"

  /**
   * What a key must be to be called biometric-gated, and which of it this one is not: empty when it passes.
   * `authType` is null before API 30, where per-use keys are biometric-only by construction.
   */
  fun failedChecks(validitySeconds: Int, authType: Int?, invalidatedByEnrollment: Boolean, secureHardware: Boolean): List<String> {
    val failed = mutableListOf<String>()
    if (validitySeconds > 0) failed += "usable for ${validitySeconds}s after one authentication"
    if (authType != null && authType != KeyProperties.AUTH_BIOMETRIC_STRONG) failed += "authenticators $authType, not strong biometrics only"
    if (!invalidatedByEnrollment) failed += "not invalidated by a new enrolment"
    if (!secureHardware) failed += "not in secure hardware"
    return failed
  }

  /** A BiometricPrompt error, as a reason. */
  fun reasonForPromptError(errorCode: Int): String = when (errorCode) {
    BiometricPrompt.ERROR_USER_CANCELED,
    BiometricPrompt.ERROR_NEGATIVE_BUTTON,
    BiometricPrompt.ERROR_CANCELED -> CANCELLED
    else -> UNAVAILABLE
  }

  fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  /** A new key, replacing any: per use, strong biometrics only, invalidated by a new enrolment. StrongBox when there is one. */
  fun create(): SecretKey {
    keyStore().let { if (it.containsAlias(ALIAS)) it.deleteEntry(ALIAS) }
    fun spec(strongBox: Boolean): KeyGenParameterSpec {
      val builder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        .setInvalidatedByBiometricEnrollment(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // 0: every use needs its own authentication, through a CryptoObject.
        builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      } else {
        // -1, before API 30: every use needs a biometric, and only a biometric.
        @Suppress("DEPRECATION")
        builder.setUserAuthenticationValidityDurationSeconds(-1)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        builder.setUnlockedDeviceRequired(true)
        if (strongBox) builder.setIsStrongBoxBacked(true)
      }
      return builder.build()
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    return try {
      generator.init(spec(strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P))
      generator.generateKey()
    } catch (e: StrongBoxUnavailableException) {
      generator.init(spec(strongBox = false))
      generator.generateKey()
    }
  }

  /** What the Keystore says the key is, as [failedChecks] reads it. */
  fun check(key: SecretKey): List<String> {
    val info = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE).getKeySpec(key, KeyInfo::class.java) as KeyInfo
    val authType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) info.userAuthenticationType else null
    val secure = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
        info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
    } else {
      @Suppress("DEPRECATION")
      info.isInsideSecureHardware
    }
    return failedChecks(info.userAuthenticationValidityDurationSeconds, authType, info.isInvalidatedByBiometricEnrollment, secure)
  }

  fun encryptCipher(key: SecretKey): Cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }

  /** The cipher that opens the kept secret, or null when there is none. Throws KeyPermanentlyInvalidatedException after a new enrolment. */
  fun decryptCipher(prefs: android.content.SharedPreferences): Cipher? {
    val iv = prefs.getString(PREF_IV, null) ?: return null
    if (prefs.getString(PREF_SECRET, null) == null) return null
    val key = keyStore().getKey(ALIAS, null) as? SecretKey ?: return null
    return Cipher.getInstance(TRANSFORMATION).apply {
      init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP)))
    }
  }

  fun keep(prefs: android.content.SharedPreferences, cipher: Cipher, sealed: ByteArray) {
    prefs.edit()
      .putString(PREF_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString(PREF_SECRET, Base64.encodeToString(sealed, Base64.NO_WRAP))
      .apply()
  }

  fun sealed(prefs: android.content.SharedPreferences): ByteArray =
    Base64.decode(prefs.getString(PREF_SECRET, null), Base64.NO_WRAP)

  fun forget(prefs: android.content.SharedPreferences) {
    prefs.edit().clear().apply()
    try {
      keyStore().let { if (it.containsAlias(ALIAS)) it.deleteEntry(ALIAS) }
    } catch (_: Exception) {}
  }

  /** A thrown error, as a reason: a key a new enrolment invalidated is lost. */
  fun reasonFor(e: Throwable): String = if (e is KeyPermanentlyInvalidatedException) LOST else UNAVAILABLE

  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

  fun unhex(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
