package com.autarktrade.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Unsichtbares Sprungbrett für Klicks in der Widget-Liste.
 *
 * Eine Collection im Widget kennt genau EIN PendingIntent-Template, die Zeilen
 * ergänzen es nur per Fill-In. Zwei Ziele — Coin-Zeile öffnet den Chart im
 * Browser, Börsenkopf schaltet die Kennzahlen oben um — passen also nicht in
 * zwei verschiedene Templates. Ein Broadcast als Template könnte den Browser
 * nicht starten (Android sperrt Activity-Starts aus Hintergrund-Receivern),
 * darum ist das Template diese Activity: sie entscheidet, tut es und ist weg.
 */
class WidgetKlickActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val symbol = intent.getStringExtra(EXTRA_SYMBOL)
        val broker = intent.getStringExtra(TradingWidgetProvider.EXTRA_BROKER)

        if (!symbol.isNullOrBlank() && widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            chartOeffnen(widgetId, symbol, broker)
        } else if (!broker.isNullOrBlank() && widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
            // Tipp auf einen Börsenkopf → Kopf-KPIs auf diese Börse (kein Netz, nur neu zeichnen).
            Prefs.setSelectedBroker(this, widgetId, broker)
            TradingWidgetProvider.updateWidget(this, AppWidgetManager.getInstance(this), widgetId)
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }

    /**
     * `/chart?symbol=…&boerse=…` — dieselbe Adresse, mit der Coin-Radar & Co. in den
     * Chart springen. Die Web-App säubert das Symbol selbst (Bindestrich/Unterstrich
     * fallen weg) und ignoriert eine Börse, die der Chart nicht führt (Pionex).
     */
    private fun chartOeffnen(widgetId: Int, symbol: String, broker: String?) {
        val host = Prefs.host(this, widgetId)
        if (host.isBlank()) return
        val sauber = symbol.uppercase().replace(Regex("[^A-Z0-9]"), "")
        val url = Uri.parse("http://$host:${Prefs.port(this, widgetId)}/chart").buildUpon()
            .appendQueryParameter("symbol", sauber)
            .apply { if (!broker.isNullOrBlank()) appendQueryParameter("boerse", broker.lowercase()) }
            .build()
        android.util.Log.d("TJWidget", "Chart öffnen: $url")
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            android.util.Log.w("TJWidget", "Chart öffnen: ${e.message}")
        }
    }

    companion object {
        const val EXTRA_SYMBOL = "symbol"
    }
}
