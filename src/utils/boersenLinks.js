/**
 * Verlinkung eines Coins zu einer externen Handelsseite oder zum eigenen Chart.
 *
 * Seit 20.10.2026 führt der Schlüssel `tradingview` (Name bleibt wegen der
 * gespeicherten Einstellung `boersenLinks`) NICHT mehr zu TradingView, sondern
 * in den Chart-Arbeitsplatz der App: `/chart?symbol=…` öffnet das Symbol im
 * aktiven Panel (`Chart.vue`, `uebernimmSymbolAusAdresse`). Die Abschnitte unten
 * beschreiben, warum dabei eine Quelle mitgeht: wo Binance ein Paar nicht führt,
 * lädt der Chart es von Bitunix.
 *
 * Vorher an drei Stellen unabhängig dupliziert (CoinRadar.vue, KachelRsi.vue,
 * KachelMarkt.vue) — hier EINE Quelle, damit ein neues Börsen-Kürzel oder eine
 * geänderte URL nicht an mehreren Stellen nachgezogen werden muss.
 *
 * Pionex hat ein eigenes Symbol-Schema, weil die Handelsseite nicht das rohe
 * Bitunix/Bitget-Symbol (z. B. `BTCUSDT`) versteht, sondern `BASIS.PERP_USDT`
 * (z. B. `BTC.PERP_USDT`) — das `USDT`-Suffix und ein führendes `1000...`
 * (Meme-Coins mit vielen Nullen) müssen dafür weg.
 *
 * TradingView bekommt KEINE Listungsprüfung wie die drei Börsen: die Coins in
 * Coin-Radar-Rangliste/Hype-Radar/RSI-Kachel/Markt-Kachel kommen aus Binances
 * USDⓈ-M-FUTURES (`nurCoinSymbole()`/`getClosedCandles(..., {market:'futures'})`
 * in server/marktradar-api.js bzw. server/market-data.js) — ein Perpetual-Chart
 * existiert dafür also immer.
 *
 * ⚠ Diese Annahme gilt seit der Coin-Radar-EINZELPRÜFUNG nicht mehr überall.
 * Sie misst auch Paare, die Binance gar nicht führt (gemessen 04.09.2026: 291
 * der 790 Bitunix-Perpetuals), und für die gibt es dort auch keinen Chart.
 * Live geprüft: `BINANCE:CASHCATUSDT.P` antwortet mit „This symbol doesn't
 * exist", `BITUNIX:CASHCATUSDT.P` lädt. Deshalb nimmt `tradingview` eine
 * QUELLE entgegen — wer von Bitunix gemessen hat, verlinkt auch dorthin.
 * Vorgabe bleibt BINANCE, damit alle bestehenden Aufrufer unverändert
 * funktionieren. Das `.P`-Suffix ist hier PFLICHT: ohne ihn löst
 * TradingView den SPOT-Markt auf, und der existiert nicht zwingend — Monero
 * z.B. ist bei Binance nur noch als Future gelistet, nicht mehr als Spot-Paar.
 * `1000PEPEUSDT` als Futures-Symbol hat ohne `.P` ebenfalls keine Entsprechung,
 * weil es dort gar keinen Spot-Markt mit diesem Namen gibt. Live geprüft am
 * 02.09.2026: `BINANCE:XMRUSDT.P` und `BINANCE:1000PEPEUSDT.P` laden beide,
 * die Varianten ohne `.P` beide nicht.
 */
/*
 * Bitunix am Handy: Die App übernimmt von bitunix.com NUR `/u-link/*` (so in
 * apple-app-site-association und am 22.10.2026 auf Android mit „Bitunix Pro"
 * getestet). `/contract-trade/…` öffnete immer den Browser. Ein u-link öffnet die
 * App, aber auf dem zuletzt gezeigten Chart: zwölf Schreibweisen mit ETHUSDT
 * landeten alle auf BTC. Der Nutzer wollte die App trotzdem. Das Symbol steht im
 * Pfad, falls Bitunix es eines Tages auswertet. Bitget und Pionex starteten aus
 * dem Browser gar keine App, sie bleiben bei der Webseite.
 */
const mobilesGeraet = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')

export function bitunixUrl(s, mobil = mobilesGeraet()) {
    return mobil ? `https://www.bitunix.com/u-link/contract-trade/${s}` : `https://www.bitunix.com/contract-trade/${s}`
}

export const BOERSE_URL = {
    bitunix: (s) => bitunixUrl(s),
    bitget: (s) => `https://www.bitget.com/futures/usdt/${s}`,
    pionex: (s) => `https://www.pionex.com/en/futures/${s.replace(/USDT$/, '').replace(/^1000+/, '')}.PERP_USDT/Manual`,
    tradingview: (s, quelle) => {
        const q = String(quelle || '').toLowerCase()
        return `/chart?symbol=${encodeURIComponent(s)}${q && q !== 'binance' ? `&boerse=${encodeURIComponent(q)}` : ''}`
    },
}

export const BOERSE_KURZ = { bitunix: 'BX', bitget: 'BG', pionex: 'PX', tradingview: 'CH' }
export const BOERSE_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex', tradingview: 'Chart' }

/** Kanonische Reihenfolge — bestimmt sowohl die Anzeige-Reihenfolge als auch die CSV-Schreibreihenfolge der Einstellung. */
export const BOERSE_SCHLUESSEL = ['bitunix', 'bitget', 'pionex', 'tradingview']

/**
 * @param {string} boerse   Schlüssel aus `BOERSE_SCHLUESSEL`
 * @param {string} symbol   Handelssymbol, z. B. `CASHCATUSDT`
 * @param {string} [quelle] nur für `tradingview`: Datenquelle des Charts
 *                          (`BINANCE` als Vorgabe, `BITUNIX` für Paare, die
 *                          Binance nicht führt — siehe Kopf)
 */
