// AutarkTrade Anzeige — Waveshare ESP32-S3-ePaper-3.97 (800×480, Schwarzweiss)
//
// Gleiche Logik wie ESP32-Waveshare/ (Setup-AP mit WPA2, Portal nur im
// Setup-Modus, Abruf GET /api/esp32/display mit X-ESP32-Key), aber eine
// einzige Seite statt drei Reiter: ePaper hat kein Touch, dafür Platz.
// Gezeichnet wird in einen 1-Bit-Puffer (Adafruit GFX), der danach als
// Ganzes ans Display geht. Neu gezeichnet wird nur, wenn sich der Inhalt
// geändert hat — Teilauffrischung, alle VOLL_ALLE Wechsel eine volle gegen
// Geisterbilder.
//
// Seit 1.1.0 wie das Linux-Desklet: PnL wahlweise in Prozent der Marge,
// Grid-Gewinn der Bots, Bot-Werte wahlweise in USDT und ein Kurs-Chart
// (GET /api/esp32/kurs). Der Kursabruf läuft im selben Takt wie /display,
// VOR dem Zeichnen — so gibt es je Takt höchstens eine Auffrischung. Seine
// Fehler zählen nie als WLAN- oder Serverausfall (ältere Server kennen /kurs
// nicht). Chart-Alarme zeigen die Displays bewusst nicht (seit 1.2.0): der
// Anzeige-Schlüssel öffnet /alarme nicht, und dafür gibt es Desklet und Handy.
//
// Seit 1.5.0 im Akkubetrieb (keine USB-Spannung) Tiefschlaf zwischen den
// Abrufen: aufwachen, WLAN, abrufen, zeichnen, schlafen. Das ePaper hält das
// Bild ohne Strom. Am USB bleibt alles wie zuvor (wach, CFG über das Kabel).
// Was über den Schlaf hinaus gelten muss, liegt im RTC-Speicher (RTC_DATA_ATTR).
// 1.5.1: kein Serial.flush() mehr — ohne PC am Kabel hing es endlos (siehe seriellAusgeben).
// 1.5.2: Fusszeile zeigt die Uhrzeit des Abrufs (aus dem HTTP-Kopf „Date“) statt „vor X s“.
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <Wire.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <vector>
#include <array>
#include <algorithm>
#include "EPD_3in97.h"
#include <esp_sleep.h>
#include <driver/gpio.h>
#include <driver/rtc_io.h>
#include <sys/time.h>
#include <time.h>

#define AP_SSID            "AutarkTrade-Setup"
#define ACTIVE_INTERVAL    60        // Sekunden zwischen Abrufen (ePaper: kein Grund für öfter)
#define VOLL_ALLE          30        // nach so vielen Teilauffrischungen eine volle
#define PREF_NAMESPACE     "tjcfg"
#define AP_NAMESPACE        "tjap"    // eigener Namensraum: das AP-Passwort überlebt /reset
#define WIFI_MAX_FEHLVERSUCHE 3       // so viele Boots ohne WLAN, dann Setup-AP statt Neustartschleife
#define SETUP_TIMEOUT_MS    600000    // Setup mit vorhandener Konfiguration: nach 10 Min neu versuchen
#define SETUP_FENSTER_MS    3000      // Fenster nach dem Boot, in dem die Setup-Geste beginnen kann
#define SETUP_HALTEN_MS     3000      // so lange BOOT-Taste halten
#define KURZ_DRUCK_MS       800       // kürzer gedrückt = sofort auffrischen
#define BOOT_TASTE_PIN      0         // BOOT-Taste (GPIO0), nach dem Start frei lesbar
// Wippschalter an der Seite (am Board ermittelt 02.11.2026, aktiv LOW, extern hochgezogen)
#define WIPPE_HOCH_PIN      6
#define WIPPE_RUNTER_PIN    4
#define WIPPE_DRUCK_PIN     5
const uint8_t WECK_PINS[] = {BOOT_TASTE_PIN, WIPPE_DRUCK_PIN, WIPPE_HOCH_PIN, WIPPE_RUNTER_PIN};   // wecken aus dem Tiefschlaf
#define VERALTET_AB_MS      (3UL * ACTIVE_INTERVAL * 1000UL)   // drei Abrufintervalle ohne Erfolg
#define WIFI_TIMEOUT_MS    12000
#define FW_VERSION         "1.5.2-EP"
#define ZUSATZ_TIMEOUT_MS  6000      // /kurs: kürzer als /display, er ist Beiwerk
#define ZUSATZ_PAUSE_MS    (30UL * 60UL * 1000UL)   // nach 401/404/400: so lange nicht mehr fragen
#define KURS_ALT_MS        (10UL * 60UL * 1000UL)   // Chart bei Zeitüberschreitung so lange weiter zeigen
#define KURS_30D_MS        115000    // 30 Tage: alle 2 Takte reicht
#define WACH_NACH_TASTE_MS 20000     // Akkubetrieb: nach einem Tastendruck so lange wach (weitere Drücke)
#define WLAN_SCHNELL_MS    5000      // Aufwachen: so lange mit gemerktem Kanal/BSSID versuchen
// Zum Testen am Rechner: mit -DSCHLAF_AM_USB schläft das Board auch am Kabel.

// Im Puffer: 1 = weiss, 0 = schwarz — so erwartet ihn der Controller.
#define WEISS   1
#define SCHWARZ 0
// Panel (Puffer, Controller) ist immer 800×480. Gezeichnet wird gedreht:
// BREITE/HOEHE sind die Masse in der gewählten Lage (cfgDrehung).
#define PANEL_B EPD_3IN97_WIDTH
#define PANEL_H EPD_3IN97_HEIGHT
#define BREITE  ((int)bild.width())
#define HOEHE   ((int)bild.height())

// ── Globals ──────────────────────────────────────────────

GFXcanvas1 bild(PANEL_B, PANEL_H);
WebServer server(80);
Preferences prefs;

String cfgSSID, cfgPass, cfgHost, cfgPort, cfgKey;
bool   cfgKonto  = false;      // Kontostand-Kachel zeigen (Setup-Portal, Standard aus)
uint8_t cfgDrehung = 0;        // 0 quer, 1 hoch, 2 quer gedreht, 3 hoch gedreht (GFX-Rotation)
bool   cfgPnlProz = false;     // PnL in Prozent der Marge (wie der ROE der Börse), Standard aus
bool   cfgBotUsdt = false;     // Bot-Beträge in USDT umrechnen (Coin-M), Standard aus
bool   cfgChart   = true;      // Kurs-Chart zeigen, Standard an
String cfgChartSym = "BTC";    // Symbol des Charts (BTC, SOLUSDT …)
String cfgSpanne   = "24h";    // 1h | 24h | 7d | 30d
String cfgChartArt = "linie";  // linie | kerzen
String cfgFilter = "month";       // "month", "week", "year", "all"
bool   configMode  = false;
unsigned long lastUpdate   = 0;
RTC_DATA_ATTR unsigned long lastOkMs = 0;   // millis() des letzten erfolgreichen Abrufs (0 = noch keiner)
RTC_DATA_ATTR time_t        standZeit = 0;  // Uhrzeit dieses Abrufs (0 = Server lieferte keine)
// Tiefschlaf (Akkubetrieb). Zeitstempel im RTC-Speicher verschiebt schlafe()
// um die verschlafene Zeit, damit millis() - ts nach dem Aufwachen stimmt.
RTC_DATA_ATTR bool    veraltetGezeigt = false;   // „Server nicht erreicht" steht schon da
RTC_DATA_ATTR bool    wlanMerk  = false;         // Kanal und BSSID des letzten Verbindens
RTC_DATA_ATTR int32_t wlanKanal = 0;
RTC_DATA_ATTR uint8_t wlanBssid[6];
volatile unsigned long letzteTasteMs = 0;         // millis() des letzten Tastendrucks (0 = keiner)

// Setup-Portal (SEC-ESP-001/002): läuft NUR im Setup-Modus, nie im Heimnetz.
String formToken;                     // pro Boot zufällig, Pflicht für POST /save und /reset
String apPass;                        // WPA2-Passwort des Setup-AP, je Gerät zufällig, auf dem Display
bool   setupMitKonfig = false;        // Setup bei vorhandener Konfiguration → Zeitlimit, dann Neustart
unsigned long portalAktivMs = 0;      // letzte Anfrage ans Portal

// ── Datenstrukturen ──────────────────────────────────────

struct Position {
  String symbol;
  String side;
  float  leverage;
  float  entryPrice;
  float  markPrice;
  float  qty;
  float  unrealizedPNL;
  float  realizedPNL;
  float  margin;         // vom Server, falls vorhanden (sonst 0 → aus Einstieg/Menge/Hebel)
};

// Laufender Pionex-Bot. PnL/Marge in marginCoin (z.B. SOL bei Coin-M), nicht zwingend USDT.
struct Bot {
  String symbol;
  String side;
  String marginCoin;
  float  leverage;
  float  entryPrice;
  float  markPrice;
  float  unrealizedPNL;
  float  liqPrice;
  float  margin;         // in marginCoin; 0 = unbekannt (älterer Server)
  float  gridProfit;     // in marginCoin; NAN = unbekannt / kein Grid
  bool   coinM;
};

// Kursverlauf für den Chart (GET /api/esp32/kurs). Kerzen [o,h,l,c], älteste zuerst.
enum KursZustand : uint8_t { KURS_NICHTS, KURS_OK, KURS_ALT_SERVER, KURS_SYMBOL,
                             KURS_SCHLUESSEL, KURS_AUS, KURS_NETZ };
struct KursDaten {
  String symbol;
  String spanne;
  float  jetzt = 0;
  float  start = 0;
  float  aenderung = 0;
  std::vector<std::array<float, 4>> kerzen;
};
KursDaten     kurs;
RTC_DATA_ATTR KursZustand   kursZustand = KURS_NICHTS;
unsigned long kursOkMs    = 0;      // millis() des letzten guten Abrufs (0 = keiner)
RTC_DATA_ATTR unsigned long kursPauseAb = 0;   // nach 400/401/404 eine Weile nicht fragen
RTC_DATA_ATTR bool          kursPause   = false;

struct TradeData {
  float todayPnL    = 0;
  int   todayTrades = 0;
  int   todayWins   = 0;
  int   todayLosses = 0;
  float totalPnL    = 0;
  float winRate     = 0;
  float satisfaction= 0;
  float rrr         = 0;
  float balance     = 0;
  float balancePerf = 0;
  bool  hasBalance  = false;
  long  volume30d   = 0;
  long  volumeTotal = 0;
  bool  valid       = false;
  std::vector<Position> positions;
  std::vector<Bot> bots;
};
TradeData data;

// ── Config ───────────────────────────────────────────────

void loadConfig() {
  prefs.begin(PREF_NAMESPACE, true);
  cfgSSID   = prefs.getString("ssid",   "");
  cfgPass   = prefs.getString("pass",   "");
  cfgHost   = prefs.getString("host",   "192.168.178.100");
  cfgPort   = prefs.getString("port",   "8080");
  cfgKey    = prefs.getString("key",    "");
  cfgKonto  = prefs.getBool("konto",    false);
  cfgDrehung = prefs.getUChar("dreh",   0) & 3;
  cfgPnlProz  = prefs.getBool("pnlpct",  false);
  cfgBotUsdt  = prefs.getBool("botusdt", false);
  cfgChart    = prefs.getBool("chart",   true);
  cfgChartSym = prefs.getString("csym",  "BTC");
  cfgSpanne   = prefs.getString("cspan", "24h");
  cfgChartArt = prefs.getString("cart",  "linie");
  // Filter kommt vom Server — nicht aus NVS laden
  cfgFilter = "month";
  prefs.end();
}

void saveFilter() {
  // Filter wird vom Server gesteuert, kein lokales Speichern nötig
}

// Anzeige-Schalter kommen aus den cfg*-Globalen (handleSave setzt sie vorher).
void saveConfig(String ssid, String pass, String host, String port, String key, bool konto) {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("host", host);
  prefs.putString("port", port);
  prefs.putString("key",  key);
  prefs.putBool("konto",  konto);
  prefs.putUChar("dreh",   cfgDrehung);
  prefs.putBool("pnlpct",  cfgPnlProz);
  prefs.putBool("botusdt", cfgBotUsdt);
  prefs.putBool("chart",   cfgChart);
  prefs.putString("csym",  cfgChartSym);
  prefs.putString("cspan", cfgSpanne);
  prefs.putString("cart",  cfgChartArt);
  prefs.putUChar("wfail", 0);
  prefs.end();
}

