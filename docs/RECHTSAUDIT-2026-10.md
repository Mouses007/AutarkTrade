# Rechtsaudit AutarkTrade

Stand: 22. Oktober 2026 · Gegenstand: Repository `Mouses007/AutarkTrade` (master `e140464`, Release 4.0.0,
AGPL-3.0-or-later) samt Git-Historie, Container-Images (`ghcr.io/mouses007/autarktrade`,
`mouses007/trading-journal:latest`) und die Brückenfassung 3.15.0 des alten Repos
`Mouses007/Crypto-Trading-Journal` (`27a8e6b`).

> **Vorbemerkung.** Verfasser dieses Gutachtens ist kein zugelassener Anwalt. Das Gutachten ordnet
> Sachverhalt, Code und Rechtsgrundlagen so ein, wie es eine Kanzlei für IT-, Datenschutz- und
> Finanzmarktrecht für ihren Mandanten tun würde. Es ersetzt keine anwaltliche Beratung. Die Fragen, die
> wirklich nur eine zugelassene Anwältin oder ein zugelassener Anwalt beantworten kann, stehen in
> Abschnitt 7. Im Übrigen wird ohne weitere Einschränkungen geschrieben.

**Belegqualität der Fundstellen** (Abschnitt 8): ✅ am 22.10.2026 im Netz gelesen · 🟡 nur über
Sekundärquellen oder teilweise gelesen · ⚪ aus Fachwissen, Wortlaut am 22.10.2026 nicht abgerufen
(Fedlex und gnu.org liessen keinen automatischen Abruf zu). Vor einer Verwendung nach aussen sind die
⚪-Stellen am amtlichen Text zu prüfen.

---

## 1. Sachverhalt

1. **Autor und Vertrieb.** Eine Privatperson mit Wohnsitz in der Schweiz, auf GitHub „Mouses007“,
   veröffentlicht AutarkTrade seit dem 22.10.2026 als freie Software unter der AGPL-3.0-or-later. Die
   Software kostet nichts. Sie wird über GitHub (Quelltext, Releases), ghcr.io und Docker Hub verteilt.
   Jeder Nutzer betreibt sie selbst, lokal oder auf eigener Hardware. Der Autor betreibt keinen Dienst
   und erhält keine Nutzungsdaten. Eine Telemetrie gibt es nicht. Die Update-Prüfung fragt die
   öffentliche GitHub-API ab.
2. **Spenden.** In der App gibt es einen Menüeintrag „Spenden“, einen Kaffee-Knopf und seltene
   Nachfragen (`server/spenden.js`): bei 50, 200, 500 und 1000 bewerteten Trades, nach Updates und alle
   90 Tage, höchstens einmal in 30 Tagen, abschaltbar. Gespendet wird über PayPal (QR-Code
   „Trinkgeldkasse“ mit den Initialen „RM“), BTC und optional Buy me a coffee. Gegen eine Spende gibt
   es keine Funktion und keinen Vorteil.
3. **Funktion.** AutarkTrade ist ein Trading-Journal mit Analyse für Krypto-Futures. Es liest Trades
   und Positionen über die API-Schlüssel des Nutzers (Bitunix, Bitget, Pionex) und zeigt Marktdaten aus
   vielen öffentlichen Quellen. KI-Funktionen laufen mit den Schlüsseln des Nutzers bei dessen Anbieter:
   Lageberichte, Chart-Analyse, Chat, Share-Bilder. **Orders sendet die Software nicht**, der scharfe
   Handel ist ausgebaut (`docs/SPAETER-SCHARFER-HANDEL.md`).
4. **Quellen ohne Freigabe.** Ein Teil der Marktdatenquellen erlaubt nach seinen eigenen Bedingungen
   keinen automatisierten oder keinen kommerziellen Zugriff. Diese Quellen laufen hinter dem Schalter
   `settings.quellenOhneFreigabe` mit **Vorgabe an** (`server/quellen/freigabe.js`, 21 IDs). Die
   Prüfung dazu, `docs/VERKAUFS-PRUEFUNG.md`, ist öffentlich und ging von einem **Verkauf** aus.
5. **Rechtstexte.** `LICENSE` enthält den unveränderten AGPL-Text. `HAFTUNGSAUSSCHLUSS.md` (Fassung 1.0)
   muss beim ersten Start und bei jeder neuen Fassung bestätigt werden (`server/rechtliches.js`, Dialog
   `src/components/rechtliches/Rechtliches.vue`). Hinzu kommen `NOTICE.md`, `THIRD-PARTY-NOTICES`,
   `HERKUNFT.md` und an jeder KI-Ausgabe das Label „KI-generiert – keine Anlageberatung – Fakten prüfen“.
6. **Vorgeschichte.** Das „Crypto Trading Journal“ begann am 15.02.2026 als Fork von TradeNote
   (Eleven-Trading, **GPL-3.0**, ✅ GitHub-API). AutarkTrade entstand ab 19.10.2026 daraus. Die
   übernommenen Teile wurden neu geschrieben. Die Spezifikationen dafür liegen ausserhalb des Repos mit
   SHA-256-Summen, die Restprüfung steht in `HERKUNFT.md`. Die Brückenfassung 3.15.0 des alten Repos
   stellt Git-Installationen auf das neue Repo um. Der Docker-Hub-Tag `mouses007/trading-journal:latest`
   spiegelt seither das AutarkTrade-Image.

---

## 2. Kurzfazit

| Bereich | Ampel | In einem Satz |
|---|---|---|
| Lizenz (AGPL, Drittlizenzen) | 🟡 | Der aktuelle Stand ist sauber. Die **öffentliche Git-Historie** enthält aber ein GPL-Derivat ohne GPL-Text und zeitweise unter proprietären Bedingungen (B-1). Dazu kommen widersprüchliche Lizenzangaben in Image und README (B-5). |
| Datenquellen / Nutzungsbedingungen | 🔴 | Die Vorgabe „an“ für Quellen, deren Bedingungen den automatisierten Zugriff auch **privat** verbieten, ist in einer öffentlich verteilten Software das grösste Einzelrisiko. Ihr Ziel ist weniger der Autor als Schuldner, eher das Repo als Angriffsfläche (B-2). |
| Haftung | 🟡 | Für unentgeltliche Software ist die Haftung gering (Art. 99 Abs. 2, 248 OR analog). Riskant sind zwei Punkte: die Brücke, die Daten ohne Sicherung umbaut und Git-Referenzen löscht (B-3), und ein Haftungsausschluss ohne Absender und ohne die zwingenden Ausnahmen (B-4). |
| Finanzmarktrecht (FIDLEG/FINIG, MiFID/MiCA/MAR) | 🟢 | Der Autor erbringt keine Finanzdienstleistung: keine persönliche Empfehlung, kein Kunde, keine Orders. Nur der Mail-Versand der Lageberichte an mehrere Empfänger braucht einen Hinweis (B-8). |
| Datenschutz (revDSG, DSGVO) | 🟡 | Der Autor ist für Nutzerdaten nicht verantwortlich. Es fehlt aber jeder Datenschutzhinweis zu den Datenflüssen an KI-Anbieter und an Benachrichtigungsdienste, ebenso zu den Spendendaten, die der Autor selbst erhält (B-6). |
| KI-Recht (EU AI Act) | 🟢 | Die Kennzeichnung nach Art. 50 ist umgesetzt, sichtbar und maschinenlesbar. Es bleibt nur Feinschliff (B-9). |
| CRA / Produkthaftung | 🟢 | Nicht-kommerzielle Open Source mit Spenden ohne Gewinnabsicht fällt nicht darunter. Der Hinweis in der App, die Software „erfülle den CRA noch nicht“, schadet eher, als er nützt (B-7). |
| Spenden / Steuern / Impressum | 🟢 | Unproblematisch, solange es keine Gegenleistung gibt. Empfehlenswert sind eine Kontaktadresse und eine einfache Aufstellung der Spenden (B-10). |
| Marke „AutarkTrade“ | 🟡 | Ungeprüft. Eine Recherche in den Klassen 9, 36 und 42 sollte vor jeder weiteren Werbung erfolgen (B-11). |

**Gesamtbild: gelb.** Kein Befund verlangt, die Software zurückzuziehen. Drei Befunde sollten vor
einer breiteren Bekanntmachung erledigt sein: B-1, B-2 und B-3.

---

## 3. Was sich gegenüber der Verkaufsprüfung ändert

`docs/VERKAUFS-PRUEFUNG.md` hat die Bedingungen der Anbieter für ein **verkauftes, lizenzpflichtiges
Produkt** geprüft. Seit dem 22.10.2026 gilt ein anderer Sachverhalt: kostenlose Open Source, die jeder
selbst betreibt. Drei Fragen bewerten sich dadurch neu.

**(a) Wer nutzt die Quelle?** Die Anfrage geht von der IP des Nutzers aus, unter seinem eigenen Schlüssel,
zu seinem eigenen, in aller Regel privaten Zweck. Klauseln, die nur die **kommerzielle** Nutzung oder
die **Weiterverbreitung** verbieten, treffen den privaten Selbstbetreiber deshalb meist nicht. Beispiele:
Binance AU „non-commercial personal use“, Bybit „shall not commercially exploit“, Bitget 3.2(m), Kraken,
KuCoin, Gate, CoinGecko-Demo, CoinPaprika Free, CryptoQuant CC BY-NC und OKX §9.4 „personal,
non-commercial trading“. Für diese Zeilen der Verkaufsprüfung gilt jetzt **grün für die private
Nutzung**. Wer die Software gewerblich einsetzt, etwa ein Trading-Desk oder ein Signaldienst, steht
wieder dort, wo die Verkaufsprüfung stand.

**(b) Was bleibt rot?** Unverändert rot bleiben die Quellen, deren Bedingungen schon den **automatisierten
Zugriff an sich** verbieten, gleich zu welchem Zweck:

