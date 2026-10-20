<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import NoData from '../components/NoData.vue'
import PageInfo from '../components/PageInfo.vue'
import { Knopf, Symbol, Pille, Hinweis, Kreisel } from '../components/basis'
import { seiteLaedt, timeZoneTrade, expandedId, kopiertesBild } from '../stores/ui.js'
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker, selectedTradeCategory, brokers } from '../stores/filters.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, incomingBrokerFehler, verfuegbareTags } from '../stores/trades.js'
import { useVerlassenSchutz } from '../composables/useVerlassenSchutz.js'
import { currentUser } from '../stores/settings.js'
import { useFetchOpenPositions, useGetIncomingPositions, useUpdateIncomingPosition, useDeleteIncomingPosition, useTransferClosingMetadata } from '../utils/incoming'
import { ladeVerfuegbareTags, useGetTagInfo } from '../utils/journal/tagebuch.js'
import { dbCreate, dbUpdate, dbFind, dbGet } from '../utils/db.js'
import dayjs from '../utils/journal/zeit.js'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import { sanitizeHtml } from '../utils/sanitize'
import { sendNotification } from '../utils/notify.js'

const route = useRoute()
const { t } = useI18n()

let pollingInterval = null
const quillInstances = {} // key: positionId_opening / positionId_closing
const incomingError = ref(null)
const savingId = ref(null)

/*
 * Verlassen-Schutz: Incoming ist der textreichste Eingabeort der App (/diary
 * leitet hierhin um), gespeichert wird nur über den Knopf — genau der Fall,
 * für den useVerlassenSchutz gebaut wurde; die Schwesterseite Playbook hat
 * ihn, hier fehlte er. Schmutzig ist die Seite, wenn die aufgeklappte
 * Position Quill-Text trägt, der vom gespeicherten Stand abweicht — blosses
 * Aufklappen fragt nicht nach.
 */
useVerlassenSchutz(() => {
    const id = expandedId.value
    if (!id) return false
    const pos = incomingPositions.find((p) => p.positionId === id)
    if (!pos) return false
    for (const art of ['opening', 'closing']) {
        const quill = quillInstances[`${id}_${art}`]
        if (!quill) continue
        const aktuell = quill.root.innerHTML
        const gespeichert = pos[art === 'opening' ? 'playbook' : 'closingPlaybook'] || ''
        const leer = aktuell === '' || aktuell === '<p><br></p>'
        if (leer ? (gespeichert !== '' && gespeichert !== '<p><br></p>') : aktuell !== gespeichert) return true
    }
    return false
}, () => t('common.unsavedLeave'))

// ===== COMPOUND/FILLS TRACKING =====
import axios from 'axios'
import { holeTpSlOrders, aggregiereTpSl, istBotPosition } from '../utils/positionTpsl.js'
import { erzeugeChartBild, chartZeiteinheit, strategieAusTags } from '../utils/chart/tradeBild.js'
const positionFills = ref({}) // Map: positionId → { loading, trades[], error }

async function fetchPositionFills(positionId, force = false, broker = 'bitunix', symbol = '', openTime = null, posSide = '') {
    if (!positionId) return
    if (!force && positionFills.value[positionId]?.trades) return // cached
    positionFills.value[positionId] = { loading: true, trades: [], error: null }
    try {
        let url, data
        if (broker === 'bitget') {
            // Bitget-Fills sind symbol-basiert (nicht positionsgebunden). Ohne
            // Zeitgrenze würden Fills FRÜHERER, bereits geschlossener Positionen
            // desselben Symbols mit reingemischt → falsche „Nachkäufe"/⌀-Einstieg.
            // Darum ab der Öffnungszeit der aktuellen Position laden (60s Puffer
            // gegen Clock-Skew zwischen Fill- und Positions-Timestamp).
            let params = ''
            const ot = parseInt(openTime || 0)
            if (ot > 0) params = `?startTime=${ot - 60000}`
            const resp = await axios.get(`/api/bitget/position-trades/${encodeURIComponent(symbol)}${params}`)
            data = resp.data
            // Map Bitget fill fields to unified format
            if (data.ok && data.trades) {
                data.trades = data.trades.map(f => ({
                    tradeId: f.tradeId,
                    orderId: f.orderId,
                    symbol: f.symbol,
                    side: f.side === 'buy' ? 'BUY' : 'SELL',
                    price: f.price,
                    qty: f.baseVolume || f.size,
                    // Bitget v2 liefert die Gebühr in feeDetail[].totalFee (signiert,
                    // negativ = gezahlt) — NICHT in f.fee. Summe über alle Einträge.
                    fee: Array.isArray(f.feeDetail)
                        ? f.feeDetail.reduce((s, d) => s + Math.abs(parseFloat(d.totalFee || 0)), 0)
                        : Math.abs(parseFloat(f.fee || 0)),
                    ctime: f.cTime,
                    // reduceOnly = Schließung. Hedge-Modus liefert tradeSide
                    // 'close'/'reduce_close_*'. One-Way-Modus liefert nur
                    // 'buy_single'/'sell_single' → dort ist die GEGEN-Richtung zur
                    // Position eine Schließung (Long → sell schließt, Short → buy).
                    reduceOnly: f.tradeSide === 'close' || f.tradeSide === 'reduce_close_short' || f.tradeSide === 'reduce_close_long'
                        || (posSide === 'LONG' && f.side === 'sell')
                        || (posSide === 'SHORT' && f.side === 'buy'),
                }))
            }
        } else {
            const resp = await axios.get(`/api/bitunix/position-trades/${positionId}`)
            data = resp.data
        }
        if (data.ok && data.trades) {
            const trades = data.trades.sort((a, b) => parseInt(a.ctime || a.cTime || 0) - parseInt(b.ctime || b.cTime || 0))
            positionFills.value[positionId] = { loading: false, trades, error: null }
        } else {
            positionFills.value[positionId] = { loading: false, trades: [], error: data.error || 'No data' }
        }
    } catch (err) {
        positionFills.value[positionId] = { loading: false, trades: [], error: err.message }
    }
}

function getFillsForPosition(positionId) {
    return positionFills.value[positionId] || { loading: false, trades: [], error: null }
}

function getEntryFills(positionId, side) {
    const fills = getFillsForPosition(positionId)
    // Entry fills: same side as position and not reduceOnly
    const entrySide = side === 'LONG' ? 'BUY' : 'SELL'
    return fills.trades.filter(t => t.side === entrySide && !t.reduceOnly)
}

function getAvgEntryPrice(positionId, side) {
    const entries = getEntryFills(positionId, side)
    if (entries.length === 0) return 0
    let totalValue = 0, totalQty = 0
    for (const e of entries) {
        const qty = parseFloat(e.qty || 0)
        const price = parseFloat(e.price || 0)
        totalValue += qty * price
        totalQty += qty
    }
    return totalQty > 0 ? totalValue / totalQty : 0
}

// Side einheitlich als LONG/SHORT/NEUTRAL anzeigen (nicht BUY/SELL). Nur fürs Label
// + Farbe — die rohe pos.side bleibt für die Logik (Fills/BE) unverändert.
function displaySide(s) {
    const u = (s || '').toString().toUpperCase()
    if (u === 'BUY' || u === 'LONG') return 'LONG'
    if (u === 'SELL' || u === 'SHORT') return 'SHORT'
    return u || '—'
}

function getBreakevenPrice(positionId, side) {
    const fillData = getFillsForPosition(positionId)
    if (!fillData.trades || fillData.trades.length === 0) return 0

    const isShort = side === 'SHORT' || side === 'SELL'
    const entrySide = isShort ? 'SELL' : 'BUY'
    const closeSide = isShort ? 'BUY' : 'SELL'

    let entryValue = 0, entryQty = 0
    let closeValue = 0, closeQty = 0
    let totalFees = 0

    for (const f of fillData.trades) {
        const qty = parseFloat(f.qty || 0)
        const price = parseFloat(f.price || 0)
        const fee = parseFloat(f.fee || 0)
        totalFees += fee

        if (f.side === entrySide && !f.reduceOnly) {
            entryValue += qty * price
            entryQty += qty
        } else if (f.reduceOnly || f.side === closeSide) {
            closeValue += qty * price
            closeQty += qty
        }
    }

    const remainingQty = entryQty - closeQty
    if (remainingQty <= 0) return 0

    if (isShort) {
        // SHORT: breakeven = (entryValue - closeValue - totalFees) / remainingQty
        return (entryValue - closeValue - totalFees) / remainingQty
    } else {
        // LONG: breakeven = (entryValue - closeValue + totalFees) / remainingQty
        return (entryValue - closeValue + totalFees) / remainingQty
    }
}

/**
 * Liegen Stop und Ziel überhaupt auf der richtigen Seite des Einstiegs?
 *
 * Ohne diese Prüfung liefert `Math.abs` auch für einen Stop auf der GEWINN-
 * seite ein plausibles „RRR 1:x" — die Zahl sieht dann gesund aus, obwohl die
 * Positionierung Unsinn ist. Die Backtest-Seite prüft das seit jeher
 * (`server/risk-engine.js`), die Anzeige der offenen Positionen nicht.
 */
function levelsPlausibel(entry, sl, tp, side) {
    const isShort = side === 'SHORT' || side === 'SELL'
    const slOk = isShort ? sl > entry : sl < entry
    const tpOk = isShort ? tp < entry : tp > entry
    return slOk && tpOk
}

function getRRR(positionId, side) {
    const tpsl = getTpSlForPosition(positionId)
    if (!tpsl.sl || !tpsl.tp) return null
    const entry = getAvgEntryPrice(positionId, side)
    if (entry <= 0) return null
    const sl = parseFloat(tpsl.sl)
    const tp = parseFloat(tpsl.tp)
    if (!levelsPlausibel(entry, sl, tp, side)) return null
    const riskDist = Math.abs(entry - sl)
    const rewardDist = Math.abs(entry - tp)
    if (riskDist <= 0) return null
    return (rewardDist / riskDist).toFixed(1)
}

function isSLAboveBreakeven(positionId, side) {
    const tpsl = getTpSlForPosition(positionId)
    if (!tpsl.sl) return false
    const be = getBreakevenPrice(positionId, side)
    if (be <= 0) return false
    const isShort = side === 'SHORT' || side === 'SELL'
    // SHORT: SL is "above BE" (safe) when SL price is BELOW BE (closer to profit)
    // LONG: SL is "above BE" (safe) when SL price is ABOVE BE (closer to profit)
    if (isShort) return tpsl.sl < be
    return tpsl.sl > be
}

function formatFillTime(ctime) {
    return dayjs(parseInt(ctime)).tz(timeZoneTrade.value).format('DD.MM. HH:mm')
}

function getIncomingFillBadgeType(fill, idx, allFills) {
    if (fill.reduceOnly) {
        const openQty = allFills.filter(f => !f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        const totalClosedQty = allFills.filter(f => f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        return totalClosedQty >= openQty ? 'close' : 'partialClose'
    }
    if (idx === 0 || allFills.slice(0, idx).every(f => f.reduceOnly)) return 'initial'
    return 'compound'
}

function groupFillsByMinute(fills, timeField = 'time') {
    if (!fills || fills.length === 0) return []
    const groups = []
    let current = null
    for (let i = 0; i < fills.length; i++) {
        const fill = fills[i]
        const minute = dayjs(parseInt(fill[timeField])).tz(timeZoneTrade.value).format('YYYY-MM-DD HH:mm')
        const key = minute + '_' + (fill.reduceOnly ? '1' : '0')
        if (current && current.key === key) {
            current.fills.push(fill)
        } else {
            current = { key, fills: [fill], time: fill[timeField], reduceOnly: fill.reduceOnly }
            groups.push(current)
        }
    }
    return groups.map(g => {
        const totalQty = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0), 0)
        const totalValue = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0) * parseFloat(f.price || 0), 0)
        const totalFee = g.fills.reduce((s, f) => s + parseFloat(f.fee || 0), 0)
        return {
            ...g,
            totalQty,
            avgPrice: totalQty > 0 ? totalValue / totalQty : 0,
            totalValue,
            totalFee,
            isGroup: g.fills.length > 1,
            firstFillIdx: fills.indexOf(g.fills[0])
        }
    })
}

const expandedFillGroups = ref(new Set())
function toggleFillGroup(key) {
    if (expandedFillGroups.value.has(key)) {
        expandedFillGroups.value.delete(key)
    } else {
        expandedFillGroups.value.add(key)
    }
}

// ===== TP/SL TRACKING =====
const positionTpSl = ref({}) // Map: positionId → { loading, orders[], error }
const tpSlHistory = ref({}) // Map: positionId → [{ time, type, oldVal, newVal }]

