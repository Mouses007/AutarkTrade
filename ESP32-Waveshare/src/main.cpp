// AutarkTrade-Anzeige für das Waveshare ESP32-S3-Touch-LCD-2.8 (ST7789 240×320,
// kapazitiver Touch CST328/CST3530 über I2C).
//
// Seiten: Dashboard, Positionen & Bots, Kurs-Chart (abschaltbar), Info.
// Ausrichtung im Setup-Portal wählbar (Quer-/Hochformat, je 180° gedreht);
// Layout und Touch-Umrechnung folgen der gewählten Lage.
// Die Displays zeigen bewusst KEINE Chart-Alarme (bis 3.6.0 als Banner) —
// dafür gibt es Desklet und Handy; der Anzeige-Schlüssel hat auf
// /api/esp32/alarme keinen Zugang.
//
// Über USB (115200 Bd), nur am Kabel: B = Bildschirmfoto als Hex-Text,
// D0..D3 = Ausrichtung setzen, P0..P3 = Seite wählen (siehe pruefeSeriell()).

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <vector>
#include "esp_sleep.h"
#include "driver/gpio.h"

// ── Touch I2C — Waveshare ESP32-S3-Touch-LCD-2.8 (CST328) ─
#define TOUCH_SDA  1
#define TOUCH_SCL  3
#define TOUCH_RST  2
#define TOUCH_INT  4

// ── Konstanten ───────────────────────────────────────────

#define AP_SSID            "AutarkTrade-Setup"
#define ACTIVE_INTERVAL    10        // Sekunden zwischen Updates wenn aktiv
#define STANDBY_TIMEOUT    30        // Sekunden ohne Touch → Backlight aus
#define LIGHT_SLEEP_TIMEOUT 60       // Sekunden ohne Touch → Light Sleep + WiFi aus
#define BOOT_GRACE_MS    300000      // 5 Min nach Boot kein Light Sleep (für Flash-Vorgang)
#define PREF_NAMESPACE     "tjcfg"
#define AP_NAMESPACE        "tjap"    // eigener Namensraum: das AP-Passwort überlebt /reset
#define WIFI_MAX_FEHLVERSUCHE 3       // so viele Boots ohne WLAN, dann Setup-AP statt Neustartschleife
#define SETUP_TIMEOUT_MS    600000    // Setup mit vorhandener Konfiguration: nach 10 Min neu versuchen
#define SETUP_FENSTER_MS    2000      // Fenster nach dem Boot, in dem die Setup-Geste beginnen kann
#define SETUP_HALTEN_MS     3000      // so lange Bildschirm bzw. BOOT-Taste halten
#define BOOT_TASTE_PIN      0         // BOOT-Taste (GPIO0, beide Boards), nach dem Start frei lesbar
#define VERALTET_AB_MS      (3UL * ACTIVE_INTERVAL * 1000UL)   // drei Abrufintervalle ohne Erfolg
#define WIFI_TIMEOUT_MS    12000
#define DISPLAY_ROTATION   3         // Vorgabe der Ausrichtung (Querformat wie bis 3.6.0)
#define TFT_BL_PIN         5         // Backlight-Pin Waveshare ESP32-S3-Touch-LCD-2.8
#define FW_VERSION         "3.8.1-WS"

// ── Kurs-Chart (eigener Abruf neben /display) ────────────────────────────
// Fehler dort zählen NIE als Verbindungsfehler der Hauptanzeige: kein
// data.valid=false, kein lastOkMs, kein WLAN-Fehlerzähler, kein Setup-Modus.
#define NEBEN_CONNECT_MS     3000     // Verbindungsaufbau /kurs
#define NEBEN_TIMEOUT_MS     6000     // Antwort /kurs
#define BREMSE_PAUSE_MS      120000UL // nach HTTP 429: so lange Ruhe

// Höhe der Reiterleiste unten (in beiden Formaten gleich)
#define NAV_H              33

// Seiten (activeScreen). Die Reiter-Reihenfolge steht in navReiter().
#define SEITE_DASHBOARD  0
#define SEITE_POSITIONEN 1
#define SEITE_INFO       2
#define SEITE_CHART      3

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

TFT_eSPI  lcd;
// Alles wird über diesen Zeiger gezeichnet: sonst ist es das Display, für das
// Bildschirmfoto (siehe bildschirmfoto()) kurz ein Zeichenstreifen im RAM.
TFT_eSPI* tft = &lcd;
WebServer server(80);
Preferences prefs;

String cfgSSID, cfgPass, cfgHost, cfgPort, cfgKey;
String cfgFilter = "month";       // "month", "week", "year", "all"
// Anzeige-Einstellungen (Setup-Portal; PnL-% auch per Tipp, Chart-Zeitraum/-Art auch per Tipp)
bool   cfgPnlProzent = false;     // PnL in % der Marge (wie der ROE der Börse)
bool   cfgBotUsdt    = false;     // Bot-Beträge bei Coin-M × markPrice in USDT
bool   cfgChart      = true;      // eigene Chart-Seite
String cfgChartSymbol = "BTC";    // Server ergänzt USDT
String cfgChartSpanne = "24h";    // 1h | 24h | 7d | 30d
bool   cfgChartKerzen = false;    // false = Linie, true = Kerzen
int    cfgDreh        = DISPLAY_ROTATION;   // Ausrichtung = TFT-Rotation 0..3 (Setup-Portal, D0..D3)
bool   configMode  = false;
int    activeScreen = 0;          // SEITE_DASHBOARD … SEITE_CHART
unsigned long lastUpdate    = 0;
unsigned long lastTouchTime = 0;
bool          inStandby     = false;
unsigned long lastOkMs     = 0;      // millis() des letzten erfolgreichen Abrufs (0 = noch keiner)

// Setup-Portal (SEC-ESP-001/002): läuft NUR im Setup-Modus, nie im Heimnetz.
String formToken;                     // pro Boot zufällig, Pflicht für POST /save und /reset
String apPass;                        // WPA2-Passwort des Setup-AP, je Gerät zufällig, auf dem Display
bool   setupMitKonfig = false;        // Setup bei vorhandener Konfiguration → Zeitlimit, dann Neustart
unsigned long portalAktivMs = 0;      // letzte Anfrage ans Portal
const char*   setupGrund   = nullptr; // Text unten auf dem Setup-Schirm (für Neuzeichnen)

// Schirmgrösse in der aktuellen Lage: 320×240 quer, 240×320 hoch.
int schirmB = 320, schirmH = 240;
bool hochformat() { return schirmB < schirmH; }
int  navY()       { return schirmH - NAV_H; }   // Oberkante der Reiterleiste = Unterkante der Seite

// Ganzen Schirm füllen. Nicht fillScreen(): das füllt beim Bildschirmfoto nur
// den Zeichenstreifen ab dessen Ursprung, nicht den ganzen Schirm.
void schirmLeeren(uint16_t farbe) {
  tft->fillRect(0, 0, schirmB, schirmH, farbe);
}

// Lage setzen (0..3 = TFT-Rotation) und die Schirmgrösse dazu merken.
void setzeAusrichtung(int dreh) {
  cfgDreh = constrain(dreh, 0, 3);
  lcd.setRotation(cfgDreh);
  schirmB = lcd.width();
  schirmH = lcd.height();
}

// Text auf höchstens `px` Pixel Breite kürzen (GLCD-Schrift, 6 px je Zeichen).
String passt(const String& s, int px, int groesse = 1) {
  int n = max(1, px / (6 * groesse));
  if ((int)s.length() <= n) return s;
  return s.substring(0, n - 1) + "~";
}

void setBacklight(bool on) {
  ledcWrite(0, on ? 800 : 0);
}

void backlightInit() {
  ledcSetup(0, 20000, 10);
  ledcAttachPin(TFT_BL_PIN, 0);
  ledcWrite(0, 800);
}

// ── Light Sleep mit WiFi aus, Wakeup über Touch ──────────────────────────
// Blockiert bis Touch oder 30 Min. Geweckt wird in kurzen Schlafscheiben von
// 250 ms: nach jeder fragt der Chip per I2C, ob jemand tippt. Vorher weckte
// allein die INT-Leitung (GPIO 4, LOW) — der CST3530 des V2-Boards zog sie
// am Gerät nie messbar auf LOW (22.10.2026), das Display blieb im Schlaf.
// INT bleibt als zusätzliche Wake-Quelle: wo sie geht, weckt sie sofort.
bool touchGedrueckt();   // unten, bei mapTouch

void enterLightSleep() {
  Serial.println("[PWR] Light Sleep — WiFi aus, Wakeup via Touch oder 30min Timer");
  Serial.flush();

  // Backlight aus + Pin festhalten, damit er während Sleep nicht flackert
  setBacklight(false);
  gpio_hold_en((gpio_num_t)TFT_BL_PIN);

  // WiFi komplett runterfahren
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  pinMode(TOUCH_INT, INPUT_PULLUP);
  gpio_wakeup_enable((gpio_num_t)TOUCH_INT, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  esp_sleep_enable_timer_wakeup(250ULL * 1000ULL);   // Schlafscheibe 250 ms

  // Safety-Net: nach 30 Min auf jeden Fall aufwachen für Datenrefresh
  const unsigned long schlafBeginn = millis();
  esp_sleep_wakeup_cause_t cause = ESP_SLEEP_WAKEUP_UNDEFINED;
  while (true) {
    esp_light_sleep_start();
    cause = esp_sleep_get_wakeup_cause();
    if (cause == ESP_SLEEP_WAKEUP_GPIO) break;
    if (touchGedrueckt()) break;
    if (millis() - schlafBeginn >= 30UL * 60UL * 1000UL) break;
  }

  // ── Wake-Up ─────────────────────────────────────────
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_TIMER);
  gpio_hold_dis((gpio_num_t)TFT_BL_PIN);
  Serial.printf("[PWR] Wake from Light Sleep — cause=%d (2=GPIO, 4=Timer)\n", cause);

  // WiFi wieder an
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
  float  margin;          // vom Server, falls geliefert (sonst 0 → aus Einstieg/Menge/Hebel)
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
  float  margin;          // 0 = unbekannt (älterer Server) → Prozent „-"
  float  gridProfit;      // bisher realisierter Grid-Gewinn in marginCoin
  bool   hatGrid;         // false = null/fehlt → „-"
  bool   coinM;
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

// Kursverlauf für die Chart-Seite (GET /api/esp32/kurs). Höchstens 200 Kerzen
// à 16 Byte — der Rest der Antwort wird beim Lesen verworfen.
struct KursKerze { float o, h, l, c; };
enum KursZustand { KURS_NIE, KURS_OK, KURS_SYMBOL, KURS_SCHLUESSEL, KURS_ALT,
                   KURS_AUS, KURS_NETZ, KURS_BREMSE };
struct KursDaten {
  std::vector<KursKerze> kerzen;
  String symbol;
  String spanne;
  float  jetzt = 0, start = 0, hoch = 0, tief = 0, aenderung = 0;
  bool   gueltig = false;
};
KursDaten     kurs;
KursZustand   kursZustand  = KURS_NIE;   // Ergebnis des letzten Abrufs
bool          kursGesperrt = false;      // 401/404: bis zum Neustart nicht mehr fragen
unsigned long kursAbrufMs  = 0;          // letzter Versuch (0 = nie)
unsigned long kursOkMs     = 0;          // letzter Erfolg
unsigned long kursPauseBis = 0;          // nach 429

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
  cfgChart       = prefs.getBool("chart",   true);
  cfgChartSymbol = prefs.getString("csym",  "BTC");
  cfgChartSpanne = prefs.getString("cspan", "24h");
  cfgChartKerzen = prefs.getBool("ckerzen", false);
  cfgDreh        = prefs.getUChar("dreh",   DISPLAY_ROTATION);
  prefs.end();
  if (cfgDreh < 0 || cfgDreh > 3) cfgDreh = DISPLAY_ROTATION;
  if (cfgChartSymbol.isEmpty()) cfgChartSymbol = "BTC";
  if (cfgChartSpanne != "1h" && cfgChartSpanne != "24h" &&
      cfgChartSpanne != "7d" && cfgChartSpanne != "30d") cfgChartSpanne = "24h";
}

