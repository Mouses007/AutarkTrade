/**
 * Selbsttest: Börsen-Beobachter (die reine Rechnung).
 *
 * Ohne Netz. Die wichtigste Richtung ist die Gegenprobe: Eine halbe Antwort
 * darf keine Flut „neuer" Listungen erzeugen, und ein Namensvetter darf nicht
 * als „rechtzeitig erkannt" zählen — beides würde die Vorlaufstatistik schönen.
 *
 * Aufruf: node server/hype-radar/__selftest-boersenwacht.mjs
 */
import {
    LESER, basisAusPaar, kuerzel, neueEintraege, ordneZu, leiterFuer, vorlaufStatistik,
    MAX_NEU_JE_ABRUF, MIN_BEWERTUNG_KUERZEL, STARTS, auchGelistetAuf, BOERSEN, ALLE_BOERSEN, boersenFuer,
} from './boersenwacht-bewertung.js'
import { QUELLEN, boerseAn } from './boersenwacht.js'
import { VORGABEN, vorgabenFuer } from './einstellungen.js'
import { readFileSync } from 'node:fs'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Börsen-Beobachter')

// ── Kürzel ──────────────────────────────────────────────────────────────
p('Paar ohne Trenner: USDT ab', basisAusPaar('PEPEUSDT') === 'PEPE')
p('FDUSD vor USD', basisAusPaar('WIFFDUSD') === 'WIF')
p('USDC als Basis bleibt', basisAusPaar('USDCUSDT') === 'USDC')
p('Futures-Vielfaches fällt weg', kuerzel('1000PEPE') === 'PEPE' && kuerzel('1MBABYDOGE') === 'BABYDOGE')
p('nur Gegenwährung ist keine Basis', basisAusPaar('USDT') === '')

// ── Parser ──────────────────────────────────────────────────────────────
p('Binance Spot', LESER['binance-spot']([{ symbol: 'PEPEUSDT' }, { symbol: 'PEPEFDUSD' }, { symbol: 'BTCUSDT' }]).join() === 'BTC,PEPE')
p('Coinbase: nur online und handelbar',
    LESER.coinbase([{ base_currency: 'ABC', status: 'online' }, { base_currency: 'OFF', status: 'delisted' },
        { base_currency: 'HALT', status: 'online', trading_disabled: true }]).join() === 'ABC')
p('Kraken: XBT ist BTC', LESER.kraken({ result: { XXBTZUSD: { wsname: 'XBT/USD' }, ABCUSD: { wsname: 'ABC/USD' } } }).join() === 'ABC,BTC')
p('Bybit', LESER.bybit({ result: { list: [{ baseCoin: 'A', status: 'Trading' }] } }).join() === 'A')
p('KuCoin: nur handelbar', LESER.kucoin({ data: [{ baseCurrency: 'A', enableTrading: true }, { baseCurrency: 'B', enableTrading: false }] }).join() === 'A')
p('fremde Form ergibt eine leere Liste', LESER.bybit({ fehler: 1 }).length === 0 && LESER.coinbase(null).length === 0)

