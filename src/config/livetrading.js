/**
 * Registry der Kacheln im Live-Trading-Fenster.
 *
 * Gleiches Feldschema wie `src/config/marktradar.js` — dieselbe Mechanik aus
 * `kachel-registry.js`, dieselbe Bedeutung von `endpunkt`, `intervallMs`,
 * `spalten`, `symbolAbhaengig`. Drei Felder kommen dazu:
 *
 *   gross       — false = kein Vergrössern. Für Kacheln, die ihre Daten selbst
 *                 über einen laufenden Strom holen: die Gross-Ansicht ist eine
 *                 zweite Instanz derselben Komponente und würde eine zweite
 *                 Verbindung öffnen.
 *   minSpalten  — Untergrenze beim Ziehen. Eine Bookmap in einer Spalte ist
 *                 nicht klein, sondern unlesbar.
 *   eigenerStrom — die Kachel hängt an einem laufenden Datenstrom und MELDET
 *                 dessen Zustand selbst ans Raster. Nicht zu verwechseln mit
 *                 `endpunkt: null`: „Handelszeiten" hat auch keinen Endpunkt,
 *                 rechnet aber lokal aus `shared/handelszeiten.js` und ist zu
 *                 Recht immer fertig. Nur wer eine Verbindung hat, kann sie
 *                 auch verlieren.
 *   hoehe       — Standardhöhe in Pixeln, wenn der Nutzer noch nie am
 *                 Anfasser gezogen hat (sonst gilt die Rasterhöhe 270).
 *
 * ## Was hier bewusst FEHLT
 *
 * Regenbogen, Pi-Cycle, Altcoin-Saison, Marktregime, Marktübersicht,
 * Fear & Greed und die RSI-Matrix stehen im Marktradar und gehören dort auch
 * hin. Das sind Wochen- und Monatsinstrumente: sie ändern sich in einer
 * Handelssitzung nicht ein einziges Mal und kosten nur Platz neben dem Chart.
 *
 * Vier Kacheln teilt sich diese Seite mit dem Marktradar — gleiche Id, gleicher
 * Endpunkt. Das ist unkritisch, weil Sichtbarkeit, Reihenfolge, Grösse und
 * Parameter über getrennte localStorage-Schlüssel laufen. `mechanik` läuft hier
 * allerdings auf dem 15-Minuten-Fenster statt auf der Stunde: im Handelsfenster
 * interessiert, was gerade passiert, nicht was heute passiert ist.
 */

import { baueKachelListe, macheSortierer } from './kachel-registry.js'
import { Q } from './marktradar.js'

/**
 * Standardanordnung — die vom Nutzer eingerichtete Aufstellung (10.10.2026):
 * zuoberst die beiden Arbeitsflächen (Bookmap, Hebelkarte) nebeneinander,
 * darunter Momentum Radar und Kompakt. Alles Übrige steht in der
 * Kompakt-Kachel und startet ausgeblendet; die Reihenfolge dahinter gilt
 * nur noch für den, der eine Einzelkachel wieder einblendet.
 */
export const STANDARD_REIHENFOLGE = [
    'bookmap', 'hebelkarte',
    'momentum', 'kompakt',
    'handelslage',
    'mechanik', 'liqticker', 'positionen',
    'coinradar', 'lsoi', 'indizes', 'funding',
    'handelszeiten', 'makro', 'kalender',
    'lage',
]

/**
 * Was die Kompakt-Kachel zusammenfasst. Diese Kacheln bleiben einzeln
 * zuschaltbar, starten aber ausgeblendet (`Livetrading.vue`), und ihre Daten
 * werden geholt, solange die Kompakt-Kachel sichtbar ist.
 */
export const KOMPAKT_QUELLEN = [
    'handelszeiten', 'kalender', 'mechanik', 'liqticker',
    'lsoi', 'funding', 'indizes', 'makro', 'coinradar', 'handelslage', 'lage',
]

