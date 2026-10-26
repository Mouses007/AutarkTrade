package com.autarktrade.widget

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * Minimal networking layer. One GET to the public, key-authenticated ESP32 endpoint.
 * No cookies, no session — the X-ESP32-Key header is the entire auth, so this is
 * unaffected by AutarkTrade's optional password gate.
 *
 * Seit 4.2.0-28 standardmässig HTTPS (Port 8443) gegen die gekoppelte AutarkTrade-CA
 * (siehe [Kopplung]). Ist HTTPS eingeschaltet, gibt es KEINEN Rückfall auf http —
 * sonst müsste ein Angreifer nur den TLS-Port sperren, um den Schlüssel im Klartext
 * mitzulesen. Klartext läuft nur, wenn der Nutzer HTTPS ausschaltet, und für das
 * Abholen der CA beim Koppeln (dort schützt der Fingerabdruck-Abgleich).
 */
object ApiClient {

    /** Wohin ein Aufruf geht: Basis-URL und der passende Client (mit oder ohne eigene CA). */
    class Ziel(val basis: String, val client: OkHttpClient, val tls: Boolean)

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        // Hartes Gesamt-Timeout über alle Phasen (Connect/Read/Retries) — bei einem
        // nicht erreichbaren Host endet der Call garantiert nach 10s statt zu hängen.
        .callTimeout(10, TimeUnit.SECONDS)
        // MUSS true sein (Default): der Server schließt idle Keep-alive-Verbindungen,
        // OkHttp greift dann eine tote Pool-Verbindung → "unexpected end of stream".
        // Mit Retry holt OkHttp automatisch eine frische Verbindung. (false war die
        // Ursache für die "Lotto"-Refreshes — ~jeder 2. Tap scheiterte nach 9ms.)
        .retryOnConnectionFailure(true)
        .build()

    // Client mit der gekoppelten CA — neu gebaut, sobald sich die gespeicherte CA ändert.
    @Volatile private var tlsCache: Pair<String, OkHttpClient>? = null

    private fun tlsClient(pem: String): OkHttpClient {
        tlsCache?.let { (p, c) -> if (p == pem) return c }
        val (fabrik, tm) = Kopplung.tls(pem)
        // newBuilder teilt Pool und Dispatcher; die Hostnamen-Prüfung bleibt OkHttps
        // Standard (OkHostnameVerifier, prüft auch IP-Adressen im SAN).
        val c = client.newBuilder().sslSocketFactory(fabrik, tm).build()
        tlsCache = pem to c
        return c
    }

    /**
     * Ziel für [host]: mit HTTPS `https://host:tlsPort` und nur der gekoppelten CA als
     * Vertrauensanker, sonst `http://host:httpPort`. HTTPS an, aber nicht gekoppelt:
     * Fehler — nie still auf http.
     */
    fun ziel(ctx: Context, host: String, httpPort: String,
             tls: Boolean = Prefs.tlsAn(ctx), tlsPort: String = Prefs.tlsPort(ctx)): Ziel {
        if (!tls) return Ziel("http://$host:$httpPort", client, false)
        val pem = Prefs.tlsCa(ctx)
        if (pem.isBlank()) throw RuntimeException("HTTPS nicht gekoppelt — in den Einstellungen „Neu koppeln“")
        return Ziel("https://$host:$tlsPort", tlsClient(pem), true)
    }

