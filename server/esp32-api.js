/**
 * ESP32 Display API
 *
 * Provides a read-only endpoint for the ESP32-2432S028 (CYD) to display
 * AutarkTrade data on its TFT screen.
 *
 * Auth: Static API key stored encrypted in settings.esp32ApiKey
 * Header: X-ESP32-Key: <plaintext-key>
 *
 * Zwei Schlüssel (Audit SEC-GER-001, 26.10.2026):
 *   - Hauptschlüssel `esp32ApiKey` — Handy-App/Widget: display, alarme, push.
 *   - Anzeige-Schlüssel `esp32AnzeigeKey` — ESP32-Displays: NUR display.
 * Ein Display steht offen im Raum, sein Schlüssel liegt im Flash und geht
 * im Klartext über HTTP. Mit ihm soll man höchstens die Anzeige lesen, nicht
 * die Alarmliste oder ein eigenes Push-Gerät eintragen. Der Hauptschlüssel
 * gilt weiter auch für display (alte Firmware).
 *
 * Public endpoints (no session required):
 *   GET /api/esp32/display
 *   GET /api/esp32/alarme?seit=<ms>&arten=…   Auslösungen der Chart-Alarme (Android-Widget)
 *   POST/DELETE /api/esp32/push                Sofort-Zustellung per UnifiedPush an-/abmelden
 *   GET /api/esp32/ca                          CA-Zertifikat {pem, sha256} (ohne Schlüssel,
 *                                              registriert in server/tls/dienst.js)
 *
 * Admin endpoints (behind session auth, via setupEsp32AdminRoutes):
 *   GET    /api/esp32/settings  — key presence flags (Haupt- und Anzeige-Schlüssel)
 *   POST   /api/esp32/settings  — generate or set key (von Hand: ≥ 32 Zeichen);
 *                                 `art: 'anzeige'` erzeugt den Anzeige-Schlüssel
 *   DELETE /api/esp32/key       — clear key (`?art=anzeige`: den Anzeige-Schlüssel)
 *   GET    /api/esp32/geraete        — eingetragene Push-Geräte (ohne Schlüssel)
 *   DELETE /api/esp32/geraete/:id    — ein Push-Gerät austragen
 */
import crypto from 'crypto'
import { getKnex } from './database.js'
import { zeitzoneAus } from '../shared/zeitzone.js'
import { encrypt, decrypt } from './crypto.js'
import { getPendingPositions } from './bitunix-api.js'
import { getCurrentPositions as getBitgetCurrentPositions } from './bitget-api.js'
import { getRunningBotPositions } from './pionex-api.js'
import { ausCache } from './marktradar-api.js'
import { ausloesungenAus, leseArten } from './esp32-alarme.js'
import { pruefeGeraet, mitGeraet, ohneGeraet, ladeGeraete, speichereGeraete, geraeteUebersicht, geraeteId, MAX_GERAETE } from './esp32-push.js'
import { clientIp } from './auth.js'
import dayjs from 'dayjs'
import dayjsUtc from 'dayjs/plugin/utc.js'
import dayjsTimezone from 'dayjs/plugin/timezone.js'

dayjs.extend(dayjsUtc)
dayjs.extend(dayjsTimezone)

// ============================================================
// Auth helper
// ============================================================

function timingSafeCompare(a, b) {
    try {
        const bufA = Buffer.from(a)
        const bufB = Buffer.from(b)
        if (bufA.length !== bufB.length) return false
        return crypto.timingSafeEqual(bufA, bufB)
    } catch {
        return false
    }
}

/** Gespeicherten Schlüssel entschlüsseln; '' wenn keiner da oder unlesbar. */
function gespeichert(wert) {
    if (!wert) return ''
    try { return decrypt(wert) || '' } catch { return '' }
}

/**
 * Schlüssel prüfen. `anzeige: true` lässt zusätzlich den Anzeige-Schlüssel
 * gelten (nur GET /api/esp32/display).
 */
