// AutarkTrade-Anzeige für den ESP32-2432S028 (CYD, ILI9341 240×320, Touch XPT2046).
// Zeigt Dashboard, Positionen/Bots, Kurs-Chart und Info aus /api/esp32/display
// bzw. /api/esp32/kurs. Ausrichtung im Setup-Portal wählbar (Quer-/Hochformat,
// je 180° gedreht), der Touch rechnet die Lage mit.
// Bewusst KEINE Chart-Alarme (seit 3.7.0 entfernt): dafür gibt es Desklet und
// Handy, der Anzeige-Schlüssel hat auf /api/esp32/alarme keinen Zugang (401).
// Über USB (115200 Bd): „B" = Bildschirmfoto als Hex, „D0".."D3" = Ausrichtung,
// „P0".."P3" = Seite — nur zur Kontrolle am Rechner.

#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <vector>
#include "esp_sleep.h"
#include "driver/gpio.h"

// ── Touch auf separatem SPI-Bus (CYD-Besonderheit) ───────
#define TOUCH_MOSI 32
#define TOUCH_MISO 39
#define TOUCH_SCK  25
#define TOUCH_CS_PIN 33
#define TOUCH_IRQ_PIN 36

SPIClass touchSPI(HSPI);
XPT2046_Touchscreen ts(TOUCH_CS_PIN, TOUCH_IRQ_PIN);

// ── Konstanten ───────────────────────────────────────────

#define AP_SSID             "AutarkTrade-Setup"
#define ACTIVE_INTERVAL     10        // Sekunden zwischen Updates wenn aktiv
#define STANDBY_TIMEOUT     30        // Sekunden ohne Touch → Backlight aus
#define LIGHT_SLEEP_TIMEOUT 60        // Sekunden ohne Touch → Light Sleep + WiFi aus
#define BOOT_GRACE_MS    300000       // 5 Min nach Boot kein Light Sleep (für Flash-Vorgang)
#define PREF_NAMESPACE      "tjcfg"
#define AP_NAMESPACE        "tjap"    // eigener Namensraum: das AP-Passwort überlebt /reset
#define WIFI_MAX_FEHLVERSUCHE 3       // so viele Boots ohne WLAN, dann Setup-AP statt Neustartschleife
#define SETUP_TIMEOUT_MS    600000    // Setup mit vorhandener Konfiguration: nach 10 Min neu versuchen
#define SETUP_FENSTER_MS    2000      // Fenster nach dem Boot, in dem die Setup-Geste beginnen kann
#define SETUP_HALTEN_MS     3000      // so lange Bildschirm bzw. BOOT-Taste halten
#define BOOT_TASTE_PIN      0         // BOOT-Taste (GPIO0, beide Boards), nach dem Start frei lesbar
#define VERALTET_AB_MS      (3UL * ACTIVE_INTERVAL * 1000UL)   // drei Abrufintervalle ohne Erfolg
#define WIFI_TIMEOUT_MS     12000
#define DISPLAY_ROTATION    3         // Querformat (Standard, cfgDreh 0) — so wie bis 3.6
#define TFT_BL_PIN          21        // Backlight-Pin ESP32-2432S028 (CYD)
#define FW_VERSION          "3.8.2-CYD"
#define NAV_H               33        // Höhe der Reiterleiste (unten, in jeder Lage)

// Nebenabruf /kurs: eigene, kurze Zeitlimits. Seine Fehler zählen NICHT für
// den WLAN-Fehlerzähler, „veraltet" oder den Setup-Modus — ein älterer Server
// kennt /kurs nicht.
#define NEBEN_TIMEOUT_MS      5000
#define NEBEN_PAUSE_MS        600000  // nach 400/401/404/429: 10 Min Ruhe (Sperrzähler des Servers schonen)
#define SCREEN_CHART          3       // Reiter-Nummer der Chart-Seite (0..2 wie bisher)
#define MAX_KERZEN            200
#define CHART_N_KERZEN        85      // ~ Chartbreite/3 bei Kerzen (Querformat)
#define CHART_N_KERZEN_HOCH   55      // dito im Hochformat (schmalere Zeichenfläche)
#define CHART_N_LINIE         130     // ~ Chartbreite/2 bei Linie

// ── Farben RGB565 — Tokens der AutarkTrade-Web-App ───────────────────────
// Umgerechnet r>>3 | g>>2 | b>>3; die Namen bleiben, damit der Zeichencode
// unverändert passt. Hex dahinter = Token der Web-App.
#define COLOR_BG         0x0041   // #05080a  bg
#define COLOR_CARD       0x0882   // #0c1216  panel
#define COLOR_GREEN      0x3DF1   // #3fbf8f  good
#define COLOR_RED        0xE2A9   // #e0574c  bad
#define COLOR_WHITE      0xEFBE   // #e8f4f6  text
#define COLOR_WHITE_DIM  0x8D35   // #8ea5af  muted
#define COLOR_GREY       0x5BB0   // #5e7580  muted, dunkler (Beschriftungen)
#define COLOR_GREY_DARK  0x1946   // #1d2b33  line
#define COLOR_YELLOW     0xDD07   // #d8a33a  warn
#define COLOR_BLUE       0x1EB8   // #1fd6c4  accent
#define COLOR_BLUE_NAV   0x1EB8   // #1fd6c4  accent (aktiver Reiter, Rahmen)
#define COLOR_NAV_BG     0x0882   // #0c1216  panel
#define COLOR_HEADER_BG  0x0882   // #0c1216  panel
#define COLOR_NAV_AKTIV  0x0945   // #0a2a28  accent sehr dunkel (aktiver Reiter)
#define COLOR_KERN       0x0103   // #04201d  Kern der Blüte im Logo

void drawMarke(int cx, int cy, int r);   // Logo-Blüte, unten bei SCREEN 2

// ── Globals ──────────────────────────────────────────────

TFT_eSPI  tft;
WebServer server(80);
Preferences prefs;

String cfgSSID, cfgPass, cfgHost, cfgPort, cfgKey;
String cfgFilter = "month";       // "month", "week", "year", "all"
// Anzeige-Einstellungen (Setup-Portal, PnL-% auch per Touch)
bool   cfgPnlProzent = false;     // PnL relativ zur Marge (ROE) statt USDT
bool   cfgBotUsdt    = false;     // Bot-Beträge bei Coin-M × markPrice in USDT
bool   cfgChartAn    = true;      // eigener Reiter „Chart"
String cfgChartSym   = "BTC";     // Server ergänzt USDT
String cfgChartSpanne = "24h";    // 1h | 24h | 7d | 30d
bool   cfgChartKerzen = false;    // false = Linie, true = Kerzen
uint8_t cfgDreh      = 0;         // 0 Querformat, 1 Hochformat, 2 Quer 180°, 3 Hoch 180°
bool    cfgInvert    = true;      // Farben umkehren: Micro-USB-CYD ja, USB-C-CYD nein
bool   configMode  = false;
const char* setupGrund = nullptr; // Text unten im Setup-Schirm (für Neuzeichnen nach D0..D3)
int    activeScreen = 0;          // 0 = Dashboard, 1 = Positionen, 2 = Info, 3 = Chart
unsigned long lastUpdate    = 0;
unsigned long lastTouchTime = 0;
bool          inStandby     = false;
unsigned long lastOkMs     = 0;      // millis() des letzten erfolgreichen Abrufs (0 = noch keiner)

// Setup-Portal (SEC-ESP-001/002): läuft NUR im Setup-Modus, nie im Heimnetz.
String formToken;                     // pro Boot zufällig, Pflicht für POST /save und /reset
String apPass;                        // WPA2-Passwort des Setup-AP, je Gerät zufällig, auf dem Display
bool   setupMitKonfig = false;        // Setup bei vorhandener Konfiguration → Zeitlimit, dann Neustart
unsigned long portalAktivMs = 0;      // letzte Anfrage ans Portal

void setBacklight(bool on) {
  ledcWrite(0, on ? 800 : 0);
}

void backlightInit() {
  ledcSetup(0, 20000, 10);
  ledcAttachPin(TFT_BL_PIN, 0);
  ledcWrite(0, 800);
}

// ── Light Sleep mit WiFi aus, Wakeup über XPT2046 PENIRQ (GPIO 36) ──
// Blockiert bis Touch oder 30 Min Timer. PENIRQ ist active-low.
// GPIO 36 ist input-only (RTC GPIO), externer Pullup auf dem CYD-Board.
void enterLightSleep() {
  Serial.println("[PWR] Light Sleep — WiFi aus, Wakeup via Touch oder 30min Timer");
  Serial.flush();

  setBacklight(false);
  gpio_hold_en((gpio_num_t)TFT_BL_PIN);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  pinMode(TOUCH_IRQ_PIN, INPUT);
  gpio_wakeup_enable((gpio_num_t)TOUCH_IRQ_PIN, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  esp_sleep_enable_timer_wakeup(30ULL * 60ULL * 1000000ULL);

  esp_light_sleep_start();

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  gpio_hold_dis((gpio_num_t)TFT_BL_PIN);
  Serial.printf("[PWR] Wake from Light Sleep — cause=%d (7=GPIO, 4=Timer)\n", cause);

  // LEDC nach Sleep neu attachen — gpio_hold + Sleep können den Pin-Mux verlieren
  backlightInit();

  WiFi.mode(WIFI_STA);
  WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
}

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
  float  margin;          // vom Server, falls geliefert; sonst 0 → aus Einstieg/Menge/Hebel
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
  bool   coinM;
  float  margin;          // in marginCoin; 0 = unbekannt (älterer Server) → „-"
  float  gridProfit;      // realisierter Grid-Gewinn in marginCoin
  bool   hasGrid;         // false = null bzw. Feld fehlt → „-"
};

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
  // Filter kommt vom Server — nicht aus NVS laden
  cfgFilter = "month";
  cfgPnlProzent  = prefs.getBool("pnlpct",  false);
  cfgBotUsdt     = prefs.getBool("botusdt", false);
  cfgChartAn     = prefs.getBool("chart",   true);
  cfgChartSym    = prefs.getString("csym",  "BTC");
  cfgChartSpanne = prefs.getString("cspan", "24h");
  cfgChartKerzen = prefs.getBool("ckerzen", false);
  cfgDreh        = prefs.getUChar("dreh",   0);
  if (cfgDreh > 3) cfgDreh = 0;
  cfgInvert      = prefs.getBool("inv",     true);
  prefs.end();
}

