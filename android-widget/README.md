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
   Wi-Fi, so `http://<server-ip>:8080` is reachable everywhere — use that host/port.

## Build & install

1. Open the `android-widget/` folder in Android Studio (`File → Open`). On first open it
   will sync Gradle and, if asked, set up the Gradle wrapper (Gradle 8.9) automatically.
2. Connect your phone with USB debugging enabled, or build an APK:
   - **APK:** `Build → Build Bundle(s)/APK(s) → Build APK(s)`, then copy
     `app/build/outputs/apk/debug/autarktrade-widget-<version>-debug.apk` to the phone and open it
     (allow „install from unknown sources").
   - **Direct run:** select your device and press ▶.
3. From a terminal you can also run (after Android Studio created the wrapper):
   `./gradlew assembleDebug`.

## Add & configure the widget

1. Long-press the home screen → **Widgets** → **AutarkTrade** → drag it out.
2. The config screen opens: enter **Host** (e.g. `192.168.178.100`), **Port** (`8080`),
   the **ESP32 key**, and a **time range**. Tap **Verbindung testen** to verify, then
   **Speichern**.
3. Tap a coin to open its chart in AutarkTrade; tap an exchange header to show that exchange's
   KPIs at the top.
4. The widget refreshes automatically (~every 15 min, Android's minimum for background
   widget updates) and on demand via the **↻ button**. Tap the **title** to reopen config.

## Chart alarms as notifications

Open the app from the launcher (or tap the widget title), switch on **Chart-Alarme**, pick
the polling interval (1–15 min, default 2) and which alarm kinds you want, then **Speichern**.
Android asks once for permission to post notifications. „Testmeldung senden" shows what an
alarm looks like; tapping a notification opens `http://<host>:<port>/chart?symbol=…` in the
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

- `ApiClient` — one OkHttp GET with the `X-ESP32-Key` header; returns raw JSON.
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

`versionName` tracks the AutarkTrade version plus the build number (currently **4.1.0-24**);
the APK file carries it in its name.

## Licence

The widget is part of AutarkTrade and covered by its licence (`LICENSE` in the main
program). The third-party libraries it bundles (AndroidX, Kotlin, OkHttp/Okio — Apache-2.0;
the Public Suffix List inside OkHttp — MPL-2.0) are listed with their texts in
`app/src/main/assets/THIRD-PARTY-NOTICES.txt`, which ships inside the APK.

Since 4.0.0 the application id is `com.autarktrade.widget` (before: `com.tradingjournal.widget`).
Android treats it as a new app: uninstall the old widget, install the new APK and set it up again.
