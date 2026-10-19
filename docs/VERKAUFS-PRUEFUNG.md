# Verkaufs-Prüfung AutarkTrade (Auftrag S1)

Stand: 19.10.2026 · Grundlage: Code-Stand `7fb0326` (master) und die Nutzungsbedingungen der Anbieter, alle am 19.10.2026 abgerufen.

> **Kein Rechtsrat.** Diese Prüfung fasst die Bedingungen zusammen, die die Anbieter selbst veröffentlichen, und ordnet sie technisch ein. Verbindlich bewerten muss sie ein Anwalt, im Zweifel zusammen mit dem Anbieter. Steht „unklar“ in einer Zeile, ist das ernst gemeint: Dort ist die Lage offen.
>
> **Belegqualität:** Mehrere Bedingungsseiten haben automatische Abrufe blockiert. Betroffen sind Binance global, Coinbase, KuCoin, ForexFactory, CryptoQuant, RugCheck (DNS), OpenAI (403), x.ai (403), MiniMax, redditinc.com, Databento und ntfy-Terms (Inhalt nur per JavaScript). In diesen Fällen stützt sich das Urteil auf Suchauszüge, Archivkopien oder Ersatzfassungen. Die Tabelle kennzeichnet das jeweils mit **(⚠ nicht direkt gelesen)**.

---

## 1. Zusammenfassung

### Ampel

| | Bedeutung | Anzahl Zeilen |
|---|---|---|
| 🟢 **grün** | erlaubt, erlaubt mit Attribution oder sauber „nur mit Kundenschlüssel“ | **41** |
| 🟡 **gelb** | unklar (Anwalt oder Anbieter fragen) oder nur mit Bezahltarif oder schriftlicher Zustimmung | **45** |
| 🔴 **rot** | ersetzen oder weglassen | **18** |

Gezählt sind die 104 Zeilen der Funktionstabelle in Abschnitt 2 (88 Funktionszeilen, 13 KI-Anbieter, FLUX, 2 Strategie-Zeilen). Eine Funktion mit mehreren Quellen hat eine Zeile je Quelle.

### Kernbefund

1. **Die Kontofunktionen sind unproblematisch, die Marktdaten nicht.** Importe, offene Positionen und Orders laufen über den API-Schlüssel des Kunden *(S13: Orders sendet AutarkTrade seit dem Ausbau des scharfen Handels nicht mehr)*. Das sehen Bitget, Pionex und Bybit ausdrücklich vor; Bitunix regelt es gar nicht. Die *öffentlichen* Marktdaten erlaubt dagegen **keine einzige Börse** ausdrücklich für ein verkauftes Drittprodukt. OKX verbietet es klar (§9.3/9.4), Upbit und MEXC ebenfalls. Binance, Bybit, Bitget, Kraken, Gate und KuCoin haben Klauseln gegen kommerzielle Nutzung, deren Reichweite für ein lokal beim Kunden laufendes Programm unklar ist.
2. **Binance ist das Rückgrat.** Chart, Bookmap, Coin-Radar, Marktradar, Live-Trading, Rekorder und Strategie-Backtests hängen an Binance-REST und -WebSocket. Die globalen Binance-Bedingungen ließen sich nicht abrufen, die australische Fassung erlaubt nur „non-commercial personal or internal business use“. **Ohne schriftliche Klärung mit Binance ist der Verkauf des Marktdatenteils das grösste Einzelrisiko.**
3. **Mehrere Quellen sind eindeutig rot.** Yahoo Finance (Makro, Indizes), ForexFactory (Kalender), CoinMarketCap-Webendpunkt (Dominanz), blockchain.info (Rainbow, Pi-Cycle), pump.fun, Telegram-Scraping (t.me/s), Reddit-RSS (wird am 13.11.2026 ohnehin abgeschaltet), CoinPaprika Free, Upbit, MEXC, OKX und die undokumentierten Binance-`bapi`-Endpunkte.
4. **Die KI-Anbieter sind mit Kundenschlüssel weitgehend grün.** Dafür braucht es Disclaimer („KI-generiert, keine Anlageberatung“), keine persönlichen Kauf- oder Verkaufsempfehlungen und keine Logos. Gemini darf für Kunden in EWR, Schweiz und UK nur im Bezahltarif laufen. DeepSeek verbietet schon die Nennung seines Namens ohne Erlaubnis (§5.2).
5. **Lizenzen fremder Software.** Pflicht sind eine THIRD-PARTY-NOTICES-Datei, das Lightweight-Charts-Logo (heute **abgeschaltet**, `ChartPanel.vue:145`), der ECharts-NOTICE-Text und Quellcode-Angebote für LGPL/GPL (sharp/libvips, Debian im Docker-Image, Arduino-Core der ESP32-Firmware). Ersetzt werden sollten Unicons (keine OSI-Lizenz, verträgt sich womöglich nicht mit einer EULA), markerjs2 (Linkware), sharp (LGPL), Font Awesome und alle CDN-Einbindungen inkl. Google Fonts.

### Die 10 dringendsten Massnahmen

| # | Massnahme | Betrifft | Aufwand |
|---|---|---|---|
| 1 | **Binance schriftlich anfragen**, ob ein lokal laufendes, verkauftes Programm die öffentlichen REST- und WebSocket-Marktdaten anzeigen darf. Parallel eine Daten-Abstraktion bauen, damit die Börse für Marktdaten wählbar ist. Einen Fallback gibt es erst, wenn mindestens eine Börse zustimmt (Bitget- und OKX-Broker-Programme sind der naheliegende Weg). | Chart, Bookmap, Coin-Radar, Marktradar, Live-Trading, Rekorder, Backtests | gross |
| 2 | **Yahoo Finance entfernen** (Makro-Kachel, Indizes-Kachel). Ersatz: Databento oder Massive mit Kundenschlüssel, oder die Kacheln ganz weglassen. | `livetrading-api.js`, `marktradar-api.js`, `makro.js` | mittel |
| 3 | **ForexFactory-Feed entfernen.** Kalender aus Public-Domain-Quellen der Behörden aufbauen (Fed bereits drin; BLS, BEA, EZB, Eurostat noch prüfen) oder über einen lizenzierten Anbieter mit Kundenschlüssel. | `marktradar-kalender.js`, Kalender-Countdown | mittel |
| 4 | **Rote Quellen abschalten:** CoinMarketCap-Webendpunkt, blockchain.info, pump.fun, Telegram t.me/s, Reddit-RSS, CoinPaprika, Upbit, MEXC, OKX, Binance `bapi` (Brackets, Alpha). Ersatz je Zeile in Abschnitt 2. | Marktradar, Hype-Radar, Börsenwächter, Fremdbuch, Margin-Raten | mittel |
| 5 | **CoinGecko auf Kundenschlüssel umstellen** (Demo-Key) und „Powered by CoinGecko“ mit Link an jeder Anzeige. Bei CoinGecko schriftlich bestätigen lassen, dass der Demo-Tarif im verkauften Produkt erlaubt ist. Coin-Logos durch Platzhalter mit Ticker-Initialen ersetzen. | Marktradar, Coin-Radar, Hype-Radar, GeckoTerminal | klein–mittel |
| 6 | **Pflicht-Attributionen einbauen.** Lightweight Charts: `attributionLogo: true` plus NOTICE-Text. Ausserdem Alternative.me, Federal Reserve, 4chan, GoPlus („Powered by GoPlus Security“), CryptoQuant, DexScreener (keine Pflicht, aber unschädlich). | UI | klein |
| 7 | **Lizenzpflichtige oder unsaubere Front-End-Teile ersetzen:** Unicons → Lucide/Tabler (MIT/ISC), Font Awesome 4.7 → dasselbe Set, markerjs2 → eigene Annotation, alle CDN-Dateien und Google Fonts lokal bündeln (npm/@fontsource), die doppelte Quill-CDN-Kopie streichen. | `index.html`, 97 Dateien mit Unicons, `screenshots.js` | mittel–gross |
| 8 | **THIRD-PARTY-NOTICES + Quellcode-Angebote.** Sammeldatei für App, Docker-Image, APK und Firmware; GPL/LGPL-Quellenangebot für Debian-Pakete im Image und den Arduino-ESP32-Core; sharp ersetzen (z. B. Share-Card im Browser rendern) oder LGPL-Pflichten erfüllen, inkl. EULA-Ausnahme für Reverse Engineering nach LGPLv3 §4. | Build, Dockerfile, EULA | mittel |
| 9 | **KI-Pflichten umsetzen:** sichtbares Label „KI-generiert – keine Anlageberatung – Fakten prüfen“ an jedem Bericht, Chat und Share-Bild, maschinenlesbar markiert (EU AI Act Art. 50); Schalter `kiEmpfehlungenAn` entfernen; Gemini-Hinweis „nur Bezahl-Schlüssel in EWR, Schweiz und UK“; DeepSeek nur als neutraler „OpenAI-kompatibler Endpunkt“; keine Anbieter-Logos. | KI-Agent, Lagebericht, Chart-KI, Gesamtlage, Handelslage, FLUX | klein–mittel |
| 10 | **Auslieferung bereinigen:** Spenden-Bilder (PayPal, BTC) und Trinkgeld-Menü entfernen; neues Logo statt „CRYPTO TRADING JOURNAL“ (mutmasslich KI-generiert); Update-Mechanismus vom öffentlichen GPL-Repo auf einen eigenen Kanal umstellen; vorbelegte News-Quellen (Verlags-RSS, Telegram, Truth Social) aus Onboarding und Seed entfernen; öffentlichen Solana-RPC als Vorgabe streichen; Länderhinweise in die EULA (Bitget sperrt DE, AT, FR; Bitunix sperrt FR; Pionex sperrt NL, ES, FR, UK). | `SideMenu.vue`, `update-api.js`, `SchrittNewsQuellen.vue`, `smartmoney.js` | klein |

---

## 2. Funktion → Quelle → Bedingungen → Urteil → Massnahme

Abkürzungen: **KS** = nur mit Kundenschlüssel (der Käufer trägt seinen eigenen Schlüssel ein und schliesst den Vertrag mit dem Anbieter selbst). Alle Fundstellen wurden am **19.10.2026** abgerufen, sofern nichts anderes vermerkt ist.

### 2.1 Journal, Konten, Ausführung

