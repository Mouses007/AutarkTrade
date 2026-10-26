package com.autarktrade.widget

import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * HTTPS gegen die eigene AutarkTrade-CA (Trust on first use mit Bestätigung).
 *
 * Der Server liefert seine CA ohne Anmeldung unter `GET http://host:8080/api/esp32/ca`
 * als `{pem, sha256}`. Die App rechnet den Fingerabdruck selbst nach (der mitgeschickte
 * Wert ist nur eine Gegenprobe — wer die Verbindung fälscht, fälscht auch ihn), zeigt ihn
 * an und speichert die CA erst nach Bestätigung durch den Nutzer: stimmt er mit
 * Einstellungen › Allgemein › HTTPS in der Web-App überein, ist es die echte.
 *
 * Danach ist genau diese CA der einzige Vertrauensanker (eigener KeyStore → eigener
 * TrustManager): weder die System-CAs noch vom Nutzer installierte Zertifikate zählen.
 * Die Hostnamen-Prüfung (auch IP-Adressen im SAN) macht OkHttp wie gewohnt.
 *
 * Bewusst nur java.* — die reine Logik (PEM, Fingerabdruck) läuft so auch auf der JVM.
 */
object Kopplung {

    /** Erstes `CERTIFICATE`-PEM-Stück → DER; null, wenn keins drin ist oder Base64 kaputt. */
    fun pemZuDer(pem: String): ByteArray? {
        val m = Regex("-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\\s]+)-----END CERTIFICATE-----").find(pem) ?: return null
        return try {
            java.util.Base64.getDecoder().decode(m.groupValues[1].replace(Regex("\\s"), ""))
                .takeIf { it.isNotEmpty() }
        } catch (e: IllegalArgumentException) { null }
    }

    /** SHA-256 über das DER, hex gross mit Doppelpunkten — dieselbe Form wie in der Web-App. */
    fun fingerabdruck(der: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(der).joinToString(":") { "%02X".format(it) }

    /** Vergleich unabhängig von Gross-/Kleinschreibung, Doppelpunkten und Leerzeichen. */
    fun gleich(a: String, b: String): Boolean {
        fun norm(s: String) = s.uppercase().filter { it in '0'..'9' || it in 'A'..'F' }
        return norm(a).isNotEmpty() && norm(a) == norm(b)
    }

    /** Erste und letzte [gruppen] Gruppen zum Abgleichen: „AB:CD:EF:01 … 9A:BC:DE:F0". */
    fun kurz(fp: String, gruppen: Int = 4): String {
        val g = fp.split(':')
        if (g.size <= gruppen * 2) return fp
        return g.take(gruppen).joinToString(":") + " … " + g.takeLast(gruppen).joinToString(":")
    }

    /** DER → X.509; wirft bei Unsinn. */
    fun zertifikat(der: ByteArray): X509Certificate =
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate

    /**
     * Antwort von /api/esp32/ca prüfen: PEM lesbar, ein X.509-Zertifikat, Fingerabdruck
     * selbst gerechnet und gleich dem mitgeschickten. Rückgabe: (PEM, Fingerabdruck).
     */
    fun pruefeAntwort(pem: String, sha256: String): Pair<String, String> {
        val der = pemZuDer(pem) ?: throw IllegalArgumentException("Server liefert kein CA-Zertifikat")
        try { zertifikat(der) } catch (e: Exception) { throw IllegalArgumentException("CA-Zertifikat unlesbar") }
        val fp = fingerabdruck(der)
        if (sha256.isNotBlank() && !gleich(fp, sha256))
            throw IllegalArgumentException("Fingerabdruck widersprüchlich — Verbindung manipuliert?")
        return pem.trim() to fp
    }

    /** SSLSocketFactory + TrustManager, die NUR der gekoppelten CA vertrauen. */
    fun tls(pem: String): Pair<SSLSocketFactory, X509TrustManager> {
        val der = pemZuDer(pem) ?: throw IllegalStateException("Gespeicherte CA unlesbar — neu koppeln")
        val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("autarktrade-ca", zertifikat(der))
        }
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(ks) }
        val tm = tmf.trustManagers.filterIsInstance<X509TrustManager>().first()
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), null) }
        return ssl.socketFactory to tm
    }
}