// Anzeige-Einstellungen aus dem Portal bzw. per Touch umgeschaltet.
void saveAnzeige() {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putBool("pnlpct",    cfgPnlProzent);
  prefs.putBool("botusdt",   cfgBotUsdt);
  prefs.putBool("chart",     cfgChartAn);
  prefs.putString("csym",    cfgChartSym);
  prefs.putString("cspan",   cfgChartSpanne);
  prefs.putBool("ckerzen",   cfgChartKerzen);
  prefs.putUChar("dreh",     cfgDreh);
  prefs.putBool("inv",       cfgInvert);
  if (prefs.isKey("alarme")) prefs.remove("alarme");   // Rest aus 3.6 (Chart-Alarme gibt es nicht mehr)
  prefs.end();
}

// Nur Grossbuchstaben und Ziffern, höchstens 20 Zeichen; leer → BTC.
String saubereSymbol(String s) {
  s.trim(); s.toUpperCase();
  String o;
  for (size_t i = 0; i < s.length() && o.length() < 20; i++)
    if (isAlphaNumeric((unsigned char)s[i])) o += s[i];
  return o.length() >= 2 ? o : String("BTC");
}

bool gueltigeSpanne(const String& s) {
  return s == "1h" || s == "24h" || s == "7d" || s == "30d";
}

void saveFilter() {
  // Filter wird vom Server gesteuert, kein lokales Speichern nötig
}

