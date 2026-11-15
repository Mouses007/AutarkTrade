/** Selbsttest: Anlageklasse im Journal — Nachschlag aus dem Stamm, Regel je Trade, Filter. */
import { ordneNachBoerse, JOURNAL_BOERSEN } from './journal-klasse.js'
import { baueKlassenNachschlag, istAktienSymbol, klasseVonTrade } from '../../shared/anlageklasse.js'
import { erstelleFilter, baueNachschlag } from '../../src/utils/journal/filtern.js'

let ok = 0, fehler = 0
const pruefe = (text, bedingung, detail = '') => {
    if (bedingung) ok++
    else { fehler++; console.log(`  ✗ ${text}${detail ? ` — ${detail}` : ''}`) }
}

// --- Server: Zeilen des Stamms → Symbole je Börse -------------------------------
pruefe('leerer Stamm ist unbekannt, nicht «keine Aktien»', ordneNachBoerse([]) === null && ordneNachBoerse(null) === null)
const symbole = ordneNachBoerse([
    { handelsplatz: 'bitunix', symbol: 'NVDAUSDT' },
    { handelsplatz: 'bitunix', symbol: 'nvdausdt' },          // doppelt
    { handelsplatz: 'bitget', symbol: 'ACNSTOCKUSDT' },
    { handelsplatz: 'pionex', symbol: 'NVDAX_USDT' },
    { handelsplatz: 'binance', symbol: 'TSLAUSDT' },           // keine Journal-Börse
    { handelsplatz: 'bitpanda', symbol: 'AAPL' },
])
pruefe('nur Journal-Börsen', JSON.stringify(Object.keys(symbole)) === JSON.stringify(JOURNAL_BOERSEN))
pruefe('Doppelte fallen zusammen', symbole.bitunix.length === 1 && symbole.bitunix[0] === 'NVDAUSDT')

// --- Regel je Trade ----------------------------------------------------------------
const n = baueKlassenNachschlag(symbole)
pruefe('Aktien-Future der eigenen Börse', istAktienSymbol(n, 'bitunix', 'NVDAUSDT'))
pruefe('dasselbe Symbol an einer Börse ohne Listung ist keine Aktie', !istAktienSymbol(n, 'bitget', 'NVDAUSDT'))
pruefe('Bitget-Schreibweise mit STOCK und Endung', istAktienSymbol(n, 'bitget', 'ACNSTOCKUSDT_UMCBL'))
pruefe('Pionex-Token mit Trennzeichen', istAktienSymbol(n, 'pionex', 'NVDAX_USDT') && istAktienSymbol(n, 'pionex', 'NVDAXUSDT'))
pruefe('Coin bleibt Coin', !istAktienSymbol(n, 'bitunix', 'BTCUSDT'))
pruefe('ohne Stamm: nein', !istAktienSymbol(null, 'bitunix', 'NVDAUSDT') && baueKlassenNachschlag(null) === null)

const t = (broker, symbol, anlageklasse) => ({ broker, symbol, ...(anlageklasse ? { anlageklasse } : {}) })
pruefe('Vermerk «aktien» gilt ohne Stamm', klasseVonTrade(t('bitunix', 'XYZUSDT', 'aktien'), null) === 'aktien')
pruefe('alter Trade ohne Angabe wird über den Stamm Aktie', klasseVonTrade(t('bitunix', 'NVDAUSDT'), n) === 'aktien')
pruefe('alter Trade ohne Angabe und ohne Stamm ist Krypto', klasseVonTrade(t('bitunix', 'NVDAUSDT'), null) === 'krypto')
pruefe('Vermerk «krypto» sperrt die spätere Einordnung nicht', klasseVonTrade(t('bitunix', 'NVDAUSDT', 'krypto'), n) === 'aktien')
pruefe('Coin mit Vermerk «krypto»', klasseVonTrade(t('bitunix', 'BTCUSDT', 'krypto'), n) === 'krypto')

// --- Filter des Journals -----------------------------------------------------------
const leer = baueNachschlag({})
const basis = { boerse: '', kategorie: 'all', bereich: { start: 0, end: 0 }, richtungen: ['long', 'short'], konten: [], gewaehlteTags: ['t000t'] }
const trade = (symbol, mehr = {}) => ({ id: symbol, broker: 'bitunix', account: 'bitunix', td: 1, strategy: 'long', symbol, ...mehr })
const liste = [trade('NVDAUSDT'), trade('BTCUSDT'), trade('ETHUSDT', { botType: 'grid' }), trade('TSLAUSDT', { anlageklasse: 'aktien' })]
const zaehle = (anlageklasse, aktienSymbole) => liste.filter((x) => erstelleFilter({ ...basis, anlageklasse, aktienSymbole })(x, leer)).map((x) => x.symbol).join(',')
pruefe('ohne Filter alles', zaehle('', n) === 'NVDAUSDT,BTCUSDT,ETHUSDT,TSLAUSDT', zaehle('', n))
pruefe('nur Aktien', zaehle('aktien', n) === 'NVDAUSDT,TSLAUSDT', zaehle('aktien', n))
pruefe('nur Krypto (Bot zählt mit)', zaehle('krypto', n) === 'BTCUSDT,ETHUSDT', zaehle('krypto', n))
pruefe('nur Aktien ohne Stamm: nur der Vermerk', zaehle('aktien', null) === 'TSLAUSDT', zaehle('aktien', null))

console.log(`journal-klasse: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
