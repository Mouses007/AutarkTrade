package com.autarktrade.widget

import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Minimal networking layer. One GET to the public, key-authenticated ESP32 endpoint.
 * No cookies, no session — the X-ESP32-Key header is the entire auth, so this is
 * unaffected by AutarkTrade's optional password gate.
 */
object ApiClient {

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

    /**
     * Returns the raw JSON body on success, or throws on network/HTTP error.
     * force=1 → das Widget zeigt immer den eigenen Zeitraum (all-time), unabhängig
     * vom serverseitigen esp32Filter (der weiterhin die ESP-Displays steuert).
     */
    fun fetch(host: String, port: String, key: String, filter: String): String {
        val url = "http://$host:$port/api/esp32/display?filter=$filter&force=1"
        val req = Request.Builder()
            .url(url)
            .header("X-ESP32-Key", key)
            .get()
            .build()

        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                val hint = when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Endpoint nicht gefunden (404)"
                    else -> "HTTP ${resp.code}"
                }
                throw RuntimeException(hint)
            }
            return body
        }
    }

    /**
     * Auslösungen der Chart-Alarme seit [seit] (Serverzeit in ms). Gleiche Auth wie
     * /display. Rückgabe: rohes JSON {jetzt, alarme:[…]}.
     */
    fun fetchAlarme(host: String, port: String, key: String, seit: Long, arten: Set<String>): String {
        val url = "http://$host:$port/api/esp32/alarme?seit=$seit&arten=${arten.sorted().joinToString(",")}"
        val req = Request.Builder().url(url).header("X-ESP32-Key", key).get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                throw RuntimeException(when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Server zu alt — /api/esp32/alarme fehlt (404)"
                    else -> "HTTP ${resp.code}"
                })
            }
            return body
        }
    }

    /**
     * Sofort-Zustellung beim Server an- (POST) oder abmelden (DELETE). Der Server
     * verschlüsselt jede Auslösung mit p256dh/auth und POSTet sie an [endpoint].
     */
    fun meldePush(host: String, port: String, key: String, an: Boolean,
                  endpoint: String, p256dh: String = "", auth: String = "", geraet: String = "") {
        val json = org.json.JSONObject().put("endpoint", endpoint)
        if (an) json.put("p256dh", p256dh).put("auth", auth).put("geraet", geraet)
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("http://$host:$port/api/esp32/push").header("X-ESP32-Key", key)
            .method(if (an) "POST" else "DELETE", body).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw RuntimeException(when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Server zu alt — /api/esp32/push fehlt (404)"
                    400 -> "abgelehnt: ${resp.body?.string()?.take(80)}"
                    else -> "HTTP ${resp.code}"
                })
            }
        }
    }
}