| # | Funktion (Code) | Quelle | Bedingungen (Fundstelle) | Urteil | Massnahme (Aufwand) |
|---|---|---|---|---|---|
| 1 | Trade-Import, offene Positionen, Session-Stand, Abgleich (`bitunix-api.js`, `livetrading-api.js`) | Bitunix privat (fapi.bitunix.com) | Es gibt keine eigenen API-Bedingungen. Das User Agreement (23.07.2026, Ziff. 7.3) regelt API und Drittsoftware nicht. Gesperrt sind u. a. FR, USA, CA, CN, HK, SG. https://www.bitunix.com/hub/helpcenter/article/bitunix-user-agreement?id=144 · https://www.bitunix.com/hub/helpcenter/article/bitunix-restricted-regions-and-user-eligibility-notice?id=146 | 🟢 KS | Schlüssel bleibt lokal und verschlüsselt (wie heute). In der EULA: Kunde haftet für Kontonutzung, Länderliste. (klein) |
| 2 | Trade-Import, offene Positionen (`bitget-api.js`) | Bitget privat | Ausdrücklich vorgesehen: Der Nutzer des Schlüssels gilt als vom Kunden beauftragt (API Key Terms Ziff. 1.5, 2.2). **Verbotene Länder: u. a. DE, AT, FR.** https://www.bitget.com/support/articles/12560603797947 · https://www.bitget.com/support/articles/360014944032-terms-of-use (16.10.2026) | 🟢 KS | Hinweis in UI und EULA: für Kunden in DE, AT und FR nicht nutzbar. (klein) |
| 3 | Trade-Import, Grid-Bots, Futures, Live-Ausführung, Stop-Wächter (`execution/pionex.js`) | Pionex privat | Dritter mit ausdrücklicher Erlaubnis des Kunden zulässig, der Kunde trägt die Verantwortung (ToS §5.2, 09.07.2024). Gesperrt sind u. a. NL, ES, FR, UK, USA, CA. https://www.pionex.com/blog/pionex-terms-of-service | 🟢 KS | Länderhinweis. Bei automatischer Ausführung **Rechtsfrage F-7** (Regulierung). (klein) |
| 4 | Live-Ausführung der Strategie-Engine (`execution/bitunix.js`) | Bitunix privat | wie Zeile 1 | 🟢 KS | wie Zeile 1 plus F-7. (klein) |
| 5 | Excursions/MFE über OHLCV (`addTrades.js`, `AddExcursions.vue`) | Polygon.io, jetzt „Massive“ | Gratis- und Individual-Tarife sind nur für Non-Professional-Privatnutzung, „display use only“, Schlüssel nicht teilen; §1 der Market Data Terms verbietet Apps „intended for use by end users other than you“. https://massive.com/legal/individuals-terms-of-service · https://massive.com/legal/market-data-terms-of-service | 🟡 KS, unklar | Bei support@massive.com nachfragen. Kein Schlüssel ab Werk. Alternativ Binance-Kerzen nutzen (siehe Binance-Klärung). (klein) |
| 6 | Excursions über OHLCV (Altcode) | Databento | Weiterverbreitung abhängig vom Datensatz, Börsenlizenzen werden durchgereicht. Pricing gelesen, **Terms ⚠ nicht direkt gelesen** (JavaScript). https://databento.com/pricing | 🟡 KS, unklar | Der Altcode sollte laut damaligem Plan gelöscht werden (siehe Anhang 2: er blieb, clean-room neu, nur mit Kundenschlüssel). Sonst bei Databento bestätigen lassen. (klein) |
| 7 | Update-Prüfung und Ein-Klick-Update (`update-api.js`) | GitHub API, öffentliches Repo `Mouses007/Crypto-Trading-Journal` | Nutzung über Drittprodukte vorgesehen (ToS Sec. H), unauthentifiziert 60 Anfragen pro Stunde. https://docs.github.com/en/site-policy/github-terms/github-terms-of-service | 🟢 erlaubt | **Technisch zwingend:** Update-Kanal auf eigene private Quelle umstellen. Das öffentliche Repo bleibt GPL, `git reset` würde Kunden auf den GPL-Stand ziehen. (mittel) |
| 8 | Benachrichtigungs-Mails, News-Versand (`benachrichtigungen.js`, nodemailer) | SMTP-Server des Kunden | Es wird kein Fremddienst vorgegeben; nodemailer steht unter MIT-0. | 🟢 erlaubt | keine |
| 9 | Backup/Export, ESP32-Display, Android-Widget, Cinnamon-Desklet | nur eigene lokale Endpunkte | keine Fremdquelle | 🟢 erlaubt | Lizenzpflichten der Bibliotheken siehe Abschnitt 3. |

### 2.2 Chart-Arbeitsplatz (`/chart`)

| # | Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 10 | Kerzen, Ticker, Watchlist, miniTicker-Stream (`chart-api.js`, `binanceStream.js`) | Binance REST (fapi/api) + WebSocket (fstream/stream) | Globale ToU **⚠ nicht direkt gelesen** (Bot-Abwehr). Die australische ToU (16.07.2026) Ziff. 22/26.1 erlaubt nur „non-commercial personal or internal business use“. Eine Drittquelle zitiert ein früheres Verbot von „data feeding or streaming services“ ohne Zustimmung. https://www.binance.com/en/terms · https://developers.binance.com/en/docs/products/spot/PROD-TERMS-OF-USE | 🟡 unklar, Tendenz „nur mit Zustimmung“ | **Massnahme 1:** bei Binance anfragen. Marktdatenquelle austauschbar machen. (gross) |
| 11 | Kerzen Bitunix | Bitunix öffentlich | Keine API-Regel. Ziff. 7.3 verbietet die kommerzielle Verwertung von „Bitunix-Eigentum“; ob Kursdaten darunterfallen, ist offen. (Fundstelle wie Zeile 1) | 🟡 unklar | Bei Bitunix schriftlich anfragen. Als Execution-Venue des Kunden gute Chancen. (klein) |
| 12 | Kerzen Bitget | Bitget öffentlich | API Key Terms Ziff. 3.2(m): kein Weiterverpacken oder Weiterverkaufen von API-Daten. ToU 11.1(ii): keine kommerzielle Nutzung ohne Zustimmung. (Fundstelle wie Zeile 2) | 🟡 unklar | Über das Bitget-Broker- oder Partnerprogramm Zustimmung einholen. (mittel) |
| 13 | Handelbar-Badges BX/BG/PX und Börsen-Deep-Links (`boersenLinks.js`) | Links auf Handelsseiten | Reine Links. Marken und Logos sind ohne Zustimmung tabu (OKX §9.5, Pionex Licenses §3, Bitget 10.1). | 🟢 erlaubt | Nur Text-Kürzel und Links verwenden, keine Börsenlogos. (keine) |
| 14 | „In TradingView öffnen“-Links | tradingview.com | Kein Linkverbot; §25 verbietet eine irreführende Darstellung der Verbindung. Eine eigene Markenrichtlinie wurde nicht gefunden. https://www.tradingview.com/policies/ | 🟢 erlaubt | Name nur beschreibend, kein Logo. (keine) |
| 15 | Chart-KI-Analyse und KI-Chat über `query_chart` (`chart-ki.js`) | KI-Anbieter des Kunden | siehe 2.8 | 🟢 KS | Label „KI-generiert, keine Anlageberatung“. `kiEmpfehlungenAn` entfernen. (klein) |
| 16 | Chart-Alarme, 5-s-Takt `ticker/price` (`chart-alarme.js`) | Binance REST | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 17 | Hebelzonen, Funding im Chart | Binance REST | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 18 | Strategie-Overlays, Journal-Overlay | eigene DB | keine Fremdquelle | 🟢 erlaubt | keine |

### 2.3 Marktradar („Live-Analyse“)

| # | Kachel / Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 19 | Fear & Greed (auch im Strategie-Layer) | Alternative.me `/fng` | Kommerzielle Nutzung ausdrücklich erlaubt, wenn die Quelle gut sichtbar direkt neben den Daten genannt wird. https://alternative.me/crypto/fear-and-greed-index/ (Abschnitt API) | 🟢 mit Attribution | „Quelle: Alternative.me“ mit Link an der Kachel. (klein) |
| 20 | BTC-/ETH-Dominanz-Historie (Import aus CMC) | CoinMarketCap-Webendpunkt `data-api/v3` | Nur persönliche, nicht-kommerzielle Nutzung. Scraping, Roboter und Speichern sind verboten (Ziff. 2.1, 4.4, 5.1, 6.1). https://coinmarketcap.com/terms/ | 🔴 ersetzen | Kurve nur aus eigenen täglichen Schnappschüssen (`market_snapshots`) über CoinGecko `/global` mit KS aufbauen. Historie beginnt dann beim Kunden ab Installation. Alternativ CMC-Pro-API mit KS (Lizenz nicht geprüft). (mittel) |
| 21 | Dominanz aktuell, Marktübersicht (`coins/markets`, `global`) | CoinGecko Public/Demo | Bezahlprodukte erlaubt (§4.1.6), „Powered by CoinGecko“ Pflicht (§4.4). Ob Demo kommerziell lizenziert ist, bleibt offen (Tarifseite unklar). https://www.coingecko.com/en/api_terms (Fassung 05.09.2025) · https://www.coingecko.com/en/api/pricing | 🟡 KS + Attribution, Demo-Lizenz bestätigen | Massnahme 5. (klein–mittel) |
| 22 | Funding-Raten | Binance + Bitunix + Bybit öffentlich | Binance und Bitunix wie Zeilen 10/11. Bybit API T&C Ziff. 6.7/6.9: kein Weiterverpacken, „shall not commercially exploit the APIs“, Adressat ist „You or your API Client“. https://www.bybit.com/common-static/compliance/legal/BYBIT/df1923006718fbba8ba70d7d762b9866.pdf | 🟡 unklar | Bybit anfragen oder die Bybit-Spalte weglassen. (klein) |
| 23 | Long/Short + Open Interest, OI-Archiv (`oi-archiv.js`) | Binance REST | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 24 | RSI-Scatter, Altcoin-Season, Trades × Regime | Binance REST (+ eigene Trades) | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 25 | Rainbow-Chart, Pi-Cycle-Top (BTC-Historie ab 2009) | blockchain.info Charts API | Inhalte nicht kommerzialisieren, nicht über das Erlaubte hinaus speichern oder cachen, kein Scraping (§§1.3–1.4, 13.08.2026). https://www.blockchain.com/legal/api-terms | 🔴 ersetzen | Historie aus Binance-Tageskerzen (ab 2017, sobald geklärt) oder CoinGecko `market_chart` mit KS. Die Zeit vor 2017 fehlt dann, das Rainbow-Modell ggf. neu kalibrieren. (mittel) |
| 26 | 24h-Liquidationen, Liq-Ticker (eigene Aufzeichnung `forceOrder`) | Binance WebSocket + Bybit WebSocket (`bybit-liq.js`) | Binance wie Zeile 10, Bybit wie Zeile 22. Hinzu kommt das **Speichern** von Rohdaten. | 🟡 unklar | Bei der Binance-Anfrage ausdrücklich auch die Speicherung erfragen. Bybit-Quelle ggf. weglassen. (klein) |
| 27 | Marktmechanik | Binance + Bybit | wie 22/26 | 🟡 unklar | wie 22 |
| 28 | Makro: ES/NQ-Futures, DXY | Yahoo Finance v8 Chart (inoffiziell) | Automatisiertes Sammeln ohne Erlaubnis verboten (2(d) Nr. 9), keine kommerzielle Nutzung (2(e)). US-Fassung gelesen. https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html | 🔴 ersetzen | Databento oder Massive mit KS (Futures-Lizenz der CME beachten), oder diesen Teil der Kachel weglassen. (mittel) |
| 29 | Makro: Stablecoin-Menge | CoinGecko `market_chart` | wie Zeile 21 | 🟡 KS + Attribution | Massnahme 5 |
| 30 | ETF-Fluss | CryptoQuant (KS, Gratis-Tarif) | Laut Suchauszügen nur interne, nicht-kommerzielle Nutzung (CC BY-NC 4.0), Quelle nennen, Weitergabe nur mit Zustimmung (Terms §4.1, Data Distribution Policy §6.5). **⚠ nicht direkt gelesen** (403). https://cryptoquant.com/data-distribution-policy | 🟡 KS, unklar | Bei CryptoQuant anfragen. „Daten: CryptoQuant“ anzeigen, nie einen eigenen Schlüssel ausliefern. (klein) |
| 31 | Wal-Transaktionen (Whale Alert, Lookonchain über Telegram) | Telegram t.me/s (Scraping) | Content-Licensing: Scraping, Indexieren und Aggregieren zum Trainieren **oder Einsetzen** („deploy“) von KI ist verboten. Ausserhalb der „normalen“ Nutzung kein Zugriff. https://telegram.org/tos/content-licensing | 🔴 ersetzen | Whale-Alert-API mit KS (Bedingungen noch prüfen) oder Kachel weglassen. (mittel) |
| 32 | Gesamtlage (KI) | KI-Anbieter des Kunden + Kacheldaten | siehe 2.8. Der Text erbt die Lage der Eingangsdaten. | 🟢 KS | Erst rote Quellen aus dem Prompt nehmen, dann das Label. (klein) |
| 33 | Leverage-/Liquidationskarte (`leverageMap.js`, `hebelzonen.js`) | Binance OI-Historie + Taker-Volumen | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 34 | Wartungsmarge je Symbol (`margin-rates.js`) | Binance `bapi/futures/.../brackets` (undokumentiert) | Crawler, Bots und Skripte für nicht vorgesehen bereitgestellte Informationen verboten (Binance AU 26.1(h), sinngemäss auch global). | 🔴 ersetzen | Offizielles `/fapi/v1/leverageBracket` mit Kunden-Binance-Schlüssel, sonst Bybit oder fester Standardwert mit Hinweis. (klein) |
| 35 | Wartungsmarge, zweite Quelle | Bybit `v5/market/risk-limit` | wie Zeile 22 | 🟡 unklar | wie Zeile 22 |

