# NOTICE – Herkunft und fremde Bestandteile

Stand vom 19. Oktober 2026

> ⚠ ENTWURF, nicht anwaltlich geprüft (am 19. Oktober 2026 mit dem Code, `package-lock.json`
> und `docs/VERKAUFS-PRUEFUNG.md` abgeglichen). Offen vor der ersten Weitergabe an Dritte:
>
> - Die TradeNote-Anteile (Abschnitt „Herkunft") sind noch nicht ersetzt. **Solange sie im
>   Code stehen, darf der Stand nicht unter `LICENSE` weitergegeben werden** — er ist als
>   Ganzes noch ein Werk unter GPL-3.0. Den Nachweis, dass nichts übrig ist, liefert S11
>   (`HERKUNFT.md`).
> - markerjs2 (Linkware) und die CDN-Einbindungen von Font Awesome und Unicons sind noch
>   drin (Abschnitt „Fremde Software", Ablösung in S8/S9).
> - Das Quellenangebot für das Container-Image (Abschnitt „Container-Image") braucht eine
>   Anschrift des Anbieters.

## Lizenz

Für AutarkTrade gelten die Lizenzbedingungen in `LICENSE`. In der Software stehen sie mit
diesem Text und `THIRD-PARTY-NOTICES` unter **Rechtliches** (Seitenmenü unten, Einstellungen ›
Allgemein › Lizenz); beim ersten Start und bei jeder neuen Fassung muss man ihnen zustimmen.
Im Container-Image liegen alle drei unter `/app/`.

Lizenzschlüssel: `server/lizenz.js` (Ed25519, offline geprüft). Ohne Schlüssel läuft die
Software im Testmodus; Daten werden nie gesperrt.

## Herkunft

AutarkTrade ist aus dem **Crypto Trading Journal** (Mouses007) hervorgegangen, das als Fork
von [TradeNote](https://github.com/Eleven-Trading/TradeNote) (Eleven-Trading, GPL-3.0)
begann. Gemessen am 19. Oktober 2026 stammen rund 5 % der Codezeilen wörtlich aus TradeNote,
fast alle im alten Journal-Kern; die Liste der Dateien steht in `LIZENZ-PLAN.md`, Abschnitt 1.
Sie werden nach der Clean-Room-Regel neu geschrieben (Beschreibung in `docs/spec/`, Neubau nur
aus der Beschreibung, `docs/AUFTRAGSSTAND.md`).

- Die bis Version 3.x veröffentlichten Fassungen des Crypto Trading Journal bleiben unter
  GPL-3.0 und im alten, öffentlichen Repository erhältlich. Die Software holt Updates
  **nicht** mehr von dort (`server/update-api.js`).
- Bewusst unverändert und kein schützbarer Ausdruck: der Dateiname `tradenote.db` als
  Rückfall, der Schlüssel-Seed in `server/crypto.js` und der Token-Zweck `tn_session_v1` in
  `server/auth.js` (sonst wären gespeicherte Schlüssel bzw. Sitzungen ungültig).

## Fremde Software

AutarkTrade bringt fremde Software mit. Jede steht unter ihrer eigenen Lizenz, und die geht
für diesen Teil vor (Ziffer 12 der Lizenzbedingungen).

| Was | Wo aufgeführt |
|---|---|
| npm-Pakete im Server und im gebauten Frontend (227 am 19.10.2026: MIT, ISC, BSD, Apache-2.0, MPL-2.0/Apache-2.0 bei DOMPurify, Zlib bei pako) | `THIRD-PARTY-NOTICES`, erzeugt von `scripts/drittlizenzen.mjs` aus `package-lock.json` und den Lizenzdateien der Pakete (auch im Docker-Build). `server/__selftest-rechtliches.mjs` schlägt an, wenn ein Paket fehlt. |
| NOTICE-Texte nach Apache-2.0 §4(d) | Apache ECharts (Datei `NOTICE` im Paket) und TradingView Lightweight Charts (nur im README des Pakets, deshalb von `drittlizenzen.mjs` nachgetragen) in `THIRD-PARTY-NOTICES` |

Sichtbare Pflichten in der Oberfläche:

- **TradingView Lightweight Charts™** – Copyright (с) 2025 TradingView, Inc.
  <https://www.tradingview.com/>. Das Attributionslogo steht in jedem Chart
  (`attributionLogo: true`) und verlinkt auf TradingView; dieser Hinweis steht unter
  Rechtliches.
- **markerjs2** (Screenshot-Annotation) steht unter der *marker.js 2 Linkware License*: ein
  Link zur marker.js-Website muss während des Betriebs sichtbar sein. Wird in S8 durch eine
  eigene Annotation ersetzt.

Nicht mitgeliefert, sondern zur Laufzeit von einem CDN geladen (bis S9): Font Awesome 4.7
(Schrift OFL-1.1, CSS MIT) und Iconscout Unicons (IconScout Simple License). Sie werden durch
das eigene Symbolset (`src/components/basis/Symbol.vue`) ersetzt.

### sharp ersetzt (19. Oktober 2026)

Die Share-Card setzte bis 19.10.2026 der Server mit `sharp` zusammen. sharp selbst ist
Apache-2.0, bringt aber libvips samt glib, pango, librsvg und weiteren Bibliotheken unter
**LGPL-3.0-or-later** als Binärdateien mit. Beim Verkauf hiesse das: LGPL- und GPL-Text
mitliefern, ein Quellenangebot für genau diese Binärdateien vorhalten und in der EULA das
Ändern und Zurückübersetzen zum Fehlersuchen erlauben (LGPLv3 §4).

Entschieden: **ersetzen statt erfüllen.** Genutzt wurde sharp nur für drei Dinge –
Verkleinern, Zusammensetzen von Hintergrund und SVG, PNG-Ausgabe. Das kann der Browser
(`src/utils/shareCardBild.js`, Canvas); der Server liefert Hintergrund und SVG getrennt
(`server/flux-api.js`). Aufwand rund 60 Zeilen, dafür fallen 9 Pakete mit LGPL-Anteil, die
Build-Abhängigkeit und die Schriftpakete im Container-Image weg. Ziffer 13 der
Lizenzbedingungen bleibt trotzdem stehen – für die Bibliotheken des Betriebssystems im
Container-Image (nächster Abschnitt).

## Container-Image

Das Image baut auf `node:20-slim` (Debian) auf. Es enthält damit Pakete des Betriebssystems
unter eigenen Lizenzen, darunter GPL und LGPL (etwa die GNU C Library). Ihre Lizenztexte
liegen im Image unter `/usr/share/doc/*/copyright`; Node.js selbst (MIT, mit den Lizenzen
seiner Bestandteile) unter `/usr/local/include/node/` bzw. in der Node-Distribution.

Quellenangebot: Die Quellen genau dieser Debian-Pakete in genau diesen Fassungen sind über
<https://snapshot.debian.org/> erhältlich (Paketliste: `dpkg-query -W` im Image). Auf Anfrage
an den Anbieter (siehe `LICENSE`, Ziffer 1) liefern wir sie für mindestens drei Jahre nach der
letzten Auslieferung des Images auf einem üblichen Datenträger zum Selbstkostenpreis.

## Begleitprogramme

| Programm | Fremde Teile | Stand |
|---|---|---|
| Android-Widget (`android-widget/`) | AndroidX, Kotlin, OkHttp/Okio (Apache-2.0; OkHttp mit `publicsuffixes.gz` unter MPL-2.0 und eigener NOTICE) | Lizenzdatei in der App fehlt noch (S11) |
| Anzeige-Firmware ESP32 (`ESP32-*`) | Arduino-ESP32-Core (**LGPL-2.1-or-later**, statisch gelinkt), TFT_eSPI (FreeBSD/BSD/MIT), ArduinoJson (MIT), XPT2046_Touchscreen (MIT, mit „development funding notice") | Plan: Firmware-Quelltext separat unter MIT offenlegen, damit neu gelinkt werden kann (S11) |
| Cinnamon-Desklet (`desklet/`) | – | Lizenzangabe fehlt; separat unter MIT veröffentlichen (S11) |

## Namen und Marken

Namen von Börsen, KI-Anbietern und Datenquellen (Bitunix, Bitget, Pionex, Binance, Anthropic,
OpenAI, Google, TradingView u. a.) stehen nur beschreibend da, um zu sagen, womit die Software
zusammenarbeitet. Sie gehören ihren Inhabern; eine Verbindung zu ihnen oder eine Empfehlung
durch sie besteht nicht. Welche Datenquelle unter welchen Bedingungen benutzt wird und welche
Hinweise sie verlangt, steht in `docs/VERKAUFS-PRUEFUNG.md` (Umsetzung S12).
