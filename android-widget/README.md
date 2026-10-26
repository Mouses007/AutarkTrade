# AutarkTrade-Widget (Android)

A native Android home-screen widget for **AutarkTrade**. It shows your
open Bitunix/Bitget futures positions **and** running Pionex bots with live PnL, plus a
KPI strip (balance, today's PnL, total PnL, win rate). Since 4.0.0-21 it also posts the
**chart alarms** (price, line, zone, momentum) as Android notifications.

It reads AutarkTrade's read-only `GET /api/esp32/display` endpoint using the static
`X-ESP32-Key` header — the same data source as the ESP32 displays and the Cinnamon
desklet. No login/session is involved, so it keeps working even if you enable the
app's optional password gate.

## Prerequisites

1. **Android Studio** (latest stable) — bundles the JDK, Android SDK and Gradle. Nothing
   else needs to be installed on the build machine.
2. An **ESP32 API key**: in AutarkTrade open **Einstellungen → Externe Anzeigen →
   „Key generieren"** and copy the key (shown once).
3. AutarkTrade must be reachable from the phone. Your phone's VPN is always on when off
   Wi-Fi, so the server's LAN IP is reachable everywhere — the app talks HTTPS to port
   `8443` and uses port `8080` only to fetch the server certificate when pairing.

## Build & install

**Since 4.2.0-28 the APK is a release build signed with our own key** (before: debug
signature). Android refuses an update whose signature differs, so **once** uninstall the
old widget (long-press the app → *Uninstall*), install the new APK and set it up again.
The package name `com.autarktrade.widget` stays the same.

1. Headless build: `./_build-apk.sh` (JDK 17, SDK and Gradle 8.9 under `~/android-build` /
   `~/Android/Sdk`, downloaded on first run). It builds `assembleRelease`, copies
   `autarktrade-widget-<version>.apk` next to the project and prints the signing
   certificate (`apksigner verify --print-certs`).
2. **Signing key** — never in the repo: `~/.config/autarktrade/android-release.jks`
   (PKCS12, alias `autarktrade`, RSA 4096, valid 30 years) and its passwords in
   `~/.config/autarktrade/android-release.properties` (`storeFile`, `storePassword`,
   `keyAlias`, `keyPassword`; folder 0700, files 0600). Another location:
   `AT_ANDROID_SIGNIERUNG=/path/to/file.properties ./_build-apk.sh`. Without the file the
   release build stops with a clear message — it never falls back to the debug key.
   **Back up both files** (offline, e.g. password manager + USB stick): without them no
   further update can be installed over the existing app, only uninstall + reinstall.
   Certificate SHA-256 of the current key:
   `CB:6A:31:63:06:BC:96:03:09:54:AA:39:86:AC:BD:48:BC:12:CB:EA:D0:1C:81:00:1E:D3:7D:73:C1:18:DF:65`.
3. Copy the APK to the phone and open it (allow „install from unknown sources").
4. Android Studio still works for development (`File → Open`, ▶ / `assembleDebug`, debug
   key); a debug build cannot update a release install either.

## Add & configure the widget

1. Long-press the home screen → **Widgets** → **AutarkTrade** → drag it out.
2. The config screen opens: enter **Host** (e.g. `192.168.178.100`), **Port** (`8080`),
   the **ESP32 key**, and a **time range**. Tap **Verbindung testen** to verify, then
   **Speichern**.
3. **HTTPS pairing** („Verschlüsselt (HTTPS, Port 8443)", on by default for new setups):
   on the first test/save the app fetches the server's own AutarkTrade CA over
   `http://host:8080/api/esp32/ca` (no key needed), computes its SHA-256 fingerprint itself
   and shows the first and last groups. Compare them with **Einstellungen › Allgemein › HTTPS** in
   the web app; only when you confirm is the CA stored (encrypted with the KeyStore key,
   like the device key). From then on **every** call (`/api/esp32/display`, `/alarme`,
   `/push`) goes to `https://host:8443` and trusts **only** that CA — not the system CAs,
   not user-installed ones; host name / IP must be in the server certificate. There is
   no fallback to http while HTTPS is on: an error says „Zertifikat passt nicht — neu
   koppeln" (server CA changed → tap **Neu koppeln**), „Zertifikat gilt nicht für diese
   Adresse" (host not in the certificate) or „HTTPS-Port nicht erreichbar". A different
   host asks for pairing again. Switching HTTPS off is possible (plain http as before,
   with a warning) — cleartext therefore stays allowed in `network_security_config.xml`.
4. Tap a coin to open its chart in AutarkTrade; tap an exchange header to show that exchange's
   KPIs at the top. Links go to the **installed web app** if you enter its address under
   „Adresse der installierten Web-App" (e.g. `https://192.168.178.100:8443`); left empty they
   go to `https://host:8443` with HTTPS on (`http://host:port` with it off). Install
   AutarkTrade in Chrome over HTTPS with „Installieren" (a WebAPK — over http it is only a
   shortcut, which cannot receive links). The status line below the field says whether such
   an app was found; without one, links open in the browser. Alarm notifications use the
   same address.
5. The widget refreshes automatically (~every 15 min, Android's minimum for background
   widget updates) and on demand via the **↻ button**. Tap the **title** to reopen config.

## Chart alarms as notifications

Open the app from the launcher (or tap the widget title), switch on **Chart-Alarme**, pick
the polling interval (1–15 min, default 2) and which alarm kinds you want, then **Speichern**.
Android asks once for permission to post notifications. „Testmeldung senden" shows what an
alarm looks like; tapping a notification opens `https://<host>:8443/chart?symbol=…` (or the web-app address) in the
browser. Sound, vibration and importance can be changed per channel in Android's app
settings (two channels: *Chart-Alarme* and *Momentum-Alarme*).

**Instant delivery (UnifiedPush via ntfy).** Install the **ntfy** app (F-Droid or Play Store),
then tick „Sofort über ntfy" in the alarm card and save. The widget registers with ntfy as a
UnifiedPush distributor, gets a push address (e.g. `https://ntfy.sh/up…?up=1`) plus a Web-Push
key, and enters both at `POST /api/esp32/push`. From then on every chart alarm is sent at once,
encrypted (RFC 8291, `server/webpush.js`): ntfy.sh cannot read it, and the widget drops every
message that does not decrypt with its key — knowing the ntfy address is not enough to fake an
alarm. Measured in the emulator: 0.8 s from server to notification. ntfy holds one connection
for all its topics; turn off battery optimisation for ntfy as it asks. If no phone is connected
at that moment, ntfy.sh answers 507 and drops the message — the polling below then delivers it.
Duplicates between both paths are filtered by id.
The server keeps at most five devices; the same address or device name replaces its own entry,
a new device on a full list is refused (409) — remove one in AutarkTrade under
Einstellungen › Journal › ESP32 › Push-Geräte. Push addresses on loopback, `169.254/16`,
`0.0.0.0/8`, link-local IPv6 or multicast are refused; the private LAN (own ntfy) stays allowed.
After 20 wrong keys per minute from one address the `/api/esp32/*` routes answer 429.

**Why polling, and what it costs in delay.** A self-hosted server without Firebase cannot
wake a phone; only a connection the phone itself keeps open can (that is what the ntfy app
does — AutarkTrade already supports ntfy as a push channel). The app therefore asks
`GET /api/esp32/alarme?seit=<ms>` (same `X-ESP32-Key`) on an `AlarmManager` wake-up:

- screen on / phone in use: an alarm arrives at most one interval late with **exact alarms**
  allowed; without them Android may shift each wake-up by up to ¾ of the interval (measured:
  a 2-min wake-up got a window of +1:30, i.e. up to ~3.5 min);
- phone lying still with the screen off (**Doze**): Android lets such wake-ups through only
  about every 9–15 minutes, so an alarm can wait that long. Allowing **exact alarms** and
  turning off **battery optimisation** for the app (buttons in the settings) helps, it does
  not make it instant. Sony's STAMINA mode and similar can stop it altogether.
- if you need alarms within seconds, use the **ntfy** channel in addition.

The first poll after switching on only records the current state — it never replays old
alarms. Duplicates are filtered by id (`alarmId-t`); the app polls with a 3-minute overlap
because the server writes an alarm's history entry only after delivering it to ntfy/Telegram.
An alarm whose push channel is switched off in AutarkTrade does not appear on the phone either.
The widget's 15-minute refresh re-arms the polling chain if the system dropped it.

## How it works (for maintenance)

- `ApiClient` — one OkHttp GET with the `X-ESP32-Key` header; returns raw JSON. `ziel()` picks
  `https://host:8443` with a client that trusts only the paired CA, or plain http.
- `Kopplung` — pure part of the pairing (PEM → DER, SHA-256 fingerprint, check of the
  `/api/esp32/ca` answer, `SSLContext` from a KeyStore holding only that CA); only `java.*`.
- `RefreshWorker` (WorkManager `CoroutineWorker`) — fetches off the main thread, caches the
  JSON per widget in `Prefs`, then re-binds widgets and reloads the list.
- `TradingWidgetProvider` (`AppWidgetProvider`) — builds the header/KPIs, wires the list
  adapter and PendingIntents (refresh broadcast, title→config), schedules periodic +
  one-shot refresh.
- `PositionsRemoteViewsService` / factory — turns the cached JSON into the scrollable list
  (Futures section + Bots section). Bot PnL/margin is shown in its `marginCoin`
  (e.g. SOL for Coin-M), never force-converted to USDT.
- `WidgetConfigActivity` — host/port/key/filter, „test connection", saved per widget; also the
  chart-alarm card (global settings). Opens from the launcher without a widget, too.
- `WidgetKlickActivity` — invisible trampoline for list taps: a coin row opens
  `/chart?symbol=…&boerse=…` in the browser, a section header switches the KPI strip to that
  exchange. A collection has only one click template, and a broadcast may not start the browser.
- `PushDienst` — UnifiedPush `PushService`: stores the address from ntfy, enters it at the
  server, hands decrypted messages to `ChartAlarme.empfangen` (connector 3.0.10 — the last one
  built with Kotlin 2.0; it brings Tink for the Web-Push decryption).
- `ChartAlarme` / `AlarmReceiver` — polling of `/api/esp32/alarme`, notification channels,
  the wake-up chain (re-armed after reboot and app update).
- Colours are the AutarkTrade tokens (`values/colors.xml`); the logo `drawable/ic_logo.xml`
  and the status-bar icon `ic_stat_alarm.xml` are generated by `scripts/logo-android.mjs`
  from `src/assets/design/logo-zeichen.svg` — regenerate, don't edit by hand.

### Android touchpoints worth knowing (new to Android)
- **RemoteViews** only supports a limited set of views — that's why layouts use plain
  `LinearLayout`/`TextView` and a `ListView` collection (not RecyclerView).
- A scrollable widget list = `RemoteViewsService` + `RemoteViewsFactory` (the „collection
  widget" pattern). Each widget instance gets its own factory via a unique intent `data` Uri.
- **PendingIntent** must use `FLAG_IMMUTABLE`.
- Background refresh uses **WorkManager** (min period 15 min); there is no 30-second polling
  like the desklet — that's an OS limitation for home-screen widgets.

## Versioning

`versionName` tracks the AutarkTrade version plus the build number (currently **4.2.0-28**);
the APK file carries it in its name.

Since 4.2.0-28: HTTPS with the paired AutarkTrade CA as the only trust anchor (default for
new setups, no http fallback while on; see „HTTPS pairing" above), web links default to
`https://host:8443`, and the APK is a release build signed with the own key — uninstall the
older debug-signed app once before installing.

Since 4.1.0-27 (audit D): the device key and the push secret are stored AES-GCM encrypted
with a key from the Android KeyStore (older plaintext values are migrated on first read),
`allowBackup` is off and nothing goes into cloud backup or device transfer; the widget's
own actions (refresh, eye, 15-min alarm) go to a non-exported receiver; alarm notifications
show only „AutarkTrade: Chart-Alarm" on the lock screen (speech output is unchanged);
the settings screen blocks screenshots; a WebAPK only receives links when its address,
install source (Google Play or its browser) and pinned signing certificate check out;
and a stand older than three refresh intervals is shown in red with its age.

## Licence

The widget is part of AutarkTrade and covered by its licence (`LICENSE` in the main
program). The third-party libraries it bundles (AndroidX, Kotlin, OkHttp/Okio — Apache-2.0;
the Public Suffix List inside OkHttp — MPL-2.0) are listed with their texts in
`app/src/main/assets/THIRD-PARTY-NOTICES.txt`, which ships inside the APK.

Since 4.0.0 the application id is `com.autarktrade.widget` (before: `com.tradingjournal.widget`).
Android treats it as a new app: uninstall the old widget, install the new APK and set it up again.