// Load history from localStorage
function loadTpSlHistory(positionId) {
    if (tpSlHistory.value[positionId]) return tpSlHistory.value[positionId]
    try {
        // 1. Try localStorage (fast, same-origin cache)
        const stored = localStorage.getItem(`tpsl_history_${positionId}`)
        let history = stored ? JSON.parse(stored) : []

        // 2. DB fallback — if localStorage empty, load from incoming_positions.tpslHistory
        if (history.length === 0) {
            const pos = incomingPositions.find(p => p.positionId === positionId)
            const dbHistory = pos?.tpslHistory
            if (Array.isArray(dbHistory) && dbHistory.length > 0) {
                history = dbHistory
                // Sync back to localStorage for fast access
                localStorage.setItem(`tpsl_history_${positionId}`, JSON.stringify(history))
            }
        }

        // Deduplicate: per type, skip entries with same action+oldVal+newVal as previous of same type
        const norm = v => (v === undefined || v === null || v === '' || v === 0) ? null : String(v)
        if (history.length > 1) {
            const clean = []
            const lastByType = {}
            for (const curr of history) {
                const key = curr.type
                const prev = lastByType[key]
                if (prev && curr.action === prev.action &&
                    norm(curr.oldVal) === norm(prev.oldVal) &&
                    norm(curr.newVal) === norm(prev.newVal)) {
                    continue
                }
                clean.push(curr)
                lastByType[key] = { action: curr.action, oldVal: curr.oldVal, newVal: curr.newVal }
            }
            if (clean.length !== history.length) {
                history = clean
                localStorage.setItem(`tpsl_history_${positionId}`, JSON.stringify(history))
            }
        }
        tpSlHistory.value[positionId] = history
        return history
    } catch { return [] }
}

function saveTpSlHistory(positionId, history) {
    // Always dedup before saving
    const norm = v => (v === undefined || v === null || v === '' || v === 0) ? null : String(v)
    const clean = []
    const lastByType = {}
    for (const curr of history) {
        const prev = lastByType[curr.type]
        if (prev && curr.action === prev.action &&
            norm(curr.oldVal) === norm(prev.oldVal) &&
            norm(curr.newVal) === norm(prev.newVal)) {
            continue
        }
        clean.push(curr)
        lastByType[curr.type] = { action: curr.action, oldVal: curr.oldVal, newVal: curr.newVal }
    }
    tpSlHistory.value[positionId] = clean
    localStorage.setItem(`tpsl_history_${positionId}`, JSON.stringify(clean))

    // Persist to DB (non-blocking) — ensures history survives browser/port switches
    const pos = incomingPositions.find(p => p.positionId === positionId)
    if (pos?.objectId) {
        dbUpdate('incoming_positions', pos.objectId, { tpslHistory: clean })
            .catch(err => console.warn('tpslHistory DB save failed:', err.message))
    }
}

/**
 * Ausgelöst oder von Hand entfernt? Zwei Belege, einer reicht:
 *  - ein reduzierender Fill nahe am Preis SEIT die Marke zuletzt gesehen wurde
 *    (bis 19.10.2026 nur „in den letzten 5 Minuten" — ein TP, der über Nacht
 *    bei geschlossener Seite auslöste, stand am Morgen als „entfernt" da);
 *  - die Position ist seitdem um die Menge der Marke geschrumpft (bzw. bei
 *    einer Marke über die ganze Position: überhaupt geschrumpft).
 */
function wasTpSlTriggered(positionId, type, oldPrice, letzter = null, posQtyJetzt = 0) {
    const seit = (letzter?.time || 0) - 60_000
    const fillData = getFillsForPosition(positionId)
    const perFill = (fillData.trades || []).some(f => {
        if (!f.reduceOnly) return false
        const fillTime = parseInt(f.ctime || 0)
        if (fillTime < seit) return false
        const fillPrice = parseFloat(f.price || 0)
        // Price within 0.5% of target = triggered
        return Math.abs(fillPrice - oldPrice) / oldPrice < 0.005
    })
    if (perFill) return true
    const vorher = parseFloat(letzter?.posQty || 0), jetzt = parseFloat(posQtyJetzt || 0), menge = parseFloat(letzter?.qty || 0)
    if (!(vorher > 0) || !(jetzt < vorher * 0.999)) return false
    const weg = vorher - jetzt
    return menge > 0 && menge < vorher * 0.999 ? Math.abs(weg - menge) <= menge * 0.02 : true
}

function trackTpSlChanges(positionId, newSl, newTp, slQty = 0, tpQty = 0, posQty = 0, side = '') {
    const history = loadTpSlHistory(positionId)
    const now = Date.now()

    // Normalize values for consistent comparison
    const norm = v => (v === undefined || v === null || v === '' || v === 0) ? null : String(v)
    newSl = norm(newSl)
    newTp = norm(newTp)

    // Helper: find last entry of given type
    function lastOfType(type) {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].type === type) return { val: norm(history[i].newVal), entry: history[i] }
        }
        return { val: null, entry: null }
    }

    // Calculate current RRR after this change
    function calcCurrentRRR() {
        // Determine effective SL/TP after this change
        const effectiveSl = newSl ? parseFloat(newSl) : null
        const effectiveTp = newTp ? parseFloat(newTp) : null
        if (!effectiveSl || !effectiveTp) return null
        const entry = getAvgEntryPrice(positionId, side)
        if (entry <= 0) return null
        // Gleiche Seitenprüfung wie in getRRR: eine Kennzahl aus vertauschten
        // Marken ist schlimmer als gar keine.
        if (!levelsPlausibel(entry, effectiveSl, effectiveTp, side)) return null
        const riskDist = Math.abs(entry - effectiveSl)
        const rewardDist = Math.abs(entry - effectiveTp)
        if (riskDist <= 0) return null
        return parseFloat((rewardDist / riskDist).toFixed(2))
    }

    // Helper: prevent duplicate — only push if last entry of same type differs
    function safePush(entry) {
        const last = lastOfType(entry.type)
        if (last.entry &&
            last.entry.action === entry.action &&
            norm(last.entry.oldVal) === norm(entry.oldVal) &&
            norm(last.entry.newVal) === norm(entry.newVal)) {
            return false // duplicate, skip
        }
        // Attach current RRR to every entry
        entry.rrr = calcCurrentRRR()
        history.push(entry)
        return true
    }

    let changed = false
    const lastSlInfo = lastOfType('SL')
    const lastTpInfo = lastOfType('TP')

    // Track SL changes
    if (newSl !== lastSlInfo.val) {
        if (lastSlInfo.val === null && newSl !== null) {
            changed = safePush({ time: now, type: 'SL', oldVal: null, newVal: newSl, qty: slQty || 0, posQty, action: 'set' }) || changed
        } else if (lastSlInfo.val !== null && newSl === null) {
            const triggered = wasTpSlTriggered(positionId, 'SL', lastSlInfo.val, lastSlInfo.entry, posQty)
            changed = safePush({ time: now, type: 'SL', oldVal: lastSlInfo.val, newVal: null, qty: 0, posQty, action: triggered ? 'triggered' : 'removed' }) || changed
        } else if (newSl !== null) {
            changed = safePush({ time: now, type: 'SL', oldVal: lastSlInfo.val, newVal: newSl, qty: slQty || 0, posQty, action: 'moved' }) || changed
        }
    }

    // Track TP changes
    if (newTp !== lastTpInfo.val) {
        if (lastTpInfo.val === null && newTp !== null) {
            changed = safePush({ time: now, type: 'TP', oldVal: null, newVal: newTp, qty: tpQty || 0, posQty, action: 'set' }) || changed
        } else if (lastTpInfo.val !== null && newTp === null) {
            const triggered = wasTpSlTriggered(positionId, 'TP', lastTpInfo.val, lastTpInfo.entry, posQty)
            changed = safePush({ time: now, type: 'TP', oldVal: lastTpInfo.val, newVal: null, qty: 0, posQty, action: triggered ? 'triggered' : 'removed' }) || changed
        } else if (newTp !== null) {
            changed = safePush({ time: now, type: 'TP', oldVal: lastTpInfo.val, newVal: newTp, qty: tpQty || 0, posQty, action: 'moved' }) || changed
        }
    }

    if (changed) saveTpSlHistory(positionId, history)
}

function getTpSlHistoryForPosition(positionId) {
    return loadTpSlHistory(positionId)
}

/**
 * Get position quantity at a given timestamp by reconstructing from fills.
 * Used as fallback for old tpslHistory entries that don't have posQty stored.
 */
function getPosQtyAtTime(positionId, side, timestamp) {
    const fillData = getFillsForPosition(positionId)
    if (!fillData.trades || fillData.trades.length === 0) return 0
    const isShort = side === 'SHORT' || side === 'SELL'
    const entrySide = isShort ? 'SELL' : 'BUY'
    let entryQty = 0, closeQty = 0
    for (const f of fillData.trades) {
        const fTime = parseInt(f.ctime || f.cTime || 0)
        if (fTime > timestamp) break // fills are sorted by time
        const qty = parseFloat(f.qty || 0)
        if (f.side === entrySide && !f.reduceOnly) {
            entryQty += qty
        } else if (f.reduceOnly || f.side !== entrySide) {
            closeQty += qty
        }
    }
    return Math.max(0, entryQty - closeQty)
}

/**
 * Calculate display qty + percentage for an SL/TP history entry.
 * Always relative to CURRENT remaining position. If SL/TP qty exceeds remaining
 * (e.g. not adjusted after partial close), caps to remaining qty and 100%.
 */
function getTpSlEntryDisplay(entry, currentQty) {
    if (!entry.qty) return null
    const refQty = parseFloat(currentQty) || 0
    if (refQty <= 0) return { qty: entry.qty, pct: '?' }
    const effectiveQty = Math.min(entry.qty, refQty)
    const pct = Math.min(100, Math.round(entry.qty / refQty * 100))
    return { qty: effectiveQty, pct }
}

async function fetchPositionTpSl(positionId, force = false, broker = 'bitunix', symbol = '') {
    if (!positionId) return
    if (!force && positionTpSl.value[positionId]?.orders) return // cached
    positionTpSl.value[positionId] = { loading: true, orders: [], error: null }
    try {
        const orders = await holeTpSlOrders(broker, positionId, symbol)
        if (orders.length) {
            positionTpSl.value[positionId] = { loading: false, orders, error: null }
            // Track changes — pass current position quantity for accurate % display
            const current = getTpSlForPosition(positionId)
            const pos = incomingPositions.find(p => p.positionId === positionId)
            const posQty = pos ? parseFloat(pos.quantity || 0) : 0
            const posSide = pos?.side || ''
            trackTpSlChanges(positionId, current.sl, current.tp, current.slQty, current.tpQty, posQty, posSide)
        } else {
            positionTpSl.value[positionId] = { loading: false, orders: [], error: null }
            const pos2 = incomingPositions.find(p => p.positionId === positionId)
            trackTpSlChanges(positionId, null, null, 0, 0, 0, pos2?.side || '')
        }
    } catch (err) {
        positionTpSl.value[positionId] = { loading: false, orders: [], error: err.message }
    }
}

// Abruf und Verdichtung leben in `src/utils/positionTpsl.js` — der Chart
// zeichnet Stop und Ziel offener Positionen mit derselben Antwort.
function getTpSlForPosition(positionId) {
    return aggregiereTpSl(positionTpSl.value[positionId]?.orders, positionId)
}

// Screenshot upload state — separate previews for trend, entry and closing
const trendScreenshotPreviews = ref({}) // positionId → base64
const entryScreenshotPreviews = ref({}) // positionId → base64
const closingScreenshotPreviews = ref({}) // positionId → base64

// Timeframes from settings (or fallback to all)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.value.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes.value
})

// Always load from API when entering the page (including first open)
async function loadPageData() {
    seiteLaedt.value = true
    incomingError.value = null
    try {
        await ladeVerfuegbareTags()
        await useFetchOpenPositions()
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || t('common.errorLoading')
    }
    seiteLaedt.value = false
}

// Load when entering the route (first open + return from another page)
watch(() => route.name, (name) => {
    if (name === 'incoming') {
        loadPageData()
    }
}, { immediate: true })

onMounted(() => {
    // Polling every 60 seconds
    pollingInterval = setInterval(async () => {
        try {
            await useFetchOpenPositions()
            incomingError.value = null
        } catch (error) {
            console.error(' -> Polling error:', error)
        }
    }, 60000)
})

onBeforeUnmount(() => {
    if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
    }
    // Destroy all Quill instances
    Object.keys(quillInstances).forEach(key => {
        delete quillInstances[key]
    })
    expandedId.value = null
})

async function manualRefresh() {
    incomingError.value = null
    try {
        await useFetchOpenPositions()
        // Re-fetch fills and TP/SL for expanded position
        if (expandedId.value) {
            const expandPos = incomingPositions.find(p => p.positionId === expandedId.value)
            if (expandPos) {
                fetchPositionFills(expandedId.value, true, expandPos.broker, expandPos.symbol, expandPos.bitunixData?.ctime, expandPos.side)
                fetchPositionTpSl(expandedId.value, true, expandPos.broker, expandPos.symbol)
                // If position transitioned to pending_evaluation, init closing Quill
                if (expandPos.status === 'pending_evaluation') {
                    await nextTick()
                    initQuillEditor(expandedId.value, 'closing')
                    autoDetectAndSetTradeType(expandPos)
                }
            }
        }
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || t('incoming.errorUpdatingCounters')
    }
}