// Ein Anzeige-Schalter, nur bei Änderung in den Flash (per Touch umgeschaltet).
void speichereSchalter(const char* name, bool wert) {
  prefs.begin(PREF_NAMESPACE, false);
  if (prefs.getBool(name, !wert) != wert) prefs.putBool(name, wert);
  prefs.end();
}

void speichereDreh() {
  prefs.begin(PREF_NAMESPACE, false);
  if (prefs.getUChar("dreh", 255) != cfgDreh) prefs.putUChar("dreh", cfgDreh);
  prefs.end();
}

void speichereChartSpanne() {
  prefs.begin(PREF_NAMESPACE, false);
  if (prefs.getString("cspan", "") != cfgChartSpanne) prefs.putString("cspan", cfgChartSpanne);
  prefs.end();
}

// Anzeige-Einstellungen aus dem Setup-Portal.
// Den Schlüssel „alarme" (3.6.0) räumt sie mit ab — die Displays zeigen keine Alarme mehr.
void saveAnzeige(bool pnlProzent, bool botUsdt, int dreh, bool chart,
                 const String& symbol, const String& spanne, bool kerzen) {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.putBool("pnlpct",   pnlProzent);
  prefs.putBool("botusdt",  botUsdt);
  prefs.putUChar("dreh",    (uint8_t)constrain(dreh, 0, 3));
  if (prefs.isKey("alarme")) prefs.remove("alarme");
  prefs.putBool("chart",    chart);
  prefs.putString("csym",   symbol);
  prefs.putString("cspan",  spanne);
  prefs.putBool("ckerzen",  kerzen);
  prefs.end();
}

// Chart-Symbol säubern: nur A–Z/0–9, höchstens 20 Zeichen (geht so in die URL).
String saeubereSymbol(const String& roh) {
  String s;
  for (size_t i = 0; i < roh.length() && s.length() < 20; i++) {
    char c = toupper((unsigned char)roh[i]);
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) s += c;
  }
  return s.length() >= 2 ? s : String("BTC");
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

// ── Touch — Waveshare ESP32-S3-Touch-LCD-2.8, zwei Board-Ausgaben ────────
// V1: CST328 an 0x1A, 16-bit-Register (0xD005 Anzahl, 0xD000 XY).
// V2 (Auslieferung seit 06/2026): CST3530 an 0x58, 32-bit-Befehle
//     (0xD0070000 Datenblock lesen, 0xD00002AB quittieren) — Ablauf aus
//     Waveshares CST3530.c, über github.com/itconor/esphome-cst3530.
// Beide auf Wire1 (SDA=1, SCL=3), RST=2 active-low, INT=4. Welcher Chip
// sitzt, entscheidet touchInit() danach, wer nach dem Reset antwortet.
//
// Gemessen 22.10.2026 am V2 des Nutzers: der CST328-Code las unter 0x58 mit
// 16-bit-Adressen den Programmspeicher des Chips (ARM-Vektortabelle) — ein
// fester Datenstrom, der als Tippen gewertet worden wäre. Und: eine
// Info-Abfrage (0xD0030000) vor dem Lesen schaltet den CST3530 in einen
// Modus, in dem er keine Berührungen meldet — Waveshare liest ohne.
//
// Koordinaten beider Chips: Portrait x=0..239, y=0..319, ausgerichtet wie der
// Speicher des Displays in Rotation 0. Umrechnung je Lage siehe mapTouch().

#define CST328_ADDR       0x1A
#define CST328_REG_NUM    0xD005
#define CST328_REG_XY     0xD000
#define CST3530_ADDR      0x58
#define CST3530_DATEN     0xD0070000
#define CST3530_QUITT     0xD00002AB

enum TouchChip { TOUCH_KEINER, TOUCH_CST328, TOUCH_CST3530 };
static TouchChip touchChip = TOUCH_KEINER;

static bool cst328Read(uint16_t reg, uint8_t* buf, uint8_t len) {
  Wire1.beginTransmission(CST328_ADDR);
  Wire1.write((uint8_t)(reg >> 8));
  Wire1.write((uint8_t)(reg & 0xFF));
  if (Wire1.endTransmission(true) != 0) return false;
  Wire1.requestFrom((uint8_t)CST328_ADDR, len);
  for (uint8_t i = 0; i < len; i++) {
    if (!Wire1.available()) return false;
    buf[i] = Wire1.read();
  }
  return true;
}

static void cst328ClearFlag() {
  uint8_t clear = 0;
  Wire1.beginTransmission(CST328_ADDR);
  Wire1.write((uint8_t)(CST328_REG_NUM >> 8));
  Wire1.write((uint8_t)(CST328_REG_NUM & 0xFF));
  Wire1.write(clear);
  Wire1.endTransmission(true);
}