### 2.4 Live-Trading-Fenster

| # | Kachel / Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 36 | Bookmap (Orderbuch-Diffs, aggTrades), Replay | Binance WebSocket + REST-Snapshot | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 37 | Buch-Leiter: Vergleich Bybit (`fremdbuch.js`) | Bybit REST-Orderbuch | wie Zeile 22 | 🟡 unklar | Weglassen, solange keine Zustimmung vorliegt. (klein) |
| 38 | Buch-Leiter: Vergleich OKX | OKX öffentliche Orderbuch-/Instrument-Endpunkte | §9.4: Marktdaten „solely for your own personal, non-commercial trading“, auch ohne Schlüssel. §9.3(b): keine API-Dienste als Teil kommerzieller Produkte. Datenlizenzvertrag nötig (28.07.2026). https://www.okx.com/en-eu/help/okx-api-agreement | 🔴 weglassen | OKX-Spalte entfernen. (klein) |
| 39 | Indizes ES/NQ/DXY | Yahoo v8 Chart | wie Zeile 28 | 🔴 ersetzen | wie Zeile 28 |
| 40 | Kalender-Countdown (aus `calendar_events`) | ForexFactory + Fed | siehe Zeilen 47/48 | 🔴 / 🟢 | FF-Anteil ersetzen. (mittel) |
| 41 | Momentum-Radar (WaveTrend, Spot/Futures-Verhältnis) | Binance Spot + Futures REST | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 42 | Handelslage (KI, ~12 Quellen) | KI-Anbieter + Kacheldaten | siehe 2.8, erbt die Eingangsdaten | 🟢 KS | Label. Rote Quellen (Yahoo, FF) aus dem Prompt entfernen. (klein) |
| 43 | Handelszeiten, Session-Plan, Sitzungsstatistik | eigene Rechnung + DB | keine Fremdquelle | 🟢 erlaubt | keine |
| 44 | Live-Rekorder (Heatmap, Liquidationen, Trades in DB) | Binance WS + Bybit WS | wie 10/22. **Speicherung** ausdrücklich klären. | 🟡 unklar | wie Zeile 26 |

### 2.5 Nachrichten und Kalender

| # | Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 45 | KI-Lagebericht, Zwischenmeldungen, Chartanalyse | KI-Anbieter des Kunden | siehe 2.8 | 🟢 KS | Label „KI-generiert“, Disclaimer. (klein) |
| 46 | Verlags-RSS (Cointelegraph, CNBC, The Verge, Ars Technica, TechCrunch, Investing.com), Anzeige und KI-Zusammenfassung | Feeds der Verlage | EU-Richtlinie 2019/790: Art. 15 (Presseverleger, Ausnahme für sehr kurze Auszüge und Links), Art. 4 (TDM nur ohne maschinenlesbaren Vorbehalt). CH: kein Leistungsschutzrecht in Kraft. Feed-Bedingungen meist „persönlich, nicht-kommerziell“ (einzeln **⚠ nicht gelesen**). https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:32019L0790 · https://www.swisscopyright.ch/de/themendossiers/leistungsschutzrecht-fuer-medienunternehmen.html | 🟡 Anzeige mit Attribution vertretbar, KI-Zusammenfassung unklar | **Keine Feeds vorbelegen** (Onboarding, Seed). Nur Titel, kurzer Auszug und Link mit Quellenangabe. TDM-Opt-out (robots.txt, TDM-Reservation) vor der KI-Verarbeitung prüfen. Anwalt F-4. (mittel) |
| 47 | Wirtschaftskalender (aktuelle Woche) | ForexFactory `nfs.faireconomy.media` | Kalenderdatenbank „FEED“ darf weder ganz noch teilweise kopiert oder weiterverbreitet werden. **⚠ nicht direkt gelesen** (403, Suchauszug). https://www.forexfactory.com/notices | 🔴 ersetzen | Offizielle Kalender der Behörden (Fed, BLS, BEA, EZB, Eurostat; Bedingungen noch prüfen) oder ein lizenzierter Anbieter mit KS. (mittel) |
| 48 | Wirtschaftskalender (FOMC, Beige Book, Monate voraus) | Federal Reserve `calendar.json` | Public Domain, die Fed bittet um Quellenangabe. Keine Siegel und Logos, keine suggerierte Zugehörigkeit. https://www.federalreserve.gov/disclaimer.htm | 🟢 mit Attribution | „Quelle: Federal Reserve Board“ anzeigen. (klein) |
| 49 | YouTube-Kanäle (RSS) + Video-Zusammenfassung durch Gemini | youtube.com/feeds + Gemini-Video-URL | Automatisierter Zugriff nur mit Erlaubnis bzw. robots.txt; Ansehen nur persönlich und nicht-kommerziell. Ein API-Client darf verkauft werden (Developer Policies III.G.2), Branding nach III.F.2. https://www.youtube.com/t/terms · https://developers.google.com/youtube/terms/developer-policies | 🟡 unklar | RSS durch YouTube Data API v3 mit KS ersetzen, YouTube als Quelle kennzeichnen, Gemini nur als Opt-in. (mittel) |
| 50 | X-Quellen über Grok `x_search` | xAI | Bundled Services erlaubt, Ausgaben gehören dem Kunden. Ob X-Inhalte angezeigt werden dürfen, ist nicht geregelt. **⚠ über Archiv gelesen** (403). Enterprise Terms 14.08.2026 | 🟡 KS, unklar | Nur zusammenfassen und verlinken, keine Posts im Volltext. Bei xAI anfragen. (klein) |
| 51 | Perplexity-Recherche mit Belegen | Perplexity Sonar | Schlüssel vertraulich, Ausgaben gehören dem Kunden (§2.2, 2.3.1); keine Zitationspflicht gefunden. https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service (23.01.2026) | 🟢 KS | Belege trotzdem anzeigen, Disclaimer. (keine) |
| 52 | Telegram-Kanäle als News-Quelle | t.me/s Scraping | wie Zeile 31, zusätzlich das KI-Verbot | 🔴 ersetzen | Nur Kanäle, in denen der **Kunden-Bot** Mitglied ist, über die Bot API lesen. Auch dann ist 4.3 der Bot-Bedingungen (kein Scrapen öffentlicher Kanäle, keine KI-Datensätze) zu prüfen; sonst weglassen. (mittel) |
| 53 | Truth Social | trumpstruth.org RSS (Drittarchiv) | Keine Bedingungsseite, Rechte an den Texten liegen beim Verfasser. https://trumpstruth.org/about · /faq | 🟡 unklar | Nicht vorbelegen, höchstens als vom Nutzer eingetragene URL. (klein) |
| 54 | News-Versand per Mail | SMTP des Kunden | – | 🟢 erlaubt | keine |

### 2.6 Hype-Radar

| # | Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 55 | Trending-Quelle, Tiefensuche (Plattformen) | CoinGecko `search/trending`, `coins/{id}` | wie Zeile 21 | 🟡 KS + Attribution | Massnahme 5 |
| 56 | Quelle CoinPaprika | CoinPaprika Free | §3.6: kommerzielle Nutzung nur in Bezahltarifen, Free ist „personal and non-commercial“. https://coinpaprika.com/api-terms-of-use/ | 🔴 weglassen (oder Bezahltarif) | Quelle entfernen, die übrigen reichen. (klein) |
| 57 | DEX-Details, Profile, Community-Takeovers, Boosts | DexScreener API | Sec. 4: „non-commercial and commercial purposes“ erlaubt. Verboten: Weitergabe des API-Zugangs und direkte Konkurrenzprodukte (18.08.2023). https://docs.dexscreener.com/api/api-terms-and-conditions | 🟢 erlaubt | Freiwillig „Daten: DexScreener“ anzeigen. (keine) |
| 58 | Token-Bilder | cdn.dexscreener.com, coin-images.coingecko.com | Von Nutzern hochgeladene Inhalte, CoinGecko-Site-Inhalte nur persönlich und nicht-kommerziell (Terms 4(A)). https://www.coingecko.com/en/terms | 🟡 unklar | Platzhalter mit Ticker-Initialen statt Logos. (klein) |
| 59 | new_pools, tokens/multi (Käufer/Verkäufer), OHLCV | GeckoTerminal Public API | Eigene API-Terms nicht auffindbar (404). Site-Terms §4.4 (nur persönlich), §9.1 (kein Scraping); CoinGecko-API-Terms verlangen „Powered by CoinGecko“. https://www.geckoterminal.com/terms-conditions | 🟡 unklar | Über den CoinGecko-API-Schlüssel des Kunden laufen lassen (onchain-Endpunkte), mit Attribution. Bei CoinGecko bestätigen lassen. (mittel) |
| 60 | pump.fun: neueste Coins, Kurve, King of the Hill, Ersteller-Bilanz (`fruehphase.js`, `projekt.js`) | frontend-api-v3.pump.fun (inoffiziell) | 6.1: automatisierter Zugriff nur über freigegebene Wege. 21(h): keine Bots oder Crawler. 21(c): keine kommerzielle Verwertung ohne Zustimmung. https://pump.fun/docs/terms-and-conditions | 🔴 ersetzen | Kurven- und Mint-Daten direkt über Solana-RPC des Kunden lesen, neue Pools über DexScreener/GeckoTerminal. Ersteller-Bilanz entfällt oder kommt aus On-Chain-Daten. (gross) |
| 61 | Reddit-Erwähnungen | Reddit RSS | Reddit hat am 30.09.2026 die Abschaltung von RSS ab **13.11.2026** angekündigt; kommerzielle Nutzung der Data API ist vertragspflichtig. **⚠ nicht direkt gelesen** (redditinc.com gesperrt). https://mjtsai.com/blog/2026/10/06/reddit-to-remove-rss/ | 🔴 weglassen | Quelle entfernen. (klein) |
| 62 | /biz/-Katalog | 4chan JSON API | Höchstens 1 Anfrage/s; Quelle als 4chan nennen und verlinken; nicht im Produkttitel oder in der Werbung, nicht offiziell wirken. https://github.com/4chan/4chan-API | 🟢 mit Attribution | „Quelle: 4chan /biz/“ mit Link. Im Marketing nicht erwähnen. (klein) |
| 63 | Telegram-Kanäle der Frühphase | t.me/s | wie Zeile 31 | 🔴 ersetzen | wie Zeile 52 |
| 64 | X-Erwähnungen in der Frühphase | xAI Grok | wie Zeile 50 | 🟡 KS, unklar | wie Zeile 50 |
| 65 | Vertrags-Sicherheitsprüfung | GoPlus Security | Lizenzvertrag („【Old】“, 17.11.2022) verlangt ausser bei rein persönlicher Nutzung „Powered by GoPlus Security“ samt Logo/Backlink. Free-Tarif 150K CU pro Monat. https://docs.gopluslabs.io/reference/api-license-agreement | 🟡 mit Attribution, aktuelle Fassung unklar | GoPlus anfragen, Attribution einbauen, optional Kundenschlüssel. (klein) |
| 66 | Fallback-Sicherheit, Insider-Netze | RugCheck | **⚠ nicht gelesen** (DNS-Fehler). Laut Drittquellen API-Schlüssel per Dashboard, evtl. Bezahltarife. | 🟡 unklar | Anbieter fragen. Bis dahin nur mit KS-Feld oder abschalten. (klein) |
| 67 | Smart-Money-Wallets (Solana JSON-RPC) | api.mainnet-beta.solana.com | „Not intended for production applications“, 100 Anfragen pro 10 s und IP. https://solana.com/docs/references/clusters | 🟢 KS | Öffentlichen Knoten als Vorgabe streichen, eigene RPC-URL des Kunden zur Pflicht machen (Feld existiert: `hypeKeySolanaRpc`). (klein) |
| 68 | Projektprüfung: Abruf der Projekt-Website (`projekt.js` via `net-guard`) | beliebige öffentliche Websites | Einzelabrufe öffentlicher Seiten, keine Massenerhebung. Keine spezielle Bedingung geprüft. | 🟢 erlaubt (geringes Risiko) | robots.txt beachten, User-Agent mit Produktnamen. (klein) |
| 69 | Domain-Alter | rdap.org | Keine formalen Terms, 10 Anfragen pro 10 s, Unterstützung erbeten. https://about.rdap.org/ | 🟢 erlaubt | Besser die RDAP-Server direkt über den IANA-Bootstrap ansprechen (`data.iana.org/rdap/dns.json`). (klein) |
| 70 | NXDOMAIN-Gegenprobe | Google DoH, Cloudflare DoH | Google APIs ToS, kein kommerzielles Verbot (Sec. 5e: keine Datenbanken über den Cache hinaus). https://developers.google.com/speed/public-dns/terms. Cloudflare: Terms nicht gefunden. | 🟢 erlaubt | keine |
| 71 | GitHub-Prüfung von Projekten | GitHub REST unauthentifiziert | AUP §7: API-Datenerhebung gilt nicht als Scraping, 60 Anfragen pro Stunde. https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies | 🟢 erlaubt | optional Kunden-Token (keine) |
| 72 | Hype-KI-Bericht | KI des Kunden | siehe 2.8 | 🟢 KS | Label |
| 73 | Zustellung Push: ntfy | ntfy.sh (oder eigener Server) | Laut FAQ in eigenen Apps nutzbar, gratis, Rate-Limits, Thema und IP werden protokolliert. Terms-Seite **⚠ nicht lesbar** (JavaScript). https://docs.ntfy.sh/faq/ | 🟢 erlaubt | Server-URL konfigurierbar lassen, zufällige Themen vorschlagen, Datenschutzhinweis. (klein) |
| 74 | Zustellung Telegram-Bot | Telegram Bot API (Token des Kunden) | Der Bot läuft beim Betreiber, Zugangsdaten vertraulich (4.5). Proxy-Betrieb mit fremden Tokens verboten (5.2(f)), keine Verbindung zu Telegram suggerieren (8.1). https://telegram.org/tos/bot-developers | 🟢 KS | EULA: Kunde ist Bot-Betreiber (Datenschutzpflicht). (klein) |
| 75 | Börsenwächter: Binance Spot/Futures `exchangeInfo` | Binance | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 76 | Börsenwächter: Binance Alpha | `bapi/defi/.../alpha/all/token/list` (undokumentiert) | wie Zeile 34 | 🔴 weglassen | Ersatzlos entfernen. (klein) |
| 77 | Börsenwächter: Coinbase | api.exchange.coinbase.com | Market Data Terms (06.02.2023): Lizenz nur „personal or research purposes“, Weitergabe nur mit Zustimmung. **⚠ nicht direkt gelesen** (403). https://www.coinbase.com/legal/market_data | 🟡 unklar, eher rot | Standard AUS, Anbieter fragen. (klein) |
| 78 | Börsenwächter: Upbit | api.upbit.com | Open-API-Terms Art. 6 Abs. 3: Programme mit der Open API nicht gegen Entgelt verbreiten **und keine solchen Programme Dritter nutzen**. https://static.upbit.com/terms/notices/openapi_terms_revision_202310.pdf | 🔴 weglassen | entfernen (klein) |
| 79 | Börsenwächter: Kraken | api.kraken.com | Ohne Zustimmung keine Drittanwendungen, die mit „Our Content“ interagieren, keine kommerzielle Verwertung. https://www.kraken.com/legal/global-terms | 🟡 unklar | Bei marketdata@kraken.com anfragen, bis dahin AUS. (klein) |
| 80 | Börsenwächter: KuCoin | api.kucoin.com | Kommerzielle Nutzung nur mit „explicit written consent“ (Suchauszug). **⚠ nicht direkt gelesen.** https://www.kucoin.com/legal/terms-of-use | 🟡 unklar | Anfragen, bis dahin AUS. (klein) |
| 81 | Börsenwächter: Gate | api.gateio.ws | 10.1(d): kein Wiederverkauf und keine kommerzielle Nutzung ohne Genehmigung; 2.11: „unauthorized API use, data scraping“. https://www.gate.com/legal/user-agreement | 🟡 unklar | Anfragen, bis dahin AUS. (klein) |
| 82 | Börsenwächter: MEXC | api.mexc.com | 17(d)(iii): keine App, die mit MEXC-Marktdaten Geld verdient (13.10.2026). https://www.mexc.com/terms | 🔴 weglassen | entfernen (klein) |
| 83 | Börsenwächter: Bybit, OKX, Bitget | jeweilige öffentliche Listen | Bybit und Bitget wie Zeilen 22/12; OKX wie Zeile 38 | 🟡 Bybit/Bitget unklar · 🔴 OKX | OKX entfernen, die anderen anfragen. (klein) |

