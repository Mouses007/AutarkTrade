/**
 * Selbsttest: Aktien im Chart (Suche, Symbol je Börse, Start-Vorgaben).
 *
 *   node src/utils/__selftest-aktien-symbole.mjs
 */
import assert from 'node:assert/strict'
import { symbolBei, vorzug, sucheintraege, sucheAktien, standardAktien } from './chart/aktienSymbole.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }

const liste = [
    { ticker: 'ACN', name: 'Accenture', unterart: 'aktie', symbole: { bitget: 'ACNSTOCKUSDT' }, spot: [] },
    { ticker: 'AMD', name: 'AMD', unterart: 'aktie', symbole: { binance: 'AMDUSDT', bitunix: 'AMDUSDT' }, spot: ['bitpanda'] },
    { ticker: 'NVDA', name: 'NVIDIA', unterart: 'aktie', symbole: { binance: 'NVDAUSDT', bitget: 'NVDAUSDT' }, spot: ['pionex'] },
    { ticker: 'SOXS', name: null, unterart: 'aktie', symbole: { binance: 'SOXSUSDT' }, spot: [] },
]

ok(vorzug('bitget', ['binance', 'bitunix', 'bitget']).join() === 'bitget,binance,bitunix', 'Vorgabe-Börse zuerst')
ok(symbolBei(liste[2], ['bitget', 'binance']).boerse === 'bitget', 'erste Börse der Reihenfolge gewinnt')
ok(symbolBei(liste[0], ['binance', 'bitget']).symbol === 'ACNSTOCKUSDT', 'Schreibweise der Börse, die den Titel führt')
ok(symbolBei(liste[3], ['bitunix', 'bitget']) === null && symbolBei(null, ['binance']) === null, 'nicht ladbar → null')

// Ohne Binance (Marktdatenquelle Bitget): nur was Bitunix/Bitget führen.
const ohneBinance = sucheintraege(liste, ['bitget', 'bitunix'])
ok(ohneBinance.map((s) => s.base).join() === 'ACN,AMD,NVDA', 'Titel ohne wählbare Börse fehlen')
ok(ohneBinance[1].boerse === 'bitunix' && ohneBinance[1].plaetze.join() === 'binance,bitunix,bitpanda', 'Börse und Handelsplätze')

const alle = sucheintraege(liste, ['binance', 'bitunix', 'bitget'])
ok(sucheAktien(alle, 'nv')[0].base === 'NVDA', 'Ticker-Anfang')
ok(sucheAktien(alle, 'accent')[0].base === 'ACN', 'Name')
ok(sucheAktien(alle, 'A').map((s) => s.base).join() === 'ACN,AMD,NVDA', 'Ticker-Anfang vor Name (NVIDIA enthält A)')
ok(sucheAktien(alle, 'AMD')[0].rang === 0 && sucheAktien(alle, 'zzz').length === 0, 'genauer Treffer, kein Treffer')
ok(sucheAktien(alle, '').length === 4, 'leere Frage zeigt alles')

const start = standardAktien(liste, ['binance', 'bitget'])
ok(start.panel.symbol === 'NVDAUSDT' && start.panel.boerse === 'binance', 'Start-Panel: erster ladbarer Standard-Titel')
ok(start.watchlist.length === 1 && start.watchlist[0].markt === 'futures', 'Watchlist nur aus ladbaren Standard-Titeln')
const leer = standardAktien([], ['bitunix'])
ok(leer.panel.symbol === 'NVDAUSDT' && leer.panel.boerse === 'bitunix' && leer.watchlist.length === 1, 'ohne Stamm: NVDAUSDT an der Vorgabe-Börse')

console.log(`✓ Aktien im Chart: ${n} Prüfungen`)