async function verifyEsp32Key(req, { anzeige = false } = {}) {
    const provided = req.headers['x-esp32-key']
    if (!provided) return false

    const knex = getKnex()
    const row = await knex('settings').where('id', 1).select('esp32ApiKey', 'esp32AnzeigeKey').first()
    const haupt = gespeichert(row?.esp32ApiKey)
    const nurAnzeige = anzeige ? gespeichert(row?.esp32AnzeigeKey) : ''
    // Beide vergleichen (kein früher Ausstieg), damit die Laufzeit nicht verrät, welcher passte.
    const a = haupt ? timingSafeCompare(provided, haupt) : false
    const b = nurAnzeige ? timingSafeCompare(provided, nurAnzeige) : false
    return a || b
}

// ============================================================
// Fehlversuchsbremse (Audit SEC-SRV-004, 26.10.2026)
// ============================================================

/*
 * Bis dahin gaben 40 falsche Schlüssel in Folge 40× 401, ohne Bremse — ein
 * von Hand gesetzter, kurzer Schlüssel wäre zu erraten gewesen. Jetzt zählen
 * NUR Fehlschläge: wer in einem Fenster von einer Minute FEHLER_MAX
 * Fehlversuche hat, bekommt bis zum Ende des Fensters 429 — auch mit dem
 * richtigen Schlüssel, sonst verriete gerade die Bremse den Treffer. Gültige
 * Abrufe zählen nie: das Widget fragt minütlich, das Display alle paar
 * Sekunden. Dazu eine globale Grenze über alle Adressen (IPv6-Präfixe,
 * rotierende Absender), wie beim Login.
 */
export const ESP32_FEHLER_MAX = 20
export const ESP32_FEHLER_GLOBAL_MAX = 100
const ESP32_FENSTER_MS = 60 * 1000

/** Reine Bremse (für den Selbsttest ohne Server). */
export function erstelleBremse({ max = ESP32_FEHLER_MAX, globalMax = ESP32_FEHLER_GLOBAL_MAX, fensterMs = ESP32_FENSTER_MS } = {}) {
    const je = new Map()   // ip -> [zeitpunkte]
    let alle = []
    const frisch = (liste, jetzt) => liste.filter((t) => t > jetzt - fensterMs)
    return {
        gesperrt(ip, jetzt = Date.now()) {
            alle = frisch(alle, jetzt)
            if (alle.length >= globalMax) return true
            const l = frisch(je.get(ip) || [], jetzt)
            if (l.length) je.set(ip, l); else je.delete(ip)
            return l.length >= max
        },
        fehler(ip, jetzt = Date.now()) {
            alle.push(jetzt)
            // Abgelaufene Einträge auskehren, sonst wächst die Map mit jeder Adresse.
            if (je.size > 1000) for (const [k, l] of je) if (!frisch(l, jetzt).length) je.delete(k)
            je.set(ip, [...frisch(je.get(ip) || [], jetzt), jetzt])
        },
        leeren() { je.clear(); alle = [] },
    }
}

const bremse = erstelleBremse()

/** Nur für den Selbsttest. */
export function _esp32BremseLeeren() { bremse.leeren() }

/**
 * Schlüssel prüfen, mit Bremse. Antwortet selbst mit 429/401 und liefert dann
 * false; bei Erfolg true.
 */
async function zugangGeprueft(req, res, { anzeige = false } = {}) {
    const ip = await clientIp(req)
    if (bremse.gesperrt(ip)) {
        res.status(429).json({ error: 'Too many failed attempts' })
        return false
    }
    if (await verifyEsp32Key(req, { anzeige })) return true
    bremse.fehler(ip)
    res.status(401).json({ error: 'Unauthorized' })
    return false
}

/*
 * Zulässige Zeiträume der Anzeige (SEC-SRV-004). Bis dahin ging `filter` frei
 * in den Cache-Schlüssel `esp32|${filter}` — jeder neue Wert verfehlte den
 * Cache und löste drei signierte Börsenabrufe aus.
 */
export const ESP32_FILTER = ['month', 'week', 'year', 'all']