void saveConfig(String ssid, String pass, String host, String port, String key) {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("host", host);
  prefs.putString("port", port);
  prefs.putString("key",  key);
  prefs.putUChar("wfail", 0);
  prefs.end();
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

// ── Ausrichtung ──────────────────────────────────────────
// cfgDreh 0..3 = Querformat, Hochformat, Querformat 180°, Hochformat 180°.
// TFT_eSPI-Rotation: (DISPLAY_ROTATION + cfgDreh) % 4 → 3, 0, 1, 2. Jede
// Rotation +2 ist dieselbe Lage um 180° gedreht (MADCTL MX/MY gekippt).

const char* DREH_NAME[4] = {"Querformat", "Hochformat", "Querformat 180 Grad", "Hochformat 180 Grad"};

uint8_t drehRotation(uint8_t dreh) {
  return (DISPLAY_ROTATION + dreh) % 4;
}

// Nach setRotation() die Farbumkehr setzen: der Micro-USB-CYD braucht sie, die
// USB-C-Bauart nicht (sonst heller Hintergrund statt dunkel). Einstellbar im
// Portal, über USB mit „I0"/„I1" und in der CFG-Zeile („invert").
void wendeDrehungAn() {
  tft.setRotation(drehRotation(cfgDreh));
  tft.invertDisplay(cfgInvert);
}

bool hochformat() { return tft.height() > tft.width(); }
int  navY()       { return tft.height() - NAV_H; }   // Oberkante der Reiterleiste (Quer 207, Hoch 287)

// ── Touch (XPT2046 auf separatem HSPI-Bus) ──────────────
// Rohwerte ~220..3800. Bezugsrahmen ist die Rotation 0 des Displays (240×320,
// u nach rechts, v nach unten): u folgt raw.x, v folgt raw.y — abgeleitet aus
// der auf dem Gerät eingemessenen Querformat-Umrechnung (Rotation 3:
// x = map(raw.y, 3800, 220, 0, 320), y = map(raw.x, 220, 3800, 0, 240)).
// Von (u, v) auf die Bildschirmlage wie TFT_eSPI dreht (ILI9341, MADCTL):
//   Rotation 0: x = u,        y = v
//   Rotation 1: x = v,        y = 239 - u
//   Rotation 2: x = 239 - u,  y = 319 - v
//   Rotation 3: x = 319 - v,  y = u          (= bisherige feste Umrechnung)

bool mapTouch(int* screenX, int* screenY) {
  if (!ts.tirqTouched() || !ts.touched()) return false;
  TS_Point p = ts.getPoint();
  int u = constrain(map(p.x, 220, 3800, 0, 240), 0, 239);
  int v = constrain(map(p.y, 220, 3800, 0, 320), 0, 319);
  int sx, sy;
  switch (tft.getRotation() & 3) {
    case 0:  sx = u;       sy = v;       break;
    case 1:  sx = v;       sy = 239 - u; break;
    case 2:  sx = 239 - u; sy = 319 - v; break;
    default: sx = 319 - v; sy = u;       break;
  }
  sx = constrain(sx, 0, tft.width() - 1);
  sy = constrain(sy, 0, tft.height() - 1);
  *screenX = sx;
  *screenY = sy;
  Serial.printf("[Touch] raw=(%d,%d) z=%d → (%d,%d)\n", p.x, p.y, p.z, sx, sy);
  return true;
}

// ── Hilfsfunktionen Display ──────────────────────────────

String fmtMoney(float v, int dec = 2) {
  String s = (v >= 0 ? "+" : "") + String(v, dec);
  return s;
}

String fmtVol(long v) {
  if (v >= 1000000) return String(v / 1000000.0f, 1) + "M";
  if (v >= 1000)    return String(v / 1000.0f, 1) + "K";
  return String(v);
}

uint16_t pnlColor(float v) {
  return v >= 0 ? COLOR_GREEN : COLOR_RED;
}

// ── PnL in Prozent der Marge (wie der ROE der Börse, vgl. Desklet _marge) ──
// Position: Feld margin, sonst Einstieg × |Menge| ÷ Hebel; 0 = unbekannt.
float margePos(const Position& p) {
  if (p.margin > 0) return p.margin;
  float q = fabsf(p.qty);
  return (p.entryPrice > 0 && q > 0 && p.leverage > 0) ? p.entryPrice * q / p.leverage : 0.0f;
}

// „+12.34 %" bezogen auf die Marge, „-" ohne Marge (Desklet _prozentText).
String prozentText(float betrag, float marge) {
  if (!(marge > 0)) return "-";
  char s[20];
  snprintf(s, sizeof(s), "%+.2f %%", betrag / marge * 100.0f);
  return String(s);
}

// Betrag mit Vorzeichen; Nachkommastellen werden gekürzt, bis der Text in
// maxZeichen passt (feste Spaltenbreite, 6 px je Zeichen).
String betragText(float v, int maxStellen, const String& suffix, int maxZeichen) {
  char s[28];
  for (int d = maxStellen; d >= 0; d--) {
    snprintf(s, sizeof(s), "%+.*f%s", d, v, suffix.c_str());
    if ((int)strlen(s) <= maxZeichen) break;
  }
  return String(s);
}

// Bot-Beträge: in marginCoin, oder (Schalter) × markPrice = USDT je Coin.
// Prozente ändern sich dadurch nicht (Betrag und Marge mit gleichem Faktor).
float botFaktor(const Bot& b, String& coin) {
  coin = b.marginCoin.length() ? b.marginCoin : String("USDT");
  if (cfgBotUsdt && coin != "USDT" && b.markPrice > 0) { coin = "USDT"; return b.markPrice; }
  return 1.0f;
}

// Höchstens n Zeichen, sonst gekürzt mit „..".
String kuerze(const String& s, int n) {
  if ((int)s.length() <= n) return s;
  return s.substring(0, n - 2) + "..";
}

// Kurs lesbar: ab 1000 eine Nachkommastelle, ab 1 drei, darunter 4 gültige Stellen.
String preisText(float v) {
  char s[20];
  if (v >= 1000)   snprintf(s, sizeof(s), "%.1f", v);
  else if (v >= 1) snprintf(s, sizeof(s), "%.3f", v);
  else if (v > 0) {
    int d = constrain(3 - (int)floorf(log10f(v)), 1, 8);
    snprintf(s, sizeof(s), "%.*f", d, v);
  } else snprintf(s, sizeof(s), "%.2f", v);
  return String(s);
}

void fillCard(int x, int y, int w, int h) {
  tft.fillRoundRect(x, y, w, h, 6, COLOR_CARD);
  tft.drawRoundRect(x, y, w, h, 6, COLOR_GREY_DARK);
}

// ── Nav-Bar (unten, h=33: Querformat y=207, Hochformat y=287) ──
// Reiter gleich breit: Dashboard | Positionen | [Chart] | Info.
// „Chart" nur, wenn im Setup-Portal eingeschaltet (Quer 4 × 80 px bzw. 3 × ~107 px,
// Hoch 4 × 60 px bzw. 3 × 80 px — dort wird „Positionen" zu „Pos.").

int navReiter(int* ids) {
  int n = 0;
  ids[n++] = 0;
  ids[n++] = 1;
  if (cfgChartAn) ids[n++] = SCREEN_CHART;
  ids[n++] = 2;
  return n;
}

const char* reiterName(int id) {
  return id == 0 ? "Dashboard" : id == 1 ? "Positionen" : id == SCREEN_CHART ? "Chart" : "Info";
}

// Reiter unter dem Finger (x in px).
int reiterBei(int x) {
  int ids[4];
  int n = navReiter(ids);
  return ids[constrain(x * n / tft.width(), 0, n - 1)];
}

void drawNavBar() {
  const int ny = navY(), nh = NAV_H;
  const int W  = tft.width();
  int ids[4];
  int n  = navReiter(ids);
  int bw = W / n;

  tft.fillRect(0, ny, W, nh, COLOR_NAV_BG);
  // Blauer Trennstrich oben (App-Stil)
  tft.drawFastHLine(0, ny, W, COLOR_BLUE_NAV);
  tft.setTextSize(1);

  for (int i = 0; i < n; i++) {
    int x0 = i * bw;
    int w  = (i == n - 1) ? W - x0 : bw;
    if (i > 0) tft.drawFastVLine(x0, ny + 1, nh - 1, COLOR_GREY_DARK);
    bool aktiv = activeScreen == ids[i];
    if (aktiv) {
      tft.fillRect(x0 + 1, ny + 1, w - 2, nh - 1, COLOR_NAV_AKTIV);   // leicht blau-dunkel aktiv
      tft.drawFastHLine(x0 + 1, ny, w - 2, COLOR_BLUE);                 // blauer Indikator-Strich
    }
    const char* name = reiterName(ids[i]);
    if ((int)strlen(name) * 6 > w - 4) name = ids[i] == 1 ? "Pos." : "Dash";   // schmale Reiter (Hochformat)
    tft.setTextColor(aktiv ? COLOR_WHITE : COLOR_GREY, aktiv ? COLOR_NAV_AKTIV : COLOR_NAV_BG);
    tft.setCursor(x0 + (w - (int)strlen(name) * 6) / 2, ny + 12);
    tft.print(name);
  }

  // Offline-Indikator: kleiner roter Punkt rechts unten wenn Daten fehlen oder veraltet sind
  if (!data.valid || datenVeraltet()) {
    tft.fillCircle(W - 7, ny + 26, 4, COLOR_RED);
  }
}

// ── Donut-Chart ──────────────────────────────────────────

void drawDonut(int cx, int cy, int r, int ir, float pct, uint16_t color,
               const char* label, const char* valStr) {
  // Grauer Hintergrunds-Ring
  tft.drawSmoothArc(cx, cy, r, ir, 0, 360, COLOR_GREY_DARK, COLOR_BG, true);

  // Farbiger Fortschritts-Arc (0° = oben, gegen Uhrzeigersinn)
  float angle = constrain(pct / 100.0f * 360.0f, 0, 360);
  if (angle > 1.0f)
    tft.drawSmoothArc(cx, cy, r, ir, 0, angle, color, COLOR_BG, true);

  // Wert in der Mitte
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setTextSize(1);
  int vw = strlen(valStr) * 6;
  tft.setCursor(cx - vw / 2, cy - 4);
  tft.print(valStr);

  // Label darunter
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  int lw = strlen(label) * 6;
  tft.setCursor(cx - lw / 2, cy + r + 4);
  tft.print(label);
}

// ── SCREEN 1: Dashboard (Quer 320×207, Hoch 240×287) ─────
// Hochformat: Kontostand-Karte etwas höher (Perf neben dem Betrag), die drei
// Donuts in einer Reihe (je 80 px) mittig im freien Rest.

void drawScreen1() {
  const int W = tft.width(), NY = navY();
  const bool hoch = hochformat();
  tft.fillRect(0, 0, W, NY, COLOR_BG);

  // ── Banner, wenn keine oder alte Daten (FUN-GER-001) ───
  // Nach einem Fehlschlag bleibt der letzte Stand stehen — dann muss sein
  // Alter sichtbar sein, sonst sehen Stunden alte Positionen aktuell aus.
  bool banner = !data.valid || datenVeraltet();
  if (banner) {
    tft.fillRoundRect(4, 2, W - 8, 20, 4, COLOR_RED);
    tft.setTextColor(COLOR_WHITE, COLOR_RED);
    tft.setTextSize(1);
    tft.setCursor(8, 8);
    String t = lastOkMs == 0 ? String("OFFLINE - keine Daten vom Server")
                             : "VERALTET - Stand vor " + alterText() + ", Server nicht erreicht";
    if ((int)t.length() * 6 > W - 16)
      t = lastOkMs == 0 ? String("OFFLINE - keine Daten") : "VERALTET - Stand vor " + alterText();
    tft.print(t);
  }

  // ── Kontostand-Karte ──────────────────────────────
  // Mit Banner kompakter (bis 3.6 stand die Heute-Zeile dann unter der
  // 38 px hohen Karte und überdeckte „Vol 30d").
  int cardY = banner ? 26 : 2;
  int cardH = banner ? 52 : 62;
  int heuteY = cardY + (banner ? 39 : 48);
  fillCard(4, cardY, W - 8, cardH);

  // Label + Filter
  drawMarke(17, cardY + 10, 6);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(28, cardY + 7);
  tft.print(data.hasBalance ? "KONTOSTAND" : "P&L GESAMT");

  const char* fLbl = cfgFilter == "month" ? "Monat" :
                     cfgFilter == "week"  ? "Woche" :
                     cfgFilter == "year"  ? "Jahr"  : "Alle";
  tft.setTextColor(COLOR_YELLOW, COLOR_CARD);
  int fLblX = W - 16 - (int)strlen(fLbl) * 6;
  tft.setCursor(fLblX, cardY + 7);
  tft.print(fLbl);

  if (data.hasBalance) {
    String balStr = "$" + String(data.balance, 2);
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, cardY + 22);
    tft.print(balStr);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setCursor(12, heuteY);
    tft.print("Heute ");
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
    tft.print(String(data.todayTrades));
    tft.print(" T  ");
    tft.setTextColor(COLOR_GREEN, COLOR_CARD);
    tft.print(String(data.todayWins));
    tft.print("+ ");
    tft.setTextColor(COLOR_RED, COLOR_CARD);
    tft.print(String(data.todayLosses));
    tft.print("-  ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
    String perfStr = "Perf " + String((data.balancePerf >= 0 ? "+" : "")) + String(data.balancePerf, 1) + "%";
    tft.setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    // Quer: rechts in der Heute-Zeile wie bisher. Hoch: dort ist kein Platz → rechts neben dem Betrag.
    if (hoch) tft.setCursor(W - 12 - (int)perfStr.length() * 6, cardY + 26);
    else      tft.setCursor(220, heuteY);
    tft.print(perfStr);
  } else {
    String totStr = (data.totalPnL >= 0 ? "+" : "") + String(data.totalPnL, 2) + " USDT";
    tft.setTextColor(pnlColor(data.totalPnL), COLOR_CARD);
    tft.setTextSize(2);
    tft.setCursor(12, cardY + 22);
    tft.print(totStr);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setCursor(12, heuteY);
    tft.print("Heute ");
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
    tft.print(String(data.todayTrades));
    tft.print(" T  ");
    tft.setTextColor(COLOR_GREEN, COLOR_CARD);
    tft.print(String(data.todayWins));
    tft.print("+ ");
    tft.setTextColor(COLOR_RED, COLOR_CARD);
    tft.print(String(data.todayLosses));
    tft.print("-  ");
    tft.setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
    tft.print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
  }

  // ── Volumen (kompakt, 2 Zeilen) ───────────────────
  int volY = cardY + cardH + 4;
  tft.drawFastHLine(0, volY, W, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(8, volY + 5);
  tft.print("Vol 30d");
  String v30 = "$" + fmtVol(data.volume30d);
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft.setCursor(W - 4 - (int)v30.length() * 6, volY + 5);
  tft.print(v30);

  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(8, volY + 17);
  tft.print("Vol Total");
  String vtot = "$" + fmtVol(data.volumeTotal);
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft.setCursor(W - 4 - (int)vtot.length() * 6, volY + 17);
  tft.print(vtot);

  // ── Trennlinie vor Donuts ─────────────────────────
  int donutY = volY + 30;
  tft.drawFastHLine(0, donutY, W, COLOR_GREY_DARK);

  // ── 3 Donuts: Quer bei x 55/160/265, Hoch je 80 px (40/120/200), dort mittig im Rest ──
  const int r = 34, ir = 23;
  int cy = hoch ? donutY + (NY - donutY) / 2 - 6 : donutY + 46;
  int dx[3];
  if (hoch) { dx[0] = W / 6; dx[1] = W / 2; dx[2] = W * 5 / 6; }
  else      { dx[0] = 55;    dx[1] = 160;   dx[2] = 265; }

  char wrStr[10];
  snprintf(wrStr, sizeof(wrStr), "%.0f%%", data.winRate);
  uint16_t wrCol = data.winRate >= 50 ? COLOR_GREEN : (data.winRate >= 40 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(dx[0], cy, r, ir, data.winRate, wrCol, "Win Rate", wrStr);

  char satStr[10];
  snprintf(satStr, sizeof(satStr), "%.0f%%", data.satisfaction);
  uint16_t satCol = data.satisfaction >= 50 ? COLOR_GREEN : (data.satisfaction >= 30 ? COLOR_YELLOW : COLOR_RED);
  drawDonut(dx[1], cy, r, ir, data.satisfaction, satCol, "Zufried.", satStr);

  char rrrStr[12];
  snprintf(rrrStr, sizeof(rrrStr), "1:%.1f", data.rrr);
  float rrrPct = constrain(data.rrr / 3.0f * 100.0f, 0, 100);
  uint16_t rrrCol = data.rrr >= 1.5f ? COLOR_GREEN : (data.rrr >= 1.0f ? COLOR_YELLOW : COLOR_RED);
  drawDonut(dx[2], cy, r, ir, rrrPct, rrrCol, "RRR", rrrStr);
}

// ── Logo-Marke: die Blüte aus dem AutarkTrade-Zeichen, vereinfacht ────
// Fünf Blätter als Kreise um die Mitte, dunkler Kern mit Akzentrand. Der
// Kursring des grossen Zeichens verschwimmt bei 18 px — er fehlt hier bewusst.
void drawMarke(int cx, int cy, int r) {
  const float blatt = r * 0.42f;
  const float abstand = r * 0.55f;
  for (int i = 0; i < 5; i++) {
    float w = (-90.0f + i * 72.0f) * DEG_TO_RAD;
    tft.fillCircle(cx + (int)roundf(cosf(w) * abstand), cy + (int)roundf(sinf(w) * abstand),
                   (int)roundf(blatt), COLOR_BLUE);
  }
  tft.fillCircle(cx, cy, max(1, r / 4), COLOR_KERN);
  tft.drawCircle(cx, cy, max(1, r / 4), COLOR_BLUE);
}

// ── SCREEN 2: Offene Positionen (Quer 320×207, Hoch 240×287) ──
// Spalten je Format (x in px, 6 px je Zeichen):
//   Quer  Futures: Symbol 4 | Side 72 | Heb. 104 | unr. PnL 140 | real. PnL 228
//         Bots:    Symbol 4 | Side 60 | Heb. 88  | PnL 118 | Grid 190 | Liq 262
//   Hoch  Futures: Symbol 4 | S 50 (L/S) | Heb 60 | PnL 90 | real. 168
//         Bots:    Symbol 4 | S 50 (L/S) | PnL 60 | Grid 132 | Liq 202  (ohne Hebel)
// Zeilen: so viele, wie bis zur Fusszeile passen (Quer 7, Hoch 11).
// Tipp auf Kopf/Tabellenkopf (y < 46): PnL in USDT ↔ % der Marge (gespeichert).

struct PosSpalten {
  int side, heb, pnl, real; int pnlZ, realZ;           // Futures
  int bSide, bHeb, bPnl, bGrid, bLiq; int bZ, liqZ;    // Bots (bHeb < 0 = keine Spalte)
  bool kurzSeite;                                       // „L"/„S" statt „BUY"/„SELL"
};

PosSpalten posSpalten() {
  if (hochformat()) return {50, 60, 90, 168, 12, 11,   50, -1, 60, 132, 202, 11, 6,  true};
  return                   {72, 104, 140, 228, 14, 14,  60, 88, 118, 190, 262, 11, 9, false};
}

bool istLong(const String& side) { return side == "BUY" || side == "LONG"; }

String seiteText(const String& side, bool kurz) {
  if (kurz) return istLong(side) ? "L" : "S";
  return side.substring(0, 4);
}

// Liq-Kurs: Nachkommastellen wie bisher (≥1000: 0, ≥1: 3, sonst 5), bei
// Platzmangel gekürzt, bis er in maxZeichen passt.
String liqText(float v, int maxZeichen) {
  int d = v >= 1000 ? 0 : v >= 1 ? 3 : 5;
  char s[20];
  for (; d >= 0; d--) {
    snprintf(s, sizeof(s), "%.*f", d, v);
    if ((int)strlen(s) <= maxZeichen) break;
  }
  return String(s);
}

void drawScreen2() {
  const int W = tft.width(), NY = navY();
  const bool hoch = hochformat();
  const PosSpalten sp = posSpalten();
  const int fussY = NY - 14;                       // Fusszeile (Quer 193)
  tft.fillRect(0, 0, W, NY, COLOR_BG);

  // ── Header ────────────────────────────────────────
  tft.fillRect(0, 0, W, 24, COLOR_HEADER_BG);
  tft.drawFastHLine(0, 24, W, COLOR_GREY_DARK);
  drawMarke(12, 12, 9);
  tft.setTextSize(1);
  tft.setCursor(26, 5);
  tft.setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft.print("Autark");
  tft.setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft.print("Trade");
  tft.setTextColor(COLOR_GREY, COLOR_HEADER_BG);
  tft.setCursor(26, 16);
  tft.print(hoch ? "Positionen" : "Offene Positionen & Bots");   // Hoch: Platz für die Summe rechts

  int nFut = data.positions.size();
  int nBot = data.bots.size();

  // ── Summe der Futures rechts im Kopf (Bots in eigener Münze, nicht summierbar) ──
  const char* modus = cfgPnlProzent ? "PnL in % [Tipp]" : "PnL USDT [Tipp]";
  tft.setTextColor(COLOR_GREY, COLOR_HEADER_BG);
  tft.setCursor(W - 6 - (int)strlen(modus) * 6, 5);
  tft.print(modus);
  if (nFut > 0) {
    float sPnl = 0, sMarge = 0;
    for (auto& p : data.positions) { sPnl += p.unrealizedPNL; sMarge += margePos(p); }
    String sTxt = "Summe " + (cfgPnlProzent ? prozentText(sPnl, sMarge) : betragText(sPnl, 2, "", 12));
    tft.setTextColor(cfgPnlProzent && !(sMarge > 0) ? COLOR_GREY : pnlColor(sPnl), COLOR_HEADER_BG);
    tft.setCursor(W - 6 - (int)sTxt.length() * 6, 16);
    tft.print(sTxt);
  }

  String version = "v" FW_VERSION;
  int versionX = W - 4 - (int)version.length() * 6;   // bis 3.6 fest bei 270 → lief rechts über den Rand

  if (nFut == 0 && nBot == 0) {
    int ym = NY / 2 + 7;                           // Quer 110
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(8, ym);
    tft.print(datenVeraltet() ? "Keine Positionen im letzten Stand" : "Keine offenen Positionen");
    if (datenVeraltet()) {
      tft.setTextColor(COLOR_RED, COLOR_BG);
      tft.setCursor(8, ym + 15);
      tft.print("VERALTET - Stand vor " + alterText());
      tft.setTextColor(COLOR_GREY, COLOR_BG);
    }
    tft.setCursor(versionX, fussY);
    tft.print(version);
    return;
  }

  // ── Tabellen-Header (y=28) ────────────────────────
  tft.drawFastHLine(0, 28, W, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(4,       32); tft.print("Symbol");
  tft.setCursor(sp.side, 32); tft.print(sp.kurzSeite ? "S" : "Side");
  tft.setCursor(sp.heb,  32); tft.print(hoch ? "Heb" : "Heb.");
  tft.setCursor(sp.pnl,  32); tft.print(cfgPnlProzent ? "PnL %" : "PnL");
  tft.setCursor(sp.real, 32); tft.print(cfgPnlProzent ? "real. %" : "real.");
  tft.drawFastHLine(0, 44, W, COLOR_GREY_DARK);

  // Zeilen-Budget: Datenzeilen à 20 px bis zur Fusszeile; die Bot-Kopfzeile
  // (16 px) kostet eine davon. Gemischt bekommt jede Art höchstens die Hälfte,
  // was eine nicht braucht, geht an die andere.
  int slots = (fussY - 4 - 47) / 20;              // Quer 7, Hoch 11
  int frei  = nBot > 0 ? slots - 1 : slots;
  int botCap = min(nBot, nFut > 0 ? frei / 2 : frei);
  int futCap = min(nFut, frei - botCap);
  botCap = min(nBot, frei - futCap);

  int y = 47;

  // ── Futures ───────────────────────────────────────
  for (int i = 0; i < futCap; i++) {
    auto& p = data.positions[i];
    float marge = margePos(p);

    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(4, y);
    String sym = p.symbol;
    if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
    if (sym.length() > 7) sym = sym.substring(0, 7);
    tft.print(sym);

    tft.setTextColor(istLong(p.side) ? COLOR_GREEN : COLOR_RED, COLOR_BG);
    tft.setCursor(sp.side, y);
    tft.print(seiteText(p.side, sp.kurzSeite));

    tft.setTextColor(COLOR_WHITE, COLOR_BG);
    tft.setCursor(sp.heb, y);
    char hebStr[8];
    snprintf(hebStr, sizeof(hebStr), "%dx", (int)p.leverage);
    tft.print(hebStr);

    String unr = cfgPnlProzent ? prozentText(p.unrealizedPNL, marge) : betragText(p.unrealizedPNL, 2, "", sp.pnlZ);
    tft.setTextColor(unr == "-" ? COLOR_GREY : pnlColor(p.unrealizedPNL), COLOR_BG);
    tft.setCursor(sp.pnl, y);
    tft.print(unr);

    tft.setCursor(sp.real, y);
    if (p.realizedPNL != 0.0f) {
      String real = cfgPnlProzent ? prozentText(p.realizedPNL, marge) : betragText(p.realizedPNL, 2, "", sp.realZ);
      tft.setTextColor(real == "-" ? COLOR_GREY : pnlColor(p.realizedPNL), COLOR_BG);
      tft.print(real);
    } else {
      tft.setTextColor(COLOR_GREY, COLOR_BG);
      tft.print("-");
    }

    tft.drawFastHLine(0, y + 15, W, COLOR_GREY_DARK);
    y += 20;
  }

  // ── Bots (PnL/Grid/Marge in marginCoin, auf Wunsch in USDT) ──
  if (botCap > 0) {
    tft.setTextColor(COLOR_BLUE, COLOR_BG);
    tft.setCursor(4, y);
    char botHdr[20];
    snprintf(botHdr, sizeof(botHdr), "BOTS (%d)", nBot);
    tft.print(botHdr);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(sp.bPnl,  y); tft.print(cfgPnlProzent ? "PnL %" : "PnL");
    tft.setCursor(sp.bGrid, y); tft.print("Grid");
    tft.setCursor(sp.bLiq,  y); tft.print("Liq");
    tft.drawFastHLine(0, y + 13, W, COLOR_GREY_DARK);
    y += 16;

    for (int i = 0; i < botCap; i++) {
      auto& b = data.bots[i];
      String coin;
      float f   = botFaktor(b, coin);
      int   dec = coin == "USDT" ? 2 : 4;
      String suffix = coin == "USDT" ? String("") : " " + coin;

      tft.setTextColor(COLOR_WHITE, COLOR_BG);
      tft.setCursor(4, y);
      String sym = b.symbol;
      if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
      if (sym.length() > 7) sym = sym.substring(0, 7);
      tft.print(sym);

      tft.setTextColor(istLong(b.side) ? COLOR_GREEN : COLOR_RED, COLOR_BG);
      tft.setCursor(sp.bSide, y);
      tft.print(seiteText(b.side, sp.kurzSeite));

      if (sp.bHeb >= 0) {
        tft.setTextColor(COLOR_WHITE, COLOR_BG);
        tft.setCursor(sp.bHeb, y);
        char hebStr[8];
        snprintf(hebStr, sizeof(hebStr), "%dx", (int)b.leverage);
        tft.print(hebStr);
      }

      float pnl = b.unrealizedPNL * f;
      String pnlTxt = cfgPnlProzent ? prozentText(pnl, b.margin * f) : betragText(pnl, dec, suffix, sp.bZ);
      tft.setTextColor(pnlTxt == "-" ? COLOR_GREY : pnlColor(pnl), COLOR_BG);
      tft.setCursor(sp.bPnl, y);
      tft.print(pnlTxt);

      tft.setCursor(sp.bGrid, y);
      if (b.hasGrid) {
        float grid = b.gridProfit * f;
        tft.setTextColor(pnlColor(grid), COLOR_BG);
        tft.print(betragText(grid, dec, suffix, sp.bZ));
      } else {
        tft.setTextColor(COLOR_GREY, COLOR_BG);
        tft.print("-");
      }

      tft.setTextColor(COLOR_GREY, COLOR_BG);
      tft.setCursor(sp.bLiq, y);
      tft.print(b.liqPrice > 0 ? liqText(b.liqPrice, sp.liqZ) : String("-"));

      tft.drawFastHLine(0, y + 15, W, COLOR_GREY_DARK);
      y += 20;
    }
  }

  // ── Footer: Alter des Stands (die Uhr läuft ohne NTP, daher kein Zeitpunkt) ──
  if (datenVeraltet()) {
    tft.fillRect(0, fussY - 4, versionX - 8, 16, COLOR_RED);
    tft.setTextColor(COLOR_WHITE, COLOR_RED);
    tft.setCursor(8, fussY);
    tft.print("VERALTET - Stand vor " + alterText());
  } else {
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(8, fussY);
    tft.print("Stand: vor " + alterText());
  }
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(versionX, fussY);
  tft.print(version);
}

// ── SCREEN 3: Info-Screen ────────────────────────────────
// Zeigt aktuellen Filter (vom Server gesteuert) + Verbindungsinfos.
// Tap → zurück zum Dashboard + Daten neu laden.
// Hochformat: lange Zeilen umgebrochen, Karten dafür höher.

void drawScreen3() {
  const int W = tft.width(), NY = navY();
  const bool hoch = hochformat();
  tft.fillRect(0, 0, W, NY, COLOR_BG);

  // Header
  tft.fillRect(0, 0, W, 22, COLOR_HEADER_BG);
  tft.drawFastHLine(0, 22, W, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setCursor(8, 7);
  tft.print("ZEITRAUM & INFO");

  // Aktiver Filter — vom Server
  fillCard(6, 30, W - 12, 52);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 40);
  tft.print("Aktiver Zeitraum (vom Server):");

  // Aktuellen Filter anzeigen
  const char* fLabel = cfgFilter == "month" ? "Aktueller Monat"  :
                       cfgFilter == "week"  ? "Aktuelle Woche"   :
                       cfgFilter == "year"  ? "Aktuelles Jahr"   : "Gesamtzeitraum";
  tft.setTextColor(COLOR_WHITE, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, 54);
  tft.print(fLabel);

  // Hinweis: Einstellung in der App
  int y2 = 92, h2 = hoch ? 52 : 40;
  fillCard(6, y2, W - 12, h2);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, y2 + 10);
  tft.print("Aendern: App");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(18, y2 + 23);
  if (hoch) {
    tft.print("Einstellungen > ESP32 Display");
    tft.setCursor(18, y2 + 36);
    tft.print("> Zeitraum");
  } else {
    tft.print("Einstellungen > ESP32 Display > Zeitraum");
  }

  // Verbindungsinfo (Hoch: zusätzlich Ausrichtung, „Tap" in eigener Zeile)
  int y3 = y2 + h2 + 10, h3 = hoch ? 80 : 54;
  fillCard(6, y3, W - 12, h3);
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setTextSize(1);
  tft.setCursor(18, y3 + 10);
  tft.print("Server:");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(72, y3 + 10);
  tft.print(kuerze(cfgHost + ":" + cfgPort, (W - 84) / 6));
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setCursor(18, y3 + 22);
  tft.print("WLAN:");
  tft.setTextColor(WiFi.status() == WL_CONNECTED ? COLOR_GREEN : COLOR_RED, COLOR_CARD);
  tft.setCursor(72, y3 + 22);
  tft.print(WiFi.status() == WL_CONNECTED ? cfgSSID.substring(0, 22) : "getrennt");
  tft.setTextColor(COLOR_GREY, COLOR_CARD);
  tft.setCursor(18, y3 + 34);
  tft.print("Firmware:");
  tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft.setCursor(80, y3 + 34);
  tft.print("v" FW_VERSION);
  if (hoch) {
    tft.setTextColor(COLOR_GREY, COLOR_CARD);
    tft.setCursor(18, y3 + 46);
    tft.print("Lage:");
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
    tft.setCursor(72, y3 + 46);
    tft.print(DREH_NAME[cfgDreh]);
    tft.setCursor(18, y3 + 62);
  } else {
    tft.setCursor(200, y3 + 34);
  }
  tft.print("Tap: Dashboard");
}

// ── SCREEN 4: Kurs-Chart (eigener Reiter, Quer 320×207, Hoch 240×287) ──
// Daten von GET /api/esp32/kurs (Anzeige-Schlüssel genügt). Zeichnung wie im
// Desklet (_zeichneChart): Linie mit dezenter Fläche bzw. Kerzen grün/rot,
// gestrichelt der Startkurs, rechts Preisachse mit runden Stufen und Marke.
// Tipp auf den Kopf: nächster Zeitraum; Tipp auf den Chart: Linie ↔ Kerzen.
// Fehler hier berühren weder data.valid noch lastOkMs noch den WLAN-Zähler.

float  kO[MAX_KERZEN], kH[MAX_KERZEN], kL[MAX_KERZEN], kC[MAX_KERZEN];   // 3.2 KB statisch
int    kAnz = 0;                     // geladene Kerzen (0 = nichts anzeigbar)
bool   kArtKerzen = false;           // Darstellung, für die geladen wurde (n unterscheidet sich)
float  kJetzt = 0, kStart = 0, kAenderung = 0;
String kSymbol, kSpanne;             // wie vom Server bestätigt
String kHinweis;                     // kurzer Hinweis (Fehler, „Lade …")
unsigned long kLetzterMs = 0;        // letzter Abrufversuch (0 = sofort fällig)
unsigned long kWarteMs   = 60000;

// Abrufabstand nach Zeitraum: 1h 30 s, 24h/7d 60 s, 30d 120 s.
unsigned long kursIntervallMs() {
  if (cfgChartSpanne == "1h")  return 30000;
  if (cfgChartSpanne == "30d") return 120000;
  return 60000;
}

bool kursFaellig() {
  return kLetzterMs == 0 || millis() - kLetzterMs >= kWarteMs;
}

void holeKurs() {
  kLetzterMs = millis();
  if (kLetzterMs == 0) kLetzterMs = 1;
  kWarteMs = kursIntervallMs();
  if (WiFi.status() != WL_CONNECTED) { kHinweis = "Kein WLAN"; return; }

  bool kerzen = cfgChartKerzen;
  String spanne = gueltigeSpanne(cfgChartSpanne) ? cfgChartSpanne : String("24h");
  HTTPClient http;
  String url = "http://" + cfgHost + ":" + cfgPort + "/api/esp32/kurs?symbol=" + cfgChartSym
             + "&spanne=" + spanne + "&n="
             + String(kerzen ? (hochformat() ? CHART_N_KERZEN_HOCH : CHART_N_KERZEN) : CHART_N_LINIE);
  http.begin(url);
  http.useHTTP10(true);                       // kein Chunked-Encoding → direkt aus dem Stream lesen
  http.setConnectTimeout(NEBEN_TIMEOUT_MS);
  http.setTimeout(NEBEN_TIMEOUT_MS);
  http.addHeader("X-ESP32-Key", cfgKey);

  int code = http.GET();
  if (code != 200) {
    http.end();
    Serial.printf("[KURS] HTTP %d\n", code);
    if (code == 400)                                    { kAnz = 0; kHinweis = "Symbol unbekannt: " + cfgChartSym; kWarteMs = NEBEN_PAUSE_MS; }
    else if (code == 401 || code == 403 || code == 429) { kAnz = 0; kHinweis = "Schluessel abgelehnt (HTTP " + String(code) + ")"; kWarteMs = NEBEN_PAUSE_MS; }
    else if (code == 404)                               { kAnz = 0; kHinweis = "Server zu alt - kein Kurs-Chart"; kWarteMs = NEBEN_PAUSE_MS; }
    else if (code < 0)                                  kHinweis = "Kurs: Server nicht erreicht";
    else                                                kHinweis = "Kurs: HTTP " + String(code);
    return;
  }

  JsonDocument doc;   // ~130 Kerzen × 4 Zahlen ≈ 10 KB, wird gleich wieder frei
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();
  if (err) { kHinweis = "Kursdaten unlesbar"; return; }
  if (doc["aus"] | false) { kAnz = 0; kHinweis = "Marktdaten in der App aus"; kWarteMs = NEBEN_PAUSE_MS; return; }

  int n = 0;
  for (JsonArray k : doc["kerzen"].as<JsonArray>()) {
    if (n >= MAX_KERZEN) break;
    kO[n] = k[0] | 0.0f;
    kH[n] = k[1] | 0.0f;
    kL[n] = k[2] | 0.0f;
    kC[n] = k[3] | 0.0f;
    n++;
  }
  if (n < 2) { kAnz = 0; kHinweis = "Keine Kursdaten"; return; }
  kAnz       = n;
  kArtKerzen = kerzen;
  kJetzt     = doc["jetzt"] | kC[n - 1];
  kStart     = doc["start"] | kO[0];
  kAenderung = doc["aenderung"] | 0.0f;
  kSymbol    = (const char*)(doc["symbol"] | cfgChartSym.c_str());
  kSpanne    = (const char*)(doc["spanne"] | spanne.c_str());
  kHinweis   = "";
}

// Runde Achsenschritte (1-2-2.5-5 × 10^n), der nächste zu Spanne/4 (Desklet achsenStufen).
double achsenSchritt(double mn, double mx) {
  double roh = (mx - mn) / 4;
  if (!(roh > 0)) roh = fabs(mx) / 100;
  if (!(roh > 0)) roh = 1;
  double basis = pow(10, floor(log10(roh)));
  const double f[] = {1, 2, 2.5, 5, 10};
  double best = basis;
  for (double w : f) if (fabs(log(w * basis / roh)) < fabs(log(best / roh))) best = w * basis;
  return best;
}

int achsenStellen(double schritt) {
  int stellen = constrain(-(int)floor(log10(schritt) + 1e-9), 0, 8);
  double r = schritt * pow(10, stellen);
  if (fabs(r - round(r)) > 1e-6) stellen++;   // 2.5er-Schritte
  return stellen;
}

void drawChartScreen() {
  const int W = tft.width(), NY = navY();
  tft.fillRect(0, 0, W, NY, COLOR_BG);

  // ── Kopf: Symbol · Zeitraum, Änderung, Kurs ───────
  tft.fillRect(0, 0, W, 24, COLOR_HEADER_BG);
  tft.drawFastHLine(0, 24, W, COLOR_GREY_DARK);
  tft.setTextSize(1);
  String sym = kAnz >= 2 ? kSymbol : saubereSymbol(cfgChartSym);
  if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
  if (hochformat()) sym = kuerze(sym, 8);         // Platz für den Kurs rechts
  String spanne = kAnz >= 2 ? kSpanne : cfgChartSpanne;
  tft.setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft.setCursor(6, 5);
  tft.print(sym);
  int px = tft.getCursorX() + 4;
  tft.fillRect(px, 8, 2, 2, COLOR_GREY);          // „·" (die GLCD-Schrift hat keinen Mittelpunkt)
  tft.setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft.setCursor(px + 6, 5);
  tft.print(spanne);

  const int yo = 34, yu = NY - 13;                 // Zeichenfläche (mit Rand wie im Desklet; Quer 194)
  if (kAnz < 2) {
    String t = kuerze(kHinweis.length() ? kHinweis : String("Lade Kurs ..."), (W - 8) / 6);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(max(4, W / 2 - (int)t.length() * 3), NY / 2 + 7);
    tft.print(t);
    return;
  }

  uint16_t farbe = kAenderung >= 0 ? COLOR_GREEN : COLOR_RED;
  char aend[20];
  snprintf(aend, sizeof(aend), "%+.2f %%", kAenderung);
  tft.setTextColor(farbe, COLOR_HEADER_BG);
  tft.setCursor(6, 15);
  tft.print(aend);
  String jetztTxt = preisText(kJetzt);
  tft.setTextSize(2);
  tft.setCursor(W - 6 - (int)jetztTxt.length() * 12, 5);
  tft.print(jetztTxt);
  tft.setTextSize(1);

  // ── Wertebereich ──────────────────────────────────
  bool kerzen = kArtKerzen;
  float mn = kerzen ? kL[0] : kC[0], mx = kerzen ? kH[0] : kC[0];
  for (int i = 0; i < kAnz; i++) {
    mn = min(mn, kerzen ? kL[i] : kC[i]);
    mx = max(mx, kerzen ? kH[i] : kC[i]);
  }
  if (!(mx > mn)) { float d = fabsf(mx) * 0.005f + 1e-6f; mn -= d; mx += d; }
  float spann = mx - mn;

  // ── Achse: Breite nach dem längsten Text, damit die Linie nie darunter läuft ──
  double schritt = achsenSchritt(mn, mx);
  int stellen = achsenStellen(schritt);
  double stufen[12];
  int nSt = 0;
  for (double v = ceil(mn / schritt) * schritt; v <= mx + schritt * 1e-9 && nSt < 12; v += schritt) stufen[nSt++] = v;
  int textMax = jetztTxt.length();
  char st[20];
  for (int i = 0; i < nSt; i++) {
    snprintf(st, sizeof(st), "%.*f", stellen, stufen[i]);
    textMax = max(textMax, (int)strlen(st));
  }
  const int x0 = 4;
  int achseX = W - textMax * 6 - 8;               // Beginn der Achse
  int b      = achseX - 4 - x0;                   // Breite der Zeichenfläche
  auto Y = [&](float v) -> int { return yu - (int)lroundf((v - mn) / spann * (yu - yo)); };

  // Gitter und Beschriftung
  for (int i = 0; i < nSt; i++) {
    int yy = Y(stufen[i]);
    tft.drawFastHLine(x0, yy, b, COLOR_GREY_DARK);
    snprintf(st, sizeof(st), "%.*f", stellen, stufen[i]);
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(achseX + 4, yy - 3);
    tft.print(st);
  }

  if (kerzen) {
    // Kerzen: grün steigend, rot fallend; Docht 1 px, Körper ~70 % des Fachs
    float fach = (float)b / kAnz;
    int koerperB = constrain((int)(fach * 0.7f), 1, 9);
    for (int i = 0; i < kAnz; i++) {
      int mitte = x0 + (int)((i + 0.5f) * fach);
      uint16_t c = kC[i] >= kO[i] ? COLOR_GREEN : COLOR_RED;
      int yh = Y(kH[i]), yl = Y(kL[i]);
      tft.drawFastVLine(mitte, yh, max(1, yl - yh + 1), c);
      int oben = Y(max(kO[i], kC[i])), unten = Y(min(kO[i], kC[i]));
      tft.fillRect(mitte - koerperB / 2, oben, koerperB, max(1, unten - oben), c);
    }
  } else {
    // Fläche: je Spalte von der Linie nach unten, in 4 Stufen ausgeblendet
    const uint8_t alpha[4] = {64, 44, 26, 12};
    uint16_t ton[4];
    for (int s = 0; s < 4; s++) ton[s] = tft.alphaBlend(alpha[s], farbe, COLOR_BG);
    for (int px = 0; px < b; px++) {
      float pos = (float)px * (kAnz - 1) / (b - 1);
      int   i   = min((int)pos, kAnz - 2);
      float t   = pos - i;
      int   yy  = Y(kC[i] + (kC[i + 1] - kC[i]) * t) + 1;
      int   hoehe = yu - yy;
      if (hoehe <= 0) continue;
      for (int s = 0; s < 4; s++) {
        int a = yy + hoehe * s / 4, e = yy + hoehe * (s + 1) / 4;
        if (e > a) tft.drawFastVLine(x0 + px, a, e - a, ton[s]);
      }
    }
    // Gitter über der Fläche nachziehen, damit es durchscheint
    for (int i = 0; i < nSt; i++) {
      int yy = Y(stufen[i]);
      for (int px = 0; px < b; px += 4) tft.drawPixel(x0 + px, yy, COLOR_GREY_DARK);
    }
    // Linie (2 px) und letzter Kurs als Punkt
    auto X = [&](int i) -> float { return x0 + (float)i * (b - 1) / (kAnz - 1); };
    for (int i = 0; i < kAnz - 1; i++)
      tft.drawWideLine(X(i), Y(kC[i]), X(i + 1), Y(kC[i + 1]), 2.0f, farbe, ton[0]);
    tft.fillCircle((int)X(kAnz - 1), Y(kJetzt), 2, farbe);
  }

  // Startkurs gestrichelt
  int ys = Y(kStart);
  if (ys >= yo - 6 && ys <= yu + 6)
    for (int x = x0; x < x0 + b; x += 6) tft.drawFastHLine(x, ys, 3, COLOR_WHITE_DIM);

  // Letzter Kurs als Marke auf der Achse
  const int mh = 11;
  int my = constrain(Y(kJetzt) - mh / 2, yo - 6, yu + 6 - mh);
  tft.fillRect(achseX, my, W - achseX, mh, farbe);
  tft.setTextColor(COLOR_BG, farbe);
  tft.setCursor(achseX + 4, my + 2);
  tft.print(jetztTxt);

  // Hinweis bei Fehler mit altem Stand (unter der Zeichenfläche)
  if (kHinweis.length()) {
    tft.setTextColor(COLOR_YELLOW, COLOR_BG);
    tft.setCursor(x0, yu + 4);
    tft.print(kuerze(kHinweis, (W - 8) / 6));
  }
}

// ── Verbindungs-/Fehler-Screens ──────────────────────────

void drawConnecting(const char* msg) {
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, tft.height() / 2 - 8);        // Quer 112
  tft.print(msg);
}

void drawStartupError(const char* title, const char* detail) {
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_RED, COLOR_BG);
  tft.setTextSize(2);
  tft.setCursor(10, tft.height() / 2 - 35);       // Quer 85
  tft.print(title);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, tft.height() / 2);            // Quer 120
  tft.print(detail);
}

