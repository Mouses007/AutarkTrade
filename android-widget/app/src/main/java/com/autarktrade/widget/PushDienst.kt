package com.autarktrade.widget

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import kotlin.concurrent.thread

/**
 * Empfänger der Sofort-Zustellung. Der UnifiedPush-Verteiler auf dem Handy
 * (die ntfy-App) hält die Verbindung zu seinem Server und weckt diesen Dienst,
 * sobald AutarkTrade einen Chart-Alarm an unsere Adresse schickt — auch aus Doze.
 *
 * Nur Nachrichten, die mit unserem Schlüssel entschlüsseln (`decrypted`), zählen:
 * die ntfy-Adresse ist öffentlich erreichbar, und eine unverschlüsselte Nachricht
 * könnte jeder schicken, der sie kennt.
 */
class PushDienst : PushService() {

    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        val keys = endpoint.pubKeySet
        if (keys == null) {
            // Ohne Schlüssel könnte der Server nicht verschlüsseln — und unverschlüsselt nehmen wir nichts an.
            Prefs.saveSofortStatus(this, "Verteiler liefert keine Schlüssel")
            return
        }
        Prefs.saveSofortEndpoint(this, endpoint.url, keys.pubKey, keys.auth)
        Prefs.saveSofortStatus(this, "angemeldet, trage beim Server ein …")
        android.util.Log.d("TJWidget", "Sofort-Zustellung: neue Adresse ${endpoint.url}")
        val ctx = applicationContext
        thread(name = "sofort-anmelden") { ChartAlarme.sofortAnServer(ctx, true) }
    }

    override fun onMessage(message: PushMessage, instance: String) {
        if (!message.decrypted) {
            android.util.Log.w("TJWidget", "Sofort-Zustellung: Nachricht nicht entschlüsselbar — verworfen")
            return
        }
        ChartAlarme.empfangen(applicationContext, String(message.content, Charsets.UTF_8))
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        Prefs.saveSofortStatus(this, "Anmeldung bei ntfy fehlgeschlagen: $reason")
    }

    override fun onUnregistered(instance: String) {
        val ctx = applicationContext
        thread(name = "sofort-abmelden") {
            ChartAlarme.sofortAnServer(ctx, false)
            Prefs.clearSofortEndpoint(ctx)
            Prefs.saveSofortStatus(ctx, "abgemeldet")
        }
    }
}