async function toggleExpand(positionId) {
    // Close current: clean up Quill instances
    if (expandedId.value && expandedId.value !== positionId) {
        delete quillInstances[expandedId.value + '_opening']
        delete quillInstances[expandedId.value + '_closing']
    }

    if (expandedId.value === positionId) {
        delete quillInstances[positionId + '_opening']
        delete quillInstances[positionId + '_closing']
        expandedId.value = null
        return
    }

    expandedId.value = positionId

    // Fetch fills and TP/SL for open and pending_evaluation positions (Bitunix + Bitget)
    const expandPos = incomingPositions.find(p => p.positionId === positionId)
    // Screenshot-Previews aus DB laden
    if (expandPos) loadScreenshotPreviews(expandPos)
    if (expandPos && (expandPos.status === 'open' || expandPos.status === 'pending_evaluation') && (expandPos.broker === 'bitunix' || expandPos.broker === 'bitget')) {
        fetchPositionFills(positionId, false, expandPos.broker, expandPos.symbol, expandPos.bitunixData?.ctime, expandPos.side)
        fetchPositionTpSl(positionId, false, expandPos.broker, expandPos.symbol)
    }

    // Initialize Quill editors after DOM renders
    await nextTick()
    initQuillEditor(positionId, 'opening')
    // Only init closing Quill if position is pending evaluation
    if (expandPos && expandPos.status === 'pending_evaluation') {
        initQuillEditor(positionId, 'closing')
        autoDetectAndSetTradeType(expandPos)
    }
}

function initQuillEditor(positionId, type) {
    const editorId = `quillIncoming-${positionId}-${type}`
    const key = `${positionId}_${type}`
    const editorEl = document.getElementById(editorId)

    if (editorEl && !quillInstances[key]) {
        const quill = new Quill(editorEl, {
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                ]
            },
            theme: 'snow'
        })
        quill.root.spellcheck = true
        quillInstances[key] = quill

        // Load existing content
        const pos = incomingPositions.find(p => p.positionId === positionId)
        if (pos) {
            if (type === 'opening' && pos.playbook) {
                quill.root.innerHTML = sanitizeHtml(pos.playbook)
            } else if (type === 'closing' && pos.closingPlaybook) {
                quill.root.innerHTML = sanitizeHtml(pos.closingPlaybook)
            }
        }
    }
}

// ===== TRADE TYPE HANDLER =====

const tradeTypeOptions = [
    { value: 'scalp', labelKey: 'incoming.scalptrade' },
    { value: 'day', labelKey: 'incoming.daytrade' },
    { value: 'swing', labelKey: 'incoming.swingtrade' },
]

function updateTradeType(pos, value) {
    const newValue = pos.tradeType === value ? '' : value
    pos.tradeType = newValue
    useUpdateIncomingPosition(pos.objectId, { tradeType: newValue })
}

function updateClosingTradeType(pos, value) {
    const newValue = pos.closingTradeType === value ? '' : value
    pos.closingTradeType = newValue
    useUpdateIncomingPosition(pos.objectId, { closingTradeType: newValue })
    // Mark as manually overridden so auto-detect doesn't re-apply
    autoDetectedTradeType.value[pos.positionId] = false
}

// ===== TRADE TYPE AUTO-DETECTION =====

const autoDetectedTradeType = ref({}) // positionId → true (auto) / false (manual override)
const tpslCollapsedIds = ref([])

function toggleTpSlHistory(positionId) {
    const idx = tpslCollapsedIds.value.indexOf(positionId)
    if (idx >= 0) {
        tpslCollapsedIds.value.splice(idx, 1)
    } else {
        tpslCollapsedIds.value.push(positionId)
    }
}

function getTradeDurationMinutes(pos) {
    let hd = pos.historyData
    if (!hd) return null
    if (typeof hd === 'string') { try { hd = JSON.parse(hd) } catch { return null } }
    const openTime = parseInt(hd.ctime || hd.cTime || 0)
    const closeTime = parseInt(hd.mtime || hd.uTime || 0)
    if (!openTime || !closeTime || closeTime <= openTime) return null
    return (closeTime - openTime) / (1000 * 60)
}

function detectTradeType(durationMinutes) {
    const scalpMax = currentUser.value?.scalpMaxMinutes ?? 15
    const daytradeMaxMinutes = (currentUser.value?.daytradeMaxHours ?? 24) * 60
    if (durationMinutes <= scalpMax) return 'scalp'
    if (durationMinutes <= daytradeMaxMinutes) return 'day'
    return 'swing'
}

function autoDetectAndSetTradeType(pos) {
    if (pos.status !== 'pending_evaluation') return
    if (!pos.historyData) return
    if (autoDetectedTradeType.value[pos.positionId] === false) return // manual override

    const durationMin = getTradeDurationMinutes(pos)
    if (durationMin === null) return

    const detected = detectTradeType(durationMin)
    if (pos.closingTradeType !== detected) {
        pos.closingTradeType = detected
        useUpdateIncomingPosition(pos.objectId, { closingTradeType: detected })
    }
    if (autoDetectedTradeType.value[pos.positionId] === undefined) {
        autoDetectedTradeType.value[pos.positionId] = true
    }
}

function formatDuration(minutes) {
    if (minutes === null || minutes === undefined) return ''
    if (minutes < 60) return `${Math.round(minutes)}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    return `${days}d ${hours}h`
}

// ===== OPENING FIELD HANDLERS =====

function updateStress(pos, level) {
    const newLevel = pos.stressLevel === level ? 0 : level
    pos.stressLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { stressLevel: newLevel })
}

function updateEmotionLevel(pos, level) {
    const newLevel = pos.emotionLevel === level ? 0 : level
    pos.emotionLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { emotionLevel: newLevel })
}

function updateTimeframe(pos, value) {
    const newValue = pos.entryTimeframe === value ? '' : value
    pos.entryTimeframe = newValue
    useUpdateIncomingPosition(pos.objectId, { entryTimeframe: newValue })
    // Zeiteinheit gewählt → Chartbild automatisch (ersetzt nur ein selbst erzeugtes, nie ein hochgeladenes)
    if (newValue) chartBildErzeugen(pos, { auto: true })
}

// ===== CHARTBILD (automatisch) =====
/*
 * Bei der Einstiegsbewertung holt das System den Chart der gewählten
 * Zeiteinheit selbst — mit Einstieg, Stop, Ziel und, wenn ein Strategie-Tag
 * gesetzt ist (LSOB / GUSS), deren Setups samt Order Block. Das Bild liegt in
 * einem der beiden Screenshot-Felder und geht beim Abschluss wie ein
 * hochgeladenes mit ins Journal.
 * `autoBild` merkt sich je Position, welches Feld das selbst erzeugte Bild hält
 * (Name `incoming_chart_<positionId>` in der DB) — nur dieses wird ersetzt.
 */
const autoBild = ref({})       // positionId → 'entry' | 'trend'
const chartBildStand = ref({})  // positionId → { laeuft, fehler }

function einstiegsZeit(pos) {
    const d = pos.bitunixData || {}
    const t = Number(d.ctime ?? d.cTime ?? d.createTime ?? d.openTime)
    if (Number.isFinite(t) && t > 0) return t < 1e12 ? t * 1000 : t
    return pos.createdAt ? dayjs(pos.createdAt).valueOf() : Date.now()
}

async function autoSlotErmitteln(pos) {
    if (autoBild.value[pos.positionId]) return autoBild.value[pos.positionId]
    // Nach einem Neuladen: am Namen erkennen, ob ein Feld schon ein selbst erzeugtes Bild hält
    for (const [slot, id] of [['entry', pos.entryScreenshotId], ['trend', pos.trendScreenshotId]]) {
        if (!id) continue
        try { const sc = await dbGet('screenshots', id); if (sc?.name === `incoming_chart_${pos.positionId}`) return slot } catch { /* weg */ }
    }
    return null
}

async function chartBildErzeugen(pos, { auto = false } = {}) {
    if (!pos || isBotPosition(pos)) return
    const tf = chartZeiteinheit(pos.entryTimeframe)
    if (!tf) { if (!auto) chartBildStand.value[pos.positionId] = { fehler: t('incoming.chartBildTf') }; return }
    if (chartBildStand.value[pos.positionId]?.laeuft) return
    let slot = await autoSlotErmitteln(pos)
    if (!slot) slot = !pos.entryScreenshotId ? 'entry' : !pos.trendScreenshotId ? 'trend' : null
    if (!slot) { if (!auto) chartBildStand.value[pos.positionId] = { fehler: t('incoming.chartBildVoll') }; return }
    chartBildStand.value[pos.positionId] = { laeuft: true }
    try {
        await fetchPositionTpSl(pos.positionId, true, pos.broker, pos.symbol).catch(() => {})
        const { sl, tp } = getTpSlForPosition(pos.positionId)
        const strategie = strategieAusTags(pos.tags)
        const bild = await erzeugeChartBild({
            symbol: pos.symbol, interval: tf, richtung: pos.side === 'SHORT' ? 'short' : 'long',
            einstiegT: einstiegsZeit(pos), einstiegP: parseFloat(pos.entryPrice),
            sl: parseFloat(sl) || null, tp: parseFloat(tp) || null, strategie,
        })
        const sc = await dbCreate('screenshots', {
            name: `incoming_chart_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: bild, annotatedBase64: '', markersOnly: 1, maState: {},
            dateUnix: Math.floor(einstiegsZeit(pos) / 1000),
            dateUnixDay: dayjs(einstiegsZeit(pos)).utc().startOf('day').unix(),
        })
        const feld = slot === 'entry' ? 'entryScreenshotId' : 'trendScreenshotId'
        await useUpdateIncomingPosition(pos.objectId, { [feld]: sc.objectId })
        pos[feld] = sc.objectId
        ;(slot === 'entry' ? entryScreenshotPreviews : trendScreenshotPreviews).value[pos.positionId] = bild
        autoBild.value[pos.positionId] = slot
        chartBildStand.value[pos.positionId] = { laeuft: false, fehler: '' }
    } catch (e) {
        chartBildStand.value[pos.positionId] = { laeuft: false, fehler: e.response?.data?.error || e.message }
    }
}

// ===== CLOSING FIELD HANDLERS =====

function updateStrategyFollowed(pos, value) {
    const newValue = pos.strategyFollowed === value ? -1 : value
    pos.strategyFollowed = newValue
    useUpdateIncomingPosition(pos.objectId, { strategyFollowed: newValue })
}

function updateClosingStress(pos, level) {
    const newLevel = (pos.closingStressLevel || 0) === level ? 0 : level
    pos.closingStressLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { closingStressLevel: newLevel })
}

function updateClosingEmotionLevel(pos, level) {
    const newLevel = (pos.closingEmotionLevel || 0) === level ? 0 : level
    pos.closingEmotionLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { closingEmotionLevel: newLevel })
}

function updateClosingTimeframe(pos, value) {
    const newValue = (pos.closingTimeframe || '') === value ? '' : value
    pos.closingTimeframe = newValue
    useUpdateIncomingPosition(pos.objectId, { closingTimeframe: newValue })
}

// ===== BOT DETECTION =====
// Erkennung in `src/utils/positionTpsl.js` (auch der Chart filtert damit).
// Für Bots wird eine schlankere Bewertungsmaske gezeigt (langfristige,
// automatisierte Bots).
const isBotPosition = istBotPosition

// Pendente Trades zeigen ALLE Börsen gleichzeitig, gruppiert je Börse mit
// Futures zuerst, dann Bots — unabhängig vom Futures/Bot-Filter
// (selectedTradeCategory wird hier bewusst ignoriert).
const BROKER_ORDER = ['bitunix', 'bitget', 'pionex']
const orderedPositions = computed(() => {
    const present = [...new Set(incomingPositions.map(p => p.broker || 'unbekannt'))]
    const ordered = [
        ...BROKER_ORDER.filter(b => present.includes(b)),
        ...present.filter(b => !BROKER_ORDER.includes(b)),
    ]
    const out = []
    for (const b of ordered) {
        const ofBroker = incomingPositions.filter(p => (p.broker || 'unbekannt') === b)
        out.push(...ofBroker.filter(p => !isBotPosition(p)))   // Futures zuerst
        out.push(...ofBroker.filter(p => isBotPosition(p)))    // dann Bots
    }
    return out
})

// Überschriften an Gruppengrenzen: vergleiche aktuelles mit vorherigem Element.
function brokerLabelOf(b) { return brokers.find(x => x.value === b)?.label || b || 'Unbekannt' }