// ── Aktuellen Screen zeichnen ────────────────────────────

void drawCurrentScreen() {
  if      (activeScreen == 0)            drawScreen1();
  else if (activeScreen == 1)            drawScreen2();
  else if (activeScreen == SCREEN_CHART) drawChartScreen();
  else                                   drawScreen3();
  drawNavBar();
}

// Nach dem regelmässigen /display-Abruf: die Chart-Seite nicht neu zeichnen
// (sie hat ihren eigenen Takt), nur die Nav-Bar mit dem Offline-Punkt.
void zeichneNachAbruf() {
  if (activeScreen == SCREEN_CHART) drawNavBar();
  else                              drawCurrentScreen();
}

// ── HTML Helpers ─────────────────────────────────────────

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
  input { width: 100%; background: #05080a; border: 1px solid #1d2b33; border-radius: 6px;
          color: #e8f4f6; padding: 9px 12px; font-size: 0.95rem; outline: none; }
  input:focus, select:focus { border-color: #1fd6c4; }
  select { width: 100%; background: #05080a; border: 1px solid #1d2b33; border-radius: 6px;
           color: #e8f4f6; padding: 9px 12px; font-size: 0.95rem; outline: none; }
  label.chk { display: flex; align-items: center; gap: 10px; color: #e8f4f6; font-size: 0.9rem; margin-top: 11px; cursor: pointer; }
  label.chk input { width: 20px; height: 20px; flex: none; accent-color: #1fd6c4; }
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
<p class="sub">ESP32-2432S028 CYD Setup</p>

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
    <div class="info">Settings &rarr; ESP32 Display &rarr; API-Key kopieren</div>
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
    <label class="chk"><input type="checkbox" name="pnlpct" value="1" %CHK_PNL%>PnL in Prozent der Marge (wie ROE der B&ouml;rse)</label>
    <div class="info">Auf dem Ger&auml;t: Tipp auf den Kopf der Seite &laquo;Positionen&raquo; schaltet USDT &harr; %.</div>
    <label class="chk"><input type="checkbox" name="botusdt" value="1" %CHK_BOT%>Bot-Werte in USDT umrechnen (Coin-M &times; Kurs)</label>
    <label>Ausrichtung</label>
    <select name="dreh">%DREH%</select>
    <div class="info">Querformat = wie bisher. Der Touch dreht automatisch mit.</div>
    <label class="chk"><input type="checkbox" name="inv" value="1" %CHK_INV%>Farben umkehren</label>
    <div class="info">An f&uuml;r das CYD mit Micro-USB. Ist der Hintergrund hell statt dunkel, ausschalten (USB-C-Bauart).</div>
  </div>
  <div class="card">
    <h2>Kurs-Chart</h2>
    <label class="chk"><input type="checkbox" name="chart" value="1" %CHK_CHART%>Reiter &laquo;Chart&raquo; anzeigen</label>
    <label>Symbol</label>
    <input name="csym" type="text" value="%CSYM%" placeholder="BTC" maxlength="20" autocomplete="off">
    <label>Zeitraum</label>
    <select name="cspan">%CSPAN%</select>
    <label>Darstellung</label>
    <select name="cart">%CART%</select>
    <div class="info">Symbol ohne USDT &ndash; der Server erg&auml;nzt es. Auf dem Ger&auml;t: Tipp auf den Kopf = n&auml;chster Zeitraum, Tipp auf den Chart = Linie/Kerzen.</div>
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
  html.replace("%TOKEN%",    formToken);
  // Anzeige-Einstellungen (keine Geheimnisse)
  html.replace("%CHK_PNL%",   cfgPnlProzent ? "checked" : "");
  html.replace("%CHK_BOT%",   cfgBotUsdt    ? "checked" : "");
  html.replace("%CHK_INV%",   cfgInvert     ? "checked" : "");
  html.replace("%CHK_CHART%", cfgChartAn    ? "checked" : "");
  html.replace("%CSYM%",      htmlEscape(cfgChartSym));
  String spannen;
  const char* sp[] = {"1h", "24h", "7d", "30d"};
  const char* spName[] = {"1 Stunde", "24 Stunden", "7 Tage", "30 Tage"};
  for (int i = 0; i < 4; i++)
    spannen += String("<option value=\"") + sp[i] + "\"" + (cfgChartSpanne == sp[i] ? " selected" : "") + ">" + spName[i] + "</option>";
  html.replace("%CSPAN%", spannen);
  String drehen;
  const char* drehName[] = {"Querformat", "Hochformat", "Querformat 180&deg; gedreht", "Hochformat 180&deg; gedreht"};
  for (int i = 0; i < 4; i++)
    drehen += String("<option value=\"") + i + "\"" + (cfgDreh == i ? " selected" : "") + ">" + drehName[i] + "</option>";
  html.replace("%DREH%", drehen);
  html.replace("%CART%", String("<option value=\"linie\"") + (cfgChartKerzen ? "" : " selected") + ">Linie</option>"
                       + "<option value=\"kerzen\"" + (cfgChartKerzen ? " selected" : "") + ">Kerzen</option>");
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
  // Anzeige: Checkbox fehlt im POST = aus
  cfgPnlProzent  = server.hasArg("pnlpct");
  cfgBotUsdt     = server.hasArg("botusdt");
  cfgChartAn     = server.hasArg("chart");
  cfgChartSym    = saubereSymbol(server.arg("csym"));
  cfgChartSpanne = gueltigeSpanne(server.arg("cspan")) ? server.arg("cspan") : String("24h");
  cfgChartKerzen = server.arg("cart") == "kerzen";
  if (server.hasArg("dreh")) cfgDreh = constrain(server.arg("dreh").toInt(), 0, 3);   // fehlt = bleibt
  cfgInvert = server.hasArg("inv");
  saveAnzeige();
  saveConfig(ssid, pass, host, port, key);
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

bool fetchData() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = "http://" + cfgHost + ":" + cfgPort + "/api/esp32/display?filter=" + cfgFilter;
  http.begin(url);
  http.addHeader("X-ESP32-Key", cfgKey);
  http.setTimeout(10000);

  int code = http.GET();
  if (code != 200) {
    http.end();
    data.valid = false;
    Serial.printf("[API] HTTP %d\n", code);
    return false;
  }

  String payload = http.getString();
  http.end();
  Serial.printf("[API] OK, %u Bytes\n", (unsigned)payload.length());   // Inhalt nie auf Serial (SEC-ESP-003)

  JsonDocument doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    data.valid = false;
    return false;
  }

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

  // Server-Filter syncen (Filter wird in der App gesetzt, ESP32 folgt)
  const char* srvFilter = doc["filter"] | "";
  if (strlen(srvFilter) > 0) {
    String newFilter = String(srvFilter);
    if (newFilter != cfgFilter) {
      cfgFilter = newFilter;
      Serial.printf("[FILTER] Server-Sync: %s\n", srvFilter);
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
    pos.margin        = p["margin"]        | 0.0f;   // fehlt meist → aus Einstieg/Menge/Hebel
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
    bot.margin        = b["margin"]        | 0.0f;   // fehlt bei älterem Server → „-"
    bot.hasGrid       = b["gridProfit"].is<float>();   // null oder fehlend → „-"
    bot.gridProfit    = b["gridProfit"]    | 0.0f;
    data.bots.push_back(bot);
  }

  data.valid = true;
  lastOkMs = millis();
  if (lastOkMs == 0) lastOkMs = 1;
  return true;
}

// ── Setup-Modus ──────────────────────────────────────────

// Quer: Schritt 1 links, Schritt 2 rechts (Trennstrich senkrecht bei x=160).
// Hoch: beide untereinander (Trennstrich waagrecht).
void zeichneSetupSchirm(const char* grund) {
  setupGrund = grund;
  const int W = tft.width(), H = tft.height();
  const bool hoch = hochformat();
  const int s2x = hoch ? 10 : 172, s2y = hoch ? 144 : 58;   // Schritt 2
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_YELLOW, COLOR_BG);
  tft.setTextSize(2);
  tft.setCursor(10, 20);
  tft.print("SETUP MODUS");
  drawMarke(W - 24, 26, 16);
  if (hoch) tft.drawFastHLine(10, 134, W - 20, COLOR_GREY_DARK);
  else      tft.drawFastVLine(160, 50, 120, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 58);  tft.print("1. WLAN verbinden:");
  tft.setTextColor(COLOR_GREEN, COLOR_BG);
  tft.setCursor(10, 74);  tft.print(AP_SSID);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(10, 92);  tft.print("Passwort:");
  tft.setTextColor(COLOR_YELLOW, COLOR_BG);
  tft.setTextSize(2);
  tft.setCursor(10, 106); tft.print(apPass);
  tft.setTextSize(1);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(s2x, s2y);      tft.print("2. Browser:");
  tft.setTextColor(COLOR_YELLOW, COLOR_BG);
  tft.setCursor(s2x, s2y + 16); tft.print("192.168.4.1");
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  if (setupMitKonfig) {
    tft.setCursor(10, H - 60);                     // Quer 180
    tft.print("Ohne Eingabe: nach 10 Min. Neustart");
  }
  if (grund) {
    tft.setTextColor(COLOR_WHITE_DIM, COLOR_BG);
    tft.setCursor(10, H - 48);                     // Quer 192
    tft.print(grund);
  }
  tft.drawFastHLine(0, H - NAV_H, W, COLOR_GREY_DARK);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setCursor(10, H - 23); tft.print("AutarkTrade ESP32 v" FW_VERSION);
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

// Lokale Geste: in den ersten Sekunden nach dem Boot den Bildschirm oder die
// BOOT-Taste SETUP_HALTEN_MS lang halten. Nur wer am Gerät steht, kommt so
// ins Portal. Kurze Lücken im Touch-Signal (der resistive Chip meldet nicht
// jede Abfrage) brechen das Halten nicht ab. Die Geste fragt nur „berührt?",
// nicht wo — sie geht daher in jeder Ausrichtung (die gilt hier schon, siehe setup()).
bool lokalGedrueckt() {
  int x, y;
  return digitalRead(BOOT_TASTE_PIN) == LOW || mapTouch(&x, &y);
}

bool setupGesteBeimStart() {
  pinMode(BOOT_TASTE_PIN, INPUT_PULLUP);
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_GREY, COLOR_BG);
  tft.setTextSize(1);
  const int ym = tft.height() / 2 - 20;            // Quer 100
  if (hochformat()) {                              // 270 px Text passt nicht in 240
    tft.setCursor(10, ym - 12); tft.print("Setup: Bildschirm oder");
    tft.setCursor(10, ym);      tft.print("BOOT-Taste 3 s halten");
  } else {
    tft.setCursor(10, ym);
    tft.print("Setup: Bildschirm oder BOOT-Taste 3 s halten");
  }
  unsigned long t0 = millis();
  while (millis() - t0 < SETUP_FENSTER_MS) {
    if (lokalGedrueckt()) {
      tft.setTextColor(COLOR_YELLOW, COLOR_BG);
      tft.setCursor(10, ym + 20);
      tft.print("Halten ...");
      unsigned long h0 = millis(), zuletzt = millis();
      while (millis() - zuletzt < 400) {
        if (lokalGedrueckt()) zuletzt = millis();
        if (millis() - h0 >= SETUP_HALTEN_MS) return true;
        delay(30);
      }
      return false;   // losgelassen: normal starten
    }
    delay(30);
  }
  return false;
}

// ── Setup ────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] Start");
  // Konfiguration zuerst (nur NVS): die Ausrichtung muss schon für die
  // Setup-Geste und den Setup-Schirm gelten.
  loadConfig();

  // ── Display initialisieren ──────────────────────
  // WICHTIG: tft.init() ZUERST — TFT_eSPI macht intern digitalWrite(TFT_BL, HIGH)
  // wegen des TFT_BL=21 Build-Flags. Das zerstört eine vorherige LEDC-Mux-Konfig.
  Serial.println("[BOOT] tft.init()");
  tft.init();
  wendeDrehungAn();       // setRotation() je Ausrichtung, danach invertDisplay(1) (Micro-USB CYD)
  tft.fillScreen(COLOR_BG);
  Serial.println("[BOOT] Backlight LEDC init (nach tft.init)");
  backlightInit();   // jetzt re-attacht LEDC den Pin sicher

  // ── Touch init auf separatem HSPI-Bus ───────────
  touchSPI.begin(TOUCH_SCK, TOUCH_MISO, TOUCH_MOSI, TOUCH_CS_PIN);
  ts.begin(touchSPI);
  ts.setRotation(0);  // Rotation wird in mapTouch() manuell gemacht
  Serial.println("[BOOT] Touch init (XPT2046, HSPI)");


  // ── Setup-Modus ──────────────────────────────────
  // Nur ohne Konfiguration oder per lokaler Geste (SEC-ESP-001) — nie aus dem Netz.
  if (cfgSSID.isEmpty() || cfgKey.isEmpty()) {
    starteSetupModus(nullptr);
    return;
  }
  if (setupGesteBeimStart()) {
    starteSetupModus("Per Geste geoeffnet");
    return;
  }

  // ── WiFi verbinden ───────────────────────────────
  WiFi.mode(WIFI_STA);
  tft.fillScreen(COLOR_BG);
  tft.setTextColor(COLOR_WHITE, COLOR_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 108);
  tft.print("Verbinde mit WiFi...");

  WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
  unsigned long t0 = millis();
  int dotX = 10;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) break;
    tft.setTextColor(COLOR_GREY, COLOR_BG);
    tft.setCursor(dotX, 124); tft.print(".");
    dotX += 8; if (dotX > 220) dotX = 10;
    delay(300);
  }

  if (WiFi.status() != WL_CONNECTED) {
    // Nach WIFI_MAX_FEHLVERSUCHE Boots ohne WLAN in den Setup-AP, statt
    // endlos neu zu starten (falsche SSID wäre sonst nur per USB zu lösen).
    // Dort nach 10 Min. ohne Eingabe neuer Versuch — etwa nach Router-Ausfall.
    uint8_t fehl = leseFehlversuche() + 1;
    if (fehl >= WIFI_MAX_FEHLVERSUCHE) {
      schreibeFehlversuche(0);
      starteSetupModus("WLAN nicht erreichbar - Daten pruefen");
      return;
    }
    schreibeFehlversuche(fehl);
    char det[64];
    snprintf(det, sizeof(det), "Versuch %u/%u, danach Setup-WLAN", fehl, WIFI_MAX_FEHLVERSUCHE);
    drawStartupError("WiFi Fehler", det);
    delay(10000);
    ESP.restart();
    return;
  }
  schreibeFehlversuche(0);

  Serial.printf("[WiFi] %s\n", WiFi.localIP().toString().c_str());
  // Kein Webserver im Heimnetz (SEC-ESP-001) — Setup nur per Geste beim Boot.

  drawConnecting("Lade Daten...");
  bool ok = fetchData();
  if (!ok) {
    drawStartupError("API Fehler", "Pruefen: Host, Port und API-Key");
    delay(5000);
  }
  drawCurrentScreen();
  lastUpdate    = millis();
  lastTouchTime = millis();
}