// Chart-Symbol: nur Grossbuchstaben und Ziffern (geht in die URL), leer → BTC.
String symbolSauber(const String& roh) {
  String s;
  for (size_t i = 0; i < roh.length() && s.length() < 20; i++) {
    char c = toupper((unsigned char)roh[i]);
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) s += c;
  }
  return s.length() >= 2 ? s : String("BTC");
}

bool spanneGueltig(const String& s) {
  return s == "1h" || s == "24h" || s == "7d" || s == "30d";
}

// Zufallstext aus esp_random() — erst nach WiFi.mode() aufrufen, dann
// speist das Funkteil den Zufallsgenerator (sonst nur Pseudozufall).
String zufallsText(int len, const char* zeichen) {
  String s;
  int n = strlen(zeichen);
  for (int i = 0; i < len; i++) s += zeichen[esp_random() % n];
  return s;
}

// WPA2-Passwort des Setup-AP: einmal je Gerät erzeugt, im eigenen
// NVS-Namensraum (clearConfig() löscht es nicht, das Display zeigt es).
void ladeApPasswort() {
  prefs.begin(AP_NAMESPACE, false);
  apPass = prefs.getString("pass", "");
  if (apPass.length() < 8) {
    apPass = zufallsText(10, "abcdefghjkmnpqrstuvwxyz23456789");
    prefs.putString("pass", apPass);
  }
  prefs.end();
}

// Fehlversuche beim WLAN-Verbinden über Neustarts hinweg zählen.
uint8_t leseFehlversuche() {
  prefs.begin(PREF_NAMESPACE, true);
  uint8_t n = prefs.getUChar("wfail", 0);
  prefs.end();
  return n;
}

void schreibeFehlversuche(uint8_t n) {
  prefs.begin(PREF_NAMESPACE, false);
  if (prefs.getUChar("wfail", 0) != n) prefs.putUChar("wfail", n);   // Flash schonen
  prefs.end();
}

// ── Datenalter (FUN-GER-001) ─────────────────────────────
// millis() läuft auch im Light Sleep weiter; ohne NTP ist es die einzige
// verlässliche Uhr des Geräts.
bool datenVeraltet() {
  return lastOkMs == 0 || millis() - lastOkMs > VERALTET_AB_MS;
}

String alterText();

// „Stand 18:04" (an einem anderen Tag mit Datum). Ein Alter wie „vor 13 s"
// sagt auf dem ePaper nichts: es bleibt stehen, bis das nächste Bild kommt.
String standText() {
  if (!standZeit) return "Stand vor " + alterText();
  tm st, jetzt; time_t n = time(nullptr);
  localtime_r(&standZeit, &st); localtime_r(&n, &jetzt);
  char b[24];
  strftime(b, sizeof b, st.tm_yday == jetzt.tm_yday && st.tm_year == jetzt.tm_year
                        ? "Stand %H:%M" : "Stand %d.%m. %H:%M", &st);
  return b;
}

String alterText() {
  if (lastOkMs == 0) return "nie";
  unsigned long s = (millis() - lastOkMs) / 1000;
  if (s < 90)     return String(s) + " s";
  if (s < 5400)   return String(s / 60) + " min";
  if (s < 172800) return String(s / 3600) + " h";
  return String(s / 86400) + " Tg";
}

void clearConfig() {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.clear();
  prefs.end();
}


String htmlEscape(const String& v) {
  String s = v;
  s.replace("&", "&amp;"); s.replace("\"", "&quot;");
  s.replace("'", "&#39;"); s.replace("<", "&lt;");
  s.replace(">", "&gt;");
  return s;
}

bool isValidPort(const String& p) {
  if (p.isEmpty()) return false;
  for (size_t i = 0; i < p.length(); i++)
    if (!isDigit((unsigned char)p[i])) return false;
  long v = p.toInt();
  return v >= 1 && v <= 65535;
}

// ── Setup-Portal HTML ────────────────────────────────────