/*
 * Börsen, die beim letzten Abruf nichts lieferten.
 *
 * Der Hinweis steht hier und nicht im bestehenden Fehlerkasten, weil der nur
 * beim Totalausfall erscheint. Der gefährlichere Fall ist der einzelne:
 * Eine von drei Börsen antwortet nicht, die Seite füllt sich mit den anderen
 * beiden, und dass etwas fehlt, sieht man an nichts.
 */
const brokerFehler = computed(() => incomingBrokerFehler.value.map(f => ({
    ...f,
    name: brokerLabelOf(f.broker),
})))

/*
 * Einmal auch als Browser-Meldung — die erreicht den Nutzer, während die Seite
 * offen, aber nicht im Blick ist. Entprellt über localStorage und je Börse,
 * sonst meldet sich der Minutentakt sechzigmal in der Stunde.
 */
const MELDE_ABSTAND_MS = 6 * 60 * 60 * 1000
watch(brokerFehler, (liste) => {
    for (const f of liste) {
        const schluessel = 'incoming_boerse_notif_' + f.broker
        const zuletzt = Number(localStorage.getItem(schluessel)) || 0
        if (Date.now() - zuletzt < MELDE_ABSTAND_MS) continue
        localStorage.setItem(schluessel, String(Date.now()))
        sendNotification('boerseKeinZugang', t('incoming.brokerAusfall', { boerse: f.name }), f.meldung)
    }
})
function brokerHeaderAt(idx) {
    const cur = orderedPositions.value[idx], prev = orderedPositions.value[idx - 1]
    if (!cur) return null
    return (!prev || (prev.broker || '') !== (cur.broker || '')) ? brokerLabelOf(cur.broker) : null
}
function sectionHeaderAt(idx) {
    const cur = orderedPositions.value[idx], prev = orderedPositions.value[idx - 1]
    if (!cur) return null
    const curSec = isBotPosition(cur) ? 'bot' : 'futures'
    const same = prev && (prev.broker || '') === (cur.broker || '') && (isBotPosition(prev) ? 'bot' : 'futures') === curSec
    return same ? null : (curSec === 'bot' ? t('incoming.botsSection') : t('incoming.futuresSection'))
}

// Realisierter PnL einer geschlossenen Position für den Karten-Header.
// Bots liefern kein realizedPNL (normalizeBotOrder) → Fallback auf
// totalRealizedProfit / gridProfit.
function closedPnL(pos) {
    const hd = pos?.historyData
    if (!hd) return null
    const v = hd.realizedPNL ?? hd.totalRealizedProfit ?? hd.gridProfit
    return (v === null || v === undefined || v === '') ? null : v
}

// ===== TAG HANDLERS =====

function addTag(pos, tag) {
    // Ensure opening and closing tags don't share the same reference
    if (pos.tags === pos.closingTags) pos.closingTags = Array.isArray(pos.closingTags) ? JSON.parse(JSON.stringify(pos.closingTags)) : []
    if (!Array.isArray(pos.tags)) pos.tags = []
    if (pos.tags.some(t => t.id === tag.id)) return
    const vorher = strategieAusTags(pos.tags)
    pos.tags.push({ id: tag.id, name: tag.name })
    // Strategie-Tag (LSOB/GUSS) dazu → Chartbild mit deren Setups neu, wenn eine Zeiteinheit steht
    if (strategieAusTags(pos.tags) !== vorher && pos.entryTimeframe) chartBildErzeugen(pos, { auto: true })
}

function removeTag(pos, idx) {
    if (!pos.tags) return
    pos.tags.splice(idx, 1)
}

function addClosingTag(pos, tag) {
    // Ensure opening and closing tags don't share the same reference
    if (pos.closingTags === pos.tags) pos.tags = Array.isArray(pos.tags) ? JSON.parse(JSON.stringify(pos.tags)) : []
    if (!Array.isArray(pos.closingTags)) pos.closingTags = []
    if (pos.closingTags.some(t => t.id === tag.id)) return
    pos.closingTags.push({ id: tag.id, name: tag.name })
}

function removeClosingTag(pos, idx) {
    if (!pos.closingTags) return
    pos.closingTags.splice(idx, 1)
}

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

// ===== SATISFACTION HANDLER =====

function updateSatisfaction(pos, val) {
    pos.satisfaction = pos.satisfaction === val ? null : val
    useUpdateIncomingPosition(pos.objectId, { satisfaction: pos.satisfaction })
}

// ===== SCREENSHOT HANDLERS =====

// Nimmt ein Input-Event ODER direkt eine Datei (Drag&Drop / Zwischenablage).
function dateiAus(evtOderDatei) {
    return evtOderDatei?.target?.files ? evtOderDatei.target.files[0] : evtOderDatei
}
function ersteBilddatei(list) {
    return [...(list || [])].find(f => f && f.type && f.type.startsWith('image/')) || null
}
// Base64-Daten-URL → File, damit die Upload-Handler sie annehmen.
function dataUrlZuDatei(dataUrl, name) {
    const [meta, b64] = String(dataUrl).split(',')
    const mime = (meta.match(/:(.*?);/) || [, 'image/png'])[1]
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new File([arr], (name || 'screenshot') + '.png', { type: mime })
}
// Legt die Datei in den passenden Handler je Feld (entry/trend/closing).
function screenshotAusDatei(file, pos, slot) {
    if (!file || !pos) return
    if (slot === 'entry') handleEntryScreenshotUpload(file, pos)
    else if (slot === 'trend') handleTrendScreenshotUpload(file, pos)
    else if (slot === 'closing') handleClosingScreenshotUpload(file, pos)
}
const dragSlot = ref('')  // '<positionId>:<slot>' der überzogenen Zone
function onDropScreenshot(e, pos, slot) {
    dragSlot.value = ''
    screenshotAusDatei(ersteBilddatei(e.dataTransfer?.files), pos, slot)
}
// „Kopiertes Bild einfügen": holt das auf der Screenshots-Seite kopierte Bild
// frisch aus der DB (gemerkt ist nur die ID) und legt es ins Feld.
async function kopiertesBildEinfuegen(pos, slot) {
    const merk = kopiertesBild.value
    if (!merk?.objectId) return
    let b64 = ''
    try {
        const src = await dbGet('screenshots', merk.objectId)
        b64 = src?.annotatedBase64 || src?.originalBase64 || ''
    } catch (e) { /* nicht gefunden */ }
    if (!b64) return
    screenshotAusDatei(dataUrlZuDatei(b64, merk.name), pos, slot)
}
// Einfügen (Strg/Cmd+V): geht an die gerade aufgeklappte Position, erstes freies
// Feld (Einstieg → Trend → Abschluss).
function onPasteIncoming(e) {
    if (!expandedId.value) return
    const imgItem = [...(e.clipboardData?.items || [])].find(it => it.type && it.type.startsWith('image/'))
    if (!imgItem) return
    const file = imgItem.getAsFile()
    if (!file) return
    const pos = incomingPositions.find(p => p.positionId === expandedId.value)
    if (!pos) return
    e.preventDefault()
    if (!pos.entryScreenshotId) screenshotAusDatei(file, pos, 'entry')
    else if (!pos.trendScreenshotId) screenshotAusDatei(file, pos, 'trend')
    else if (!pos.closingScreenshotId) screenshotAusDatei(file, pos, 'closing')
}
onMounted(() => { window.addEventListener('paste', onPasteIncoming) })
onBeforeUnmount(() => { window.removeEventListener('paste', onPasteIncoming) })

async function handleEntryScreenshotUpload(event, pos) {
    const file = dateiAus(event)
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_entry_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { entryScreenshotId: screenshot.objectId })
        pos.entryScreenshotId = screenshot.objectId
        entryScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeEntryScreenshot(pos) {
    if (pos.entryScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { entryScreenshotId: '' })
        pos.entryScreenshotId = ''
        delete entryScreenshotPreviews.value[pos.positionId]
    }
}

async function handleTrendScreenshotUpload(event, pos) {
    const file = dateiAus(event)
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_trend_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { trendScreenshotId: screenshot.objectId })
        pos.trendScreenshotId = screenshot.objectId
        trendScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeTrendScreenshot(pos) {
    if (pos.trendScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { trendScreenshotId: '' })
        pos.trendScreenshotId = ''
        delete trendScreenshotPreviews.value[pos.positionId]
    }
}

