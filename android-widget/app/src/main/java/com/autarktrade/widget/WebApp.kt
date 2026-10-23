package com.autarktrade.widget

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/**
 * Links aus Widget und Benachrichtigungen in die installierte AutarkTrade-Web-App.
 *
 * Über HTTPS (Caddy, z. B. https://192.168.178.100:8443) baut Chrome beim
 * „Installieren" eine WebAPK — ein echtes App-Paket (`org.chromium.webapk.…`),
 * das Links auf seine Adresse annimmt. Über http wird es nur eine Verknüpfung,
 * die keine Links annehmen kann. Die API des Widgets läuft weiter über
 * http://host:port; für Links zählt die Adresse, unter der die App installiert ist.
 *
 * Android 12+ öffnet Web-Links ohne Domain-Prüfung im Standard-Browser, auch wenn
 * eine WebAPK passt. Darum wird die WebAPK gezielt gesucht und der Link an sie
 * adressiert; gibt es keine, öffnet wie bisher der Browser.
 */
object WebApp {

    /** Basis der Links: eingetragene Web-App-Adresse, sonst die API-Adresse. */
    fun basis(ctx: Context, host: String, port: String): String =
        Prefs.webAdresse(ctx).trimEnd('/').ifBlank { "http://$host:$port" }

    /** Paket einer installierten WebAPK, die diese Adresse öffnet — oder null. */
    fun webApk(ctx: Context, uri: Uri): String? {
        val probe = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        return ctx.packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
            .map { it.activityInfo.packageName }
            .firstOrNull { it.startsWith("org.chromium.webapk.") }
    }

    /** VIEW-Intent für [uri], an die WebAPK adressiert, wenn es eine gibt. */
    fun oeffnen(ctx: Context, uri: Uri): Intent =
        Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).apply {
            webApk(ctx, uri)?.let { setPackage(it) }
        }
}