/**
 * Was beim Umstieg auf die Kompakt-Kachel ausgeblendet wird: ihre Quellen und
 * die Positionen. Die Positionen stehen nicht mehr in der Karte (der Nutzer
 * braucht sie dort nicht, 10.10.2026) und werden deshalb auch nicht geholt —
 * das spart den Bitunix-Abruf alle zehn Sekunden. Als Einzelkachel bleiben sie
 * zuschaltbar.
 */
export const KOMPAKT_AUSGEBLENDET = [...KOMPAKT_QUELLEN, 'positionen']

/*
 * Quellenangaben wie im Marktradar (`Q` dort). Kalender: amtliche Quellen mit
 * der Quellenangabe, um die sie bitten (Fed, BEA, Eurostat — Fundstellen in
 * `server/kalender-quellen.js`).
 */
const KALENDER_QUELLEN = [
    { name: 'Federal Reserve Board', url: 'https://www.federalreserve.gov/newsevents/calendar.htm', art: 'quelle' },
    { name: 'U.S. Bureau of Economic Analysis', url: 'https://www.bea.gov/news/schedule', art: 'quelle' },
    { name: 'Eurostat', url: 'https://ec.europa.eu/eurostat/news/release-calendar', art: 'quelle' },
    // Ohne Verkaufsfreigabe, nur mit Schalter (S15, `freigabe: true`)
    { name: 'ForexFactory', url: 'https://www.forexfactory.com/calendar', art: 'quelle', freigabe: true },
]

