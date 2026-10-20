# A2 → Rückportierung ins alte Journal (Stand 20.10.2026)

Für das produktive **Crypto Trading Journal** (`/home/maro/Schreibtisch/Trading/Journal`, HEAD `f910385`, läuft auf der NAS). Dort wurde **nichts** geändert, kein Branch angelegt, nichts ausgerollt — diese Datei sagt nur, *was* zu tun wäre und *wie*.

Die Patch-Ausschnitte stammen aus der Korrektur F2 in V2 (Commits `3ca18b6` Zugangsschicht, `364b91e` übrige Befunde). Die Dateien des Journals sind fast gleich gebaut (A2: `auth.js` unterscheidet sich nur durch `process.env.CTJ_*` statt `umgebung()` und den Cookie-Namen, `backup-api.js` ist identisch, `net-guard.js` bis auf die festen Hosts). Wo V2 `umgebung('X')`/`umgebungAn('X')` schreibt, heisst es im Journal `process.env.CTJ_X` bzw. `process.env.CTJ_X === '1'`.

**Wichtig für die NAS:** Das Journal läuft im Container hinter Caddy, mit Passwort-Gate und `CTJ_SECRET`. Für diesen Betrieb sind **A2-03, A2-05, A2-06, A2-07, A2-09, A2-10, A2-11, A2-04/12** die relevanten; A2-01/A2-02 greifen nur, wenn ein Browser auf dem NAS selbst läuft (Peer im Container ist nie loopback).

## Übersicht

| Befund | Im Journal? | Dringlichkeit dort | Patch-Ort im Journal |
|---|---|---|---|
| A2-01 Rebinding `127.`-Präfix | ja | gering (Container) | `server/auth.js:141` |
| A2-02 CSRF `/api/auth/reset` | ja | gering (Container) | `server/update-api.js:74`, `server/auth.js:549`, `src/components/LoginGate.vue` |
| A2-03 XFF-Sperre umgehbar | ja | **hoch** (Port 8080 im LAN + `CTJ_TRUST_PROXY:-1`) | `server/auth.js:400–420`, `docker-compose.yml:29` |
| A2-04 net-guard IPv4-in-IPv6, Rebinding | ja | mittel | `server/net-guard.js:67`, Abrufe |
| A2-05 Schlüssel an frei wählbare URL | ja (ohne `aiDeepseekUrl`) | **hoch** bei Sitzungsdiebstahl | `server/ollama-api.js:184`, `:274`, `server/api-routes.js:67–83`, Mail/ntfy/DB-Test |
| A2-06 Backup mit `settings.id ≠ 1` | ja | mittel | `server/backup-api.js:293ff.` |
| A2-07 Geheimnis-Spalten fehlen | ja | mittel | `server/api-routes.js:32` |
| A2-08 ohne Secret (nativ) | ja | keine auf der NAS (Docker erzwingt `CTJ_SECRET`) | `server/crypto.js:5–25` |
| A2-09 Import schreibt Schlüssel/Ziele | ja | mittel | `server/backup-api.js` |
| A2-10 root + Docker-Socket | ja | **hoch** (root auf der NAS) | `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml:36` |
| A2-11 synchrones scrypt (DoS) | ja | mittel | `server/auth.js:381–395` |
| A2-12 Chartbilder ohne net-guard | ja | mittel | `server/marktradar-news.js:586` |
| A2-13 Präfix-„lokal"-Prüfungen | ja | mittel | `server/ollama-url.js`, `server/api-routes.js:210` |
| A2-14 Abhängigkeiten | ja (13, zusätzlich `sharp`) | mittel | `npm audit fix`, nodemailer ≥ 10.0.9 |
| A2-15 Token im Lizenzschlüssel | **nein** (keine Lizenz) | — | — |
| A2-16 Erst-Einrichtung „wer zuerst kommt" | ja | gering (Gate gesetzt) | `server/auth.js`, `LoginGate.vue` |
| A2-17/18 Tooltip-XSS | ja | gering | `KachelMarkt.vue`, `diagramme/*` |
| A2-19 KI-HTML mit fremden Bildern | ja | gering | `src/utils/sanitize.js` |
| A2-20 DexScreener-URL ohne `sichereUrl` | ja | gering | Hype-Radar-Ansichten |
| A2-21 keine CSP | ja | gering | `index.mjs:65`, `vite.config.js` |
| A2-22 kein „überall abmelden" | ja | gering | `server/auth.js` |
| A2-23 Passwort ≥ 6, currentPassword ohne Zähler | ja | gering | `server/auth.js:509` |
| A2-24 `aiDeepseekUrl` generisch setzbar | **nein** (Feld fehlt dort), aber `aiCustomUrl`/`aiKeyOpenrouter` ja → siehe A2-05 | — | — |
| A2-25 db-config-Restore ohne Hostprüfung | ja | gering | `server/backup-api.js` |
| A2-26 Update ohne Integritätsprüfung | ja (öffentliches Repo) | gering | `server/update-api.js` (`npm ci`) |
| A2-27 Webhook-URL in Fehlertexten | ja | gering | `server/hype-radar/zustellung.js` |
| A2-28 `reencrypt-keys.mjs` vergisst Spalten | ja | gering | `server/reencrypt-keys.mjs` |
| A2-29 SMTP-Zahlen-Host | ja | gering | `server/benachrichtigungen.js` |
| A2-30 `AT_`→`CTJ_`-Rückfall | **nein** (Journal liest nur `CTJ_`) | — | — |
| A2-31 „Update-PIN" in der Hilfe | ja | Info | `server/app-hilfe.js` |
| A2-34 Masken 8 Zeichen | ja | Info | `server/crypto.js`, `flux-api.js`, `ollama-api.js`, `hype-radar/einstellungen.js` |