// ── Loop ─────────────────────────────────────────────────

// ── WiFi sicherstellen (nach Verbindungsverlust) ──────────
static void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.reconnect();
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS)
    delay(100);
  if (WiFi.status() == WL_CONNECTED) WiFi.setSleep(true);
}

// ── USB-Befehle (nur am Kabel, zur Kontrolle am Rechner) ──
// Nicht blockierend: je loop() nur die schon empfangenen Zeichen.
//   B       → Bildschirmfoto: "\nBILD-START <breite> <hoehe> <rotation> rgb565\n",
//             dann je Bildschirmzeile eine Textzeile mit 4 Hex-Zeichen je Pixel,
//             dann "BILD-ENDE". <rotation> = tft.getRotation() (0..3).
//   D0..D3  → Ausrichtung setzen (wie Portal), speichern, neu zeichnen → "[DREH] n"
//   P0..P3  → Seite Dashboard/Positionen/Chart/Info → "[SEITE] n"
// Das Foto selbst dauert bei 115200 Bd rund 27 s (320×240×4 Zeichen), so lange
// steht die übrige Schleife — es kommt nur auf Zuruf.

// Bildschirminhalt zeilenweise per readRect (MISO = GPIO 12, TFT_MISO in
// platformio.ini). Farben: Das ist der GRAM-Inhalt, also genau die Farbe, die
// der Code gezeichnet hat (z. B. COLOR_BG 0x0041) — NICHT invertiert:
// invertDisplay(1) kehrt nur die Ausgabe ans Glas um, nicht den Speicher.
// readRect liefert die Bytes vertauscht (für pushRect); hier zurückgedreht,
// damit jede Hex-Gruppe das übliche RGB565 ist (RRRRRGGG GGGBBBBB).
// Der Panel-Speicher hält 18 Bit; die unteren Bits von R/B kommen so zurück,
// wie sie geschrieben wurden (565 → 666 → 565 ist verlustfrei).
void sendeBildschirmfoto() {
  const int W = tft.width(), H = tft.height();
  static uint16_t zeile[320];
  static char hex[320 * 4 + 2];
  static const char ziffer[] = "0123456789ABCDEF";
  Serial.printf("\nBILD-START %d %d %d rgb565\n", W, H, tft.getRotation());
  for (int y = 0; y < H; y++) {
    tft.readRect(0, y, W, 1, zeile);
    char* h = hex;
    for (int x = 0; x < W; x++) {
      uint16_t c = (zeile[x] << 8) | (zeile[x] >> 8);
      *h++ = ziffer[(c >> 12) & 0xF];
      *h++ = ziffer[(c >> 8) & 0xF];
      *h++ = ziffer[(c >> 4) & 0xF];
      *h++ = ziffer[c & 0xF];
    }
    *h++ = '\n';
    Serial.write((const uint8_t*)hex, h - hex);
  }
  Serial.println("BILD-ENDE");
}