const DEFINITIONEN = [
    {
        /*
         * Die Nebenkacheln als je eine Zeile. Holt nichts selbst (`endpunkt:
         * null`), die Seite reicht die Nutzlasten der Quellen durch. Ein Klick
         * auf eine Zeile öffnet die volle Kachel in der Gross-Ansicht.
         */
        id: 'kompakt',
        titleKey: 'livetrading.kompakt.title',
        icon: 'liste',
        endpunkt: null,
        intervallMs: Infinity,
        // Zwei Spalten, gleich breit wie der Momentum Radar daneben — die vom
        // Nutzer eingerichtete Aufstellung (10.10.2026): oben Bookmap und
        // Liquidationskarte, darunter Momentum Radar und Kompakt.
        spalten: 2,
        hoehe: 320,
        // Die Gross-Ansicht wäre dieselbe Liste, nur breiter
        gross: false,
        quelle: [],
    },
    {
        /*
         * Momentum Radar als Kachel. Rechnet auf dem Server über
         * sechs Zeitebenen, nur auf geschlossenen Kerzen. 60 s reichen: die
         * kleinste Zeitebene ist 5m, und vor ihrem Schluss ändert sich nichts.
         */
        id: 'momentum',
        titleKey: 'livetrading.momentum.title',
        icon: 'live',
        endpunkt: '/api/livetrading/momentum',
        // 4h = Swing-Modus: die vom Nutzer gewählte Grundeinstellung
        params: { tf: '4h' },
        symbolAbhaengig: true,
        intervallMs: 60 * 1000,
        spalten: 2,
        hoehe: 320,
        quelle: [{ marktdaten: true, zusatz: '(Futures + Spot)' }],
    },
    {
        id: 'handelszeiten',
        titleKey: 'livetrading.handelszeiten.title',
        icon: 'uhr',
        // Rechnet im Browser aus `shared/handelszeiten.js` — kein Abruf.
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 1,
        quelle: [{ name: 'eigene Rechnung (Zeitzonen)', klein: false }],
    },
    {
        id: 'mechanik',
        titleKey: 'marktradar.mechanik.title',
        icon: 'einstellungen',
        endpunkt: '/api/marktradar/mechanik',
        params: { fenster: '15m' },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten, { name: 'eigene Aufzeichnung', klein: false }],
        symbolAbhaengig: true,
    },
    {
        id: 'liqticker',
        titleKey: 'livetrading.liq.title',
        icon: 'feuer',
        endpunkt: '/api/livetrading/liq-ticker',
        params: { minuten: 15 },
        // Der Server hält die Ereignisse im Arbeitsspeicher; fünf Sekunden sind
        // hier billig und machen aus der Kachel erst einen Ticker.
        intervallMs: 5 * 1000,
        spalten: 1,
        quelle: [{ name: 'eigene Aufzeichnung (Binance, Bybit)' }],
    },
    {
        id: 'positionen',
        titleKey: 'livetrading.positionen.title',
        icon: 'geldbeutel',
        endpunkt: '/api/livetrading/session-stand',
        // Zeitraum und Plangrenzen kommen aus der laufenden Sitzung, nicht aus
        // der Registry — die Seite reicht sie über `zusatzParams` nach.
        sitzungAbhaengig: true,
        intervallMs: 10 * 1000,
        spalten: 1,
        quelle: [{ name: 'Bitunix (eigenes Konto)' }],
    },
    {
        id: 'kalender',
        titleKey: 'livetrading.kalender.title',
        icon: 'kalender',
        endpunkt: '/api/livetrading/kalender-countdown',
        params: { stunden: 8 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: KALENDER_QUELLEN,
    },
    {
        id: 'indizes',
        titleKey: 'livetrading.indizes.title',
        icon: 'linie',
        /*
         * Kerzen von ES, NQ, RTY und DXY aus Yahoo Finance — ohne
         * Verkaufsfreigabe (Verkaufs-Prüfung Z. 39). S12 hatte die Kachel
         * entfernt; seit S15 läuft sie wieder, solange der Schalter
         * `quellenOhneFreigabe` an ist, sonst antwortet der Endpunkt
         * `{ aus: true, grund: 'ohneFreigabe' }` und die Kachel zeigt das.
         */
        endpunkt: '/api/livetrading/indizes',
        // `stunden` statt `range`: Yahoos `range=1d` liefert für einen Future
        // nur die laufende reguläre Sitzung — morgens sind das zehn Kerzen.
        // Der Server holt jetzt immer fünf Tage und schneidet auf dieses
        // Fenster zu; die Auflösung wandert mit (siehe `FENSTER` in der Kachel).
        params: { interval: '5m', stunden: 12 },
        intervallMs: 60 * 1000,
        // Ein Kerzenchart braucht Breite, sonst klebt jede Kerze an der nächsten
        spalten: 2,
        quelle: [{ ...Q.yahoo, name: 'Yahoo Finance (ES=F, NQ=F, RTY=F, DX-Y.NYB)' }],
    },
    {
        id: 'coinradar',
        titleKey: 'livetrading.coinradar.title',
        icon: 'rangliste',
        /*
         * Liest den letzten FERTIGEN Lauf, stösst keinen an: `GET zeilen` ist
         * ein reiner Datenbankblick, `POST lauf` wäre 42 Sekunden Arbeit und
         * 360 Gewichtspunkte bei Binance. Eine Kachel darf so etwas nicht im
         * Takt auslösen.
         */
        endpunkt: '/api/coin-radar/zeilen',
        params: { limit: 10 },
        // Der Radar selbst läuft im Takt von Minuten bis Stunden — häufiger zu
        // fragen liefert dieselbe Zeile noch einmal.
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [{ name: 'Coin-Radar (eigener Lauf)', klein: false }],
    },
    {
        id: 'funding',
        titleKey: 'marktradar.funding.title',
        icon: 'prozent',
        endpunkt: '/api/marktradar/funding',
        params: { n: 50 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten, { name: 'Bitunix' }, { name: 'Bybit' }],
    },
    {
        id: 'lsoi',
        titleKey: 'marktradar.lsoi.title',
        icon: 'waage',
        endpunkt: '/api/marktradar/ls-oi',
        params: { stunden: 48 },
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten],
    },
    {
        id: 'makro',
        titleKey: 'marktradar.makro.title',
        icon: 'globus',
        endpunkt: '/api/marktradar/makro',
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.yahoo, Q.coingecko, { marktdaten: true, zusatz: '(BTC-Tageskerzen)', freigabe: true }],
    },
    {
        /*
         * Die Schwester der Gesamtlage, mit dem Horizont dieser Seite: was
         * geben die nächsten Stunden her. Eigene Kachel statt Umbau der
         * Gesamtlage, weil die beiden verschiedene Fragen beantworten — Zyklus
         * gegen Handelstag — und eine Kachel, die Regenbogen-Bänder neben einen
         * 15-Minuten-Befund stellt, keine von beiden gut beantwortet.
         *
         * Wie bei der Gesamtlage LIEST der Endpunkt nur; erzeugt wird per Knopf
         * (POST) oder durch den Automatismus in der Kachel. Der Prüftakt der
         * Seite liegt bei drei Sekunden — ein erzeugendes GET wäre eine
         * fortlaufende Rechnung.
         */
        id: 'handelslage',
        titleKey: 'livetrading.handelslage.title',
        icon: 'kompass',
        endpunkt: '/api/livetrading/handelslage',
        symbolAbhaengig: true,
        intervallMs: 60 * 1000,
        spalten: 2,
        quelle: [{ name: 'Kerzen, Kalender und Handelszeiten', klein: false }],
    },
    {
        // Dieselbe Kachel wie im Marktradar. Der Endpunkt LIEST nur, was schon
        // erzeugt wurde — erzeugt wird per Knopf in der Kachel (POST). Sonst
        // würde „Alle aktualisieren" bei jedem Druck eine KI-Anfrage bezahlen,
        // und im Live-Fenster läuft der Prüftakt bei drei Sekunden.
        id: 'lage',
        titleKey: 'marktradar.lage.title',
        icon: 'ki',
        endpunkt: '/api/marktradar/lage',
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [{ name: 'die übrigen Kacheln', klein: false }],
    },
    /*
     * Die beiden Canvas-Kacheln hängen an eigenen Datenströmen und stehen
     * deshalb am Ende: `endpunkt: null` (sie holen selbst), `gross: false`
     * (die Gross-Ansicht wäre eine zweite Instanz und damit eine zweite
     * Verbindung) und `minSpalten: 2` (in einer Spalte unlesbar). Eine
     * Telefon-Ausnahme brauchen sie nicht mehr — die ganze Seite ist auf den
     * Desktop beschränkt.
     */
    {
        id: 'bookmap',
        titleKey: 'nav.liquidity',
        // Eigenes `infoKey`: `nav.liquidity`/`nav.liquidations` enden nicht auf
        // `.title`, die Ableitung ergäbe zweimal dasselbe `nav.info`.
        infoKey: 'livetrading.bookmap.info',
        icon: 'linie',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        minSpalten: 2,
        // Standardhöhe in Pixeln (sonst gälte die Rasterhöhe von 270): als
        // oberste Arbeitsfläche braucht der Chart von Anfang an echte Höhe,
        // nicht erst nach dem Ziehen am Anfasser.
        hoehe: 690,
        gross: false,
        // Hängt an einem eigenen Strom und meldet dessen Zustand selbst ans
        // Raster. Siehe `eigenerStrom` in `useKachelRaster.js`.
        eigenerStrom: true,
        quelle: [{ marktdaten: true, zusatz: 'Orderbuchstrom (live)' }],
    },
    {
        id: 'hebelkarte',
        titleKey: 'nav.liquidations',
        // Eigenes `infoKey`: `nav.liquidity`/`nav.liquidations` enden nicht auf
        // `.title`, die Ableitung ergäbe zweimal dasselbe `nav.info`.
        infoKey: 'livetrading.hebelkarte.info',
        icon: 'feuer',
        endpunkt: null,
        intervallMs: Infinity,
        spalten: 2,
        minSpalten: 2,
        hoehe: 690,
        gross: false,
        eigenerStrom: true,
        quelle: [{ marktdaten: true, zusatz: '(Modell aus Open-Interest-Verlauf)' }],
    },
]

export const KACHELN = baueKachelListe(DEFINITIONEN, STANDARD_REIHENFOLGE)

export const { kachelById, sortiereKacheln } = macheSortierer(KACHELN)