### 2.7 Coin-Radar

| # | Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 84 | Rangliste, Einzelprüfung, Watchdog (Ticker, BookTicker, Kerzen, Funding) | Binance REST | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 85 | Ausführungsmessung (Orderbuch, Slippage) | Bitunix + Bitget öffentlich | wie Zeilen 11/12 | 🟡 unklar | wie 11/12 |
| 86 | Abverkauf-Wacht (Futures, Spot, OI, Taker, Konten) | Binance REST + eigene Liq-Aufzeichnung | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 87 | Coin-Info, Tiefensuche | CoinGecko + GoPlus/RugCheck + DexScreener | wie Zeilen 21, 65, 66, 57 | 🟡 KS + Attribution | Massnahme 5 + Zeile 65 |
| 88 | Einordnung (KI) | KI des Kunden | siehe 2.8 | 🟢 KS | Label |

### 2.8 KI-Anbieter (alle mit Kundenschlüssel; ein Disclaimer gilt für alle)

Gemeinsame Regel aller Anbieter: **Schlüssel nicht teilen, verkaufen oder weitergeben, Zugang nicht weiterverkaufen.** Bei BYOK ist der Kunde Vertragspartner. Der Schlüssel darf nie über einen Server des Verkäufers laufen, und es darf keinen gemeinsamen Schlüssel des Verkäufers geben.

| # | Anbieter | Bedingungen (Fundstelle) | Urteil | Massnahme |
|---|---|---|---|---|
| 89a | **Anthropic** | Einbau in eigene Produkte erlaubt (Commercial Terms A.1), Ausgaben gehören dem Kunden (B). AUP: Finanzen sind Hochrisiko; eine persönliche Kauf-/Verkaufs-/Halte-Empfehlung braucht menschliche Prüfung plus KI-Hinweis, allgemeine Bildungsinhalte sind ausgenommen. Chatbots müssen sich als KI zu erkennen geben. https://www.anthropic.com/legal/commercial-terms · https://www.anthropic.com/legal/aup | 🟢 KS | Keine Einstiege und Kursziele (Sperren beibehalten), `kiEmpfehlungenAn` entfernen, Label, kein Logo. |
| 89b | **OpenAI** | Customer Applications erlaubt (2.2), kein Kauf oder Verkauf von Schlüsseln (3.3(g)), Ausgaben gehören dem Kunden (4.1), „No Publicity“ (10). Keine automatisierten Finanzentscheidungen ohne menschliche Prüfung. **⚠ CDN-PDF und Archiv gelesen** (403). https://cdn.openai.com/osa/openai-services-agreement.pdf | 🟢 KS | Keine Auto-Ausführung von KI-Vorschlägen ohne Bestätigung, Name nur als Auswahltext. |
| 89c | **Google Gemini** (auch Video, FLUX-Begleitung) | Beim Anbieten von API Clients im **EWR, in der Schweiz und im UK nur Paid Services**. Im Gratis-Tarif Training und menschliche Durchsicht. Ab 18 Jahren. Grounding: Suchvorschläge unverändert anzeigen. https://ai.google.dev/gemini-api/terms (28.04.2026) | 🟢 KS (bezahlt in EWR/CH/UK) | UI-Hinweis beim Schlüssel, Altersangabe in der EULA. |
| 89d | **DeepSeek** | Endnutzerdienste erlaubt, Ausgaben gehören dem Kunden; Hinweis „KI, keine Finanzberatung“ Pflicht (8.1). **Name und Logo nicht ohne Erlaubnis verwenden (5.2).** Daten in der VR China, chinesisches Recht. https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html (29.04.2026) | 🟡 unklar | Nur als neutraler „OpenAI-kompatibler Endpunkt“, den der Kunde konfiguriert, oder DeepSeek anfragen. Datenschutzhinweis zur Übermittlung nach China. |
| 89e | **xAI Grok** | Bundled Services erlaubt; der Kunde braucht Bedingungen, die mindestens so streng sind wie die AUP. AUP verbietet nicht regulierte Wertpapier- oder Derivate-Beratung. **⚠ Archiv** (Enterprise Terms 14.08.2026) | 🟡 KS, X-Inhalte unklar | wie Zeile 50, EULA übernimmt die AUP-Inhalte. |
| 89f | **Perplexity** | siehe Zeile 51 | 🟢 KS | – |
| 89g | **Mistral** | Usage Policy verbietet „Offering investment advice … or any form of financial guidance“ ohne Qualifikation, breiter als andere Anbieter. https://legal.mistral.ai/terms/usage-policy (11.06.2026) | 🟡 unklar | Anwalt F-6, nur beschreibende Marktberichte. |
| 89h | **Alibaba DashScope/Qwen** | Endnutzer erlaubt, kein Eigentumsanspruch, kein Weiterverkauf (Product Terms §4.48.1). Die Model-Studio-ToS-Seite gab 404. https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0 | 🟢 KS | Datenschutzhinweis. |
| 89i | **Moonshot (Kimi)** | Customer Applications erlaubt, keine Weitergabe von Schlüsseln, keine Ansprüche auf Ausgaben, Singapurer Recht. https://platform.kimi.ai/docs/agreement/modeluse (30.07.2026) | 🟢 KS | Datenschutz und Speicherort noch prüfen. |
| 89j | **Z.ai (GLM)** | KI-Ausgaben müssen deutlich als KI-generiert gekennzeichnet sein (III.5), Marken nur mit Zustimmung. https://docs.z.ai/legal-agreement/terms-of-use (14.04.2026) | 🟢 KS | Label (ohnehin geplant). |
| 89k | **MiniMax** | **⚠ nicht abrufbar.** | 🟡 unklar | Bis zur Prüfung aus der Anbieterliste nehmen. |
| 89l | **OpenRouter** | BYOK ausdrücklich unterstützt (OAuth PKCE), kein Weiterverkauf; es gelten zusätzlich die Bedingungen des gewählten Modells. https://openrouter.ai/terms (31.08.2026) · https://openrouter.ai/docs/use-cases/oauth-pkce | 🟢 erlaubt | Optional OAuth-PKCE-Anmeldung statt Kopieren des Schlüssels. |
| 89m | **Ollama** (lokal) | Software MIT. Modelllizenzen (z. B. Llama Community License) gelten bei *Verbreitung*; lädt der Kunde selbst, verbreitet der Verkäufer nichts. https://raw.githubusercontent.com/ollama/ollama/main/LICENSE | 🟢 erlaubt | Keine Modelle mitliefern, Hinweis „Lizenz des geladenen Modells beachten“. |
| 90 | **Black Forest Labs FLUX** (Share-Card) | Kein Eigentumsanspruch an Bildern. BFL erhält aber eine **unwiderrufliche Lizenz zum Training** an Ein- und Ausgaben (Service Terms 2b). KI-Kennzeichnungen nicht entfernen (ToS 1.3(p)), Endnutzer-Bedingungen nach FLUX Usage Policy. https://bfl.ai/legal/flux-api-service-terms (04.08.2026) | 🟢 KS | Hinweis zum Training. Prüfen, ob `sharp` C2PA- und Wasserzeichen-Metadaten entfernt (falls ja, erhalten). |

### 2.9 Strategie-Layer

