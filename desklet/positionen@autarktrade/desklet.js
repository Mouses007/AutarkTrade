// AutarkTrade-Desklet (Positionen)
// Shows open positions from the AutarkTrade
// Requires: Cinnamon 5.0+

const Desklet   = imports.ui.desklet;
const St        = imports.gi.St;
const GLib      = imports.gi.GLib;
const Gio       = imports.gi.Gio;
const Mainloop  = imports.mainloop;
const Settings  = imports.ui.settings;
const Gettext   = imports.gettext;

// Soup version detection: Cinnamon < 5.8 uses Soup 2, newer ones Soup 3
let Soup;
try {
    imports.gi.versions.Soup = '3.0';
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 3;
} catch(e) {
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 2;
}

const UUID         = "positionen@autarktrade";

/** Trennlinie als 1px-Fläche — Strichzeichen hatten eine feste Länge und
 *  endeten je nach Schrift und Breite vor dem Rand oder liefen darüber. */
function linie(cls) {
    return new St.Widget({ style_class: cls, x_expand: true });
}

// --- Translation support -------------------------------------------------
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

// Die Einstellungsdatei enthält den Geräteschlüssel im Klartext. Cinnamon legt sie
// mit der Umask an (meist 0664, gruppenlesbar) — Audit SEC-DSK-001. Darum Ordner
// 0700 und Dateien 0600; GLib behält den Modus beim Zurückschreiben bei.
// Ältere Cinnamon-Versionen speichern unter ~/.cinnamon/configs/<uuid>.
// Ebenso die gekoppelte CA (ca-<id>.pem): nicht geheim, aber nur wir sollen sie tauschen können.
const EINSTELLUNGS_ORDNER = [
    GLib.get_user_config_dir() + '/cinnamon/spices/' + UUID,
    GLib.get_home_dir() + '/.cinnamon/configs/' + UUID,
];

