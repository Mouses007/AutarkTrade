/**
 * Selbsttest: Trennung der Märkte Krypto ↔ Aktien in der Oberfläche.
 *
 *   node src/utils/__selftest-aktien-trennung.mjs
 *
 * Geprüft werden die reinen Regeln hinter Chart und Strategien-Modus:
 *   - ein Watchlist-Eintrag lädt die Schreibweise der Börse des Panels
 *     (`symbolFuerPanel`), Coins bleiben unberührt
 *   - offene Positionen und Alarme je Markt (`marktTrennung.js`)
 *   - Krypto-Ebenen des Charts ruhen bei Aktien (`overlays/liste.js`)
 *   - Instanz-Zähler der Bibliothek je Markt (`strategien/markt.js`)
 * Menü und Umleitung prüft `__selftest-markt.mjs`.
 */
import assert from 'node:assert/strict'
import { titelVon, schreibweisen, gleicherTitel, symbolFuerPanel, listenSymbol, vorzug, standardAktien } from './chart/aktienSymbole.js'
import { teilePositionen, andererMarkt, alarmImMarkt } from './chart/marktTrennung.js'
import { OVERLAYS, overlaysFuer, istNurKrypto, overlayAn } from './chart/overlays/liste.js'
import { marktParams, istAndererMarkt, zaehleInstanzen, vorgabenFuer, KRYPTO } from './strategien/markt.js'
import { baueKlassenNachschlag } from '../../shared/anlageklasse.js'

let n = 0
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

// ── Titel-Liste wie von /api/aktien/chart-symbole ────────────────────────────
const LISTE = [
    { ticker: 'NVDA', name: 'NVIDIA', symbole: { binance: 'NVDAUSDT', bitunix: 'NVDAUSDT', bitget: 'NVDASTOCKUSDT' }, spot: [] },
    { ticker: 'ACN', name: 'Accenture', symbole: { bitget: 'ACNSTOCKUSDT' }, spot: [] },
    { ticker: 'TSLA', name: 'Tesla', symbole: { binance: 'TSLAUSDT', bitget: 'TSLAUSDT' }, spot: [] },
]
const ALLE = ['binance', 'bitunix', 'bitget']

gleich(titelVon(LISTE, 'NVDASTOCKUSDT')?.ticker, 'NVDA', 'Bitget-Schreibweise findet den Titel')
gleich(titelVon(LISTE, 'nvdausdt')?.ticker, 'NVDA', 'Gross-/Kleinschreibung egal')
gleich(titelVon(LISTE, 'BTCUSDT'), null, 'ein Coin ist kein Titel')
gleich(titelVon([], 'NVDAUSDT'), null, 'leerer Stamm: unbekannt')
gleich(titelVon(null, ''), null, 'ohne Liste und Symbol')

gleich(schreibweisen(LISTE, 'NVDAUSDT'), ['NVDAUSDT', 'NVDASTOCKUSDT'], 'alle Schreibweisen, das gefragte Symbol zuerst')
gleich(schreibweisen(LISTE, 'BTCUSDT'), ['BTCUSDT'], 'Coin: nur er selbst')
gleich(schreibweisen([], 'BTCUSDT'), ['BTCUSDT'], 'Krypto-Markt (leere Liste): nur das Symbol')
gleich(gleicherTitel(LISTE, 'NVDAUSDT', 'NVDASTOCKUSDT'), true, 'zwei Schreibweisen, ein Titel')
gleich(gleicherTitel(LISTE, 'NVDAUSDT', 'TSLAUSDT'), false, 'zwei Titel')
gleich(gleicherTitel([], 'BTCUSDT', 'BTCUSDT'), true, 'dasselbe Symbol')
gleich(gleicherTitel([], 'BTCUSDT', 'ETHUSDT'), false, 'zwei Coins')

