package com.autarktrade.widget

import android.content.Context

/**
 * Thin SharedPreferences wrapper. Everything is keyed per appWidgetId so multiple
 * widget instances (e.g. different filters) stay independent. Stores both the
 * user config (host/port/key/filter) and the last fetched payload (cache).
 */
object Prefs {
    private const val FILE = "trading_widget_prefs"

    private fun sp(ctx: Context) =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // --- Config ---
    fun host(ctx: Context, id: Int): String = sp(ctx).getString("host_$id", "") ?: ""
    fun port(ctx: Context, id: Int): String = sp(ctx).getString("port_$id", "8080") ?: "8080"
    fun key(ctx: Context, id: Int): String = sp(ctx).getString("key_$id", "") ?: ""
    fun filter(ctx: Context, id: Int): String = sp(ctx).getString("filter_$id", "all") ?: "all"
    /** Welche Börse nach dem Aktualisieren oben steht. "auto" = Primär-Börse des Servers. */
    fun defaultBroker(ctx: Context, id: Int): String = sp(ctx).getString("defbroker_$id", "auto") ?: "auto"

    fun isConfigured(ctx: Context, id: Int): Boolean =
        host(ctx, id).isNotBlank() && key(ctx, id).isNotBlank()

    fun saveConfig(ctx: Context, id: Int, host: String, port: String, key: String, filter: String, defaultBroker: String) {
        sp(ctx).edit()
            .putString("host_$id", host.trim())
            .putString("port_$id", port.trim().ifBlank { "8080" })
            .putString("key_$id", key.trim())
            .putString("filter_$id", filter)
            .putString("defbroker_$id", defaultBroker)
            .apply()
    }

    // --- Transiente Börsen-Auswahl oben (per Tap auf eine Börse) ---
    // Wird bei jeder Aktualisierung gelöscht → Kopf fällt auf defaultBroker zurück.
    fun selectedBroker(ctx: Context, id: Int): String? = sp(ctx).getString("selbroker_$id", null)
    fun setSelectedBroker(ctx: Context, id: Int, broker: String) {
        sp(ctx).edit().putString("selbroker_$id", broker).apply()
    }
    fun clearSelectedBroker(ctx: Context, id: Int) {
        sp(ctx).edit().remove("selbroker_$id").apply()
    }

    // --- Cache (last successful payload) ---
    fun cachedJson(ctx: Context, id: Int): String? = sp(ctx).getString("cache_$id", null)
    fun updatedAt(ctx: Context, id: Int): Long = sp(ctx).getLong("updated_$id", 0L)
    fun lastError(ctx: Context, id: Int): String? = sp(ctx).getString("error_$id", null)

    fun saveCache(ctx: Context, id: Int, json: String, whenMs: Long) {
        sp(ctx).edit()
            .putString("cache_$id", json)
            .putLong("updated_$id", whenMs)
            .remove("error_$id")
            .apply()
    }

    fun saveError(ctx: Context, id: Int, message: String) {
        sp(ctx).edit().putString("error_$id", message).apply()
    }

    // --- Auto-Refresh-Entprellung (global, gegen die onUpdate→Expedited-Work→
    //     PackageChanged→APPWIDGET_UPDATE→onUpdate-Schleife) ---
    fun lastAutoRefresh(ctx: Context): Long = sp(ctx).getLong("last_auto_refresh", 0L)
    fun setLastAutoRefresh(ctx: Context, whenMs: Long) {
        sp(ctx).edit().putLong("last_auto_refresh", whenMs).apply()
    }

    // --- Balance-Sichtbarkeit (Augen-Toggle, pro Widget) ---
    fun hideBalance(ctx: Context, id: Int): Boolean = sp(ctx).getBoolean("hidebal_$id", false)
    fun setHideBalance(ctx: Context, id: Int, hide: Boolean) {
        sp(ctx).edit().putBoolean("hidebal_$id", hide).apply()
    }