export function boerseUrl(boerse, symbol, quelle) {
    return BOERSE_URL[boerse]?.(symbol, quelle) || null
}

/**
 * CSV aus den Settings (`appEinstellungen.value.boersenLinks`) → gültiges Array.
 *
 * Leer oder komplett unbekannt heisst "alles an", nicht "nichts an" — sonst
 * würde eine noch nicht geladene Einstellung (z. B. während `appEinstellungen` noch
 * lädt) sämtliche Links verschwinden lassen, obwohl niemand das gewählt hat.
 */
export function aktivierteBoersen(csv) {
    const gewaehlt = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean)
    const gefiltert = BOERSE_SCHLUESSEL.filter((b) => gewaehlt.includes(b))
    return gefiltert.length ? gefiltert : BOERSE_SCHLUESSEL
}

/**
 * Verlinkbare Börsen einer Coin-Radar-Zeile: gelistete ∩ aktivierte, plus TradingView.
 *
 * `csv` kommt von aussen (`appEinstellungen.value?.boersenLinks`) statt aus einem
 * Store-Import, damit dieses Modul frei von Vue-Abhängigkeiten bleibt — es wird
 * auch aus reinen Hilfsfunktionen heraus benutzt.
 *
 * Fehlt `boersen` ganz (ältere Läufe, bevor die Listung mitgeschrieben wurde),
 * bleibt TradingView übrig: ein Perpetual-Chart existiert für jeden Coin hier,
 * die Börsenlistung dagegen ist dann schlicht unbekannt.
 */
export function boersenLinksVon(zeile, csv) {
    const aktiv = aktivierteBoersen(csv)
    const liste = Array.isArray(zeile?.boersen?.liste) ? zeile.boersen.liste : []
    const geliste = liste.filter((e) => aktiv.includes(e.boerse))
    return aktiv.includes('tradingview') ? [...geliste, { boerse: 'tradingview' }] : geliste
}

/*
 * Handelsseiten der Börsen, die der Börsen-Beobachter (Hype-Radar → Börsen)
 * führt — Spot, gegen USDT bzw. die Hauswährung der Börse. Geprüft am
 * 12.10.2026 mit SOL: Binance, Bybit, Kraken, Bitget und Gate öffnen das
 * Paar; Coinbase verlangt für die Handelsseite eine Anmeldung (sonst
 * Umleitung auf die Marktübersicht); KuCoin war aus dem Netz der Entwicklung
 * nicht erreichbar, das Muster ist das dokumentierte. Reine Links, keine
 * Logos (Verkaufs-Prüfung Z. 13). Upbit, OKX, MEXC und Binance Alpha beobachtet
 * der Radar seit S12 nicht mehr — ihre Links sind mit ihnen gegangen.
 *
 * S15: Mit dem Schalter „Quellen ohne Verkaufsfreigabe" sind sie zurück
 * (`LISTUNG_URL_OHNE_FREIGABE`, am 12.10.2026 mit SOL geprüft: Upbit, OKX und
 * MEXC öffnen das Paar). Binance Alpha hat keine Seite je Kürzel — dort führt
 * der Vertrag (DexScreener). Wer `listungUrl` aufruft, sagt mit
 * `ohneFreigabe`, ob der Schalter an ist (`freigabeAn()` aus
 * `quellenFreigabe.js`); Vorgabe ist an, wie der Schalter selbst.
 */
export const LISTUNG_URL = {
    'binance-spot': (s) => `https://www.binance.com/en/trade/${s}_USDT?type=spot`,
    'binance-futures': (s) => `https://www.binance.com/en/futures/${s}USDT`,
    coinbase: (s) => `https://www.coinbase.com/advanced-trade/spot/${s}-USD`,
    bybit: (s) => `https://www.bybit.com/en/trade/spot/${s}/USDT`,
    kraken: (s) => `https://pro.kraken.com/app/trade/${s.toLowerCase()}-usd`,
    kucoin: (s) => `https://www.kucoin.com/trade/${s}-USDT`,
    gate: (s) => `https://www.gate.com/trade/${s}_USDT`,
    bitget: (s) => `https://www.bitget.com/spot/${s}USDT`,
}

/** Nur mit dem Schalter „Quellen ohne Verkaufsfreigabe" (S15, IDs upbit/okx/mexc). */
export const LISTUNG_URL_OHNE_FREIGABE = {
    upbit: (s) => `https://upbit.com/exchange?code=CRIX.UPBIT.KRW-${s}`,
    okx: (s) => `https://www.okx.com/trade-spot/${s.toLowerCase()}-usdt`,
    mexc: (s) => `https://www.mexc.com/exchange/${s}_USDT`,
}

/** Handelsseite eines Kürzels auf einer beobachteten Börse; Alpha (Schalter an) nur mit Vertrag. */
export function listungUrl(boerse, symbol, { chain = '', contract = '', ohneFreigabe = true } = {}) {
    const s = String(symbol || '').trim().toUpperCase()
    if (!s) return null
    if (boerse === 'binance-alpha') {
        return ohneFreigabe && contract ? `https://dexscreener.com/${encodeURIComponent(chain || 'bsc')}/${encodeURIComponent(contract)}` : null
    }
    const muster = LISTUNG_URL[boerse] || (ohneFreigabe ? LISTUNG_URL_OHNE_FREIGABE[boerse] : null)
    return muster?.(encodeURIComponent(s)) || null
}

/** CoinGecko-Suche nach einem Kürzel — für alles, was keine Börse führt. */
export const coingeckoSuche = (symbol) => `https://www.coingecko.com/en/search?query=${encodeURIComponent(String(symbol || '').trim())}`