| # | Funktion | Quelle | Bedingungen | Urteil | Massnahme |
|---|---|---|---|---|---|
| 91 | Backtests, Detektoren, Coin-Rangliste, Paper-Engine | Binance REST-Kerzen | wie Zeile 10 | 🟡 unklar | wie Zeile 10 |
| 92 | Agent-Modus (Paper/Shadow/Live), Strategie-Editor mit KI | Broker des Kunden + KI des Kunden | Zeilen 1–4 und 2.8 | 🟢 KS | Rechtsfrage F-7 (automatisierter Handel), Disclaimer. |

> **Nachtrag S13 (19.10.2026):** Der scharfe Handel ist ausgebaut. AutarkTrade sendet keine Orders mehr;
> Agent-Modus heisst jetzt Papier- und Schattenbetrieb (Simulation). Order-Adapter, Stop-Wächter, Margen-Netz,
> Abgleich und Live-Freigabe liegen auf `spaeter/scharfer-handel` (`docs/SPAETER-SCHARFER-HANDEL.md`).
> Damit entfallen die Live-Teile der Zeilen 3 und 4 (Zeile 4 ganz) und Zeile 92 wird zur reinen
> Simulation; F-7 ist für diese Auslieferung gegenstandslos und wird erst beim Zurückholen wieder offen.

**Zählung:** 🟢 41 · 🟡 45 · 🔴 18 (104 Zeilen). Die Zeilen 40 und 83 sind gemischt; gezählt ist ihre schlechtere Farbe. Die KI-Zeilen 89a–m zählen einzeln.

---

## 3. Bibliotheken, Schriften, Icons und Assets

### 3.1 Übersicht

Produktionsbaum laut `package-lock.json` (ohne Dev): 200 MIT, 18 Apache-2.0, 10 ISC, 6 BSD-3, 1 BSD-2, 2 0BSD, 1 MIT-0, dazu **14 Pakete mit LGPL-Anteil (sharp/@img)**, `markerjs2` (Linkware), `dompurify` (MPL-2.0 OR Apache-2.0), `pako` (MIT AND Zlib), `rgbcolor` (MIT OR FEEL-FREE), `expand-template` (MIT OR WTFPL) und `rc` (BSD-2 OR MIT OR Apache). Build-Werkzeuge (vite, lightningcss MPL-2.0) landen nicht im Image.

| Komponente | Lizenz | Pflichten beim Verkauf | Empfehlung | Aufwand |
|---|---|---|---|---|
| lightweight-charts 5.2.1 | Apache-2.0 + NOTICE | Lizenztext. **NOTICE-Text** „TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/“ und Link auf einer für Nutzer erreichbaren Seite (README „License“). **Ist-Zustand:** `ChartPanel.vue:145` `attributionLogo: false`; der Ersatzlink `Chart.vue:632` verschwindet mit der zuklappbaren Seitenleiste (`v-if`, Z. 580). Das widerspricht auch CLAUDE.md. | `attributionLogo: true` einschalten (wie `tradeBild.js:82`), NOTICE auf der Seite „Über/Lizenzen“. | klein |
| echarts 6.1 + zrender | Apache-2.0 (NOTICE), d3-Teile BSD-3, zrender BSD-3 | Apache-Text + NOTICE „Apache ECharts …“, BSD-Texte. Keine UI-Pflicht. | behalten | klein |
| markerjs2 2.32.7 | Linkware | Klausel 2: Link zur marker.js-Website während des Betriebs oder gleichwertige öffentliche Attribution. Die kommerzielle Lizenz hebt nur das auf (Preis für marker.js 2 aktuell unklar; marker.js 3 laut Website 499 $ Single App). https://markerjs.com/ | **ersetzen** durch eigene Annotation (Pfeil, Rechteck, Text, Freihand in Canvas/SVG; nur `screenshots.js` und `Screenshot.vue`) | mittel |
| sharp 0.35 + @img/sharp-libvips | Apache-2.0 + **LGPL-3.0-or-later** (libvips, glib, pango, librsvg …), cairo MPL-2.0 | Hinweis, GPL- und LGPL-Text, Quellcode-Angebot für die libvips-Binärdatei. **EULA darf Änderung und Reverse Engineering zum Debuggen nicht verbieten** (LGPLv3 §4). | **ersetzen**: Share-Card im Browser rendern (html2canvas/Canvas ist vorhanden) oder `@napi-rs/canvas` (MIT). Genutzt nur in `flux-api.js` und `default-templates.js`. | mittel |
| dompurify | MPL-2.0 OR Apache-2.0 | Apache wählen: Text und Copyright | behalten | klein |
| quill 2.0.3 (npm) | BSD-3 | Lizenz in der Dokumentation | behalten; **CDN-Kopie 2.0.0-rc.5 in `index.html` streichen** (doppelt geladen) | klein |
| nodemailer 9 | MIT-0 | keine | behalten | – |
| better-sqlite3 (SQLite Public Domain), jspdf, html2canvas, vue, vue-router, vue-i18n, knex, pg, axios, lodash, dayjs, papaparse, sortablejs, calendarize, ws, express, http-proxy, pako, rgbcolor | MIT (pako + Zlib) | Copyright- und Lizenzhinweis in einer Sammeldatei (Vite entfernt Lizenzkommentare möglicherweise) | behalten | klein |
| Bootstrap 5.3.3 CSS+JS, Popper 2.11.8 (CDN) | MIT | Hinweis | **lokal bündeln** (npm) | klein |
| Font Awesome 4.7 (CDN) | Font OFL-1.1, CSS MIT | OFL- und MIT-Text bei Bündelung | **ersetzen** (nur 5 Icons in 4 Dateien) durch das neue Icon-Set | klein |
| Iconscout Unicons 4.0.8 (CDN) | **IconScout Simple License** (keine OSI-Lizenz) | Weitergabe nur unter denselben Bedingungen; „no additional terms … or technical measures“, die die Rechte einschränken. Das steht womöglich im Konflikt mit EULA und Lizenzschlüssel (**unklar**). https://cdn.jsdelivr.net/npm/@iconscout/unicons@4.0.8/LICENSE | **ersetzen** durch Lucide (ISC), Tabler (MIT) oder Bootstrap Icons (MIT): 194 Icons in 97 Dateien | mittel–gross |
| Google Fonts Nunito Sans, Bebas Neue | OFL-1.1 | OFL-Text bei Bündelung. Dynamisches Laden überträgt die IP an Google (LG München I, 20.01.2022, 3 O 17493/20). | **lokal bündeln** (@fontsource) | klein |
| jsDelivr-CDN allgemein | – | IP-Übertragung an das CDN, Offline-Ausfall | alles lokal bündeln, SRI entfällt | klein |
| Docker-Basis `node:20-slim` + `fonts-dejavu-core`, `fonts-liberation` | Debian: viel GPL/LGPL; DejaVu Bitstream Vera; Liberation OFL | Beim Verteilen des Images: Quellcode-Angebot für GPL/LGPL-Pakete (snapshot.debian.org), `/usr/share/doc/*/copyright` behalten | Quellen-Hinweisseite. Alternativ Paket für das Node des Kunden. | mittel |
| Android-Widget: AndroidX (appcompat, core-ktx, work-runtime-ktx), Kotlin, OkHttp 4.12 + Okio | Apache-2.0; OkHttp enthält `publicsuffixes.gz` (MPL-2.0) mit eigener NOTICE | Apache-Text, NOTICE der Public-Suffix-Liste behalten | behalten, Lizenzen-Bildschirm oder -Datei | klein |
| ESP32: TFT_eSPI 2.5 | FreeBSD + BSD (Adafruit_GFX) + MIT (Adafruit_ILI9341) | Texte in der Dokumentation der Firmware | behalten | klein |
| ESP32: ArduinoJson 7, XPT2046_Touchscreen | MIT; XPT2046 mit „development funding notice“ | Hinweis inkl. Funding-Notiz | behalten | – |
| ESP32: Arduino-ESP32-Core 2.0.14 | **LGPL-2.1-or-later** (Print, WString, WiFi, WebServer, SPI), daneben Apache-2.0 | Statisch gelinkt: Der Käufer muss neu linken können (Objektdateien oder Quellcode der Firmware bzw. 3 Jahre gültiges Angebot), LGPL-Text und Core-Quellen | **Firmware-Quellcode separat unter MIT offenlegen** (enthält keine Kernlogik) | klein |
| Cinnamon-Desklet | keine Lizenzangabe | Für Spices-Einreichungen ist Open Source verlangt; ob es als abgeleitetes Werk von Cinnamon (GPL) gilt, ist unklar | separat unter MIT veröffentlichen, Lizenzangabe ergänzen | klein |
| `src/assets/donate-paypal.jpg`, `donate-btc.png` (`SideMenu.vue:13-14`) | PayPal-Wortmarke, fremde App-Oberfläche, Initialen „RM“ | Markenrichtlinien PayPal | **entfernen** | klein |
| `src/assets/icon.png`, `favicon.png`, `assets/social-preview.png` | eigene Commits (`c506ed7`); `icon.png` vermutlich KI-generiert (Funkel-Symbol), Text „CRYPTO TRADING JOURNAL“ | Schutzfähigkeit von KI-Bildern fraglich | **neu gestalten** für AutarkTrade (und als Marke schützen lassen) | klein |
| Schriften sonst | nur Systemschriften (kein `@font-face`) | – | – | – |

### 3.2 Mitzuliefernde Texte (THIRD-PARTY-NOTICES in App, Image, APK und Firmware-Doku)

- **Apache-2.0-Volltext** für lightweight-charts, echarts, sharp (falls behalten), dompurify, AndroidX, Kotlin, OkHttp/Okio, ESP-IDF-Teile.
- **NOTICE wörtlich** für TradingView Lightweight Charts, Apache ECharts und OkHttp `publicsuffix/NOTICE`.
- **BSD-3-Texte:** d3 (in ECharts), zrender, Quill.
- **BSD/FreeBSD und MIT:** TFT_eSPI mit Adafruit-Teilen.
- **MIT/ISC-Sammlung:** alle übrigen npm-Pakete, Bootstrap, Popper, ArduinoJson, XPT2046 (mit Funding-Notiz).
- **OFL-1.1:** Nunito Sans, Bebas Neue, Liberation (und Font Awesome, solange es drin ist).
- **Bitstream Vera:** DejaVu im Image.
- **GPL-3 + LGPL-3 + Quellcode-Angebot:** libvips und Co., solange sharp bleibt.
- **LGPL-2.1 + Quellen oder Objektdateien:** Arduino-ESP32-Core.
- **Quellenangebot GPL/LGPL:** Debian-Pakete im Docker-Image.
- Solange behalten: IconScout Simple License, markerjs2-Linkware.

### 3.3 Sichtbare Pflichten in der UI (Soll-Zustand)

1. TradingView-Logo im Chart (`attributionLogo: true`) und NOTICE auf der Seite „Über/Lizenzen“. Das ist die einzige verbleibende Pflicht-Anzeige aus Bibliotheken, wenn markerjs2, Unicons und sharp ersetzt sind.
2. Datenquellen-Attributionen (keine Bibliotheken, aber Pflicht laut Abschnitt 2): „Powered by CoinGecko“, „Quelle: Alternative.me“, „Quelle: Federal Reserve Board“, „Quelle: 4chan /biz/“, „Powered by GoPlus Security“, „Daten: CryptoQuant“.
3. KI-Label an jedem KI-Text, Chat und Bild.

### 3.4 „Möglichst lizenzfrei“: Was durch eigenen Code oder freie Pakete ersetzt werden sollte

| Ersetzen | durch | Grund |
|---|---|---|
| Unicons | Lucide (ISC), Tabler (MIT) oder Bootstrap Icons (MIT) | Keine OSI-Lizenz, Weitergabeklausel steht womöglich im Konflikt mit der EULA. |
| Font Awesome 4.7 | dasselbe neue Icon-Set | OFL-Pflichten, veraltet, nur 5 Icons. |
| markerjs2 | eigene Annotation | Linkware-Anzeigepflicht. |
| sharp/libvips | Rendern im Browser oder `@napi-rs/canvas` (MIT) | LGPL-Pflichten inkl. EULA-Klausel. |
| alle CDN-Einbindungen, Google Fonts | npm-Pakete bzw. @fontsource lokal gebündelt | IP-Übertragung (DSGVO-Risiko), Offline-Fähigkeit. |
| Quill-CDN rc.5 | nur die npm-Version 2.0.3 | Doppelt geladen. |
| Arduino-Core (Firmware) | Firmware offenlegen (MIT); ESP-IDF-Neubau nur, falls nötig | LGPL-2.1, statisch gelinkt. |