// ── Watchlist-Klick: das zum Panel passende Symbol ───────────────────────────
gleich(symbolFuerPanel(LISTE, 'NVDAUSDT', 'bitget', ALLE), { symbol: 'NVDASTOCKUSDT' }, 'Binance-Eintrag im Bitget-Panel')
gleich(symbolFuerPanel(LISTE, 'NVDASTOCKUSDT', 'binance', ALLE), { symbol: 'NVDAUSDT' }, 'Bitget-Eintrag im Binance-Panel')
gleich(symbolFuerPanel(LISTE, 'NVDASTOCKUSDT', 'bitunix', ALLE), { symbol: 'NVDAUSDT' }, 'Bitget-Eintrag im Bitunix-Panel')
gleich(symbolFuerPanel(LISTE, 'NVDAUSDT', 'binance', ALLE), { symbol: 'NVDAUSDT' }, 'passt schon: bleibt')
gleich(symbolFuerPanel(LISTE, 'TSLAUSDT', 'bitget', ALLE), { symbol: 'TSLAUSDT' }, 'gleiche Schreibweise an beiden Börsen')
// Die Börse des Panels führt den Titel nicht: das Panel wechselt auf die erste, die ihn führt
gleich(symbolFuerPanel(LISTE, 'ACNSTOCKUSDT', 'binance', ALLE), { symbol: 'ACNSTOCKUSDT', boerse: 'bitget' }, 'nur Bitget führt den Titel')
gleich(symbolFuerPanel(LISTE, 'TSLAUSDT', 'bitunix', ['bitunix', 'bitget']), { symbol: 'TSLAUSDT', boerse: 'bitget' }, 'ohne Binance-Wahl: Bitget')
gleich(symbolFuerPanel(LISTE, 'TSLAUSDT', 'bitunix', ['bitunix']), { symbol: 'TSLAUSDT' }, 'keine wählbare Börse führt ihn: unverändert')
// Coins und der Krypto-Markt bleiben exakt, wie sie waren
gleich(symbolFuerPanel(LISTE, 'BTCUSDT', 'bitget', ALLE), { symbol: 'BTCUSDT' }, 'Coin in der Aktien-Liste: unverändert')
gleich(symbolFuerPanel([], 'NVDAUSDT', 'bitget', ALLE), { symbol: 'NVDAUSDT' }, 'Krypto-Markt (leere Liste): unverändert')

// In die Watchlist kommt die Schreibweise der Vorzugs-Börse (Marktdatenquelle)
gleich(listenSymbol(LISTE, 'NVDASTOCKUSDT', vorzug('binance', ALLE)), 'NVDAUSDT', 'Bitget-Panel, Quelle Binance')
gleich(listenSymbol(LISTE, 'NVDAUSDT', vorzug('bitget', ['bitunix', 'bitget'])), 'NVDASTOCKUSDT', 'Quelle Bitget')
gleich(listenSymbol(LISTE, 'ACNSTOCKUSDT', vorzug('binance', ALLE)), 'ACNSTOCKUSDT', 'Vorzugs-Börse führt ihn nicht: die nächste')
gleich(listenSymbol(LISTE, 'BTCUSDT', ALLE), 'BTCUSDT', 'Coin bleibt')
// Die Start-Watchlist steht schon in dieser Schreibweise
gleich(standardAktien(LISTE, vorzug('bitget', ['bitunix', 'bitget'])).watchlist.map((w) => w.symbol), ['NVDASTOCKUSDT', 'TSLAUSDT'], 'Start-Watchlist mit Quelle Bitget')
gleich(standardAktien(LISTE, vorzug('binance', ALLE)).watchlist.map((w) => w.symbol), ['NVDAUSDT', 'TSLAUSDT'], 'Start-Watchlist mit Quelle Binance')

// ── Offene Positionen je Markt ───────────────────────────────────────────────
const N = baueKlassenNachschlag({ bitunix: ['NVDAUSDT'], bitget: ['NVDASTOCKUSDT'] })
const POS = [
    { id: 1, symbol: 'BTCUSDT', broker: 'bitunix' },
    { id: 2, symbol: 'NVDAUSDT', broker: 'bitunix' },
    { id: 3, symbol: 'NVDASTOCKUSDT', broker: 'bitget' },
    { id: 4, symbol: 'ETHUSDT', broker: 'bitget' },
]
gleich(teilePositionen(POS, 'krypto', N), { eigene: [POS[0], POS[3]], andere: 2 }, 'Krypto-Markt: Coins, Aktien gezählt')
gleich(teilePositionen(POS, 'aktien', N), { eigene: [POS[1], POS[2]], andere: 2 }, 'Aktien-Markt: Aktien, Coins gezählt')
gleich(teilePositionen(POS, '', N), { eigene: POS, andere: 0 }, 'Aktien-Teil aus: keine Trennung')
gleich(teilePositionen(POS, 'aktien', null), { eigene: POS, andere: 0 }, 'Stamm unbekannt: nichts verstecken')
gleich(teilePositionen(null, 'aktien', N), { eigene: [], andere: 0 }, 'keine Liste')
// Dasselbe Symbol an einer Börse ohne Listung ist keine Aktie
gleich(teilePositionen([{ symbol: 'NVDAUSDT', broker: 'pionex' }], 'aktien', N).eigene.length, 0, 'Börse ohne Listung: Krypto')
gleich([andererMarkt('aktien'), andererMarkt('krypto')], ['krypto', 'aktien'], 'der andere Markt')