// CST3530: 4 Befehlsbytes, dann (optional) mit Repeated Start lesen.
static bool cst3530Befehl(uint32_t befehl, uint8_t* buf = nullptr, uint8_t len = 0) {
  Wire1.beginTransmission(CST3530_ADDR);
  Wire1.write((uint8_t)(befehl >> 24));
  Wire1.write((uint8_t)(befehl >> 16));
  Wire1.write((uint8_t)(befehl >> 8));
  Wire1.write((uint8_t)befehl);
  if (Wire1.endTransmission(buf == nullptr) != 0) return false;
  if (!buf) return true;
  if (Wire1.requestFrom((uint8_t)CST3530_ADDR, len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire1.read();
  return true;
}

static bool leseCst328(uint16_t* raw_x, uint16_t* raw_y) {
  uint8_t nbuf[1];
  if (!cst328Read(CST328_REG_NUM, nbuf, 1)) return false;
  if ((nbuf[0] & 0x0F) == 0) return false;
  uint8_t xy[27] = {};
  if (!cst328Read(CST328_REG_XY, xy, 27)) { cst328ClearFlag(); return false; }
  cst328ClearFlag();
  // Ersten Touch-Punkt dekodieren (12-bit Koordinaten)
  *raw_x = ((uint16_t)xy[1] << 4) | ((xy[3] & 0xF0) >> 4);
  *raw_y = ((uint16_t)xy[2] << 4) |  (xy[3] & 0x0F);
  return true;
}

static bool leseCst3530(uint16_t* raw_x, uint16_t* raw_y) {
  uint8_t b[9] = {0};
  if (!cst3530Befehl(CST3530_DATEN, b, sizeof(b))) return false;
  cst3530Befehl(CST3530_QUITT);   // quittieren, gibt INT frei
  // Gültig nur mit Punktzahl (low nibble b[3]) UND Ereignis (high nibble b[8]).
  if ((b[3] & 0x0F) == 0 || (b[8] & 0xF0) == 0) return false;
  *raw_x = ((uint16_t)(b[7] & 0x0F) << 8) | b[4];
  *raw_y = ((uint16_t)(b[7] & 0xF0) << 4) | b[5];
  return true;
}

bool mapTouch(int* screenX, int* screenY) {
  uint16_t raw_x = 0, raw_y = 0;
  bool ok = touchChip == TOUCH_CST3530 ? leseCst3530(&raw_x, &raw_y)
          : touchChip == TOUCH_CST328  ? leseCst328(&raw_x, &raw_y)
          : false;
  if (!ok) return false;

  Serial.printf("[Touch] raw_x=%d raw_y=%d\n", raw_x, raw_y);

  // Rohkoordinaten → Bildschirm, passend zur MADCTL-Lage von TFT_eSPI (ST7789):
  //   0 hoch          : x = rx,        y = ry          (keine Spiegelung)
  //   1 quer, 180° zu 3: x = ry,        y = 239 - rx    (MX|MV)
  //   2 hoch, 180° zu 0: x = 239 - rx,  y = 319 - ry    (MX|MY)
  //   3 quer (Vorgabe) : x = 319 - ry,  y = rx          (MV|MY)
  // Lage 3 ist am Gerät gemessen (unten links drücken, x≈50/y≈220 → raw_x=224,
  // raw_y=262); die anderen folgen daraus, weil der Chip fest zum Panel liegt.
  int rx = constrain((int)raw_x, 0, 239), ry = constrain((int)raw_y, 0, 319);
  int sx, sy;
  switch (cfgDreh) {
    case 0:  sx = rx;       sy = ry;       break;
    case 1:  sx = ry;       sy = 239 - rx; break;
    case 2:  sx = 239 - rx; sy = 319 - ry; break;
    default: sx = 319 - ry; sy = rx;       break;
  }
  *screenX = constrain(sx, 0, schirmB - 1);
  *screenY = constrain(sy, 0, schirmH - 1);
  return true;
}

// Für den Schlaf: liegt gerade ein Finger auf? (liest und quittiert wie mapTouch)
bool touchGedrueckt() {
  int x, y;
  return mapTouch(&x, &y);
}

static bool antwortet(uint8_t adr) {
  Wire1.beginTransmission(adr);
  return Wire1.endTransmission(true) == 0;
}

// Reset, dann erkennen, welcher Chip antwortet. Zeiten wie in Waveshares
// Touch_CST3530.cpp: 100 ms Reset halten, danach 500 ms Ruhe auf dem Bus.
// Mit 10 ms / 200 ms antwortete der CST3530 zwar auf I2C, tastete aber nie ab
// (alle Datenblöcke 0, INT blieb HIGH) — Verkehr in seiner Startphase hält ihn
// offenbar davon ab. Danach bis ~1 s nachfassen.
void touchInit() {
  Wire1.begin(TOUCH_SDA, TOUCH_SCL, 400000);
  pinMode(TOUCH_INT, INPUT);
  pinMode(TOUCH_RST, OUTPUT);
  digitalWrite(TOUCH_RST, LOW);  delay(100);
  digitalWrite(TOUCH_RST, HIGH); delay(500);
  for (int versuch = 0; versuch < 8 && touchChip == TOUCH_KEINER; versuch++) {
    if (antwortet(CST328_ADDR))       touchChip = TOUCH_CST328;
    else if (antwortet(CST3530_ADDR)) touchChip = TOUCH_CST3530;
    else delay(100);
  }
  if (touchChip == TOUCH_CST328) {
    // Normal-Mode (0xD109) — ohne diesen Befehl bleibt der CST328 im Debug-Modus.
    Wire1.beginTransmission(CST328_ADDR);
    Wire1.write(0xD1);
    Wire1.write(0x09);
    Wire1.endTransmission(true);
    delay(10);
  }
  if (touchChip == TOUCH_KEINER) {
    Serial.print("[TOUCH] kein bekannter Chip — I2C-Scan Wire1:");
    for (uint8_t adr = 1; adr < 127; adr++) if (antwortet(adr)) Serial.printf(" 0x%02X", adr);
    Serial.println();
  } else {
    Serial.printf("[TOUCH] %s an 0x%02X\n", touchChip == TOUCH_CST328 ? "CST328 (V1)" : "CST3530 (V2)",
                  touchChip == TOUCH_CST328 ? CST328_ADDR : CST3530_ADDR);
  }
}

void loadTouchCal() {}  // Keine Kalibrierung nötig (kapazitiv)

// ── Waveshare ST7789T3 Custom Init ───────────────────────
// Exakt aus dem offiziellen Waveshare Demo (Display_ST7789.cpp)
void waveshareInitST7789() {
  tft->startWrite();         // SPI-Bus öffnen (CS low, Transaktion starten)

  tft->writecommand(0x01);   // Software Reset
  tft->endWrite(); delay(120); tft->startWrite();

  tft->writecommand(0x11);   // Sleep Out
  tft->endWrite(); delay(120); tft->startWrite();

  tft->writecommand(0x36);   // MADCTL
  tft->writedata(0x00);

  tft->writecommand(0x3A);   // COLMOD 16-bit
  tft->writedata(0x05);

  // RAMCTRL: das Waveshare-Demo setzt 0xE8 — Bit 3 (ENDIAN) = little endian,
  // passend zu LVGL mit LV_COLOR_16_SWAP. TFT_eSPI schickt Farben MSB zuerst;
  // mit gesetztem Bit kam jede Farbe byte-vertauscht an (Akzent violett, Gelb
  // cyan, Grau lila — der alte Kommentar „Display-Gamma macht Grau lila" war
  // genau das). 0xE0 = dasselbe ohne ENDIAN-Bit.
  tft->writecommand(0xB0);
  tft->writedata(0x00);
  tft->writedata(0xE0);

  tft->writecommand(0xB2);
  tft->writedata(0x0C); tft->writedata(0x0C); tft->writedata(0x00);
  tft->writedata(0x33); tft->writedata(0x33);

  tft->writecommand(0xB7);
  tft->writedata(0x75);

  tft->writecommand(0xBB);
  tft->writedata(0x1A);

  tft->writecommand(0xC0);
  tft->writedata(0x2C);

  tft->writecommand(0xC2);
  tft->writedata(0x01); tft->writedata(0xFF);

  tft->writecommand(0xC3);
  tft->writedata(0x13);

  tft->writecommand(0xC4);
  tft->writedata(0x20);

  tft->writecommand(0xC6);
  tft->writedata(0x0F);

  tft->writecommand(0xD0);
  tft->writedata(0xA4); tft->writedata(0xA1);

  tft->writecommand(0xD6);
  tft->writedata(0xA1);

  tft->writecommand(0xE0);   // Gamma+
  tft->writedata(0xD0); tft->writedata(0x0D); tft->writedata(0x14);
  tft->writedata(0x0D); tft->writedata(0x0D); tft->writedata(0x09);
  tft->writedata(0x38); tft->writedata(0x44); tft->writedata(0x4E);
  tft->writedata(0x3A); tft->writedata(0x17); tft->writedata(0x18);
  tft->writedata(0x2F); tft->writedata(0x30);

  tft->writecommand(0xE1);   // Gamma-
  tft->writedata(0xD0); tft->writedata(0x09); tft->writedata(0x0F);
  tft->writedata(0x08); tft->writedata(0x07); tft->writedata(0x14);
  tft->writedata(0x37); tft->writedata(0x44); tft->writedata(0x4D);
  tft->writedata(0x38); tft->writedata(0x15); tft->writedata(0x16);
  tft->writedata(0x2C); tft->writedata(0x2E);

  tft->writecommand(0x21);   // Display Inversion ON (ST7789T3 braucht das)
  tft->writecommand(0x29);   // Display ON
  tft->endWrite();
  delay(50);
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

// Eingesetzte Marge einer Position: Feld `margin`, sonst Einstieg × |Menge| ÷ Hebel
// (wie die Börse für den ROE). 0 = unbekannt.
float margePosition(const Position& p) {
  if (p.margin > 0) return p.margin;
  float q = fabsf(p.qty);
  return (p.entryPrice > 0 && q > 0 && p.leverage > 0) ? p.entryPrice * q / p.leverage : 0;
}

// „+12.34%" bezogen auf die Marge, „-" ohne Marge.
String prozentText(float betrag, float marge) {
  if (!(marge > 0)) return "-";
  char s[16];
  snprintf(s, sizeof(s), "%+.2f%%", betrag / marge * 100.0f);
  return String(s);
}

// Bot-Beträge: auf Wunsch Coin-M × markPrice in USDT (Prozente bleiben gleich).
float botFaktor(const Bot& b) {
  return (cfgBotUsdt && b.marginCoin != "USDT" && b.markPrice > 0) ? b.markPrice : 1.0f;
}
bool botInUsdt(const Bot& b) { return b.marginCoin == "USDT" || botFaktor(b) != 1.0f; }

void fillCard(int x, int y, int w, int h) {
  tft->fillRoundRect(x, y, w, h, 6, COLOR_CARD);
  tft->drawRoundRect(x, y, w, h, 6, COLOR_BLUE_NAV);
}

// ── Nav-Bar (unten, h=33: quer y=207, hoch y=287) ─────────
// Drei oder mit Chart vier Reiter über die volle Breite:
// Dashboard | Positionen | [Chart] | Info
// Im Hochformat sind vier Reiter nur 60 px breit — dann Kurznamen.

int navReiter(int* seiten) {
  int n = 0;
  seiten[n++] = SEITE_DASHBOARD;
  seiten[n++] = SEITE_POSITIONEN;
  if (cfgChart) seiten[n++] = SEITE_CHART;
  seiten[n++] = SEITE_INFO;
  return n;
}

const char* reiterName(int seite) {
  return seite == SEITE_DASHBOARD  ? "Dashboard"  :
         seite == SEITE_POSITIONEN ? "Positionen" :
         seite == SEITE_CHART      ? "Chart"      : "Info";
}

const char* reiterKurzname(int seite) {
  return seite == SEITE_DASHBOARD  ? "Dash" :
         seite == SEITE_POSITIONEN ? "Pos." :
         seite == SEITE_CHART      ? "Chart" : "Info";
}

void drawNavBar() {
  const int ny = navY(), nh = NAV_H, W = schirmB;
  int seiten[4];
  int n = navReiter(seiten);

  tft->fillRect(0, ny, W, nh, COLOR_NAV_BG);
  // Blauer Trennstrich oben (App-Stil)
  tft->drawFastHLine(0, ny, W, COLOR_BLUE_NAV);
  tft->setTextSize(1);

  for (int i = 0; i < n; i++) {
    int x0 = i * W / n, x1 = (i + 1) * W / n;
    if (i > 0) tft->drawFastVLine(x0, ny + 1, nh - 1, COLOR_GREY_DARK);
    bool aktiv = activeScreen == seiten[i];
    if (aktiv) {
      tft->fillRect(x0 + 1, ny + 1, x1 - x0 - 2, nh - 1, COLOR_NAV_AKTIV);   // leicht blau-dunkel aktiv
      tft->drawFastHLine(x0 + 1, ny, x1 - x0 - 2, COLOR_BLUE);               // blauer Indikator-Strich
    }
    // Info inaktiv gelb wie bisher
    uint16_t farbe = aktiv ? COLOR_WHITE : (seiten[i] == SEITE_INFO ? COLOR_YELLOW : COLOR_GREY);
    tft->setTextColor(farbe, aktiv ? COLOR_NAV_AKTIV : COLOR_NAV_BG);
    const char* name = reiterName(seiten[i]);
    if ((int)strlen(name) * 6 > x1 - x0 - 4) name = reiterKurzname(seiten[i]);
    tft->setCursor(x0 + (x1 - x0 - (int)strlen(name) * 6) / 2, ny + 12);
    tft->print(name);
  }

  // Offline-Indikator: kleiner roter Punkt rechts unten wenn Daten fehlen oder veraltet sind
  if (!data.valid || datenVeraltet()) {
    tft->fillCircle(W - 7, ny + 26, 4, COLOR_RED);
  }
}

// ── Donut-Chart ──────────────────────────────────────────

void drawDonut(int cx, int cy, int r, int ir, float pct, uint16_t color,
               const char* label, const char* valStr) {
  // Grauer Hintergrunds-Ring
  tft->drawSmoothArc(cx, cy, r, ir, 0, 360, COLOR_GREY_DARK, COLOR_BG, true);

  // Farbiger Fortschritts-Arc (0° = oben, gegen Uhrzeigersinn)
  float angle = constrain(pct / 100.0f * 360.0f, 0, 360);
  if (angle > 1.0f)
    tft->drawSmoothArc(cx, cy, r, ir, 0, angle, color, COLOR_BG, true);

  // Wert in der Mitte
  tft->setTextColor(COLOR_WHITE, COLOR_BG);
  tft->setTextSize(1);
  int vw = strlen(valStr) * 6;
  tft->setCursor(cx - vw / 2, cy - 4);
  tft->print(valStr);

  // Label darunter
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  int lw = strlen(label) * 6;
  tft->setCursor(cx - lw / 2, cy + r + 4);
  tft->print(label);
}

// ── SCREEN 1: Dashboard (quer 320×207, hoch 240×287) ─────
// Quer: Kontostand-Karte, Volumen, drei Donuts nebeneinander.
// Hoch: Perf in eigener Zeile der Karte, Donuts 2 + 1 untereinander.

// „Heute 12 T  5+ 3-  +12.34" ab der aktuellen Cursor-Position
static void zeichneHeute(int x, int y) {
  tft->setTextSize(1);
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setCursor(x, y);
  tft->print("Heute ");
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft->print(String(data.todayTrades));
  tft->print(" T  ");
  tft->setTextColor(COLOR_GREEN, COLOR_CARD);
  tft->print(String(data.todayWins));
  tft->print("+ ");
  tft->setTextColor(COLOR_RED, COLOR_CARD);
  tft->print(String(data.todayLosses));
  tft->print("-  ");
  tft->setTextColor(pnlColor(data.todayPnL), COLOR_CARD);
  tft->print((data.todayPnL >= 0 ? "+" : "") + String(data.todayPnL, 2));
}

void drawScreen1() {
  const int W = schirmB;
  const bool hoch = hochformat();
  tft->fillRect(0, 0, W, navY(), COLOR_BG);

  // ── Banner, wenn keine oder alte Daten (FUN-GER-001) ───
  // Nach einem Fehlschlag bleibt der letzte Stand stehen — dann muss sein
  // Alter sichtbar sein, sonst sehen Stunden alte Positionen aktuell aus.
  bool banner = !data.valid || datenVeraltet();
  if (banner) {
    tft->fillRoundRect(4, 2, W - 8, 20, 4, COLOR_RED);
    tft->setTextColor(COLOR_WHITE, COLOR_RED);
    tft->setTextSize(1);
    tft->setCursor(8, 8);
    String t;
    if (lastOkMs == 0) t = "OFFLINE - keine Daten vom Server";
    else {
      t = "VERALTET - Stand vor " + alterText() + ", Server nicht erreicht";
      if ((int)t.length() * 6 > W - 16) t = "VERALTET - Stand vor " + alterText();
    }
    tft->print(passt(t, W - 16));
  }

  // ── Kontostand-Karte ──────────────────────────────
  // Zeilen in der Karte: Titel, Betrag (gross), Heute, im Hochformat Perf.
  // Mit Banner rücken sie zusammen, damit unten nichts in die Reiter läuft.
  const bool perfZeile = hoch && data.hasBalance;
  int cardY  = banner ? 24 : 2;
  int wertY  = banner ? 20 : 22;
  int heuteY = banner ? 42 : 48;
  int cardH  = banner ? 56 : 62;
  if (perfZeile) cardH += 12;
  fillCard(4, cardY, W - 8, cardH);

  // Label + Filter
  drawMarke(17, cardY + 10, 6);
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setTextSize(1);
  tft->setCursor(28, cardY + 7);
  tft->print(data.hasBalance ? "KONTOSTAND" : "P&L GESAMT");

  const char* fLbl = cfgFilter == "month" ? "Monat" :
                     cfgFilter == "week"  ? "Woche" :
                     cfgFilter == "year"  ? "Jahr"  : "Alle";
  tft->setTextColor(COLOR_YELLOW, COLOR_CARD);
  int fLblX = W - 16 - (int)strlen(fLbl) * 6;
  tft->setCursor(fLblX, cardY + 7);
  tft->print(fLbl);

  if (data.hasBalance) {
    String balStr = "$" + String(data.balance, 2);
    tft->setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    tft->setTextSize(2);
    tft->setCursor(12, cardY + wertY);
    tft->print(passt(balStr, W - 24, 2));
    zeichneHeute(12, cardY + heuteY);
    String perfStr = "Perf " + String(data.balancePerf >= 0 ? "+" : "") + String(data.balancePerf, 1) + "%";
    tft->setTextColor(pnlColor(data.balancePerf), COLOR_CARD);
    if (perfZeile) tft->setCursor(12, cardY + heuteY + 12);
    else           tft->setCursor(W - 100, cardY + heuteY);
    tft->print(perfStr);
  } else {
    String totStr = (data.totalPnL >= 0 ? "+" : "") + String(data.totalPnL, 2) + " USDT";
    tft->setTextColor(pnlColor(data.totalPnL), COLOR_CARD);
    tft->setTextSize(2);
    tft->setCursor(12, cardY + wertY);
    tft->print(passt(totStr, W - 24, 2));
    zeichneHeute(12, cardY + heuteY);
  }

  // ── Volumen (kompakt, 2 Zeilen) ───────────────────
  int volY = cardY + cardH + 4;
  tft->drawFastHLine(0, volY, W, COLOR_GREY_DARK);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(8, volY + 5);
  tft->print("Vol 30d");
  String v30 = "$" + fmtVol(data.volume30d);
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft->setCursor(W - 4 - (int)v30.length() * 6, volY + 5);
  tft->print(v30);

  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setCursor(8, volY + 17);
  tft->print("Vol Total");
  String vtot = "$" + fmtVol(data.volumeTotal);
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_BG);
  tft->setCursor(W - 4 - (int)vtot.length() * 6, volY + 17);
  tft->print(vtot);

  // ── Trennlinie vor Donuts ─────────────────────────
  int donutY = volY + 30;
  tft->drawFastHLine(0, donutY, W, COLOR_GREY_DARK);

  char wrStr[10];
  snprintf(wrStr, sizeof(wrStr), "%.0f%%", data.winRate);
  uint16_t wrCol = data.winRate >= 50 ? COLOR_GREEN : (data.winRate >= 40 ? COLOR_YELLOW : COLOR_RED);
  char satStr[10];
  snprintf(satStr, sizeof(satStr), "%.0f%%", data.satisfaction);
  uint16_t satCol = data.satisfaction >= 50 ? COLOR_GREEN : (data.satisfaction >= 30 ? COLOR_YELLOW : COLOR_RED);
  char rrrStr[12];
  snprintf(rrrStr, sizeof(rrrStr), "1:%.1f", data.rrr);
  float rrrPct = constrain(data.rrr / 3.0f * 100.0f, 0, 100);
  uint16_t rrrCol = data.rrr >= 1.5f ? COLOR_GREEN : (data.rrr >= 1.0f ? COLOR_YELLOW : COLOR_RED);

  if (!hoch) {
    // ── 3 Donuts nebeneinander ──────────────────────
    // Ohne Banner wie bisher (Mitte 46 unter der Linie), mit Banner 2 px enger.
    int cy = donutY + (banner ? 44 : 46);
    const int r = 34, ir = 23;
    drawDonut(W * 55 / 320,  cy, r, ir, data.winRate, wrCol, "Win Rate", wrStr);
    drawDonut(W / 2,         cy, r, ir, data.satisfaction, satCol, "Zufried.", satStr);
    drawDonut(W * 265 / 320, cy, r, ir, rrrPct, rrrCol, "RRR", rrrStr);
  } else {
    // ── Hochformat: 2 + 1 Donuts untereinander ──────
    // Je Reihe: 6 Luft, Ring 2r, Beschriftung 4 + 8 → bei r=30 78 px.
    const int r = 30, ir = 20;
    int cy1 = donutY + 6 + r;
    int cy2 = cy1 + r + 12 + 6 + r;
    drawDonut(W / 4,     cy1, r, ir, data.winRate, wrCol, "Win Rate", wrStr);
    drawDonut(W * 3 / 4, cy1, r, ir, data.satisfaction, satCol, "Zufried.", satStr);
    drawDonut(W / 2,     cy2, r, ir, rrrPct, rrrCol, "RRR", rrrStr);
  }
}

// ── Logo-Marke: die Blüte aus dem AutarkTrade-Zeichen, vereinfacht ────
// Fünf Blätter als Kreise um die Mitte, dunkler Kern mit Akzentrand. Der
// Kursring des grossen Zeichens verschwimmt bei 18 px — er fehlt hier bewusst.
void drawMarke(int cx, int cy, int r) {
  const float blatt = r * 0.42f;
  const float abstand = r * 0.55f;
  for (int i = 0; i < 5; i++) {
    float w = (-90.0f + i * 72.0f) * DEG_TO_RAD;
    tft->fillCircle(cx + (int)roundf(cosf(w) * abstand), cy + (int)roundf(sinf(w) * abstand),
                   (int)roundf(blatt), COLOR_BLUE);
  }
  tft->fillCircle(cx, cy, max(1, r / 4), COLOR_KERN);
  tft->drawCircle(cx, cy, max(1, r / 4), COLOR_BLUE);
}

// ── SCREEN 2: Offene Positionen (quer 320×207, hoch 240×287) ──
// Kopf rechts: Summe der Futures-PnL (Betrag oder % der Marge) — Tipp auf
// den Kopf schaltet Betrag/Prozent um (wird gespeichert).
// Quer:  Futures Symbol 4 | Side 72 | Heb. 104 | PnL 140 | real. 228
//        Bots    Symbol 4 | Side 52 | Heb. 80  | PnL 108 | Grid 178 | Liq 252
// Hoch:  Futures Symbol 4 | L/S 50  | Heb. 62  | PnL 94  | real. 166
//        Bots    Symbol 4 | L/S 50  | PnL 62   | Grid 122 | Liq 182 (ohne Hebel)

static String kurzSymbol(const String& s) {
  String sym = s;
  if (sym.endsWith("USDT")) sym = sym.substring(0, sym.length() - 4);
  if (sym.length() > 7) sym = sym.substring(0, 7);
  return sym;
}

// Bot-Betrag: USDT 2 Stellen, Margin-Coin 4 Stellen (die Münze steht in der Bot-Kopfzeile).
static String botBetrag(float v, bool usdt) {
  char s[16];
  snprintf(s, sizeof(s), usdt ? "%+.2f" : "%+.4f", v);
  return String(s);
}

static void zeichneLiq(float liq, int x, int y) {
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setCursor(x, y);
  if (liq > 0) {
    char liqStr[14];
    if      (liq >= 1000) snprintf(liqStr, sizeof(liqStr), "%.0f", liq);
    else if (liq >= 1)    snprintf(liqStr, sizeof(liqStr), "%.3f", liq);
    else                  snprintf(liqStr, sizeof(liqStr), "%.5f", liq);
    tft->print(liqStr);
  } else {
    tft->print("-");
  }
}

void drawScreen2() {
  const int W = schirmB;
  const bool hoch = hochformat();
  const int fussY = navY() - 14;            // Statuszeile unten (quer 193)
  tft->fillRect(0, 0, W, navY(), COLOR_BG);

  int nFut = data.positions.size();
  int nBot = data.bots.size();

  // Spalten je Format (siehe Kopfkommentar)
  const int fSide = hoch ? 50 : 72,  fHeb = hoch ? 62 : 104, fPnl = hoch ? 94 : 140, fReal = hoch ? 166 : 228;
  const int bSide = hoch ? 50 : 52,  bHeb = 80,              bPnl = hoch ? 62 : 108,
            bGrid = hoch ? 122 : 178, bLiq = hoch ? 182 : 252;

  // ── Header ────────────────────────────────────────
  tft->fillRect(0, 0, W, 24, COLOR_HEADER_BG);
  tft->drawFastHLine(0, 24, W, COLOR_GREY_DARK);
  drawMarke(12, 12, 9);
  tft->setTextSize(1);
  tft->setCursor(26, 5);
  tft->setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft->print("Autark");
  tft->setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft->print("Trade");
  tft->setTextColor(COLOR_GREY, COLOR_HEADER_BG);
  tft->setCursor(26, 16);
  tft->print(hoch ? "Positionen & Bots" : "Offene Positionen & Bots");

  // Summe der Futures (Bots nicht: verschiedene Margin-Coins sind nicht summierbar)
  {
    const char* lbl = hoch ? (cfgPnlProzent ? "% Marge [Tipp]" : "USDT [Tipp]")
                           : (cfgPnlProzent ? "Summe % Marge  [Tipp]" : "Summe USDT  [Tipp]");
    tft->setTextColor(COLOR_GREY, COLOR_HEADER_BG);
    tft->setCursor(W - 4 - (int)strlen(lbl) * 6, 4);
    tft->print(lbl);
    String sumStr = "-";
    uint16_t sumCol = COLOR_GREY;
    if (nFut > 0) {
      float sum = 0, sumMarge = 0;
      for (auto& p : data.positions) { sum += p.unrealizedPNL; sumMarge += margePosition(p); }
      if (cfgPnlProzent) sumStr = prozentText(sum, sumMarge);
      else               { char s[20]; snprintf(s, sizeof(s), "%+.2f", sum); sumStr = s; }
      if (sumStr != "-") sumCol = pnlColor(sum);
    }
    tft->setTextColor(sumCol, COLOR_HEADER_BG);
    tft->setCursor(W - 4 - (int)sumStr.length() * 6, 15);
    tft->print(sumStr);
  }

  if (nFut == 0 && nBot == 0) {
    int my = navY() / 2;
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->setCursor(8, my + 7);
    tft->print(datenVeraltet() ? "Keine Positionen im letzten Stand" : "Keine offenen Positionen");
    if (datenVeraltet()) {
      tft->setTextColor(COLOR_RED, COLOR_BG);
      tft->setCursor(8, my + 22);
      tft->print("VERALTET - Stand vor " + alterText());
      tft->setTextColor(COLOR_GREY, COLOR_BG);
    }
    tft->setCursor(W - 50, fussY);
    tft->print("v" FW_VERSION);
    return;
  }

  // Zeilen-Budget: Zeilen à 20 px zwischen Tabellenkopf (47) und Statuszeile;
  // quer 7, hoch 11. Mit Futures UND Bots kostet die Bot-Kopfzeile 16 px.
  int futCap, botCap;
  const int platz = fussY - 4 - 47;
  if      (nBot == 0) { futCap = min(nFut, platz / 20); botCap = 0; }
  else if (nFut == 0) { futCap = 0;                     botCap = min(nBot, platz / 20); }
  else {
    int zeilen = (platz - 16) / 20;                      // quer 6, hoch 10
    futCap = min(nFut, zeilen / 2);
    botCap = min(nBot, zeilen - futCap);
    futCap = min(nFut, zeilen - botCap);                 // Rest an die Futures
  }

  int y = 30;

  // ── Futures ───────────────────────────────────────
  // Hochformat: Seite nur als L/S, Spalten enger.
  if (futCap > 0) {
    // Tabellen-Header (y=28)
    tft->drawFastHLine(0, 28, W, COLOR_GREY_DARK);
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->setCursor(4,     32); tft->print("Symbol");
    tft->setCursor(fSide, 32); tft->print(hoch ? "S" : "Side");
    tft->setCursor(fHeb,  32); tft->print("Heb.");
    tft->setCursor(fPnl,  32); tft->print(cfgPnlProzent ? "PnL %" : "PnL");
    tft->setCursor(fReal, 32); tft->print(cfgPnlProzent ? "real. %" : "real.");
    tft->drawFastHLine(0, 44, W, COLOR_GREY_DARK);
    y = 47;
  }

  for (int i = 0; i < futCap; i++) {
    auto& p = data.positions[i];
    float marge = margePosition(p);
    bool lang = p.side == "BUY" || p.side == "LONG";

    tft->setTextColor(COLOR_WHITE, COLOR_BG);
    tft->setCursor(4, y);
    tft->print(kurzSymbol(p.symbol));

    tft->setTextColor(lang ? COLOR_GREEN : COLOR_RED, COLOR_BG);
    tft->setCursor(fSide, y);
    tft->print(hoch ? (lang ? "L" : "S") : p.side.substring(0, 4));

    tft->setTextColor(COLOR_WHITE, COLOR_BG);
    tft->setCursor(fHeb, y);
    char hebStr[8];
    snprintf(hebStr, sizeof(hebStr), "%dx", (int)p.leverage);
    tft->print(hebStr);

    String unr;
    if (cfgPnlProzent) unr = prozentText(p.unrealizedPNL, marge);
    else { char s[16]; snprintf(s, sizeof(s), "%+.2f", p.unrealizedPNL); unr = s; }
    tft->setTextColor(unr == "-" ? COLOR_GREY : pnlColor(p.unrealizedPNL), COLOR_BG);
    tft->setCursor(fPnl, y);
    tft->print(passt(unr, fReal - fPnl - 4));

    tft->setCursor(fReal, y);
    if (p.realizedPNL != 0.0f) {
      String real;
      if (cfgPnlProzent) real = prozentText(p.realizedPNL, marge);
      else { char s[16]; snprintf(s, sizeof(s), "%+.2f", p.realizedPNL); real = s; }
      tft->setTextColor(real == "-" ? COLOR_GREY : pnlColor(p.realizedPNL), COLOR_BG);
      tft->print(passt(real, W - fReal - 2));
    } else {
      tft->setTextColor(COLOR_GREY, COLOR_BG);
      tft->print("-");
    }

    tft->drawFastHLine(0, y + 15, W, COLOR_GREY_DARK);
    y += 20;
  }

  // ── Bots (PnL/Grid/Marge in marginCoin, auf Wunsch in USDT) ──
  // Hochformat: ohne Hebel, die Einheit steht beim PnL-Kopf.
  if (botCap > 0) {
    // Münzen-Hinweis: Beträge ohne Einheit in der Zeile, darum hier einmal
    bool alleUsdt = true;
    String coin;
    for (int i = 0; i < botCap; i++) {
      if (!botInUsdt(data.bots[i])) {
        if (coin.isEmpty()) coin = data.bots[i].marginCoin;
        else if (coin != data.bots[i].marginCoin) coin = "Coin";
        alleUsdt = false;
      }
    }
    String einheit = cfgPnlProzent ? "% Marge" : alleUsdt ? "USDT" : coin.substring(0, hoch ? 5 : 6);
    tft->setTextColor(COLOR_BLUE, COLOR_BG);
    tft->setCursor(4, y);
    char botHdr[24];
    snprintf(botHdr, sizeof(botHdr), "BOTS (%d)", nBot);
    tft->print(botHdr);
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    if (hoch) {
      tft->setCursor(bPnl, y); tft->print(cfgPnlProzent ? String("PnL %") : "PnL " + einheit);
    } else {
      tft->setCursor(64, y);   tft->print(einheit);
      tft->setCursor(bPnl, y); tft->print("PnL");
    }
    tft->setCursor(bGrid, y); tft->print("Grid");
    tft->setCursor(bLiq, y);  tft->print("Liq");
    tft->drawFastHLine(0, y + 13, W, COLOR_GREY_DARK);
    y += 16;

    for (int i = 0; i < botCap; i++) {
      auto& b = data.bots[i];
      float f   = botFaktor(b);
      bool usdt = botInUsdt(b);
      float pnl = b.unrealizedPNL * f;
      bool lang = b.side == "BUY" || b.side == "LONG";

      tft->setTextColor(COLOR_WHITE, COLOR_BG);
      tft->setCursor(4, y);
      tft->print(kurzSymbol(b.symbol));

      tft->setTextColor(lang ? COLOR_GREEN : COLOR_RED, COLOR_BG);
      tft->setCursor(bSide, y);
      tft->print(hoch ? (lang ? "L" : "S") : b.side.substring(0, 4));

      if (!hoch) {
        tft->setTextColor(COLOR_WHITE, COLOR_BG);
        tft->setCursor(bHeb, y);
        char hebStr[8];
        snprintf(hebStr, sizeof(hebStr), "%dx", (int)b.leverage);
        tft->print(hebStr);
      }

      String pnlStr = cfgPnlProzent ? prozentText(pnl, b.margin * f) : botBetrag(pnl, usdt);
      tft->setTextColor(pnlStr == "-" ? COLOR_GREY : pnlColor(pnl), COLOR_BG);
      tft->setCursor(bPnl, y);
      tft->print(passt(pnlStr, bGrid - bPnl - 4));

      // Grid-Gewinn: null/fehlt → „-"; in % ebenfalls bezogen auf die Marge
      String gridStr = "-";
      float grid = b.gridProfit * f;
      if (b.hatGrid) gridStr = cfgPnlProzent ? prozentText(grid, b.margin * f) : botBetrag(grid, usdt);
      tft->setTextColor(gridStr == "-" ? COLOR_GREY : pnlColor(grid), COLOR_BG);
      tft->setCursor(bGrid, y);
      tft->print(passt(gridStr, bLiq - bGrid - 4));

      zeichneLiq(b.liqPrice, bLiq, y);

      tft->drawFastHLine(0, y + 15, W, COLOR_GREY_DARK);
      y += 20;
    }
  }

  // ── Footer: Alter des Stands (die Uhr läuft ohne NTP, daher kein Zeitpunkt) ──
  if (datenVeraltet()) {
    tft->fillRect(0, fussY - 4, W - 58, 16, COLOR_RED);
    tft->setTextColor(COLOR_WHITE, COLOR_RED);
    tft->setCursor(8, fussY);
    tft->print(passt("VERALTET - Stand vor " + alterText(), W - 70));
  } else {
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->setCursor(8, fussY);
    tft->print("Stand: vor " + alterText());
  }
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setCursor(W - 50, fussY);
  tft->print("v" FW_VERSION);
}

// ── SCREEN 3: Info-Screen ────────────────────────────────
// Zeigt aktuellen Filter (vom Server gesteuert) + Verbindungsinfos.
// Tap → zurück zum Dashboard + Daten neu laden.

struct FilterOption { const char* key; const char* label; const char* sub; };
static const FilterOption FILTER_OPTS[] = {
  { "all",   "Gesamtzeitraum",   "alle Trades" },
  { "year",  "Aktuelles Jahr",   "1. Jan bis heute" },
  { "month", "Aktueller Monat",  "laufender Kalendermonat" },
  { "week",  "Aktuelle Woche",   "Mo. bis So." },
};

void drawScreen3() {
  const int W = schirmB;
  const bool hoch = hochformat();
  tft->fillRect(0, 0, W, navY(), COLOR_BG);

  // Header
  tft->fillRect(0, 0, W, 22, COLOR_HEADER_BG);
  tft->drawFastHLine(0, 22, W, COLOR_GREY_DARK);
  tft->setTextColor(COLOR_BLUE, COLOR_HEADER_BG);
  tft->setTextSize(1);
  tft->setCursor(8, 7);
  tft->print("ZEITRAUM & INFO");

  // Aktiver Filter — vom Server
  fillCard(6, 30, W - 12, 52);
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setTextSize(1);
  tft->setCursor(18, 40);
  tft->print("Aktiver Zeitraum (vom Server):");

  // Aktuellen Filter anzeigen
  const char* fLabel = cfgFilter == "month" ? "Aktueller Monat"  :
                       cfgFilter == "week"  ? "Aktuelle Woche"   :
                       cfgFilter == "year"  ? "Aktuelles Jahr"   : "Gesamtzeitraum";
  tft->setTextColor(COLOR_WHITE, COLOR_CARD);
  tft->setTextSize(1);
  tft->setCursor(18, 54);
  tft->print(fLabel);

  // Hinweis: Einstellung in der App (hoch: Pfad auf zwei Zeilen)
  const int hinweisH = hoch ? 52 : 40;
  fillCard(6, 92, W - 12, hinweisH);
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setTextSize(1);
  tft->setCursor(18, 102);
  tft->print("Aendern: App");
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft->setCursor(18, 115);
  if (hoch) {
    tft->print("Einstellungen > ESP32 Display");
    tft->setCursor(18, 127);
    tft->print("> Zeitraum");
  } else {
    tft->print("Einstellungen > ESP32 Display > Zeitraum");
  }

  // Verbindungsinfo (hoch: „Tap: Dashboard" in eigener Zeile)
  const int vy = 92 + hinweisH + 10;
  fillCard(6, vy, W - 12, hoch ? 66 : 54);
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setTextSize(1);
  tft->setCursor(18, vy + 10);
  tft->print("Server:");
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft->setCursor(72, vy + 10);
  tft->print(passt(cfgHost + ":" + cfgPort, W - 84));
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setCursor(18, vy + 24);
  tft->print("WLAN:");
  tft->setTextColor(WiFi.status() == WL_CONNECTED ? COLOR_GREEN : COLOR_RED, COLOR_CARD);
  tft->setCursor(72, vy + 24);
  tft->print(WiFi.status() == WL_CONNECTED ? passt(cfgSSID, W - 84) : String("getrennt"));
  tft->setTextColor(COLOR_GREY, COLOR_CARD);
  tft->setCursor(18, vy + 38);
  tft->print("Firmware:");
  tft->setTextColor(COLOR_WHITE_DIM, COLOR_CARD);
  tft->setCursor(80, vy + 38);
  tft->print("v" FW_VERSION);
  if (hoch) tft->setCursor(18, vy + 52);
  else      tft->setCursor(W - 120, vy + 38);
  tft->print("Tap: Dashboard");
}

// ── Kurs-Chart-Seite ─────────────────────────────────────
// Wie im Desklet: Linie mit dezenter Fläche oder Kerzen grün/rot, gestrichelt
// der Startkurs, rechts Preisachse mit runden Stufen und Marke mit aktuellem
// Kurs, Kopf mit Symbol · Zeitraum, Kurs und Änderung %.
// Tipp auf den Kopf: nächster Zeitraum; Tipp in den Chart: Linie/Kerzen.
// Hochformat: Kopf zweizeilig (Kurs unter dem Symbol, T/H rechts), sonst gleich.

int chartKopfH() { return hochformat() ? 38 : 27; }   // Unterkante des Kopfs (Tippfläche)
int chartOben()  { return chartKopfH() + 5; }         // Zeichenfläche oben (quer 32)
int chartUnten() { return navY() - 17; }              // … unten (quer 190, darunter Statuszeile)

// Kurs als Text: ≥1000 eine Stelle, ≥1 drei, darunter vier gültige Ziffern.
String chartPreis(double n) {
  char s[20];
  if (n >= 1000)   snprintf(s, sizeof(s), "%.1f", n);
  else if (n >= 1) snprintf(s, sizeof(s), "%.3f", n);
  else if (n > 0) {
    int st = constrain(3 - (int)floor(log10(n)), 0, 10);
    snprintf(s, sizeof(s), "%.*f", st, n);
  } else snprintf(s, sizeof(s), "%.2f", n);
  return String(s);
}

// Runde Achsenschritte (1-2-2.5-5 × 10^n): der dem Ziel (Spanne/4) nächste
// Schritt im Verhältnis, nicht der nächstgrössere — sonst oft nur zwei Linien.
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
  int st = constrain(-(int)floor(log10(schritt) + 1e-9), 0, 8);
  if (fmod(schritt * pow(10, st), 1.0) > 1e-6) st++;   // 2.5er-Schritte
  char s[20];
  snprintf(s, sizeof(s), "%.*f", st, v);
  return String(s);
}

// Kerzenzahl für den Abruf: etwa Chartbreite/3 bei Kerzen, /2 bei Linie.
int kursAnzahl() {
  const int breite = schirmB - 58;   // Breite minus Preisachse (geschätzt)
  return constrain(cfgChartKerzen ? breite / 3 : breite / 2, 10, 200);
}

static void chartHinweis(const char* zeile1, const char* zeile2) {
  const int mx = schirmB / 2, my = (chartOben() + chartUnten()) / 2;   // quer 160 / 111
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(mx - (int)strlen(zeile1) * 3, my - 11);
  tft->print(zeile1);
  if (zeile2) {
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->setCursor(mx - (int)strlen(zeile2) * 3, my + 3);
    tft->print(zeile2);
  }
}

static const char* kursFehlerText() {
  switch (kursZustand) {
    case KURS_SYMBOL:     return "Symbol unbekannt";
    case KURS_SCHLUESSEL: return "Kein Zugang (API-Key)";
    case KURS_ALT:        return "Server kennt /kurs nicht (zu alt)";
    case KURS_AUS:        return "Marktdaten in der App aus";
    case KURS_NETZ:       return "Server nicht erreicht";
    case KURS_BREMSE:     return "Server bremst - spaeter";
    default:              return nullptr;
  }
}

void drawChartScreen() {
  const int W = schirmB;
  const bool hoch = hochformat();
  const int kopfH = chartKopfH();
  tft->fillRect(0, 0, W, navY(), COLOR_BG);
  tft->setTextSize(1);

  // ── Kopf: Symbol · Zeitraum | Kurs  Änderung % ───────
  tft->fillRect(0, 0, W, kopfH, COLOR_HEADER_BG);
  tft->drawFastHLine(0, kopfH, W, COLOR_GREY_DARK);
  String sym = kurs.gueltig ? kurs.symbol : saeubereSymbol(cfgChartSymbol);
  String spn = kurs.gueltig ? kurs.spanne : cfgChartSpanne;
  tft->setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
  tft->setCursor(8, 5);
  tft->print(sym);
  int px = 8 + sym.length() * 6 + 5;
  tft->fillCircle(px, 8, 1, COLOR_GREY);          // „·" (der GLCD-Font hat keinen Mittelpunkt)
  tft->setTextColor(COLOR_YELLOW, COLOR_HEADER_BG);
  tft->setCursor(px + 5, 5);
  tft->print(spn);

  if (kurs.gueltig && !hoch) {
    tft->setTextColor(COLOR_GREY, COLOR_HEADER_BG);
    tft->setCursor(8, 16);
    tft->print("T " + chartPreis(kurs.tief) + "  H " + chartPreis(kurs.hoch));

    char aend[16];
    snprintf(aend, sizeof(aend), "%+.2f %%", kurs.aenderung);
    int ax = W - 4 - (int)strlen(aend) * 6;
    tft->setTextColor(kurs.aenderung >= 0 ? COLOR_GREEN : COLOR_RED, COLOR_HEADER_BG);
    tft->setCursor(ax, 10);
    tft->print(aend);
    String preis = chartPreis(kurs.jetzt);
    tft->setTextSize(2);
    tft->setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
    tft->setCursor(ax - 8 - (int)preis.length() * 12, 6);
    tft->print(preis);
    tft->setTextSize(1);
  } else if (kurs.gueltig) {
    // Hochformat: oben rechts Änderung, darunter links Kurs (gross), rechts H und T
    char aend[16];
    snprintf(aend, sizeof(aend), "%+.2f %%", kurs.aenderung);
    tft->setTextColor(kurs.aenderung >= 0 ? COLOR_GREEN : COLOR_RED, COLOR_HEADER_BG);
    tft->setCursor(W - 4 - (int)strlen(aend) * 6, 5);
    tft->print(aend);
    String hoechst = "H " + chartPreis(kurs.hoch), tiefst = "T " + chartPreis(kurs.tief);
    int hx = W - 4 - (int)max(hoechst.length(), tiefst.length()) * 6;
    tft->setTextColor(COLOR_GREY, COLOR_HEADER_BG);
    tft->setCursor(hx, 17); tft->print(hoechst);
    tft->setCursor(hx, 27); tft->print(tiefst);
    tft->setTextSize(2);
    tft->setTextColor(COLOR_WHITE, COLOR_HEADER_BG);
    tft->setCursor(8, 18);
    tft->print(passt(chartPreis(kurs.jetzt), hx - 16, 2));
    tft->setTextSize(1);
  }

  const char* fehler = kursFehlerText();
  if (!kurs.gueltig || kurs.kerzen.size() < 2) {
    chartHinweis(fehler ? fehler : (WiFi.status() == WL_CONNECTED ? "Lade Kurs ..." : "Kein WLAN"),
                 !fehler ? nullptr : hoch ? "Oben: Zeitraum, hier: Linie/Kerzen"
                                          : "Tipp oben: Zeitraum, Tipp hier: Linie/Kerzen");
    return;
  }

  // ── Wertebereich ─────────────────────────────────────
  const auto& k = kurs.kerzen;
  int n = k.size();
  bool kerzenArt = cfgChartKerzen;
  double mn = 1e30, mx = -1e30;
  for (auto& c : k) {
    double lo = kerzenArt ? c.l : c.c, hi = kerzenArt ? c.h : c.c;
    if (lo < mn) mn = lo;
    if (hi > mx) mx = hi;
  }
  double spann = (mx - mn) > 0 ? (mx - mn) : (fabs(mx) > 0 ? fabs(mx) / 100 : 1);
  if (!((mx - mn) > 0)) { mn -= spann / 2; mx += spann / 2; spann = mx - mn; }
  bool steigt = k[n - 1].c >= k[0].o;
  uint16_t farbe = steigt ? COLOR_GREEN : COLOR_RED;
  double jetzt = k[n - 1].c;

  // ── Achse: Breite nach dem längsten Text, damit nichts darunter läuft ──
  double schritt = achsenSchritt(mn, mx);
  String jetztText = chartPreis(jetzt);
  int textB = jetztText.length() * 6;
  int stufenZahl = 0;
  for (double v = ceil(mn / schritt) * schritt; v <= mx + schritt * 1e-9 && stufenZahl < 12; v += schritt, stufenZahl++)
    textB = max(textB, (int)achsenText(v, schritt).length() * 6);
  const int x0 = 2;
  int b = max(100, W - textB - 12) - x0;       // Breite der Zeichenfläche
  const int oben = chartOben(), unten = chartUnten(), rand = 4;
  auto yVon = [&](double v) -> int {
    return oben + rand + (int)lround((1.0 - (v - mn) / spann) * (unten - oben - 2 * rand));
  };
  // Linie: Punkte von Rand zu Rand; Kerzen: je Kerze ein Fach, Mitte darin
  float fach = (float)b / n;
  auto xVon = [&](int i) -> int {
    return x0 + (kerzenArt ? (int)((i + 0.5f) * fach) : (int)lround((float)i / (n - 1) * b));
  };

  // ── Fläche unter der Linie (zuerst, Gitter darüber) ──
  // Verlauf von 28 % Deckkraft oben nach 0 unten, in 8-px-Bändern.
  if (!kerzenArt) {
    const int band = 8;
    for (int i = 0; i < n - 1; i++) {
      int xa = xVon(i), xb = xVon(i + 1);
      int ya = yVon(k[i].c), yb = yVon(k[i + 1].c);
      for (int x = xa; x < xb || (i == n - 2 && x == xb); x++) {
        int yl = xb > xa ? ya + (yb - ya) * (x - xa) / (xb - xa) : ya;
        for (int yy = yl; yy < unten; ) {
          int ende = min(unten, oben + ((yy - oben) / band + 1) * band);
          uint8_t alpha = (uint8_t)(71.0f * (1.0f - (float)(yy - oben) / (unten - oben)));
          tft->drawFastVLine(x, yy, ende - yy, tft->alphaBlend(alpha, farbe, COLOR_BG));
          yy = ende;
        }
      }
    }
  }

  // ── Gitter und Beschriftung ──────────────────────────
  uint16_t gitter = tft->alphaBlend(40, COLOR_WHITE_DIM, COLOR_BG);
  stufenZahl = 0;
  for (double v = ceil(mn / schritt) * schritt; v <= mx + schritt * 1e-9 && stufenZahl < 12; v += schritt, stufenZahl++) {
    int yy = yVon(v);
    for (int x = x0; x < x0 + b; x += 2) tft->drawPixel(x, yy, gitter);   // fein, stört die Fläche kaum
    tft->setTextColor(COLOR_WHITE_DIM, COLOR_BG);
    tft->setCursor(x0 + b + 8, yy - 3);
    tft->print(achsenText(v, schritt));
  }

  // ── Startkurs gestrichelt ────────────────────────────
  {
    int ys = yVon(kerzenArt ? k[0].o : k[0].c);
    for (int x = x0; x < x0 + b; x += 6) tft->drawFastHLine(x, ys, 3, COLOR_GREY);
  }

  if (kerzenArt) {
    // Kerzen: grün steigend, rot fallend; Docht 1 px, Körper ~70 % des Fachs
    int koerper = constrain((int)(fach * 0.7f), 1, 9);
    for (int i = 0; i < n; i++) {
      const auto& c = k[i];
      uint16_t f = c.c >= c.o ? COLOR_GREEN : COLOR_RED;
      int mitte = xVon(i);
      int yh = yVon(c.h), yl = yVon(c.l);
      tft->drawFastVLine(mitte, yh, max(1, yl - yh + 1), f);
      int yo = yVon(max(c.o, c.c)), yu = yVon(min(c.o, c.c));
      tft->fillRect(mitte - koerper / 2, yo, koerper, max(1, yu - yo), f);
    }
  } else {
    // Linie (2 px) und letzter Kurs als Punkt
    for (int i = 0; i < n - 1; i++) {
      int xa = xVon(i), xb = xVon(i + 1), ya = yVon(k[i].c), yb = yVon(k[i + 1].c);
      tft->drawLine(xa, ya, xb, yb, farbe);
      tft->drawLine(xa, ya + 1, xb, yb + 1, farbe);
    }
    tft->fillCircle(xVon(n - 1), yVon(jetzt), 3, farbe);
  }

  // ── Letzter Kurs als Marke auf der Achse ─────────────
  {
    const int markeH = 13;
    int my = constrain(yVon(jetzt) - markeH / 2, oben, unten - markeH);
    tft->fillRect(x0 + b + 4, my, W - (x0 + b + 4), markeH, farbe);
    tft->setTextColor(COLOR_CARD, farbe);
    tft->setCursor(x0 + b + 8, my + 3);
    tft->print(jetztText);
  }

  // ── Statuszeile ──────────────────────────────────────
  tft->setCursor(4, navY() - 11);
  if (fehler) {
    tft->setTextColor(COLOR_YELLOW, COLOR_BG);
    tft->print(passt(String(fehler) + " - Stand vor " + String((millis() - kursOkMs) / 1000) + " s", W - 8));
  } else {
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->print(hoch ? "Oben: Zeitraum | Chart: Linie/Kerzen" : "Tipp oben: Zeitraum | im Chart: Linie/Kerzen");
  }
}

// ── Verbindungs-/Fehler-Screens ──────────────────────────

// Mittig in der Höhe (quer wie bisher y=112 bzw. 85/120).
void drawConnecting(const char* msg) {
  schirmLeeren(COLOR_BG);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(10, schirmH / 2 - 8);
  tft->print(msg);
}

void drawStartupError(const char* title, const char* detail) {
  schirmLeeren(COLOR_BG);
  tft->setTextColor(COLOR_RED, COLOR_BG);
  tft->setTextSize(2);
  tft->setCursor(10, schirmH / 2 - 35);
  tft->print(title);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(10, schirmH / 2);
  tft->print(passt(detail, schirmB - 20));
}

// ── Aktuellen Screen zeichnen ────────────────────────────

void drawCurrentScreen() {
  if (activeScreen == SEITE_CHART && !cfgChart) activeScreen = SEITE_DASHBOARD;
  if      (activeScreen == SEITE_DASHBOARD)  drawScreen1();
  else if (activeScreen == SEITE_POSITIONEN) drawScreen2();
  else if (activeScreen == SEITE_CHART)      drawChartScreen();
  else                                       drawScreen3();
  drawNavBar();
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
  .chk { display: flex; align-items: center; gap: 10px; color: #e8f4f6; font-size: 0.9rem; margin-top: 10px; cursor: pointer; }
  .chk input { width: auto; margin: 0; accent-color: #1fd6c4; transform: scale(1.3); }
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
    <label class="chk"><input type="checkbox" name="pnlpct" value="1" %PNLPCT%> PnL in Prozent der Marge (wie ROE)</label>
    <div class="info">Auch am Ger&auml;t: Tipp auf den Kopf der Seite Positionen.</div>
    <label class="chk"><input type="checkbox" name="botusdt" value="1" %BOTUSDT%> Bot-Werte in USDT umrechnen (Coin-M)</label>
    <label>Ausrichtung</label>
    <select name="dreh">
      <option value="3" %DREH_3%>Querformat</option>
      <option value="0" %DREH_0%>Hochformat</option>
      <option value="1" %DREH_1%>Querformat 180&deg; gedreht</option>
      <option value="2" %DREH_2%>Hochformat 180&deg; gedreht</option>
    </select>
  </div>
  <div class="card">
    <h2>Kurs-Chart</h2>
    <label class="chk"><input type="checkbox" name="chart" value="1" %CHART%> Chart-Seite anzeigen</label>
    <label>Symbol (z.B. BTC, ETH, SOL)</label>
    <input name="csym" type="text" value="%CSYM%" placeholder="BTC" maxlength="20" autocomplete="off">
    <label>Zeitraum</label>
    <select name="cspan">
      <option value="1h" %SP_1H%>1 Stunde</option>
      <option value="24h" %SP_24H%>24 Stunden</option>
      <option value="7d" %SP_7D%>7 Tage</option>
      <option value="30d" %SP_30D%>30 Tage</option>
    </select>
    <label>Darstellung</label>
    <select name="cart">
      <option value="linie" %ART_LINIE%>Linie</option>
      <option value="kerzen" %ART_KERZEN%>Kerzen</option>
    </select>
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
  html.replace("%PNLPCT%",   cfgPnlProzent ? "checked" : "");
  html.replace("%BOTUSDT%",  cfgBotUsdt    ? "checked" : "");
  html.replace("%DREH_0%",   cfgDreh == 0  ? "selected" : "");
  html.replace("%DREH_1%",   cfgDreh == 1  ? "selected" : "");
  html.replace("%DREH_2%",   cfgDreh == 2  ? "selected" : "");
  html.replace("%DREH_3%",   cfgDreh == 3  ? "selected" : "");
  html.replace("%CHART%",    cfgChart      ? "checked" : "");
  html.replace("%CSYM%",     htmlEscape(cfgChartSymbol));
  html.replace("%SP_1H%",    cfgChartSpanne == "1h"  ? "selected" : "");
  html.replace("%SP_24H%",   cfgChartSpanne == "24h" ? "selected" : "");
  html.replace("%SP_7D%",    cfgChartSpanne == "7d"  ? "selected" : "");
  html.replace("%SP_30D%",   cfgChartSpanne == "30d" ? "selected" : "");
  html.replace("%ART_LINIE%",  cfgChartKerzen ? "" : "selected");
  html.replace("%ART_KERZEN%", cfgChartKerzen ? "selected" : "");
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
  saveConfig(ssid, pass, host, port, key);
  // Anzeige: Checkbox nicht angehakt = Feld fehlt in der Anfrage
  String spanne = server.arg("cspan");
  if (spanne != "1h" && spanne != "24h" && spanne != "7d" && spanne != "30d") spanne = "24h";
  // Ausrichtung: nur 0..3, sonst die bisherige
  String drehArg = server.arg("dreh");
  int dreh = (drehArg.length() == 1 && drehArg[0] >= '0' && drehArg[0] <= '3') ? drehArg[0] - '0' : cfgDreh;
  saveAnzeige(server.hasArg("pnlpct"), server.hasArg("botusdt"), dreh,
              server.hasArg("chart"), saeubereSymbol(server.arg("csym")), spanne,
              server.arg("cart") == "kerzen");
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
    pos.margin        = p["margin"]        | 0.0f;   // bisher nicht geliefert → Fallback
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
    bot.margin        = b["margin"]        | 0.0f;   // fehlt bei altem Server → „-"
    bot.hatGrid       = b["gridProfit"].is<float>(); // null/fehlt → „-"
    bot.gridProfit    = bot.hatGrid ? b["gridProfit"].as<float>() : 0.0f;
    bot.coinM         = b["coinM"]         | false;
    data.bots.push_back(bot);
  }

  data.valid = true;
  lastOkMs = millis();
  if (lastOkMs == 0) lastOkMs = 1;
  return true;
}

// ── Kurs-Chart abrufen ───────────────────────────────────
// Läuft NEBEN der Hauptanzeige: Fehler hier (401, 404, Zeitüberschreitung)
// lassen data.valid, lastOkMs, den WLAN-Fehlerzähler und den Setup-Modus in
// Ruhe. Ein älterer Server kennt /kurs nicht. Bei 401/404 hören wir bis zum
// Neustart auf: jeder 401 zählt in der Fehlversuchsbremse des Servers (20/min
// je Adresse) und deren 429 träfe auch /display.

static void nebenAnfrage(HTTPClient& http, const String& url) {
  http.useHTTP10(true);                 // kein Chunked → direkt aus dem Strom parsen (spart RAM)
  http.setConnectTimeout(NEBEN_CONNECT_MS);
  http.setTimeout(NEBEN_TIMEOUT_MS);
  http.begin(url);
  http.addHeader("X-ESP32-Key", cfgKey);
}

// Abrufabstand nach Zeitraum: 1h 30 s, 24h/7d 60 s, 30d 120 s.
unsigned long kursAbstandMs() {
  if (cfgChartSpanne == "1h")  return 30000UL;
  if (cfgChartSpanne == "30d") return 120000UL;
  return 60000UL;
}

bool kursFaellig(unsigned long now) {
  if (!cfgChart || kursGesperrt || WiFi.status() != WL_CONNECTED) return false;
  if (kursPauseBis && (long)(now - kursPauseBis) < 0) return false;
  return kursAbrufMs == 0 || now - kursAbrufMs >= kursAbstandMs();
}

// Nach Änderung von Symbol/Zeitraum/Darstellung: alten Stand verwerfen, sofort neu.
void kursZuruecksetzen() {
  kurs.gueltig = false;
  kurs.kerzen.clear();
  kurs.kerzen.shrink_to_fit();
  kursZustand = KURS_NIE;
  kursAbrufMs = 0;
}

void holeKurs() {
  kursAbrufMs = millis();
  String url = "http://" + cfgHost + ":" + cfgPort + "/api/esp32/kurs?symbol=" +
               saeubereSymbol(cfgChartSymbol) + "&spanne=" + cfgChartSpanne +
               "&n=" + String(kursAnzahl());
  HTTPClient http;
  nebenAnfrage(http, url);
  int code = http.GET();
  Serial.printf("[KURS] HTTP %d\n", code);
  if (code != 200) {
    http.end();
    if (code == 400) {                  // Symbol unbekannt: alter Chart gehört zu einem anderen
      kursZuruecksetzen();
      kursAbrufMs = millis();
      kursZustand = KURS_SYMBOL;
    }
    else if (code == 401) { kursZustand = KURS_SCHLUESSEL; kursGesperrt = true; }
    else if (code == 404) { kursZustand = KURS_ALT;        kursGesperrt = true; }
    else if (code == 429) { kursZustand = KURS_BREMSE; kursPauseBis = millis() + BREMSE_PAUSE_MS; }
    else                  kursZustand = KURS_NETZ;   // Zeitüberschreitung, 5xx …
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();
  if (err) { kursZustand = KURS_NETZ; return; }

  if (doc["aus"] | false) {             // Marktdaten in der App ausgeschaltet
    kursZuruecksetzen();
    kursZustand = KURS_AUS;
    kursAbrufMs = millis();
    return;
  }
  JsonArray arr = doc["kerzen"].as<JsonArray>();
  if (arr.isNull() || arr.size() < 2) { kursZustand = KURS_NETZ; return; }

  kurs.kerzen.clear();
  kurs.kerzen.reserve(min((size_t)200, arr.size()));
  for (JsonArray k : arr) {
    if (kurs.kerzen.size() >= 200) break;
    if (k.size() < 4) continue;
    kurs.kerzen.push_back({ k[0].as<float>(), k[1].as<float>(), k[2].as<float>(), k[3].as<float>() });
  }
  if (kurs.kerzen.size() < 2) { kursZustand = KURS_NETZ; kurs.gueltig = false; return; }
  kurs.symbol    = doc["symbol"]    | "";
  kurs.spanne    = doc["spanne"]    | "";
  kurs.jetzt     = doc["jetzt"]     | kurs.kerzen.back().c;
  kurs.start     = doc["start"]     | kurs.kerzen.front().o;
  kurs.hoch      = doc["hoch"]      | 0.0f;
  kurs.tief      = doc["tief"]      | 0.0f;
  kurs.aenderung = doc["aenderung"] | 0.0f;
  kurs.gueltig   = true;
  kursZustand    = KURS_OK;
  kursOkMs       = millis();
}

// ── Setup-Modus ──────────────────────────────────────────

// Quer: zwei Spalten (WLAN | Browser). Hoch: alles in einer Spalte.
void zeichneSetupSchirm(const char* grund) {
  const int W = schirmB, H = schirmH;
  const bool hoch = hochformat();
  setupGrund = grund;
  schirmLeeren(COLOR_BG);
  tft->setTextColor(COLOR_YELLOW, COLOR_BG);
  tft->setTextSize(2);
  tft->setCursor(10, 20);
  tft->print("SETUP MODUS");
  drawMarke(W - 24, 26, 16);
  if (!hoch) tft->drawFastVLine(160, 50, 120, COLOR_GREY_DARK);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(10, 58);  tft->print("1. WLAN verbinden:");
  tft->setTextColor(COLOR_GREEN, COLOR_BG);
  tft->setCursor(10, 74);  tft->print(AP_SSID);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setCursor(10, 92);  tft->print("Passwort:");
  tft->setTextColor(COLOR_YELLOW, COLOR_BG);
  tft->setTextSize(2);
  tft->setCursor(10, 106); tft->print(apPass);
  tft->setTextSize(1);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  const int bx = hoch ? 10 : 172, by = hoch ? 140 : 58;
  tft->setCursor(bx, by);      tft->print("2. Browser:");
  tft->setTextColor(COLOR_YELLOW, COLOR_BG);
  tft->setCursor(bx, by + 16); tft->print("192.168.4.1");
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  if (setupMitKonfig) {
    tft->setCursor(10, H - 60);
    tft->print(passt("Ohne Eingabe: nach 10 Min. Neustart", W - 20));
  }
  if (grund) {
    tft->setTextColor(COLOR_WHITE_DIM, COLOR_BG);
    tft->setCursor(10, H - 48);
    tft->print(passt(grund, W - 20));
  }
  tft->drawFastHLine(0, H - NAV_H, W, COLOR_GREY_DARK);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setCursor(10, H - 23); tft->print("AutarkTrade ESP32 v" FW_VERSION);
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
// ins Portal. Kurze Lücken im Touch-Signal (der kapazitive Chip meldet nicht
// jede Abfrage) brechen das Halten nicht ab.
bool lokalGedrueckt() {
  int x, y;
  return digitalRead(BOOT_TASTE_PIN) == LOW || mapTouch(&x, &y);
}

bool setupGesteBeimStart() {
  pinMode(BOOT_TASTE_PIN, INPUT_PULLUP);
  schirmLeeren(COLOR_BG);
  tft->setTextColor(COLOR_GREY, COLOR_BG);
  tft->setTextSize(1);
  // Hochformat: 45 Zeichen = 270 px passen nicht in 240 → zwei Zeilen
  int my = schirmH / 2 - 20;
  tft->setCursor(10, my);
  if (hochformat()) {
    tft->print("Setup: Bildschirm oder");
    tft->setCursor(10, my + 12);
    tft->print("BOOT-Taste 3 s halten");
  } else {
    tft->print("Setup: Bildschirm oder BOOT-Taste 3 s halten");
  }
  unsigned long t0 = millis();
  while (millis() - t0 < SETUP_FENSTER_MS) {
    if (lokalGedrueckt()) {
      tft->setTextColor(COLOR_YELLOW, COLOR_BG);
      tft->setCursor(10, my + 32);
      tft->print("Halten ...");
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
  delay(1500);  // ESP32-S3 USB CDC: warten bis Host verbunden
  Serial.println("[BOOT] Start");

  // ── Display initialisieren ──────────────────────
  // lcd.init() zuerst (TFT_BL=5 in Build-Flags lässt TFT_eSPI digitalWrite auf Pin 5 machen)
  // backlightInit() danach: re-attached LEDC auf Pin 5, sonst funktioniert ledcWrite nicht
  Serial.println("[BOOT] tft.init()");
  lcd.init();
  waveshareInitST7789();     // ST7789T3 Custom-Init (Waveshare ESP32-S3-Touch-LCD-2.8)
  lcd.setRotation(DISPLAY_ROTATION);
  Serial.println("[BOOT] Backlight LEDC init");
  backlightInit();           // NACH lcd.init(): LEDC re-attached Pin 5 nach TFT_eSPI digitalWrite
  schirmLeeren(COLOR_BG);

  // ── Touch I2C (CST328 oder CST3530) ─────────────
  touchInit();

  loadConfig();
  setzeAusrichtung(cfgDreh);   // gewählte Lage vor dem ersten Text (Setup-Geste)

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
  schirmLeeren(COLOR_BG);
  tft->setTextColor(COLOR_WHITE, COLOR_BG);
  tft->setTextSize(1);
  tft->setCursor(10, schirmH / 2 - 12);
  tft->print("Verbinde mit WiFi...");

  WiFi.begin(cfgSSID.c_str(), cfgPass.c_str());
  unsigned long t0 = millis();
  int dotX = 10;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) break;
    tft->setTextColor(COLOR_GREY, COLOR_BG);
    tft->setCursor(dotX, schirmH / 2 + 4); tft->print(".");
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
  WiFi.setSleep(true);   // Modem Sleep: Radio schläft zwischen Requests (~50 mA gespart)
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

// ── USB: Bildschirmfoto, Ausrichtung, Seite ──────────────
// Nur über das USB-Kabel (lokal), nie aus dem Netz:
//   B      → "\nBILD-START <breite> <hoehe> <rotation> rgb565\n", je Bildschirmzeile
//            eine Textzeile mit 4 Hex-Zeichen (RGB565) je Pixel, dann "BILD-ENDE"
//   D0..D3 → Ausrichtung setzen und speichern, Antwort "[DREH] n"
//   P0..P3 → Seite Dashboard/Positionen/Chart/Info, Antwort "[SEITE] n"
//
// Zurücklesen geht auf diesem Board nicht: zum Display führt kein MISO
// (TFT_MISO=-1), und ohne eingeschaltetes PSRAM (esp32-s3-devkitc-1 ohne
// memory_type) wäre ein Schattenbild von 150 KB im internen RAM zu teuer.
// Darum zeichnet das Bildschirmfoto den aktuellen Schirm mit demselben Code
// noch einmal — streifenweise in ein kleines Sprite (320×40×2 = 25 KB, nur
// während des Fotos belegt) und gibt jeden Streifen aus. Das Ergebnis ist
// der Zustand, den das Display zeigt (gleiche Daten, gleiche Lage).

#define BILD_STREIFEN  40        // Zeilen je Zeichenstreifen (bei RAM-Mangel halbiert)

// Was gerade auf dem Schirm steht, noch einmal zeichnen (über den Zeiger tft).
void zeichneSchirm() {
  if (configMode)     zeichneSetupSchirm(setupGrund);
  else if (inStandby) schirmLeeren(COLOR_BG);     // Standby: Bild leer, Licht aus
  else                drawCurrentScreen();
}

void bildschirmfoto() {
  static TFT_eSprite streifen(&lcd);
  const int W = schirmB, H = schirmH;
  streifen.setColorDepth(16);
  int band = BILD_STREIFEN;
  while (band >= 5 && !streifen.createSprite(W, band)) band /= 2;
  if (!streifen.created()) {
    Serial.printf("\nBILD-NICHT-MOEGLICH kein RAM fuer Zeichenstreifen (frei %u)\n", (unsigned)ESP.getFreeHeap());
    return;
  }
  Serial.printf("\nBILD-START %d %d %d rgb565\n", W, H, cfgDreh);
  static const char ZIFFER[] = "0123456789abcdef";
  static char zeile[320 * 4 + 1];
  tft = &streifen;
  for (int y0 = 0; y0 < H; y0 += band) {
    // Ursprung des Streifens auf Bildschirmzeile y0: gezeichnet wird in
    // Bildschirmkoordinaten, alles ausserhalb des Streifens fällt weg.
    streifen.setViewport(0, -y0, W, H, true);
    tft->fillRect(0, y0, W, band, COLOR_BG);
    zeichneSchirm();
    int hb = min(band, H - y0);
    for (int r = 0; r < hb; r++) {
      char* z = zeile;
      for (int x = 0; x < W; x++) {
        uint16_t c = streifen.readPixel(x, y0 + r);
        *z++ = ZIFFER[c >> 12];
        *z++ = ZIFFER[(c >> 8) & 0xF];
        *z++ = ZIFFER[(c >> 4) & 0xF];
        *z++ = ZIFFER[c & 0xF];
      }
      *z++ = '\n';
      Serial.write((const uint8_t*)zeile, z - zeile);
    }
    delay(1);   // anderen Aufgaben Luft lassen
  }
  tft = &lcd;
  streifen.deleteSprite();
  Serial.println("BILD-ENDE");
}

// Wer am Kabel etwas umstellt, will das Ergebnis sehen: aus dem Standby holen.
static void seriellWecken() {
  if (!configMode && inStandby) {
    inStandby = false;
    setBacklight(true);
    lastUpdate = 0;                      // nächster loop()-Durchlauf holt Daten
  }
  lastTouchTime = millis();
}

void seriellDreh(int n) {
  setzeAusrichtung(n);
  speichereDreh();
  seriellWecken();
  zeichneSchirm();
  Serial.printf("[DREH] %d\n", cfgDreh);
}

// P-Nummern in der Reihenfolge der Aufgabe, nicht der SEITE_-Werte.
static const int SEITE_VON_P[4] = { SEITE_DASHBOARD, SEITE_POSITIONEN, SEITE_CHART, SEITE_INFO };

void seriellSeite(int n) {
  activeScreen = SEITE_VON_P[n];
  if (activeScreen == SEITE_CHART && !cfgChart) activeScreen = SEITE_DASHBOARD;   // Chart aus
  seriellWecken();
  if (!configMode) drawCurrentScreen();  // Kurs holt loop() im eigenen Takt
  int p = 0;
  for (int i = 0; i < 4; i++) if (SEITE_VON_P[i] == activeScreen) p = i;
  Serial.printf("[SEITE] %d\n", p);
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

// Nicht blockierend: nur was schon im Puffer liegt. „D"/„P" warten auf ihre Ziffer.
void pruefeSeriell() {
  static char offen = 0;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (cfgZeichen(c)) { offen = 0; continue; }
    if (offen) {
      char befehl = offen;
      offen = 0;
      if (c >= '0' && c <= '3') {
        if (befehl == 'D') seriellDreh(c - '0');
        else               seriellSeite(c - '0');
        continue;
      }
      // keine Ziffer: Zeichen unten normal auswerten
    }
    if (c == 'B')                  bildschirmfoto();
    else if (c == 'D' || c == 'P') offen = c;
  }
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

void loop() {
  pruefeSeriell();   // USB: B / D0..D3 / P0..P3 (kehrt sofort zurück, wenn nichts anliegt)

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
      // ── Nav-Bar: 3 oder 4 Reiter (wie bisher 27 px Toleranz nach oben) ──
      int seiten[4];
      int n = navReiter(seiten);
      int newScreen = seiten[constrain(tx * n / schirmB, 0, n - 1)];
      if (newScreen != activeScreen) {
        activeScreen = newScreen;
        drawCurrentScreen();
        if (activeScreen == SEITE_CHART && kursFaellig(millis())) {
          holeKurs();
          drawCurrentScreen();
        }
      }
    } else if (activeScreen == SEITE_POSITIONEN && ty < 26) {
      // Tipp auf den Kopf: PnL Betrag ↔ Prozent der Marge (gespeichert)
      cfgPnlProzent = !cfgPnlProzent;
      speichereSchalter("pnlpct", cfgPnlProzent);
      drawCurrentScreen();
      delay(150);
    } else if (activeScreen == SEITE_CHART) {
      // Kopf: nächster Zeitraum; Chart: Linie ↔ Kerzen. Beides gespeichert, sofort neu laden.
      if (ty <= chartKopfH()) {
        cfgChartSpanne = cfgChartSpanne == "1h"  ? "24h" :
                         cfgChartSpanne == "24h" ? "7d"  :
                         cfgChartSpanne == "7d"  ? "30d" : "1h";
        speichereChartSpanne();
      } else {
        cfgChartKerzen = !cfgChartKerzen;
        speichereSchalter("ckerzen", cfgChartKerzen);
      }
      kursZuruecksetzen();
      drawCurrentScreen();               // „Lade Kurs ..." mit neuem Kopf
      if (kursFaellig(millis())) holeKurs();
      drawCurrentScreen();
      delay(150);
    } else if (activeScreen == SEITE_INFO) {
      // Screen 3 ist jetzt rein informativ (Filter wird vom Server gesteuert)
      // Tap wechselt zurück zum Dashboard und lädt aktuelle Daten
      activeScreen = SEITE_DASHBOARD;
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
    schirmLeeren(COLOR_BG);
    setBacklight(false);
    Serial.println("[PWR] Standby — Backlight aus");
  }

  // ── Standby Stufe 2: 60s ohne Touch → Light Sleep + WiFi aus ─
  // Boot-Grace: erste 5 Min nach Boot kein Sleep (damit Flashen funktioniert)
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

  // ── Chart-Seite: Kurs im eigenen Takt (nur sichtbar und aktiv) ──
  if (activeScreen == SEITE_CHART && kursFaellig(now)) {
    holeKurs();
    drawCurrentScreen();
    return;
  }

  // ── Aktiv: Daten alle ACTIVE_INTERVAL Sekunden aktualisieren ──
  if (now - lastUpdate >= (unsigned long)ACTIVE_INTERVAL * 1000) {
    ensureWiFi();
    fetchData();
    // Auf der Chart-Seite nur die Reiterleiste (Offline-Punkt) — der Chart
    // ändert sich erst mit dem nächsten Kursabruf, Neuzeichnen würde flackern.
    if (activeScreen == SEITE_CHART) drawNavBar();
    else drawCurrentScreen();   // auch bei Fehlschlag: alter Stand mit Altersbanner
    lastUpdate = millis();
    return;
  }

  delay(50);
}