async function loadScreenshotPreviews(pos) {
    // Entry-Screenshot laden
    if (pos.entryScreenshotId && !entryScreenshotPreviews.value[pos.positionId]) {
        try {
            const result = await dbGet('screenshots', pos.entryScreenshotId)
            if (result) entryScreenshotPreviews.value[pos.positionId] = result.annotatedBase64 || result.originalBase64
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
    // Trend-Screenshot laden
    if (pos.trendScreenshotId && !trendScreenshotPreviews.value[pos.positionId]) {
        try {
            const result = await dbGet('screenshots', pos.trendScreenshotId)
            if (result) trendScreenshotPreviews.value[pos.positionId] = result.annotatedBase64 || result.originalBase64
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
    // Closing-Screenshot laden
    if (pos.closingScreenshotId && !closingScreenshotPreviews.value[pos.positionId]) {
        try {
            const result = await dbGet('screenshots', pos.closingScreenshotId)
            if (result) closingScreenshotPreviews.value[pos.positionId] = result.annotatedBase64 || result.originalBase64
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
}

async function handleClosingScreenshotUpload(event, pos) {
    const file = dateiAus(event)
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_closing_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { closingScreenshotId: screenshot.objectId })
        pos.closingScreenshotId = screenshot.objectId
        closingScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeClosingScreenshot(pos) {
    if (pos.closingScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { closingScreenshotId: '' })
        pos.closingScreenshotId = ''
        delete closingScreenshotPreviews.value[pos.positionId]
    }
}

// ===== SAVE / COMPLETE =====

async function saveMetadata(pos) {
    savingId.value = pos.objectId
    const data = {
        feelings: pos.feelings || '',
        stressLevel: pos.stressLevel || 0,
        emotionLevel: pos.emotionLevel || 0,
        entryTimeframe: pos.entryTimeframe || '',
        tradeType: pos.tradeType || '',
        closingTradeType: pos.closingTradeType || '',
        tags: JSON.parse(JSON.stringify(pos.tags || [])),
        skipEvaluation: pos.skipEvaluation || 0,
        satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
        // Closing fields
        strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
        closingStressLevel: pos.closingStressLevel || 0,
        closingEmotionLevel: pos.closingEmotionLevel || 0,
        closingFeelings: pos.closingFeelings || '',
        closingTimeframe: pos.closingTimeframe || '',
        closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
    }

    // Get opening Quill content
    const openingKey = pos.positionId + '_opening'
    if (quillInstances[openingKey]) {
        data.playbook = quillInstances[openingKey].root.innerHTML
    }

    // Get closing Quill content
    const closingKey = pos.positionId + '_closing'
    if (quillInstances[closingKey]) {
        data.closingPlaybook = quillInstances[closingKey].root.innerHTML
    }

    try {
        await useUpdateIncomingPosition(pos.objectId, data)
    } catch (error) {
        // Sichtbar wird der Fehler zentral (db.js-Hinweis). Hier zählt der
        // Zustand: savingId muss zurück, sonst bleibt der Knopf bis zum
        // Neuladen auf «Speichert»; Editor und Quill-Inhalte bleiben stehen.
        console.error(' -> Incoming saveMetadata Fehler:', error)
        savingId.value = null
        return
    }

    // Save Quill content to pos
    if (data.playbook) pos.playbook = data.playbook
    if (data.closingPlaybook) pos.closingPlaybook = data.closingPlaybook

    // If "Trade nicht bewerten" is checked and position is pending_evaluation,
    // just delete the incoming position — NO notes/satisfactions/tags transfer,
    // so the trade stays "unbewertet" in Settings and won't appear in Playbook.
    if (pos.skipEvaluation === 1 && pos.status === 'pending_evaluation') {
        try {
            await useDeleteIncomingPosition(pos.objectId)
        } catch (error) {
            console.error('Error skipping evaluation:', error)
        }
    }

    savingId.value = null
    delete quillInstances[openingKey]
    delete quillInstances[closingKey]
    expandedId.value = null
}

const closingId = ref(null)

async function completeClosingEvaluation(pos) {
    if (!pos.historyData || pos.status !== 'pending_evaluation') return

    closingId.value = pos.objectId

    try {
        // First save any unsaved metadata (deep-copy tags to prevent shared references)
        const data = {
            feelings: pos.feelings || '',
            stressLevel: pos.stressLevel || 0,
            emotionLevel: pos.emotionLevel || 0,
            entryTimeframe: pos.entryTimeframe || '',
            tradeType: pos.tradeType || '',
            closingTradeType: pos.closingTradeType || '',
            tags: JSON.parse(JSON.stringify(pos.tags || [])),
            satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
            strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
            closingStressLevel: pos.closingStressLevel || 0,
            closingEmotionLevel: pos.closingEmotionLevel || 0,
            closingFeelings: pos.closingFeelings || '',
            closingTimeframe: pos.closingTimeframe || '',
            closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
        }
        const openingKey = pos.positionId + '_opening'
        const closingKey = pos.positionId + '_closing'
        if (quillInstances[openingKey]) {
            data.playbook = quillInstances[openingKey].root.innerHTML
            pos.playbook = data.playbook
        }
        if (quillInstances[closingKey]) {
            data.closingPlaybook = quillInstances[closingKey].root.innerHTML
            pos.closingPlaybook = data.closingPlaybook
        }
        await useUpdateIncomingPosition(pos.objectId, data)

        // Bots: keine SL/TP/RRR/Fill-Metadaten (automatisiert, langfristig) → überspringen.
        const isBot = isBotPosition(pos)
        let tradingMeta = null
        if (!isBot) {

        // Ensure fills are loaded before building metadata
        if (!positionFills.value[pos.positionId]?.trades?.length) {
            await fetchPositionFills(pos.positionId, true, pos.broker || 'bitunix', pos.symbol || '')
        }

        // Build trading metadata for AI review
        const tpsl = getTpSlForPosition(pos.positionId)
        const fillData = getFillsForPosition(pos.positionId)
        const bePrice = getBreakevenPrice(pos.positionId, pos.side)
        const slAboveBe = isSLAboveBreakeven(pos.positionId, pos.side)
        const margin = parseFloat(pos.bitunixData?.margin || 0)
        const leverage = parseFloat(pos.leverage || 1)
        const tpslHistory = getTpSlHistoryForPosition(pos.positionId)

        const rrr = getRRR(pos.positionId, pos.side)

        tradingMeta = {
            sl: tpsl.sl || null,
            tp: tpsl.tp || null,
            slQty: tpsl.slQty || null,
            tpQty: tpsl.tpQty || null,
            breakeven: bePrice > 0 ? parseFloat(bePrice.toFixed(5)) : null,
            slAboveBreakeven: slAboveBe,
            rrr: rrr ? parseFloat(rrr) : null,
            margin: margin,
            leverage: leverage,
            positionSize: parseFloat((margin * leverage).toFixed(2)),
            fills: (fillData.trades || []).map(f => ({
                time: f.ctime,
                qty: parseFloat(f.qty || 0),
                price: parseFloat(f.price || 0),
                fee: parseFloat(f.fee || 0),
                reduceOnly: !!f.reduceOnly,
                side: f.side
            })),
            tpslHistory: (() => {
                // Filter out entries recorded after the last fill (position close artifacts)
                const fills = (fillData.trades || [])
                const lastFillTime = fills.length > 0
                    ? Math.max(...fills.map(f => parseInt(f.ctime || 0)))
                    : 0
                const cutoff = lastFillTime ? lastFillTime + 60000 : Infinity
                return tpslHistory
                    .filter(h => h.time <= cutoff)
                    .map(h => ({
                        time: h.time,
                        type: h.type,
                        action: h.action,
                        oldVal: h.oldVal,
                        newVal: h.newVal,
                        qty: h.qty || 0,
                        posQty: h.posQty || 0,
                        rrr: h.rrr || null
                    }))
            })()
        }
        } // /if (!isBot)

        // Transfer metadata to trade record and delete incoming position
        await useTransferClosingMetadata(
            pos,
            pos.historyData,
            {
                note: '',
                tags: JSON.parse(JSON.stringify(pos.tags || [])),
                satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
                stressLevel: pos.stressLevel || 0,
                tradeType: pos.tradeType || '',
                closingTradeType: pos.closingTradeType || '',
                strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
                closingNote: pos.closingPlaybook || '',
                closingStressLevel: pos.closingStressLevel || 0,
                closingEmotionLevel: pos.closingEmotionLevel || 0,
                closingFeelings: pos.closingFeelings || '',
                closingTimeframe: pos.closingTimeframe || '',
                closingPlaybook: pos.closingPlaybook || '',
                closingScreenshotId: pos.closingScreenshotId || '',
                closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
                tradingMetadata: tradingMeta,
            }
        )

        // Remove from local list
        const idx = incomingPositions.findIndex(p => p.objectId === pos.objectId)
        if (idx !== -1) {
            incomingPositions.splice(idx, 1)
        }

        delete quillInstances[openingKey]
        delete quillInstances[closingKey]
        expandedId.value = null
    } catch (error) {
        console.error('Error completing evaluation:', error)
        alert(t('common.errorPrefix') + (error?.response?.data?.error || error.message || t('common.error')))
    } finally {
        closingId.value = null
    }
}

// ===== FORMATTING =====

function formatCurrency(val, unit = 'USDT') {
    const num = parseFloat(val || 0)
    // Coin-M-Bots werden in der Margin-Münze (z.B. SOL) mit mehr Nachkommastellen
    // angezeigt; USDT bleibt bei 2.
    const dec = unit && unit !== 'USDT' ? 4 : 2
    return (num >= 0 ? '+' : '') + num.toFixed(dec) + ' ' + unit
}

// Realized PnL for an open position (already booked via partial TPs).
// Reads directly from broker raw data (no extra fetch needed).
function getOpenRealizedPnL(pos) {
    const d = pos?.bitunixData || {}
    const raw = d.realizedPNL ?? d.realized_pnl ?? d.realizedPnl ?? d.realizedPL ?? d.achievedProfits ?? 0
    const num = parseFloat(raw)
    return Number.isFinite(num) ? num : 0
}

function formatTime(date) {
    if (!date) return ''
    return dayjs(date).tz(timeZoneTrade.value).format('HH:mm:ss')
}

function getPositionDate(pos) {
    const ctime = pos.bitunixData?.ctime
    if (ctime) {
        return dayjs(parseInt(ctime)).tz(timeZoneTrade.value).format('DD.MM.YYYY')
    }
    if (pos.createdAt) {
        return dayjs(pos.createdAt).format('DD.MM.YYYY')
    }
    return ''
}
</script>


<template>
    <div class="incoming-seite">
        <div v-show="!seiteLaedt">
            <!-- Header -->
            <div class="incoming-kopf">
                <div class="incoming-kopf-stand">
                    <small v-if="incomingLastFetched" class="at-gedaempft">
                        {{ t('incoming.lastUpdated') }} {{ formatTime(incomingLastFetched) }}
                        <Kreisel v-if="incomingPollingActive" class="abstand-links" />
                    </small>
                </div>
                <div class="incoming-kopf-aktionen">
                    <Knopf klein symbol="aktualisieren" @click="manualRefresh" :disabled="incomingPollingActive">
                        {{ t('incoming.refresh') }}
                    </Knopf>
                    <PageInfo section="info.pendente" />
                </div>
            </div>

            <!-- Error — beim Börsenausfall übernimmt der Kasten darunter, sonst
                 stünde dieselbe Meldung zweimal da (einmal rot, einmal gelb). -->
            <Hinweis v-if="incomingError && !brokerFehler.length" art="fehler" class="incoming-hinweis">{{ incomingError }}</Hinweis>

            <!-- Börse antwortet nicht: je Börse eine Zeile, solange es anhält -->
            <Hinweis v-for="f in brokerFehler" :key="'boerse_' + f.broker" art="warn" class="incoming-hinweis">
                <strong>{{ t('incoming.brokerAusfall', { boerse: f.name }) }}</strong>
                <span v-if="f.teilweise"> {{ t('incoming.brokerTeilausfall') }}</span>
                <div class="hinweis-zeile hinweis-leise">{{ f.meldung }}</div>
                <div class="hinweis-zeile">{{ t('incoming.brokerAusfallHinweis') }}</div>
            </Hinweis>

            <!-- No positions -->
            <NoData v-if="orderedPositions.length === 0 && !incomingError && !brokerFehler.length" />

            <!-- Position cards: gruppiert je Börse (Titel) → Futures, dann Bots -->
            <template v-for="(pos, idx) in orderedPositions" :key="(pos.broker || '') + '_' + pos.positionId">
            <h4 v-if="brokerHeaderAt(idx)" class="incoming-broker-title">{{ brokerHeaderAt(idx) }}</h4>
            <h6 v-if="sectionHeaderAt(idx)" class="incoming-section-title">{{ sectionHeaderAt(idx) }}</h6>
            <div class="dailyCard incoming-card pos-karte">
                <!-- Card header -->
                <div class="karten-kopf pointerClass" @click="toggleExpand(pos.positionId)">
                    <div class="karten-kopf-links">
                        <strong class="symbol-name">{{ pos.symbol }}</strong>
                        <span class="seite" :class="displaySide(pos.side) === 'LONG' ? 'greenTrade' : (displaySide(pos.side) === 'NEUTRAL' ? 'at-gedaempft' : 'redTrade')">
                            {{ displaySide(pos.side) }}
                        </span>
                        <span class="incoming-info">{{ pos.leverage }}x</span>
                        <Pille v-if="pos.coinM" ton="warn">COIN-M</Pille>
                        <Pille v-if="pos.status === 'pending_evaluation'" ton="warn">{{ t('incoming.closed') }}</Pille>
                    </div>
                    <div class="karten-kopf-pnl">
                        <span v-if="pos.status === 'pending_evaluation' && closedPnL(pos) != null"
                            class="incoming-pnl fett"
                            :class="parseFloat(closedPnL(pos)) >= 0 ? 'greenTrade' : 'redTrade'">
                            {{ formatCurrency(closedPnL(pos)) }}
                        </span>
                        <template v-else>
                            <span class="incoming-pnl" :class="parseFloat(pos.unrealizedPNL || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ formatCurrency(pos.unrealizedPNL, pos.marginCoin) }}
                            </span>
                            <div v-if="getOpenRealizedPnL(pos) !== 0" class="klein-text realisiert"
                                :class="getOpenRealizedPnL(pos) >= 0 ? 'greenTrade' : 'redTrade'">
                                <span class="at-gedaempft abstand-rechts">{{ t('incoming.realized') }}</span>{{ formatCurrency(getOpenRealizedPnL(pos)) }}
                            </div>
                        </template>
                    </div>
                    <div class="karten-kopf-pfeil">
                        <Symbol :name="expandedId === pos.positionId ? 'hoch' : 'runter'" :groesse="22" />
                    </div>
                </div>

                <!-- Trade info line -->
                <div class="info-zeile">
                    <small class="incoming-info">
                        {{ t('incoming.entry') }}
                        <!-- Bots: Startpreis (Bot-Start) + Ø Haltepreis (driftet). Futures: bisher. -->
                        <template v-if="isBotPosition(pos)">
                            <span v-if="parseFloat(pos.bitunixData?.startPrice) > 0">Start {{ parseFloat(pos.bitunixData.startPrice).toFixed(2) }} · </span>Ø {{ parseFloat(pos.entryPrice || 0).toFixed(2) }}
                        </template>
                        <template v-else-if="getEntryFills(pos.positionId, pos.side).length > 1">
                            Ø {{ getAvgEntryPrice(pos.positionId, pos.side).toFixed(5) }} ({{ getEntryFills(pos.positionId, pos.side).length }}×)
                        </template>
                        <template v-else>
                            {{ parseFloat(pos.entryPrice || 0).toFixed(2) }}
                        </template>
                        <template v-if="getBreakevenPrice(pos.positionId, pos.side) > 0">
                            | <span class="at-gedaempft">BE: {{ getBreakevenPrice(pos.positionId, pos.side).toFixed(2) }}</span>
                        </template>
                        <template v-if="getTpSlForPosition(pos.positionId).sl">
                            | <span :class="isSLAboveBreakeven(pos.positionId, pos.side) ? 'at-gut' : 'at-schlecht'">SL: {{ getTpSlForPosition(pos.positionId).sl }}</span>
                        </template>
                        <template v-if="getTpSlForPosition(pos.positionId).tp">
                            | <span class="at-warn">TP: {{ getTpSlForPosition(pos.positionId).tp }}</span>
                        </template>
                        <!-- Bots: echte Liquidation + Investment in Margin-Münze (coin-M: z.B. SOL);
                             Futures: bisheriges Verhalten (markPrice als Liq, Marge in USDT). -->
                        <template v-if="isBotPosition(pos)">
                            <span v-if="parseFloat(pos.bitunixData?.liqPrice) > 0"> | {{ t('incoming.liquidation') }} {{ parseFloat(pos.bitunixData.liqPrice).toFixed(2) }}</span>
                            <span v-if="parseFloat(pos.bitunixData?.margin) > 0"> | {{ t('incoming.margin') }} {{ parseFloat(pos.bitunixData.margin).toFixed(pos.coinM ? 4 : 2) }} {{ pos.marginCoin || 'USDT' }}</span>
                            <span v-if="parseFloat(pos.markPrice) > 0"> | {{ t('incoming.marketPrice') }} {{ parseFloat(pos.markPrice).toFixed(2) }}</span>
                        </template>
                        <template v-else>
                            <span v-if="pos.markPrice"> | {{ t('incoming.liquidation') }} {{ parseFloat(pos.markPrice || 0).toFixed(2) }}</span>
                            | {{ t('incoming.margin') }} {{ parseFloat(pos.bitunixData?.margin || 0).toFixed(2) }} USDT
                        </template>
                        <span v-if="getPositionDate(pos)"> | {{ getPositionDate(pos) }}</span>
                    </small>
                </div>

                <!-- Stress level indicator (always visible if set) -->
                <div v-if="pos.stressLevel > 0 && expandedId !== pos.positionId" class="stress-zeile">
                    <small class="incoming-info">{{ t('incoming.stress') }} </small>
                    <template v-for="n in 10" :key="n">
                        <span class="stress-dot" :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                            <span class="stress-number">{{ n }}</span>&#x25CF;
                        </span>
                        <span v-if="n < 10" class="stress-dot stress-spacer" :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                            <span class="stress-number">&nbsp;</span>&#x25CF;
                        </span>
                    </template>
                </div>

                <!-- ===== EXPANDED DETAIL SECTION ===== -->
                <div v-if="expandedId === pos.positionId" class="incoming-meta-section detail-bereich">

                    <!-- ========== FILLS / COMPOUND TRACKING ========== -->
                    <div v-if="pos.status === 'open' && (pos.broker === 'bitunix' || pos.broker === 'bitget')" class="fills-section abschnitt">
                        <div class="fills-kopf">
                            <span class="abschnitt-titel">
                                <Symbol name="ebenen" />
                                {{ t('incoming.fills') }}
                                <span v-if="getEntryFills(pos.positionId, pos.side).length > 1"
                                    class="at-gedaempft">({{ getEntryFills(pos.positionId, pos.side).length }} {{ t('incoming.fillEntries') }})</span>
                            </span>
                            <span v-if="getEntryFills(pos.positionId, pos.side).length > 0" class="fett fills-schnitt">
                                {{ t('incoming.fillAvgPrice') }}: {{ getAvgEntryPrice(pos.positionId, pos.side).toFixed(5) }}
                            </span>
                        </div>

                        <!-- Loading -->
                        <div v-if="getFillsForPosition(pos.positionId).loading" class="at-gedaempft klein-text">
                            <Kreisel :groesse="11" still class="abstand-rechts" />
                            Loading...
                        </div>

                        <!-- Error -->
                        <div v-else-if="getFillsForPosition(pos.positionId).error" class="at-schlecht klein-text">
                            {{ getFillsForPosition(pos.positionId).error }}
                        </div>

                        <!-- Fills table -->
                        <div v-else-if="getFillsForPosition(pos.positionId).trades.length > 0">
                            <div class="fills-huelle">
                            <table class="fills-tabelle">
                                <tbody>
                                    <template v-for="(group, gIdx) in groupFillsByMinute(getFillsForPosition(pos.positionId).trades, 'ctime')" :key="group.key">
                                        <tr :class="group.reduceOnly ? 'at-schlecht' : ''"
                                            :style="group.isGroup ? 'cursor: pointer;' : ''"
                                            @click="group.isGroup && toggleFillGroup(group.key)">
                                            <td class="at-gedaempft zelle-zeit">
                                                <span v-if="group.isGroup" class="gruppen-pfeil">{{ expandedFillGroups.has(group.key) ? '▼' : '▶' }}</span>
                                                {{ formatFillTime(group.time) }}
                                            </td>
                                            <td class="zahl zelle-menge">{{ group.totalQty }}</td>
                                            <td class="at-gedaempft zelle-op">×</td>
                                            <td class="zelle-preis">{{ group.isGroup ? group.avgPrice.toFixed(5) : parseFloat(group.fills[0].price) }}</td>
                                            <td class="at-gedaempft zelle-op">=</td>
                                            <td class="zahl zelle-preis">{{ group.totalValue.toFixed(2) }}</td>
                                            <td>
                                                <Pille v-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'close'"
                                                    ton="schlecht">{{ t('incoming.fillClose') }}</Pille>
                                                <Pille v-else-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'partialClose'"
                                                    ton="warn">{{ t('incoming.fillPartialClose') }}</Pille>
                                                <Pille v-else-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'initial'"
                                                    ton="neutral">{{ t('incoming.fillInitial') }}</Pille>
                                                <Pille v-else ton="akzent">{{ t('incoming.fillCompound') }}</Pille>
                                                <span v-if="group.isGroup" class="at-gedaempft gruppen-zahl">({{ group.fills.length }})</span>
                                            </td>
                                            <td class="zahl at-gedaempft zelle-gebuehr">{{ t('incoming.fillFee') }}: {{ group.totalFee.toFixed(4) }}</td>
                                        </tr>
                                        <template v-if="group.isGroup && expandedFillGroups.has(group.key)">
                                            <tr v-for="(fill, fIdx) in group.fills" :key="group.key + '_' + fIdx"
                                                class="fill-einzeln" :class="fill.reduceOnly ? 'at-schlecht' : ''">
                                                <td class="zelle-zeit"></td>
                                                <td class="zahl zelle-menge">{{ parseFloat(fill.qty) }}</td>
                                                <td class="at-gedaempft zelle-op">×</td>
                                                <td class="zelle-preis">{{ parseFloat(fill.price) }}</td>
                                                <td class="at-gedaempft zelle-op">=</td>
                                                <td class="zahl zelle-preis">{{ (parseFloat(fill.qty) * parseFloat(fill.price)).toFixed(2) }}</td>
                                                <td></td>
                                                <td class="zahl at-gedaempft zelle-gebuehr">{{ t('incoming.fillFee') }}: {{ parseFloat(fill.fee || 0).toFixed(4) }}</td>
                                            </tr>
                                        </template>
                                    </template>
                                </tbody>
                            </table>
                            </div>
                            <!-- Totals row -->
                            <div v-if="getFillsForPosition(pos.positionId).trades.length > 0"
                                class="summen-zeile">
                                <span class="at-gedaempft">
                                    {{ t('incoming.fillTotal') }}:
                                    <strong class="hell">{{ getEntryFills(pos.positionId, pos.side).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0) }}</strong>
                                </span>
                                <span class="at-gedaempft">
                                    {{ t('incoming.fillFee') }}:
                                    <strong class="hell">{{ getFillsForPosition(pos.positionId).trades.reduce((sum, f) => sum + parseFloat(f.fee || 0), 0).toFixed(4) }}</strong>
                                </span>
                            </div>
                            <!-- Position Size: Marge × Hebel -->
                            <div class="summen-zeile">
                                <span class="at-gedaempft">
                                    {{ t('incoming.positionSize') }}:
                                    <span class="hell">{{ parseFloat(pos.bitunixData?.margin || 0).toFixed(2) }}</span>
                                    <span class="at-gedaempft"> × </span>
                                    <span class="hell">{{ pos.leverage }}x</span>
                                    <span class="at-gedaempft"> = </span>
                                    <strong class="hell">{{ (parseFloat(pos.bitunixData?.margin || 0) * parseFloat(pos.leverage || 1)).toFixed(2) }} USDT</strong>
                                </span>
                            </div>
                        </div>

                        <!-- TP/SL Orders + BE -->
                        <div v-if="getTpSlForPosition(pos.positionId).sl || getTpSlForPosition(pos.positionId).tp || getBreakevenPrice(pos.positionId, pos.side) > 0"
                            class="tpsl-zeile">
                            <span v-if="getTpSlForPosition(pos.positionId).sl">
                                <span class="fett" :class="isSLAboveBreakeven(pos.positionId, pos.side) ? 'at-gut' : 'at-schlecht'">SL: {{ getTpSlForPosition(pos.positionId).sl }}</span>
                                <span class="at-gedaempft abstand-links">({{ getTpSlForPosition(pos.positionId).slQty }})</span>
                            </span>
                            <span v-if="getBreakevenPrice(pos.positionId, pos.side) > 0">
                                <span class="at-gedaempft fett">BE: {{ getBreakevenPrice(pos.positionId, pos.side).toFixed(2) }}</span>
                            </span>
                            <span v-if="getTpSlForPosition(pos.positionId).tp">
                                <span class="fett at-warn">TP: {{ getTpSlForPosition(pos.positionId).tp }}</span>
                                <span class="at-gedaempft abstand-links">({{ getTpSlForPosition(pos.positionId).tpQty }})</span>
                            </span>
                            <span v-if="getRRR(pos.positionId, pos.side)" class="rechts-aussen">
                                <span class="fett rrr">RRR 1:{{ getRRR(pos.positionId, pos.side) }}</span>
                            </span>
                        </div>

                        <!-- TP/SL Change History -->
                        <div v-if="getTpSlHistoryForPosition(pos.positionId).length > 0"
                            class="tpsl-verlauf">
                            <div class="at-gedaempft tpsl-verlauf-kopf pointerClass" @click.stop="toggleTpSlHistory(pos.positionId)">
                                <Symbol name="verlauf" />SL/TP Protokoll
                                <Symbol :name="tpslCollapsedIds.includes(pos.positionId) ? 'runter' : 'hoch'" :groesse="18" />
                            </div>
                            <template v-if="!tpslCollapsedIds.includes(pos.positionId)">
                                <div v-for="(entry, idx) in getTpSlHistoryForPosition(pos.positionId)" :key="idx"
                                    class="tpsl-eintrag">
                                    <span class="at-gedaempft tpsl-zeit">{{ dayjs(entry.time).tz(timeZoneTrade.value).format('DD.MM. HH:mm') }}</span>
                                    <span :class="entry.type === 'SL' ? (isSLAboveBreakeven(pos.positionId, pos.side) ? 'at-gut' : 'at-schlecht') : (entry.action === 'triggered' ? 'at-gut fett' : (entry.type === 'TP' ? 'at-warn' : ''))">
                                        {{ entry.type }}
                                    </span>
                                    <template v-if="entry.action === 'set'">
                                        <span class="at-gedaempft">→</span>
                                        <span class="hell">{{ entry.newVal }}</span>
                                        <span v-if="entry.qty && getTpSlEntryDisplay(entry, pos.quantity)" class="at-gedaempft">({{ getTpSlEntryDisplay(entry, pos.quantity).qty }} · {{ getTpSlEntryDisplay(entry, pos.quantity).pct }}%)</span>
                                        <Pille ton="neutral">Gesetzt</Pille>
                                    </template>
                                    <template v-else-if="entry.action === 'moved'">
                                        <span class="at-gedaempft durchgestrichen">{{ entry.oldVal }}</span>
                                        <span class="at-gedaempft">→</span>
                                        <span class="hell">{{ entry.newVal }}</span>
                                        <span v-if="entry.qty && getTpSlEntryDisplay(entry, pos.quantity)" class="at-gedaempft">({{ getTpSlEntryDisplay(entry, pos.quantity).qty }} · {{ getTpSlEntryDisplay(entry, pos.quantity).pct }}%)</span>
                                        <Pille ton="warn">Verschoben</Pille>
                                    </template>
                                    <template v-else-if="entry.action === 'triggered'">
                                        <span class="at-gut durchgestrichen">{{ entry.oldVal }}</span>
                                        <span class="at-gut">→</span>
                                        <span class="at-gut fett">Ausgelöst ✓</span>
                                    </template>
                                    <template v-else-if="entry.action === 'removed'">
                                        <span class="at-gedaempft durchgestrichen">{{ entry.oldVal }}</span>
                                        <span class="at-gedaempft">→ entfernt</span>
                                    </template>
                                    <span v-if="entry.rrr" class="rechts-aussen rrr">1:{{ entry.rrr }}</span>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ========== OPENING EVALUATION (nur Futures, nicht für Bots) ========== -->
                    <div v-if="!isBotPosition(pos)" class="opening-eval-section abschnitt">
                    <div class="abschnitt-kopf">
                        <Symbol name="schlossOffen" :groesse="18" class="kopf-symbol-gut" />
                        <span class="abschnitt-titel">{{ t('incoming.openingEvaluation') }}</span>
                    </div>

                    <!-- Trade-Typ -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.tradeType') }}</label>
                        <div class="wahl-reihe">
                            <button v-for="tt in tradeTypeOptions" :key="tt.value" type="button"
                                class="wahl"
                                :class="pos.tradeType === tt.value ? 'gewaehlt' : ''"
                                @click.stop="updateTradeType(pos, tt.value)">
                                {{ t(tt.labelKey) }}
                            </button>
                        </div>
                    </div>

                    <!-- Timeframe -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.timeframe') }}</label>
                        <div class="wahl-reihe">
                            <button v-for="tf in timeframeOptions" :key="tf.value" type="button"
                                class="wahl"
                                :class="pos.entryTimeframe === tf.value ? 'gewaehlt' : ''"
                                @click.stop="updateTimeframe(pos, tf.value)">
                                {{ tf.label }}
                            </button>
                        </div>
                    </div>

                    <!-- Stresslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.stressLevel') }}</label>
                        <div class="punkte-reihe">
                            <template v-for="n in 10" :key="'os'+n">
                                <span @click.stop="updateStress(pos, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Emotionslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotionLevel') }}</label>
                        <div class="punkte-reihe">
                            <template v-for="n in 10" :key="'oe'+n">
                                <span @click.stop="updateEmotionLevel(pos, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= pos.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= pos.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Emotionen -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotions') }}</label>
                        <textarea class="at-feld klein" v-model="pos.feelings"
                            :placeholder="t('incoming.emotionsPlaceholder')" rows="2"></textarea>
                    </div>

                    <!-- Notiz (Quill Editor) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                        <div :id="'quillIncoming-' + pos.positionId + '-opening'" class="quill-incoming"></div>
                    </div>

                    <!-- Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                        <div class="tag-reihe">
                            <span v-for="(tag, idx) in (pos.tags || [])" :key="tag.id"
                                class="tag-chip pointerClass"
                                :style="{ backgroundColor: getTagColor(tag.id) }"
                                @click.stop="removeTag(pos, idx)">
                                {{ tag.name }} <span class="abstand-links">&times;</span>
                            </span>
                        </div>
                        <select class="at-feld klein"
                            @change.stop="addTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                            <option selected disabled>{{ t('incoming.addTag') }}</option>
                            <template v-for="group in verfuegbareTags" :key="group.id">
                                <optgroup :label="group.name">
                                    <option v-for="tag in group.tags" :key="tag.id"
                                        :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                        :disabled="(pos.tags || []).some(t => t.id === tag.id)">
                                        {{ tag.name }}
                                    </option>
                                </optgroup>
                            </template>
                        </select>
                    </div>

                    <!-- Screenshots (max 2) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                        <div class="screenshot-reihe">
                            <!-- Erster Screenshot (Thumbnail) -->
                            <div v-if="pos.entryScreenshotId" class="screenshot-thumb">
                                <img v-if="entryScreenshotPreviews[pos.positionId]"
                                    :src="entryScreenshotPreviews[pos.positionId]"
                                    class="screenshot-bild" />
                                <Pille v-else ton="neutral" symbol="bild">1</Pille>
                                <button type="button" class="screenshot-remove" @click.stop="removeEntryScreenshot(pos)"><Symbol name="fehler" /></button>
                            </div>
                            <!-- Zweiter Screenshot (Thumbnail) -->
                            <div v-if="pos.trendScreenshotId" class="screenshot-thumb">
                                <img v-if="trendScreenshotPreviews[pos.positionId]"
                                    :src="trendScreenshotPreviews[pos.positionId]"
                                    class="screenshot-bild" />
                                <Pille v-else ton="neutral" symbol="bild">2</Pille>
                                <button type="button" class="screenshot-remove" @click.stop="removeTrendScreenshot(pos)"><Symbol name="fehler" /></button>
                            </div>
                        </div>
                        <!-- Upload (sichtbar solange weniger als 2 Screenshots) —
                             jetzt auch Drag&Drop und Einfügen (Strg/Cmd+V). -->
                        <label v-if="!pos.entryScreenshotId || !pos.trendScreenshotId"
                            class="pb-drop" :class="{ 'pb-drop-over': dragSlot === pos.positionId + ':open' }"
                            @dragover.prevent="dragSlot = pos.positionId + ':open'" @dragenter.prevent="dragSlot = pos.positionId + ':open'"
                            @dragleave.prevent="dragSlot = ''"
                            @drop.prevent="onDropScreenshot($event, pos, pos.entryScreenshotId ? 'trend' : 'entry')">
                            <input type="file" accept="image/*" class="pb-drop-input"
                                @change="!pos.entryScreenshotId ? handleEntryScreenshotUpload($event, pos) : handleTrendScreenshotUpload($event, pos)" />
                            <Symbol name="bildPlus" />Bild wählen, hierher ziehen oder einfügen (Strg/Cmd+V)
                        </label>
                        <Knopf v-if="kopiertesBild && (!pos.entryScreenshotId || !pos.trendScreenshotId)"
                            klein symbol="zwischenablage" class="abstand-oben"
                            @click.stop="kopiertesBildEinfuegen(pos, pos.entryScreenshotId ? 'trend' : 'entry')">
                            Kopiertes Bild einfügen
                        </Knopf>
                        <!-- Chartbild: Einstieg/Stop/Ziel + Strategie-Setups (LSOB/GUSS-Tag) automatisch -->
                        <div class="chartbild-zeile">
                            <Knopf klein :symbol="chartBildStand[pos.positionId]?.laeuft ? '' : 'chart'"
                                :laedt="!!chartBildStand[pos.positionId]?.laeuft"
                                :titel="t('incoming.chartBildTipp')" @click.stop="chartBildErzeugen(pos)">
                                {{ t('incoming.chartBild') }}
                            </Knopf>
                            <small v-if="chartBildStand[pos.positionId]?.fehler" class="at-warn">{{ chartBildStand[pos.positionId].fehler }}</small>
                            <small v-else class="at-gedaempft">{{ t('incoming.chartBildHinweis') }}</small>
                        </div>
                    </div>

                    </div><!-- /opening-eval-section -->

                    <!-- ========== CLOSING EVALUATION (Futures) ========== -->
                    <div v-if="pos.status === 'pending_evaluation' && !isBotPosition(pos)" class="closing-eval-section abschnitt abschnitt-abstand">
                        <div class="abschnitt-kopf">
                            <Symbol name="schloss" :groesse="18" class="kopf-symbol" />
                            <span class="abschnitt-titel">{{ t('incoming.closingEvaluation') }}</span>
                        </div>

                        <!-- Strategie eingehalten? (oberster Punkt) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.strategyFollowed') }}</label>
                            <div class="wahl-reihe">
                                <button type="button" class="wahl breit"
                                    :class="pos.strategyFollowed === 1 ? 'gewaehlt-gut' : ''"
                                    @click.stop="updateStrategyFollowed(pos, 1)">
                                    {{ t('incoming.strategyYes') }}
                                </button>
                                <button type="button" class="wahl breit"
                                    :class="pos.strategyFollowed === 0 ? 'gewaehlt-schlecht' : ''"
                                    @click.stop="updateStrategyFollowed(pos, 0)">
                                    {{ t('incoming.strategyNo') }}
                                </button>
                            </div>
                        </div>

                        <!-- Trade-Typ (auto-erkannt, manuell überschreibbar) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">
                                {{ t('incoming.tradeType') }}
                                <small v-if="autoDetectedTradeType[pos.positionId] === true" class="at-gedaempft abstand-links">{{ t('incoming.autoDetected') }}</small>
                            </label>
                            <div class="wahl-reihe">
                                <button v-for="tt in tradeTypeOptions" :key="tt.value" type="button"
                                    class="wahl"
                                    :class="pos.closingTradeType === tt.value ? 'gewaehlt' : ''"
                                    @click.stop="updateClosingTradeType(pos, tt.value)">
                                    {{ t(tt.labelKey) }}
                                </button>
                                <small v-if="getTradeDurationMinutes(pos)" class="at-gedaempft haltedauer">
                                    {{ t('incoming.holdDuration') }}: {{ formatDuration(getTradeDurationMinutes(pos)) }}
                                </small>
                            </div>
                        </div>

                        <!-- Emotionslevel (Abschluss) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.closingEmotionLevel') }}</label>
                            <div class="punkte-reihe">
                                <template v-for="n in 10" :key="'ce'+n">
                                    <span @click.stop="updateClosingEmotionLevel(pos, n)"
                                        class="stress-dot pointerClass"
                                        :class="n <= (pos.closingEmotionLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">{{ n }}</span>&#x25CF;
                                    </span>
                                    <span v-if="n < 10" class="stress-dot stress-spacer"
                                        :class="n <= (pos.closingEmotionLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">&nbsp;</span>&#x25CF;
                                    </span>
                                </template>
                            </div>
                        </div>

                        <!-- Emotionen (Abschluss) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.closingEmotions') }}</label>
                            <textarea class="at-feld klein" v-model="pos.closingFeelings"
                                :placeholder="t('incoming.closingEmotionsPlaceholder')" rows="2"></textarea>
                        </div>

                        <!-- Notiz (Quill Editor) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                            <div :id="'quillIncoming-' + pos.positionId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Tags -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                            <div class="tag-reihe">
                                <span v-for="(tag, idx) in (pos.closingTags || [])" :key="tag.id"
                                    class="tag-chip pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click.stop="removeClosingTag(pos, idx)">
                                    {{ tag.name }} <span class="abstand-links">&times;</span>
                                </span>
                            </div>
                            <select class="at-feld klein"
                                @change.stop="addClosingTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>{{ t('incoming.addTag') }}</option>
                                <template v-for="group in verfuegbareTags" :key="group.id">
                                    <optgroup :label="group.name">
                                        <option v-for="tag in group.tags" :key="tag.id"
                                            :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                            :disabled="(pos.closingTags || []).some(t => t.id === tag.id)">
                                            {{ tag.name }}
                                        </option>
                                    </optgroup>
                                </template>
                            </select>
                        </div>

                        <!-- Closing Screenshot -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                            <div v-if="pos.closingScreenshotId" class="screenshot-reihe">
                                <div class="screenshot-thumb">
                                    <img v-if="closingScreenshotPreviews[pos.positionId]"
                                        :src="closingScreenshotPreviews[pos.positionId]"
                                        class="screenshot-bild" />
                                    <Pille v-else ton="neutral" symbol="bild">1</Pille>
                                    <button type="button" class="screenshot-remove" @click.stop="removeClosingScreenshot(pos)"><Symbol name="fehler" /></button>
                                </div>
                            </div>
                            <label v-else class="pb-drop"
                                :class="{ 'pb-drop-over': dragSlot === pos.positionId + ':closing' }"
                                @dragover.prevent="dragSlot = pos.positionId + ':closing'" @dragenter.prevent="dragSlot = pos.positionId + ':closing'"
                                @dragleave.prevent="dragSlot = ''"
                                @drop.prevent="onDropScreenshot($event, pos, 'closing')">
                                <input type="file" accept="image/*" class="pb-drop-input"
                                    @change="handleClosingScreenshotUpload($event, pos)" />
                                <Symbol name="bildPlus" />Bild wählen, hierher ziehen oder einfügen (Strg/Cmd+V)
                            </label>
                            <Knopf v-if="kopiertesBild && !pos.closingScreenshotId"
                                klein symbol="zwischenablage" class="abstand-oben"
                                @click.stop="kopiertesBildEinfuegen(pos, 'closing')">
                                Kopiertes Bild einfügen
                            </Knopf>
                        </div>

                        <!-- Zufriedenheit -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.satisfaction') }}</label>
                            <div class="zufrieden-reihe">
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 1 }"
                                    @click.stop="updateSatisfaction(pos, 1)">
                                    👍
                                </span>
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 2 }"
                                    @click.stop="updateSatisfaction(pos, 2)">
                                    ✊
                                </span>
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 0 }"
                                    @click.stop="updateSatisfaction(pos, 0)">
                                    👎
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- ========== BOT NOTIZ (laufend, schlank) ========== -->
                    <div v-if="pos.status !== 'pending_evaluation' && isBotPosition(pos)" class="opening-eval-section abschnitt">
                        <div class="abschnitt-kopf">
                            <Symbol name="ki" :groesse="18" class="kopf-symbol" />
                            <span class="abschnitt-titel">{{ t('incoming.botEvaluation') }}</span>
                        </div>

                        <!-- Notiz (Quill Editor) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                            <div :id="'quillIncoming-' + pos.positionId + '-opening'" class="quill-incoming"></div>
                        </div>

                        <!-- Tags -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                            <div class="tag-reihe">
                                <span v-for="(tag, idx) in (pos.tags || [])" :key="tag.id"
                                    class="tag-chip pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click.stop="removeTag(pos, idx)">
                                    {{ tag.name }} <span class="abstand-links">&times;</span>
                                </span>
                            </div>
                            <select class="at-feld klein"
                                @change.stop="addTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>{{ t('incoming.addTag') }}</option>
                                <template v-for="group in verfuegbareTags" :key="group.id">
                                    <optgroup :label="group.name">
                                        <option v-for="tag in group.tags" :key="tag.id"
                                            :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                            :disabled="(pos.tags || []).some(t => t.id === tag.id)">
                                            {{ tag.name }}
                                        </option>
                                    </optgroup>
                                </template>
                            </select>
                        </div>
                    </div>

                    <!-- ========== BOT EVALUATION (schlank) ========== -->
                    <div v-if="pos.status === 'pending_evaluation' && isBotPosition(pos)" class="closing-eval-section abschnitt abschnitt-abstand">
                        <div class="abschnitt-kopf">
                            <Symbol name="ki" :groesse="18" class="kopf-symbol" />
                            <span class="abschnitt-titel">{{ t('incoming.botEvaluation') }}</span>
                        </div>

                        <!-- Notiz (Quill Editor) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                            <div :id="'quillIncoming-' + pos.positionId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Tags -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                            <div class="tag-reihe">
                                <span v-for="(tag, idx) in (pos.closingTags || [])" :key="tag.id"
                                    class="tag-chip pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click.stop="removeClosingTag(pos, idx)">
                                    {{ tag.name }} <span class="abstand-links">&times;</span>
                                </span>
                            </div>
                            <select class="at-feld klein"
                                @change.stop="addClosingTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>{{ t('incoming.addTag') }}</option>
                                <template v-for="group in verfuegbareTags" :key="group.id">
                                    <optgroup :label="group.name">
                                        <option v-for="tag in group.tags" :key="tag.id"
                                            :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                            :disabled="(pos.closingTags || []).some(t => t.id === tag.id)">
                                            {{ tag.name }}
                                        </option>
                                    </optgroup>
                                </template>
                            </select>
                        </div>

                        <!-- Zufriedenheit -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.satisfaction') }}</label>
                            <div class="zufrieden-reihe">
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 1 }"
                                    @click.stop="updateSatisfaction(pos, 1)">
                                    👍
                                </span>
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 2 }"
                                    @click.stop="updateSatisfaction(pos, 2)">
                                    ✊
                                </span>
                                <span class="pointerClass zufrieden"
                                    :class="{ 'zufrieden-aus': pos.satisfaction !== 0 }"
                                    @click.stop="updateSatisfaction(pos, 0)">
                                    👎
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- ===== SAVE / COMPLETE BUTTONS ===== -->
                    <div class="aktionen-zeile">
                        <label class="at-check skip-check" :for="'skipEval-' + pos.positionId">
                            <input type="checkbox" :id="'skipEval-' + pos.positionId"
                                v-model="pos.skipEvaluation" :true-value="1" :false-value="0"
                                @click.stop>
                            <span class="klein-text at-gedaempft">{{ t('incoming.skipEvaluation') }}</span>
                        </label>
                        <div class="aktionen-knoepfe">
                            <Knopf v-if="pos.status === 'pending_evaluation'"
                                art="haupt" klein symbol="hakenKreis"
                                @click.stop="completeClosingEvaluation(pos)"
                                :laedt="closingId === pos.objectId">
                                {{ t('incoming.completeEvaluation') }}
                            </Knopf>
                            <Knopf :art="pos.status === 'pending_evaluation' ? 'normal' : 'haupt'" klein symbol="haken"
                                @click.stop="saveMetadata(pos)" :laedt="savingId === pos.objectId">
                                {{ t('common.save') }}
                            </Knopf>
                        </div>
                    </div>
                </div>
            </div>
            </template>
        </div>

        <SeiteLaedt />
    </div>