const char CONFIG_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutarkTrade Setup</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #05080a; color: #e8f4f6; font-family: -apple-system, sans-serif; padding: 20px; }
  h1 { color: #1fd6c4; margin-bottom: 4px; font-size: 1.3rem; }
  p.sub { color: #8ea5af; font-size: 0.82rem; margin-bottom: 18px; }
  .card { background: #0c1216; border: 1px solid #1d2b33; border-radius: 14px; padding: 16px; margin-bottom: 12px; }
  .card h2 { color: #8ea5af; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  label { display: block; color: #8ea5af; font-size: 0.82rem; margin-bottom: 3px; margin-top: 9px; }
  input, select { width: 100%; background: #05080a; border: 1px solid #1d2b33; border-radius: 6px;
          color: #e8f4f6; padding: 9px 12px; font-size: 0.95rem; outline: none; }
  input:focus, select:focus { border-color: #1fd6c4; }
  label.chk { display: flex; align-items: center; gap: 8px; }
  label.chk input { width: auto; margin: 0; }
  button { width: 100%; background: #1fd6c4; color: #05080a; font-weight: 700; border: none; border-radius: 6px;
           padding: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 14px; }
  button:active { opacity: 0.8; }
  .scan-btn { background: #131c22; margin-top: 0; padding: 8px; font-size: 0.85rem; margin-bottom: 8px; }
  .reset { background: #e0574c; margin-top: 8px; }
  .info { background: #131c22; border: 1px solid #1d2b33; border-radius: 6px;
          padding: 9px 12px; font-size: 0.82rem; color: #8ea5af; margin-top: 5px; }
  .net-list { margin-top: 8px; }
  .net-item { display: flex; justify-content: space-between; align-items: center;
              background: #05080a; border: 1px solid #1d2b33; border-radius: 6px;
              padding: 9px 12px; margin-bottom: 5px; cursor: pointer; font-size: 0.9rem; }
  .net-item:hover, .net-item.selected { border-color: #3fbf8f; background: #0a2a28; }
  .rssi { font-size: 0.75rem; color: #8ea5af; }
  #scan-status { color: #8ea5af; font-size: 0.82rem; margin-top: 5px; min-height: 18px; }
</style>
</head>
<body>
<h1><span style='color:#e8f4f6'>Autark</span>Trade</h1>
<p class="sub">ePaper 3.97 Setup</p>

<form action="/save" method="POST">
  <input type="hidden" name="t" value="%TOKEN%">
  <div class="card">
    <h2>WLAN</h2>
    <button type="button" class="scan-btn" onclick="scanWifi()">Netzwerke suchen...</button>
    <div id="scan-status"></div>
    <div class="net-list" id="net-list"></div>
    <label>SSID</label>
    <input name="ssid" id="ssid" type="text" value="%SSID%" required autocomplete="off">
    <label>Passwort</label>
    <input name="pass" id="pass" type="password" value="" placeholder="%PASSHINT%" autocomplete="off">
  </div>
  <div class="card">
    <h2>AutarkTrade API</h2>
    <div class="info">Settings → ESP32 Display → API-Key kopieren</div>
    <label>Host (IP des NAS)</label>
    <input name="host" type="text" value="%HOST%" placeholder="192.168.178.100" required>
    <label>Port</label>
    <input name="port" type="text" value="%PORT%" placeholder="8080" required>
    <label>ESP32 API-Key</label>
    <input name="key" type="password" value="" placeholder="%KEYHINT%" autocomplete="off" %KEYREQ%>
    <div class="info">Gespeicherte Passw&ouml;rter und Schl&uuml;ssel werden nie angezeigt. Leeres Feld = bleibt unver&auml;ndert.</div>
  </div>
  <div class="card">
    <h2>Anzeige</h2>
    <label style="display:flex;align-items:center;gap:8px"><input name="konto" type="checkbox" value="1" style="width:auto;margin:0" %KONTO%> Kontostand anzeigen</label>
    <div class="info">Aus: erste Kachel zeigt den P&amp;L im Zeitraum.</div>
    <label>Ausrichtung</label>
    <select name="dreh">
      <option value="0" %DREH0%>Querformat</option>
      <option value="1" %DREH1%>Hochformat</option>
      <option value="2" %DREH2%>Querformat, 180&deg; gedreht</option>
      <option value="3" %DREH3%>Hochformat, 180&deg; gedreht</option>
    </select>
    <label class="chk"><input name="pnlpct" type="checkbox" value="1" %PNLPCT%> PnL in Prozent der Marge</label>
    <div class="info">Wie der ROE der B&ouml;rse. Ohne bekannte Marge steht &laquo;-&raquo;.</div>
    <label class="chk"><input name="botusdt" type="checkbox" value="1" %BOTUSDT%> Bot-Werte in USDT</label>
    <div class="info">Coin-M-Bots: PnL und Grid-Gewinn mit dem aktuellen Kurs in USDT umgerechnet.</div>
  </div>
  <div class="card">
    <h2>Kurs-Chart</h2>
    <label class="chk"><input name="chart" type="checkbox" value="1" %CHART%> Chart anzeigen</label>
    <label>Symbol</label>
    <input name="csym" type="text" value="%CSYM%" placeholder="BTC" maxlength="20" autocomplete="off">
    <label>Zeitraum</label>
    <select name="cspan">
      <option value="1h" %SP1H%>1 Stunde</option>
      <option value="24h" %SP24H%>24 Stunden</option>
      <option value="7d" %SP7D%>7 Tage</option>
      <option value="30d" %SP30D%>30 Tage</option>
    </select>
    <label>Darstellung</label>
    <select name="cart">
      <option value="linie" %ARTLINIE%>Linie</option>
      <option value="kerzen" %ARTKERZEN%>Kerzen</option>
    </select>
    <div class="info">Kurs aus der Marktdatenquelle der App.</div>
  </div>
  <button type="submit">Speichern und Verbinden</button>
</form>
<form action="/reset" method="POST" style="margin-top:8px">
  <input type="hidden" name="t" value="%TOKEN%">
  <button class="reset" type="submit">Konfiguration loeschen</button>
</form>

<script>
function rssiBar(r){return r>-60?'████':r>-70?'███░':r>-80?'██░░':'█░░░';}
function selectNet(el, ssid, enc) {
  document.getElementById('ssid').value = ssid;
  document.querySelectorAll('.net-item').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  if(enc) document.getElementById('pass').focus();
}
function scanWifi() {
  document.getElementById('scan-status').textContent='Scanne...';
  document.getElementById('net-list').innerHTML='';
  fetch('/scan').then(r=>{if(!r.ok)throw r;return r.json();}).then(nets=>{
    document.getElementById('scan-status').textContent=nets.length+' Netzwerke gefunden';
    nets.sort((a,b)=>b.rssi-a.rssi);
    const list=document.getElementById('net-list');
    nets.forEach(n=>{
      const d=document.createElement('div');
      d.className='net-item';
      const lbl=document.createElement('span');
      lbl.textContent=(n.ssid||'(versteckt)')+(n.enc?' [+]':'');
      const sig=document.createElement('span');
      sig.className='rssi';
      sig.textContent=rssiBar(n.rssi)+' '+n.rssi+'dBm';
      d.appendChild(lbl);d.appendChild(sig);
      d.onclick=()=>selectNet(d,n.ssid,n.enc);
      list.appendChild(d);
    });
  }).catch(()=>{document.getElementById('scan-status').textContent='Scan fehlgeschlagen';});
}
window.onload=scanWifi;
</script>
</body>
</html>
)rawliteral";

// ── WiFi-Scan Handler ────────────────────────────────────

void handleScan() {
  portalAktivMs = millis();
  int n = WiFi.scanNetworks();
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < n; i++) {
    JsonObject net = arr.add<JsonObject>();
    net["ssid"] = WiFi.SSID(i);
    net["rssi"] = WiFi.RSSI(i);
    net["enc"]  = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN) ? 1 : 0;
  }
  WiFi.scanDelete();
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// ── Web-Server Handlers ──────────────────────────────────

String buildHtml() {
  String html = String(CONFIG_HTML);
  // WLAN-Passwort und Geräteschlüssel gehen NIE zurück ins Formular (SEC-ESP-001).
  html.replace("%SSID%", htmlEscape(cfgSSID));
  html.replace("%HOST%", htmlEscape(cfgHost));
  html.replace("%PORT%", htmlEscape(cfgPort));
  html.replace("%PASSHINT%", cfgPass.isEmpty() ? "" : "gespeichert - leer lassen = unveraendert");
  html.replace("%KEYHINT%",  cfgKey.isEmpty() ? "Hex-String aus Settings" : "gespeichert - leer lassen = unveraendert");
  html.replace("%KEYREQ%",   cfgKey.isEmpty() ? "required" : "");
  html.replace("%KONTO%",    cfgKonto ? "checked" : "");
  for (int i = 0; i < 4; i++) html.replace("%DREH" + String(i) + "%", cfgDrehung == i ? "selected" : "");
  html.replace("%PNLPCT%",   cfgPnlProz ? "checked" : "");
  html.replace("%BOTUSDT%",  cfgBotUsdt ? "checked" : "");
  html.replace("%CHART%",    cfgChart ? "checked" : "");
  html.replace("%CSYM%",     htmlEscape(cfgChartSym));
  html.replace("%SP1H%",     cfgSpanne == "1h"  ? "selected" : "");
  html.replace("%SP24H%",    cfgSpanne == "24h" ? "selected" : "");
  html.replace("%SP7D%",     cfgSpanne == "7d"  ? "selected" : "");
  html.replace("%SP30D%",    cfgSpanne == "30d" ? "selected" : "");
  html.replace("%ARTLINIE%", cfgChartArt != "kerzen" ? "selected" : "");
  html.replace("%ARTKERZEN%", cfgChartArt == "kerzen" ? "selected" : "");
  html.replace("%TOKEN%",    formToken);
  return html;
}

// Formular-Token: pro Boot zufällig, nur im ausgelieferten Formular. Eine
// fremde Webseite kennt ihn nicht und kann /save oder /reset nicht auslösen.
bool tokenOk() {
  portalAktivMs = millis();
  return formToken.length() >= 16 && server.arg("t") == formToken;
}

void handleRoot()  {
  portalAktivMs = millis();
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", buildHtml());
}

void handleSave() {
  if (!tokenOk()) { server.send(403, "text/plain", "Formular abgelaufen - Seite neu laden"); return; }
  String ssid = server.arg("ssid"), pass = server.arg("pass");
  String host = server.arg("host"), port = server.arg("port");
  String key  = server.arg("key");
  ssid.trim(); pass.trim(); host.trim(); port.trim(); key.trim();

  // Leeres Feld = gespeicherter Wert bleibt (das Formular zeigt ihn nie).
  // Das WLAN-Passwort nur bei gleicher SSID — ein anderes Netz ohne Passwort ist offen.
  if (key.isEmpty()) key = cfgKey;
  if (pass.isEmpty() && ssid == cfgSSID) pass = cfgPass;
  if (ssid.isEmpty() || host.isEmpty() || key.isEmpty()) {
    server.send(400, "text/plain", "Fehlende Felder"); return;
  }
  if (!isValidPort(port)) {
    server.send(400, "text/plain", "Ungueltiger Port"); return;
  }
  cfgPnlProz  = server.hasArg("pnlpct");
  cfgDrehung  = server.arg("dreh").toInt() & 3;
  cfgBotUsdt  = server.hasArg("botusdt");
  cfgChart    = server.hasArg("chart");
  cfgChartSym = symbolSauber(server.arg("csym"));
  String sp   = server.arg("cspan");
  cfgSpanne   = spanneGueltig(sp) ? sp : String("24h");
  cfgChartArt = server.arg("cart") == "kerzen" ? "kerzen" : "linie";
  saveConfig(ssid, pass, host, port, key, server.hasArg("konto"));
  loadConfig();
  bool saved = (cfgSSID == ssid && cfgKey == key);
  server.send(200, "text/html; charset=utf-8",
    saved
    ? "<html><head><meta charset='UTF-8'></head><body style='background:#05080a;color:#e8f4f6;font-family:sans-serif;padding:30px'>"
      "<h2 style='color:#3fbf8f'>Gespeichert!</h2><p>ESP32 startet neu...</p></body></html>"
    : "<html><head><meta charset='UTF-8'></head><body style='background:#05080a;color:#e8f4f6;font-family:sans-serif;padding:30px'>"
      "<h2 style='color:#e0574c'>Fehler!</h2><p>Bitte nochmal versuchen.</p></body></html>");
  if (!saved) return;
  delay(3000);
  ESP.restart();
}

void handleReset() {
  if (!tokenOk()) { server.send(403, "text/plain", "Formular abgelaufen - Seite neu laden"); return; }
  clearConfig();
  server.send(200, "text/html; charset=utf-8",
    "<html><head><meta charset='UTF-8'></head><body style='background:#05080a;color:#e8f4f6;font-family:sans-serif;padding:30px'>"
    "<h2 style='color:#e0574c'>Geloescht</h2><p>ESP32 startet neu...</p></body></html>");
  delay(1500);
  ESP.restart();
}

void setupRoutes() {
  server.on("/",      HTTP_GET,  handleRoot);
  server.on("/save",  HTTP_POST, handleSave);
  server.on("/reset", HTTP_POST, handleReset);
  server.on("/scan",  HTTP_GET,  handleScan);
  server.begin();
}

// ── Daten holen ──────────────────────────────────────────

// Uhr aus dem HTTP-Kopf „Date" (RFC 7231, immer GMT: „Tue, 03 Nov 2026 17:04:05 GMT").
// Das Board hat kein NTP; die Systemuhr läuft über den Tiefschlaf weiter und
// wird bei jedem Abruf neu gestellt, die Abweichung bleibt so unter Sekunden.
void uhrAusDatum(const String& datum) {
  int tag, jahr, h, m, sek; char mon[4] = {0};
  if (sscanf(datum.c_str(), "%*3s, %d %3s %d %d:%d:%d", &tag, mon, &jahr, &h, &m, &sek) != 6) return;
  static const char* MONATE = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const char* f = strstr(MONATE, mon);
  if (!f || jahr < 2024) return;
  int mo = (f - MONATE) / 3 + 1;
  // Tage seit 1970 (Kalenderformel nach H. Hinnant, ohne Zeitzone)
  int y = jahr - (mo <= 2);
  int era = y / 400, yoe = y - era * 400;
  int doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + tag - 1;
  long tage = era * 146097L + yoe * 365L + yoe / 4 - yoe / 100 + doy - 719468L;
  timeval tv = {(time_t)(tage * 86400L + h * 3600L + m * 60L + sek), 0};
  settimeofday(&tv, nullptr);
}

// GET auf den AutarkTrade-Server mit Geräteschlüssel. Antwort nur bei 200 in
// `body`; Rückgabe = HTTP-Code (negativ = Verbindungsfehler/Zeitüberschreitung).
int httpHole(const String& pfad, String& body, uint32_t timeoutMs) {
  body = "";
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.begin("http://" + cfgHost + ":" + cfgPort + pfad);
  http.addHeader("X-ESP32-Key", cfgKey);
  http.setConnectTimeout(timeoutMs < 5000 ? timeoutMs : 5000);
  http.setTimeout(timeoutMs);
  const char* koepfe[] = {"Date"};
  http.collectHeaders(koepfe, 1);
  int code = http.GET();
  if (code == 200) { body = http.getString(); uhrAusDatum(http.header("Date")); }
  http.end();
  return code;
}

bool fetchData() {
  if (WiFi.status() != WL_CONNECTED) return false;

  String payload;
  int code = httpHole("/api/esp32/display?filter=" + cfgFilter, payload, 10000);
  if (code != 200) {
    data.valid = false;
    Serial.printf("[API] HTTP %d\n", code);
    return false;
  }
  Serial.printf("[API] OK, %u Bytes\n", (unsigned)payload.length());   // Inhalt nie auf Serial (SEC-ESP-003)

  // Nur die Felder, die das Display braucht — der Rest der Antwort
  // (z. B. Börsen-Rohdaten) belegt so keinen Speicher.
  JsonDocument filter;
  for (const char* k : {"todayPnL", "todayTrades", "todayWins", "todayLosses", "totalPnL",
                        "winRate", "satisfaction", "rrr", "balance", "balancePerf",
                        "volume30d", "volumeTotal", "filter"})
    filter[k] = true;
  JsonObject fp = filter["openPositions"][0].to<JsonObject>();
  for (const char* k : {"symbol", "side", "leverage", "entryPrice", "markPrice", "qty",
                        "unrealizedPNL", "realizedPNL", "margin"})
    fp[k] = true;
  JsonObject fb = filter["bots"][0].to<JsonObject>();
  for (const char* k : {"symbol", "side", "marginCoin", "leverage", "entryPrice", "markPrice",
                        "unrealizedPNL", "liqPrice", "coinM", "margin", "gridProfit"})
    fb[k] = true;

  JsonDocument doc;
  if (deserializeJson(doc, payload, DeserializationOption::Filter(filter)) != DeserializationError::Ok) {
    data.valid = false;
    return false;
  }
  payload = String();

  data.todayPnL    = doc["todayPnL"]    | 0.0f;
  data.todayTrades = doc["todayTrades"] | 0;
  data.todayWins   = doc["todayWins"]   | 0;
  data.todayLosses = doc["todayLosses"] | 0;
  data.totalPnL    = doc["totalPnL"]    | 0.0f;
  data.winRate     = doc["winRate"]     | 0.0f;
  data.satisfaction= doc["satisfaction"]| 0.0f;
  data.rrr         = doc["rrr"]         | 0.0f;
  data.hasBalance  = !doc["balance"].isNull();
  data.balance     = doc["balance"]     | 0.0f;
  data.balancePerf = doc["balancePerf"] | 0.0f;
  data.volume30d   = doc["volume30d"]   | 0L;
  data.volumeTotal = doc["volumeTotal"] | 0L;

  // Sync filter from server (server controls which period to display)
  const char* srvFilter = doc["filter"] | "";
  if (strlen(srvFilter) > 0) {
    String newFilter = String(srvFilter);
    if (newFilter != cfgFilter) {
      cfgFilter = newFilter;
      saveFilter();
      Serial.println("[CFG] Filter synced from server: " + cfgFilter);
    }
  }

  data.positions.clear();
  JsonArray posArr = doc["openPositions"].as<JsonArray>();
  for (JsonObject p : posArr) {
    Position pos;
    pos.symbol        = p["symbol"]        | "";
    pos.side          = p["side"]          | "";
    pos.leverage      = p["leverage"]      | 0.0f;
    pos.entryPrice    = p["entryPrice"]    | 0.0f;
    pos.markPrice     = p["markPrice"]     | 0.0f;
    pos.qty           = p["qty"]           | 0.0f;
    pos.unrealizedPNL = p["unrealizedPNL"] | 0.0f;
    pos.realizedPNL   = p["realizedPNL"]   | 0.0f;
    pos.margin        = p["margin"]        | 0.0f;
    data.positions.push_back(pos);
  }

  // Laufende Pionex-Bots (eigenes Array; ältere Server ohne Feld → leer)
  data.bots.clear();
  JsonArray botArr = doc["bots"].as<JsonArray>();
  for (JsonObject b : botArr) {
    Bot bot;
    bot.symbol        = b["symbol"]        | "";
    bot.side          = b["side"]          | "";
    bot.marginCoin    = b["marginCoin"]    | "USDT";
    bot.leverage      = b["leverage"]      | 0.0f;
    bot.entryPrice    = b["entryPrice"]    | 0.0f;
    bot.markPrice     = b["markPrice"]     | 0.0f;
    bot.unrealizedPNL = b["unrealizedPNL"] | 0.0f;
    bot.liqPrice      = b["liqPrice"]      | 0.0f;
    bot.coinM         = b["coinM"]         | false;
    bot.margin        = b["margin"]        | 0.0f;   // fehlt bei älterem Server → 0 → „-"
    bot.gridProfit    = b["gridProfit"].is<float>() ? b["gridProfit"].as<float>() : NAN;
    data.bots.push_back(bot);
  }

  data.valid = true;
  veraltetGezeigt = false;
  lastOkMs = millis();
  if (lastOkMs == 0) lastOkMs = 1;
  standZeit = time(nullptr) > 1700000000 ? time(nullptr) : 0;
  return true;
}

// ── Kurs-Chart (Beiwerk) ──────────────────────
// Fehler hier berühren weder lastOkMs noch data.valid noch den WLAN-Zähler.
// Nach 400/401/404/429 eine halbe Stunde Pause: jeder 401 zählt beim Server
// zur Fehlversuchsbremse, die sonst auch /display träfe.

bool pausiert(bool pause, unsigned long ab) {
  return pause && millis() - ab < ZUSATZ_PAUSE_MS;
}

// Chartbreite in Pixeln (ohne Achse) — daraus die gewünschte Kerzenzahl.
int chartBoxBreite();
int chartKerzenWunsch() {
  int pw = chartBoxBreite() - 16 - 70;            // Rahmen und geschätzte Achse
  int n = cfgChartArt == "kerzen" ? pw / 5 : pw / 2;   // Kerzen: ≥ 5 px je Kerze
  return constrain(n, 10, 200);
}

void holeKurs() {
  if (!cfgChart || pausiert(kursPause, kursPauseAb)) return;
  kursPause = false;
  if (cfgSpanne == "30d" && kursOkMs && millis() - kursOkMs < KURS_30D_MS) return;

  String body;
  String pfad = "/api/esp32/kurs?symbol=" + cfgChartSym + "&spanne=" + cfgSpanne +
                "&n=" + String(chartKerzenWunsch());
  int code = httpHole(pfad, body, ZUSATZ_TIMEOUT_MS);
  Serial.printf("[KURS] HTTP %d\n", code);

  auto fehler = [&](KursZustand z, bool pause) {
    kursZustand = z;
    kurs.kerzen.clear();
    kurs.kerzen.shrink_to_fit();
    kursOkMs = 0;
    if (pause) { kursPause = true; kursPauseAb = millis(); }
  };
  if (code == 400) { fehler(KURS_SYMBOL, true); return; }
  if (code == 401 || code == 429) { fehler(KURS_SCHLUESSEL, true); return; }
  if (code == 404) { fehler(KURS_ALT_SERVER, true); return; }
  if (code != 200) {
    // Zeitüberschreitung, 5xx: alten Verlauf noch eine Weile zeigen
    if (!(kursOkMs && millis() - kursOkMs < KURS_ALT_MS)) fehler(KURS_NETZ, false);
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    if (!(kursOkMs && millis() - kursOkMs < KURS_ALT_MS)) fehler(KURS_NETZ, false);
    return;
  }
  body = String();
  if (doc["aus"] | false) { fehler(KURS_AUS, false); return; }

  JsonArray arr = doc["kerzen"].as<JsonArray>();
  std::vector<std::array<float, 4>> k;
  k.reserve(arr.size());
  for (JsonArray x : arr) {
    if (x.size() < 4) continue;
    k.push_back({x[0].as<float>(), x[1].as<float>(), x[2].as<float>(), x[3].as<float>()});
  }
  if (k.size() < 2) { fehler(KURS_NETZ, false); return; }
  kurs.kerzen.swap(k);
  kurs.symbol    = doc["symbol"]    | cfgChartSym.c_str();
  kurs.spanne    = doc["spanne"]    | cfgSpanne.c_str();
  kurs.jetzt     = doc["jetzt"]     | kurs.kerzen.back()[3];
  kurs.start     = doc["start"]     | kurs.kerzen.front()[0];
  kurs.aenderung = doc["aenderung"] | 0.0f;
  kursZustand = KURS_OK;
  kursOkMs = millis();
  if (kursOkMs == 0) kursOkMs = 1;
}

// Alle Beiwerk-Abrufe eines Takts — vor dem einen Zeichnen.
void holeZusatz() {
  holeKurs();
}

// ── Setup-Modus ──────────────────────────────────────────

// ── Display ──────────────────────────────────────────────

// Im RTC-Speicher: das Panel behält Bild und RAM über den Tiefschlaf, also
// geht es danach mit Teilauffrischung weiter, und ein gleiches Bild bleibt stehen.
RTC_DATA_ATTR bool     epdBereit    = false;
RTC_DATA_ATTR uint32_t letzterInhalt = 0;     // Prüfsumme des zuletzt gezeigten Bildes
RTC_DATA_ATTR int      teilSeitVoll = 0;

uint32_t pruefsumme(const uint8_t* p, size_t n) {
  uint32_t h = 2166136261u;                 // FNV-1a
  for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
  return h;
}

// Bild ans Display. Gleiches Bild → nichts tun (schont das Panel).
void zeige(bool voll = false) {
  const size_t n = (PANEL_B / 8) * PANEL_H;
  uint32_t h = pruefsumme(bild.getBuffer(), n);
  if (!voll && epdBereit && h == letzterInhalt) return;
  if (!epdBereit || voll || teilSeitVoll >= VOLL_ALLE) {
    EPD_3IN97_Init();
    EPD_3IN97_Display_Base(bild.getBuffer());   // beide RAMs: Basis für Teilauffrischung
    teilSeitVoll = 0;
    epdBereit = true;
  } else {
    EPD_3IN97_Display_Partial(bild.getBuffer(), 0, 0, PANEL_B, PANEL_H);
    teilSeitVoll++;
  }
  letzterInhalt = h;
}

// ── Zeichenhilfen ────────────────────────────────────────

String fmtMoney(float v, int dec = 2) {
  return (v >= 0 ? "+" : "") + String(v, dec);
}

String fmtVol(long v) {
  if (v >= 1000000) return String(v / 1000000.0f, 1) + "M";
  if (v >= 1000)    return String(v / 1000.0f, 1) + "K";
  return String(v);
}

String fmtPreis(float v) {
  float a = fabsf(v);
  int dec = a >= 1000 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01f ? 5 : 7;
  return String(v, dec);
}

int textBreite(const String& s, const GFXfont* f) {
  int16_t x1, y1; uint16_t w, h;
  bild.setFont(f);
  bild.getTextBounds(s.c_str(), 0, 0, &x1, &y1, &w, &h);
  return w + x1;
}

// y = Grundlinie
void text(int x, int y, const String& s, const GFXfont* f, uint16_t farbe = SCHWARZ) {
  bild.setFont(f);
  bild.setTextColor(farbe);
  bild.setCursor(x, y);
  bild.print(s);
}

void textRechts(int xr, int y, const String& s, const GFXfont* f, uint16_t farbe = SCHWARZ) {
  text(xr - textBreite(s, f), y, s, f, farbe);
}

// Logo-Blüte aus dem Repo, schwarz auf weiss (bzw. umgekehrt im Kopf).
void drawMarke(int cx, int cy, int r, uint16_t farbe) {
  for (int i = 0; i < 6; i++) {
    float a = i * PI / 3.0f;
    bild.fillCircle(cx + cosf(a) * r * 0.55f, cy + sinf(a) * r * 0.55f, r * 0.45f, farbe);
  }
  bild.fillCircle(cx, cy, r * 0.28f, farbe == SCHWARZ ? WEISS : SCHWARZ);
}

const char* filterText() {
  return cfgFilter == "month" ? "Aktueller Monat" :
         cfgFilter == "week"  ? "Aktuelle Woche"  :
         cfgFilter == "year"  ? "Aktuelles Jahr"  : "Gesamtzeitraum";
}

// ── Akku (Power-Chip AXP2101 an I2C, Adresse 0x34) ───────
// Nur lesen plus drei Mess-Schalter (Akku-Erkennung, Spannungs-ADC,
// Ladestandsschätzung). Spannungen und Abschaltgrenzen des Chips bleiben,
// wie das Board sie mitbringt. Register aus Waveshares XPowersLib-Beispiel.
#define PMU_SDA      41
#define PMU_SCL      42
#define PMU_ADR      0x34
#define PMU_STATUS1  0x00   // Bit 3: Akku angeschlossen, Bit 5: USB-Spannung gut
#define PMU_STATUS2  0x01   // Bit 6..5: 01 lädt, 10 entlädt; Bit 2..0: 100 Laden beendet
#define PMU_GAUGE    0x18   // Bit 3: Ladestandsschätzung an
#define PMU_ADC      0x30   // Bit 0: Akkuspannung messen
#define PMU_BAT_DET  0x68   // Bit 0: Akku-Erkennung an
#define PMU_PROZENT  0xA4
#define PMU_VBAT_H   0x34   // Akkuspannung in mV: 5 Bit hoch + 8 Bit tief
#define PMU_VBAT_L   0x35

bool    pmuDa      = false;
int     akkuProzent = -1;     // -1 = kein Akku
int     akkuMv      = 0;
bool    akkuLaedt   = false;

int pmuLies(uint8_t reg) {
  Wire.beginTransmission(PMU_ADR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom((uint8_t)PMU_ADR, (uint8_t)1) != 1) return -1;
  return Wire.read();
}

void pmuBitSetzen(uint8_t reg, uint8_t bit) {
  int v = pmuLies(reg);
  if (v < 0 || (v & (1 << bit))) return;
  Wire.beginTransmission(PMU_ADR);
  Wire.write(reg);
  Wire.write((uint8_t)(v | (1 << bit)));
  Wire.endTransmission();
}

void akkuStart() {
  Wire.begin(PMU_SDA, PMU_SCL);
  pmuDa = pmuLies(PMU_STATUS1) >= 0;
  if (!pmuDa) { Serial.println("[AKKU] Power-Chip antwortet nicht"); return; }
  pmuBitSetzen(PMU_BAT_DET, 0);
  pmuBitSetzen(PMU_ADC, 0);
  pmuBitSetzen(PMU_GAUGE, 3);
}

// Ladestand aus der Spannung (übliche Li-Ion-Kurve, linear zwischen den
// Stützpunkten). Die Schätzung des Chips selbst (Register 0xA4) taugt erst
// nach einigen Ladezyklen: frisch eingeschaltet meldete sie 8 % bei 4,14 V.
// Beim Laden liegt die Spannung etwas höher — dann zeigt es eher zu viel.
int prozentAusSpannung(int mv) {
  static const int st[][2] = {{3300, 0}, {3400, 2}, {3500, 6}, {3600, 15}, {3700, 30},
                              {3800, 48}, {3900, 63}, {4000, 78}, {4100, 90}, {4200, 100}};
  if (mv <= st[0][0]) return 0;
  for (int i = 1; i < 10; i++)
    if (mv <= st[i][0])
      return st[i - 1][1] + (mv - st[i - 1][0]) * (st[i][1] - st[i - 1][1]) / (st[i][0] - st[i - 1][0]);
  return 100;
}

// USB-Spannung da? Ohne antwortenden Power-Chip: ja — dann wird nie geschlafen.
bool usbStrom() {
  if (!pmuDa) return true;
  int s1 = pmuLies(PMU_STATUS1);
  return s1 < 0 || (s1 & 0x20);
}

void akkuLesen() {
  if (!pmuDa) return;
  int s1 = pmuLies(PMU_STATUS1), s2 = pmuLies(PMU_STATUS2);
  if (s1 < 0 || s2 < 0) return;
  if (!(s1 & 0x08)) { akkuProzent = -1; akkuLaedt = false; return; }
  int p = pmuLies(PMU_PROZENT);
  int h = pmuLies(PMU_VBAT_H), l = pmuLies(PMU_VBAT_L);
  akkuMv = (h >= 0 && l >= 0) ? ((h & 0x1F) << 8) | l : 0;
  int ausV = akkuMv > 2500 ? prozentAusSpannung(akkuMv) : -1;
  akkuLaedt = ((s2 >> 5) & 0x03) == 0x01;
  bool voll = (s2 & 0x07) == 0x04;   // Ladezustand 100: Laden beendet
  // Nach dem Volladen sinkt die Spannung von 4,20 auf ~4,17 V — die Kurve
  // allein zeigte dann dauerhaft 97 %. „Laden beendet" heisst voll. Sonst
  // gilt die Schätzung des Chips, sobald sie zur Spannung passt (eingelernt,
  // siehe prozentAusSpannung); weicht sie stark ab, die Spannung.
  akkuProzent = ausV < 0 ? -1
              : voll ? 100
              : (p >= 0 && p <= 100 && abs(p - ausV) <= 15) ? p : ausV;
  Serial.printf("[AKKU] %d %% (Spannung %d mV = %d %%, Chip %d %%)%s%s%s\n",
                akkuProzent, akkuMv, ausV, p, akkuLaedt ? " laedt" : "", voll ? " voll" : "",
                usbStrom() ? " USB" : " Akkubetrieb");
}

// Akku-Symbol mit Füllstand und Prozent, mittig um cx in der Fusszeile.
void zeichneAkku(int cx, int grund) {
  if (akkuProzent < 0) return;
  String t = String(akkuProzent) + " %" + (akkuLaedt ? "  laedt" : "");
  const int sb = 28, sh = 13;
  int tw = textBreite(t, &FreeSans9pt7b);
  int x = cx - (sb + 8 + tw) / 2, y = grund - sh + 1;
  bild.drawRect(x, y, sb, sh, SCHWARZ);
  bild.fillRect(x + sb, y + 3, 3, sh - 6, SCHWARZ);           // Pol
  int f = (sb - 4) * akkuProzent / 100;
  if (f > 0) bild.fillRect(x + 2, y + 2, f, sh - 4, SCHWARZ);
  text(x + sb + 8, grund, t, &FreeSans9pt7b);
}

bool datenVeraltet();
String alterText();

// Kachel mit Rahmen: Beschriftung oben, grosser Wert, kleine Zeile darunter.
// Unter 100 px Höhe (Layout mit Chart) rücken die Zeilen zusammen.
void kachel(int x, int y, int w, int h, const char* titel, const String& wert, const String& unten) {
  const bool knapp = h < 100;
  bild.drawRoundRect(x, y, w, h, 8, SCHWARZ);
  bild.drawRoundRect(x + 1, y + 1, w - 2, h - 2, 7, SCHWARZ);
  text(x + 14, y + (knapp ? 20 : 26), titel, &FreeSans9pt7b);
  text(x + 14, y + (knapp ? 50 : 66), wert, &FreeSansBold18pt7b);
  if (unten.length()) text(x + 14, y + h - (knapp ? 10 : 14), unten, &FreeSans9pt7b);
}

// Servertexte (UTF-8) auf die 7-Bit-Schriften abbilden: Umlaute als ae/oe/ue,
// ein paar Zeichen sinngemäss, Unbekanntes (Emoji …) fällt weg.
String asciiText(const String& s) {
  String o;
  size_t i = 0, n = s.length();
  while (i < n) {
    uint8_t c = s[i];
    uint32_t cp; int len;
    if (c < 0x80)              { cp = c; len = 1; }
    else if ((c & 0xE0) == 0xC0) { cp = c & 0x1F; len = 2; }
    else if ((c & 0xF0) == 0xE0) { cp = c & 0x0F; len = 3; }
    else if ((c & 0xF8) == 0xF0) { cp = c & 0x07; len = 4; }
    else { i++; continue; }
    if (i + len > n) break;
    for (int k = 1; k < len; k++) cp = (cp << 6) | (s[i + k] & 0x3F);
    i += len;
    if (cp >= 0x20 && cp < 0x7F) { o += (char)cp; continue; }
    switch (cp) {
      case 0xE4: o += "ae"; break;  case 0xC4: o += "Ae"; break;
      case 0xF6: o += "oe"; break;  case 0xD6: o += "Oe"; break;
      case 0xFC: o += "ue"; break;  case 0xDC: o += "Ue"; break;
      case 0xDF: o += "ss"; break;
      case 0xE0: case 0xE1: case 0xE2: o += 'a'; break;
      case 0xE8: case 0xE9: case 0xEA: o += 'e'; break;
      case 0xE7: o += 'c'; break;
      case 0xA0: case 0x09: o += ' '; break;
      case 0xB7: case 0x2013: case 0x2014: case 0x2022: o += '-'; break;
      case 0x2026: o += "..."; break;
      case 0x2192: o += "->"; break;  case 0x2190: o += "<-"; break;
      case 0x2191: o += '^'; break;   case 0x2193: o += 'v'; break;
      case 0x2265: o += ">="; break;  case 0x2264: o += "<="; break;
      case 0x2018: case 0x2019: o += '\''; break;
      case 0x201C: case 0x201D: case 0x201E: case 0xAB: case 0xBB: o += '"'; break;
      default: break;
    }
  }
  o.trim();
  return o;
}

// Text auf Breite kürzen, mit „..".
String kuerze(String s, const GFXfont* f, int maxB) {
  if (textBreite(s, f) <= maxB) return s;
  while (s.length() > 0 && textBreite(s + "..", f) > maxB) s.remove(s.length() - 1);
  return s + "..";
}

// Eingesetzte Marge einer Position: `margin` vom Server, sonst
// Einstieg × |Menge| ÷ Hebel (wie die Börse für den ROE). 0 = unbekannt.
float margePosition(const Position& p) {
  if (p.margin > 0) return p.margin;
  float q = fabsf(p.qty);
  return p.entryPrice > 0 && q > 0 && p.leverage > 0 ? p.entryPrice * q / p.leverage : 0;
}

// „+12.34 %" bezogen auf die Marge, „-" ohne Marge.
String fmtProzent(float betrag, float marge) {
  if (!(marge > 0)) return "-";
  float p = betrag / marge * 100.0f;
  return (p >= 0 ? "+" : "") + String(p, 2) + " %";
}

// Bot-Beträge in USDT? Faktor = Kurs (USDT je Coin), sonst 1. `coin` wird angepasst.
float botFaktor(const Bot& b, String& coin) {
  coin = b.marginCoin.length() ? b.marginCoin : String("USDT");
  if (cfgBotUsdt && coin != "USDT" && b.markPrice > 0) { coin = "USDT"; return b.markPrice; }
  return 1.0f;
}

String fmtBetrag(float v, const String& coin) {
  return fmtMoney(v, coin == "USDT" ? 2 : 4) + (coin != "USDT" ? " " + coin : "");
}

// Runde Achsenschritte (1-2-2.5-5 × 10^n): der Schritt, der Spanne/4 am
// nächsten liegt (nicht der nächstgrössere — sonst oft nur zwei Linien).
double achsenSchritt(double min, double max) {
  double roh = (max - min) / 4;
  if (!(roh > 0)) roh = fabs(max) / 100;
  if (!(roh > 0)) roh = 1;
  double basis = pow(10, floor(log10(roh)));
  const double f[] = {1, 2, 2.5, 5, 10};
  double best = basis;
  for (double x : f) {
    double w = x * basis;
    if (fabs(log(w / roh)) < fabs(log(best / roh))) best = w;
  }
  return best;
}

String achsenText(double v, double schritt) {
  int stellen = (int)-floor(log10(schritt) + 1e-9);
  stellen = constrain(stellen, 0, 8);
  if (fmod(schritt * pow(10, stellen), 1.0) > 1e-6) stellen++;   // 2.5er-Schritte
  return String(v, (unsigned)stellen);
}

// ── Layout ───────────────────────────────────────────────
// Ohne Chart: Kopf 0–52, Kacheln 66–178, Tabelle ab 206 (6 Zeilen à 30 px).
// Mit Chart: Kacheln 58–138, Chart 146–282 über die ganze Breite, Tabelle
// ab 304 (4 Zeilen à 24 px). Fuss immer 454–480.
// Hochformat (480×800): Kacheln 2×2 ab 60, Chart 246–486, Tabelle ohne
// Einstieg/Mark.
#define BAND_Y      146
#define BAND_H      136

bool hochformat() { return HOEHE > BREITE; }

int chartBoxBreite() { return BREITE - 24; }

const char* spanneText(const String& s) {
  return s == "1h" ? "1 Std" : s == "7d" ? "7 Tage" : s == "30d" ? "30 Tage" : "24 Std";
}

// Kurs-Chart im Kasten: Kopf (Symbol, Zeitraum, Kurs, Änderung), darunter
// Linie (2 px) oder Kerzen (steigend hohl, fallend gefüllt), gestrichelt der
// Startkurs, rechts Preisachse mit runden Stufen und invertierter Kursmarke.
void zeichneChart(int x, int y, int w, int h) {
  bild.drawRoundRect(x, y, w, h, 8, SCHWARZ);
  const char* hinweis = nullptr;
  switch (kursZustand) {
    case KURS_NICHTS:     hinweis = "Kurs wird geladen ..."; break;
    case KURS_ALT_SERVER: hinweis = "Server kennt den Kurs-Chart noch nicht (App aktualisieren)"; break;
    case KURS_SYMBOL:     hinweis = "Symbol unbekannt - im Setup pruefen"; break;
    case KURS_SCHLUESSEL: hinweis = "Kein Zugang zum Kurs (Schluessel)"; break;
    case KURS_AUS:        hinweis = "Marktdaten in der App ausgeschaltet"; break;
    case KURS_NETZ:       hinweis = "Kurs gerade nicht abrufbar"; break;
    case KURS_OK:         if (kurs.kerzen.size() < 2) hinweis = "Kurs gerade nicht abrufbar"; break;
  }
  String sym = kursZustand == KURS_OK ? kurs.symbol : cfgChartSym;
  text(x + 10, y + 20, sym + "  " + spanneText(cfgSpanne), &FreeSansBold9pt7b);
  if (hinweis) {
    text(x + 10, y + h / 2 + 10, kuerze(hinweis, &FreeSans9pt7b, w - 20), &FreeSans9pt7b);
    return;
  }

  // Kopf rechts: Kurs und Änderung (Minus invertiert wie Verluste in der Tabelle)
  String aend = (kurs.aenderung >= 0 ? "+" : "") + String(kurs.aenderung, 2) + " %";
  int ab = textBreite(aend, &FreeSansBold9pt7b);
  int ax = x + w - 10 - ab;
  if (kurs.aenderung < 0) {
    bild.fillRect(ax - 5, y + 5, ab + 10, 21, SCHWARZ);
    text(ax, y + 20, aend, &FreeSansBold9pt7b, WEISS);
  } else {
    text(ax, y + 20, aend, &FreeSansBold9pt7b);
  }
  textRechts(ax - 14, y + 20, fmtPreis(kurs.jetzt), &FreeSansBold9pt7b);

  const auto& k = kurs.kerzen;
  const int n = k.size();
  const bool kerzen = cfgChartArt == "kerzen";
  float mn = 1e30f, mx = -1e30f;
  for (auto& c : k) {
    mn = std::min(mn, kerzen ? c[2] : c[3]);
    mx = std::max(mx, kerzen ? c[1] : c[3]);
  }
  float spann = mx - mn;
  if (!(spann > 0)) { spann = fabsf(mx) * 0.01f + 1e-9f; mn -= spann / 2; mx += spann / 2; }

  // Achse: Breite nach dem längsten Text, damit der Verlauf nie darunter läuft
  double schritt = achsenSchritt(mn, mx);
  std::vector<double> stufen;
  for (double v = ceil(mn / schritt) * schritt; v <= mx + schritt * 1e-9 && stufen.size() < 12; v += schritt)
    stufen.push_back(v);
  String jetztText = fmtPreis(kurs.jetzt);
  int achseB = textBreite(jetztText, &FreeSans9pt7b);
  for (double v : stufen) achseB = std::max(achseB, textBreite(achsenText(v, schritt), &FreeSans9pt7b));
  achseB += 12;

  const int px = x + 8, py = y + 32;
  const int pw = w - 16 - achseB, ph = h - 32 - 8;
  auto yv = [&](float v) { return py + (int)lroundf((1.0f - (v - mn) / spann) * (ph - 1)); };
  const int achseX = px + pw + 6;

  // Lage der Kursmarke vorab: eine Achsenbeschriftung, die sie verdecken
  // würde, fällt weg (sonst lugt sie halb unter der Marke hervor)
  const int mh = 20;
  const int my = constrain(yv(constrain(kurs.jetzt, mn, mx)) - mh / 2, py - 4, py + ph - mh + 4);

  // Gitter (gepunktet) und Beschriftung
  for (double v : stufen) {
    int yy = yv((float)v);
    for (int xx = px; xx < px + pw; xx += 4) bild.drawPixel(xx, yy, SCHWARZ);
    if (yy + 5 < my - 2 || yy - 9 > my + mh + 2) text(achseX, yy + 5, achsenText(v, schritt), &FreeSans9pt7b);
  }

  // Startkurs gestrichelt
  {
    float s0 = kerzen ? k[0][0] : k[0][3];
    int ys = yv(constrain(s0, mn, mx));
    for (int xx = px; xx < px + pw; xx += 8) bild.drawFastHLine(xx, ys, 4, SCHWARZ);
  }

  if (kerzen) {
    float fach = (float)pw / n;
    int kb = constrain((int)(fach * 0.7f), 1, 9);
    for (int i = 0; i < n; i++) {
      float o = k[i][0], hh = k[i][1], l = k[i][2], c = k[i][3];
      int mitte = px + (int)((i + 0.5f) * fach);
      int yh = yv(hh), yl = yv(l);
      bild.drawFastVLine(mitte, yh, yl - yh + 1, SCHWARZ);
      int oben = yv(std::max(o, c)), unten = yv(std::min(o, c));
      int kh = std::max(1, unten - oben + 1);
      int kx = mitte - kb / 2;
      if (c >= o) {                       // steigend: hohl
        if (kb >= 3 && kh >= 3) bild.fillRect(kx, oben, kb, kh, WEISS);
        bild.drawRect(kx, oben, kb, kh, SCHWARZ);
      } else {                            // fallend: gefüllt
        bild.fillRect(kx, oben, kb, kh, SCHWARZ);
      }
    }
  } else {
    auto xi = [&](int i) { return px + (int)lroundf((float)i * (pw - 1) / (n - 1)); };
    for (int i = 1; i < n; i++) {
      int x0 = xi(i - 1), y0 = yv(k[i - 1][3]), x1 = xi(i), y1 = yv(k[i][3]);
      bild.drawLine(x0, y0, x1, y1, SCHWARZ);
      bild.drawLine(x0, y0 + 1, x1, y1 + 1, SCHWARZ);   // 2 px
    }
    bild.fillCircle(xi(n - 1), yv(k[n - 1][3]), 3, SCHWARZ);
  }

  // Aktueller Kurs als invertierte Marke auf der Achse
  bild.fillRect(achseX - 4, my, x + w - 3 - (achseX - 4), mh, SCHWARZ);
  text(achseX, my + 15, jetztText, &FreeSans9pt7b, WEISS);
}

// ── Seite ────────────────────────────────────────────────

void zeichneDashboard() {
  akkuLesen();            // billig (drei I2C-Register), darum bei jedem Bild frisch
  bild.fillScreen(WEISS);

  // Kopf: schwarzer Balken
  bild.fillRect(0, 0, BREITE, 52, SCHWARZ);
  drawMarke(30, 26, 18, WEISS);
  text(58, 35, "AutarkTrade", &FreeSansBold18pt7b, WEISS);
  textRechts(BREITE - 16, 33, filterText(), &FreeSansBold12pt7b, WEISS);

  // Kacheln: Kontostand/Gesamt, Heute, Win-Rate, RRR (mit Chart niedriger)
  const bool mitChart = cfgChart;
  const bool hoch = hochformat();
  // Quer: 4 Kacheln nebeneinander. Hoch: 2×2.
  const int kg = 10;
  const int kw = hoch ? (BREITE - 24 - kg) / 2 : 185;
  const int ky = hoch ? 60 : (mitChart ? 58 : 66);
  const int kh = hoch ? (mitChart ? 84 : 100) : (mitChart ? 80 : 112);
  int kx = 12, kyy = ky;
  auto naechste = [&]() {
    if (hoch && kx > 12) { kx = 12; kyy += kh + 8; }
    else kx += kw + kg;
  };
  const bool konto = cfgKonto && data.hasBalance;
  if (konto) {
    kachel(kx, kyy, kw, kh, "Kontostand", String(data.balance, 2),
           "Perf " + fmtMoney(data.balancePerf, 1) + "%");
  } else {
    kachel(kx, kyy, kw, kh, "P&L Zeitraum", fmtMoney(data.totalPnL), "USDT");
  }
  naechste();
  kachel(kx, kyy, kw, kh, "Heute", fmtMoney(data.todayPnL),
         String(data.todayTrades) + " Trades  " + String(data.todayWins) + "+ / " +
         String(data.todayLosses) + "-");
  naechste();
  kachel(kx, kyy, kw, kh, "Win-Rate", String(data.winRate, 0) + "%",
         konto ? "P&L " + fmtMoney(data.totalPnL) : "Zufr. " + String(data.satisfaction, 0) + "%");
  naechste();
  kachel(kx, kyy, kw, kh, "RRR", "1:" + String(data.rrr, 1),
         "Vol 30d " + fmtVol(data.volume30d));
  const int kachelEnde = kyy + kh;

  // Band zwischen Kacheln und Tabelle: der Chart
  const int fy = HOEHE - 26;
  int yMax;                 // tiefste Grundlinie einer Tabellenzeile
  int y;                    // Grundlinie des Tabellentitels
  int zeile;
  if (mitChart && hoch) {
    const int cy = kachelEnde + 10, ch = 240;
    zeichneChart(12, cy, chartBoxBreite(), ch);
    y = cy + ch + 30; zeile = 26; yMax = fy - 8;
  } else if (mitChart) {
    zeichneChart(12, BAND_Y, chartBoxBreite(), BAND_H);
    y = 304; zeile = 24; yMax = fy - 8;
  } else if (hoch) {
    y = kachelEnde + 32; zeile = 30; yMax = fy - 14;
  } else {
    y = 206; zeile = 30; yMax = fy - 14;
  }

  // Tabelle: Positionen, danach Bots
  const bool botsDa = !data.bots.empty();
  // Symbol, Seite, Hebel, Einstieg, Mark, Grid (rechtsbündig), PnL (rechtsbündig).
  // Hochformat ohne Einstieg/Mark (-1), sonst reicht die Breite nicht.
  const int rechts = BREITE - 16;
  const int sxQuer[] = {16, 176, 246, 306, 426, 640, rechts};
  const int sxHoch[] = {16, 168, 192, -1, -1, 330, rechts};
  const int* sx = hoch ? sxHoch : sxQuer;

  // Titel mit Summen. Positionen: USDT bzw. Σ PnL / Σ Marge. Bots nur, wenn
  // alle dieselbe Münze haben (nach der Umrechnung) — Coins sind nicht summierbar.
  String titel = String(hoch ? "Positionen (" : "Offene Positionen (") + String(data.positions.size()) + ")";
  if (!data.positions.empty()) {
    float s = 0, m = 0;
    for (auto& p : data.positions) { s += p.unrealizedPNL; m += margePosition(p); }
    titel += "   " + (cfgPnlProz ? fmtProzent(s, m) : fmtMoney(s) + " USDT");
  }
  text(sx[0], y, titel, &FreeSansBold12pt7b);
  if (botsDa && !hoch) {   // hoch reicht die Zeile nicht; der Bot-PnL steht in seiner Zeile
    String bt = "Bots: " + String(data.bots.size());
    String coin0; bool gleich = true; float s = 0, m = 0;
    for (auto& b : data.bots) {
      String coin; float f = botFaktor(b, coin);
      if (!coin0.length()) coin0 = coin; else if (coin != coin0) gleich = false;
      s += b.unrealizedPNL * f;
      m += b.margin * f;
    }
    if (gleich) bt += "   " + (cfgPnlProz ? fmtProzent(s, m) : fmtBetrag(s, coin0));
    textRechts(rechts, y, bt, &FreeSansBold12pt7b);
  }
  y += 10;
  bild.drawFastHLine(12, y, BREITE - 24, SCHWARZ);
  y += 22;
  text(sx[0], y, "Symbol",   &FreeSans9pt7b);
  text(sx[1], y, hoch ? "S." : "Seite", &FreeSans9pt7b);
  text(sx[2], y, "Hebel",    &FreeSans9pt7b);
  if (sx[3] >= 0) text(sx[3], y, "Einstieg", &FreeSans9pt7b);
  if (sx[4] >= 0) text(sx[4], y, "Mark",     &FreeSans9pt7b);
  if (botsDa) textRechts(sx[5], y, "Grid", &FreeSans9pt7b);
  textRechts(sx[6], y, cfgPnlProz ? "PnL %" : "PnL", &FreeSans9pt7b);
  y += 8;
  bild.drawFastHLine(12, y, BREITE - 24, SCHWARZ);

  int gezeigt = 0, gesamt = data.positions.size() + data.bots.size();
  // Passen nicht alle, belegt „+N weitere" die letzte Zeile
  int platz = (yMax - y) / zeile;
  int zeigbar = gesamt > platz ? std::max(0, platz - 1) : gesamt;
  if (gesamt == 0) {
    text(sx[0], y + zeile + 4, "Keine offenen Positionen", &FreeSans9pt7b);
  }
  // Betrag rechtsbündig, Verlust invertiert, damit er ohne Farbe auffällt
  auto wert = [&](int xr, const String& s, bool verlust) {
    int w = textBreite(s, &FreeSansBold9pt7b);
    if (verlust) {
      bild.fillRect(xr - w - 6, y - 16, w + 12, 22, SCHWARZ);
      textRechts(xr, y, s, &FreeSansBold9pt7b, WEISS);
    } else {
      textRechts(xr, y, s, &FreeSansBold9pt7b);
    }
  };
  auto reihe = [&](const String& sym, const String& seite, float hebel, float einstieg,
                   float mark, const String& grid, bool gridVerlust,
                   const String& pnl, bool verlust) {
    y += zeile;
    String s = sym; if (s.length() > (hoch ? 12u : 16u)) s = s.substring(0, hoch ? 12 : 16);
    text(sx[0], y, s, &FreeSansBold9pt7b);
    // Hochformat: nur L/S/N, sonst stossen Hebel und Grid zusammen
    String sd = seite;
    if (hoch) {
      String g = seite; g.toUpperCase();
      sd = (g == "BUY" || g == "LONG") ? "L" : (g == "SELL" || g == "SHORT") ? "S" : g.substring(0, 1);
    }
    text(sx[1], y, sd, &FreeSans9pt7b);
    text(sx[2], y, hebel > 0 ? String(hebel, 0) + "x" : "-", &FreeSans9pt7b);
    if (sx[3] >= 0) text(sx[3], y, fmtPreis(einstieg), &FreeSans9pt7b);
    if (sx[4] >= 0) text(sx[4], y, mark > 0 ? fmtPreis(mark) : "-", &FreeSans9pt7b);
    if (botsDa) wert(sx[5], grid, gridVerlust);
    wert(sx[6], pnl, verlust);
    gezeigt++;
  };
  for (auto& p : data.positions) {
    if (gezeigt >= zeigbar) break;
    String pnl = cfgPnlProz ? fmtProzent(p.unrealizedPNL, margePosition(p)) : fmtMoney(p.unrealizedPNL);
    reihe(p.symbol, p.side, p.leverage, p.entryPrice, p.markPrice,
          "-", false, pnl, p.unrealizedPNL < 0);
  }
  for (auto& b : data.bots) {
    if (gezeigt >= zeigbar) break;
    String coin; float f = botFaktor(b, coin);
    float pnlW = b.unrealizedPNL * f;
    String pnl = cfgPnlProz ? fmtProzent(pnlW, b.margin * f) : fmtBetrag(pnlW, coin);
    // Bisher realisierter Grid-Gewinn — fehlt bei älterem Server oder Bots ohne Grid
    bool gridDa = !isnan(b.gridProfit);
    float gridW = gridDa ? b.gridProfit * f : 0;
    String grid = gridDa ? fmtBetrag(gridW, coin) : String("-");   // wie im Desklet: immer Betrag
    reihe("Bot " + b.symbol, b.side, b.leverage, b.entryPrice, b.markPrice,
          grid, gridDa && gridW < 0, pnl, pnlW < 0);
  }
  if (gezeigt < gesamt) {
    y += zeile;
    textRechts(rechts, y, "+" + String(gesamt - gezeigt) + " weitere", &FreeSans9pt7b);
  }

  // Fuss: Stand bzw. Warnung, invertiert wenn veraltet
  if (datenVeraltet()) {
    bild.fillRect(0, fy, BREITE, 26, SCHWARZ);
    String w = lastOkMs == 0 ? "OFFLINE - keine Daten vom Server"
                             : "VERALTET - " + standText() + ", Server nicht erreicht";
    text(16, HOEHE - 8, w, &FreeSansBold9pt7b, WEISS);
  } else {
    bild.drawFastHLine(0, fy, BREITE, SCHWARZ);
    text(16, HOEHE - 8, standText(), &FreeSans9pt7b);
    zeichneAkku(BREITE / 2 + (hoch ? 10 : 0), HOEHE - 8);
    textRechts(BREITE - 16, HOEHE - 8, "v" FW_VERSION, &FreeSans9pt7b);
  }
}

void zeichneMeldung(const char* titel, const char* detail) {
  bild.fillScreen(WEISS);
  bild.fillRect(0, 0, BREITE, 52, SCHWARZ);
  drawMarke(30, 26, 18, WEISS);
  text(58, 35, "AutarkTrade", &FreeSansBold18pt7b, WEISS);
  text(40, 200, titel, &FreeSansBold24pt7b);
  if (detail) text(40, 250, detail, &FreeSans9pt7b);
  text(40, HOEHE - 16, "Anzeige v" FW_VERSION, &FreeSans9pt7b);
  zeige();
}

// ── Setup-Modus ──────────────────────────────────────────

void zeichneSetupSchirm(const char* grund) {
  bild.fillScreen(WEISS);
  bild.fillRect(0, 0, BREITE, 52, SCHWARZ);
  drawMarke(30, 26, 18, WEISS);
  text(58, 35, "AutarkTrade - Einrichtung", &FreeSansBold18pt7b, WEISS);

  text(40, 110, "1. Mit diesem WLAN verbinden:", &FreeSans9pt7b);
  text(40, 150, AP_SSID, &FreeSansBold18pt7b);
  text(40, 195, "Passwort:", &FreeSans9pt7b);
  text(40, 240, apPass, &FreeSansBold24pt7b);

  // Zweite Spalte: quer rechts daneben, hoch darunter
  const int sx2 = hochformat() ? 40 : 440, sy2 = hochformat() ? 300 : 0;
  text(sx2, sy2 + 110, "2. Im Browser oeffnen:", &FreeSans9pt7b);
  text(sx2, sy2 + 150, "192.168.4.1", &FreeSansBold18pt7b);
  text(sx2, sy2 + 195, "WLAN, Server und", &FreeSans9pt7b);
  text(sx2, sy2 + 218, "Anzeige-Schluessel eintragen.", &FreeSans9pt7b);

  int y = hochformat() ? 600 : 320;
  if (setupMitKonfig) { text(40, y, "Ohne Eingabe: nach 10 Min. Neustart", &FreeSans9pt7b); y += 26; }
  if (grund) text(40, y, grund, &FreeSansBold9pt7b);
  bild.drawFastHLine(0, HOEHE - 30, BREITE, SCHWARZ);
  text(40, HOEHE - 10, "Anzeige v" FW_VERSION, &FreeSans9pt7b);
  zeige(true);
}

// Setup-AP mit WPA2 (SEC-ESP-002) und Portal. Nur hier läuft der Webserver.
void starteSetupModus(const char* grund) {
  configMode = true;
  setupMitKonfig = !(cfgSSID.isEmpty() || cfgKey.isEmpty());
  WiFi.setAutoReconnect(false);
  WiFi.disconnect();                 // STA-Versuche würden den AP-Kanal stören
  WiFi.mode(WIFI_AP_STA);            // STA nur für den Netz-Scan
  formToken = zufallsText(32, "0123456789abcdef");
  ladeApPasswort();
  WiFi.softAP(AP_SSID, apPass.c_str());
  Serial.printf("[AP] Setup-Modus auf %s\n", WiFi.softAPIP().toString().c_str());
  setupRoutes();
  portalAktivMs = millis();
  zeichneSetupSchirm(grund);
}

// Lokale Geste: in den ersten Sekunden nach dem Boot die BOOT-Taste
// SETUP_HALTEN_MS lang halten. Nur wer am Gerät steht, kommt so ins Portal.
// Kein Hinweis aufs Display: eine Auffrischung dauert länger als das Fenster.
bool setupGesteBeimStart() {
  pinMode(BOOT_TASTE_PIN, INPUT_PULLUP);
  Serial.println("[BOOT] Setup: BOOT-Taste 3 s halten");
  unsigned long t0 = millis();
  while (millis() - t0 < SETUP_FENSTER_MS) {
    if (digitalRead(BOOT_TASTE_PIN) == LOW) {
      unsigned long h0 = millis();
      while (digitalRead(BOOT_TASTE_PIN) == LOW) {
        if (millis() - h0 >= SETUP_HALTEN_MS) return true;
        delay(30);
      }
      return false;   // losgelassen: normal starten
    }
    delay(30);
  }
  return false;
}

// Tasten im Betrieb: eigener kleiner Task, weil loop() in einem HTTP-Abruf
// bis zu ~20 s hängen kann.
//   BOOT oder Wippe drücken: kurz → sofort neu laden und voll auffrischen,
//                            3 s halten → Setup-Portal (lokale Geste, SEC-ESP-001)
//   Wippe hoch / runter:     Chart-Zeitraum länger / kürzer
// Die PWR-Taste geht über den Power-Chip und ist nicht als Pin lesbar.
volatile bool   tasteSetup  = false;
volatile bool   tasteJetzt  = false;
volatile int8_t tasteSpanne = 0;      // +1 länger, -1 kürzer

struct Taste {
  uint8_t pin;
  int8_t  spanne;                     // 0 = Druck-Taste (kurz/lang), sonst Zeitraum-Schritt
  unsigned long ab;
  bool gemeldet;
};

void tastenTask(void*) {
  Taste tasten[] = {
    {BOOT_TASTE_PIN, 0, 0, false},
    {WIPPE_DRUCK_PIN, 0, 0, false},
    {WIPPE_HOCH_PIN, +1, 0, false},
    {WIPPE_RUNTER_PIN, -1, 0, false},
  };
  for (auto& t : tasten) pinMode(t.pin, INPUT_PULLUP);
  for (;;) {
    for (auto& t : tasten) {
      bool unten = digitalRead(t.pin) == LOW;
      if (unten) {
        if (!t.ab) { t.ab = millis(); letzteTasteMs = t.ab ? t.ab : 1; }
        if (!t.spanne && !t.gemeldet && millis() - t.ab >= SETUP_HALTEN_MS) { tasteSetup = true; t.gemeldet = true; }
      } else {
        unsigned long d = t.ab ? millis() - t.ab : 0;
        if (t.ab && !t.gemeldet && d >= 50) {
          if (t.spanne) tasteSpanne = t.spanne;
          else if (d < KURZ_DRUCK_MS) tasteJetzt = true;
        }
        t.ab = 0;
        t.gemeldet = false;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}

// Zeitraum einen Schritt weiter (1h → 24h → 7d → 30d), im Kreis: am Ende
// geht es vorne weiter — sonst „tut die Wippe nichts", wenn man am Rand steht.
void wechsleSpanne(int8_t schritt) {
  static const char* folge[] = {"1h", "24h", "7d", "30d"};
  int i = 1;
  for (int k = 0; k < 4; k++) if (cfgSpanne == folge[k]) i = k;
  i = (i + schritt + 4) % 4;
  cfgSpanne = folge[i];
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putString("cspan", cfgSpanne);
  prefs.end();
}

// Bild über USB ansehen: „B" an die serielle Schnittstelle → Lage und
// Puffer als Hex zwischen BILD-START und BILD-ENDE (Panel-Ausrichtung).
// Nur lesen, keine Daten — Werkzeug für die Layout-Kontrolle am Rechner.
void sendeBild() {
  const uint8_t* p = bild.getBuffer();
  const size_t n = (PANEL_B / 8) * PANEL_H;
  Serial.printf("\nBILD-START %d %d %d\n", PANEL_B, PANEL_H, bild.getRotation());
  static const char hex[] = "0123456789abcdef";
  char zeile[201];
  for (size_t i = 0; i < n; i += 100) {
    size_t k = 0;
    for (size_t j = i; j < i + 100 && j < n; j++) { zeile[k++] = hex[p[j] >> 4]; zeile[k++] = hex[p[j] & 15]; }
    zeile[k] = 0;
    Serial.println(zeile);
  }
  Serial.println("BILD-ENDE");
}

// ── Setup ────────────────────────────────────────────────

// Taste beim Aufwachen schon gedrückt: SETUP_HALTEN_MS weiter gehalten?
bool weiterGehalten(uint8_t pin) {
  pinMode(pin, INPUT_PULLUP);
  unsigned long h0 = millis();
  while (digitalRead(pin) == LOW) {
    if (millis() - h0 >= SETUP_HALTEN_MS) return true;
    delay(30);
  }
  return false;
}

// WLAN verbinden. Nach dem Aufwachen zuerst mit gemerktem Kanal und BSSID:
// das spart den Kanal-Scan, also Wachzeit (Akku).
bool verbindeWlan() {
  WiFi.mode(WIFI_STA);
  unsigned long t0 = millis();
  if (wlanMerk) {
    WiFi.begin(cfgSSID.c_str(), cfgPass.c_str(), wlanKanal, wlanBssid);
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < WLAN_SCHNELL_MS) delay(50);
    if (WiFi.status() != WL_CONNECTED) {
      wlanMerk = false;            // Router gewechselt oder Kanal neu: normal suchen
      WiFi.disconnect();
      t0 = millis();
    }
  }
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_MS) delay(100);
  }
  if (WiFi.status() != WL_CONNECTED) return false;
  const uint8_t* b = WiFi.BSSID();
  if (b) { memcpy(wlanBssid, b, 6); wlanKanal = WiFi.channel(); wlanMerk = true; }
  Serial.printf("[WiFi] %s nach %lu ms\n", WiFi.localIP().toString().c_str(), millis() - t0);
  return true;
}

// Aufgewacht, aber keine Daten: Daten aus dem letzten Wachsein gibt es nicht
// mehr, also bleibt das alte Bild stehen. Erst wenn es veraltet ist, einmal
// eine Meldung statt des Dashboards.
void ohneDatenNachSchlaf() {
  if (!datenVeraltet() || veraltetGezeigt) return;
  String det = lastOkMs == 0 ? String("Pruefen: Host, Port und Anzeige-Schluessel")
                             : "Letzte Daten: " + standText() + " - versucht es jede Minute";
  zeichneMeldung("Server nicht erreicht", det.c_str());
  veraltetGezeigt = true;
}

void setup() {
  esp_sleep_wakeup_cause_t grund = esp_sleep_get_wakeup_cause();
  const bool geweckt = grund == ESP_SLEEP_WAKEUP_TIMER || grund == ESP_SLEEP_WAKEUP_EXT1;
  const uint64_t weckPins = grund == ESP_SLEEP_WAKEUP_EXT1 ? esp_sleep_get_ext1_wakeup_status() : 0;
  // Gehaltene Pegel aus dem Schlaf (CS des Panels) wieder freigeben
  // Ortszeit Schweiz/Mitteleuropa mit Sommerzeit (nach dem Schlaf neu setzen)
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1); tzset();
  gpio_deep_sleep_hold_dis();       // von 1.5.0 vor der Korrektur noch gesetzt
  gpio_hold_dis((gpio_num_t)EPD_CS_PIN);
  gpio_hold_dis((gpio_num_t)EPD_RST_PIN);
  // Weck-Tasten können noch RTC-Pins sein — zurück an GPIO, sonst liest
  // digitalRead nichts. Bei JEDEM Start: der RTC-Teil hängt am Akku und
  // übersteht auch Neustart und Flashen, nicht nur das Aufwachen.
  for (uint8_t pin : WECK_PINS) rtc_gpio_deinit((gpio_num_t)pin);

  Serial.begin(115200);
  if (!geweckt) delay(1500);  // ESP32-S3 USB CDC: warten bis Host verbunden (aus dem Schlaf: Akku, kein Host)
  Serial.printf("[BOOT] Start " FW_VERSION "%s\n",
                grund == ESP_SLEEP_WAKEUP_TIMER ? " (Takt)" : grund == ESP_SLEEP_WAKEUP_EXT1 ? " (Taste)" : "");

  DEV_Module_Init();
  akkuStart();
  loadConfig();
  bild.setRotation(cfgDrehung);

  // Nur ohne Konfiguration oder per lokaler Geste (SEC-ESP-001) — nie aus dem Netz.
  if (cfgSSID.isEmpty() || cfgKey.isEmpty()) {
    starteSetupModus(nullptr);
    return;
  }
  // Aus dem Schlaf gibt es kein Fenster nach dem Boot: die weckende Taste
  // selbst zählt. BOOT bzw. Wippe gedrückt 3 s halten → Setup, wie im Betrieb.
  const bool druckTaste = weckPins & ((1ULL << BOOT_TASTE_PIN) | (1ULL << WIPPE_DRUCK_PIN));
  if (geweckt ? (druckTaste && (weiterGehalten(BOOT_TASTE_PIN) || weiterGehalten(WIPPE_DRUCK_PIN)))
              : setupGesteBeimStart()) {
    starteSetupModus("Per BOOT-Taste geoeffnet");
    return;
  }
  if (weckPins) {
    letzteTasteMs = millis() ? millis() : 1;   // wach bleiben für weitere Drücke
    if (cfgChart && (weckPins & (1ULL << WIPPE_HOCH_PIN)))   wechsleSpanne(+1);
    if (cfgChart && (weckPins & (1ULL << WIPPE_RUNTER_PIN))) wechsleSpanne(-1);
  }

  if (!verbindeWlan()) {
    if (geweckt) {
      // Akkubetrieb: kein Neustart und kein Zähler zum Setup-WLAN — ein Router,
      // der kurz weg ist, soll die Anzeige nicht ins Setup schicken.
      Serial.println("[WiFi] nicht verbunden, naechster Takt");
      ohneDatenNachSchlaf();
      xTaskCreate(tastenTask, "taste", 2048, nullptr, 1, nullptr);
      lastUpdate = millis();
      return;
    }
    // Nach WIFI_MAX_FEHLVERSUCHE Boots ohne WLAN in den Setup-AP, statt
    // endlos neu zu starten (falsche SSID wäre sonst nur per USB zu lösen).
    uint8_t fehl = leseFehlversuche() + 1;
    if (fehl >= WIFI_MAX_FEHLVERSUCHE) {
      schreibeFehlversuche(0);
      starteSetupModus("WLAN nicht erreichbar - Daten pruefen");
      return;
    }
    schreibeFehlversuche(fehl);
    char det[64];
    snprintf(det, sizeof(det), "Versuch %u/%u, danach Setup-WLAN", fehl, WIFI_MAX_FEHLVERSUCHE);
    zeichneMeldung("WLAN-Fehler", det);
    delay(10000);
    ESP.restart();
    return;
  }
  // Weckgrund erst hier: nach dem Aufwachen ist ein USB-Host vorher noch nicht wieder verbunden
  if (geweckt) Serial.printf("[WECK] %s, Pins 0x%llx\n", weckPins ? "Taste" : "Takt", (unsigned long long)weckPins);
  if (!geweckt) schreibeFehlversuche(0);   // aus dem Schlaf: NVS nicht jede Minute beschreiben
  xTaskCreate(tastenTask, "taste", 2048, nullptr, 1, nullptr);

  WiFi.setSleep(true);   // Modem Sleep zwischen den Abrufen
  // Kein Webserver im Heimnetz (SEC-ESP-001) — Setup nur per Geste beim Boot.

  if (fetchData()) {
    holeZusatz();          // Chart vor dem ersten Bild, nicht danach
    zeichneDashboard();
    // Takt aus dem Schlaf: Teilauffrischung wie im Wachbetrieb; Einschalten
    // oder Taste: voll (räumt Geisterbilder weg, wie ein Druck im Betrieb)
    zeige(grund != ESP_SLEEP_WAKEUP_TIMER);
  } else if (geweckt) {
    ohneDatenNachSchlaf();
  } else {
    zeichneMeldung("Keine Daten", "Pruefen: Host, Port und Anzeige-Schluessel");
  }
  lastUpdate = millis();
}

// ── Loop ─────────────────────────────────────────────────

static void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.reconnect();
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS)
    delay(100);
  if (WiFi.status() == WL_CONNECTED) WiFi.setSleep(true);
}

// ── Einrichtung über USB (CFG) ───────────────────────────
// Die Web-App schickt nach dem Flashen eine Zeile
//   CFG {"ssid":"…","pass":"…","host":"…","port":"8080","key":"…"}
// und spart so den Setup-Hotspot. Geht nur über das eingesteckte Kabel, also
// lokal wie die Setup-Geste (SEC-ESP-001). „CFG?" fragt, ob die Firmware es kann.
// „CFG SCAN" sucht WLANs. Antwort: [CFG] BEREIT <version> | [CFG] NETZE <json> |
// [CFG] OK (dann Neustart) | [CFG] FEHLER <grund>.
// Serial.flush() (HWCDC, Arduino 2.0.14) wartet ohne Zeitlimit, bis ein PC die
// Ausgabe abgeholt hat — am Akku gibt es keinen, das Board hing dann vor dem
// Schlaf für immer (kein neues Bild, Tasten tot). Darum nur kurz warten.
void seriellAusgeben() { delay(30); }

void seriellCfg(const String& zeile) {
  if (zeile == "CFG?") { Serial.println("[CFG] BEREIT " FW_VERSION); return; }
  // Der Browser kann keine WLANs suchen, das Board schon: eine Zeile JSON
  // [{"ssid":"…","rssi":-55,"enc":1}, …], stärkstes zuerst, ohne Doppelte.
  if (zeile == "CFG SCAN") {
    if (WiFi.getMode() == WIFI_OFF) WiFi.mode(WIFI_STA);
    int n = WiFi.scanNetworks();
    JsonDocument d;
    JsonArray netze = d.to<JsonArray>();
    for (int i = 0; i < n; i++) {
      String s = WiFi.SSID(i);
      if (s.isEmpty()) continue;
      bool doppelt = false;
      for (JsonObject x : netze) if (s == (const char*)x["ssid"]) { doppelt = true; break; }
      if (doppelt) continue;   // Liste kommt nach Stärke sortiert: der erste ist der beste
      JsonObject o = netze.add<JsonObject>();
      o["ssid"] = s;
      o["rssi"] = WiFi.RSSI(i);
      o["enc"]  = WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? 1 : 0;
      if (netze.size() >= 20) break;
    }
    WiFi.scanDelete();
    Serial.print("[CFG] NETZE ");
    serializeJson(d, Serial);
    Serial.println();
    return;
  }
  JsonDocument d;
  if (!zeile.startsWith("CFG ") || deserializeJson(d, zeile.substring(4)) != DeserializationError::Ok) {
    Serial.println("[CFG] FEHLER json");
    return;
  }
  String ssid = d["ssid"] | "", pass = d["pass"] | "", host = d["host"] | "", key = d["key"] | "";
  String port = d["port"].is<int>() ? String(d["port"].as<int>()) : String(d["port"] | "8080");
  ssid.trim(); host.trim(); port.trim(); key.trim();
  if (ssid.isEmpty() || host.isEmpty() || key.isEmpty()) { Serial.println("[CFG] FEHLER felder"); return; }
  if (!isValidPort(port)) { Serial.println("[CFG] FEHLER port"); return; }
  saveConfig(ssid, pass, host, port, key, cfgKonto);
  Serial.println("[CFG] OK");
  seriellAusgeben();
  delay(500);
  ESP.restart();
}

// Zeilen, die mit „C" beginnen, werden gesammelt (sonst lösten Buchstaben im
// JSON die Ein-Zeichen-Befehle aus). true = Zeichen verbraucht.
bool cfgZeichen(char c) {
  static String zeile;
  static bool sammeln = false;
  if (!sammeln) {
    if (c != 'C') return false;
    sammeln = true;
    zeile = "C";
    return true;
  }
  if (c == '\n') { sammeln = false; zeile.trim(); seriellCfg(zeile); zeile = ""; return true; }
  if (c != '\r' && zeile.length() < 700) zeile += c;
  return true;
}

// ── Tiefschlaf (Akkubetrieb) ─────────────────────────────
// Am USB nie (dort laufen CFG und Bildabruf über das Kabel, und Strom ist da).
// Sonst nach dem Takt schlafen bis zum nächsten, ausser kurz nach einem
// Tastendruck oder solange eine Taste noch gedrückt ist.
bool schlafenErlaubt() {
  if (configMode || tasteJetzt || tasteSpanne || tasteSetup) return false;
  if (letzteTasteMs && millis() - letzteTasteMs < WACH_NACH_TASTE_MS) return false;
  for (uint8_t pin : WECK_PINS) {
    pinMode(pin, INPUT_PULLUP);
    if (digitalRead(pin) == LOW) return false;
  }
#ifndef SCHLAF_AM_USB
  if (usbStrom()) return false;
#endif
  return true;
}

void schlafe() {
  const unsigned long takt = (unsigned long)ACTIVE_INTERVAL * 1000UL;
  const unsigned long seit = millis() - lastUpdate;
  const unsigned long ms = seit < takt - 1000 ? takt - seit : 1000;
  Serial.printf("[SCHLAF] %lu s bis zum naechsten Takt\n", ms / 1000);
  seriellAusgeben();

  // Zeitstempel um die Wach- plus Schlafzeit zurücksetzen: nach dem Aufwachen
  // beginnt millis() bei 0, millis() - ts ergibt so weiter das wahre Alter.
  const unsigned long dt = millis() + ms;
  if (lastOkMs) { lastOkMs -= dt; if (!lastOkMs) lastOkMs = 1; }
  if (kursPause) kursPauseAb -= dt;

  WiFi.disconnect(true);
  if (epdBereit) EPD_3IN97_Sleep();          // Tiefschlaf des Panels, RAM bleibt (Modus 1)
  // CS des Panels hoch halten (RTC-Pin, Halten geht im Tiefschlaf). Kein
  // gpio_deep_sleep_hold_en(): das friert ALLE digitalen Pads ein, auch die
  // Tasten — ext1 kann sie dann nicht auf RTC umschalten, keine Taste weckt.
  // RST (GPIO46, kein RTC-Pin) bleibt frei: vor jedem Bild kommt ohnehin ein Reset.
  digitalWrite(EPD_CS_PIN, HIGH);
  gpio_hold_en((gpio_num_t)EPD_CS_PIN);

  // Tasten wecken (aktiv LOW); Pull-ups auch im Schlaf
  uint64_t maske = 0;
  esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
  for (uint8_t pin : WECK_PINS) {
    rtc_gpio_pullup_en((gpio_num_t)pin);
    rtc_gpio_pulldown_dis((gpio_num_t)pin);
    maske |= 1ULL << pin;
  }
  esp_sleep_enable_ext1_wakeup(maske, ESP_EXT1_WAKEUP_ANY_LOW);
  esp_sleep_enable_timer_wakeup((uint64_t)ms * 1000ULL);
  esp_deep_sleep_start();
}

void loop() {
  // Seriell (nur am USB-Kabel, also lokal): „B" schickt das Bild, „T" die Tasten-Pegel, „D0".."D3"
  // stellt die Ausrichtung um und zeichnet neu — für die Kontrolle am Rechner;
  // „CFG …" richtet WLAN, Server und Schlüssel ein (siehe seriellCfg).
  // Alles Anstehende auf einmal lesen: eine CFG-Zeile hat ein paar hundert Zeichen.
  while (Serial.available()) {
    int c = Serial.read();
    if (cfgZeichen((char)c)) continue;
    if (c == 'B' || c == 'b') sendeBild();
    if (c == 'T' || c == 't') {                 // Tasten-Pegel (1 = offen, 0 = gedrückt)
      Serial.printf("[TASTEN] BOOT %d  Druck %d  hoch %d  runter %d\n",
                    digitalRead(BOOT_TASTE_PIN), digitalRead(WIPPE_DRUCK_PIN),
                    digitalRead(WIPPE_HOCH_PIN), digitalRead(WIPPE_RUNTER_PIN));
    }
    if ((c == 'D' || c == 'd') && !configMode) {
      unsigned long t = millis();
      while (!Serial.available() && millis() - t < 500) delay(5);
      int d = Serial.read() - '0';
      if (d >= 0 && d <= 3) {
        cfgDrehung = d;
        prefs.begin(PREF_NAMESPACE, false);
        prefs.putUChar("dreh", cfgDrehung);
        prefs.end();
        bild.setRotation(cfgDrehung);
        zeichneDashboard();
        zeige(true);
        Serial.printf("[DREH] %d\n", d);
      }
    }
  }
  if (configMode) {
    server.handleClient();
    if (setupMitKonfig && millis() - portalAktivMs > SETUP_TIMEOUT_MS) {
      Serial.println("[AP] Setup-Zeitlimit, Neustart");
      delay(100);
      ESP.restart();
    }
    delay(2);
    return;
  }

  if (tasteSetup) {
    tasteSetup = false;
    Serial.println("[TASTE] Setup per BOOT-Taste");
    starteSetupModus("Per BOOT-Taste geoeffnet");
    return;
  }
  bool jetzt = tasteJetzt;
  if (jetzt) { tasteJetzt = false; Serial.println("[TASTE] sofort auffrischen"); }

  // Wippe hoch/runter: nur den Chart neu holen, Teilauffrischung
  int8_t sp = tasteSpanne;
  if (sp && cfgChart) {
    tasteSpanne = 0;
    String vorher = cfgSpanne;
    wechsleSpanne(sp);
    Serial.printf("[TASTE] Zeitraum %s\n", cfgSpanne.c_str());
    if (cfgSpanne != vorher) {
      kursOkMs = 0;                   // 30-Tage-Drossel umgehen: neuer Zeitraum, neuer Abruf
      ensureWiFi();
      holeKurs();
      zeichneDashboard();
      zeige(true);                    // voll: der Wechsel soll deutlich sichtbar sein
    }
  } else if (sp) {
    tasteSpanne = 0;
  }

  if (jetzt || millis() - lastUpdate >= (unsigned long)ACTIVE_INTERVAL * 1000) {
    ensureWiFi();
    // Erst alles holen, dann einmal zeichnen — eine Auffrischung je Takt.
    // Ohne /display (Server weg) die Beiwerk-Abrufe sparen: sie liefen nur
    // in dieselbe Zeitüberschreitung, der Chart bleibt stehen.
    if (fetchData()) holeZusatz();
    zeichneDashboard();   // auch bei Fehlschlag: alter Stand mit Altersbalken
    zeige(jetzt);         // Tastendruck: volle Auffrischung (räumt Geisterbilder weg)
    lastUpdate = millis();
  }
  if (schlafenErlaubt()) schlafe();
  delay(200);
}
