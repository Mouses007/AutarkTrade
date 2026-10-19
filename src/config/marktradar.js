/**
 * Registry der Marktradar-Kacheln.
 *
 * Reines Datenmodul ohne Vue-Abhängigkeit — dasselbe Prinzip wie
 * `src/config/menu.js`. Die Vorgabe-Reihenfolge steht in
 * `STANDARD_REIHENFOLGE`; der Nutzer kann sie per Ziehen ändern, seine
 * Anordnung liegt im localStorage.
 *
 * Felder:
 *   id          — Schlüssel in Sichtbarkeit, Reihenfolge und Datenspeicher
 *   titleKey    — i18n-Schlüssel der Überschrift
 *   icon        — Symbolname (`src/components/basis/Symbol.vue`)
 *   endpunkt    — Server-Endpunkt; null = Kachel rechnet ohne eigenen Abruf
 *   intervallMs — wie oft nachgeladen wird, solange die Kachel sichtbar ist
 *   spalten     — Breite im Raster (1 = normal, 2 = doppelt)
 *   quelle      — Quellenliste `[{ name, url?, art, klein? }]` (siehe `Q`)
 */

import { baueKachelListe, macheSortierer } from './kachel-registry.js'

/**
 * Standardanordnung für Geräte, auf denen noch nichts gezogen wurde.
 *
 * Bewusst getrennt von den Definitionen: die Reihenfolge ist eine
 * Geschmacksfrage und ändert sich öfter als die Kacheln selbst — so ist eine
 * Umsortierung eine Zeile statt eines Verschiebens ganzer Blöcke. Ids, die
 * hier fehlen, hängen hinten an (siehe `sortiereKacheln`), gehen also nie
 * verloren.
 *
 * Stand 17.08.2026: Wunsch-Layout des Nutzers vom Desktop übernommen.
 */
export const STANDARD_REIHENFOLGE = [
    'mechanik', 'funding', 'lsoi', 'liq24', 'fng', 'dom',
    'picycle', 'altseason', 'markt', 'rainbow', 'regime', 'rsi', 'makro', 'etf', 'wal',
    // Die Zusammenfassung steht am Ende: sie liest die anderen Kacheln, also
    // gehört sie hinter sie — und nachrückende Ids landen ohnehin dort.
    'lage',
]

/*
 * Quellenangaben (S12, Verkaufs-Prüfung Abschn. 3.3 Punkt 2). Pflichtzeilen
 * mit dem Wortlaut, den der Anbieter verlangt, und mit Link; sie stehen in der
 * kleinen Kachel UND in der Gross-Ansicht (`RadarKachel`, `RadarOverlay`).
 * `{ marktdaten: true }` wird zur gewählten Marktdatenquelle („Daten:
 * Binance"), siehe `loeseQuellen` in `useKachelRaster.js`. `klein: false`
 * heisst: nur in der Gross-Ansicht (Erläuterung, keine Herkunft).
 */
