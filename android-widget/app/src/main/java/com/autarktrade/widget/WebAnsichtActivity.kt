package com.autarktrade.widget

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import okhttp3.internal.tls.OkHostnameVerifier

/**
 * Eingebaute Ansicht der AutarkTrade-Web-App für Links aus Benachrichtigungen und Widget.
 *
 * Gebraucht, wenn keine geprüfte WebAPK da ist ([WebApp.webApk]) — etwa weil Brave oder
 * Chrome beim „Installieren" nur eine Verknüpfung anlegt. Dann öffnete bisher der
 * Browser; jetzt bleibt der Link in dieser App.
 *
 * TLS: Die WebView vertraut nur den System-CAs (network_security_config). Das
 * AutarkTrade-Zertifikat löst darum [WebViewClient.onReceivedSslError] aus; dort wird es
 * gegen die gekoppelte CA geprüft (dieselbe wie bei der API, [Kopplung.tls]) plus
 * Hostname — nur dann geht es weiter, sonst Abbruch. Kein „trotzdem fortfahren".
 *
 * Navigation bleibt auf dem Ursprung der Start-Adresse; fremde Links (Börse, Hilfe)
 * gehen an den Browser. Sitzungs-Cookie der Web-App bleibt im WebView-Speicher, die
 * Anmeldung gilt also nur hier (Passwortschutz: einmal anmelden).
 */
class WebAnsichtActivity : Activity() {

    private lateinit var web: WebView
    private var ursprung: Uri? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            webViewClient = Klient()
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // Ab Android 15 (targetSdk 35) zeichnet die App unter Status- und Navigationsleiste:
        // der Rahmen rückt die WebView um die Leisten (und die Tastatur) ein.
        val rahmen = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(web)
            setOnApplyWindowInsetsListener { v, insets ->
                val r = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(r.left, r.top, r.right, r.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(rahmen)
        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            ursprung = intent.data?.let { ursprungVon(it) }
        } else {
            laden(intent)
        }
    }

    @Deprecated("Zurück-Taste: erst im Verlauf der Web-App, dann schliessen")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        laden(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun laden(intent: Intent) {
        val uri = intent.data
        if (uri == null || (uri.scheme != "https" && uri.scheme != "http")) { finish(); return }
        ursprung = ursprungVon(uri)
        web.loadUrl(uri.toString())
    }

    private inner class Klient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val ziel = request.url
            if (gleicherUrsprung(ziel)) return false
            // Fremde Adresse (Börse, Doku …) → Browser; andere Schemata (intent:, file: …) gar nicht.
            if (ziel.scheme == "https" || ziel.scheme == "http") {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, ziel).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (e: Exception) {
                    android.util.Log.w("TJWidget", "Link öffnen: ${e.javaClass.simpleName}")
                }
            }
            return true
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            if (zertifikatOk(error)) handler.proceed() else {
                android.util.Log.w("TJWidget", "Web-Ansicht: Zertifikat abgelehnt (${error.primaryError}) für ${Uri.parse(error.url).host}")
                handler.cancel()
            }
        }
    }

    /** Nur die gekoppelte AutarkTrade-CA, gültig, Hostname passt, und nur auf dem Start-Ursprung. */
    private fun zertifikatOk(error: SslError): Boolean = try {
        val uri = Uri.parse(error.url)
        val host = uri.host
        val pem = Prefs.tlsCa(this)
        val zert = error.certificate.x509Certificate
        when {
            host == null || pem.isBlank() || zert == null || !gleicherUrsprung(uri) -> false
            else -> {
                val art = if (zert.publicKey.algorithm == "EC") "ECDHE_ECDSA" else "ECDHE_RSA"
                Kopplung.tls(pem).second.checkServerTrusted(arrayOf(zert), art)
                OkHostnameVerifier.verify(host, zert)
            }
        }
    } catch (e: Exception) {
        false
    }

    private fun gleicherUrsprung(u: Uri): Boolean {
        val o = ursprung ?: return false
        return ursprungVon(u) == o
    }

    companion object {
        /** scheme://host:port in Kleinbuchstaben, Standard-Port ausgeschrieben. */
        private fun ursprungVon(u: Uri): Uri? {
            val host = u.host ?: return null
            val schema = u.scheme?.lowercase() ?: return null
            val port = if (u.port != -1) u.port else if (schema == "https") 443 else 80
            return Uri.parse("$schema://${host.lowercase()}:$port")
        }

        /** Expliziter Intent auf diese Ansicht (nicht exportiert, also nur aus der App). */
        fun intent(ctx: Context, uri: Uri): Intent =
            Intent(ctx, WebAnsichtActivity::class.java).setData(uri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
