package com.autarktrade.widget

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.concurrent.CountDownLatch

/**
 * Sprachausgabe für Chart-Alarme: liest neue Auslösungen mit der Android-
 * Sprachausgabe (TextToSpeech, die Stimme des Geräts) vor.
 *
 * Einstellbar in der App: an/aus (Vorgabe aus) und ab welcher Dringlichkeit —
 * Info, Warnung oder nur Trade-Einstieg (die Stufe kommt vom Server, gesetzt im
 * Alarm-Dialog des Charts). Still bleibt sie, wenn das Handy lautlos/vibrierend
 * steht, „Bitte nicht stören" an ist oder ein Anruf läuft — wer das Handy stumm
 * schaltet, will auch keine Stimme hören.
 *
 * Jede Ansage baut eine eigene TextToSpeech-Instanz und gibt sie nach dem letzten
 * Satz wieder frei; der Rückgabewert (Latch) lässt den Abruf-Thread warten, bis
 * gesprochen ist, damit Android den Prozess nicht mitten im Satz beendet.
 */
object Sprache {

    val STUFEN = listOf("info", "warnung", "einstieg")
    private val RANG = mapOf("info" to 0, "warnung" to 1, "einstieg" to 2)
    /** Mehr am Stück wäre zu lang — der Rest wird als „und N weitere" angesagt. */
    private const val MAX_SAETZE = 3
    /** Erst den Benachrichtigungston ausklingen lassen. */
    private const val PAUSE_MS = 1200L

    @Volatile private var laufend: CountDownLatch? = null

    /** Neu gemeldete Auslösungen vorlesen, soweit eingestellt. Blockiert nicht. */
    fun vorlesen(ctx: Context, neu: List<ChartAlarme.Ausloesung>) {
        if (!Prefs.spracheAn(ctx) || !darfSprechen(ctx)) return
        val ab = RANG[Prefs.spracheAb(ctx)] ?: 2
        val faellig = neu.filter { (RANG[it.schwere] ?: 1) >= ab }
        if (faellig.isEmpty()) return
        val saetze = faellig.take(MAX_SAETZE).map { satz(it.schwere, it.titel.ifBlank { it.symbol }) }.toMutableList()
        if (faellig.size > MAX_SAETZE) saetze += "und ${faellig.size - MAX_SAETZE} weitere Alarme"
        laufend = sagen(ctx, saetze)
    }

    /** Wartet (höchstens [ms]) auf die laufende Ansage — nur aus einem Hintergrund-Thread. */
    fun abwarten(ms: Long = 20_000L) {
        try { laufend?.await(ms, java.util.concurrent.TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {}
    }

    /** Test aus den Einstellungen: spricht auch, wenn die Sprachausgabe aus ist. */
    fun test(ctx: Context) {
        laufend = sagen(ctx, listOf(satz(Prefs.spracheAb(ctx), "BTCUSDT Zonenalarm bei 65'000")), pause = false)
    }

    private fun darfSprechen(ctx: Context): Boolean {
        val am = ctx.getSystemService(AudioManager::class.java) ?: return false
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
        return am.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            am.mode == AudioManager.MODE_NORMAL &&
            nm.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL
    }

    /** „Trade-Einstieg. BTC Zonenalarm bei 65000" — ohne USDT und Tausender-Zeichen, die stören beim Vorlesen. */
    fun satz(schwere: String, titel: String): String {
        val vorne = when (schwere) { "einstieg" -> "Trade-Einstieg. "; "warnung" -> "Warnung. "; else -> "" }
        val rein = titel
            .replace(Regex("\\b([A-Z0-9]{2,}?)USDT\\b"), "$1")
            .replace(Regex("(?<=\\d)[’'](?=\\d)"), "")
            .replace("—", ",")
        return vorne + rein
    }

    private fun sagen(ctx: Context, saetze: List<String>, pause: Boolean = true): CountDownLatch {
        val ende = CountDownLatch(1)
        val app = ctx.applicationContext
        val halter = arrayOfNulls<TextToSpeech>(1)
        halter[0] = TextToSpeech(app) { status ->
            val tts = halter[0]
            if (tts == null || status != TextToSpeech.SUCCESS) { tts?.shutdown(); ende.countDown(); return@TextToSpeech }
            val de = tts.setLanguage(Locale.GERMAN)
            if (de == TextToSpeech.LANG_MISSING_DATA || de == TextToSpeech.LANG_NOT_SUPPORTED) tts.language = Locale.getDefault()
            tts.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            val letzte = "at-${saetze.size - 1}"
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                private fun fertig(id: String?) { if (id == letzte) { tts.shutdown(); ende.countDown() } }
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) = fertig(id)
                @Deprecated("Deprecated in Java") override fun onError(id: String?) = fertig(id)
                override fun onError(id: String?, code: Int) = fertig(id)
            })
            if (pause) tts.playSilentUtterance(PAUSE_MS, TextToSpeech.QUEUE_ADD, "at-pause")
            saetze.forEachIndexed { i, s -> tts.speak(s, TextToSpeech.QUEUE_ADD, null, "at-$i") }
        }
        return ende
    }
}