</template>

<style scoped>
/* Positionskarte: Kennzahlen, Detailbereich. */
.incoming-card { height: auto; }
.incoming-info { font-size: 0.8rem; color: var(--muted); }
.incoming-pnl { font-size: 1.15rem; font-weight: 700; }
.incoming-meta-section { padding: 0.6rem 0.75rem; background: var(--panel-soft); border-radius: var(--radius-knopf); }

/* Stress-/Emotionsskala 1–10 */
.stress-dot {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    width: 1rem;
    line-height: 1;
    font-size: 0.9rem;
}
.stress-dot.stress-spacer { width: 0.4rem; font-size: 0.6rem; }
.stress-dot.active { color: var(--warn); }
.stress-dot.inactive { color: var(--leise); }
.stress-number { margin-bottom: 0.15rem; font-size: 0.6rem; color: var(--muted); }

/* Bearbeitungsabschnitte */
.pb-edit-section { padding: 0.6rem 0; border-bottom: 1px solid var(--line); }
.pb-edit-section:last-child { border-bottom: 0; }
.pb-edit-label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
}

.incoming-seite {
    margin-top: var(--abstand-2);
}

/* Kopf: Stand links, Aktualisieren + Info rechts */
.incoming-kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-3);
    margin-bottom: var(--abstand-4);
}
.incoming-kopf-stand {
    flex: 1 1 auto;
    min-width: 0;
}
.incoming-kopf-aktionen {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    flex: 0 0 auto;
}
/* Der Vue-Compiler schluckt das Leerzeichen zwischen Titel und Zusatz. */
.incoming-hinweis strong + span {
    margin-left: 0.3em;
}