// Licht an und Standby-Uhr neu, damit der neue Stand sichtbar (und fotografierbar) ist.
void seriellWecken() {
  lastTouchTime = millis();
  if (inStandby) { inStandby = false; setBacklight(true); }
}

void setzeInvert(bool an) {
  cfgInvert = an;
  saveAnzeige();
  wendeDrehungAn();
  seriellWecken();
  Serial.printf("[INV] %d\n", an ? 1 : 0);
}

void setzeDrehung(uint8_t n) {
  cfgDreh = n;
  saveAnzeige();
  wendeDrehungAn();
  if (cfgChartKerzen) { kAnz = 0; kHinweis = ""; kLetzterMs = 0; }   // Kerzenzahl hängt vom Format ab
  if (configMode) zeichneSetupSchirm(setupGrund);
  else { seriellWecken(); drawCurrentScreen(); }
  Serial.printf("[DREH] %u\n", n);
}

void setzeSeite(uint8_t n) {
  const int seiten[4] = {0, 1, SCREEN_CHART, 2};   // Dashboard, Positionen, Chart, Info
  if (!configMode) {
    activeScreen = seiten[n];
    seriellWecken();
    drawCurrentScreen();
  }
  Serial.printf("[SEITE] %u\n", n);
}

// ── Einrichtung über USB (CFG) ───────────────────────────
// Die Web-App schickt nach dem Flashen eine Zeile
//   CFG {"ssid":"…","pass":"…","host":"…","port":"8080","key":"…"}
// und spart so den Setup-Hotspot. Geht nur über das eingesteckte Kabel, also
// lokal wie die Setup-Geste (SEC-ESP-001). „CFG?" fragt, ob die Firmware es kann.
// „CFG SCAN" sucht WLANs. Antwort: [CFG] BEREIT <version> | [CFG] NETZE <json> |
// [CFG] OK (dann Neustart) | [CFG] FEHLER <grund>.
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
  if (d["invert"].is<bool>()) { cfgInvert = d["invert"].as<bool>(); saveAnzeige(); }
  saveConfig(ssid, pass, host, port, key);
  Serial.println("[CFG] OK");
  Serial.flush();
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

