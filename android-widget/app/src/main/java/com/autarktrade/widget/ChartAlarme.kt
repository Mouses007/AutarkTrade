package com.autarktrade.widget

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Locale

/**
 * Chart-Alarme als Android-Benachrichtigung — ohne Firebase, ohne Google-Dienste.
 *
 * Der Weg: das Gerät FRAGT. Ein selbst gehosteter Server kann ein Handy nicht von
 * sich aus wecken; dafür bräuchte es eine Verbindung, die das Handy dauerhaft offen
 * hält (das macht die ntfy-App, die AutarkTrade schon als Kanal kennt). Hier stellt
 * ein AlarmManager-Wecker im eingestellten Takt (1–15 min) einen Abruf von
 * `GET /api/esp32/alarme?seit=…` und meldet, was neu ist.
 *
 * Ehrlich zur Verzögerung:
 *  - Bildschirm an oder Gerät in Bewegung: mit „Genaue Wecker" höchstens ein Takt
 *    (Vorgabe 2 min); ohne darf Android jeden Wecker um bis zu ¾ Takt schieben
 *    (gemessen: 2-min-Wecker mit Fenster +1:30).
 *  - Doze (Gerät liegt still, Bildschirm aus): Android lässt Wecker mit
 *    allow-while-idle nur noch etwa alle 9–15 min zu — ein Alarm kann dann so
 *    lange liegen. Mit „Genaue Wecker" und ohne Akku-Optimierung wird es besser,
 *    nicht sofort. Wer Sekunden braucht, nimmt den ntfy-Kanal.
 *
 * Doppelt meldet nichts: der Server liefert jede Auslösung mit der Kennung
 * `alarmId-t`; wir fragen mit 3 min Überlappung (der Verlaufseintrag entsteht
 * erst nach der Zustellung an ntfy/Telegram und kann eine ältere Zeit tragen)
 * und merken uns die letzten 400 Kennungen.
 */
object ChartAlarme {

    const val KANAL_CHART = "chart_alarme"
    const val KANAL_MOMENTUM = "chart_momentum"
    private const val GRUPPE = "autarktrade_alarme"
    private const val ID_SAMMEL = 7000
    const val ACTION_ABRUF = "com.autarktrade.widget.ACTION_ALARM_ABRUF"
    private const val UEBERLAPPUNG_MS = 3 * 60 * 1000L
    /** Mehr Einzelmeldungen auf einmal wären Lärm — der Rest steht in der Sammelmeldung. */
    private const val MAX_EINZELN = 6

    val ART_NAME = mapOf("preis" to "Preisalarm", "linie" to "Linienalarm", "zone" to "Zonenalarm", "momentum" to "Momentum")
    private val VIBRATION = longArrayOf(0, 180, 120, 180)

    data class Ausloesung(
        val id: String, val art: String, val zeit: Long, val symbol: String,
        val markt: String, val titel: String, val text: String,
    )

    // ── Kanäle ───────────────────────────────────────────────────────────

