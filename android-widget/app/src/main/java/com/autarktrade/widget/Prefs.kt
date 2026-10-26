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

    // --- Schlüsselfelder verschlüsselt (SEC-AND-001, siehe Tresor) ---
    // Lesen nimmt auch Klartext aus älteren Versionen an und schreibt ihn einmal
    // verschlüsselt zurück — kein Neueinrichten nach dem Update.
    private fun geheim(ctx: Context, name: String): String {
        val roh = sp(ctx).getString(name, "") ?: ""
        if (roh.isEmpty()) return ""
        if (roh.startsWith(Tresor.PRAEFIX)) return Tresor.entschluesseln(roh) ?: ""
        Tresor.verschluesseln(roh)?.let { sp(ctx).edit().putString(name, it).apply() }
        return roh
    }

    private fun android.content.SharedPreferences.Editor.putGeheim(name: String, wert: String) =
        putString(name, if (wert.isEmpty()) "" else Tresor.verschluesseln(wert) ?: wert)

    // --- Config ---
    fun host(ctx: Context, id: Int): String = sp(ctx).getString("host_$id", "") ?: ""
    fun port(ctx: Context, id: Int): String = sp(ctx).getString("port_$id", "8080") ?: "8080"
    fun key(ctx: Context, id: Int): String = geheim(ctx, "key_$id")
    fun filter(ctx: Context, id: Int): String = sp(ctx).getString("filter_$id", "all") ?: "all"
    /** Welche Börse nach dem Aktualisieren oben steht. "auto" = Primär-Börse des Servers. */
    fun defaultBroker(ctx: Context, id: Int): String = sp(ctx).getString("defbroker_$id", "auto") ?: "auto"

    fun isConfigured(ctx: Context, id: Int): Boolean =
        host(ctx, id).isNotBlank() && key(ctx, id).isNotBlank()

    fun saveConfig(ctx: Context, id: Int, host: String, port: String, key: String, filter: String, defaultBroker: String) {
        sp(ctx).edit()
            .putString("host_$id", host.trim())
            .putString("port_$id", port.trim().ifBlank { "8080" })
            .putGeheim("key_$id", key.trim())
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
    fun alarmKey(ctx: Context): String = geheim(ctx, "alarm_key")
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
            .putGeheim("alarm_key", key.trim())
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
    /** Neu gemeldete Kennungen dazunehmen, ohne den Abrufstand zu verschieben (Sofort-Zustellung). */
    fun merkeGesehen(ctx: Context, ids: List<String>) {
        sp(ctx).edit().putString("alarm_gesehen", (alarmGesehen(ctx) + ids).takeLast(400).joinToString("\n")).apply()
    }

    // --- HTTPS mit gekoppelter CA (global: ein Gerät, ein AutarkTrade-Server) ---
    // Vorgabe AN für neue Einrichtungen; eine ältere Einrichtung (Host schon gespeichert,
    // Schalter nie gesetzt) bleibt bei http, bis der Nutzer umschaltet — sonst stünde das
    // Widget nach dem Update ohne Kopplung still.
    const val TLS_PORT_VORGABE = "8443"
    fun tlsAn(ctx: Context): Boolean {
        val p = sp(ctx)
        if (p.contains("tls_an")) return p.getBoolean("tls_an", true)
        return p.all.keys.none { it.startsWith("host_") || it == "alarm_host" }
    }
    fun tlsPort(ctx: Context): String = sp(ctx).getString("tls_port", TLS_PORT_VORGABE) ?: TLS_PORT_VORGABE
    fun saveTls(ctx: Context, an: Boolean, port: String) {
        sp(ctx).edit().putBoolean("tls_an", an).putString("tls_port", port.trim().ifBlank { TLS_PORT_VORGABE }).apply()
    }
    /**
     * Gekoppelte CA (PEM). Nicht geheim, aber über den Tresor gespeichert: AES-GCM
     * authentisiert, eine untergeschobene CA in den Prefs würde nicht entschlüsseln.
     */
    fun tlsCa(ctx: Context): String = geheim(ctx, "tls_ca")
    /** Host, für den gekoppelt wurde, und der Fingerabdruck (nur zur Anzeige). */
    fun tlsCaHost(ctx: Context): String = sp(ctx).getString("tls_ca_host", "") ?: ""
    fun tlsCaFingerabdruck(ctx: Context): String = sp(ctx).getString("tls_ca_fp", "") ?: ""
    fun saveKopplung(ctx: Context, host: String, pem: String, fingerabdruck: String) {
        sp(ctx).edit().putGeheim("tls_ca", pem).putString("tls_ca_host", host.trim())
            .putString("tls_ca_fp", fingerabdruck).commit()
    }

    /** Adresse der installierten Web-App für Links (z. B. https://192.168.178.100:8443); leer = API-Adresse. */
    fun webAdresse(ctx: Context): String = sp(ctx).getString("web_adresse", "") ?: ""
    fun setWebAdresse(ctx: Context, adresse: String) { sp(ctx).edit().putString("web_adresse", adresse.trim()).apply() }
    /** Gemerktes Signaturzertifikat (SHA-256) einer WebAPK — siehe WebApp.echteWebApk. */
    fun webApkZertifikat(ctx: Context, paket: String): String = sp(ctx).getString("webapk_zert_$paket", "") ?: ""
    fun setWebApkZertifikat(ctx: Context, paket: String, hash: String) {
        sp(ctx).edit().putString("webapk_zert_$paket", hash).apply()
    }

    // --- Sofort-Zustellung (UnifiedPush) ---
    fun sofortAn(ctx: Context): Boolean = sp(ctx).getBoolean("sofort_an", false)
    fun setSofortAn(ctx: Context, an: Boolean) { sp(ctx).edit().putBoolean("sofort_an", an).apply() }
    /** Adresse + Schlüssel vom Verteiler; leer = nicht angemeldet. */
    fun sofortEndpoint(ctx: Context): String = sp(ctx).getString("sofort_endpoint", "") ?: ""
    fun sofortP256dh(ctx: Context): String = sp(ctx).getString("sofort_p256dh", "") ?: ""
    fun sofortAuth(ctx: Context): String = geheim(ctx, "sofort_auth")
    fun saveSofortEndpoint(ctx: Context, endpoint: String, p256dh: String, auth: String) {
        sp(ctx).edit().putString("sofort_endpoint", endpoint).putString("sofort_p256dh", p256dh)
            .putGeheim("sofort_auth", auth).apply()
    }
    fun clearSofortEndpoint(ctx: Context) {
        sp(ctx).edit().remove("sofort_endpoint").remove("sofort_p256dh").remove("sofort_auth").apply()
    }
    /** Letzter Stand für die Anzeige („beim Server eingetragen", Fehler …). */
    fun sofortStatus(ctx: Context): String? = sp(ctx).getString("sofort_status", null)
    fun saveSofortStatus(ctx: Context, text: String) { sp(ctx).edit().putString("sofort_status", text).apply() }
    fun sofortLetzte(ctx: Context): Long = sp(ctx).getLong("sofort_letzte", 0L)
    fun setSofortLetzte(ctx: Context, t: Long) { sp(ctx).edit().putLong("sofort_letzte", t).apply() }

    // --- Sprachausgabe (Vorgabe aus; vorgelesen wird ab der gewählten Dringlichkeit) ---
    fun spracheAn(ctx: Context): Boolean = sp(ctx).getBoolean("sprache_an", false)
    fun setSpracheAn(ctx: Context, an: Boolean) { sp(ctx).edit().putBoolean("sprache_an", an).apply() }
    fun spracheAb(ctx: Context): String = sp(ctx).getString("sprache_ab", "einstieg") ?: "einstieg"
    fun setSpracheAb(ctx: Context, stufe: String) { sp(ctx).edit().putString("sprache_ab", stufe).apply() }

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