## Patches je Befund

### A2-01 — `server/auth.js:141`

```js
export function istLoopbackHost(host) {
    const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
    return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h)
}
```

### A2-02 — `server/update-api.js:74` (`isLocalRequest`) + Reset-Route

Am Ende von `isLocalRequest` vor `return true`:

```js
    if (istFremdeHerkunft(req)) return false
    return true
}

export function istFremdeHerkunft(req) {
    const h = req?.headers || {}
    const sfs = String(h['sec-fetch-site'] || '').toLowerCase()
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') return true
    const origin = h.origin
    if (origin === undefined || origin === '') return false
    try { return new URL(String(origin)).host.toLowerCase() !== String(h.host || '').toLowerCase() }
    catch { return true }
}
```

In `app.post('/api/auth/reset', …)` nach der `isLocalRequest`-Prüfung:

```js
        if (!req.is('application/json')) {
            return res.status(415).json({ error: 'Zurücksetzen nur aus der App heraus.' })
        }
        …
            await loadAuthConfig()
            await entwerteAlleSitzungen()   // A2-22
```

`src/components/LoginGate.vue`: `axios.post('/api/auth/reset', { zuruecksetzen: true })`.

### A2-03 — `server/auth.js:400ff.` + Compose

`clientIp` asynchron, XFF nur vom vertrauten Proxy (im Journal `CTJ_TRUSTED_PROXY`, Vorgabe die Caddy-Dienstnamen des NAS-Projekts):

```js
const PROXY_VORGABE = ['caddy', 'autarktrade-caddy', 'journal-caddy']   // NAS-Namen eintragen
let proxyCache = { schluessel: '', bis: 0, ips: new Set() }
const normIp = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '').toLowerCase()

async function vertrauteProxyIps() {
    const liste = String(process.env.CTJ_TRUSTED_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean)
    const namen = liste.length ? liste : PROXY_VORGABE
    const schluessel = namen.join(',')
    if (proxyCache.schluessel === schluessel && Date.now() < proxyCache.bis) return proxyCache.ips
    const ips = new Set()
    const { lookup } = await import('dns/promises')
    const net = await import('net')
    for (const n of namen) {
        if (net.isIP(n)) { ips.add(normIp(n)); continue }
        try { for (const a of await lookup(n, { all: true })) ips.add(normIp(a.address)) } catch { /* nicht hier */ }
    }
    proxyCache = { schluessel, bis: Date.now() + 60_000, ips }
    return ips
}

async function clientIp(req) {
    const peer = normIp(req.socket?.remoteAddress || req.ip || 'unknown')
    if (process.env.CTJ_TRUST_PROXY === '1' && (await vertrauteProxyIps()).has(peer)) {
        const letzte = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop()
        if (letzte) return normIp(letzte)
    }
    return peer
}
```