export const Q = {
    /** Kommerziell erlaubt mit Quelle „gut sichtbar direkt neben den Daten" (Z. 19). */
    alternativeMe: { name: 'Alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/', art: 'quelle' },
    /** „Powered by CoinGecko" an jeder Anzeige (API-Terms §4.4, Z. 21). */
    coingecko: { name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' },
    /** Quelle nennen (Data Distribution Policy, Z. 30). */
    cryptoquant: { name: 'CryptoQuant', url: 'https://cryptoquant.com/', art: 'daten' },
    marktdaten: { marktdaten: true },
    /*
     * Quellen ohne Verkaufsfreigabe (S15, `server/quellen/freigabe.js`): nur
     * angezeigt, solange der Schalter `quellenOhneFreigabe` an ist
     * (`freigabe: true`, siehe `loeseQuellen`).
     */
    yahoo: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/', art: 'daten', freigabe: true },
    blockchainInfo: { name: 'blockchain.info', url: 'https://www.blockchain.com/explorer/charts/market-price', art: 'daten', freigabe: true },
    coinmarketcap: { name: 'CoinMarketCap', url: 'https://coinmarketcap.com/charts/', art: 'daten', freigabe: true },
    telegram: { name: 'eigene Telegram-Quellen (Whale Alert, Lookonchain, …)', art: 'daten', freigabe: true },
}

const DEFINITIONEN = [
    {
        id: 'fng',
        titleKey: 'marktradar.fng.title',
        icon: 'puls',
        endpunkt: '/api/marktradar/fear-greed',
        params: { tage: 365 },
        // Der Wert wechselt einmal täglich — häufiger nachfragen wäre reine Fremdlast
        intervallMs: 15 * 60 * 1000,
        spalten: 1,
        quelle: [Q.alternativeMe],
    },
    {
        id: 'dom',
        titleKey: 'marktradar.dom.title',
        icon: 'muenzen',
        endpunkt: '/api/marktradar/btc-dominanz',
        intervallMs: 3 * 60 * 1000,
        spalten: 1,
        flaeche: true,
        quelle: [Q.coinmarketcap, Q.coingecko, { name: 'eigene Tagesschnappschüsse', klein: false }],
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
        // Folgt der Symbolwahl im Seitenmenü, damit sie überall dieselbe ist
        symbolAbhaengig: true,
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten],
    },
    {
        id: 'mechanik',
        titleKey: 'marktradar.mechanik.title',
        icon: 'prozessor',
        endpunkt: '/api/marktradar/mechanik',
        params: { fenster: '1h' },
        // Folgt der Symbolwahl im Seitenmenü wie die Long/Short-Kachel
        symbolAbhaengig: true,
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten, { name: 'eigene Liquidations-Aufzeichnung', klein: false }],
    },
    {
        id: 'liq24',
        titleKey: 'marktradar.liq.title',
        icon: 'feuer',
        endpunkt: '/api/marktradar/liquidationen',
        params: { stunden: 24 },
        intervallMs: 60 * 1000,
        spalten: 1,
        quelle: [{ name: 'eigene Aufzeichnung (Binance, Bybit)' }],
    },
    {
        id: 'makro',
        titleKey: 'marktradar.makro.title',
        icon: 'globus',
        endpunkt: '/api/marktradar/makro',
        // Futures laufen fast durch, aber ein Minutentakt brächte nichts —
        // die Kopplung ändert sich in Tagen, nicht in Minuten
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.yahoo, Q.coingecko, { marktdaten: true, zusatz: '(BTC-Tageskerzen)', freigabe: true }],
    },
    {
        id: 'picycle',
        titleKey: 'marktradar.picycle.title',
        icon: 'wachstum',
        endpunkt: '/api/marktradar/picycle',
        // Tageskerzen — häufiger nachzufragen ändert nichts
        intervallMs: 12 * 60 * 60 * 1000,
        spalten: 1,
        quelle: [Q.blockchainInfo, { marktdaten: true, zusatz: '(BTCUSDT Spot)', freigabe: true },
            { marktdaten: true, zusatz: '(BTCUSDT Spot, ab 2017)', ohneSchalter: true }],
    },
    {
        id: 'altseason',
        titleKey: 'marktradar.altseason.title',
        icon: 'tausch',
        endpunkt: '/api/marktradar/altseason',
        params: { tage: 90 },
        intervallMs: 30 * 60 * 1000,
        spalten: 1,
        quelle: [Q.marktdaten, Q.coingecko],
    },
    {
        id: 'markt',
        titleKey: 'marktradar.markt.title',
        icon: 'ebenen',
        endpunkt: '/api/marktradar/markt',
        params: { n: 50 },
        intervallMs: 5 * 60 * 1000,
        // Blasen und Treemap brauchen Fläche, sonst wird jede Beschriftung Brei
        spalten: 2,
        flaeche: true,
        quelle: [Q.coingecko],
    },
    {
        id: 'rainbow',
        titleKey: 'marktradar.rainbow.title',
        icon: 'regenbogen',
        endpunkt: '/api/marktradar/rainbow',
        // Wochenkerzen — häufiger nachzufragen wäre sinnlos
        intervallMs: 12 * 60 * 60 * 1000,
        spalten: 1,
        flaeche: true,
        quelle: [Q.blockchainInfo, { marktdaten: true, zusatz: '(BTCUSDT Spot)', freigabe: true },
            { marktdaten: true, zusatz: '(BTCUSDT Spot, ab 2017)', ohneSchalter: true }],
    },
    {
        id: 'regime',
        titleKey: 'marktradar.regime.title',
        icon: 'analyse',
        endpunkt: '/api/marktradar/regime',
        params: { tage: 365 },
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.alternativeMe, { name: 'eigene Trades', klein: false }],
    },
    {
        id: 'lage',
        titleKey: 'marktradar.lage.title',
        icon: 'ki',
        // Der Endpunkt LIEST nur, was schon erzeugt wurde — erzeugt wird per
        // Knopf in der Kachel (POST). Sonst würde „Alle aktualisieren" jedes
        // Mal eine KI-Anfrage bezahlen.
        endpunkt: '/api/marktradar/lage',
        // Mechanik und Long/Short in der Zusammenfassung sollen denselben Markt
        // meinen wie der Rest der Seite
        symbolAbhaengig: true,
        // Nur ein Blick in den Speicher des Servers; nichts Fremdes daran
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [{ name: 'die übrigen Kacheln dieser Seite', klein: false }],
    },
    {
        id: 'etf',
        titleKey: 'marktradar.etf.title',
        icon: 'gebaeude',
        endpunkt: '/api/marktradar/etf',
        // Der Endpunkt liest nur den eigenen Bestand — der Abruf bei
        // CryptoQuant läuft im Hintergrundtakt, höchstens alle sechs Stunden.
        // Häufiger nachzusehen kostet nichts und ändert meist nichts: die
        // Quelle liefert einmal täglich gegen 12:00 UTC.
        intervallMs: 30 * 60 * 1000,
        spalten: 1,
        quelle: [Q.cryptoquant, { name: 'eigener Bestand ab Einrichtung', klein: false }],
    },
    {
        id: 'wal',
        titleKey: 'marktradar.wal.title',
        icon: 'anker',
        /*
         * Liest Wal-Transaktionen aus mitgeschriebenen Telegram-Kanälen.
         * Telegram hat keine Verkaufsfreigabe (Verkaufs-Prüfung Z. 31): S12
         * hatte die Kachel entfernt, seit S15 läuft sie wieder, solange der
         * Schalter `quellenOhneFreigabe` an ist — sonst antwortet der Endpunkt
         * `{ aus: true, grund: 'ohneFreigabe' }` und die Kachel sagt das.
         * Nur eigene, schon gesammelte Telegram-Beiträge — kein Netzabruf,
         * daher darf hier häufiger nachgesehen werden als bei den News selbst.
         */
        endpunkt: '/api/marktradar/wale',
        params: { stunden: 24, minUsd: 5000000 },
        intervallMs: 5 * 60 * 1000,
        spalten: 1,
        quelle: [Q.telegram, { name: 'eigener Parser, keine Fremd-API', klein: false }],
    },
    {
        id: 'rsi',
        titleKey: 'marktradar.rsi.title',
        icon: 'tabelle',
        endpunkt: '/api/marktradar/rsi',
        params: { n: 50 },
        intervallMs: 60 * 1000,
        // Eine Matrix braucht Breite — sonst quetschen sich die Spalten
        spalten: 2,
        flaeche: true,
        quelle: [Q.marktdaten, Q.coingecko],
    },
]

/**
 * Die Kacheln in der Standardanordnung. Kacheln ohne Eintrag in
 * `STANDARD_REIHENFOLGE` hängen hinten an — eine vergessene Id kostet damit
 * die Wunschposition, aber nie die Kachel.
 *
 * Die Mechanik dahinter teilt sich diese Registry mit dem Live-Trading-Fenster
 * (`src/config/kachel-registry.js`); die Exporte hier bleiben unverändert,
 * damit keine Importstelle angefasst werden muss.
 */
export const KACHELN = baueKachelListe(DEFINITIONEN, STANDARD_REIHENFOLGE)

export const { kachelById, sortiereKacheln } = macheSortierer(KACHELN)