| Quelle (ID in `freigabe.js`) | Klausel | Bleibt verboten, auch privat? |
|---|---|---|
| Yahoo Finance (`yahoo`) | ToS §2(d)(9): kein automatisierter Zugriff ohne Erlaubnis; §2(e): nur über die bereitgestellte Oberfläche ✅ | ja |
| CoinMarketCap-Webendpunkt (`coinmarketcap`) | §5.1.4, §6.1: kein Crawling, Scraping oder „screen scrape“ ✅ | ja |
| pump.fun (`pumpfun`) | §6.1, §21(h): Bots und Skripte nur auf freigegebenen Wegen ✅ | ja |
| Telegram t.me/s (`telegram`) | Content Licensing: kein Scraping, Indexieren oder Aggregieren für den Einsatz in KI 🟡 | ja |
| Binance `bapi` (`binanceBrackets`, `binanceAlpha`) | undokumentierte Web-Endpunkte; die ToU verbieten Crawler für nicht bereitgestellte Schnittstellen 🟡 | ja, sinngemäss |
| Upbit (`upbit`) | Open-API-Terms Art. 6 Abs. 3: auch die **Nutzung** fremder Programme verboten 🟡 | ja |
| ForexFactory (`forexfactory`) | Kopier- und Weitergabeverbot für den Kalender-Feed ⚪ | eher ja |
| blockchain.info (`blockchaininfo`) | API-Terms §§1.3–1.4: kein Scraping, kein Speichern über das Erlaubte hinaus 🟡 | ja |
| Reddit-RSS (`reddit`) | Data API Terms (Abschaltung des RSS ab 13.11.2026 angekündigt) ⚪ | unklar, erledigt sich |

**(c) Wer haftet für den Verstoss?** Vertragspartner des Anbieters ist der Nutzer, nicht der Autor
(F-1 der Verkaufsprüfung). Das wirkt sich je nach Recht unterschiedlich aus:

- **Schweiz:** Art. 41 und 50 OR setzen für den Autor eine eigene oder eine gemeinsam begangene
  *unerlaubte Handlung* voraus. Ein blosser Vertragsbruch des Nutzers ist keine. Die Haftung käme nur
  über Sittenwidrigkeit in Frage (Art. 41 Abs. 2 OR) oder über das UWG. Art. 5 lit. c UWG (Übernahme
  eines marktreifen Arbeitsergebnisses) und Art. 4 lit. a UWG (Verleitung zum Vertragsbruch) setzen
  aber ein Handeln im Wettbewerb voraus, das bei einer kostenlosen Privatsoftware fehlt ⚪.
- **Deutschland:** Der BGH hat Screen-Scraping trotz entgegenstehender AGB nicht als unlautere
  Behinderung gesehen, solange keine technische Schutzmassnahme umgangen wird (BGH, 30.04.2014,
  I ZR 224/12 „Flugvermittlung im Internet“ ⚪). Die Störerhaftung setzt die Verletzung eines absoluten
  Rechts oder einen Wettbewerbsverstoss voraus. AGB-Verstösse Dritter genügen nicht ⚪.
- **Datenbankrecht:** Das Sui-generis-Datenbankrecht der EU (RL 96/9/EG Art. 7) schützt die Entnahme
  *wesentlicher* Teile. Die Schweiz kennt dieses Recht nicht. Wo ein Schutz fehlt, bleiben die AGB des
  Anbieters zwischen Anbieter und Nutzer wirksam (EuGH C-30/14 Ryanair ⚪).
- **Die eigentliche Gefahr:** Sie liegt nicht im Schadenersatz, sondern in der **Angriffsfläche**. Dazu
  gehören Abmahnungen an den Autor, Meldungen an GitHub, Sperren der Endpunkte und der Vorwurf, eine
  Software sei *darauf ausgelegt*, Bedingungen zu verletzen. Das alles verstärkt sich, weil die eigene
  Prüfung das Wissen darum öffentlich dokumentiert. Der Fall youtube-dl zeigt, wie ein Werkzeug selbst
  zum Ziel wird (LG Hamburg, 31.03.2023, 310 O 316/21; OLG Hamburg, 21.11.2024, 5 U 54/23 ✅). Dort ging
  es allerdings um die Umgehung technischer Schutzmassnahmen (§ 95a UrhG). Das ist bei AutarkTrade
  nicht der Fall: Die Anfragen tragen einen ehrlichen User-Agent (`AutarkTrade/4 (Hype-Radar)`, kein
  Browser-Tarnkopf), und es wird keine Sperre umgangen. Das ist ein wichtiger Pluspunkt und sollte so
  bleiben.

Die Konsequenz zieht B-2.

---

## 4. Befunde

### Hoch

#### B-1 Öffentliche Git-Historie: GPL-Derivat ohne GPL-Text und unter proprietären Bedingungen

**Rechtsgrundlage.** GPL-3.0 §4 (Weitergabe nur mit Lizenztext und erhaltenen Hinweisen), §5, §8
(automatisches Erlöschen der Rechte bei Verstoss; Wiederherstellung, wenn der Verstoss behoben wird,
endgültig 30 Tage nach erstem Hinweis des Rechteinhabers), §10 (keine weiteren Beschränkungen); URG
Art. 2, 3, 10 ⚪.

**Befund.**
- Seit der Veröffentlichung am 22.10.2026 ist die gesamte Historie öffentlich, 144 Commits.
- Der erste Commit `6ab0e6d` („Ausgangsstand aus Crypto Trading Journal“, 19.10.2026) enthält den
  TradeNote-abgeleiteten Stand mit nach eigener Messung ≈ 6 000 nicht-generischen übernommenen Zeilen
  (`HERKUNFT.md`, Spalte „vorher“). Er hat **keine Lizenzdatei**: `git show 6ab0e6d:LICENSE` ist leer,
  im Baum liegt nur `LIZENZ-PLAN.md`.
- Ab `283aa1e` steht in `LICENSE` „AutarkTrade Lizenzbedingungen, Fassung 0.1“, also proprietäre
  Bedingungen mit Zustimmungspflicht und Lizenzschlüssel. Die übernommenen Zeilen wurden erst in S11
  und F3 auf null gebracht.
- Wer das Repo klont, erhält damit GPL-pflichtigen Code teils ohne Lizenz, teils mit Bedingungen, die
  die GPL nach §10 nicht zulässt.
- Hinzu kommt: Die Commit-Nachrichten und `LIZENZ-PLAN.md` dokumentieren den Plan, den GPL-Code für
  einen Verkauf zu ersetzen. Das ist legitim. Zusammen mit der Historie ist es aber genau das Material,
  mit dem ein TradeNote-Beteiligter einen Verstoss begründen würde.

**Risiko.** Mittel bis hoch, dafür leicht zu beheben.
- Nach GPL §8 erlöschen bei einem Verstoss die Rechte an den TradeNote-Teilen. Das schliesst die
  heutigen Rest-Ähnlichkeiten ein, sollte ein Gericht sie anders als `HERKUNFT.md` werten.
- Wird der Verstoss behoben, lebt die Lizenz wieder auf. Dauerhaft gilt das, wenn innerhalb von
  30 Tagen nach dem ersten Hinweis behoben wird.
- Ein Schaden aus einer kostenlosen Weitergabe ist gering. Unterlassung und Reputation wiegen schwerer.
- Mit der Wahl der AGPL ist das Grundproblem entschärft: GPL-3.0-Code darf nach GPL §13 und AGPL §13 mit
  AGPL-Code zu einem Werk verbunden werden. Der „Clean-Room“ war für einen Verkauf zwingend, für die
  AGPL ist er nur noch Hygiene.

**Empfehlung.**
1. **Sofort** eine Klarstellung in `NOTICE.md` und `HERKUNFT.md` (Text unten) und eine Datei
   `LICENSES/GPL-3.0.txt` aufnehmen. Das ist die Behebung im Sinne von GPL §8.
2. Die TradeNote-Urheber nennen, als Vorsicht, auch wenn nach `HERKUNFT.md` kein Ausdruck mehr übrig ist.
   Das kostet nichts und nimmt dem Vorwurf die Spitze.
3. Die Historie umzuschreiben, also bis `c6f8ccc` zu einem Commit zusammenzufassen und per Force-Push,
   ist möglich. Es ersetzt die Klarstellung aber nicht, weil Klone existieren, und es zerstört die
   Belegkette für `HERKUNFT.md`. **Nicht empfohlen.**

**Textvorschlag (NOTICE.md, neuer Abschnitt unter „Herkunft“):**

