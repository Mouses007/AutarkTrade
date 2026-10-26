package com.autarktrade.widget

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Verschlüsselt die Schlüsselfelder in den SharedPreferences (Audit SEC-AND-001).
 *
 * AES-256-GCM mit einem Schlüssel im AndroidKeyStore: er verlässt das Gerät nie
 * (auf den meisten Geräten liegt er im TEE), ein Backup oder `adb run-as` liefert
 * nur Chiffretext. Bewusst ohne androidx.security-crypto (abgekündigt).
 *
 * Gespeichert als `enc1:` + Base64(IV ‖ Chiffretext). Ältere Klartextwerte liest
 * [Prefs] weiter und schreibt sie beim ersten Lesen verschlüsselt zurück.
 */
object Tresor {
    const val PRAEFIX = "enc1:"
    private const val ALIAS = "autarktrade_prefs_v1"
    private const val IV_LAENGE = 12

    @Volatile private var schluesselCache: SecretKey? = null

    private fun schluessel(): SecretKey {
        schluesselCache?.let { return it }
        synchronized(this) {
            schluesselCache?.let { return it }
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val vorhanden = (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            val k = vorhanden ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(
                    KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
                generateKey()
            }
            schluesselCache = k
            return k
        }
    }

    /** Klartext → `enc1:…`; null, wenn der KeyStore versagt (dann bleibt der Aufrufer beim Klartext). */
    fun verschluesseln(klar: String): String? = try {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, schluessel())
        val iv = c.iv
        val chiffre = c.doFinal(klar.toByteArray(Charsets.UTF_8))
        PRAEFIX + Base64.encodeToString(iv + chiffre, Base64.NO_WRAP)
    } catch (e: Exception) {
        android.util.Log.w("TJWidget", "Tresor: Verschlüsseln fehlgeschlagen (${e.javaClass.simpleName})")
        null
    }

    /** `enc1:…` → Klartext; null, wenn nicht entschlüsselbar (z. B. KeyStore-Schlüssel weg). */
    fun entschluesseln(wert: String): String? = try {
        val roh = Base64.decode(wert.removePrefix(PRAEFIX), Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, schluessel(), GCMParameterSpec(128, roh, 0, IV_LAENGE))
        String(c.doFinal(roh, IV_LAENGE, roh.size - IV_LAENGE), Charsets.UTF_8)
    } catch (e: Exception) {
        android.util.Log.w("TJWidget", "Tresor: Entschlüsseln fehlgeschlagen (${e.javaClass.simpleName})")
        null
    }
}