// ── Alarme je Markt ──────────────────────────────────────────────────────────
gleich(alarmImMarkt({ anlageklasse: 'aktien' }, 'aktien'), true, 'Aktien-Alarm im Aktien-Markt')
gleich(alarmImMarkt({ anlageklasse: 'aktien' }, 'krypto'), false, 'Aktien-Alarm im Krypto-Markt')
gleich(alarmImMarkt({}, 'krypto'), true, 'Alarm ohne Angabe ist Krypto')
gleich(alarmImMarkt({ anlageklasse: null }, 'aktien'), false, 'Alarm ohne Angabe fehlt im Aktien-Markt')
gleich(alarmImMarkt({ anlageklasse: 'aktien' }, ''), true, 'ohne Markt (Aktien-Teil aus) zählen alle')

// ── Chart-Ebenen: Krypto-Ebenen ruhen bei Aktien ─────────────────────────────
gleich(overlaysFuer(false).map((o) => o.id), OVERLAYS.filter((o) => !o.nurAktien && !o.nurSymbole).map((o) => o.id), 'Coin: alles ausser den Aktien-Ebenen (und der Heatmap, die es nur bei BTC/ETH gibt)')
gleich(overlaysFuer(false, 'BTCUSDT').map((o) => o.id), ['positionen', 'journal', 'liquidationen', 'hebelzonen', 'orderbuch', 'buchPerp', 'buchSpot'], 'BTC: dazu die Orderbuch-Heatmap')
gleich(overlaysFuer(false).map((o) => o.id), ['positionen', 'journal', 'liquidationen', 'hebelzonen', 'orderbuch'], 'Coin: Ebenen wie vor den Aktien')
gleich(overlaysFuer(true).map((o) => o.id), ['positionen', 'journal', 'orderbuch', 'zahlen', 'sitzungen'], 'Aktie: ohne Liquidationen und Hebelzonen')
gleich([istNurKrypto('liquidationen'), istNurKrypto('hebelzonen'), istNurKrypto('orderbuch'), istNurKrypto('zahlen'), istNurKrypto('gibtsNicht')],
    [true, true, false, false, false], 'welche Ebenen nur Krypto sind')
gleich(overlayAn({ overlays: { liquidationen: true } }, 'liquidationen'), true, 'der gespeicherte Schalter bleibt, wie er ist (ChartPanel lässt ihn bei Aktien ruhen)')

// ── Strategien: Listen-Filter und Instanz-Zähler ─────────────────────────────
gleich([marktParams('aktien'), marktParams('krypto'), marktParams(''), marktParams(undefined)], [{ markt: 'aktien' }, { markt: 'krypto' }, {}, {}], 'Abfrage-Parameter')
const INST = [
    { id: 1, strategyId: 'lsob', anlageklasse: 'krypto' },
    { id: 2, strategyId: 'lsob', anlageklasse: 'aktien' },
    { id: 3, strategyId: 'lsob' },                                  // vor der Aktien-Integration angelegt
    { id: 4, strategyId: 'lsob', anlageklasse: 'aktien', archiviert: 1 },
    { id: 5, strategyId: 'ema_touch', anlageklasse: 'aktien' },
]
const ids = (z) => ({ eigene: z.eigene.map((i) => i.id), andere: z.andere.map((i) => i.id) })
gleich(ids(zaehleInstanzen(INST, 'lsob', 'krypto')), { eigene: [1, 3], andere: [2] }, 'Krypto-Markt: ohne Angabe zählt als Krypto, Archivierte fehlen')
gleich(ids(zaehleInstanzen(INST, 'lsob', 'aktien')), { eigene: [2], andere: [1, 3] }, 'Aktien-Markt')
gleich(ids(zaehleInstanzen(INST, 'lsob', '')), { eigene: [1, 2, 3], andere: [] }, 'Aktien-Teil aus: alle zusammen wie bisher')
gleich(ids(zaehleInstanzen(INST, 'gibtsNicht', 'aktien')), { eigene: [], andere: [] }, 'Strategie ohne Instanz')
gleich(ids(zaehleInstanzen(null, 'lsob', 'aktien')), { eigene: [], andere: [] }, 'keine Liste')
gleich([istAndererMarkt(INST[0], 'aktien'), istAndererMarkt(INST[1], 'aktien'), istAndererMarkt(INST[2], 'aktien'), istAndererMarkt(INST[1], '')],
    [true, false, true, false], 'anderer Markt')
// Krypto-Vorgaben unverändert
gleich(vorgabenFuer('krypto'), { markt: 'krypto', ...KRYPTO }, 'Krypto-Vorgaben')
gleich(KRYPTO.symbol, 'BTCUSDT', 'Krypto beginnt mit BTCUSDT')

console.log(`✓ Aktien-Trennung (Oberfläche): ${n} Prüfungen`)