/** Zeitraum aus Anfrage und Einstellung (rein); Unbekanntes wird `all`. */
export function waehleFilter({ force, abfrage, einstellung }) {
    const roh = force ? (abfrage || 'all') : (einstellung || abfrage || 'month')
    return ESP32_FILTER.includes(roh) ? roh : 'all'
}

/** Mindestlänge eines von Hand gesetzten Schlüssels (die Oberfläche erzeugt 64 Hex-Zeichen). */
export const ESP32_KEY_MIN = 32

// ============================================================
// Public routes — registered BEFORE apiAuthMiddleware
// ============================================================

export function setupEsp32Routes(app) {

    app.get('/api/esp32/display', async (req, res) => {
        try {
            // Einzige Route, die auch der Anzeige-Schlüssel öffnet (SEC-GER-001).
            if (!(await zugangGeprueft(req, res, { anzeige: true }))) return

            const knex = getKnex()

            // Load all needed settings in one query
            const settings = await knex('settings').where('id', 1).select('timeZone', 'startBalance', 'balances', 'esp32Filter').first()
            const tz = zeitzoneAus(settings?.timeZone)

            // Per-broker start balances from settings.balances; primary = default
            let balances = {}
            try { balances = typeof settings?.balances === 'string' ? JSON.parse(settings.balances) : (settings?.balances || {}) } catch {}
            let startBalance = parseFloat(settings?.startBalance || 0)
            let primaryBroker = 'bitunix'
            if (balances.bitunix?.start) { startBalance = balances.bitunix.start; primaryBroker = 'bitunix' }
            else if (balances.bitget?.start) { startBalance = balances.bitget.start; primaryBroker = 'bitget' }

            const todayStart = dayjs().tz(tz).startOf('day').unix()
            const todayEnd   = dayjs().tz(tz).endOf('day').unix()

            // Server-side filter (settings.esp32Filter) normally takes priority over the
            // query param — so the journal admin controls which period the ESP32 displays.
            // A client can opt out with ?force=1 and pick its own period (the Android
            // widget sends force=1 + its configured filter).
            const forced = req.query.force === '1' || req.query.force === 'true'
            const filter = waehleFilter({
                force: forced,
                abfrage: typeof req.query.filter === 'string' ? req.query.filter : '',
                einstellung: settings?.esp32Filter,
            })

            /*
             * Teuren Teil cachen und bündeln: Dies war der einzige Poll-Endpunkt
             * ohne ausCache — jeder Abruf las alle trades-Zeilen neu und fragte
             * Bitunix/Bitget/Pionex live an. Mehrere Poller (ESP32-Display,
             * Android-Widget, Desklet) teilen sich jetzt einen Abruf je 15 s;
             * der Schlüssel trägt den Filter, weil er die Zeiträume verschiebt.
             * Fällt eine Quelle aus, liefert ausCache den Altstand.
             */
            const daten = await ausCache(`esp32|${filter}`, 15 * 1000, async () => {
            let periodStart = 0
            if      (filter === 'month') periodStart = dayjs().tz(tz).startOf('month').unix()
            else if (filter === 'week')  periodStart = dayjs().tz(tz).startOf('week').unix()
            else if (filter === 'year')  periodStart = dayjs().tz(tz).startOf('year').unix()

            const cutoff30d = dayjs().tz(tz).subtract(30, 'day').unix()

            // KPIs für die Trade-Zeilen eines Brokers (Periode via periodStart aus dem Closure)
            const statsForTrades = (rows, startBal) => {
                let todayPnL = 0, totalPnL = 0, allTimePnL = 0
                let totalGrossWins = 0, totalTradeCount = 0
                let totalNetWins = 0, totalNetLoss = 0, totalNetWinsCount = 0, totalNetLossCount = 0
                let volume30d = 0, volumeTotal = 0
                let todayTradeCount = 0, todayWins = 0, todayLosses = 0
                for (const row of rows) {
                    const ts = parseInt(row.dateUnix || 0)
                    const inPeriod = periodStart === 0 || ts >= periodStart
                    const isToday = ts >= todayStart && ts <= todayEnd
                    let pl = {}
                    try { pl = typeof row.pAndL === 'string' ? JSON.parse(row.pAndL) : (row.pAndL || {}) } catch {}
                    allTimePnL += parseFloat(pl.netProceeds || 0)
                    let tradesArr = []
                    try { tradesArr = typeof row.trades === 'string' ? JSON.parse(row.trades) : (row.trades || []) } catch {}
                    for (const t of tradesArr) {
                        const qty = Math.max(parseFloat(t.buyQuantity || 0), parseFloat(t.sellQuantity || 0))
                        const vol = qty * parseFloat(t.entryPrice || 0)
                        volumeTotal += vol
                        if (ts >= cutoff30d) volume30d += vol
                    }
                    if (!inPeriod) continue
                    const net = parseFloat(pl.netProceeds || 0)
                    totalPnL += net
                    if (isToday) {
                        todayPnL += net
                        const tw = parseInt(pl.grossWinsCount || 0)
                        const tc = parseInt(pl.trades || 0)
                        todayWins += tw; todayLosses += Math.max(0, tc - tw); todayTradeCount += tc
                    }
                    totalGrossWins  += parseInt(pl.grossWinsCount || 0)
                    totalTradeCount += parseInt(pl.trades || 0)
                    for (const t of tradesArr) {
                        const tGross = parseFloat(t.grossProceeds || 0)
                        if (tGross > 0) { totalNetWins += tGross; totalNetWinsCount++ }
                        else if (tGross < 0) { totalNetLoss += Math.abs(tGross); totalNetLossCount++ }
                    }
                }
                const winRate = totalTradeCount > 0 ? (totalGrossWins / totalTradeCount) * 100 : 0
                const avgWin = totalNetWinsCount > 0 ? totalNetWins / totalNetWinsCount : 0
                const avgLoss = totalNetLossCount > 0 ? totalNetLoss / totalNetLossCount : 0
                const rrr = avgLoss > 0 ? avgWin / avgLoss : 0
                const balance = startBal > 0 ? startBal + allTimePnL : null
                const balancePerf = startBal > 0 ? ((balance / startBal) - 1) * 100 : null
                const r2 = (x) => x == null ? null : Math.round(x * 100) / 100
                const r1 = (x) => x == null ? null : Math.round(x * 10) / 10
                return {
                    balance: r2(balance), balancePerf: r1(balancePerf),
                    todayPnL: r2(todayPnL), todayTrades: todayTradeCount, todayWins, todayLosses,
                    totalPnL: r2(totalPnL), winRate: r1(winRate), rrr: r2(rrr),
                    volume30d: Math.round(volume30d), volumeTotal: Math.round(volumeTotal)
                }
            }

            // Pro Broker rechnen (nur die mit Trades oder Startsaldo aufnehmen)
            const brokers = {}
            for (const b of ['bitunix', 'bitget', 'pionex']) {
                const startB = parseFloat(balances[b]?.start || 0)
                const rows = await knex('trades').where('broker', b).select('dateUnix', 'pAndL', 'trades')
                if (rows.length === 0 && !(startB > 0)) continue
                brokers[b] = statsForTrades(rows, startB)
            }

            // Top-Level-KPIs = Primär-Broker (Backward-Compat für ältere Clients)
            const primaryStats = brokers[primaryBroker] || statsForTrades([], startBalance)
            const { balance, balancePerf, todayPnL, todayTrades: todayTradeCount, todayWins, todayLosses,
                    totalPnL, winRate, rrr, volume30d, volumeTotal } = primaryStats

            // Satisfaction — global, gefiltert nach Zeitraum (wie Journal)
            const satsQuery = knex('satisfactions').select('satisfaction')
            if (periodStart > 0) satsQuery.where('dateUnix', '>=', periodStart)
            const sats = await satsQuery
            const satisfied = sats.filter(s => s.satisfaction == 1 || s.satisfaction == true).length
            const satisfaction = sats.length > 0 ? (satisfied / sats.length) * 100 : 0

            // Offene Futures-Positionen ALLER konfigurierten Broker — je mit broker-Tag,
            // damit Clients (Widget/Desklet) nach Börse gruppieren können. Pro Broker
            // eigenes try/catch, damit ein Ausfall die anderen nicht blockiert.
            let openPositions = []
            // --- Bitunix ---
            try {
                const c = await knex('bitunix_config').where('id', 1).first()
                if (c?.apiKey && c?.secretKey) {
                    const result = await getPendingPositions(decrypt(c.apiKey), decrypt(c.secretKey), {})
                    if (result.code === 0) {
                        const raw = Array.isArray(result.data) ? result.data : (result.data?.positionList || [])
                        for (const p of raw) openPositions.push({
                            broker:        'bitunix',
                            symbol:        p.symbol || '',
                            side:          p.side   || '',
                            leverage:      parseFloat(p.leverage     || 0),
                            entryPrice:    parseFloat(p.entryPrice   ?? p.avgOpenPrice ?? p.avg_open_price ?? 0),
                            markPrice:     parseFloat(p.markPrice    ?? p.mark_price ?? 0),
                            qty:           parseFloat(p.qty ?? p.maxQty ?? 0),
                            unrealizedPNL: parseFloat(p.unrealizedPNL ?? p.unrealized_pnl ?? 0),
                            realizedPNL:   parseFloat(p.realizedPNL  ?? p.realized_pnl ?? 0)
                        })
                    }
                }
            } catch (e) { console.warn('ESP32 bitunix positions:', e.message) }
            // --- Bitget ---
            try {
                const c = await knex('bitget_config').where('id', 1).first()
                if (c?.apiKey && c?.secretKey && c?.passphrase) {
                    const result = await getBitgetCurrentPositions(decrypt(c.apiKey), decrypt(c.secretKey), decrypt(c.passphrase), {})
                    if (String(result.code) === '00000') {
                        const raw = Array.isArray(result.data) ? result.data : []
                        for (const p of raw) {
                            if (parseFloat(p.total ?? p.available ?? 0) <= 0) continue
                            openPositions.push({
                                broker:        'bitget',
                                symbol:        p.symbol || '',
                                side:          (p.holdSide || p.posSide || '').toLowerCase() === 'long' ? 'BUY' : 'SELL',
                                leverage:      parseFloat(p.leverage      || 0),
                                entryPrice:    parseFloat(p.openPriceAvg  ?? p.averageOpenPrice ?? 0),
                                markPrice:     parseFloat(p.markPrice     ?? 0),
                                qty:           parseFloat(p.total ?? p.available ?? 0),
                                unrealizedPNL: parseFloat(p.unrealizedPL  ?? 0),
                                realizedPNL:   parseFloat(p.achievedProfits ?? 0)
                            })
                        }
                    }
                }
            } catch (e) { console.warn('ESP32 bitget positions:', e.message) }

            // Laufende Pionex-Bots — eigenes Array (NICHT in openPositions mischen, damit
            // ältere Clients ohne Bot-Support unverändert weiterlaufen). PnL/Marge in der
            // jeweiligen marginCoin (z.B. SOL bei Coin-M), nicht zwingend USDT.
            let bots = []
            try {
                bots = (await getRunningBotPositions()).map(b => ({
                    broker:        'pionex',
                    symbol:        b.symbol || '',
                    side:          b.side   || '',
                    leverage:      parseFloat(b.leverage      || 0),
                    entryPrice:    parseFloat(b.entryPrice    || 0),
                    markPrice:     parseFloat(b.markPrice     || 0),
                    qty:           parseFloat(b.qty           || 0),
                    unrealizedPNL: parseFloat(b.unrealizedPNL || 0),
                    marginCoin:    b.marginCoin || 'USDT',
                    liqPrice:      parseFloat(b.liqPrice      || 0),
                    coinM:         !!b.coinM,
                    botType:       b.botType || '',
                    isBot:         true
                }))
            } catch (botErr) {
                console.warn('ESP32 bots live fetch failed:', botErr.message)
            }

            const filterLabels = { month: 'Monat', week: 'Woche', year: 'Jahr', all: 'Gesamt' }
            return {
                filter:       filter,
                filterLabel:  filterLabels[filter] || 'Gesamt',
                todayPnL:      Math.round(todayPnL * 100) / 100,
                todayTrades:   todayTradeCount,
                todayWins:     todayWins,
                todayLosses:   todayLosses,
                totalPnL:      Math.round(totalPnL * 100) / 100,
                winRate:       Math.round(winRate * 10) / 10,
                satisfaction:  Math.round(satisfaction * 10) / 10,
                rrr:           Math.round(rrr * 100) / 100,
                balance:       balance !== null ? Math.round(balance * 100) / 100 : null,
                balancePerf:   balancePerf !== null ? Math.round(balancePerf * 10) / 10 : null,
                volume30d:     Math.round(volume30d),
                volumeTotal:   Math.round(volumeTotal),
                openPositions: openPositions,
                bots:          bots,
                // KPIs je Börse (für Clients, die pro Börse umschalten — z.B. Android-Widget).
                // Top-Level-Felder oben = primaryBroker (Backward-Compat für ältere Clients).
                primaryBroker: primaryBroker,
                brokers:       brokers
            }
            })
            // _cache ist internes ausCache-Detail (sendeRadar zieht es sonst in
            // einen Kopf um) — die Firmware/Widget-Clients bekommen es nicht.
            const { _cache, ...antwort } = daten
            res.json(antwort)
        } catch (e) {
            console.error('ESP32 display error:', e)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    /*
     * Auslösungen der Chart-Alarme seit `seit` (ms). Das Android-Widget fragt
     * hier im eigenen Takt nach und zeigt daraus Benachrichtigungen — ohne
     * Firebase, ohne Sitzung. `jetzt` ist die Serveruhr: das Gerät rechnet
     * seinen nächsten `seit` daraus, nicht aus der eigenen Uhr, die abweichen kann.
     * Bewusst ohne ausCache: höchstens 300 kleine Zeilen, und ein Cache von
     * 15 s wäre genau die Verzögerung, die hier niemand will.
     */
    app.get('/api/esp32/alarme', async (req, res) => {
        try {
            if (!(await zugangGeprueft(req, res))) return
            const seit = Math.max(0, Number(req.query.seit) || 0)
            const zeilen = await getKnex()('chart_alarme')
                .where('ausgeloestAm', '>', seit)
                .select('id', 'art', 'symbol', 'markt', 'notiz', 'kanaele', 'bedingung', 'verlauf')
            res.json({ jetzt: Date.now(), alarme: ausloesungenAus(zeilen, { seit, arten: leseArten(req.query.arten) }) })
        } catch (e) {
            console.error('ESP32 alarme error:', e)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    // Sofort-Zustellung: das Widget trägt hier die Adresse ein, die ihm der
    // UnifiedPush-Verteiler (ntfy) gegeben hat, samt Web-Push-Schlüssel.
    app.post('/api/esp32/push', async (req, res) => {
        try {
            if (!(await zugangGeprueft(req, res))) return
            const { fehler, daten } = pruefeGeraet(req.body || {})
            if (fehler) return res.status(400).json({ error: fehler })
            const erg = mitGeraet(await ladeGeraete(), daten)
            if (erg.fehler === 'voll') {
                // Kein Verdrängen mehr (SEC-SRV-003) — Platz schafft man in den Einstellungen.
                return res.status(409).json({ error: `Bereits ${MAX_GERAETE} Geräte eingetragen. In AutarkTrade unter Einstellungen › Geräte eines entfernen.`, voll: true })
            }
            await speichereGeraete(erg.liste)
            res.json({ ok: true, geraete: erg.liste.length })
        } catch (e) {
            console.error('ESP32 push POST error:', e)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    app.delete('/api/esp32/push', async (req, res) => {
        try {
            if (!(await zugangGeprueft(req, res))) return
            const endpoint = String(req.body?.endpoint || '')
            const liste = ohneGeraet(await ladeGeraete(), endpoint)
            await speichereGeraete(liste)
            res.json({ ok: true, geraete: liste.length })
        } catch (e) {
            console.error('ESP32 push DELETE error:', e)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    console.log(' -> ESP32 display route initialized (GET /api/esp32/display, /api/esp32/alarme, /api/esp32/push)')
}

// ============================================================
// Admin routes — registered AFTER apiAuthMiddleware (session required)
// ============================================================

export function setupEsp32AdminRoutes(app) {

    // GET /api/esp32/settings — key presence only
    app.get('/api/esp32/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('settings').where('id', 1).select('esp32ApiKey', 'esp32AnzeigeKey').first()
            res.json({ esp32ApiKeySet: !!(row?.esp32ApiKey), esp32AnzeigeKeySet: !!(row?.esp32AnzeigeKey) })
        } catch (e) {
            console.error('ESP32 settings GET error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    // POST /api/esp32/settings — generate new key or save custom key
    app.post('/api/esp32/settings', async (req, res) => {
        try {
            const knex = getKnex()

            // Anzeige-Schlüssel (SEC-GER-001): nur erzeugt, nie von Hand gesetzt.
            if (req.body.regenerate && req.body.art === 'anzeige') {
                const plainKey = crypto.randomBytes(32).toString('hex')
                await knex('settings').where('id', 1).update({ esp32AnzeigeKey: encrypt(plainKey) })
                return res.json({ esp32AnzeigeKeySet: true, plainKey })
            }

            if (req.body.regenerate) {
                // Generate a new random 32-byte hex key
                const plainKey = crypto.randomBytes(32).toString('hex')
                const encrypted = encrypt(plainKey)
                await knex('settings').where('id', 1).update({ esp32ApiKey: encrypted })
                // Return plaintext ONCE so user can copy it to ESP32 firmware
                return res.json({ esp32ApiKeySet: true, plainKey })
            }

            // Save a manually entered key (if not masked) — nur mit Mindestlänge
            // (SEC-SRV-004): ohne sie nahm die Route auch „1234" an.
            if (req.body.esp32ApiKey && !req.body.esp32ApiKey.includes('•')) {
                const eigen = String(req.body.esp32ApiKey).trim()
                if (eigen.length < ESP32_KEY_MIN) {
                    return res.status(400).json({ error: `Der Schlüssel braucht mindestens ${ESP32_KEY_MIN} Zeichen. Besser: „Schlüssel erzeugen".` })
                }
                const encrypted = encrypt(eigen)
                await knex('settings').where('id', 1).update({ esp32ApiKey: encrypted })
            }

            res.json({ esp32ApiKeySet: true })
        } catch (e) {
            console.error('ESP32 settings POST error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    /*
     * Eingetragene Push-Geräte (SEC-SRV-003): bis dahin gab es keine Stelle,
     * an der man sah, wer sich für die Sofort-Zustellung eingetragen hat.
     * Nur Name, Host und Datum — weder Web-Push-Schlüssel noch die volle
     * Adresse (bei ntfy ist das Topic im Pfad die Berechtigung).
     */
    app.get('/api/esp32/geraete', async (req, res) => {
        try {
            res.json({ max: MAX_GERAETE, geraete: geraeteUebersicht(await ladeGeraete()) })
        } catch (e) {
            console.error('ESP32 geraete GET error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    app.delete('/api/esp32/geraete/:id', async (req, res) => {
        try {
            const liste = await ladeGeraete()
            const ziel = liste.find((g) => geraeteId(g.endpoint) === String(req.params.id))
            if (!ziel) return res.status(404).json({ error: 'Gerät nicht gefunden' })
            const rest = ohneGeraet(liste, ziel.endpoint)
            await speichereGeraete(rest)
            res.json({ ok: true, geraete: geraeteUebersicht(rest) })
        } catch (e) {
            console.error('ESP32 geraete DELETE error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    // DELETE /api/esp32/key — remove key
    app.delete('/api/esp32/key', async (req, res) => {
        try {
            const knex = getKnex()
            const spalte = req.query.art === 'anzeige' ? 'esp32AnzeigeKey' : 'esp32ApiKey'
            await knex('settings').where('id', 1).update({ [spalte]: '' })
            res.json({ ok: true })
        } catch (e) {
            console.error('ESP32 key DELETE error:', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })
}