Was bleibt, ist nur MIT, ISC, BSD oder Apache. Die einzige sichtbare Pflicht ist das TradingView-Logo, dazu die Pflicht-Attributionen der Datenquellen.

---

## 4. Offene Rechtsfragen für den Anwalt

- **F-1 „Wer nutzt die API?“** Die Software läuft beim Kunden, die Anfragen kommen von seiner IP, Verkäufer und Kunde haben keinen gemeinsamen Server. Reicht das, um Klauseln wie „no commercial use“ bzw. „data feeding services“ (Binance, Bybit, Bitget, Kraken, Gate, KuCoin, Coinbase) als Pflichten nur des Kunden zu sehen? Bybit und Bitget nennen ausdrücklich auch den „API Client“, Upbit verbietet sogar die *Nutzung* fremder Programme. Wie ist das nach Schweizer Recht (Lauterkeitsrecht UWG, Vertragsrecht, Anstiftung oder Beihilfe zum Vertragsbruch) und nach EU-Recht zu beurteilen?
- **F-2 Binance.** Welche Fassung der Binance-Bedingungen gilt für Schweizer und EU-Kunden (Binance-Gesellschaft, MiCA-Lizenz)? Erlaubt sie die Anzeige öffentlicher Marktdaten in verkaufter Software? Wie formuliert man die Anfrage bei Binance? Das ist die Schlüsselfrage für über 20 Funktionen.
- **F-3 Speichern von Marktdaten.** Darf die Software Orderbuch, Trades und Liquidationen beim Kunden aufzeichnen (Rekorder, Replay, Liq-Kalibrierung), auch über Monate?
- **F-4 Presse-RSS und KI-Zusammenfassung.** Haftet der Verkäufer, wenn der Kunde Verlags-Feeds einträgt und die Software sie per KI zusammenfasst (EU-Richtlinie 2019/790 Art. 4/15, TDM-Opt-out, Schweizer URG)? Reicht es, keine Feeds vorzubelegen?
- **F-5 Telegram.** Fällt das Lesen von Kanälen, in denen der Kunden-Bot Mitglied ist, mit anschliessender KI-Auswertung unter das KI-Verbot der Content-Licensing-Bedingungen?
- **F-6 Finanzberatung.** Sind KI-Lageberichte, Chart-Analysen mit Marken und „Bedingungen“ (Handelslage) und Coin-Ranglisten nach FIDLEG/FINIG (Schweiz) bzw. MiFID II/MiCA (EU) eine Anlageberatung oder -empfehlung? Welche Disclaimer braucht es? Mistral verbietet „any form of financial guidance“ ohne Qualifikation, Anthropic und xAI fordern menschliche Prüfung bei persönlichen Empfehlungen.
- **F-7 Automatisierter Handel.** *(S13: für die erste Auslieferung gegenstandslos — der scharfe Handel ist ausgebaut,
  `docs/SPAETER-SCHARFER-HANDEL.md`; vor dem Zurückholen klären.)* Ist die Live-Ausführung von Strategien über den Schlüssel des Kunden (Stop-Wächter, Margen-Netz, Agent-Modus) eine bewilligungspflichtige Tätigkeit, oder reines Werkzeug? Welche Haftungsausschlüsse sind in AGB gegenüber Konsumenten wirksam (Schweiz OR 100, EU-Klauselrichtlinie)?
- **F-8 EU AI Act Art. 50.** Ist der Verkäufer Anbieter eines KI-Systems (Art. 3 Nr. 3), obwohl der Kunde Modell und Schlüssel wählt? Welche maschinenlesbare Kennzeichnung ist ab wann Pflicht (Aufschub durch den Digital Omnibus nicht verifiziert)?
- **F-9 Datenschutz.** Übermittlung an KI-Anbieter in Drittstaaten (DeepSeek: China; Moonshot, Z.ai: Singapur) auf Veranlassung des Kunden: Rolle des Verkäufers nach DSG und DSGVO? Pflichtangaben in der Datenschutzerklärung der Software?
- **F-10 Länder.** Darf der Verkauf an Kunden in Ländern erfolgen, in denen eine unterstützte Börse gesperrt ist (Bitget: DE/AT/FR, Bitunix: FR, Pionex: NL/ES/FR/UK)? Reicht ein Hinweis?
- **F-11 Markennamen.** Dürfen Börsen- und KI-Anbieter-Namen beschreibend in UI und Marketing stehen („unterstützt Bitunix“)? DeepSeek (5.2), OpenAI (10) und OKX (9.5) verlangen schriftliche Zustimmung schon für die Nennung bzw. für Marken.
- **F-12 IconScout Simple License.** Ist sie mit EULA und Lizenzschlüssel vereinbar? Falls nicht, wird ersetzt (siehe 3.4).
- **F-13 LGPL in der EULA.** Wie formuliert man die Ausnahme für Reverse Engineering (LGPLv3 §4) so, dass sie auf die LGPL-Teile beschränkt bleibt? Das entfällt, wenn sharp ersetzt wird.
- **F-14 Anbieteranfragen (kein Anwalt nötig, aber schriftlich festhalten):** Binance, Bitunix, Bitget (Broker-Programm), Bybit, Coinbase, Kraken, KuCoin, Gate, CoinGecko (Demo-Tarif, Logos), GoPlus (geltende Vertragsfassung), RugCheck, CryptoQuant, Massive, Databento, xAI (Anzeige von X-Inhalten), DeepSeek (Namensnennung), trumpstruth.org.

---

## 5. Belegqualität im Detail

| Quelle | Status |
|---|---|
| Binance global | ⚠ Bot-Abwehr; australische ToU gelesen, ein archiviertes Zitat nur über eine Drittquelle |
| Coinbase Market Data Terms | ⚠ 403, Suchauszüge |
| KuCoin | ⚠ Zeitüberschreitung, Suchauszüge |
| Gate | ca. 100k von 135k Zeichen gelesen |
| Upbit | Revisions-PDF 2023 gelesen, keine Webseite mit der aktuellen Fassung |
| Bybit API T&C | gelesen, Datum des PDFs nicht angegeben |
| ForexFactory | ⚠ 403, Suchauszüge |
| CryptoQuant | ⚠ 403, Suchauszüge |
| RugCheck | ⚠ DNS-Fehler, nicht gelesen |
| Reddit Data API Terms | ⚠ Domain gesperrt; RSS-Abschaltung aus drei Presseberichten |
| GeckoTerminal API-Terms | 404, Site-Terms und CoinGecko-API-Terms gelesen |
| OpenAI | ⚠ 403; CDN-PDF und Archivkopie der Usage Policies |
| xAI | ⚠ 403; Archivkopien vom 12. und 18.10.2026 |
| MiniMax | ⚠ nicht erreichbar |
| Databento /legal, ntfy /terms | Inhalt nur per JavaScript, nicht gelesen |
| Yahoo | nur US-Fassung gelesen (nicht Yahoo EMEA) |
| Verlags-RSS-Bedingungen | einzeln nicht gelesen |

Alle übrigen Fundstellen wurden am 19.10.2026 direkt gelesen.

---

## Anhang: Umsetzungsstand nach S12 „Quellen & Pflichthinweise“ (19.10.2026)

Umgesetzt sind die Massnahmen 1–6 und 9 sowie die Quellen-Teile von 10 (Lizenztexte/EULA: S10; Icons/markerjs2: S8/S9).
Die Ampel der Tabelle oben beschreibt die **Bedingungen der Anbieter** und ändert sich durch Code nicht; diese Spalte sagt, was
der Code heute tut. „KS“ = nur mit Kundenschlüssel. Grundlage für alle Marktdaten-Zeilen ist die neue Einstellung
**Einstellungen › Datenquellen › Marktdatenquelle** (`binance` | `bitget` | `aus`, `server/marktdaten/`) mit dem Hinweis, dass der
Kunde die Nutzung der gewählten Quelle selbst prüft und verantwortet. Fehlt der Quelle eine Fähigkeit, zeigt die Funktion
„nicht verfügbar“ mit Grund (`QuelleAus`), statt kaputt auszusehen.