.incoming-hinweis {
    margin-bottom: var(--abstand-2);
}
.hinweis-zeile {
    font-size: 0.85em;
    margin-top: var(--abstand-1);
}
.hinweis-leise {
    opacity: 0.75;
}

/* Gruppen-Überschriften der pendenten Trades (je Börse + Futures/Bots) */
.incoming-broker-title {
    margin: 1.4rem 0 0.35rem;
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--text);
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--line);
}
.incoming-broker-title:first-child {
    margin-top: 0;
}
.incoming-section-title {
    margin: 0.6rem 0 0.45rem;
    font-weight: 600;
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
}

/* Positionskarte */
.pos-karte {
    margin-bottom: var(--abstand-2);
    padding: var(--abstand-2);
}
.karten-kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-3);
}
.karten-kopf-links {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    flex: 0 1 auto;
    min-width: 0;
}
.karten-kopf-pnl {
    flex: 1 1 auto;
    text-align: right;
}
.karten-kopf-pfeil {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: var(--muted);
}
.symbol-name {
    font-size: 1.25rem;
}
.seite,
.fett {
    font-weight: 700;
}
.realisiert {
    margin-top: var(--abstand-1);
    opacity: 0.85;
}
.klein-text {
    font-size: 0.875em;
}
.hell {
    color: var(--text);
}
.durchgestrichen {
    text-decoration: line-through;
}
.abstand-links {
    margin-left: var(--abstand-1);
}
.abstand-rechts {
    margin-right: var(--abstand-1);
}
.abstand-oben {
    margin-top: var(--abstand-2);
}
.rechts-aussen {
    margin-left: auto;
}
.rrr {
    color: var(--accent);
    font-weight: 600;
}
.info-zeile,
.stress-zeile {
    margin-top: var(--abstand-1);
}

