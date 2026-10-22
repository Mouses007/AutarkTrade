# NOTICE – Herkunft und fremde Bestandteile

Stand vom 19. Oktober 2026

> ⚠ ENTWURF, nicht anwaltlich geprüft (am 19. Oktober 2026 mit dem Code, `package-lock.json`
> und `docs/VERKAUFS-PRUEFUNG.md` abgeglichen). Offen vor der ersten Weitergabe an Dritte:
>
> - Anwaltliche Prüfung von `LICENSE`, dieser Datei und `HERKUNFT.md`.
> - Das Quellenangebot für das Container-Image (Abschnitt „Container-Image") braucht eine
>   Anschrift des Anbieters.

## Lizenz

AutarkTrade ist freie Software: Copyright (C) 2026 Mouses007. Sie steht unter der
GNU Affero General Public License, Version 3 oder (nach deiner Wahl) jeder späteren Version
(`LICENSE`, SPDX `AGPL-3.0-or-later`; seit 22. Oktober 2026, vorher eigene Lizenzbedingungen
eines nie ausgelieferten Entwurfs). Sie wird OHNE JEDE GEWÄHRLEISTUNG bereitgestellt; was das
für ein Trading-Werkzeug heisst, sagt `HAFTUNGSAUSSCHLUSS.md` — dem stimmt man beim ersten
Start und bei jeder neuen Fassung zu.

In der Software stehen Haftungsausschluss, Lizenz, dieser Text und `THIRD-PARTY-NOTICES`
unter **Rechtliches** (Seitenmenü unten, Einstellungen › Rechtliches), dazu der Link zum
Quellcode (AGPL Ziffer 13). Im Container-Image liegen alle vier unter `/app/`.

Es gibt keine Lizenzschlüssel und keine Update-Sperre mehr. Der Name „AutarkTrade" und das
Logo sind nicht Teil der Lizenz.

## Herkunft

Woher der Code stammt, wie geprüft wurde, dass kein übernommener Ausdruck mehr darin
steht, und welche Namen aus Verträglichkeit gleich bleiben: `HERKUNFT.md`
(Prüfskript `scripts/herkunft-pruefen.mjs`, Stand 19. Oktober 2026).

- Die bis Version 3.x veröffentlichten Fassungen des Crypto Trading Journal bleiben unter
  ihrer damaligen Lizenz bei denen, die sie haben. Die Software holt Updates **nicht** mehr
  von dort (`server/update-api.js`).

## Fremde Software

AutarkTrade bringt fremde Software mit. Jede steht unter ihrer eigenen Lizenz, und die geht
für diesen Teil vor (Ziffer 12 der Lizenzbedingungen).

| Was | Wo aufgeführt |
|---|---|
| npm-Pakete im Server und im gebauten Frontend (224 am 19.10.2026: MIT, ISC, BSD, Apache-2.0, MPL-2.0/Apache-2.0 bei DOMPurify, Zlib bei pako) | `THIRD-PARTY-NOTICES`, erzeugt von `scripts/drittlizenzen.mjs` aus `package-lock.json` und den Lizenzdateien der Pakete (auch im Docker-Build). `server/__selftest-rechtliches.mjs` schlägt an, wenn ein Paket fehlt. |
| NOTICE-Texte nach Apache-2.0 §4(d) | Apache ECharts (Datei `NOTICE` im Paket) und TradingView Lightweight Charts (nur im README des Pakets, deshalb von `drittlizenzen.mjs` nachgetragen) in `THIRD-PARTY-NOTICES` |

Sichtbare Pflichten in der Oberfläche:

- **TradingView Lightweight Charts™** – Copyright (с) 2025 TradingView, Inc.
  <https://www.tradingview.com/>. Das Attributionslogo steht in jedem Chart
  (`attributionLogo: true`) und verlinkt auf TradingView; dieser Hinweis steht unter
  Rechtliches.

Zur Laufzeit wird nichts von einem CDN geladen; Font Awesome, Unicons, Bootstrap und markerjs2
sind seit S8/S9 durch eigenen Code ersetzt (eigenes Symbolset `src/components/basis/Symbol.vue`,
eigene Bildmarkierung).

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

| Programm | Lizenz | Fremde Teile |
|---|---|---|
| Android-Widget (`android-widget/`, `com.autarktrade.widget`) | wie AutarkTrade (`LICENSE`) | AndroidX, Kotlin, OkHttp/Okio (Apache-2.0; OkHttp mit `publicsuffixes.gz` unter MPL-2.0). Liste und Texte in der APK: `app/src/main/assets/THIRD-PARTY-NOTICES.txt` |
| Anzeige-Firmware ESP32 (`ESP32-2432S028/`, `ESP32-Waveshare/`) | **MIT** (`LICENSE` im Verzeichnis) | Arduino-ESP32-Core (**LGPL-2.1-or-later**, statisch gelinkt — deshalb ist der Firmware-Quelltext offen, damit neu gelinkt werden kann), TFT_eSPI (FreeBSD/BSD/MIT), ArduinoJson (MIT), XPT2046_Touchscreen (MIT, mit „development funding notice"); Einzelheiten in `LIZENZEN.md` des Verzeichnisses |
| Cinnamon-Desklet (`desklet/`, `positionen@autarktrade`) | **MIT** (`LICENSE` im Desklet-Verzeichnis) | – |

Firmware und Desklet sind eigenständige Programme, die nur den lesenden Endpunkt
`/api/esp32/display` abfragen. Dass ihr Quelltext unter MIT steht, ändert nichts an den
Lizenzbedingungen von AutarkTrade selbst.

## Namen und Marken

Namen von Börsen, KI-Anbietern und Datenquellen (Bitunix, Bitget, Pionex, Binance, Anthropic,
OpenAI, Google, TradingView u. a.) stehen nur beschreibend da, um zu sagen, womit die Software
zusammenarbeitet. Sie gehören ihren Inhabern; eine Verbindung zu ihnen oder eine Empfehlung
durch sie besteht nicht. Welche Datenquelle unter welchen Bedingungen benutzt wird und welche
Hinweise sie verlangt, steht in `docs/VERKAUFS-PRUEFUNG.md` (Umsetzung S12).
