package com.autarktrade.widget

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import com.autarktrade.widget.model.DisplayData
import org.unifiedpush.android.connector.UnifiedPush
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Configuration screen. Opened automatically when the widget is added, again when
 * the user taps the widget title, and — since 4.0.0-21 — from the launcher, where it
 * configures only the connection and the chart alarms (no widget card).
 *
 * Widget settings are stored per appWidgetId; the alarm settings are global. The
 * alarm connection follows whatever host/port/key this screen saves last, so an
 * alarm user with a widget never has to type the key twice.
 */
class WidgetConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val mitWidget get() = widgetId != AppWidgetManager.INVALID_APPWIDGET_ID

    // Spinner-Werte (Position ↔ gespeicherter Wert)
    private val filterVals  = listOf("all", "month", "week", "year")
    private val filterNames = listOf("Gesamt", "Monat", "Woche", "Jahr")
    private val brokerVals  = listOf("auto", "bitunix", "bitget", "pionex")
    private val brokerNames = listOf("Automatisch (Primär)", "Bitunix", "Bitget", "Pionex")
    private val taktVals    = listOf(1, 2, 5, 10, 15)

    private lateinit var host: EditText
    private lateinit var port: EditText
    private lateinit var key: EditText
    private lateinit var web: EditText
    private lateinit var tlsSchalter: SwitchCompat
    private lateinit var tlsPort: EditText
    private lateinit var status: TextView
    private lateinit var alarmeAn: SwitchCompat
    private lateinit var taktSpin: Spinner
    private lateinit var artBoxen: Map<String, CheckBox>
    private lateinit var sofortBox: CheckBox

    private fun setupSpinner(spinner: Spinner, names: List<String>) {
        spinner.adapter = ArrayAdapter(this, R.layout.spinner_item, names).apply {
            setDropDownViewResource(R.layout.spinner_dropdown_item)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Default result = canceled, so dismissing the dialog removes a freshly-added widget.
        setResult(Activity.RESULT_CANCELED)
        // Der Geräteschlüssel steht hier im Feld: keine Screenshots, keine Bildschirmaufnahme,
        // leere Vorschau in den letzten Apps (SEC-AND-004).
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        setContentView(R.layout.activity_config)

        widgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        host = findViewById(R.id.in_host)
        port = findViewById(R.id.in_port)
        key = findViewById(R.id.in_key)
        web = findViewById(R.id.in_web)
        web.setText(Prefs.webAdresse(this))
        web.setOnFocusChangeListener { _, fokus -> if (!fokus) zeigeWebStand() }
        tlsSchalter = findViewById(R.id.in_tls)
        tlsPort = findViewById(R.id.in_tls_port)
        tlsSchalter.isChecked = Prefs.tlsAn(this)
        tlsPort.setText(Prefs.tlsPort(this))
        tlsSchalter.setOnCheckedChangeListener { _, _ -> zeigeTlsStand(); zeigeWebStand() }
        findViewById<Button>(R.id.btn_koppeln).setOnClickListener {
            val h = host.text.toString().trim()
            if (h.isBlank()) { status.text = getString(R.string.cfg_need_fields); return@setOnClickListener }
            koppeln(h, port.text.toString().trim().ifBlank { "8080" }) {
                Prefs.saveTls(this, true, tlsPortWert())
                status.text = getString(R.string.cfg_gekoppelt)
            }
        }
        status = findViewById(R.id.status)
        val filterSpin = findViewById<Spinner>(R.id.in_filter)
        val brokerSpin = findViewById<Spinner>(R.id.in_broker)
        alarmeAn = findViewById(R.id.in_alarme)
        taktSpin = findViewById(R.id.in_takt)
        artBoxen = mapOf(
            "preis" to findViewById(R.id.art_preis), "linie" to findViewById(R.id.art_linie),
            "zone" to findViewById(R.id.art_zone), "momentum" to findViewById(R.id.art_momentum),
        )

        setupSpinner(filterSpin, filterNames)
        setupSpinner(brokerSpin, brokerNames)
        setupSpinner(taktSpin, listOf(R.string.takt_1, R.string.takt_2, R.string.takt_5, R.string.takt_10, R.string.takt_15).map { getString(it) })

        // Vorbelegen: Widget-Verbindung, sonst die der Alarme, sonst die eines anderen Widgets.
        if (mitWidget && Prefs.isConfigured(this, widgetId)) {
            host.setText(Prefs.host(this, widgetId)); port.setText(Prefs.port(this, widgetId)); key.setText(Prefs.key(this, widgetId))
        } else if (Prefs.alarmVerbunden(this)) {
            host.setText(Prefs.alarmHost(this)); port.setText(Prefs.alarmPort(this)); key.setText(Prefs.alarmKey(this))
        } else {
            val andere = AppWidgetManager.getInstance(this)
                .getAppWidgetIds(ComponentName(this, TradingWidgetProvider::class.java))
                .firstOrNull { Prefs.isConfigured(this, it) }
            if (andere != null) {
                host.setText(Prefs.host(this, andere)); port.setText(Prefs.port(this, andere)); key.setText(Prefs.key(this, andere))
            }
        }
        if (mitWidget) {
            filterSpin.setSelection(filterVals.indexOf(Prefs.filter(this, widgetId)).coerceAtLeast(0))
            brokerSpin.setSelection(brokerVals.indexOf(Prefs.defaultBroker(this, widgetId)).coerceAtLeast(0))
        } else {
            findViewById<View>(R.id.karte_widget).visibility = View.GONE
        }

        alarmeAn.isChecked = Prefs.alarmeAn(this)
        taktSpin.setSelection(taktVals.indexOf(Prefs.alarmTaktMin(this)).let { if (it < 0) 1 else it })
        val arten = Prefs.alarmArten(this)
        artBoxen.forEach { (art, box) -> box.isChecked = art in arten }
        sofortBox = findViewById(R.id.sofort_an)
        sofortBox.isChecked = Prefs.sofortAn(this)
        sofortBox.setOnCheckedChangeListener { _, _ -> zeigeAlarmDetails() }

        // Sprachausgabe: gilt sofort, ohne Speichern (nur ein Schalter am Gerät)
        val spracheBox = findViewById<CheckBox>(R.id.sprache_an)
        val spracheSpin = findViewById<Spinner>(R.id.in_sprache_ab)
        val spracheDetails = findViewById<View>(R.id.sprache_details)
        setupSpinner(spracheSpin, listOf(R.string.sprache_info, R.string.sprache_warnung, R.string.sprache_einstieg).map { getString(it) })
        spracheSpin.setSelection(Sprache.STUFEN.indexOf(Prefs.spracheAb(this)).let { if (it < 0) 2 else it })
        spracheBox.isChecked = Prefs.spracheAn(this)
        spracheDetails.visibility = if (spracheBox.isChecked) View.VISIBLE else View.GONE
        spracheBox.setOnCheckedChangeListener { _, an ->
            Prefs.setSpracheAn(this, an)
            spracheDetails.visibility = if (an) View.VISIBLE else View.GONE
        }
        spracheSpin.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: View?, pos: Int, id: Long) =
                Prefs.setSpracheAb(this@WidgetConfigActivity, Sprache.STUFEN[pos])
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        findViewById<Button>(R.id.btn_sprache_test).setOnClickListener { Sprache.test(this) }
        alarmeAn.setOnCheckedChangeListener { _, an ->
            zeigeAlarmDetails()
            // Ab Android 13 muss die App fragen, bevor sie melden darf.
            if (an && !ChartAlarme.darfMelden(this)) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
        }
        taktSpin.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: View?, pos: Int, id: Long) = zeigeAlarmDetails()
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }

        findViewById<Button>(R.id.btn_genau).setOnClickListener {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }
        findViewById<Button>(R.id.btn_akku).setOnClickListener {
            // Die Liste, nicht der Direkt-Dialog: der braucht eine eigene Berechtigung,
            // und der Nutzer soll sehen, was er umstellt.
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        findViewById<Button>(R.id.btn_testmeldung).setOnClickListener {
            if (!ChartAlarme.darfMelden(this)) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
                status.text = getString(R.string.cfg_keine_erlaubnis)
            } else ChartAlarme.testMeldung(this)
        }

        findViewById<Button>(R.id.btn_test).setOnClickListener {
            val (h, p, k) = verbindung() ?: return@setOnClickListener
            val f = if (mitWidget) filterVals[filterSpin.selectedItemPosition.coerceAtLeast(0)] else "all"
            val tls = tlsSchalter.isChecked
            val tp = tlsPortWert()
            // HTTPS an und noch nicht gekoppelt → erst koppeln (mit Bestätigung), dann testen.
            mitKopplung(h, p) {
                status.text = getString(R.string.cfg_testing)
                thread {
                    val msg = try {
                        val ziel = ApiClient.ziel(applicationContext, h, p, tls, tp)
                        ApiClient.fetch(ziel, k, f)
                        // Den Alarm-Endpunkt gleich mitprüfen: ein älterer Server hat ihn nicht (404).
                        if (alarmeAn.isChecked) { ApiClient.fetchAlarme(ziel, k, System.currentTimeMillis(), Prefs.ALLE_ARTEN.toSet()); getString(R.string.cfg_alarm_test_ok) }
                        else getString(R.string.cfg_test_ok)
                    } catch (e: Exception) {
                        getString(R.string.cfg_test_fail, e.message ?: "?")
                    }
                    runOnUiThread { status.text = msg }
                }
            }
        }

        findViewById<Button>(R.id.btn_save).setOnClickListener {
            val (h, p, k) = verbindung() ?: return@setOnClickListener
            val webNeu = web.text.toString().trim()
            if (webNeu.isNotBlank() && !webNeu.matches(Regex("^https?://\\S+$"))) {
                status.text = getString(R.string.cfg_web_ungueltig); return@setOnClickListener
            }
            Prefs.setWebAdresse(this, webNeu)
            val gewaehlt = artBoxen.filterValues { it.isChecked }.keys
            if (alarmeAn.isChecked && gewaehlt.isEmpty()) { status.text = getString(R.string.cfg_keine_art); return@setOnClickListener }
            // HTTPS an und (für diesen Host) noch nicht gekoppelt → erst koppeln, dann speichern.
            // Abgebrochen → nichts gespeichert.
            mitKopplung(h, p) {
                Prefs.saveTls(this, tlsSchalter.isChecked, tlsPortWert())
                Prefs.saveAlarmConfig(this, alarmeAn.isChecked, taktVals[taktSpin.selectedItemPosition.coerceAtLeast(0)],
                    gewaehlt.ifEmpty { Prefs.ALLE_ARTEN.toSet() }, h, p, k)
                if (alarmeAn.isChecked) ChartAlarme.kanaeleAnlegen(this)
                sofortUmstellen(alarmeAn.isChecked && sofortBox.isChecked)
                status.text = getString(R.string.cfg_testing)

                thread {
                    // Erster Alarm-Abruf gleich hier: merkt den Stand still, damit ab jetzt nur Neues kommt.
                    ChartAlarme.abrufen(applicationContext)
                    ChartAlarme.planen(applicationContext)
                    if (mitWidget) {
                        val f = filterVals[filterSpin.selectedItemPosition.coerceAtLeast(0)]
                        val db = brokerVals[brokerSpin.selectedItemPosition.coerceAtLeast(0)]
                        Prefs.saveConfig(this, widgetId, h, p, k, f, db)
                        // Daten gleich hier holen + cachen, damit das Widget sofort befüllt
                        // ist — unabhängig davon, ob der WorkManager-Job (Hintergrund) auf
                        // diesem Gerät zeitnah/überhaupt läuft (Akku-Restriktionen etc.).
                        try {
                            val json = ApiClient.fetch(ApiClient.ziel(applicationContext, h, p), k, f)
                            DisplayData.parse(json)
                            Prefs.saveCache(applicationContext, widgetId, json, System.currentTimeMillis())
                            Prefs.clearSelectedBroker(applicationContext, widgetId)
                        } catch (e: Exception) {
                            Prefs.saveError(applicationContext, widgetId, e.message ?: "Fehler")
                        }
                    }
                    runOnUiThread {
                        // Alle Widgets neu zeichnen — die Glocke im Titel hängt am globalen Schalter.
                        val awm = AppWidgetManager.getInstance(applicationContext)
                        for (id in awm.getAppWidgetIds(ComponentName(applicationContext, TradingWidgetProvider::class.java))) {
                            TradingWidgetProvider.updateWidget(applicationContext, awm, id)
                        }
                        if (mitWidget) {
                            TradingWidgetProvider.triggerRefresh(applicationContext, force = true)
                            setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                            finish()
                        } else {
                            status.text = getString(R.string.cfg_gespeichert)
                            zeigeAlarmDetails()
                            zeigeTlsStand()
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Zurück aus den System-Einstellungen (genaue Wecker / Akku) → Stand neu zeigen.
        zeigeAlarmDetails()
        zeigeWebStand()
        zeigeTlsStand()
    }

    private fun tlsPortWert(): String = tlsPort.text.toString().trim().ifBlank { Prefs.TLS_PORT_VORGABE }

    /**
     * [weiter] sofort, wenn HTTPS aus ist oder für [h] schon eine CA gekoppelt ist —
     * sonst erst koppeln. Ein anderer Host heisst womöglich ein anderer Server: neu fragen.
     */
    private fun mitKopplung(h: String, p: String, weiter: () -> Unit) {
        if (!tlsSchalter.isChecked || (Prefs.tlsCa(this).isNotBlank() && Prefs.tlsCaHost(this) == h)) weiter()
        else koppeln(h, p, weiter)
    }

    /**
     * Trust on first use mit Bestätigung: CA über http://h:p/api/esp32/ca holen, den
     * selbst gerechneten Fingerabdruck zeigen und erst nach „Ja" speichern. Danach
     * vertraut die App nur noch dieser CA (ApiClient.ziel).
     */
    private fun koppeln(h: String, p: String, weiter: () -> Unit) {
        status.text = getString(R.string.cfg_koppeln_laeuft)
        thread {
            val ergebnis = try { Result.success(ApiClient.holeCa(h, p)) } catch (e: Exception) { Result.failure(e) }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                val (pem, fp) = ergebnis.getOrElse {
                    status.text = getString(R.string.cfg_koppeln_fehler, it.message ?: "?"); return@runOnUiThread
                }
                AlertDialog.Builder(this)
                    .setTitle(R.string.cfg_koppeln_titel)
                    .setMessage(getString(R.string.cfg_koppeln_text, h, Kopplung.kurz(fp), fp))
                    .setCancelable(false)
                    .setPositiveButton(R.string.cfg_koppeln_ja) { _, _ ->
                        Prefs.saveKopplung(this, h, pem, fp)
                        zeigeTlsStand()
                        weiter()
                    }
                    .setNegativeButton(R.string.cfg_koppeln_nein) { _, _ ->
                        status.text = getString(R.string.cfg_koppeln_abgebrochen)
                    }
                    .show()
            }
        }
    }

    /** Schalterstand, Kopplung oder Klartext-Warnung unter dem HTTPS-Schalter. */
    private fun zeigeTlsStand() {
        if (!::tlsSchalter.isInitialized) return
        val an = tlsSchalter.isChecked
        findViewById<View>(R.id.tls_details).visibility = if (an) View.VISIBLE else View.GONE
        val fp = Prefs.tlsCaFingerabdruck(this)
        findViewById<TextView>(R.id.tls_stand).text = when {
            !an -> getString(R.string.cfg_tls_aus)
            Prefs.tlsCa(this).isNotBlank() && fp.isNotBlank() -> getString(R.string.cfg_tls_stand, Prefs.tlsCaHost(this), Kopplung.kurz(fp))
            else -> getString(R.string.cfg_tls_ungekoppelt)
        }
    }

    /** Öffnen Links in einer installierten App oder im Browser? (für die eingetragene bzw. API-Adresse) */
    private fun zeigeWebStand() {
        if (!::web.isInitialized) return
        val eingabe = web.text.toString().trim().trimEnd('/')
        val basis = eingabe.ifBlank {
            WebApp.vorgabe(host.text.toString().trim(), port.text.toString().trim().ifBlank { "8080" },
                ::tlsSchalter.isInitialized && tlsSchalter.isChecked, if (::tlsPort.isInitialized) tlsPortWert() else Prefs.TLS_PORT_VORGABE)
        }
        val uri = Uri.parse("$basis/chart")
        findViewById<TextView>(R.id.web_stand).text = getString(
            if (WebApp.webApk(this, uri) != null) R.string.cfg_web_app else R.string.cfg_web_browser)
    }

    /**
     * Sofort-Zustellung an- oder abschalten. An: den UnifiedPush-Verteiler (ntfy)
     * wählen — bei mehreren fragt Android einmal — und dort anmelden; die Adresse
     * kommt asynchron in PushDienst.onNewEndpoint an und wird von dort beim Server
     * eingetragen. War schon eine da (anderer Server gespeichert), gleich neu eintragen.
     */
    private fun sofortUmstellen(an: Boolean) {
        val app = applicationContext
        val vorher = Prefs.sofortAn(this)
        Prefs.setSofortAn(this, an)
        if (an) {
            UnifiedPush.tryUseCurrentOrDefaultDistributor(this) { gefunden ->
                if (!gefunden) {
                    Prefs.setSofortAn(app, false)
                    Prefs.saveSofortStatus(app, getString(R.string.cfg_sofort_keine_app))
                    runOnUiThread { status.text = getString(R.string.cfg_sofort_keine_app); zeigeAlarmDetails() }
                    return@tryUseCurrentOrDefaultDistributor
                }
                UnifiedPush.register(app, messageForDistributor = "AutarkTrade Chart-Alarme")
                if (Prefs.sofortEndpoint(app).isNotBlank()) thread { ChartAlarme.sofortAnServer(app, true) }
            }
        } else if (vorher) {
            UnifiedPush.unregister(app)   // → PushDienst.onUnregistered trägt beim Server aus
        }
    }

    /** Host/Port/Key aus den Feldern, oder null (dann steht der Hinweis schon da). */
    private fun verbindung(): Triple<String, String, String>? {
        val h = host.text.toString().trim()
        val p = port.text.toString().trim().ifBlank { "8080" }
        val k = key.text.toString().trim()
        if (h.isBlank() || k.isBlank()) { status.text = getString(R.string.cfg_need_fields); return null }
        return Triple(h, p, k)
    }

    private fun zeigeAlarmDetails() {
        if (!::alarmeAn.isInitialized) return
        findViewById<View>(R.id.alarm_details).visibility = if (alarmeAn.isChecked) View.VISIBLE else View.GONE
        val takt = taktVals[taktSpin.selectedItemPosition.coerceAtLeast(0)]
        val genau = getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true
        // Gemessen im Emulator (Android 15): ein ungenauer 2-min-Wecker bekam ein Fenster
        // von +1:30 — er kann also bis ~3:30 nach dem letzten Abruf feuern.
        findViewById<TextView>(R.id.alarm_hinweis).text = when {
            ::sofortBox.isInitialized && sofortBox.isChecked -> getString(R.string.cfg_hinweis_sofort)
            genau -> getString(R.string.cfg_hinweis_genau, takt)
            else -> getString(R.string.cfg_hinweis_ungenau, takt, Math.ceil(takt * 1.75).toInt())
        }
        if (::sofortBox.isInitialized) {
            val letzte = Prefs.sofortLetzte(this)
            findViewById<TextView>(R.id.sofort_stand).text = if (!Prefs.sofortAn(this) && !sofortBox.isChecked)
                getString(R.string.cfg_sofort_aus)
            else getString(R.string.cfg_sofort_stand, Prefs.sofortStatus(this) ?: "—",
                if (letzte > 0) getString(R.string.cfg_sofort_letzte,
                    SimpleDateFormat("dd.MM. HH:mm:ss", Locale.GERMAN).format(Date(letzte))) else "")
        }
        findViewById<Button>(R.id.btn_genau).apply {
            text = getString(if (genau) R.string.cfg_genau_an else R.string.cfg_genau_aus)
            isEnabled = !genau
            alpha = if (genau) 0.6f else 1f
        }
        val zuletzt = Prefs.alarmLetzterAbruf(this)
        val fehler = Prefs.alarmFehler(this)
        val zeit = SimpleDateFormat("dd.MM. HH:mm", Locale.GERMAN).format(Date(zuletzt))
        findViewById<TextView>(R.id.alarm_stand).text = when {
            zuletzt == 0L -> getString(R.string.cfg_stand_nie)
            fehler != null -> getString(R.string.cfg_stand_fehler, zeit, fehler)
            else -> getString(R.string.cfg_stand, zeit)
        }
    }
}