| # | Stand nach S12 |
|---|---|
| 1–4 | unverändert (KS, Kontofunktionen). Länderhinweise: EULA (S10). |
| 5, 6 | unverändert (Excursions/OHLCV, kein Schlüssel ab Werk). |
| 7 | Update-Kanal: S10. |
| 8, 9 | unverändert. |
| 10 | **umgesetzt:** Kerzen, Ticker, Watchlist und laufende Kerze des Charts über die gewählte Marktdatenquelle; Binance-REST/-WebSocket nur bei Wahl Binance. Keine Binance-Adresse mehr ausserhalb von `server/marktdaten/binance.js` (Selbsttest prüft das). Gespeicherte Binance-Panels werden bei anderer Wahl umgestellt (mit Hinweis). |
| 11, 12 | unverändert wählbar (Bitunix/Bitget-Chartquellen); Bitget ist zugleich zweite Marktdatenquelle, Bitunix Vorgabe des Charts bei `aus`. Anfragen bei den Börsen offen (F-14). |
| 13 | **umgesetzt:** nur Text-Kürzel und Links; Links zu Upbit, OKX, MEXC, Alpha entfallen. |
| 14 | unverändert. |
| 15 | **umgesetzt:** Chart-KI und Chart-Chat mit Label „KI-generiert – keine Anlageberatung – Fakten prüfen“, `data-ki-generiert`, `kiGeneriert` in der API; `kiEmpfehlungenAn` entfernt, Prognose-Prüfung immer an. |
| 16 | **umgesetzt:** Chart-Alarme auf Preisen der Marktdatenquelle; ohne Ticker ruht der Takt, neue Alarme werden abgelehnt. |
| 17 | **umgesetzt:** Funding über die Marktdatenquelle; Hebelzonen nur mit Binance, sonst „nicht verfügbar“. |
| 18 | unverändert. |
| 19 | **umgesetzt:** „Quelle: Alternative.me“ mit Link direkt an der Kachel (klein, gross, Pult) und im Strategie-Layer. |
| 20 | **umgesetzt:** CoinMarketCap-Import entfernt. Dominanz-Kurve nur aus eigenen täglichen Schnappschüssen über CoinGecko `/global` (KS); CMC-Altbestand bleibt ungezeigt in der DB. |
| 21 | **umgesetzt:** Dominanz und Marktübersicht nur mit CoinGecko-Kundenschlüssel (Einstellungen › Datenquellen, Demo/Pro), „Powered by CoinGecko“ mit Link, ohne Schlüssel aus mit Begründung. Bestätigung des Demo-Tarifs durch CoinGecko offen. |
| 22–24 | **umgesetzt:** Funding, Long/Short + OI, RSI, Altseason, Trades × Regime über die Marktdatenquelle (Long/Short und OI-Historie nur Binance); Herkunft dynamisch „Daten: <Quelle>“. Bitget-Aktien-/Rohstoff-Kontrakte (`isRwa`) ausgefiltert. Bybit-Funding-Spalte bleibt (gelb). |
| 25 | **umgesetzt:** blockchain.info entfernt; Rainbow und Pi-Cycle aus BTCUSDT-Spot-Tageskerzen der Marktdatenquelle ab 2017 (Rainbow neu kalibriert, Steigung 4,40 statt 4,95; Pi-Cycle ohne die Kreuzungen 2013/2017). Rückfalldatei gelöscht. |
| 26, 44 | **umgesetzt:** Rekorder (Orderbuch, forceOrder, aggTrade) startet nur mit Fähigkeit `streams` (Binance); Bybit-Strom `liqB` bleibt. Speicherfrage F-3 offen. |
| 27 | über die Marktdatenquelle; Bybit bleibt (gelb). |
| 28, 39 | **umgesetzt:** Yahoo Finance entfernt. Makro-Kachel ohne ES/NQ/RTY/DXY (sagt es), Indizes-Kachel „nicht mehr angebunden“. Databento/Massive geprüft und verworfen (Massive §1 schliesst Apps für andere Endnutzer aus; Databento-Terms nicht lesbar, CME-Lizenzen). |
| 29 | **umgesetzt:** Stablecoin-Menge nur mit CoinGecko-KS und Attribution. |
| 30 | **umgesetzt:** „Daten: CryptoQuant“ an der ETF-Kachel; Anfrage bei CryptoQuant offen. |
| 31 | **umgesetzt:** Wal-Kachel entfernt („nicht mehr angebunden“), kein Telegram-Abruf. |
| 32, 42 | **umgesetzt:** Gesamtlage und Handelslage ohne Yahoo/ForexFactory, ausgefallene Quellen fallen weg; KI-Label und `kiGeneriert`; Verbot von Einstiegen/Kurszielen fest. |
| 33 | **umgesetzt:** Hebelkarte und Liq-Kalibrierung nur mit Binance, sonst „nicht verfügbar“. |
| 34 | **umgesetzt:** undokumentierter `bapi`-Brackets-Endpunkt entfernt; Wartungsmarge aus Bybit-Risikolimit, sonst feste Vorgabe 0,004 mit Hinweis (Einstellung `binance` → `bybit` migriert). |
| 35 | unverändert (Bybit, gelb). |
| 36 | **umgesetzt:** Bookmap verbindet nur bei Wahl Binance, sonst „nicht verfügbar“. Replay spielt eigene Aufzeichnungen (F-3). |
| 37 | Bybit-Vergleich bleibt, für neue Installationen aus. |
| 38 | **umgesetzt:** OKX-Spalte entfernt. |
| 40, 47, 48 | **umgesetzt:** ForexFactory entfernt. Kalender aus amtlichen Quellen: Federal Reserve (`calendar.json`, ohne 7-Tage-Grenze), BEA (ICS, 17 U.S.C. §105) und Eurostat (ICS, Euro-Indikatoren, Wiederverwendung mit Quellenangabe und Bearbeitungshinweis); je „Quelle: …“ mit Link. BLS (HTTP 403 für Skripte) und EZB (nur HTML) nicht eingebaut — US-CPI und Arbeitsmarktbericht fehlen. Altzeilen bleiben, fallen aus dem Fenster. Länder-Vorgabe `USD,EUR`. |
| 41 | über die Marktdatenquelle (`getClosedCandles`); Spot/Futures-Verhältnis nur, wo die Quelle beides hat. |
| 43 | unverändert. |
| 45 | **umgesetzt:** Lagebericht, Zwischenmeldungen, Archiv, Punkte, Video-Stichpunkte mit Label; API `kiGeneriert`; Mail mit Label-Zeile und Kopf `X-AI-Generated: true`. |
| 46, 53 | **umgesetzt:** keine vorbelegten News-Quellen mehr (Seed-Liste leer, Onboarding ohne Vorschläge, ohne Telegram/Truth Social). Bestehende, selbst angelegte Quellen bleiben. TDM-Opt-out-Prüfung und F-4 offen. |
| 49 | unverändert (YouTube-RSS, gelb) — Umstellung auf YouTube Data API mit KS offen. |
| 50, 51 | unverändert (KS). |
| 52, 63 | **umgesetzt:** Telegram-Scraping entfernt (News und Frühphase); bestehende Telegram-Quellen per Migration abgeschaltet und markiert, nicht gelöscht; neue nicht anlegbar. |
| 54 | unverändert. |
| 55 | **umgesetzt:** CoinGecko-Trending und Tiefensuche nach Symbol nur mit KS, „Powered by CoinGecko“. |
| 56 | **umgesetzt:** CoinPaprika entfernt. |
| 57 | **umgesetzt:** „Daten: DexScreener“ mit Link an allen Hype-Ansichten. |
| 58 | **umgesetzt:** keine Token-/Coin-Logos mehr, Platzhalter mit Ticker-Initialen (`TickerZeichen.vue`). |
| 59 | **umgesetzt:** alle GeckoTerminal-Abrufe über die CoinGecko-`/onchain`-Endpunkte mit KS; ohne Schlüssel aus, mit Attribution. |
| 60 | **umgesetzt:** pump.fun-API vollständig entfernt (Listen, Coin, King of the Hill, Kommentare, Ersteller-Bilanz, Messung); Kurve/Graduierung aus DexScreener. Die Frühphase sieht Token erst ab dem ersten Pool (in UI und Hilfe gesagt). Reine Links auf pump.fun-Seiten bleiben. |
| 61 | **umgesetzt:** Reddit-RSS entfernt; Sozial-Teilnote ohne Signal unbekannt statt 0. |
| 62 | **umgesetzt:** „Quelle: 4chan /biz/“ mit Link. |
| 64 | unverändert (KS, gelb). |
| 65 | **umgesetzt:** „Powered by GoPlus Security“ mit Link an Sicherheits- und Projektanzeigen (Logo nicht eingebaut; geltende Vertragsfassung bei GoPlus anfragen). |
| 66 | **umgesetzt:** Schalter „RugCheck nutzen“ mit Hinweis auf ungeklärte Bedingungen; ab Werk aus, bestehende Installation per Migration an. |
| 67 | **umgesetzt:** öffentlicher Solana-Knoten keine Vorgabe mehr; Smart Money nur mit eigener RPC-Adresse, sonst aus mit Grund. |
| 68–71 | unverändert. |
| 72 | **umgesetzt:** Hype-KI-Bericht mit Label, `data-ki-generiert`, `kiGeneriert` (Route und Rückgabe). Günstiges Hype-Profil von DeepSeek auf Qwen umgestellt. |
| 73, 74 | unverändert. |
| 75 | **umgesetzt:** Binance im Börsen-Beobachter über die Marktdatenquelle (Fähigkeit `listungen`), sonst „aus“ mit Grund. |
| 76, 78, 82 | **umgesetzt:** Binance Alpha, Upbit, MEXC entfernt (zwischengespeicherte Listen per Migration gelöscht). |
| 77, 79–81 | **umgesetzt:** Coinbase, Kraken, KuCoin, Gate ab Werk aus, Schalter je Börse; bestehende Wahl bleibt. |
| 83 | **umgesetzt:** OKX entfernt; Bybit und Bitget bleiben an (gelb, Anfrage offen). |
| 84 | **umgesetzt:** Rangliste, Einzelprüfung, Watchdog über die Marktdatenquelle (Bitget: ein `tickers`-Abruf). Ohne Marktdaten antworten die Routen „aus“. |
| 85 | unverändert (Bitunix/Bitget öffentlich). |
| 86 | **umgesetzt:** Abverkauf-Wache nur mit Binance, sonst ruht sie und die Seite sagt es. |
| 87 | **umgesetzt:** Coin-Info und Tiefensuche über CoinGecko nur mit KS; Attribution CoinGecko, GoPlus, RugCheck, DexScreener; keine Bilder. |
| 88 | **umgesetzt:** Coin-Radar-Einordnung mit Label, `kiGeneriert` bis in die Lauf-Antwort. |
| 89a, 89b, 89j | **umgesetzt:** Label an allen KI-Ausgaben, keine Empfehlungen, kein Schalter, keine Anbieter-Logos. |
| 89c | **umgesetzt:** Gemini-Hinweis (in EWR/CH/UK nur Bezahl-Schlüssel, Training im Gratis-Tarif) bei Schlüssel, Anbieterwahl, Onboarding, Bild-Anbieter. Altersangabe: EULA (S10). |
| 89d | **umgesetzt:** DeepSeek nur noch als neutraler „OpenAI-kompatibler Endpunkt 2“ mit selbst eingetragener Basis-URL und Hinweis zur Übermittlung (ggf. Drittstaat); Bestand per Migration lauffähig. DeepSeek-Suche (Recherche-Weg) entfernt, gespeicherte Wahl fällt auf Perplexity zurück. |
| 89e–89i, 89l | unverändert (KS). |
| 89k | **umgesetzt:** MiniMax aus der Auswahl (abgekündigt, Bestand läuft mit Hinweis). |
| 89m | **umgesetzt:** Ollama-Hinweis „Lizenz des geladenen Modells beachten“. |
| 90 | **umgesetzt:** FLUX-Trainingshinweis; Share-Bild mit sichtbarem Label und PNG-Metadaten (tEXt `AI-Generated`, XMP/IPTC `compositeWithTrainedAlgorithmicMedia`). Das C2PA-Manifest des Anbieters geht beim Zusammensetzen im Browser verloren (im Code dokumentiert; Umkopieren wäre eine gebrochene Signatur). |
| 91 | **umgesetzt:** Backtests, Detektoren, Engine über die Marktdatenquelle; mit Bitget kürzere Historie (Hinweis im Log, Freigaben beruhen auf Binance-Historie). |
| 92 | **umgesetzt:** Strategie-Builder und KI-Vorschläge im Labor mit Label. |
| 3, 4, 92 (S13) | **umgesetzt:** scharfer Handel ausgebaut — keine Orders, kein Stop-Wächter, keine Live-Freigabe; Strategien nur Papier/Schatten. Zeile 4 entfällt, Zeile 3 nur noch Import/Grid-Bots/Futures lesend. Ein Selbsttest (`server/execution/__selftest-broker-registry.mjs`) schlägt an, wenn ein Order-Pfad von Bitunix oder Pionex in den Server zurückkehrt. LICENSE Fassung 0.2, Ziffer 7: die Software gibt keine Orders auf. |

**Abschnitt 3.3 (sichtbare Pflichten):** Punkt 1 (TradingView-Logo) seit S2/S5 an, NOTICE in S10. Punkt 2: Alternative.me,
CoinGecko, Federal Reserve (dazu BEA, Eurostat), 4chan /biz/, GoPlus, CryptoQuant, DexScreener eingebaut. Punkt 3: KI-Label an
jedem KI-Text, Chat und Bild.

**Weiter offen (nicht Code):** Anfrage Binance (F-2) und die Anbieteranfragen aus F-14; Anwaltsfragen F-1 bis F-13.

---

## Anhang 2: Nachprüfung gegen den Endstand (S11, 19.10.2026)

Geprüft gegen master nach S3–S10 und S12 (vor dem S11-Merge). Die Ampel oben bleibt die der Anbieterbedingungen; hier
steht, ob die Zeilen und Abschnitt 3 noch zum Code passen.

### Abhängigkeiten

- **`package.json`**: 22 Laufzeitpakete (axios, better-sqlite3, calendarize, dayjs, dompurify, echarts, express,
  html2canvas, http-proxy, jspdf, knex, lightweight-charts 5.2.1, lodash, nodemailer, papaparse, pg, quill, sortablejs, vue,
  vue-i18n, vue-router, ws), Build-Werkzeuge nur vite und @vitejs/plugin-vue. `"private": true`,
  `"license": "SEE LICENSE IN LICENSE"`. Gegenüber Abschnitt 3.1 **entfallen**: sharp/@img (LGPL, S10), markerjs2
  (Linkware, S8), Bootstrap/Popper (S9), Font Awesome und Unicons (S9).
- **Produktionsbaum**: 224 Pakete — 195 MIT, 10 ISC, 6 BSD-3, 5 Apache-2.0, 1 BSD-2, DOMPurify (MPL-2.0 OR Apache-2.0),
  pako (MIT AND Zlib) und einige Doppellizenzen mit MIT-Wahl. Keine LGPL/GPL, keine Linkware.
- **`index.html`**: keine externe Ressource mehr (kein CDN, keine Google Fonts; Selbsttest `__selftest-ohne-bootstrap.mjs`).
- **Dockerfile**: Basis `node:20-slim` in beiden Stufen, **keine Schriftpakete mehr** (fonts-dejavu/liberation entfallen
  mit sharp). `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES` unter `/app/`, OCI-Label
  `org.opencontainers.image.licenses=LicenseRef-AutarkTrade-proprietary`. Das Debian-Quellenangebot steht in NOTICE.md.