// ── Schalter „Quellen ohne Verkaufsfreigabe" AUS (Stand S12) ─────────────
{
    const liste = boersenFuer(false)
    const ids = liste.map((b) => b.id)
    p('Schalter aus: Upbit, OKX, MEXC und Binance Alpha werden nicht beobachtet',
        liste === BOERSEN && !['upbit', 'okx', 'mexc', 'binance-alpha'].some((id) => ids.includes(id)))
    p('Schalter aus: keine Sprosse „Alpha"', !liste.some((b) => b.stufe === 'alpha'))
    p('keine Binance-Adresse im Börsen-Beobachter', !Object.values(QUELLEN).some((u) => /binance/i.test(u))
        && !/binance\.com/.test(readFileSync(new URL('./boersenwacht.js', import.meta.url), 'utf8')))
    p('jede Börse hat einen Leser', ALLE_BOERSEN.every((b) => typeof LESER[b.id] === 'function'))
    const vorgabe = { boersenwachtBoersen: vorgabenFuer(false).boersenwachtBoersen }
    p('Schalter aus: Coinbase, Kraken, KuCoin und Gate ab Werk aus',
        ['coinbase', 'kraken', 'kucoin', 'gate'].every((id) => !boerseAn(vorgabe, id)))
    p('Schalter aus: Binance, Bybit und Bitget ab Werk an',
        ['binance-spot', 'binance-futures', 'bybit', 'bitget'].every((id) => boerseAn(vorgabe, id)))
    p('Schalter aus: jede Börse hat eine Vorgabe', ids.every((id) => id in VORGABEN.boersenwachtBoersen))
}
// ── Schalter AN (S15, wie vor S12) ──────────────────────────────────────
{
    const liste = boersenFuer(true)
    const ids = liste.map((b) => b.id)
    p('Schalter an: alle Börsen wie vor S12', liste === ALLE_BOERSEN
        && ['upbit', 'okx', 'mexc', 'binance-alpha'].every((id) => ids.includes(id) && (id in QUELLEN || id === 'binance-alpha')))
    p('Schalter an: Freigabe-ID je Börse ohne Freigabe',
        liste.filter((b) => b.freigabe).map((b) => b.freigabe).sort().join() === 'binanceAlpha,mexc,okx,upbit')
    const vorgabe = { boersenwachtBoersen: vorgabenFuer(true).boersenwachtBoersen }
    p('Schalter an: Coinbase, Kraken, KuCoin und Gate ab Werk an',
        ['coinbase', 'kraken', 'kucoin', 'gate'].every((id) => boerseAn(vorgabe, id)))
    p('Schalter an: jede Börse hat eine Vorgabe', ids.every((id) => vorgabe.boersenwachtBoersen[id] === true))
    p('Upbit: Markt KRW-XYZ', LESER.upbit([{ market: 'KRW-XYZ' }, { market: 'BTC-XYZ' }]).join() === 'XYZ')
    p('OKX: nur live', LESER.okx({ data: [{ baseCcy: 'A', state: 'live' }, { baseCcy: 'B', state: 'suspend' }] }).join() === 'A')
    p('MEXC: Paarnamen', LESER.mexc({ data: ['ABCUSDT', 'XYZUSDC'] }).join() === 'ABC,XYZ')
    p('OKX: fremde Form ergibt eine leere Liste', LESER.okx({ fehler: 1 }).length === 0)
}
const alpha = LESER['binance-alpha']({ data: [
    { symbol: 'FOO', chainId: 'CT_501', contractAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump' },
    { symbol: 'BAR', chainId: '56', contractAddress: '0xABC0000000000000000000000000000000000001' },
] })
p('Alpha: Kette und Vertrag', alpha.length === 2 && alpha.some((a) => a.chain === 'solana' && a.contract.endsWith('pump'))
    && alpha.some((a) => a.chain === 'bsc' && a.contract === '0xabc0000000000000000000000000000000000001'))

// ── Neue Listungen ──────────────────────────────────────────────────────
const alt = Array.from({ length: 100 }, (_, i) => `C${i}`)
p('erster Abruf: Grundlinie, nichts neu', neueEintraege([], alt).neu.length === 0 && neueEintraege([], alt).uebernehmen)
p('neue erkannt', neueEintraege(alt, [...alt, 'NEU']).neu.join() === 'NEU')
p('halbe Antwort: nichts neu, alter Stand bleibt', !neueEintraege(alt, alt.slice(0, 50)).uebernehmen)
p('leere Antwort: alter Stand bleibt', !neueEintraege(alt, []).uebernehmen)
const flut = neueEintraege(alt, [...alt, ...Array.from({ length: MAX_NEU_JE_ABRUF + 1 }, (_, i) => `X${i}`)])
p('Flut: Grundlinie neu, keine Ereignisse', flut.uebernehmen && flut.neu.length === 0)
p('Alpha nach Schlüssel', neueEintraege(alpha.slice(0, 1).concat(alt.map((a) => ({ schluessel: a }))),
    alpha.concat(alt.map((a) => ({ schluessel: a })))).neu.length === 1)

// ── Zuordnung ───────────────────────────────────────────────────────────
const tag = 86400e3
const wissen = [
    { symbol: 'FOO', chain: 'solana', contract: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump', ersterBlick: 1000, ersteMeldung: 2000, quelle: 'frueh', bewertungUsd: 200000 },
    { symbol: 'BIG', chain: 'base', contract: '0xb', ersterBlick: 4 * tag, ersteMeldung: 5 * tag, quelle: 'scan', bewertungUsd: MIN_BEWERTUNG_KUERZEL * 4 },
    { symbol: 'BIG', chain: 'base', contract: '0xc', ersterBlick: 2 * tag, ersteMeldung: null, quelle: 'frueh', bewertungUsd: 900000 },
    { symbol: 'TINY', chain: 'solana', contract: 'T1', ersterBlick: 3 * tag, ersteMeldung: null, quelle: 'frueh', bewertungUsd: 40000 },
]
const v = ordneZu({ symbol: 'FOO', chain: 'solana', contract: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump' }, wissen)
p('Vertrag: sicherer Treffer, auch klein', v.treffer === 'vertrag' && v.radarSeit === 2000 && v.radarGesehen === 1000)
const k = ordneZu({ symbol: 'BIG' }, wissen)
p('Kürzel: Treffer ab Listungsgrösse', k.treffer === 'kuerzel' && k.radarSeit === 5 * tag && k.radarGesehen === 4 * tag, JSON.stringify(k))
const nurGesehen = ordneZu({ symbol: 'TINY' }, wissen)
p('nur gesehen, nie gemeldet: kein Vorlauf', nurGesehen.radarSeit === null && nurGesehen.radarGesehen === 3 * tag)
p('Kürzel eines Kleinen: Namensvetter', ordneZu({ symbol: 'TINY' }, wissen).treffer === 'namensgleich')
p('unbekannt: kein Treffer', ordneZu({ symbol: 'NOPE' }, wissen).treffer === '')

// ── Leiter ──────────────────────────────────────────────────────────────
const staende = new Map([
    ['binance-alpha', new Set(['solana|7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump'])],   // Altbestand bis S12
    ['gate', new Set(['FOO', 'BIG'])],
    ['coinbase', new Set(['BIG'])],
])
const l1 = leiterFuer({ symbol: 'FOO', chain: 'solana', contract: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump', bewertungUsd: 200000 }, staende, BOERSEN)
p('Schalter aus — Leiter: ein liegengebliebener Alpha-Stand zählt nicht', !('alpha' in l1))
p('Leiter: kleiner Token zählt nicht über das Kürzel', l1.mittel.length === 0)
const l2 = leiterFuer({ symbol: 'BIG', chain: 'base', contract: '0xb', bewertungUsd: MIN_BEWERTUNG_KUERZEL * 2 }, staende, BOERSEN)
p('Leiter: grosser Token über das Kürzel', l2.mittel.join() === 'Gate' && l2.gross.join() === 'Coinbase')
{
    // Schalter an (S15): wie vor S12.
    const st = new Map([...staende, ['mexc', new Set(['BIG'])]])
    const a1 = leiterFuer({ symbol: 'FOO', chain: 'solana', contract: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJospump', bewertungUsd: 200000 }, st, ALLE_BOERSEN)
    p('Schalter an — Leiter: Alpha über den Vertrag', a1.alpha === true)
    const a2 = leiterFuer({ symbol: 'BIG', chain: 'base', contract: '0xb', bewertungUsd: MIN_BEWERTUNG_KUERZEL * 2 }, st, ALLE_BOERSEN)
    p('Schalter an — Leiter: MEXC zählt mit', a2.mittel.join() === 'Gate,MEXC' && a2.alpha === false, JSON.stringify(a2))
}

// ── Vorlauf ─────────────────────────────────────────────────────────────
const T0 = 1790000000000
const s = vorlaufStatistik([
    { boerse: 'coinbase', treffer: 'kuerzel', radarSeit: T0, gesehenAm: T0 + 4 * tag },
    { boerse: 'binance-spot', treffer: 'vertrag', radarSeit: T0 + tag, gesehenAm: T0 + 3 * tag },
    { boerse: 'bybit', treffer: 'namensgleich', radarSeit: T0, gesehenAm: T0 + 9 * tag },
    { boerse: 'bybit', treffer: '', radarSeit: null, gesehenAm: T0 + 9 * tag },
    { boerse: 'gate', treffer: 'kuerzel', radarSeit: T0 + 10 * tag, gesehenAm: T0 + 9 * tag },   // nach dem Listing gesehen
    { boerse: 'okx', treffer: 'kuerzel', radarSeit: T0, gesehenAm: T0 + 2 * tag },   // Börse ohne Freigabe: zählt mit Schalter aus nicht
], BOERSEN)
p('Vorlauf: Namensvetter zählen nicht', s.gross.neu === 4 && s.gross.erkannt === 2)
p('Vorlauf: Median in Tagen', s.gross.medianVorlaufTage === 3, String(s.gross.medianVorlaufTage))
p('Vorlauf: erst nach dem Listing gesehen ist kein Vorlauf', s.mittel.erkannt === 0)
p('Schalter aus: keine Sprosse „alpha" in der Statistik', !('alpha' in s))
{
    // Schalter an (S15): wie vor S12 — OKX zählt, Alpha hat eine eigene Sprosse.
    const s2 = vorlaufStatistik([
        { boerse: 'coinbase', treffer: 'kuerzel', radarSeit: T0, gesehenAm: T0 + 4 * tag },
        { boerse: 'binance-spot', treffer: 'vertrag', radarSeit: T0 + tag, gesehenAm: T0 + 3 * tag },
        { boerse: 'okx', treffer: 'namensgleich', radarSeit: T0, gesehenAm: T0 + 9 * tag },
        { boerse: 'okx', treffer: '', radarSeit: null, gesehenAm: T0 + 9 * tag },
        { boerse: 'mexc', treffer: 'kuerzel', radarSeit: T0 + 10 * tag, gesehenAm: T0 + 9 * tag },
        { boerse: 'binance-alpha', treffer: 'vertrag', radarSeit: T0, gesehenAm: T0 + tag },
    ], ALLE_BOERSEN)
    p('Schalter an — Vorlauf: Namensvetter zählen nicht', s2.gross.neu === 4 && s2.gross.erkannt === 2)
    p('Schalter an — Vorlauf: Median in Tagen', s2.gross.medianVorlaufTage === 3, String(s2.gross.medianVorlaufTage))
    p('Schalter an — Vorlauf: MEXC erst nach dem Listing gesehen', s2.mittel.neu === 1 && s2.mittel.erkannt === 0)
    p('Schalter an — Vorlauf: Alpha als eigene Sprosse', s2.alpha?.neu === 1 && s2.alpha.medianVorlaufTage === 1)
}

// ── Handelsstart (Formen der Live-Antworten vom 12.10.2026) ──────────────
{
    const J = Date.UTC(2026, 9, 12, 9)
    const bf = { symbols: [
        { symbol: 'AKAMUSDT', status: 'TRADING', onboardDate: Date.UTC(2026, 9, 6, 9, 15) },
        { symbol: 'GAIBUSDT', status: 'PENDING_TRADING', onboardDate: Date.UTC(2026, 10, 20, 9) },
        // Live-Fund 12.10.2026: seit fast einem Jahr „ausstehend" — keine Ankündigung
        { symbol: 'LEICHEUSDT', status: 'PENDING_TRADING', onboardDate: Date.UTC(2025, 10, 20, 9) },
        { symbol: 'OLDUSDT', status: 'SETTLING', onboardDate: Date.UTC(2023, 0, 1) },
    ] }
    p('Binance Futures aus exchangeInfo: nur TRADING ist gelistet', LESER['binance-futures'](bf).join() === 'AKAM')
    p('Binance Futures: alte ticker/price-Form geht weiter', LESER['binance-futures']([{ symbol: 'PEPEUSDT' }]).join() === 'PEPE')
    const sbf = STARTS['binance-futures'](bf, J)
    p('Binance Futures: Start eines handelnden Kontrakts', sbf.laufend.get('AKAM') === Date.UTC(2026, 9, 6, 9, 15))
    p('Binance Futures: PENDING_TRADING ist angekündigt, mit Start',
        sbf.angekuendigt.length === 1 && sbf.angekuendigt[0].symbol === 'GAIB' && sbf.angekuendigt[0].start === Date.UTC(2026, 10, 20, 9))
    p('Binance Futures: Start vor fast einem Jahr, immer noch ausstehend: keine Ankündigung', !sbf.angekuendigt.some((x) => x.symbol === 'LEICHE'))
    p('… wohl aber ein Start, der erst gestern verstrich', STARTS['binance-futures']({ symbols: [{ symbol: 'SPAETUSDT', status: 'PENDING_TRADING', onboardDate: J - 86400e3 }] }, J).angekuendigt.length === 1)
    p('Binance Futures: SETTLING ist weder offen noch angekündigt', !sbf.laufend.has('OLD') && !sbf.angekuendigt.some((x) => x.symbol === 'OLD'))

    // OKX (S15, nur mit Schalter an beobachtet) — der Leser selbst ist rein.
    const okx = STARTS.okx({ data: [
        { baseCcy: 'XINFQ', state: 'preopen', listTime: String(Date.UTC(2026, 9, 12, 9, 30)) },
        { baseCcy: 'BTC', state: 'live', listTime: '1548133413000' },
        { baseCcy: 'BTC', state: 'preopen', listTime: String(J + 3600e3) },   // neues Paar eines laufenden Coins
    ] }, J)
    p('OKX: preopen ist angekündigt', okx.angekuendigt.map((x) => x.symbol).join() === 'XINFQ')
    p('OKX: ein neues Paar eines laufenden Coins ist nicht angekündigt', !okx.angekuendigt.some((x) => x.symbol === 'BTC'))
    p('OKX: Start laufend in ms', okx.laufend.get('BTC') === 1548133413000)

    const gate = STARTS.gate([
        { base: 'CENT', trade_status: 'sellable', buy_start: Math.floor((J + 1800e3) / 1000) },
        { base: 'MSP', trade_status: 'tradable', buy_start: Math.floor(Date.UTC(2026, 9, 7, 6) / 1000) },
        { base: 'DEAD', trade_status: 'untradable', buy_start: 1600000000 },
        { base: 'NULL', trade_status: 'tradable', buy_start: 0 },
    ], J)
    p('Gate: Sekunden werden ms', gate.laufend.get('MSP') === Date.UTC(2026, 9, 7, 6))
    p('Gate: sellable mit Start in der Zukunft ist angekündigt', gate.angekuendigt.map((x) => x.symbol).join() === 'CENT')
    p('Gate: untradable mit altem Start ist abgekündigt, nicht angekündigt', !gate.angekuendigt.some((x) => x.symbol === 'DEAD'))
    p('Gate: Start 0 ist kein Datum', !gate.laufend.has('NULL'))

    const bg = STARTS.bitget({ data: [
        { baseCoin: 'RETHA', status: 'online', openTime: String(Date.UTC(2026, 9, 6, 13, 33)) },
        { baseCoin: 'SOON', status: 'online', openTime: String(J + 86400e3) },
    ] }, J)
    p('Bitget: openTime eines offenen Paars', bg.laufend.get('RETHA') === Date.UTC(2026, 9, 6, 13, 33))
    p('Bitget: Start in der Zukunft ist angekündigt, nicht offen', bg.angekuendigt[0]?.symbol === 'SOON' && !bg.laufend.has('SOON'))
}

// ── Auch gelistet auf ───────────────────────────────────────────────────
{
    const staende = new Map([
        ['kucoin', new Set(['DRV', 'QI'])],
        ['gate', new Set(['QI'])],
        ['bybit', new Set(['DRV'])],
        ['binance-alpha', new Set(['bsc|0xabc', 'sym|ZED'])],   // Altbestand bis S12
    ])
    p('andere Börsen mit demselben Kürzel', auchGelistetAuf({ boerse: 'kucoin', symbol: 'qi' }, staende).join() === 'Gate')
    p('die eigene Börse zählt nicht', auchGelistetAuf({ boerse: 'bybit', symbol: 'DRV' }, staende).join() === 'KuCoin')
    p('Schalter aus: ein liegengebliebener Alpha-Stand zählt nicht',
        auchGelistetAuf({ boerse: 'kucoin', symbol: 'ZED', chain: 'bsc', contract: '0xABC' }, staende, BOERSEN).length === 0)
    p('nirgends sonst: leer', auchGelistetAuf({ boerse: 'kucoin', symbol: 'NEU' }, staende).length === 0)
    // Schalter an (S15): wie vor S12.
    const st = new Map([['mexc', new Set(['DRV', 'QI'])], ['gate', new Set(['QI'])], ['okx', new Set(['DRV'])],
        ['binance-alpha', new Set(['bsc|0xabc', 'sym|ZED'])]])
    p('Schalter an: die eigene Börse zählt nicht', auchGelistetAuf({ boerse: 'okx', symbol: 'DRV' }, st, ALLE_BOERSEN).join() === 'MEXC')
    p('Schalter an: Alpha über den Vertrag',
        auchGelistetAuf({ boerse: 'mexc', symbol: 'X', chain: 'bsc', contract: '0xABC' }, st, ALLE_BOERSEN).join() === 'Binance Alpha')
    p('Schalter an: Alpha ohne Vertrag nur über sym|', auchGelistetAuf({ boerse: 'mexc', symbol: 'ZED' }, st, ALLE_BOERSEN).join() === 'Binance Alpha')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