    /** Zwei Kanäle, damit Ton/Wichtigkeit für Momentum getrennt einstellbar sind. */
    fun kanaeleAnlegen(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val ton = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        fun kanal(id: String, name: String, beschreibung: String) =
            NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
                description = beschreibung
                enableVibration(true)
                vibrationPattern = VIBRATION
                enableLights(true)
                lightColor = ContextCompat.getColor(ctx, R.color.accent)
                setSound(ton, audio)
            }
        nm.createNotificationChannel(kanal(KANAL_CHART, ctx.getString(R.string.kanal_chart), ctx.getString(R.string.kanal_chart_info)))
        nm.createNotificationChannel(kanal(KANAL_MOMENTUM, ctx.getString(R.string.kanal_momentum), ctx.getString(R.string.kanal_momentum_info)))
    }

    fun darfMelden(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    // ── Wecker ───────────────────────────────────────────────────────────

    private fun weckIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).setAction(ACTION_ABRUF)
        return PendingIntent.getBroadcast(ctx, 77, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /**
     * Nächsten Abruf planen (one-shot, wird nach jedem Abruf neu gesetzt).
     * Genau, wenn der Nutzer „Genaue Wecker" erlaubt hat — sonst ungenau; beide
     * mit allow-while-idle, damit sie auch im Doze überhaupt feuern.
     */
    fun planen(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        if (!Prefs.alarmeAn(ctx) || !Prefs.alarmVerbunden(ctx)) { am.cancel(weckIntent(ctx)); return }
        val um = SystemClock.elapsedRealtime() + Prefs.alarmTaktMin(ctx) * 60_000L
        if (am.canScheduleExactAlarms()) {
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, um, weckIntent(ctx))
        } else {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, um, weckIntent(ctx))
        }
    }

    fun abbrechen(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java)?.cancel(weckIntent(ctx))
    }

    /**
     * Rückfallebene: ist der Wecker-Kette etwas zugestossen (App-Standby, Hersteller-
     * Akkusparer wie Sonys STAMINA), stösst der 15-min-Refresh des Widgets sie wieder
     * an. Nur wenn der letzte Versuch deutlich überfällig ist — sonst schöbe jeder
     * Widget-Refresh den nächsten Abruf hinaus.
     */
    fun nachholen(ctx: Context) {
        if (!Prefs.alarmeAn(ctx) || !Prefs.alarmVerbunden(ctx)) return
        val ueberfaellig = System.currentTimeMillis() - Prefs.alarmLetzterAbruf(ctx) > Prefs.alarmTaktMin(ctx) * 2 * 60_000L + 60_000L
        if (!ueberfaellig) return
        android.util.Log.d("TJWidget", "Alarm-Abruf überfällig → nachholen")
        abrufen(ctx)
        planen(ctx)
    }

    // ── Abruf ────────────────────────────────────────────────────────────

    /**
     * Ein Abruf. Blockiert (Netz) — nie auf dem Main-Thread. Wirft nicht; ein Fehler
     * landet in den Prefs und wird in den Einstellungen angezeigt.
     * @return Zahl neu gemeldeter Auslösungen, oder -1 bei Fehler.
     */
    /** Abruf und Sofort-Zustellung teilen die Liste gemeldeter Kennungen — nie gleichzeitig daran. */
    private val sperre = Any()

    fun abrufen(ctx: Context): Int = synchronized(sperre) { abrufenGesperrt(ctx) }

    private fun abrufenGesperrt(ctx: Context): Int {
        if (!Prefs.alarmeAn(ctx) || !Prefs.alarmVerbunden(ctx)) return 0
        return try {
            val seitAlt = Prefs.alarmSeit(ctx)
            val erster = seitAlt == 0L
            val seit = if (erster) 0L else (seitAlt - UEBERLAPPUNG_MS).coerceAtLeast(0L)
            val json = ApiClient.fetchAlarme(Prefs.alarmHost(ctx), Prefs.alarmPort(ctx), Prefs.alarmKey(ctx), seit, Prefs.alarmArten(ctx))
            val obj = JSONObject(json)
            val liste = parse(obj)
            val gesehen = Prefs.alarmGesehen(ctx)
            val bekannt = gesehen.toHashSet()
            val neu = liste.filter { it.id !in bekannt }
            // Erster Abruf: nur merken. Sonst meldete das Einschalten die letzten 50 Alarme auf einmal.
            if (!erster && neu.isNotEmpty()) melden(ctx, neu)
            Prefs.saveAlarmStand(ctx, obj.optLong("jetzt", System.currentTimeMillis()), gesehen + neu.map { it.id }.reversed())
            android.util.Log.d("TJWidget", "Alarm-Abruf: ${liste.size} geliefert, ${neu.size} neu${if (erster) " (erster Abruf, still)" else ""}")
            if (erster) 0 else neu.size
        } catch (e: Exception) {
            Prefs.saveAlarmFehler(ctx, e.message ?: "Fehler")
            android.util.Log.w("TJWidget", "Alarm-Abruf FEHLER: ${e.message}")
            -1
        }
    }

    private fun parse(obj: JSONObject): List<Ausloesung> {
        val arr = obj.optJSONArray("alarme") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { ausloesung(it) } }
    }

    private fun ausloesung(a: JSONObject): Ausloesung? {
        val id = a.optString("id")
        if (id.isBlank()) return null
        return Ausloesung(
            id = id, art = a.optString("art"), zeit = a.optLong("zeit"),
            symbol = a.optString("symbol"), markt = a.optString("markt", "futures"),
            titel = a.optString("titel"), text = a.optString("text"),
        )
    }

    // ── Sofort-Zustellung (UnifiedPush) ─────────────────────────────────

    /**
     * Eine Nachricht des Servers über ntfy: dieselbe Form wie ein Eintrag aus
     * /api/esp32/alarme. Nur entschlüsselte Nachrichten kommen hier an (PushDienst
     * verwirft den Rest) — eine Fälschung über die öffentliche ntfy-Adresse gibt es nicht.
     */
    fun empfangen(ctx: Context, json: String) = synchronized(sperre) {
        if (!Prefs.alarmeAn(ctx)) return@synchronized
        val a = try { ausloesung(JSONObject(json)) } catch (e: Exception) { null } ?: return@synchronized
        Prefs.setSofortLetzte(ctx, System.currentTimeMillis())
        if (a.art !in Prefs.alarmArten(ctx)) return@synchronized
        if (a.id in Prefs.alarmGesehen(ctx).toHashSet()) return@synchronized   // schon per Abruf gemeldet
        melden(ctx, listOf(a))
        Prefs.merkeGesehen(ctx, listOf(a.id))
        android.util.Log.d("TJWidget", "Sofort-Zustellung: ${a.id} gemeldet")
    }

    /** Adresse + Schlüssel beim Server eintragen (oder austragen). Blockiert — nie auf dem Main-Thread. */
    fun sofortAnServer(ctx: Context, an: Boolean) {
        val endpoint = Prefs.sofortEndpoint(ctx)
        if (endpoint.isBlank() || !Prefs.alarmVerbunden(ctx)) return
        try {
            ApiClient.meldePush(Prefs.alarmHost(ctx), Prefs.alarmPort(ctx), Prefs.alarmKey(ctx), an,
                endpoint, Prefs.sofortP256dh(ctx), Prefs.sofortAuth(ctx), android.os.Build.MODEL ?: "")
            Prefs.saveSofortStatus(ctx, if (an) "eingetragen" else "ausgetragen")
        } catch (e: Exception) {
            Prefs.saveSofortStatus(ctx, "Server: ${e.message}")
        }
    }

    // ── Benachrichtigungen ───────────────────────────────────────────────

    /** Neueste zuerst geliefert → älteste zuerst melden, damit die neueste oben liegt. */
    private fun melden(ctx: Context, neu: List<Ausloesung>) {
        if (!darfMelden(ctx)) return
        kanaeleAnlegen(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val einzeln = neu.take(MAX_EINZELN).reversed()
        for (a in einzeln) nm.notify(a.id.hashCode(), baue(ctx, a))
        if (neu.size > 1) nm.notify(ID_SAMMEL, sammel(ctx, neu))
    }

    /** Tipp → Web-App im Browser auf /chart?symbol=…; ohne Symbol der Chart-Arbeitsplatz. */
    private fun chartLink(ctx: Context, a: Ausloesung?): PendingIntent {
        val basis = "http://${Prefs.alarmHost(ctx)}:${Prefs.alarmPort(ctx)}/chart"
        val url = if (a == null || a.symbol.isBlank()) basis
            else "$basis?symbol=${Uri.encode(a.symbol)}${if (a.markt == "spot") "&markt=spot" else ""}"
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(ctx, (a?.id ?: "sammel").hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun baue(ctx: Context, a: Ausloesung): Notification {
        val kanal = if (a.art == "momentum") KANAL_MOMENTUM else KANAL_CHART
        val farbe = ContextCompat.getColor(ctx, R.color.accent)
        return Notification.Builder(ctx, kanal)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setColor(farbe)
            .setContentTitle(a.titel.ifBlank { a.symbol })
            .setContentText(a.text.lineSequence().firstOrNull() ?: "")
            .setStyle(Notification.BigTextStyle().bigText(a.text))
            .setSubText(ART_NAME[a.art] ?: a.art)
            .setWhen(if (a.zeit > 0) a.zeit else System.currentTimeMillis())
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setGroup(GRUPPE)
            .setAutoCancel(true)
            .setContentIntent(chartLink(ctx, a))
            .build()
    }

    private fun sammel(ctx: Context, neu: List<Ausloesung>): Notification {
        val stil = Notification.InboxStyle()
        neu.take(MAX_EINZELN).forEach { stil.addLine(it.titel) }
        if (neu.size > MAX_EINZELN) stil.setSummaryText(ctx.getString(R.string.n_weitere, neu.size - MAX_EINZELN))
        return Notification.Builder(ctx, KANAL_CHART)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setColor(ContextCompat.getColor(ctx, R.color.accent))
            .setContentTitle(ctx.getString(R.string.n_sammel, neu.size))
            .setStyle(stil)
            .setGroup(GRUPPE)
            .setGroupSummary(true)
            .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .setContentIntent(chartLink(ctx, null))
            .build()
    }

    /** Testmeldung aus den Einstellungen — prüft Kanal, Ton, Vibration und Tipp-Ziel. */
    fun testMeldung(ctx: Context) {
        kanaeleAnlegen(ctx)
        val a = Ausloesung(
            id = "test-${System.currentTimeMillis()}", art = "preis", zeit = System.currentTimeMillis(),
            symbol = "BTCUSDT", markt = "futures",
            titel = ctx.getString(R.string.n_test_titel),
            text = ctx.getString(R.string.n_test_text, String.format(Locale.GERMAN, "%d", Prefs.alarmTaktMin(ctx))),
        )
        ctx.getSystemService(NotificationManager::class.java)?.notify(ID_SAMMEL + 1, baue(ctx, a))
    }
}