    /**
     * CA des Servers über http://host:httpPort/api/esp32/ca holen (ohne Schlüssel) und
     * prüfen. Rückgabe (PEM, Fingerabdruck) — gespeichert wird erst nach Bestätigung.
     */
    fun holeCa(host: String, httpPort: String): Pair<String, String> {
        val req = Request.Builder().url("http://$host:$httpPort/api/esp32/ca").get().build()
        val text = try {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) throw RuntimeException(when (resp.code) {
                    404 -> "Server zu alt — /api/esp32/ca fehlt (404). Server aktualisieren oder HTTPS ausschalten"
                    else -> "CA abholen: HTTP ${resp.code}"
                })
                resp.body?.string() ?: ""
            }
        } catch (e: java.net.ConnectException) {
            throw RuntimeException("Server nicht erreichbar (http://$host:$httpPort)")
        }
        if (text.length > 64 * 1024) throw RuntimeException("CA-Antwort zu gross")
        val json = try { org.json.JSONObject(text) } catch (e: Exception) { throw RuntimeException("CA-Antwort unlesbar") }
        return try {
            Kopplung.pruefeAntwort(json.optString("pem"), json.optString("sha256"))
        } catch (e: IllegalArgumentException) { throw RuntimeException(e.message) }
    }

    /**
     * Aufruf ausführen; TLS-Fehler werden in verständliche Sätze übersetzt. Der Text
     * landet im Widget und in den Einstellungen — kurz und mit dem nächsten Schritt.
     */
    private fun <T> ausfuehren(ziel: Ziel, req: Request, auswerten: (Response) -> T): T {
        val resp = try {
            ziel.client.newCall(req).execute()
        } catch (e: SSLPeerUnverifiedException) {
            throw RuntimeException("Zertifikat gilt nicht für diese Adresse — Host prüfen oder neu koppeln")
        } catch (e: SSLHandshakeException) {
            val zert = generateSequence(e as Throwable) { it.cause }
                .any { it is CertPathValidatorException || it is CertificateException }
            throw RuntimeException(if (zert) "Zertifikat passt nicht — neu koppeln" else "HTTPS-Verbindung abgelehnt (${e.message?.take(60)})")
        } catch (e: SSLException) {
            throw RuntimeException("Kein HTTPS auf diesem Port — HTTPS-Port prüfen (${e.message?.take(60)})")
        } catch (e: java.net.ConnectException) {
            throw RuntimeException(if (ziel.tls) "HTTPS-Port nicht erreichbar (${ziel.basis})" else "Server nicht erreichbar (${ziel.basis})")
        }
        return resp.use(auswerten)
    }

    /**
     * Returns the raw JSON body on success, or throws on network/HTTP error.
     * force=1 → das Widget zeigt immer den eigenen Zeitraum (all-time), unabhängig
     * vom serverseitigen esp32Filter (der weiterhin die ESP-Displays steuert).
     */
    fun fetch(ziel: Ziel, key: String, filter: String): String {
        val url = "${ziel.basis}/api/esp32/display?filter=$filter&force=1"
        val req = Request.Builder()
            .url(url)
            .header("X-ESP32-Key", key)
            .get()
            .build()

        return ausfuehren(ziel, req) { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                val hint = when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Endpoint nicht gefunden (404)"
                    else -> "HTTP ${resp.code}"
                }
                throw RuntimeException(hint)
            }
            body
        }
    }

    /**
     * Auslösungen der Chart-Alarme seit [seit] (Serverzeit in ms). Gleiche Auth wie
     * /display. Rückgabe: rohes JSON {jetzt, alarme:[…]}.
     */
    fun fetchAlarme(ziel: Ziel, key: String, seit: Long, arten: Set<String>): String {
        val url = "${ziel.basis}/api/esp32/alarme?seit=$seit&arten=${arten.sorted().joinToString(",")}"
        val req = Request.Builder().url(url).header("X-ESP32-Key", key).get().build()
        return ausfuehren(ziel, req) { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                throw RuntimeException(when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Server zu alt — /api/esp32/alarme fehlt (404)"
                    else -> "HTTP ${resp.code}"
                })
            }
            body
        }
    }

    /**
     * Sofort-Zustellung beim Server an- (POST) oder abmelden (DELETE). Der Server
     * verschlüsselt jede Auslösung mit p256dh/auth und POSTet sie an [endpoint].
     */
    fun meldePush(ziel: Ziel, key: String, an: Boolean,
                  endpoint: String, p256dh: String = "", auth: String = "", geraet: String = "") {
        val json = org.json.JSONObject().put("endpoint", endpoint)
        if (an) json.put("p256dh", p256dh).put("auth", auth).put("geraet", geraet)
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("${ziel.basis}/api/esp32/push").header("X-ESP32-Key", key)
            .method(if (an) "POST" else "DELETE", body).build()
        ausfuehren(ziel, req) { resp ->
            if (!resp.isSuccessful) {
                throw RuntimeException(when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Server zu alt — /api/esp32/push fehlt (404)"
                    400 -> "abgelehnt: ${resp.body?.string()?.take(80)}"
                    409 -> "Geräteliste voll — in AutarkTrade unter Einstellungen › ESP32 ein Gerät entfernen (409)"
                    429 -> "Zu viele Fehlversuche, gleich nochmal (429)"
                    else -> "HTTP ${resp.code}"
                })
            }
        }
    }
}