void pruefeSeriell() {
  static char vorher = 0;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (cfgZeichen(c)) { vorher = 0; continue; }
    if (c == 'B') sendeBildschirmfoto();
    else if (vorher == 'D' && c >= '0' && c <= '3') setzeDrehung(c - '0');
    else if (vorher == 'P' && c >= '0' && c <= '3') setzeSeite(c - '0');
    else if (vorher == 'I' && (c == '0' || c == '1')) setzeInvert(c == '1');
    vorher = c;
  }
}

void loop() {
  pruefeSeriell();

  if (configMode) {
    server.handleClient();
    // Mit vorhandener Konfiguration nicht ewig im Setup hängen bleiben.
    if (setupMitKonfig && millis() - portalAktivMs > SETUP_TIMEOUT_MS) {
      Serial.println("[AP] Setup-Zeitlimit, Neustart");
      delay(100);
      ESP.restart();
    }
    delay(2);
    return;
  }

  unsigned long now = millis();

  // ── Touch prüfen ─────────────────────────────────────
  int tx, ty;
  if (mapTouch(&tx, &ty)) {
    lastTouchTime = now;

    if (inStandby) {
      // ── Aufwachen aus Standby ─────────────────────────
      inStandby = false;
      setBacklight(true);
      drawConnecting("Lade Daten...");
      ensureWiFi();
      fetchData();
      drawCurrentScreen();
      lastUpdate = millis();
      delay(80);
      return;
    }

    if (ty > navY() - 27) {
      // ── Nav-Bar: 3 bzw. 4 gleich breite Reiter (Zone wie bisher 27 px über die Leiste hinaus) ──
      int newScreen = reiterBei(tx);
      if (newScreen != activeScreen) {
        activeScreen = newScreen;
        drawCurrentScreen();
      }
    } else if (activeScreen == 1) {
      // Tipp auf Kopf/Tabellenkopf: PnL USDT ↔ % der Marge (gespeichert)
      if (ty < 46) {
        cfgPnlProzent = !cfgPnlProzent;
        saveAnzeige();
        drawCurrentScreen();
      }
    } else if (activeScreen == SCREEN_CHART) {
      // Kopf: nächster Zeitraum; Chart: Linie ↔ Kerzen. Beides gespeichert, neu laden.
      if (ty < 26) {
        cfgChartSpanne = cfgChartSpanne == "1h"  ? "24h" :
                         cfgChartSpanne == "24h" ? "7d"  :
                         cfgChartSpanne == "7d"  ? "30d" : "1h";
      } else {
        cfgChartKerzen = !cfgChartKerzen;
      }
      saveAnzeige();
      kAnz = 0;                 // alter Stand passt nicht mehr (Zeitraum bzw. Kerzenzahl)
      kHinweis = "";
      kLetzterMs = 0;           // sofort neu laden
      drawCurrentScreen();
    } else if (activeScreen == 2) {
      // Screen 3 ist jetzt rein informativ (Filter wird vom Server gesteuert)
      // Tap wechselt zurück zum Dashboard und lädt aktuelle Daten
      activeScreen = 0;
      drawConnecting("Lade Daten...");
      ensureWiFi();
      if (fetchData()) {
        drawCurrentScreen();
      } else {
        drawStartupError("API Fehler", "Verbindung zum Server fehlgeschlagen");
        delay(2000);
        drawCurrentScreen();
      }
    }
    delay(80);  // Ghost-Touch-Schutz
    return;
  }

  // ── Standby Stufe 1: 30s ohne Touch → Backlight aus ─
  if (!inStandby && now - lastTouchTime >= (unsigned long)STANDBY_TIMEOUT * 1000) {
    inStandby = true;
    tft.fillScreen(COLOR_BG);
    setBacklight(false);
    Serial.println("[PWR] Standby — Backlight aus");
  }

  // ── Standby Stufe 2: 60s ohne Touch → Light Sleep + WiFi aus ─
  // Boot-Grace: erste 5 Min nach Boot kein Sleep (damit Flashen funktioniert)
  // Ab hier keine Abrufe (und keine USB-Befehle), bis Touch oder 30-Min-Timer weckt.
  if (inStandby
      && now > BOOT_GRACE_MS
      && now - lastTouchTime >= (unsigned long)LIGHT_SLEEP_TIMEOUT * 1000) {

    enterLightSleep();   // BLOCKIERT bis Touch

    // ── Nach Wake: aufwachen wie bei Touch im Standby ──
    inStandby = false;
    lastTouchTime = millis();
    setBacklight(true);
    drawConnecting("Lade Daten...");
    ensureWiFi();
    fetchData();
    drawCurrentScreen();   // auch bei Fehlschlag: alter Stand mit Altersbanner
    lastUpdate = millis();
    delay(150);   // Touch-Event abklingen lassen
    return;
  }

  // Im Standby (Stufe 1): nur kurz warten, Touch-Polling läuft weiter
  if (inStandby) {
    delay(50);
    return;
  }

  // ── Aktiv: Daten alle ACTIVE_INTERVAL Sekunden aktualisieren ───
  if (now - lastUpdate >= (unsigned long)ACTIVE_INTERVAL * 1000) {
    ensureWiFi();
    fetchData();
    zeichneNachAbruf();    // auch bei Fehlschlag: alter Stand mit Altersbanner
    lastUpdate = millis();
    return;
  }

  // ── Kurs-Chart: eigener Takt, nur solange die Chart-Seite sichtbar ist ───
  if (activeScreen == SCREEN_CHART && cfgChartAn && kursFaellig()) {
    holeKurs();
    drawCurrentScreen();
    return;
  }

  delay(50);
}