    // --- Chart-Alarme (global, nicht je Widget: ein Gerät meldet jeden Alarm einmal,
    //     egal wie viele Widgets es hat; die App läuft auch ganz ohne Widget) ---
    const val TAKT_VORGABE_MIN = 2
    val ALLE_ARTEN = listOf("preis", "linie", "zone", "momentum")

    fun alarmeAn(ctx: Context): Boolean = sp(ctx).getBoolean("alarm_an", false)
    fun alarmTaktMin(ctx: Context): Int = sp(ctx).getInt("alarm_takt", TAKT_VORGABE_MIN)
    fun alarmArten(ctx: Context): Set<String> =
        sp(ctx).getStringSet("alarm_arten", null)?.toSet() ?: ALLE_ARTEN.toSet()
    fun alarmHost(ctx: Context): String = sp(ctx).getString("alarm_host", "") ?: ""
    fun alarmPort(ctx: Context): String = sp(ctx).getString("alarm_port", "8080") ?: "8080"
    fun alarmKey(ctx: Context): String = sp(ctx).getString("alarm_key", "") ?: ""
    fun alarmVerbunden(ctx: Context): Boolean = alarmHost(ctx).isNotBlank() && alarmKey(ctx).isNotBlank()

    fun saveAlarmConfig(ctx: Context, an: Boolean, taktMin: Int, arten: Set<String>,
                        host: String, port: String, key: String) {
        val alt = "${alarmHost(ctx)}:${alarmPort(ctx)}"
        val e = sp(ctx).edit()
            .putBoolean("alarm_an", an)
            .putInt("alarm_takt", taktMin)
            .putStringSet("alarm_arten", arten)
            .putString("alarm_host", host.trim())
            .putString("alarm_port", port.trim().ifBlank { "8080" })
            .putString("alarm_key", key.trim())
        // Anderer Server → anderer Verlauf: neu ansetzen, statt dessen alte Auslösungen zu melden.
        if (alt != "${host.trim()}:${port.trim().ifBlank { "8080" }}") e.remove("alarm_seit").remove("alarm_gesehen")
        e.apply()
    }

    /** Serverzeit des letzten erfolgreichen Abrufs (0 = noch nie → erster Abruf meldet nichts). */
    fun alarmSeit(ctx: Context): Long = sp(ctx).getLong("alarm_seit", 0L)
    /** Kennungen (alarmId-t) bereits gemeldeter Auslösungen, älteste zuerst. */
    fun alarmGesehen(ctx: Context): List<String> =
        (sp(ctx).getString("alarm_gesehen", "") ?: "").split('\n').filter { it.isNotBlank() }
    fun saveAlarmStand(ctx: Context, seit: Long, gesehen: List<String>) {
        sp(ctx).edit()
            .putLong("alarm_seit", seit)
            .putString("alarm_gesehen", gesehen.takeLast(400).joinToString("\n"))
            .putLong("alarm_abruf", System.currentTimeMillis())
            .remove("alarm_fehler")
            .apply()
    }
    /** Zeit des letzten Abrufversuchs (Erfolg oder Fehler, Gerätezeit). */
    fun alarmLetzterAbruf(ctx: Context): Long = sp(ctx).getLong("alarm_abruf", 0L)
    fun alarmFehler(ctx: Context): String? = sp(ctx).getString("alarm_fehler", null)
    fun saveAlarmFehler(ctx: Context, msg: String) {
        sp(ctx).edit().putString("alarm_fehler", msg).putLong("alarm_abruf", System.currentTimeMillis()).apply()
    }

    fun clear(ctx: Context, id: Int) {
        sp(ctx).edit()
            .remove("host_$id").remove("port_$id").remove("key_$id").remove("filter_$id")
            .remove("defbroker_$id").remove("selbroker_$id")
            .remove("cache_$id").remove("updated_$id").remove("error_$id")
            .remove("hidebal_$id")
            .apply()
    }
}