Dazu die globale Bremse (`GLOBAL_MAX = 60` Fehlversuche/Minute über alle Adressen) in `isRateLimited`/`registerFailure`, und `const ip = await clientIp(req)` in `/api/login`. Compose:

```yaml
      - CTJ_TRUST_PROXY=${CTJ_TRUST_PROXY:-1}
      - CTJ_TRUSTED_PROXY=${CTJ_TRUSTED_PROXY:-caddy}   # Name des Caddy-Dienstes im NAS-Projekt
```

Vollständig: V2 `server/auth.js` ab „Rate-Limiting" (Commit `3ca18b6`).

### A2-04 / A2-12 / A2-33 — `server/net-guard.js`

1. `istPrivatV6` über die acht Gruppen statt per Regex (fängt `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, NAT64, Multicast) — Funktion `v6Gruppen` + `istPrivatV6` aus V2 `server/net-guard.js` 1:1 übernehmbar.
2. Verbindung festnageln: `npm install undici@^6` (MIT), dann

```js
import { Agent } from 'undici'
export function sichererLookup(hostname, optionen, rueckruf) { /* aus V2 */ }
export const GESCHUETZT = new Agent({ connect: { lookup: sichererLookup } })
…
antwort = await fetch(ziel, { signal: ctrl.signal, redirect: 'manual', dispatcher: GESCHUETZT, headers: … })
```

   und den Timer erst nach dem Lesen des Rumpfs löschen (A2-33).
3. `holeBinaer` (V2) ergänzen und `ladeBildAlsAnhang` in `server/marktradar-news.js:586` darauf umstellen:

```js
async function ladeBildAlsAnhang(url, timeoutMs = 15000) {
    const { daten, typ } = await holeBinaer(url, { timeout: timeoutMs, maxBytes: 8 * 1024 * 1024, typ: /^image\// })
    return { kind: 'image', base64: daten.toString('base64'), mediaType: typ || 'image/jpeg' }
}
```

4. `server/hype-radar/smartmoney.js` (`rpc`): `dispatcher: GESCHUETZT` im `fetch`.

### A2-05 — Schlüssel nur an die gespeicherte Adresse

`server/ollama-api.js:184` (`/api/ai/status`): `const basis = anbieterBasis(provider, settings)` — `req.query.customUrl` ersatzlos streichen.

`server/ollama-api.js:274` (`/api/ai/test`): merken, ob der maskierte Schlüssel aus der DB kam, und dann

```js
                const gespeicherteBasis = await anbieterBasisAusDb(provider)
                const basis = roh ? basisUrl(roh) : gespeicherteBasis
                …
                if (gespeicherterSchluessel && basis !== gespeicherteBasis) {
                    return res.json({ success: false, message: 'Der gespeicherte Schlüssel wird nur an die gespeicherte Adresse geschickt. …' })
                }
                if (roh) { try { await pruefeKiEndpunkt(basis) } catch (e) { return res.json({ success: false, message: `Adresse abgelehnt: ${e.message}` }) } }
```

`POST /api/ai/settings`: vor dem Update die alte Basis je Anbieter mit der neuen vergleichen und bei Änderung ohne neuen Schlüssel die Schlüsselspalte leeren (Block „Schlüssel an die Adresse binden" in V2). `server/api-routes.js:67–83`: `aiApiKey`, `aiOllamaUrl`, `aiQwenUrl`, `aiCustomUrl`, `aiKeyCustom`, `aiKeyOpenrouter`, `aiKey*`, `fluxApiKey`, `geminiImageApiKey`, `esp32ApiKey` aus `VALID_SETTINGS_KEYS` nehmen (geschrieben wird über die eigenen Routen).

ntfy (`server/hype-radar-api.js`, PUT einstellungen), SMTP (`server/benachrichtigungen.js:638`) und DB-Test (`server/api-routes.js`, `/api/db-config/test`): dieselbe Regel — ändert sich Ziel/Host/Benutzer ohne neues Geheimnis, wird das alte geleert bzw. nicht verwendet. Code jeweils aus V2 (Commit `364b91e`).

### A2-06 / A2-09 / A2-25 — `server/backup-api.js`

```js
const PRESERVE_SETTINGS_FIELDS = [...REDACTED_SETTINGS_KEYS, 'authEnabled',
    'aiCustomUrl', 'aiQwenUrl', 'aiOllamaUrl', 'mailHost', 'mailPort', 'mailUser', 'mailSicherheit', 'mailVon', 'mailAn',
    'rechtlichesZustimmung', 'apis']
const IMPORT_UEBERSPRINGEN = new Set(['bitunix_config', 'bitget_config', 'pionex_config'])
…
                for (const table of DELETE_ORDER) { if (IMPORT_UEBERSPRINGEN.has(table)) continue; … }
…
                    let rows = tables[table]
                    if (IMPORT_UEBERSPRINGEN.has(table)) { imported[table] = 'übersprungen'; continue }
                    if (table === 'settings') rows = [{ ...rows[0], id: 1 }]
…
                        const n = await trx('settings').where('id', 1).update(restore)
                        if (!n && tables.settings?.length) throw new Error('Einstellungen nach dem Import nicht auffindbar (id 1)')
```

Dazu `hype_settings.alarmKanaele` vor dem Leeren sichern und zurückschreiben, nach dem Import `await loadAuthConfig()`, und bei `dbConfig` zusätzlich `isAllowedDbHost(host)` verlangen und `[REDACTED]` nie wörtlich speichern.

### A2-07 / A2-28 — eine abgeleitete Liste

`server/geheimnisse.js` aus V2 übernehmen (importiert `KEY_SPALTEN`/`KI_URL_SPALTEN` aus `ai-models.js`, die es im Journal gibt) und `SETTINGS_SENSITIVE_FIELDS = [...GEHEIME_SETTINGS]` in `server/api-routes.js:32`; `reencrypt-keys.mjs` liest `ALLE_VERSCHLUESSELTEN`. Die fehlenden Spalten im Journal: `aiKeyOpenrouter`, `aiKeyMoonshot`, `aiKeyZai`, `aiKeyMinimax`, `hypeKeyCoingecko`, `hypeKeySolanaRpc`, `hypeAlarmNtfyToken`, `hypeAlarmTelegramToken`, `hypeAlarmWebhookUrl`, `hypeKeyCryptopanic`, `hypeKeyLunarcrush` (soweit vorhanden). `apis`-Schlüssel: beim PUT verschlüsseln, beim GET entschlüsseln, im Export redigieren (`apisSchluesselVerschluesseln`, `settingsAusliefern` in V2).

### A2-08 — `server/crypto.js` (nur native Installationen)

Auf der NAS ohne Wirkung (Docker erzwingt `CTJ_SECRET`). Für native Installationen den Block „Secret-Datei" aus V2 übernehmen (`.at-secret` → im Journal sinnvollerweise `.ctj-secret`), mit `ALT_SCHLUESSEL` für den Maschinen-Seed und `migriereAltSchluessel` beim Start; `.gitignore`/`.dockerignore` ergänzen.

### A2-10 — Container ohne root, ohne Socket

`Dockerfile` (Endstufe):

```dockerfile
COPY --chown=node:node server/ ./server/
…
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/data && chown node:node /app /app/data
```

`docker-entrypoint.sh` vor `exec "$@"`:

```sh
if [ "$(id -u)" = "0" ]; then
    if [ -f /app/db-config.json ]; then chown node:node /app/db-config.json && chmod 600 /app/db-config.json; fi
    if [ -d /app/data ] && [ "$(stat -c %u /app/data)" != "$(id -u node)" ]; then
        chown -R node:node /app/data || echo "-> WARNUNG: Eigentum von /app/data nicht übertragbar"
    fi
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
```

`docker-compose.yml:36`: Mount `/var/run/docker.sock` entfernen (das Klick-Update ist im Container ohnehin nicht auslösbar, A2-26). Updates per `docker compose pull && docker compose up -d`.

### A2-11 / A2-16 / A2-22 / A2-23 — `server/auth.js`

Aus V2 übernehmen: `scryptAsync` + `mitHashPlatz` (2 parallel, Schlange 16 → 429), `pruefeMitZaehler` auch für `currentPassword` in `set-password` und `disable`, `PASSWORT_MIN = 10`, Einrichtungscode (`erzeugeCode`, `meldeEinrichtungsCode`, `codePasst`) samt Feld in `LoginGate.vue`/`App.vue` (`codeNoetig`), `POST /api/auth/ueberall-abmelden` und der Knopf in den Einstellungen, `entwerteAlleSitzungen()` auch bei der Erst-Einrichtung und beim Reset.

### A2-13 / A2-29 — Lokal-Prüfungen

`server/ollama-url.js`: `istLokalesZiel(host)` (nur `localhost` und echte IP-Literale aus 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7, auch IPv4-mapped) für `isAllowedOllamaUrl` und `isAllowedDbHost`; `pruefeKiEndpunkt` mit Rückführung von `::ffff:…` auf IPv4 und Abbruch, wenn die Auflösung scheitert. `server/benachrichtigungen.js`: `pruefeSmtpZiel(host)` (aufgelöste Adressen gegen 169.254/16 prüfen) beim Speichern und in `sendeMail`.

### A2-14 — Abhängigkeiten

`npm audit fix`, `npm install nodemailer@^10.1.7` (MIT-0, Node ≥ 20), Selbsttests und Golden Master laufen lassen. `quill 2.0.3` bleibt (der Fehler steckt in `getSemanticHTML`, das nicht benutzt wird). Im Journal zusätzlich `sharp` prüfen.

### A2-17 / A2-18 / A2-19 / A2-20 / A2-21 — Oberfläche

- `src/utils/escHtml.js` aus V2; `KachelMarkt.vue` `tooltipText`: `escHtml(m.symbol)`, `escHtml(m.name)`; `diagramme/gruppen.js` und `diagramme/auswertung.js`: Kategorie-/Tag-Namen durch `escHtml`.
- `src/utils/sanitize.js`: `sanitizeKiHtml` (ohne `id`/`name`, `img` nur mit relativem `src`) in `KiChat.vue` und `KiAgent.vue` statt `sanitizeHtml`.
- `sichereUrl()` vor `liveOffen.dexUrl` (`HypeRadar.vue`), `v.url` (`TiefensucheErgebnis.vue`), `fokusInfo.markt.url` (`FruehphaseAnsicht.vue`).
- CSP in `index.mjs` (nur ausserhalb `NODE_ENV=dev`) wie V2 und in `vite.config.js` `__INTLIFY_JIT_COMPILATION__: true` — **ohne** das bricht vue-i18n (es übersetzt sonst per `new Function`). Vorher prüfen, ob das Journal-Frontend weitere Fremd-Skripte lädt (V2 hat kein CDN mehr, das Journal lud zuletzt noch Bootstrap/Font Awesome per CDN mit SRI → dann `script-src`/`style-src`/`font-src` um diese Hosts ergänzen).

### A2-26 — Update

`server/update-api.js`: `npm ci` mit Rückfall auf `npm install` (V2-Block). Signaturprüfung offen wie in V2.

### A2-27 / A2-31 / A2-34

- `server/hype-radar/zustellung.js`: `throw ohneAdresse(letzter, url)` am Ende von `post()` (Funktion aus V2).
- `server/app-hilfe.js`: „Update-PIN" streichen.
- `maske()` in `server/crypto.js` (nur die letzten 4 Zeichen) und in `flux-api.js`, `ollama-api.js`, `hype-radar/einstellungen.js` benutzen.

## Reihenfolge für das Journal

1. A2-10 (root/Socket) und A2-03 (XFF) — beide betreffen die NAS direkt.
2. A2-05 + A2-07 + A2-06/09 (Schlüssel und Backup).
3. A2-04/12, A2-11, A2-14.
4. Rest.

Vor jedem Ausrollen: Selbsttests (`node scripts/run-selftests.mjs`, soweit im Journal vorhanden) und ein Prüf-Container mit Wegwerf-DB; erst dann auf die NAS.