function schuetzeEinstellungen() {
    for (let pfad of EINSTELLUNGS_ORDNER) {
        try {
            let dir = Gio.File.new_for_path(pfad);
            if (!dir.query_exists(null)) continue;
            dir.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            let liste = dir.enumerate_children('standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            let info;
            while ((info = liste.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                if (!info.get_name().endsWith('.json') && !info.get_name().endsWith('.pem')) continue;
                dir.get_child(info.get_name()).set_attribute_uint32('unix::mode', 0o600,
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            }
            liste.close(null);
        } catch (e) {
            global.logWarning('[' + UUID + '] Rechte der Einstellungen: ' + e.message);
        }
    }
}

// ---- TLS-Kopplung (Anfang) ----
// HTTPS gegen die eigene AutarkTrade-CA, Trust on first use mit Bestätigung: die CA
// kommt ohne Anmeldung über http://host:8080/api/esp32/ca ({pem, sha256}), der
// Fingerabdruck wird hier selbst gerechnet (der mitgeschickte ist nur Gegenprobe) und
// in den Einstellungen angezeigt; erst nach „Stimmt überein" wird die CA als Datei
// (0600) gespeichert. Danach ist sie der EINZIGE Vertrauensanker der Soup-Session
// (tls-database = Gio.TlsFileDatabase nur mit dieser Datei); die Prüfung des
// Hostnamens bzw. der IP im SAN macht GnuTLS wie üblich. Mit HTTPS an gibt es keinen
// Rückfall auf http. (Dieser Block wird vom Test im Scratch-Ordner herausgelöst.)

/** Erstes CERTIFICATE-Stück eines PEM → DER (Uint8Array) oder null. */
function pemZuDer(pem) {
    let m = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(String(pem || ''));
    if (!m) return null;
    try {
        let der = GLib.base64_decode(m[1].replace(/\s/g, ''));
        return der && der.length ? der : null;
    } catch (e) { return null; }
}

/** SHA-256 über das DER, hex gross mit Doppelpunkten — wie in der Web-App. */
function fingerabdruck(der) {
    let hex = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, der).toUpperCase();
    return hex.match(/../g).join(':');
}

function gleicherFingerabdruck(a, b) {
    let norm = s => String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    return norm(a).length > 0 && norm(a) === norm(b);
}

/** Erste und letzte vier Gruppen: „AB:CD:EF:01 … 9A:BC:DE:F0". */
function kurzFingerabdruck(fp) {
    let g = String(fp || '').split(':');
    return g.length <= 8 ? String(fp || '') : g.slice(0, 4).join(':') + ' … ' + g.slice(-4).join(':');
}

/** Antwort von /api/esp32/ca prüfen → {pem, fp}; wirft mit lesbarer Meldung. */
function pruefeCaAntwort(text) {
    let daten;
    try { daten = JSON.parse(text); } catch (e) { throw new Error(_("Certificate answer unreadable")); }
    let der = pemZuDer(daten && daten.pem);
    if (!der) throw new Error(_("Server sent no CA certificate"));
    try { Gio.TlsCertificate.new_from_pem(daten.pem, -1); }
    catch (e) { throw new Error(_("Certificate answer unreadable")); }
    let fp = fingerabdruck(der);
    if (daten.sha256 && !gleicherFingerabdruck(fp, daten.sha256))
        throw new Error(_("Fingerprint mismatch — connection tampered?"));
    return { pem: String(daten.pem).trim() + '\n', fp };
}

/** Ordner für die CA-Datei: der vorhandene Einstellungsordner, sonst der neue (0700). */
function caPfad(deskletId, ordnerListe) {
    let liste = ordnerListe || EINSTELLUNGS_ORDNER;
    let ordner = liste.find(p => GLib.file_test(p, GLib.FileTest.IS_DIR)) || liste[0];
    return ordner + '/ca-' + deskletId + '.pem';
}

/** CA-Datei schreiben: Ordner 0700, Datei 0600 (PRIVATE legt sie gleich so an). */
function speichereCa(pfad, pem) {
    let datei = Gio.File.new_for_path(pfad);
    let ordner = datei.get_parent();
    if (!ordner.query_exists(null)) ordner.make_directory_with_parents(null);
    ordner.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    datei.replace_contents(new TextEncoder().encode(pem), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    datei.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
}

/** Gespeicherte CA lesen → {pem, fp} oder null (fehlt/unlesbar). */
function ladeCa(pfad) {
    try {
        if (!GLib.file_test(pfad, GLib.FileTest.EXISTS)) return null;
        let [ok, inhalt] = GLib.file_get_contents(pfad);
        if (!ok) return null;
        let pem = new TextDecoder().decode(inhalt);
        let der = pemZuDer(pem);
        return der ? { pem, fp: fingerabdruck(der) } : null;
    } catch (e) {
        return null;
    }
}

/** Soup-Session; mit [caDatei] vertraut sie NUR dieser CA. */
function neueSession(caDatei) {
    let props = {};
    if (caDatei) props.tls_database = Gio.TlsFileDatabase.new(caDatei);
    let s;
    if (SOUP_VERSION === 3) {
        s = new Soup.Session(props);
    } else {
        // Soup 2: SessionAsync prüft Zertifikate nur mit ssl-strict und eigener Datenbank.
        if (caDatei) { props.ssl_strict = true; props.ssl_use_system_ca_file = false; }
        s = new Soup.SessionAsync(props);
    }
    s.add_feature(new Soup.CookieJar());
    return s;
}

/**
 * Einordnung eines fehlgeschlagenen Aufrufs: 'zertifikat' (CA/Name passt nicht),
 * 'tls' (sonstiger TLS-Fehler, z. B. kein HTTPS auf dem Port) oder null.
 */
function tlsFehlerArt(status, fehler) {
    if (fehler && fehler.matches) {
        if (fehler.matches(Gio.TlsError, Gio.TlsError.BAD_CERTIFICATE)) return 'zertifikat';
        if (fehler.domain === Gio.tls_error_quark()) return 'tls';
    }
    if (fehler && /certificate|zertifikat/i.test(fehler.message || '')) return 'zertifikat';
    if (fehler && /\btls\b|ssl/i.test(fehler.message || '')) return 'tls';
    if (SOUP_VERSION === 2 && status === 6) return 'zertifikat';   // SOUP_STATUS_SSL_FAILED
    return null;
}

/** GET über [session]; callback(status, body, fehler). */
function soupGet(session, url, callback, headers) {
    let msg = Soup.Message.new('GET', url);
    if (SOUP_VERSION === 3) {
        if (headers) {
            let h = msg.get_request_headers();
            for (let name in headers) h.append(name, headers[name]);
        }
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, result) => {
            try {
                let bytes  = s.send_and_read_finish(result);
                let status = msg.get_status();
                let body   = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
                callback(status, body, null);
            } catch(e) {
                global.logError('[' + UUID + '] soup GET ' + url + ': ' + e.message);
                callback(0, '', e);
            }
        });
    } else {
        if (headers) {
            for (let name in headers) msg.request_headers.append(name, headers[name]);
        }
        session.queue_message(msg, (s, response) => {
            let status = response.status_code;
            let body   = response.response_body ? response.response_body.data : '';
            callback(status, body, null);
        });
    }
}
// ---- TLS-Kopplung (Ende) ----

function _(str) {
    let translation = Gettext.dgettext(UUID, str);
    if (translation !== str && translation !== "") return translation;
    return Gettext.gettext(str);
}

class TradingPositionsDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._metadata = metadata;

        // Settings
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._settings.bind("server-host",      "serverHost",      this._onSettingChanged.bind(this));
        this._settings.bind("server-port",      "serverPort",      this._onSettingChanged.bind(this));
        this._settings.bind("api-key",          "apiKey",          this._onSettingChanged.bind(this));
        this._settings.bind("use-https",        "useHttps",        this._onSettingChanged.bind(this));
        this._settings.bind("https-port",       "httpsPort",       this._onSettingChanged.bind(this));
        this._settings.bind("ca-pending",       "caPending");
        this._settings.bind("ca-paired",        "caPaired");
        this._settings.bind("refresh-interval", "refreshInterval", this._onSettingChanged.bind(this));
        this._settings.bind("show-leverage",    "showLeverage",    this._onSettingChanged.bind(this));
        this._settings.bind("show-mark-price",  "showMarkPrice",   this._onSettingChanged.bind(this));
        this._settings.bind("show-realized-pnl","showRealizedPnl", this._onSettingChanged.bind(this));
        this._settings.bind("show-bots",        "showBots",        this._onSettingChanged.bind(this));
        this._settings.bind("show-github-link", "showGithubLink",  this._onFooterChanged.bind(this));
        this._settings.bind("font-size",        "fontSize",        this._onStyleChanged.bind(this));
        this._settings.bind("font-size-ui",    "fontSizeUi",      this._onStyleChanged.bind(this));
        this._settings.bind("bg-opacity",       "bgOpacity",       this._onStyleChanged.bind(this));
        this._settings.bind("min-width",        "minWidth",        this._onStyleChanged.bind(this));

        this._cookieAcquired = false;
        this._timeoutId      = null;
        this._appVersion     = null;
        this._deskletId      = desklet_id;
        this._caOffen        = null;   // abgeholte, noch nicht bestätigte CA {pem, fp, host}

        schuetzeEinstellungen();
        this._initSoup();
        this._ladeKopplung();
        this._buildUI();
        this._applyStyle();
        this._startPolling();
    }

    get _baseUrl() {
        let host = (this.serverHost || 'localhost').trim();
        if (this.useHttps) return `https://${host}:${this.httpsPort || 8443}`;
        return `http://${host}:${this.serverPort}`;
    }

    /** Klartext-Adresse — nur zum Abholen der CA beim Koppeln (und ohne HTTPS). */
    get _httpUrl() {
        let host = (this.serverHost || 'localhost').trim();
        return `http://${host}:${this.serverPort}`;
    }

    // ------------------------------------------------------------------ HTTPS-Kopplung

    get _caDatei() { return caPfad(this._deskletId); }

    /** Gespeicherte CA laden und die HTTPS-Session darauf bauen (sonst keine). */
    _ladeKopplung() {
        let ca = ladeCa(this._caDatei);
        this._tlsSession = null;
        if (ca) {
            try { this._tlsSession = neueSession(this._caDatei); }
            catch (e) { global.logWarning('[' + UUID + '] CA-Datei: ' + e.message); }
        }
        let anzeige = (ca && this._tlsSession) ? ca.fp : '';
        if (this.caPaired !== anzeige) this.caPaired = anzeige;
    }

    /** Knopf „Fetch server certificate": CA über HTTP holen, Fingerabdruck zum Vergleich zeigen. */
    onCaHolen() {
        this._caOffen = null;
        this.caPending = _("Fetching…");
        let host = (this.serverHost || '').trim();
        soupGet(this._session, this._httpUrl + '/api/esp32/ca', (status, body) => {
            if (status !== 200) {
                this.caPending = status === 404
                    ? _("Server too old — /api/esp32/ca missing (404)")
                    : _("Server not reachable") + ` (${this._httpUrl})`;
                return;
            }
            try {
                let ca = pruefeCaAntwort(body);
                this._caOffen = { pem: ca.pem, fp: ca.fp, host };
                this.caPending = ca.fp;
                this._showStatus(_("Compare the fingerprint with Settings › General › HTTPS in the web app:") +
                    '\n' + kurzFingerabdruck(ca.fp) + '\n' + _("Then press \"Fingerprint matches\" in the desklet settings."));
            } catch (e) {
                this.caPending = e.message;
            }
        });
    }

    /** Knopf „Fingerprint matches — pair": abgeholte CA speichern, ab jetzt nur HTTPS mit ihr. */
    onCaBestaetigen() {
        let offen = this._caOffen;
        if (!offen || !gleicherFingerabdruck(offen.fp, this.caPending)) {
            this.caPending = _("Fetch the server certificate first");
            return;
        }
        if (offen.host !== (this.serverHost || '').trim()) {
            this._caOffen = null;
            this.caPending = _("Host changed — fetch the certificate again");
            return;
        }
        try {
            speichereCa(this._caDatei, offen.pem);
        } catch (e) {
            this.caPending = _("Could not save the certificate:") + ' ' + e.message;
            return;
        }
        this._caOffen = null;
        this.caPending = '';
        this._ladeKopplung();
        this._startPolling();
    }

    // ------------------------------------------------------------------ Style

    _applyStyle() {
        let opacity = Math.max(0, Math.min(100, this.bgOpacity ?? 88)) / 100;
        let fs      = this.fontSize    ?? 12;
        let fsUi    = this.fontSizeUi  ?? 11;
        let mw      = this.minWidth    ?? 480;
        this._outer.set_style(
            `background-color: rgba(12,18,22,${opacity.toFixed(2)});` +
            `min-width: ${mw}px;`
        );
        // Scaling factor for column widths (base: fs=12)
        let scale = fs / 12;
        this._colWidths = {
            symbol:   Math.round(90  * scale),
            side:     Math.round(55  * scale),
            leverage: Math.round(36  * scale),
            price:    Math.round(78  * scale),
            pnl:      Math.round(95  * scale),
            realized: Math.round(85  * scale),
        };
        // Positions
        this._posFs        = fs;
        // UI elements (title, footer, total, header)
        this._headerFs     = fs;  // header same size as positions
        this._titleStyle   = `font-size: ${fsUi + 3}px;`;
        this._subtitleStyle = `font-size: ${fsUi}px;`;
        this._totalStyle   = `font-size: ${fsUi}px;`;  // same as subtitle
        this._footerStyle  = `font-size: ${Math.max(8, fsUi - 1)}px;`;
    }

    _onStyleChanged() {
        this._applyStyle();
        // Update static UI elements
        if (this._titleLabel)    this._titleLabel.set_style(this._titleStyle);
        if (this._titleAkzent)   this._titleAkzent.set_style(this._titleStyle);
        if (this._subtitleLabel) this._subtitleLabel.set_style(this._subtitleStyle);
        if (this._footerTime)    this._footerTime.set_style(this._footerStyle);
        if (this._footerRight)   this._footerRight.set_style(this._footerStyle);
        // Re-render so the position font size takes effect immediately
        this._refresh();
    }

    // ------------------------------------------------------------------ Soup

    // Zwei Sessions: _session (Klartext, Kopplung und Betrieb ohne HTTPS) und
    // _tlsSession (nur die gekoppelte CA, siehe _ladeKopplung).
    _initSoup() {
        this._session = neueSession(null);
        this._tlsSession = null;
    }

    _soupGet(url, callback, headers) {
        soupGet(this.useHttps ? this._tlsSession : this._session, url, callback, headers);
    }

    // ------------------------------------------------------------------ UI

    _buildUI() {
        // Outer frame
        let outer = new St.BoxLayout({ vertical: true, style_class: 'trading-desklet' });
        this._outer = outer;
        this.setContent(outer);

        // --- Logo-Header ---
        let headerRow = new St.BoxLayout({ style_class: 'desklet-header-row' });

        // Logo
        let iconPath = this._metadata.path + '/icon.png';
        try {
            let gicon = Gio.icon_new_for_string(iconPath);
            let logo  = new St.Icon({ gicon: gicon, icon_size: 42, style_class: 'desklet-logo' });
            headerRow.add_child(logo);
        } catch(_) {}

        // Title
        let titleBox = new St.BoxLayout({ vertical: true, style_class: 'desklet-title-box' });
        // Schriftzug wie in der Kopfleiste der Web-App: „Autark" + „Trade" in Akzentfarbe.
        let titleRow = new St.BoxLayout({ style_class: 'desklet-title-row' });
        this._titleLabel    = new St.Label({ text: 'Autark', style_class: 'desklet-title' });
        this._titleAkzent   = new St.Label({ text: 'Trade', style_class: 'desklet-title-akzent' });
        titleRow.add_child(this._titleLabel);
        titleRow.add_child(this._titleAkzent);
        this._subtitleLabel = new St.Label({ text: _('Open positions & bots'), style_class: 'desklet-subtitle' });
        titleBox.add_child(titleRow);
        titleBox.add_child(this._subtitleLabel);
        headerRow.add_child(titleBox);
        outer.add_child(headerRow);

        // Separator after header
        outer.add_child(linie('linie'));

        // --- Content area (positions / status) ---
        this._content = new St.BoxLayout({ vertical: true, style_class: 'desklet-content' });
        outer.add_child(this._content);

        // --- Footer ---
        outer.add_child(linie('linie'));
        let footer = new St.BoxLayout({ style_class: 'desklet-footer' });
        this._footerTime  = new St.Label({ text: '', style_class: 'footer-time' });
        this._footerRight = new St.Label({ text: '', style_class: 'footer-right' });
        this._updateFooterRight();
        footer.add_child(this._footerTime);
        let spacer = new St.Widget({ x_expand: true });
        footer.add_child(spacer);
        footer.add_child(this._footerRight);
        outer.add_child(footer);

        this._showStatus(_("Connecting…"));
    }

    // ------------------------------------------------------------------ Polling

    _startPolling() {
        this._stopPolling();
        this._refresh();
        this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _refresh() {
        this._fetchDisplay();
    }

    // Single read-only call to the public, key-authenticated endpoint
    // (X-ESP32-Key header — no session cookie). Works even with the app's
    // optional password gate enabled. Returns futures (openPositions) + bots.
    _fetchDisplay() {
        if (!this.apiKey) {
            this._showStatus(_("No API key set.\nEnter it in the desklet settings."));
            return;
        }
        // HTTPS an, aber (noch) nicht gekoppelt: nichts senden — schon gar nicht per http.
        if (this.useHttps && !this._tlsSession) {
            this._showStatus(_("HTTPS is on but not paired yet.\nSettings → \"Fetch server certificate\", compare, confirm."));
            return;
        }
        this._soupGet(this._baseUrl + '/api/esp32/display', (status, body, fehler) => {
            if (status === 401) {
                this._showStatus(_("Invalid API key (401)"));
                return;
            }
            if (status !== 200) {
                let art = this.useHttps ? tlsFehlerArt(status, fehler) : null;
                if (art === 'zertifikat') {
                    this._showStatus(_("Certificate does not match — pair again\n(or the host is not in the server certificate)"));
                } else if (art === 'tls') {
                    this._showStatus(_("HTTPS connection failed — check the HTTPS port") + `\n${this._baseUrl}`);
                } else {
                    this._showStatus(_("Server not reachable") + `\n${this._baseUrl.replace(/^https?:\/\//, '')}`);
                }
                return;
            }
            let data;
            try {
                data = JSON.parse(body);
            } catch(e) {
                this._showStatus(_("Parse error:") + "\n" + e.message);
                return;
            }
            this._futures = data.openPositions || [];
            let bots = (this.showBots !== false) ? (data.bots || []) : [];
            this._renderAll(this._futures, bots);
            this._updateFooterTime();
        }, { 'X-ESP32-Key': this.apiKey });
    }

    _updateFooterTime() {
        let now = new Date();
        let hh  = String(now.getHours()).padStart(2, '0');
        let mm  = String(now.getMinutes()).padStart(2, '0');
        let ss  = String(now.getSeconds()).padStart(2, '0');
        if (this._footerTime) {
            this._footerTime.set_text(_("Updated: %s").format(`${hh}:${mm}:${ss}`));
        }
    }

    _updateFooterRight() {
        if (!this._footerRight) return;
        let text = this._appVersion ? `v${this._appVersion}` : '';
        if (this.showGithubLink !== false) {
            if (text) text += '  \u2022  ';
            text += 'AutarkTrade';
        }
        this._footerRight.set_text(text);
    }

    _onFooterChanged() {
        this._updateFooterRight();
    }

    // ------------------------------------------------------------------ Render

    _renderAll(positions, bots) {
        this._content.destroy_all_children();

        positions = positions || [];
        bots      = bots || [];

        if (positions.length === 0 && bots.length === 0) {
            this._content.add_child(
                new St.Label({ text: _("No open positions"), style_class: 'no-positions-label' })
            );
            return;
        }

        // Futures nach Börse gruppieren — je eine Sektion (alphabetisch sortiert).
        let renderedAny = false;
        if (positions.length > 0) {
            let byBroker = {};
            for (let p of positions) {
                let b = p.broker || '?';
                (byBroker[b] = byBroker[b] || []).push(p);
            }
            for (let b of Object.keys(byBroker).sort()) {
                if (renderedAny) this._content.add_child(linie('linie-duenn'));
                this._renderFuturesSection(byBroker[b], this._brokerLabel(b));
                renderedAny = true;
            }
        }

        if (bots.length > 0) {
            if (renderedAny) {
                this._content.add_child(linie('linie-duenn'));
            }
            this._renderBotSection(bots);
        }
    }

    _brokerLabel(b) {
        switch ((b || '').toLowerCase()) {
            case 'bitunix': return 'Bitunix';
            case 'bitget':  return 'Bitget';
            case 'pionex':  return 'Pionex';
            default:        return b ? b.charAt(0).toUpperCase() + b.slice(1) : '—';
        }
    }

    // Side einheitlich LONG/SHORT/NEUTRAL (nicht BUY/SELL).
    _displaySide(s) {
        let u = (s || '').toString().toUpperCase();
        if (u === 'BUY'  || u === 'LONG')  return 'LONG';
        if (u === 'SELL' || u === 'SHORT') return 'SHORT';
        return u || '-';
    }

    _renderFuturesSection(positions, brokerLabel) {
        // Total PnL
        let totalPnl   = positions.reduce((sum, p) => sum + (parseFloat(p.unrealizedPNL) || 0), 0);
        let totalClass = totalPnl >= 0 ? 'pnl-profit' : 'pnl-loss';
        let totalSign  = totalPnl >= 0 ? '+' : '';
        let totalRow   = new St.BoxLayout({ style_class: 'total-row' });
        let posWord = positions.length === 1 ? _("position") : _("positions");
        let prefix = brokerLabel ? brokerLabel + '  ' : _("Total:") + '  ';
        let totalLbl = new St.Label({
            text: prefix + `${totalSign}${totalPnl.toFixed(2)} USDT   (${positions.length} ${posWord})`,
            style_class: 'total-label ' + totalClass
        });
        if (this._totalStyle) totalLbl.set_style(this._totalStyle);
        totalRow.add_child(totalLbl);
        this._content.add_child(totalRow);
        this._content.add_child(linie('linie-duenn'));

        // Header row — same column widths as the position rows
        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage)  headerCells.push({ text: _('Lvg'),  width: this._colWidths.leverage });
        headerCells.push({ text: _('Entry'), width: this._colWidths.price });
        if (this.showMarkPrice) headerCells.push({ text: _('Mark'), width: this._colWidths.price });
        headerCells.push({ text: _('unr. PnL'), width: this._colWidths.pnl });
        if (this.showRealizedPnl !== false) headerCells.push({ text: _('real. PnL'), width: this._colWidths.realized });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let pos of positions) {
            this._content.add_child(this._makePositionRow(pos));
        }
    }

    // Dedicated section for running Pionex bots. PnL/margin is in the
    // respective margin coin (e.g. SOL for Coin-M) — therefore NO USDT total
    // (coins are not summable), just the count + liquidation price per bot.
    _renderBotSection(bots) {
        let titleRow = new St.BoxLayout({ style_class: 'total-row' });
        let titleLbl = new St.Label({
            text: _("Bots:") + `  ${bots.length} ` + _("running"),
            style_class: 'total-label'
        });
        if (this._totalStyle) titleLbl.set_style(this._totalStyle);
        titleRow.add_child(titleLbl);
        this._content.add_child(titleRow);
        this._content.add_child(linie('linie-duenn'));

        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage) headerCells.push({ text: _('Lvg'), width: this._colWidths.leverage });
        headerCells.push({ text: _('Ø Entry'), width: this._colWidths.price });
        headerCells.push({ text: _('Liq'),     width: this._colWidths.price });
        headerCells.push({ text: _('PnL'),     width: this._colWidths.pnl });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let bot of bots) {
            this._content.add_child(this._makeBotRow(bot));
        }
    }

    _makeBotRow(pos) {
        let coin     = pos.marginCoin || 'USDT';
        let dec      = coin === 'USDT' ? 2 : 4;
        let pnl      = parseFloat(pos.unrealizedPNL) || 0;
        let isProfit = pnl >= 0;
        let pnlClass = isProfit ? 'pnl-profit' : 'pnl-loss';
        let pnlText  = (isProfit ? '+' : '') + pnl.toFixed(dec) + ' ' + coin;
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let liq = pos.liqPrice;
        if (!liq && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                liq = bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bot bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [
            { text: pos.symbol || '-', cls: 'symbol-cell',            width: cw.symbol },
            { text: this._displaySide(pos.side), cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage) cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: fmt(liq),            cls: 'price-cell', width: cw.price });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makePositionRow(pos) {
        let pnl       = parseFloat(pos.unrealizedPNL) || 0;
        let isProfit  = pnl >= 0;
        let pnlClass  = isProfit ? 'pnl-profit' : 'pnl-loss';
        let pnlText   = (isProfit ? '+' : '') + pnl.toFixed(2) + ' USDT';
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let markPrice = pos.markPrice;
        if (!markPrice && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                markPrice = bd.markPrice || bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [
            { text: pos.symbol || '-', cls: 'symbol-cell',            width: cw.symbol },
            { text: this._displaySide(pos.side), cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage)  cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        if (this.showMarkPrice) cells.push({ text: fmt(markPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        if (this.showRealizedPnl !== false) {
            let realized = parseFloat(
                pos.realizedPNL ?? pos.realized_pnl ?? pos.realizedPnl ?? pos.realizedPL ?? 0
            ) || 0;
            let realClass = realized >= 0 ? 'pnl-profit' : 'pnl-loss';
            let realText  = (realized >= 0 ? '+' : '') + realized.toFixed(2) + ' USDT';
            cells.push({ text: realText, cls: 'pnl-cell ' + realClass, width: cw.realized });
        }

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makeHeaderRow(cells) {
        let fs  = this._headerFs || 12;
        let row = new St.BoxLayout({ style_class: 'header-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: 'header-cell' });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _showStatus(text) {
        this._content.destroy_all_children();
        this._content.add_child(new St.Label({ text, style_class: 'status-label' }));
    }

    // ------------------------------------------------------------------ Lifecycle

    _onSettingChanged() {
        schuetzeEinstellungen();   // falls Cinnamon die Datei neu angelegt hat
        this._cookieAcquired = false;
        this._appVersion     = null;  // server change → fetch version again
        this._ladeKopplung();
        this._startPolling();
    }

    on_desklet_removed() {
        this._stopPolling();
    }
}

function main(metadata, desklet_id) {
    return new TradingPositionsDesklet(metadata, desklet_id);
}