- **`THIRD-PARTY-NOTICES`**: mit `node scripts/drittlizenzen.mjs` neu erzeugt — **unverändert**, also aktuell (224 Pakete,
  312 KB). Sieben Pakete haben keine Lizenzdatei, nur die Angabe in `package.json` (@vue/devtools-api, agent-base,
  cookie-signature, fancy-canvas, https-proxy-agent, pg-types, pgpass); das Skript setzt dann den Standardtext der
  angegebenen Lizenz ein.

Abschnitt 3.1 ist damit erledigt bis auf die Zeilen, die nicht zum npm-Baum gehören: Docker-Basis (Quellenangebot steht),
Android-Widget, ESP32, Desklet (siehe unten).

### Fremdquellen im Code

Inventar aller festen Adressen in `server/`, `shared/`, `src/` und `index.mjs` (ohne Selbsttests und Fixtures). Jede ist
einer Zeile von Abschnitt 2 zugeordnet:

| Adressen | Zeile(n) | Stand |
|---|---|---|
| fapi.bitunix.com, api.bitget.com, api.pionex.com | 1–4, 11, 12, 85 | KS bzw. öffentliche Kerzen, wie Anhang 1 |
| fapi/api.binance.com, fstream/stream.binance.com | 10, 16, 17, 22–27, 33, 36, 41, 44, 75, 84, 86, 91 | nur in `server/marktdaten/binance.js`, nur bei Wahl Binance |
| api.bybit.com, stream.bybit.com | 22, 26, 27, 34, 35, 37, 83 | gelb, wie Anhang 1 |
| api.coingecko.com, pro-api.coingecko.com (inkl. `/onchain`) | 20, 21, 29, 55, 59, 87 | nur KS, Attribution |
| api.alternative.me | 19 | Attribution |
| www.federalreserve.gov, www.bea.gov, ec.europa.eu | 40, 47, 48 | amtlich, Attribution |
| api.cryptoquant.com | 30 | KS, Attribution |
| api.dexscreener.com | 57, 60 | Attribution |
| api.gopluslabs.io, api.rugcheck.xyz | 65, 66 | Attribution; RugCheck ab Werk aus |
| a.4cdn.org | 62 | Attribution |
| rdap.org, dns.google, cloudflare-dns.com, api.github.com | 69, 70, 71 | grün |
| api.telegram.org (Bot des Kunden), ntfy/Webhook (Adresse des Kunden) | 74 | KS |
| api.coinbase/kraken/kucoin/gateio | 77, 79–81 | ab Werk aus |
| api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, api.x.ai, api.perplexity.ai, api.mistral.ai, api.groq.com, openrouter.ai, api.moonshot.ai, api.z.ai, dashscope-intl.aliyuncs.com, api.minimax.io, api.bfl.ai | 89a–m, 90 | KS, Label |
| api.polygon.io, hist.databento.com | 5, 6 | KS, kein Schlüssel ab Werk |
| api.github.com (Releases des privaten Repos) | 7 | private Quelle (S10) |
| reine Links: tradingview.com, Börsen-Handelsseiten, dexscreener.com, geckoterminal.com, pump.fun, x.com, t.me, youtube.com, coingecko.com, Neon/Supabase/Aiven (Datenbank-Einstellungen), aistudio.google.com | 13, 14, 60 u. a. | Links, keine Daten, keine Logos |

Keine Adresse ohne Zeile; keine der in Anhang 1 entfernten Quellen (Yahoo, ForexFactory, CoinMarketCap, blockchain.info,
pump.fun-API, Telegram t.me/s, Reddit, CoinPaprika, Upbit, MEXC, OKX, Binance Alpha/`bapi`) wird noch abgerufen.

**Abweichungen, die Zeilen betreffen:**

- **Zeile 6 / 5 (Databento, Polygon):** Der „Altcode" ist nicht gelöscht, sondern in S7 clean-room nach
  `src/utils/journal/import.js` (`useGetOHLCV`) und `views/AddExcursions.vue` übernommen worden (der Golden Master
  `__selftest-mfe-pfade.mjs` deckt ihn ab). Er läuft nur mit einem vom Kunden eingetragenen Schlüssel. Urteil bleibt gelb (KS).
- **Zeile 89d (DeepSeek):** Die Oberfläche bietet DeepSeek nicht mehr an, und der Recherche-Weg ist stillgelegt
  (`dsWeg = false` in `server/marktradar-news.js`). Der Code (`rechercheDeepseek`, die Adresse `api.deepseek.com/v1/tools/search`
  in `server/news-recherche.js`) und die Migrations-Konstante `api.deepseek.com/v1` in `server/migrationen/s12-ki.js` stehen
  aber noch im ausgelieferten Server. Kein Abruf, aber der Name steht im Code — **vor dem Verkauf entfernen** (offener Punkt).
- **Zeile 89k (MiniMax):** in `server/ai-models.js` weiter als Eintrag für Bestandskonfigurationen, nicht mehr wählbar.
- **Zeile 7 (Update):** das Repo heisst `Mouses007/AutarkTrade` und ist privat; die Zeile oben nennt noch das alte.

### Begleitprogramme

Stand nach S11: siehe NOTICE.md („Begleitprogramme") und `docs/AUFTRAGSSTAND.md`, Abschnitt S11.

---

## Anhang: Stand nach S15 „Analysequellen zurück" — Quellen zurück hinter Schalter (Vorgabe an) (19.10.2026)

S12 hat alles entfernt, was diese Prüfung für einen **Verkauf** rot oder ungeklärt nennt. Das war für den Eigengebrauch nie
verlangt. Seit S15 kommen diese Quellen zurück, hinter **einem** Schalter: **Einstellungen › Datenquellen › „Quellen ohne
Verkaufsfreigabe"** (`settings.quellenOhneFreigabe`), **Vorgabe an**. An = Verhalten wie vor S12 (altes Journal), aus = Stand
nach S12 (Anhang oben) — für eine spätere Verkaufsversion genügt es, den Schalter aus- und die Vorgabe umzustellen. Die Ampel
der Tabelle bleibt richtig: sie beschreibt die Bedingungen der Anbieter, und an denen ändert der Schalter nichts. Wer ihn
anlässt, nutzt diese Quellen auf eigene Verantwortung (Hinweis an der Einstellung).

Welche Quelle unter den Schalter fällt, steht an **einer** Stelle: `QUELLEN_OHNE_FREIGABE` in `server/quellen/freigabe.js`,
je Eintrag mit den Zeilen dieser Tabelle. Der Selbsttest `server/quellen/__selftest-freigabe.mjs` prüft, dass jede genannte
Zeile hier existiert und jede ID, nach der der Code fragt, in der Liste steht. Bei Schalter aus antworten die Funktionen mit
„Quelle aus" (Grund `ohneFreigabe`) und es geht keine Anfrage hinaus. Behalten aus S12: Marktdatenquelle, Attributionen
(auch für die zurückgekehrten Quellen), KI-Kennzeichnung, Zustand „Quelle aus".

| # | Stand nach S15 (Schalter an) |
|---|---|
| 13 | Börsen-Links zu Upbit, OKX, MEXC wieder da (Hype-Teil). |
| 20 | CoinMarketCap-Dominanz-Import läuft wieder (ID `coinmarketcap`); aus: eigene CoinGecko-Schnappschüsse. |
| 21, 29, 55, 87 | CoinGecko ohne eigenen Schlüssel über den öffentlichen Endpunkt (ID `coingeckoOeffentlich`, zentral `server/quellen/coingecko.js`); ein eigener Schlüssel hat immer Vorrang. Dominanz, Marktübersicht, Stablecoins, Trending, Coin-Info, Tiefensuche laufen ohne Schlüssel. |
| 25 | blockchain.info-Historie ab 2009 für Rainbow und Pi Cycle mit alter Kalibrierung und Rückfalldatei `server/data/btc-monatskurse.json` (ID `blockchaininfo`). |
| 28, 32, 39, 42 | Yahoo Finance: ES/NQ/RTY/DXY in der Makro-Kachel, Indizes-Kachel und Live-Trading-Indizes mit Intraday-Kerzen, Daten wieder in Gesamt- und Handelslage (ID `yahoo`). |
| 31 | Wal-Kachel (Telegram) wieder da (ID `telegram`). |
| 34 | Binance-bapi-Brackets wieder Vorgabe der Wartungsmarge, Bybit als Ersatz (ID `binanceBrackets`, Funktion in `server/marktdaten/binance.js`). |
| 37, 38 | Buch-Leiter: Bybit + OKX, Vergleich ab Werk an (ID `okx`). |
| 40, 47 | ForexFactory Woche/Monat wieder zusätzlich zu Fed/BEA/Eurostat, entdoppelt, „Quelle: ForexFactory"; Kalender-Countdown und Handelslage lesen sie mit. Aus: ForexFactory-Bestand wird nicht gezeigt. |
| 46, 53 | Vorbelegte News-Vorschläge (Verlags-RSS, Truth Social) wieder im Onboarding (ID `newsVorschlaege`). |
| 52 | Telegram-Kanäle als News-Quelle wieder anlegbar, abrufbar, an die KI (ID `telegram`); von S12 abgeschaltete Quellen per Migration wieder an. |
| 56 | CoinPaprika wieder Hype-Quelle (ID `coinpaprika`). |
| 58 | Token-/Coin-Logos wieder sichtbar (ID `tokenbilder`). |
| 59 | GeckoTerminal ohne Schlüssel über api.geckoterminal.com, Ratenbremse 5/min wie früher (ID `geckoterminal`). |
| 60 | pump.fun vollständig zurück: Listen, Coin, King of the Hill, Kommentare, Ersteller-Bilanz, Kurve, Messung (ID `pumpfun`). |
| 61 | Reddit-RSS mit der Sozialrechnung von vor S12 (ID `reddit`). |
| 63 | Telegram-Kanäle der Frühphase werden wieder gelesen (ID `telegram`). |
| 66 | RugCheck ab Werk an (ID `rugcheck`). |
| 67 | Öffentlicher Solana-Knoten wieder Vorgabe für Smart Money (ID `solanaRpcOeffentlich`). |
| 76 | Binance Alpha im Börsenwächter mit Stufe `alpha` und Alpha-Alarm (ID `binanceAlpha`, Funktion in `marktdaten/binance.js`). |
| 77, 79–81 | Coinbase, Kraken, KuCoin, Gate ab Werk an (ID `gelbeBoersen`). |
| 78, 82, 83 | Upbit, MEXC, OKX (mit Handelsstart) wieder im Börsenwächter (IDs `upbit`, `mexc`, `okx`). |
| 89d | Recherche-Weg „DeepSeek-Suche" wieder wählbar (ID `deepseekSuche`); die neutrale Benennung „Endpunkt 2" bleibt. |

Nicht zurückgeholt, weil keine Datenquelle: neutrale Benennung des Endpunkts 2, MiniMax-Abkündigung, Anbieterhinweise,
KI-Labels und der Wegfall von `kiEmpfehlungenAn`.

**Migration** (`server/migrationen/s15.js`): Spalte mit Vorgabe an; bei Schalter an bei jedem Start die von S12 markiert
abgeschalteten Telegram-Quellen wieder an; einmalig Kalender-Länder `USD,EUR` → `USD,JPY` und Wartungsmarge `bybit` →
`binance`. `server/migrationen/s12.js` überspringt bei Schalter an seine abschaltenden Schritte.

**Geprüft am 19.10.2026** gegen die DB-Kopie (Testcontainer, Testbetrieb, Abruf von Hand über die Routen): Makro, Indizes,
Kalender (Fed 9, BEA 53, Eurostat 15, ForexFactory 86), Dominanz, Rainbow, Pi Cycle, Marktübersicht, Wal-Kachel, Altseason,
Hype-Scan (CoinGecko, DexScreener, GeckoTerminal, pump.fun, CoinPaprika, Reddit), Frühphase (pump.fun, GeckoTerminal) und
Börsenwächter (Alpha, Upbit, OKX, MEXC u. a.; KuCoin aus dem Netz nicht erreichbar) liefern; Schalter aus → `ohneFreigabe`.
