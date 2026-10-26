package com.autarktrade.widget

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import java.security.MessageDigest

/**
 * Links aus Widget und Benachrichtigungen in die installierte AutarkTrade-Web-App.
 *
 * Über HTTPS (Caddy, z. B. https://192.168.178.100:8443) baut Chrome beim
 * „Installieren" eine WebAPK — ein echtes App-Paket (`org.chromium.webapk.…`),
 * das Links auf seine Adresse annimmt. Über http wird es nur eine Verknüpfung,
 * die keine Links annehmen kann. Die API des Widgets läuft über HTTPS mit der
 * gekoppelten CA (oder, ausgeschaltet, über http://host:port); für Links zählt die
 * Adresse, unter der die App installiert ist.
 *
 * Android 12+ öffnet Web-Links ohne Domain-Prüfung im Standard-Browser, auch wenn
 * eine WebAPK passt. Darum wird die WebAPK gezielt gesucht und der Link an sie
 * adressiert; gibt es keine, öffnet wie bisher der Browser.
 *
 * Der Paketname allein beweist nichts (Audit SEC-AND-003): jede App kann sich
 * `org.chromium.webapk.x` nennen und einen http(s)-Filter anmelden. Darum muss
 * ein Kandidat zusätzlich [echteWebApk] bestehen, sonst öffnet der Browser.
 */
object WebApp {

    /**
     * Basis der Links: eingetragene Web-App-Adresse, sonst die API-Adresse — mit
     * HTTPS https://host:8443 (Vorgabe seit 4.2.0-28), sonst http://host:port.
     */
    fun basis(ctx: Context, host: String, port: String): String =
        Prefs.webAdresse(ctx).trimEnd('/').ifBlank { vorgabe(host, port, Prefs.tlsAn(ctx), Prefs.tlsPort(ctx)) }

    /** Link-Adresse ohne eingetragene Web-Adresse. */
    fun vorgabe(host: String, port: String, tls: Boolean, tlsPort: String): String =
        if (tls) "https://$host:$tlsPort" else "http://$host:$port"

    /** Paket einer installierten, geprüften WebAPK, die diese Adresse öffnet — oder null. */
    fun webApk(ctx: Context, uri: Uri): String? {
        val probe = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        return ctx.packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
            .map { it.activityInfo.packageName }
            .distinct()
            .filter { it.startsWith("org.chromium.webapk.") }
            .firstOrNull { echteWebApk(ctx, it, uri) }
    }

    /**
     * Prüft einen WebAPK-Kandidaten über den Paketnamen hinaus:
     *  1. Die WebAPK-Hülle nennt in ihren Metadaten Start-Adresse oder Bereich — deren
     *     Host und Port müssen zur Link-Adresse passen.
     *  2. Der Browser, für den sie gebaut ist (`runtimeHost`), ist installiert (fehlt die
     *     Angabe, zählt in 3. nur Google Play).
     *  3. Installiert hat sie Google Play (Chrome lässt WebAPKs dort erzeugen) oder
     *     dieser Browser selbst — eine von Hand oder aus einem anderen Laden installierte
     *     App fällt durch.
     *  4. Das Signaturzertifikat wird beim ersten Treffer gemerkt (Prefs) und muss danach
     *     gleich bleiben: eine später untergeschobene Ersatz-App fällt durch.
     * Jede fehlende Angabe heisst „nein" — dann öffnet der Browser, das ist nur unbequemer.
     */
    private fun echteWebApk(ctx: Context, paket: String, uri: Uri): Boolean = try {
        val pm = ctx.packageManager
        val meta = pm.getApplicationInfo(paket, PackageManager.GET_META_DATA).metaData
        val laufzeit = meta?.getString("org.chromium.webapk.shell_apk.runtimeHost").orEmpty()
        val adressen = listOfNotNull(
            meta?.getString("org.chromium.webapk.shell_apk.startUrl"),
            meta?.getString("org.chromium.webapk.shell_apk.scope"),
        ).map { Uri.parse(it) }
        val passt = adressen.any { gleicherUrsprung(it, uri) }
        // Ohne runtimeHost-Angabe (andere Hüllen-Version) zählt nur Google Play als Quelle.
        val browserDa = laufzeit.isBlank() || try { pm.getPackageInfo(laufzeit, 0); true } catch (e: PackageManager.NameNotFoundException) { false }
        val quelle = pm.getInstallSourceInfo(paket)
        val installiertVon = setOfNotNull(quelle.installingPackageName, quelle.initiatingPackageName)
        val quelleOk = installiertVon.any { it == "com.android.vending" || (laufzeit.isNotBlank() && it == laufzeit) }
        passt && browserDa && quelleOk && zertifikatGemerkt(ctx, paket)
    } catch (e: Exception) {
        android.util.Log.w("TJWidget", "WebAPK $paket nicht prüfbar: ${e.javaClass.simpleName}")
        false
    }

    private fun gleicherUrsprung(a: Uri, b: Uri): Boolean {
        fun port(u: Uri) = if (u.port != -1) u.port else if (u.scheme == "https") 443 else 80
        return a.scheme.equals(b.scheme, true) && a.host.equals(b.host, true) && port(a) == port(b)
    }

    /** Trust on first use: SHA-256 des Signaturzertifikats je Paket. */
    private fun zertifikatGemerkt(ctx: Context, paket: String): Boolean {
        val info = ctx.packageManager.getPackageInfo(paket, PackageManager.GET_SIGNING_CERTIFICATES)
        val sig = info.signingInfo ?: return false
        if (sig.hasMultipleSigners()) return false
        val zert = sig.signingCertificateHistory?.firstOrNull() ?: return false
        val hash = MessageDigest.getInstance("SHA-256").digest(zert.toByteArray())
            .joinToString("") { "%02x".format(it) }
        val gemerkt = Prefs.webApkZertifikat(ctx, paket)
        if (gemerkt.isEmpty()) { Prefs.setWebApkZertifikat(ctx, paket, hash); return true }
        return gemerkt == hash
    }

    /** VIEW-Intent für [uri], an die WebAPK adressiert, wenn es eine geprüfte gibt. */
    fun oeffnen(ctx: Context, uri: Uri): Intent =
        Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).apply {
            webApk(ctx, uri)?.let { setPackage(it) }
        }
}