> **Ältere Commits.** Die Commits dieses Repositorys vor `c6f8ccc` (22. Oktober 2026), beginnend mit
> `6ab0e6d`, enthalten Code, der von TradeNote (Copyright © Eleven-Trading und Mitwirkende,
> https://github.com/Eleven-Trading/TradeNote) abgeleitet ist und unter der GNU General Public License,
> Version 3, steht (Text: `LICENSES/GPL-3.0.txt`). Für diese Teile gilt in jedem Commit ausschliesslich
> die GPL-3.0. Lizenzbedingungen, Zustimmungspflichten oder Lizenzschlüssel, die in einzelnen Commits
> stehen („AutarkTrade Lizenzbedingungen“ Fassung 0.1–0.3), gelten für diese Teile nicht und sind
> insgesamt aufgehoben. Die eigenen Beiträge von Mouses007 in diesen Commits stehen zusätzlich unter der
> AGPL-3.0-or-later. Wie und bis wann die übernommenen Teile ersetzt wurden: `HERKUNFT.md`.

#### B-2 Schalter `quellenOhneFreigabe`: Vorgabe „an“ in öffentlich verteilter Software

**Rechtsgrundlage.**
- Die Nutzungsbedingungen der Anbieter (Abschnitt 3 (b)).
- Schweiz: Art. 41, 50 OR; UWG Art. 3 Abs. 1 lit. b (irreführende Angaben).
- Deutschland: BGH I ZR 224/12; Störerhaftung.
- EU: RL 96/9/EG Art. 7.

**Befund.**
- `VORGABE = true` in `server/quellen/freigabe.js:30`. Ist die Spalte leer, null oder unlesbar, gilt
  ebenfalls „an“ (`normSchalter`). Neue Installationen rufen also ab dem ersten Start Yahoo, den
  CoinMarketCap-Webendpunkt, pump.fun, Telegram t.me/s, Binance-bapi, Upbit, MEXC und OKX ab.
- **Die App widerspricht sich selbst.** Der Hinweis zur Wal-Kachel und zum Onboarding sagt wörtlich,
  „Telegram verbietet das Auslesen öffentlicher Kanäle“ (`marktradar.wal.info`,
  `onboarding.news.telegramEntfernt`), und schaltet es trotzdem ab Werk ein.
- **Die Bezeichnung führt in die Irre.** „Quellen ohne **Verkaufs**freigabe“ und „Für den Eigengebrauch
  an“ (`datenquellen.of.unter`) legen nahe, das Problem bestehe nur beim Verkauf. Für die Zeilen in
  Abschnitt 3 (b) ist das falsch, dort ist schon der private automatisierte Abruf untersagt.
- Der Text „ob deine Nutzung gedeckt ist, prüfst und verantwortest du selbst“ ist richtig. Er steht
  aber nur in den Einstellungen, die ein neuer Nutzer nicht sieht, bevor die ersten Abrufe laufen.
- Die eigene Prüfung (`docs/VERKAUFS-PRUEFUNG.md`) liegt öffentlich daneben und dokumentiert das Wissen
  um jede Klausel.

**Risiko.**
- Gering als Schadenersatzrisiko für den Autor (Abschnitt 3 (c)).
- Mittel bis hoch als Plattform- und Reputationsrisiko. Möglich sind Abmahnung, eine Meldung an GitHub
  wegen Verstosses gegen Drittbedingungen und Sperren der Endpunkte, die dann alle Nutzer treffen.
- Für die Nutzer: Kontosperren bei Anbietern, bei denen sie ein Konto haben (Telegram, Reddit).
- Hinzu kommt die Irreführung über die Rechtslage, ein UWG-Risiko geringen Grades.
- Mit einem Satz: Eine Voreinstellung ist die Entscheidung des Autors, nicht die des Nutzers. Mit
  „Vorgabe an“ entscheidet der Autor für jeden neuen Nutzer, dass dieser gegen Bedingungen verstösst,
  die der Autor kennt.

**Empfehlung.** Zwei vertretbare Wege. Variante A ist die empfohlene.

- **Variante A (empfohlen): Vorgabe aus, Bestand bleibt.**
  - Für **neue** Installationen `VORGABE = false`.
  - Bestehende Installationen behalten ihren gespeicherten Wert. Die Migration S15 setzt die Spalte
    bereits; dort nur sicherstellen, dass ein fehlender Wert bei Altbestand weiter „an“ bedeutet und bei
    Neuinstallation „aus“.
  - Im Setup-Assistenten ein eigener Schritt mit der Liste und dem Text unten. Einschalten nur mit einem
    Haken.
  - So bleibt das Verhalten für den Eigentümer „wie bisher“, und jeder neue Nutzer entscheidet selbst.
- **Variante B: Vorgabe an bleibt, dafür ehrlich und früh.**
  - Pflichtschritt beim ersten Start, vor dem ersten Abruf.
  - Die Liste der Quellen mit **je einer Zeile**, was deren Bedingungen sagen.
  - Ein Knopf „Alle aus“.
  - Telegram, pump.fun, Yahoo und CoinMarketCap sollten auch in dieser Variante einzeln abwählbar sein.
- **In beiden Varianten:**
  1. Schalter und Texte umbenennen in **„Quellen mit eingeschränkten Nutzungsbedingungen“** und „Für
     den Eigengebrauch an“ streichen.
  2. Die Quellen trennen, deren Verbot nur den **kommerziellen** Gebrauch betrifft: `coingeckoOeffentlich`,
     `geckoterminal`, `coinpaprika`, `gelbeBoersen`, `okx`, `rugcheck`, `solanaRpcOeffentlich`,
     `tokenbilder`, `newsVorschlaege`. Diese könnten für Privatnutzer ab Werk an bleiben. Die harten
     Fälle aus Abschnitt 3 (b) gehören in eine eigene Gruppe.
  3. Den ehrlichen User-Agent beibehalten und **nie** Browser-Kennungen, Cookies oder Proxies einbauen,
     um Sperren zu umgehen. Das ist die Grenze, ab der die youtube-dl-Rechtsprechung greift.
  4. `docs/VERKAUFS-PRUEFUNG.md` oben mit einem Absatz versehen, dass sie für einen geplanten Verkauf
     galt (Textvorschlag unten).
  5. In README und App deutlich sagen: Wer AutarkTrade **gewerblich** oder als Dienst für andere
     betreibt, braucht für fast alle Marktdatenquellen eine eigene Erlaubnis.

**Textvorschlag (Einstellung bzw. Setup-Schritt, Variante A):**

> **Quellen mit eingeschränkten Nutzungsbedingungen**
> Einige Analysequellen erlauben den automatischen Abruf durch Programme nach ihren eigenen
> Bedingungen nicht oder nur für bestimmte Zwecke: Yahoo Finance, die Website-Schnittstelle von
> CoinMarketCap, pump.fun, öffentliche Telegram-Kanäle, interne Binance-Schnittstellen, Upbit,
> ForexFactory, blockchain.info und Reddit. Andere erlauben ihn nur für private, nicht-kommerzielle
> Zwecke. Diese Quellen sind ab Werk aus. Wenn du sie einschaltest, fragt dein Rechner sie direkt ab;
> ob deine Nutzung von ihren Bedingungen gedeckt ist, entscheidest und verantwortest du selbst. Die
> Liste mit den einzelnen Klauseln steht unter Einstellungen › Datenquellen. AutarkTrade umgeht keine
> Sperren dieser Anbieter.
>
> ☐ Ich habe das gelesen und will diese Quellen trotzdem nutzen.

**Textvorschlag (Kopf von `docs/VERKAUFS-PRUEFUNG.md`):**

> Diese Prüfung entstand im Oktober 2026 für einen damals geplanten Verkauf von AutarkTrade. Seit dem
> 22. Oktober 2026 ist AutarkTrade kostenlose Open Source, die jeder selbst betreibt. Die Ampel
> beschreibt die Bedingungen der Anbieter für eine **kommerzielle** Nutzung. Für die private Nutzung
> siehe `docs/RECHTSAUDIT-2026-10.md`, Abschnitt 3.

#### B-3 Brücke 3.15.0 und Docker-Hub-Tag: Umbau fremder Installationen ohne Sicherung, Löschen von Git-Referenzen

**Rechtsgrundlage.** Art. 41 OR und Art. 99 Abs. 2 / 248 OR analog: Haftung auch bei Unentgeltlichkeit
für grobe Fahrlässigkeit. Art. 100 Abs. 1 OR: Eine Freizeichnung für grobe Fahrlässigkeit ist
nichtig. § 823 Abs. 1 BGB: Integrität gespeicherter Daten als „sonstiges Recht“ bzw. Eigentum am
Datenträger ⚪. AGPL/GPL §§15–16 helfen nur „soweit gesetzlich zulässig“.

**Befund.**
- **Docker.** `mouses007/trading-journal:latest` spiegelt seit 22.10.2026 `ghcr.io/mouses007/autarktrade:latest`
  (Workflow im alten Repo).
  - Die frühere `docker-compose.yml` des alten Repos empfiehlt ausdrücklich Watchtower mit
    `WATCHTOWER_CLEANUP=true` (Zeilen 69–78).
  - Wer das so eingerichtet hat, bekommt ohne eigenes Zutun eine **andere Software** mit anderer
    Lizenz, einer Zustimmungspflicht und Migrationen der Datenbank (v26 ff.).
  - Vor den Migrationen legt AutarkTrade **keine Sicherung** an. In `server/database.js`,
    `server/migrationen/*` und `docker-entrypoint.sh` gibt es kein Backup vor dem Umbau.
- **Git.** Das Update in AutarkTrade (`server/update-api.js:552 ff.`) macht `git reset --hard FETCH_HEAD`
  und danach `macheFlach` (`server/update-flach.js:41`). Dabei werden **alle Git-Referenzen gelöscht**
  ausser dem aktuellen Zweig und einem Rollback-Ref, also auch eigene Branches und Tags des Nutzers.
  Anschliessend laufen `reflog expire --expire=now --all` und `gc --prune=now`.
  - Lokale Änderungen und eigene Zweige eines Nutzers sind danach **unwiderruflich** weg.
  - Für die meisten Nutzer ist das harmlos. Für die, die das alte GPL-Journal angepasst haben, und
    genau das lädt Open Source ein, ist es ein Datenverlust.
  - Hingewiesen wird nur im README des alten Repos („Make a backup first“), nicht im Update-Dialog
    selbst.

**Risiko.** Mittel bis hoch.
- Die Ansprüche sind klein, das Mass der Sorgfaltspflicht ist bei Unentgeltlichkeit milde.
- Gerade ein bewusst eingebautes, unwiderrufliches Löschen fremder Daten **ohne Warnung im Dialog**
  liegt aber nahe an der groben Fahrlässigkeit. Für sie greift weder der Haftungsausschluss noch AGPL
  §16 (Art. 100 Abs. 1 OR, § 309 Nr. 7 lit. b BGB ⚪).
- Dazu kommt: Wer per Watchtower auf AutarkTrade wechselt, hat dem neuen Haftungsausschluss noch nicht
  zugestimmt, wenn die Migration läuft. Der Dialog erscheint erst beim ersten Öffnen der Seite, und es
  gibt bewusst keine Sperre auf dem Server (`server/rechtliches.js`, Kopfkommentar).

**Empfehlung.**
1. **Sofort:**
   - Vor jeder Schema-Migration eine automatische Sicherung anlegen: SQLite als Dateikopie, PostgreSQL
     als JSON-Export über die vorhandene `backup-api.js`, mit Aufbewahrung der letzten drei.
   - Im Update-Dialog vor dem Klick sagen: „Eigene Änderungen und Zweige im Installationsordner gehen
     verloren.“
2. **Bald:** `macheFlach` nur noch Referenzen löschen lassen, die die Software selbst angelegt hat
   (`refs/remotes/origin/*`, alte Tags des Upstreams). Fremde lokale Zweige bleiben unangetastet.
   Alternativ vor dem Löschen ein Bündel ablegen: `git bundle create data/vor-update-<datum>.bundle --all`.
3. **Docker:** Das alte Tag `mouses007/trading-journal:latest` auf einer letzten 3.x-Fassung **einfrieren**
   und die Umstellung über ein neues Tag oder einen Hinweis im Image führen, statt den bisherigen Tag
   umzubiegen.
   - Ist das nicht mehr gewollt, mindestens in der Kurzbeschreibung und im README von Docker Hub
     gross darauf hinweisen. Das ist im Workflow bereits teilweise angelegt (`short-description`).
   - Und: Der erste Start eines umgestellten Containers soll **vor** der ersten Migration eine Sicherung
     schreiben (Punkt 1).

**Textvorschlag (Update-Dialog):**

> Das Update ersetzt alle Programmdateien im Installationsordner durch die neue Fassung. Eigene
> Änderungen am Programm und eigene Git-Zweige in diesem Ordner gehen dabei verloren. Deine Daten
> (Datenbank, Bilder, Einstellungen) bleiben erhalten; vor der Umstellung der Datenbank legt AutarkTrade
> automatisch eine Sicherung unter `data/sicherungen/` an.

### Mittel

#### B-4 Haftungsausschluss: kein Absender, keine zwingenden Ausnahmen, nur deutsch

**Rechtsgrundlage.** Art. 100 Abs. 1 OR; Art. 8 UWG (gegenüber Konsumenten); Ungewöhnlichkeits- und
Unklarheitenregel ⚪. Deutschland: §§ 305 ff., § 307 Abs. 1 S. 2 (Transparenz), § 309 Nr. 7 BGB;
§§ 521, 524 BGB analog bei Unentgeltlichkeit ⚪. AGPL §§15–17.

**Befund** (`HAFTUNGSAUSSCHLUSS.md`, Fassung 1.0):
1. **„Wir“ ist niemand.** Der Text sagt durchgehend „wir haften nicht“, nennt aber weder den Autor noch
   eine Kontaktmöglichkeit. Für Auslegung und Unklarheitenregel ist ein unbenannter Erklärender ein
   unnötiger Angriffspunkt.
2. **Pauschale Freizeichnung mit „soweit das Gesetz es zulässt“.**
   - In der Schweiz rettet das die Klausel praktisch: Sie wird auf das Zulässige zurückgeführt.
   - In Deutschland gilt eine solche salvatorische Einschränkung in AGB als intransparent (§ 307 Abs. 1
     S. 2 BGB) ⚪. Es fehlen die ausdrücklichen Ausnahmen für Vorsatz, grobe Fahrlässigkeit, Leben,
     Körper und Gesundheit (§ 309 Nr. 7 BGB).
   - Folge in Deutschland: Die Klausel fällt ganz weg, es gelten §§ 521, 524 BGB analog. Das Ergebnis
     ist ähnlich, aber nicht durch den eigenen Text.
3. **Nur deutsch.** Die Oberfläche ist zweisprachig, der englische Zustimmungstext
   (`en.json` `rechtliches.zustimmung`) verweist auf ein Dokument, das es nur auf Deutsch gibt. Eine
   Zustimmung zu einem Text, den man nicht lesen kann, trägt wenig.
4. **Ziffer 9 „Beta“** verträgt sich mit Fassung 4.0.0 und einem Release schlecht. Siehe auch B-7.
5. **Kein anwendbares Recht.**
   - Für eine kostenlose, weltweit verteilte Software ist eine Rechtswahl nicht nötig. Gegenüber
     Konsumenten ist sie ohnehin begrenzt (Art. 120 IPRG, Art. 6 Rom I ⚪).
   - Eine Gerichtsstandsklausel gegenüber Konsumenten ist meist unwirksam.
   - **Empfehlung: weglassen**, nicht ergänzen.

**Positiv:**
- Die Zustimmung wird mit Fassung, Zeit und SHA-256 der Texte gespeichert (`server/rechtliches.js`,
  `akzeptieren`). Das ist ein guter Nachweis.
- Die Ziffern 1–8 sind inhaltlich treffend und verständlich.

**Textvorschlag (ersetzt Kopf, „Kurz gesagt“ und eine neue Ziffer 11):**

> # Haftungsausschluss
>
> Fassung 1.1 vom … 2026
>
> AutarkTrade wird von Mouses007 (https://github.com/Mouses007, Kontakt: <E-Mail>) als freie Software
> unter der GNU Affero General Public License 3.0 kostenlos bereitgestellt (Datei `LICENSE`), ohne jede
> Gewährleistung im Rahmen der Ziffern 15 und 16 dieser Lizenz. Dieser Text erklärt, was das für ein
> Werkzeug rund um Trading bedeutet. „Wir“ meint im Folgenden den Autor und alle, die zu AutarkTrade
> beigetragen haben.
>
> …
>
> ## 11. Grenzen dieses Ausschlusses
>
> Nichts in diesem Text beschränkt die Haftung für Vorsatz oder grobe Fahrlässigkeit, für Schäden an
> Leben, Körper oder Gesundheit oder nach zwingenden Produkthaftungsvorschriften. Rechte, die dir als
> Konsumentin oder Konsument zwingend zustehen, bleiben unberührt. Ist eine Bestimmung unwirksam,
> bleiben die übrigen gültig.

Englische Fassung `DISCLAIMER.md` (oder `HAFTUNGSAUSSCHLUSS.en.md`) mit demselben Inhalt anlegen. Im
Dialog die Sprache der Oberfläche zeigen, mit dem Satz „Massgebend ist die deutsche Fassung“. Die
Fassungsnummer gilt für beide gemeinsam.

#### B-5 Widersprüchliche Lizenzangaben im Image, im README und in den Kommentaren

**Rechtsgrundlage.** AGPL §5 lit. b (Kennzeichnung der Lizenz), §7 letzter Absatz (weitere
Beschränkungen dürfen entfernt werden); UWG Art. 3 Abs. 1 lit. b (irreführende Angaben über eigene
Leistungen) ⚪.

**Befund.**
- `Dockerfile:26`: `org.opencontainers.image.licenses="LicenseRef-AutarkTrade-proprietary"`. Registries
  und SBOM-Werkzeuge zeigen das als Lizenz des Images an.
- `README.md:7`: „redesign, **own licence**“.
- `NOTICE.md` verweist auf „Ziffer 12 der Lizenzbedingungen“ und „Ziffer 13 der Lizenzbedingungen“,
  also auf die Nummerierung der aufgehobenen proprietären Fassung.
- `server/rechtliches.js`: Kommentare zu „Ziffer 15 der Bedingungen“ und „Ziffer 4 der Bedingungen“
  (Beta, CRA); die Docstring nennt „jeder neuen Fassung von LICENSE“.
- `src/components/rechtliches/Rechtliches.vue:6`: Kommentar „neue Fassung von LICENSE“.
- `docs/VERKAUFS-PRUEFUNG.md`, Anhang 2: „Repo … ist privat“, OCI-Label proprietär.
- `.github/SECURITY.md`: „The in-app updater keeps you on it.“ `.github/CONTRIBUTING.md`: „live-trading
  layers“. Beides beschreibt einen alten Stand.

**Risiko.** Gering bis mittel. Kein Verstoss an sich. Aber wer ein Image mit dem Label „proprietary“
ausliefert, lädt zu Missverständnissen über die Lizenz ein. Im Streit über B-1 wäre das ein unschönes
Indiz.

**Empfehlung.** Label auf `AGPL-3.0-or-later` setzen und die übrigen Stellen bereinigen. Dazu ein
Selbsttest in `server/__selftest-rechtliches.mjs`, der `proprietary` und „Lizenzbedingungen“ in
Dockerfile, README und NOTICE anschlägt. **Sofort**, Aufwand Minuten.

#### B-6 Datenschutz: kein Hinweis zu den Datenflüssen, keine Angaben zu Spendendaten

**Rechtsgrundlage.**
- revDSG Art. 2 Abs. 2 lit. a (persönlicher Gebrauch), Art. 5 lit. j (Verantwortlicher), Art. 16
  (Bekanntgabe ins Ausland), Art. 19 (Informationspflicht) ⚪.
- DSGVO Art. 2 Abs. 2 lit. c (Haushaltsausnahme), Art. 3 Abs. 2, Art. 26 ⚪.
- EuGH C-25/17 und C-683/21 (gemeinsame Verantwortlichkeit) 🟡.

**Rollen.**
- **Der Autor ist für die Daten der Nutzer nicht verantwortlich.** Er erhält keine Daten, steuert keinen
  Betrieb und verfolgt keine eigenen Zwecke mit den Daten. Daran ändert auch C-683/21 nichts: Dort hatte
  der Auftraggeber die App für seine eigenen Zwecke betreiben lassen.
- Der **Nutzer** ist Verantwortlicher. Für sein eigenes Journal greift meist die Haushaltsausnahme.
  Nicht mehr, sobald er die Lageberichte an andere Personen mailt (`radarNewsVersand`, mehrere
  Empfänger) oder die Software für eine Gruppe betreibt.
- **Für die Spenden ist der Autor selbst Verantwortlicher.** PayPal übermittelt ihm Name und E-Mail der
  Spender, Buy me a coffee ebenso. Der Datenschutzhinweis dazu fehlt (Art. 19 revDSG).

**Befund.** Es gibt keinen Datenschutzhinweis, weder im Repo noch in der App. Der Dialog „Rechtliches“
hat keinen Reiter dafür. Was ein Nutzer wissen sollte, steht nur verstreut im Code. Was die Software an
Dritte schickt:

| Fluss | Was | Wohin |
|---|---|---|
| KI-Agent, Chat, Auswertungen | Trades, Notizen, Tagebuch inkl. Stress- und Emotionswerten, Playbooks, **Screenshots** (`ai-agent-tools.js`: `query_screenshots`, `analyze_screenshot`, `notes`) | gewählter KI-Anbieter, oft USA; „Endpunkt 2“ ggf. China, Singapur |
| Share-Card | Trade-Daten im Prompt, Bild | Black Forest Labs, **mit Trainingslizenz** (Hinweis vorhanden) |
| Benachrichtigungen | Alarmtexte, Symbole, Kurse | ntfy-Server (öffentlich: ntfy.sh protokolliert Thema und IP), Telegram, Webhook, SMTP |
| Lagebericht-Mail | Bericht | Empfängerliste des Nutzers (Bcc) |
| Marktdaten, Update-Prüfung | IP-Adresse | Börsen, Datenquellen, GitHub |
| ESP32 / Android-Widget | Kontostand, P&L | eigenes Gerät im LAN (nur mit eigenem Schlüssel) |

**Risiko.** Für den Autor gering. Für die Nutzer ist es eine Transparenzlücke: Wer das Tagebuch mit
Gefühlslage und Screenshots an einen US-Anbieter gibt, sollte es wissen. Mit dem Spendenteil gibt es
einen kleinen, aber echten eigenen Pflichtenbereich des Autors.

**Empfehlung.**
1. **Bald:** Datei `DATENSCHUTZ.md` als fünfter Reiter im Dialog „Rechtliches“, kurz und tabellarisch
   (Textvorschlag unten).
2. Im KI-Bereich der Einstellungen einen einzeiligen Hinweis: „Was du der KI zeigst (Trades, Notizen,
   Tagebuch, Bilder), geht an deinen Anbieter.“ Dazu wäre ein Schalter „Tagebuch und Bilder nicht an
   die KI“ ein guter Datenschutz durch Technik (Art. 7 revDSG trifft den Nutzer, nicht den Autor; als
   Angebot aber wertvoll).
3. Beim Mail-Versand an mehrere Empfänger ein Hinweis zu den Pflichten des Versenders (B-8).

**Textvorschlag (`DATENSCHUTZ.md`):**

> # Datenschutz
>
> Fassung 1.0 vom … 2026
>
> **AutarkTrade läuft bei dir.** Deine Trades, Notizen, Bilder und Schlüssel liegen in deiner eigenen
> Datenbank. Der Autor von AutarkTrade erhält davon nichts: Es gibt kein Konto, keine Telemetrie und
> keinen Server des Autors, über den deine Daten laufen.
>
> **Was AutarkTrade an Dritte schickt, und nur wenn du es einrichtest:**
> - **KI-Anbieter** (Anthropic, OpenAI, Google, Mistral, eigener Endpunkt u. a.): die Daten, die die
>   jeweilige Funktion braucht, je nach Funktion auch Trades, Notizen, Tagebuch und Bilder. Es gelten
>   die Bedingungen und der Datenschutz deines Anbieters; der Sitz kann ausserhalb der Schweiz und der
>   EU liegen.
> - **Börsen und Datenquellen**: deine IP-Adresse bei jedem Abruf, bei Börsen-Schlüsseln die
>   Anfragen deines Kontos.
> - **Benachrichtigungen** (ntfy, Telegram, Webhook, Mail): der Text der Meldung an den Dienst, den du
>   einträgst.
> - **Update-Prüfung**: deine IP-Adresse an GitHub.
>
> Wenn du AutarkTrade für andere betreibst oder Berichte an andere verschickst, bist du für deren Daten
> verantwortlich.
>
> **Spenden.** Wenn du über PayPal oder Buy me a coffee spendest, erhält der Autor die Angaben, die der
> Dienst übermittelt (in der Regel Name, E-Mail, Betrag). Er nutzt sie nur, um die Spende zu verbuchen,
> und bewahrt sie so lange auf, wie es das Steuerrecht verlangt. Eine Bitcoin-Spende ist öffentlich in
> der Blockchain sichtbar. Fragen und Auskunft: <E-Mail>.

#### B-7 CRA- und Beta-Aussage in der App

**Rechtsgrundlage.**
- CRA (VO 2024/2847): Art. 2, Art. 3 Nr. 14, Art. 4 Abs. 3, Art. 24, ErwGr. 15 und 17–20 ✅/🟡.
- Produkthaftungsrichtlinie (EU) 2024/2853: Art. 2 Abs. 2, ErwGr. 14–15 🟡.

**Rechtslage.**
- Der CRA gilt nur für Produkte, die **im Rahmen einer Geschäftstätigkeit** auf dem Markt bereitgestellt
  werden.
- Nach ErwGr. 15 sind Spenden **ohne Gewinnabsicht** keine Geschäftstätigkeit. Ein Indiz für eine
  Geschäftstätigkeit sind erst Spenden, die die Kosten von Konzeption, Entwicklung und Bereitstellung
  übersteigen ✅.
- Eine Privatperson ist auch kein „Open-Source-Steward“ (Art. 3 Nr. 14 setzt eine juristische Person
  voraus ⚪).
- AutarkTrade fällt damit heute **nicht** unter den CRA. Das gilt auch für die seit 11.09.2026 geltenden
  Meldepflichten 🟡.
- Dasselbe gilt für die neue Produkthaftungsrichtlinie. Sie schliesst freie Software ausserhalb einer
  Geschäftstätigkeit aus (Art. 2 Abs. 2). Ein Entgelt oder die Bezahlung mit Daten würde das ändern,
  Spenden nennt sie nicht ausdrücklich 🟡. Die Umsetzung in den Mitgliedstaaten ist bis 09.12.2026
  fällig.
- Für die Schweiz gilt das PrHG. Es erfasst nach überwiegender Lehre reine Download-Software kaum und
  reine Vermögensschäden wie Trading-Verluste nie ⚪.

**Befund.** `rechtliches.betaText` sagt: „Sie erfüllt die Anforderungen der EU-Verordnung 2024/2847
(Cyber Resilience Act) noch nicht.“ Der Kommentar in `server/rechtliches.js` beruft sich auf Art. 4
Abs. 3 CRA. Diese Vorschrift erlaubt *Herstellern* im Anwendungsbereich, unfertige Software befristet
zum Testen bereitzustellen. Mit der Aussage stellt sich das Projekt selbst in den Anwendungsbereich
des CRA und erklärt zugleich, ihn nicht zu erfüllen. Für eine nicht-kommerzielle Open-Source-Software
ist das ein unnötiges Eingeständnis.

**Empfehlung.** **Sofort** den CRA-Satz streichen. Den Beta-Hinweis an den Release anpassen: Entweder
4.0.0 ist kein Beta mehr, oder er heisst „4.0.0 (Beta)“ wie im README. Vorschlag:

> **Junge Software.** AutarkTrade wird von einer Einzelperson in der Freizeit entwickelt und ist noch
> jung. Rechne mit Fehlern, sichere deine Daten regelmässig und prüfe Zahlen bei deiner Börse.
> AutarkTrade liest über deine Börsen-Schlüssel nur Trades und Positionen und gibt keine Orders auf.

Um die Einstufung „nicht kommerziell“ zu halten, sind vier Punkte wichtig:
1. **keine** Gegenleistung für Spenden (keine Funktionen, keine Priorität bei Fehlern, kein
   „Supporter-Build“);
2. **kein** bezahlter Support oder Dienst rund um AutarkTrade;
3. Spenden und Kosten (KI-Guthaben für Tests, Hardware, Domain) einmal im Jahr formlos gegenüberstellen;
4. keine Sammlung personenbezogener Daten der Nutzer.

Ändert sich einer dieser Punkte, wird der CRA ab 11.12.2027 voll anwendbar. Ein späterer Verkauf
(`docs/SPAETER-SCHARFER-HANDEL.md`, Lizenzschlüssel-Pläne) würde das ebenfalls auslösen.

#### B-8 Finanzmarktrecht: kein Bewilligungsthema, ausser beim Verteilen von Berichten

**Rechtsgrundlage.**
- Schweiz: FIDLEG Art. 3 lit. a Ziff. 4 (Derivate), lit. c Ziff. 4 (Anlageberatung = *persönliche*
  Empfehlung), lit. d (Finanzdienstleister = *gewerbsmässig*); FINIG Art. 2, 17 ⚪.
- EU: MiFID II Art. 4 Abs. 1 Nr. 4 i. V. m. Art. 9 DelVO 2017/565 (Empfehlungen an die Öffentlichkeit
  sind keine persönlichen); MiCA Art. 2 Abs. 4 lit. a, Art. 3 Abs. 1 Nr. 24; MAR Art. 3 Abs. 1 Nr. 34/35,
  Art. 20 mit DelVO 2016/958 ⚪.

**Einordnung.**
- **Krypto-Perpetuals sind Derivate.** Es gilt also MiFID bzw. FIDLEG, nicht MiCA.
- **Keine Anlageberatung.** Der Autor gibt keinem Kunden eine persönliche Empfehlung. Die Software
  erzeugt Auswertungen beim Nutzer, mit dessen Daten und dessen KI-Schlüssel. Es fehlt am Kunden, an der
  Persönlichkeit der Empfehlung und an der Gewerbsmässigkeit.
- **Robo-Advice.** Die FINMA-Praxis dazu (Registereintrag eines „Substituten“) setzt einen
  gewerbsmässigen Anbieter voraus 🟡.
- **Vermögensverwaltung (FINIG).** Mit dem Ausbau des scharfen Handels ist das Thema erledigt.
- **Vorhandene Sicherungen.** Die Sicherungen im Code stützen diese Einordnung:
  - Prognose-Sperre `pruefeEinordnung`;
  - Verbot von Einstiegen und Kurszielen;
  - KI-Label an jeder Ausgabe;
  - „Bedingungen statt Empfehlungen“ in der Handelslage.

**Befund.**
- Der **Mail-Versand der Lageberichte an mehrere Empfänger** macht aus einem privaten Bericht einen
  verbreiteten. Enthält er Aussagen zu Kursentwicklungen, kann das beim *Versender* unter MAR Art. 20
  (Anlageempfehlung für die Öffentlichkeit oder Vertriebskanäle) fallen. Dazu kommen Pflichten zur
  objektiven Darstellung und zur Offenlegung eigener Positionen.
- Den Autor trifft das nicht. Ein Hinweis ist aber billig.
- Zweitens: Eine Wiederaufnahme des scharfen Handels mit automatischer Ausführung wäre neu zu prüfen
  (F-7 der Verkaufsprüfung). Das gilt erst recht bei einer Kopier- oder Signalfunktion.

**Empfehlung.**
1. **Bald:** Hinweis am Mail-Versand: „Wenn du Berichte an andere schickst, bist du der Absender. Je
   nach Land gelten für die Verbreitung von Markteinschätzungen Regeln (z. B. EU-Marktmissbrauchsrecht).
   Der Bericht enthält das KI-Label; entferne es nicht.“
2. In README und Website nie mit Trefferquoten, „Signalen, die funktionieren“ oder Renditen werben
   (Art. 3 Abs. 1 lit. b UWG). Der heutige README-Text ist in dieser Hinsicht sauber.

#### B-9 EU AI Act: umgesetzt, Feinschliff

**Rechtsgrundlage.** VO 2024/1689: Art. 2 Abs. 10 und 12, Art. 3 Nr. 3, 4, 9–11, Art. 50; geändert
durch VO (EU) 2026/1744 („Digital Omnibus“, ABl. 24.07.2026 🟡). Danach gilt Art. 50 Abs. 2 für
Systeme, die vor dem 02.08.2026 in Verkehr gebracht wurden, erst ab 02.12.2026 🟡.

**Einordnung.**
- Die Open-Source-Ausnahme (Art. 2 Abs. 12) gilt **nicht** für Art. 50.
- Ob der Autor überhaupt „Anbieter“ ist, der ein System „in Verkehr bringt“, hängt am Begriff der
  Bereitstellung „im Rahmen einer Geschäftstätigkeit“ (Art. 3 Nr. 10). Ohne Geschäftstätigkeit ist
  das gut vertretbar zu verneinen.
- Der Nutzer ist als Privatperson nach Art. 2 Abs. 10 von den Betreiberpflichten frei.
- Die Kennzeichnung schadet trotzdem nicht. Sie ist bereits sehr gut umgesetzt:
  - sichtbares Label;
  - `data-ki-generiert` und `kiGeneriert` in der API;
  - Mail-Kopf `X-AI-Generated: true`;
  - PNG-Metadaten (IPTC `compositeWithTrainedAlgorithmicMedia`).

**Befund (Feinschliff).**
1. Das C2PA-Manifest des Bildanbieters geht beim Zusammensetzen im Browser verloren. Das ist im Code
   dokumentiert und vertretbar, weil die eigene IPTC-Kennzeichnung bleibt.
2. Der KI-Chat muss sich als KI zu erkennen geben (Art. 50 Abs. 1). Das Label ist da. Für einen
   Chat mit dem eigenen Werkzeug ist das „offensichtlich“, damit genügt es.
3. Nach Art. 50 Abs. 4 muss offengelegt werden, dass ein Text KI-generiert ist, wenn er veröffentlicht
   wird, um die Öffentlichkeit über Angelegenheiten von öffentlichem Interesse zu informieren. Ein
   Lagebericht, den ein Nutzer öffentlich teilt, könnte darunter fallen. Diese Pflicht trifft den
   Nutzer, das Label erfüllt sie bereits.

**Empfehlung.** Nichts zwingend. Optional: In `DATENSCHUTZ.md` oder README einen Satz zur Kennzeichnung,
damit Nutzer wissen, dass sie das Label beim Weitergeben nicht entfernen sollten.

### Niedrig

#### B-10 Spenden: Steuer, Impressum, PayPal

- **Steuern (Schweiz).**
  - Eine echte Spende ohne Gegenleistung ist eine Schenkung. Bei der direkten Bundessteuer ist sie
    steuerfrei (DBG Art. 24 lit. a ⚪).
  - Kantonal kann eine Schenkungssteuer für Zuwendungen von Nichtverwandten anfallen. Die Freibeträge
    sind je nach Kanton verschieden, etwa ZH CHF 15 000 pro Schenker, Schwyz erhebt keine 🟡.
    Kleinspenden bleiben praktisch immer darunter.
  - Die MWST-Grenze liegt bei CHF 100 000 Umsatz. Echte Spenden sind ohnehin Nicht-Entgelt
    (MWSTG Art. 10 Abs. 2 lit. a, Art. 18 Abs. 2 lit. d ⚪).
  - Aus der Schenkung wird **Einkommen aus selbständiger Erwerbstätigkeit** (DBG Art. 18 ⚪), wenn die
    Spende faktisch eine Gegenleistung vergütet: Support, Sonderfunktionen, regelmässige
    „Abonnements“ etwa über Buy-me-a-coffee-Mitgliedschaften.
  - **Empfehlung:** keine Mitgliedschaften und keine Gegenleistungen (siehe B-7). Spenden in der
    Steuererklärung nach Rücksprache mit dem kantonalen Steueramt offenlegen, wenn sie in einem Jahr
    spürbar werden. Eine einfache Liste genügt.
- **Impressum.**
  - Art. 3 Abs. 1 lit. s UWG verlangt Identität und Kontaktadresse von dem, der im elektronischen
    Geschäftsverkehr Waren, Werke oder Leistungen *anbietet*. Ob eine kostenlose Software mit
    Spendenaufruf darunter fällt, ist ungeklärt; die Lehre ist uneins 🟡.
  - Deutschland: § 5 DDG verlangt „in der Regel gegen Entgelt“, § 18 Abs. 1 MStV ist weiter gefasst 🟡.
    Gegen einen Schweizer Privatanbieter einer GitHub-Seite ist das kaum durchsetzbar.
  - **Empfehlung:** kein volles Impressum mit Wohnadresse. Aber eine **Kontakt-E-Mail** im README, in
    `SECURITY.md` und im Haftungsausschluss (B-4). Das deckt die Kernfunktion ab: Erreichbarkeit für
    Rechtsinhaber, Sicherheitsmeldungen und Lizenzanfragen.
  - Wer eine eigene Website mit Spendenseite betreibt, sollte dort Name und E-Mail angeben.
- **PayPal.**
  - Der QR-Code ist das von PayPal selbst erzeugte Format („Trinkgeldkasse“, Initialen „RM“). Ihn zu
    benutzen ist vorgesehen; die PayPal-Marke steht nur beschreibend da.
  - Gegen Missverständnisse sollte das Wort „Spende“ im Dialog bleiben und nicht „Kauf“ werden.
  - Die Initialen und der Name hinter dem PayPal-Konto machen den Autor identifizierbar. Das ist eine
    Entscheidung des Autors, kein Rechtsproblem.
  - PayPal verlangt für das Sammeln von Spenden für *gemeinnützige Zwecke* teils ein Geschäftskonto.
    Für Trinkgeld an eine Privatperson ist das nicht der Fall ⚪.

#### B-11 Marke „AutarkTrade“

- **Prüfungsstand.**
  - Eine Websuche ergab keinen Treffer für „AutarkTrade“ oder „Autark Trade“ als Marke, App oder Firma 🟡.
  - Eine Registerrecherche (Swissreg, EUIPO, TMview) war automatisiert nicht möglich und ist **nicht
    erfolgt**.
  - „Autark“ ist beschreibend und damit kennzeichnungsschwach. Ältere Marken mit „Autark…“ in Klasse 9
    (Software) oder 42 (SaaS) sind denkbar. Relative Ausschlussgründe macht der Inhaber im
    Widerspruchsverfahren oder im Zivilprozess geltend (MSchG Art. 3, 31 ⚪).
- **Empfehlung.**
  1. **Bald** eine Suche nach `autark*` in den Klassen 9, 36 und 42 auf swissreg.ch und tmdn.org/tmview.
  2. Eine Eintragung ist nur sinnvoll, wenn das Projekt wächst oder Forks unter gleichem Namen
     auftauchen. Für die Schweiz kostet sie wenige hundert Franken beim IGE.
  3. `NOTICE.md` behält sich die Marke vor („Der Name … und das Logo sind nicht Teil der Lizenz“). Das
     ist nach AGPL §7 lit. e zulässig.
  4. Ergänzend empfiehlt sich ein Satz für Forks: „Wer eine geänderte Fassung weitergibt, benennt sie
     bitte um oder kennzeichnet sie deutlich als geändert (AGPL §5 lit. a, §7 lit. c).“

#### B-12 Drittlizenzen und Container: in Ordnung, zwei Kleinigkeiten

- **npm-Baum.** 224 Pakete, nur MIT, ISC, BSD, Apache-2.0, MPL-2.0/Apache-2.0 (DOMPurify) und Zlib
  (pako). Alles ist mit der AGPL-3.0 verträglich ⚪.
  - Apache-2.0 nur in Verbindung mit (A)GPL **v3**: erfüllt.
  - MPL-2.0 nur ohne „Incompatible With Secondary Licenses“: bei DOMPurify ohnehin wahlweise Apache.
  - `THIRD-PARTY-NOTICES` wird beim Docker-Build erzeugt, und ein Selbsttest prüft das gegen das
    Lockfile.
- **NOTICE-Texte.** ECharts und Lightweight Charts nach Apache §4(d) sind enthalten.
  - Das TradingView-Logo ist an. Laut README des Pakets würde auch ein Link an anderer Stelle genügen ✅.
    „Logo bleibt an“ ist strenger als nötig, aber sicher.
- **Debian im Image.** Es gibt ein Angebot für den Quellcode: drei Jahre, über Issue, zum
  Selbstkostenpreis (`NOTICE.md`). Das genügt GPLv2 §3(b) und GPLv3 §6(b) ⚪.
  - Besser wäre zusätzlich, die Paketliste (`dpkg-query -W`) als Datei ins Image und in das Release zu
    legen.
  - Das Angebot muss auch für den **gespiegelten** Tag `mouses007/trading-journal` gelten. Es gilt, weil
    es dasselbe Image ist; der Satz in NOTICE sollte beide Namen nennen.
- **APK und Firmware.** Lizenzen liegen bei (`THIRD-PARTY-NOTICES.txt` in der APK, `LIZENZEN.md` der
  Firmware). Eine Weitergabe der APK über GitHub-Releases ist damit gedeckt.

#### B-13 Urheberrecht am eigenen Code: KI-Anteile und Beiträge Dritter

- **KI-Anteile.**
  - Ein grosser Teil des Codes entstand mit KI-Unterstützung (Commits mit „Co-Authored-By: Claude“).
  - Urheberrechtsschutz setzt eine geistige Schöpfung eines Menschen voraus (URG Art. 2 Abs. 1 ⚪).
  - Wo der Mensch nur Ziele vorgibt und das Ergebnis nicht selbst gestaltet, ist der Schutz zweifelhaft.
- **Folge.**
  - Das macht die AGPL **nicht unwirksam**.
  - Es schwächt aber die Durchsetzung gegen jemanden, der den Code ohne Quellcode-Angebot verwendet.
  - Ebenso schwächt es die Behauptung „Copyright (C) 2026 Mouses007“ für einzelne Teile.
  - Die Auswahl, Anordnung, Spezifikation und Prüfung durch den Autor sind schutzfähig. Für ein Projekt
    dieser Grösse ist das der tragende Teil.
- **Haftung.** Keine.
- **Beiträge Dritter.**
  - `CONTRIBUTING.md` regelt die Lizenz eingehender Beiträge nicht. Die GitHub-ToS (D.6, „inbound =
    outbound“) decken das ab ⚪.
  - Sie verhindern aber eine spätere Umlizenzierung, etwa für einen Verkauf, ohne Zustimmung jedes
    Beitragenden.
  - **Empfehlung**, falls ein Verkauf eine Option bleiben soll: ein Developer Certificate of Origin
    (DCO) genügt nicht. Es bräuchte eine Rechteeinräumung (CLA) oder eine bewusste Entscheidung gegen
    diese Option. Sonst genügt ein Satz: „Beiträge stehen unter AGPL-3.0-or-later.“

#### B-14 Git-Historie: personenbezogene und interne Daten

- **Was gefunden wurde.**
  - Keine Geheimnisse: Datenbank-Passwort, `CTJ_SECRET`, private Schlüssel und E-Mail-Adresse gesucht,
    **keine Treffer** in der Historie.
  - Interne Netzangaben: `192.168.178.100` (NAS) in Tests, Doku und `docs/UMZUG-PRODUKTIV.md`. Das ist
    private Adressierung ohne Aussenwirkung und rechtlich unerheblich.
  - In `6ab0e6d` stehen alte Screenshots (`assets/screenshots/incoming.png`, `dashboard.png`,
    `livetrading.png`) mit **echten Trades** des Autors und einem Profilbild. Die Trades sind eigene
    Daten mit eigener Einwilligung, kein Problem. Beim **Profilbild** ist die Herkunft unklar. Zeigt es
    eine erkennbare Person, die nicht der Autor ist, oder stammt es aus einer fremden Quelle, sind Bild-
    und Persönlichkeitsrechte berührt (Art. 28 ZGB, URG ⚪).
- **Empfehlung.**
  - Herkunft des Profilbilds klären.
  - Ist sie fremd, ist ein Umschreiben der Historie nur für diese Datei zu erwägen.
  - Die Screenshots lagen bereits seit Februar 2026 öffentlich im alten Repo. Das Risiko ist gering.

#### B-15 Länder und Börsen

- Bitget sperrt DE, AT und FR, Bitunix FR, Pionex NL, ES, FR und UK (Verkaufsprüfung Zeilen 1–3).
- Die Software verteilt keine Konten. Ziffer 10 des Haftungsausschlusses weist den Nutzer zutreffend
  auf seine Eigenverantwortung hin. Das genügt.
- Ein Hinweis im README „Prüfe, ob deine Börse in deinem Land verfügbar ist“ wäre freundlich, ist aber
  nicht nötig.

---

## 5. Was gut ist

Damit die Gewichte stimmen:
- **Keine Orders.** Der Ausbau des scharfen Handels nimmt dem Projekt das grösste denkbare Risiko
  (Finanzmarktaufsicht, Haftung für Ausführungsfehler). Ein Selbsttest bewacht das.
- **Keine Telemetrie, kein Konto, kein CDN.** Der Autor ist datenschutzrechtlich fast unbeteiligt.
- **Schlüssel des Nutzers für KI und Börsen.** Er ist Vertragspartner der Anbieter. Die Schlüssel
  liegen verschlüsselt (AES-256-GCM) beim Nutzer.
- **KI-Kennzeichnung** sichtbar und maschinenlesbar, mit Prognose-Sperre.
- **Ehrliche Kennung** gegenüber den Datenquellen, keine Umgehung von Sperren.
- **Saubere Drittlizenzen**, automatisch erzeugt und per Selbsttest abgesichert.
- **Zustimmung mit Prüfsumme** des bestätigten Wortlauts.
- **Herkunftsnachweis** mit reproduzierbarem Prüfskript und ausgelagerten Spezifikationen.

---

## 6. Massnahmen

### Sofort (vor weiterer Bekanntmachung)

| # | Massnahme | Befund | Aufwand |
|---|---|---|---|
| 1 | Klarstellung zur Historie in `NOTICE.md` und `HERKUNFT.md`, GPL-Text unter `LICENSES/`, TradeNote-Urheber nennen | B-1 | 30 min |
| 2 | `quellenOhneFreigabe` für Neuinstallationen auf **aus** (Variante A) oder Pflichtschritt beim ersten Start (Variante B); Umbenennung, ehrlicher Text | B-2 | 2–4 h |
| 3 | Automatische Sicherung vor jeder Schema-Migration; Warnsatz im Update-Dialog | B-3 | 2–3 h |
| 4 | Docker-Hub-Tag `trading-journal:latest`: einfrieren oder deutlich beschreiben | B-3 | 30 min |
| 5 | OCI-Label `AGPL-3.0-or-later`; README „own licence“, NOTICE „Ziffer 12/13“, veraltete Kommentare, SECURITY/CONTRIBUTING bereinigen | B-5 | 30 min |
| 6 | CRA-Satz aus `rechtliches.betaText` streichen, Beta-Text an 4.0.0 anpassen | B-7 | 10 min |
| 7 | Kopf von `docs/VERKAUFS-PRUEFUNG.md`: „galt für einen Verkauf“ | B-2 | 5 min |

### Bald (innerhalb weniger Wochen)

| # | Massnahme | Befund |
|---|---|---|
| 8 | Haftungsausschluss 1.1: Absender, Kontakt, Ziffer 11 (zwingende Ausnahmen), englische Fassung | B-4 |
| 9 | `DATENSCHUTZ.md` als Reiter in „Rechtliches“, KI-Hinweis in den Einstellungen; optional Schalter „Tagebuch und Bilder nicht an die KI“ | B-6 |
| 10 | `macheFlach` löscht nur eigene Referenzen oder legt vorher ein Git-Bundle an | B-3 |
| 11 | Hinweis am Mail-Versand an mehrere Empfänger | B-8 |
| 12 | Kontakt-E-Mail in README und SECURITY.md | B-10 |
| 13 | Markenrecherche `autark*` (Klassen 9, 36, 42) | B-11 |
| 14 | Paketliste des Images ins Release, NOTICE nennt beide Image-Namen | B-12 |
| 15 | Satz zu eingehenden Beiträgen in CONTRIBUTING.md | B-13 |

### Nur wenn …

| Bedingung | Dann |
|---|---|
| … Spenden die Kosten spürbar übersteigen, es Gegenleistungen für Spender gibt oder bezahlter Support angeboten wird | CRA (ab 11.12.2027 voll) und Produkthaftung (nationale Umsetzung ab 09.12.2026) neu prüfen; steuerlich selbständige Erwerbstätigkeit prüfen |
| … AutarkTrade doch verkauft oder als Dienst betrieben wird | `docs/VERKAUFS-PRUEFUNG.md` gilt wieder voll, `quellenOhneFreigabe` aus; Rechte aller Beitragenden für die Umlizenzierung einholen (B-13) |
| … der scharfe Handel zurückkommt | FIDLEG/FINIG und MiFID neu prüfen (F-7), besonders bei automatischer Ausführung oder Signalen für andere |
| … Abmahnung oder Takedown eines Datenanbieters eingeht | betroffene Quelle sofort aus dem Schalter nehmen und entfernen, nicht streiten; Anwalt nur bei Geldforderung |
| … ein TradeNote-Beteiligter sich meldet | innerhalb von 30 Tagen beheben (GPL §8), `HERKUNFT.md` vorlegen |
| … das Profilbild aus der Historie fremd ist | Datei aus der Historie entfernen |
| … die Software für andere betrieben wird (Gruppe, Verein, Firma) | Datenschutz: der Betreiber wird Verantwortlicher, braucht eigene Datenschutzerklärung; Datenquellen: Bedingungen für kommerzielle Nutzung |

---

## 7. Offene Fragen für eine zugelassene Anwältin oder einen zugelassenen Anwalt

1. **Haftung für Voreinstellungen.** Kann ein Datenanbieter, etwa Yahoo, CoinMarketCap oder Telegram,
   in der Schweiz oder in Deutschland gegen den Autor einer kostenlosen Software vorgehen, die seinen
   Endpunkt ab Werk abfragt, wenn der Autor die Klausel nachweislich kennt? Gemeint sind Unterlassung,
   UWG, Art. 41 Abs. 2 OR sowie § 826 BGB bzw. § 4 Nr. 4 UWG-DE. Macht Variante A oder B (B-2) einen
   rechtlichen Unterschied?
2. **GPL-Altlast.** Genügt die Klarstellung in NOTICE (B-1) als Behebung nach GPL §8 für die öffentliche
   Historie? Ist eine Kontaktaufnahme mit den TradeNote-Urhebern ratsam oder schlafende Hunde wecken?
3. **Unentgeltlichkeit und Haftung.** Ist die AGPL-Lizenzierung nach Schweizer Recht eine Schenkung
   (Art. 248 OR) oder ein Innominatvertrag? Welcher Haftungsmassstab gilt für den Datenverlust durch die
   Brücke (B-3), und wie wirkt die nachträgliche Zustimmung zum Haftungsausschluss auf eine Migration,
   die vor der Zustimmung lief?
4. **Haftungsausschluss gegenüber deutschen Konsumenten.** Hält der Textvorschlag aus B-4 einer AGB-Kontrolle
   stand? Ist die Zustimmungspflicht für eine AGPL-Software (Benutzung ist nach AGPL §9 frei) überhaupt
   eine wirksame Einbeziehung?
5. **Spenden und „Geschäftstätigkeit“.** Ab welchem Verhältnis von Spenden zu Kosten nehmen
   Marktüberwachungsbehörden unter CRA und Produkthaftungsrichtlinie eine Geschäftstätigkeit an? Zählt
   die eigene Arbeitszeit als Kosten?
6. **Steuer.** Wie behandelt der Wohnsitzkanton regelmässige Kleinspenden an eine Privatperson für ein
   Open-Source-Projekt: Schenkung oder Einkommen? Hier hilft ein Vorbescheid (Ruling) beim kantonalen
   Steueramt.
7. **Marke.** Ergebnis der Registerrecherche und Kollisionsprüfung für „AutarkTrade“.
8. **Urheberrecht an KI-gestütztem Code.** Wie weit trägt der Copyright-Vermerk, und lässt sich die AGPL
   gegen einen Verletzer durchsetzen, wenn ein Teil des Codes KI-generiert ist (B-13)?

---

## 8. Fundstellen

Abrufdatum aller Online-Quellen: **22.10.2026**, sofern nicht anders vermerkt. Zeichen wie oben.

**Schweiz**
- OR (SR 220), Art. 41, 50, 99, 100, 239 ff., 248 ⚪ — https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de
- PrHG (SR 221.112.944), Art. 1, 3, 6 ⚪ — https://www.fedlex.admin.ch (SR-Nummer)
- revDSG (SR 235.1), Art. 2, 5, 7, 16, 19 ⚪ — https://www.fedlex.admin.ch/eli/cc/2022/491/de
- UWG (SR 241), Art. 3 Abs. 1 lit. b und s, Art. 4 lit. a, 5 lit. c, 8 ⚪ — https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/de
  - Impressumspflicht, Lehrmeinungen 🟡: https://law.ch/lawinfo/ict-law-informations-und-kommunikationstechnologie/impressumspflicht-e-commerce/ · https://www.it-recht-kanzlei.de/impressum-schweiz.html
- FIDLEG (SR 950.1) Art. 3 ⚪ — https://www.fedlex.admin.ch/eli/cc/2019/758/de · FIDLEV (SR 950.11) — https://www.fedlex.admin.ch/eli/cc/2019/763/de · FINIG (SR 954.1) Art. 2, 17 ⚪
  - Robo-Advice und Beraterregister 🟡: https://www.walderwyss.com/assets/content/publications/230331_Eintragungspflicht-der-Robo-Advisor-im-FIDLEG-Beraterregister_Pascal-Zysset.pdf · https://www.finma.ch/de/finma-public/fragen-und-probleme/zur-registrierung-von-kundenberaterinnen-oder-kundenberatern/
- MSchG (SR 232.11) Art. 3, 31 ⚪ — https://www.fedlex.admin.ch/eli/cc/1993/274_274_274/de · Register: https://www.swissreg.ch · https://www.tmdn.org/tmview
- URG (SR 231.1) Art. 2, 3, 10, 17 ⚪ — https://www.fedlex.admin.ch/eli/cc/1993/1798_1798_1798/de
- ZGB Art. 28 ⚪; IPRG Art. 120 ⚪
- DBG (SR 642.11) Art. 18, 24 lit. a, 33a ⚪ — https://www.fedlex.admin.ch/eli/cc/1991/1184_1184_1184/de
- MWSTG (SR 641.20) Art. 10 Abs. 2 lit. a, 18 Abs. 2 lit. d ⚪ — https://www.fedlex.admin.ch/eli/cc/2009/615/de
- Schenkungssteuer kantonal 🟡: https://law.ch/lawinfo/schenkungen-spenden/schenkungssteuern/ · https://www.vermoegenszentrum.ch/wissen/schenkungssteuer-das-sollten-sie-wissen

**EU / Deutschland**
- DSGVO (VO 2016/679) Art. 2, 3, 25, 26 ⚪ — https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EuGH C-25/17 *Jehovan todistajat*, 10.07.2018 ⚪; EuGH C-683/21 *Nacionalinis visuomenės sveikatos centras*, 05.12.2023 🟡 — https://curia.europa.eu/juris/liste.jsf?num=C-683/21
- AI Act (VO 2024/1689) Art. 2, 3, 50 ⚪ — https://eur-lex.europa.eu/eli/reg/2024/1689/oj
  - Digital Omnibus (VO 2026/1744) 🟡: https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/ · https://abreuadvogados.com/en/conhecimento/publications/digital-omnibus-regulation-on-ai-the-key-amendments-to-the-ai-act/ · https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/
  - Open-Source-Ausnahme 🟡: https://orrick.com/Insights/2024/05/The-EU-AI-Act-Open-Source-Exceptions-and-Considerations-for-Your-AI-Strategy
- Cyber Resilience Act (VO 2024/2847) — https://eur-lex.europa.eu/eli/reg/2024/2847/oj; ErwGr. 15 (Spenden) ✅ https://www.springlex.eu/en/packages/cra/cra-regulation/recital-15/; Fristen und Leitlinien 🟡 https://www.ecija.com/en/news-and-insights/cyber-resilience-act-obligations-to-report-vulnerabilities-and-incidents-from-september-2026/ · https://www.noze.it/en/insights/cra-commission-guidance/
- Produkthaftungsrichtlinie (EU) 2024/2853 Art. 2 Abs. 2, ErwGr. 14–15 🟡 — https://eur-lex.europa.eu/eli/dir/2024/2853/oj; Deutschland 🟡 https://www.gtlaw.com/en/insights/2026/1/new-german-product-liability-regime-broader-scope-potentially-higher-exposure
- MiFID II (RL 2014/65) Art. 4 Abs. 1 Nr. 4; DelVO 2017/565 Art. 9 ⚪ — https://eur-lex.europa.eu/eli/dir/2014/65/oj
- MiCA (VO 2023/1114) Art. 2 Abs. 4, Art. 3 Abs. 1 Nr. 24 ⚪ — https://eur-lex.europa.eu/eli/reg/2023/1114/oj
- MAR (VO 596/2014) Art. 3 Abs. 1 Nr. 34/35, Art. 20; DelVO 2016/958 ⚪ — https://eur-lex.europa.eu/eli/reg/2014/596/oj
- DSA (VO 2022/2065) Art. 3 lit. g ⚪ — https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- DDG § 5 🟡 — https://www.gesetze-im-internet.de/ddg/__5.html · MStV § 18 🟡
- BGB §§ 305 ff., 307, 309 Nr. 7, 521, 524, 823, 826 ⚪
- Datenbank-RL 96/9/EG Art. 7 ⚪ — https://eur-lex.europa.eu/eli/dir/1996/9/oj
- EuGH C-30/14 *Ryanair/PR Aviation*, 15.01.2015 ⚪ — https://curia.europa.eu/juris/liste.jsf?num=C-30/14
- BGH, 30.04.2014, I ZR 224/12 „Flugvermittlung im Internet“ ⚪
- LG Hamburg, 31.03.2023, 310 O 316/21; OLG Hamburg, 21.11.2024, 5 U 54/23 (youtube-dl) ✅ — https://www.lto.de/recht/hintergruende/h/urheberrecht-youtube-musik-videos-download-haftung-uberspace-youtube-dl · https://heise.de/-10179284
- LG München I, 19.05.2004, 21 O 6123/04 (Wirksamkeit der GPL) ⚪
- US: Meta v. Bright Data, N.D. Cal., 23.01.2024 ✅ — https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued; hiQ v. LinkedIn (9th Cir. 2022) ⚪

**Lizenzen**
- AGPL-3.0 §§ 5, 7, 9, 13, 15–17 ⚪ — https://www.gnu.org/licenses/agpl-3.0.html (Text identisch mit `LICENSE`)
- GPL-3.0 §§ 4, 8, 10, 13 ⚪ — https://www.gnu.org/licenses/gpl-3.0.html; TradeNote unter GPL-3.0 ✅ — https://api.github.com/repos/Eleven-Trading/TradeNote/license
- Kompatibilitätsliste der FSF ⚪ — https://www.gnu.org/licenses/license-list.html
- Lightweight Charts, Attribution ✅ — https://github.com/tradingview/lightweight-charts

**Datenquellen** (Einzelheiten und Zeilennummern: `docs/VERKAUFS-PRUEFUNG.md`, Stand 19.10.2026)
- Yahoo ToS §2(d)(9), 2(e) ✅ — https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- CoinMarketCap Terms §§ 2.1, 4.4, 5.1, 6.1 ✅ — https://coinmarketcap.com/terms/
- CoinGecko API Terms 4.1.6, 4.3, 6.1 ✅ — https://www.coingecko.com/en/api_terms
- DexScreener API Terms ✅ — https://docs.dexscreener.com/api/api-terms-and-conditions
- Alternative.me ✅ — https://alternative.me/crypto/fear-and-greed-index/
- pump.fun §§ 6.1, 21 ✅ — https://pump.fun/docs/terms-and-conditions
- Telegram Content Licensing 🟡 — https://telegram.org/tos/content-licensing
- GoPlus 🟡 — https://docs.gopluslabs.io/reference/api-license-agreement
- Federal Reserve 🟡 — https://www.federalreserve.gov/disclaimer.htm
- Binance 🟡 — https://www.binance.com/en/terms
- ForexFactory, Reddit, Bybit, OKX, Upbit, MEXC, Kraken, KuCoin, Gate, Coinbase, blockchain.info,
  CryptoQuant: Stand der Verkaufsprüfung vom 19.10.2026, am 22.10.2026 nicht erneut gelesen.

**Code und Unterlagen** (master `e140464`): `LICENSE`, `HAFTUNGSAUSSCHLUSS.md`, `NOTICE.md`,
`HERKUNFT.md`, `README.md`, `DOCKER.md`, `Dockerfile`, `docker-compose.yml`, `.github/SECURITY.md`,
`.github/CONTRIBUTING.md`, `THIRD-PARTY-NOTICES`, `server/rechtliches.js`, `server/spenden.js`,
`server/quellen/freigabe.js`, `server/update-api.js`, `server/update-flach.js`,
`server/ai-agent-tools.js`, `server/esp32-api.js`, `src/components/rechtliches/Rechtliches.vue`,
`src/components/rahmen/SpendenDialog.vue`, `src/assets/spenden-paypal.jpg`,
`src/i18n/locales/{de,en}.json` (`rechtliches.*`, `kiHinweis.*`, `spenden.*`, `datenquellen.of.*`),
`docs/VERKAUFS-PRUEFUNG.md`; Git-Historie (144 Commits, insbesondere `6ab0e6d`, `283aa1e`, `c6f8ccc`,
`1465372`); altes Repo `Crypto-Trading-Journal` `27a8e6b` (Brücke 3.15.0,
`.github/workflows/docker-publish.yml`, `docker-compose.yml`).
