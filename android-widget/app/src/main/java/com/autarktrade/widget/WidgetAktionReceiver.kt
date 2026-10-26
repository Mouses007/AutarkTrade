package com.autarktrade.widget

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Die eigenen Widget-Aktionen (Aktualisieren, Auge, 15-min-Wecker).
 *
 * Bis 4.1.0-26 lagen sie im exportierten [TradingWidgetProvider]: jede fremde App
 * konnte das Auge umschalten oder einen Refresh ohne Entprellung in Schleife
 * auslösen (Audit SEC-AND-002). Der Provider muss für APPWIDGET_UPDATE des Systems
 * exportiert bleiben; dieser Empfänger ist es nicht (`exported="false"`) und wird nur
 * über die expliziten PendingIntents aus [TradingWidgetProvider] erreicht.
 */
class WidgetAktionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val awm = AppWidgetManager.getInstance(context)
        when (intent.action) {
            TradingWidgetProvider.ACTION_REFRESH -> {
                // Sofort-Feedback: Spinner an, dann Expedited-Job (läuft auch im
                // Hintergrund mit Netz — anders als ein normaler Receiver/Worker, den
                // der Pixel einfriert → Spinner drehte endlos).
                android.util.Log.d("TJWidget", "↻ Tap → Refresh angestoßen")
                val ids = awm.getAppWidgetIds(ComponentName(context, TradingWidgetProvider::class.java))
                for (id in ids) TradingWidgetProvider.setRefreshing(context, awm, id)
                TradingWidgetProvider.triggerRefresh(context, force = true)   // Nutzer-Tap: nie entprellen
            }
            TradingWidgetProvider.ACTION_TOGGLE_BALANCE -> {
                val id = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    Prefs.setHideBalance(context, id, !Prefs.hideBalance(context, id))
                    TradingWidgetProvider.updateWidget(context, awm, id)   // kein Netz nötig, nur Re-Render
                }
            }
            TradingWidgetProvider.ACTION_ALARM -> {
                // 15-min-Auto-Refresh: jetzt aktualisieren + nächsten Alarm planen
                // (setAndAllowWhileIdle ist one-shot → muss neu gesetzt werden).
                TradingWidgetProvider.triggerRefresh(context)
                TradingWidgetProvider.scheduleAlarm(context)
            }
        }
    }
}
