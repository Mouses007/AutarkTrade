package com.autarktrade.widget

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/**
 * Weckt den Alarm-Abruf. Drei Anlässe:
 *  - der eigene Wecker (ACTION_ABRUF) → abrufen, dann den nächsten planen;
 *  - Neustart / App-Update → Wecker sind dann weg, neu planen (ohne Abruf, das Netz
 *    ist beim Booten oft noch nicht da);
 *  - „Genaue Wecker" erlaubt/entzogen → mit der neuen Art neu planen.
 *
 * goAsync + eigener Thread: der Abruf hat ein hartes Gesamt-Timeout von 10 s
 * (ApiClient), das liegt sicher unter dem Limit eines Hintergrund-Broadcasts.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        when (intent.action) {
            ChartAlarme.ACTION_ABRUF -> {
                val pending = goAsync()
                thread(name = "alarm-abruf") {
                    try { ChartAlarme.abrufen(ctx) } finally {
                        ChartAlarme.planen(ctx)
                        pending.finish()
                    }
                }
            }
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> ChartAlarme.planen(ctx)
        }
    }
}