/* Aufgeklappter Bereich */
.detail-bereich {
    margin-top: var(--abstand-2);
}
.abschnitt {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-2);
}
.abschnitt-abstand {
    margin-top: var(--abstand-4);
}
.abschnitt-kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}
.abschnitt-titel {
    font-weight: 700;
    font-size: 0.95rem;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}
.kopf-symbol {
    color: var(--accent);
}
.kopf-symbol-gut {
    color: var(--good);
}

.opening-eval-section,
.closing-eval-section,
.fills-section {
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
}
.opening-eval-section {
    border-left: 3px solid var(--good);
}
.closing-eval-section {
    border-left: 3px solid var(--accent);
}
.fills-section {
    border-left: 3px solid var(--line-stark);
}

/* Fills */
.fills-kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}
.fills-schnitt {
    font-size: 0.85rem;
}
.fills-huelle {
    overflow-x: auto;
}
.fills-tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    color: var(--text);
    margin-bottom: var(--abstand-1);
}
.fills-tabelle td {
    padding: 0.15rem 0.3rem;
    vertical-align: middle;
    border: none;
    white-space: nowrap;
}
.fills-tabelle td.zahl {
    text-align: right;
    font-variant-numeric: tabular-nums;
}
.fills-tabelle td:first-child {
    padding-left: 0;
}
.fills-tabelle td:last-child {
    padding-right: 0;
}
.zelle-zeit { width: 100px; }
.zelle-menge { width: 80px; }
.zelle-preis { width: 90px; }
.zelle-gebuehr { width: 90px; }
.zelle-op {
    padding-left: var(--abstand-1) !important;
    padding-right: var(--abstand-1) !important;
}
.gruppen-pfeil {
    font-size: 0.6rem;
    margin-right: 2px;
}
.gruppen-zahl {
    font-size: 0.6rem;
    margin-left: var(--abstand-1);
}
.fill-einzeln {
    opacity: 0.6;
    font-size: 0.7rem;
}
.summen-zeile {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    border-top: 1px solid var(--line);
    padding-top: var(--abstand-1);
    margin-top: var(--abstand-1);
    font-size: 0.8rem;
}
.tpsl-zeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-4);
    margin-top: var(--abstand-2);
    padding-top: var(--abstand-2);
    border-top: 1px solid var(--line);
    font-size: 0.8rem;
}
.tpsl-verlauf {
    margin-top: var(--abstand-2);
    padding-top: var(--abstand-2);
    border-top: 1px solid var(--line);
    font-size: 0.75rem;
}
.tpsl-verlauf-kopf {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-1);
    margin-bottom: var(--abstand-1);
}
.tpsl-eintrag {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-1);
}
.tpsl-zeit {
    width: 90px;
}

/* Auswahl-Knöpfe (Trade-Typ, Zeitrahmen, Strategie) */
.wahl-reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
}
.wahl {
    padding: 0.1rem 0.6rem;
    border-radius: var(--radius-klein);
    border: 1px solid var(--line-stark);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.5;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.wahl:hover {
    color: var(--text);
    border-color: var(--muted);
}
.wahl.breit {
    padding: 0.25rem 1rem;
}
.wahl.gewaehlt {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}
.wahl.gewaehlt-gut {
    background: var(--good-flaeche);
    border-color: var(--good);
    color: var(--good);
}
.wahl.gewaehlt-schlecht {
    background: var(--bad-flaeche);
    border-color: var(--bad);
    color: var(--bad);
}
.haltedauer {
    margin-left: var(--abstand-2);
}
.punkte-reihe {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
}

/* Tags */
.tag-reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
    margin-bottom: var(--abstand-1);
}
.tag-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.18rem 0.55rem;
    border-radius: var(--radius-pille);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.4;
}

/* Screenshots */
.screenshot-reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}
.screenshot-thumb {
    position: relative;
    display: inline-block;
}
.screenshot-bild {
    display: block;
    max-height: 120px;
    max-width: 200px;
    object-fit: contain;
    border-radius: var(--radius-klein);
}
.screenshot-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    display: inline-flex;
    padding: 0;
    border: none;
    color: var(--bad);
    background: var(--panel-soft);
    border-radius: 50%;
    font-size: 1.2rem;
    cursor: pointer;
    line-height: 1;
}
.screenshot-remove:hover {
    color: var(--text);
    background: var(--bad);
}

/* Drag&Drop-Zone für Screenshots (Klick öffnet Dateiwahl). */
.pb-drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1.5px dashed var(--line-stark);
    border-radius: var(--radius-knopf);
    background: var(--panel);
    color: var(--muted);
    font-size: 0.78rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.15s ease;
}
.pb-drop:hover {
    border-color: var(--muted);
    color: var(--text);
}
.pb-drop-over {
    border-color: var(--accent);
    background: var(--accent-flaeche);
    color: var(--text);
}
.pb-drop-input { display: none; }

.chartbild-zeile {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}

/* Zufriedenheit */
.zufrieden-reihe {
    display: flex;
    gap: var(--abstand-4);
}
.zufrieden {
    font-size: 1.5rem;
}
.zufrieden-aus {
    opacity: 0.3;
    filter: grayscale(1);
}

/* Speichern / Abschliessen */
.aktionen-zeile {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}
.skip-check {
    margin-bottom: 0;
}
.aktionen-knoepfe {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}

/* Quill-Hülle: Werkzeugleiste und Feld auf die Token */
.pb-edit-section :deep(.ql-toolbar.ql-snow) {
    border: 1px solid var(--line) !important;
    border-radius: var(--radius-klein) var(--radius-klein) 0 0;
    background: var(--panel);
    padding: 4px 8px;
}
.pb-edit-section :deep(.ql-container.ql-snow) {
    border: 1px solid var(--line) !important;
    border-top: none !important;
    border-radius: 0 0 var(--radius-klein) var(--radius-klein);
    background: var(--panel);
    color: var(--text);
    font-family: var(--schrift);
}
.pb-edit-section :deep(.ql-editor) {
    min-height: 90px;
    color: var(--text);
}
.pb-edit-section :deep(.ql-editor.ql-blank::before) {
    color: var(--leise);
    font-style: normal;
}
.pb-edit-section :deep(.ql-snow .ql-stroke) {
    stroke: var(--muted);
}
.pb-edit-section :deep(.ql-snow .ql-fill) {
    fill: var(--muted);
}
.pb-edit-section :deep(.ql-snow .ql-picker) {
    color: var(--muted);
}
.pb-edit-section :deep(.ql-snow button:hover .ql-stroke),
.pb-edit-section :deep(.ql-snow button.ql-active .ql-stroke) {
    stroke: var(--accent);
}
.pb-edit-section :deep(.ql-snow button:hover .ql-fill),
.pb-edit-section :deep(.ql-snow button.ql-active .ql-fill) {
    fill: var(--accent);
}

@media (max-width: 767.98px) {
    .abschnitt {
        padding: var(--abstand-3);
    }
    .incoming-pnl {
        font-size: 1.05rem;
    }
}
</style>
