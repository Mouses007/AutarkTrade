<script>
/**
 * Kerzen-Cache auf Modulebene: lebt über einen Seitenwechsel hinaus, damit
 * ein zweites Öffnen desselben Trades keine Binance-Anfrage kostet.
 * Der Schlüssel enthält das FENSTER, nicht nur den Handelstag — zwei Trades
 * desselben Symbols am selben Tag haben verschiedene Fenster (±6 h um den
 * jeweiligen Einstieg) und dürfen sich die Kerzen nicht teilen.
 */
const kerzenCache = new Map()
const KERZEN_CACHE_MAX = 60

function merkeKerzen(schluessel, wert) {
    kerzenCache.set(schluessel, wert)
    // Älteste zuerst raus (Map hält die Einfügereihenfolge)
    while (kerzenCache.size > KERZEN_CACHE_MAX) kerzenCache.delete(kerzenCache.keys().next().value)
}
</script>

<script setup>
/**
 * Tagesansicht (`/tagesansicht`): eine Karte je Handelstag des gewählten Monats mit
 * Kennzahlen und den Reitern Trades/Blotter; ein Klick auf einen Trade öffnet
 * das Detailfenster (Kerzenchart, Fills, SL/TP-Protokoll, Bot-Aufschlüsselung,
 * MFE, Notiz, Share-Karte, Screenshot-Vorschau).
 *
 * Neubau nach ansichten.md (Beleg), Teil „Tagesansicht" und Abschnitt 0.
 * Die Rechenwerte kommen fertig aus dem Journal-Kern (`journalTage`); diese
 * Ansicht zeichnet nur und speichert die Begleitdaten des offenen Trades.
 */
import { scrolleZu } from '../utils/scrolleZu.js'
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import axios from 'axios'

import Karte from '@/components/basis/Karte.vue'
import Reiter from '@/components/basis/Reiter.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Dialog from '@/components/basis/Dialog.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Leerzustand from '@/components/basis/Leerzustand.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import InfoTipp from '@/components/InfoTipp.vue'
import SeiteLaedt from '@/components/SeiteLaedt.vue'
import ShareCardModal from '@/components/ShareCardModal.vue'

import { seiteLaedt, ladeMehr, setupsLaden } from '@/stores/app/laden.js'
import { journalHatDaten, tradeZeitzone, tradeDetailOffen, speichernNoetig, scrollToDateUnix, appEinstellungen } from '@/stores/app/rahmen.js'
import { journalTage } from '@/stores/journal/auswertung.js'
import { tradeId } from '@/stores/journal/import.js'
import { markierungOffen, bilder, bilderDesMonats, bildInBearbeitung } from '@/stores/journal/bilder.js'
import {
    exkursionEntwurf, excursions, tradeExkursionGeaendert, exkursionTradeId, exkursionTagUnix,
    offenerTagIndex, tradeIndexAktiv, tags, verfuegbareTags, tagsDesTrades, notes,
} from '@/stores/journal/tagebuch.js'

import { starteTagesansicht, bestimmeBereich, useDisposeJournalCharts } from '@/utils/journal/ablauf.js'
import { ladeExkursionen, tagAngaben, tagsFuerTrade } from '@/utils/journal/tagebuch.js'
import {
    formDatumLang, formGeld2, formGeldStellen, formUhrzeitSek, formDauer,
    addiereGenau, formDatum, formDauerTage,
} from '@/utils/journal/format.js'
import dayjs from '@/utils/journal/zeit.js'
import { ladeDiagramme, geladeneDiagramme } from '@/utils/journal/diagrammLader.js'
import { ladeBilderDesTages } from '@/utils/bilder/laden.js'
import { zeigeImVollbild } from '@/utils/bilder/vollbild.js'
import { dbFirst, dbCreate, dbUpdate } from '@/utils/db.js'

const { t } = useI18n()
const router = useRouter()

// ── Allgemeines ────────────────────────────────────────────────────────────

/** KI-/Share-Knöpfe: aus nur bei ausdrücklich false oder 0 (fehlend = an). */
const kiAn = computed(() => {
    const v = appEinstellungen.value?.aiEnabled
    return v !== false && v !== 0
})
const binanceChartAn = computed(() => !!appEinstellungen.value?.enableBinanceChart)

const istZahl = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x))
const gesetzt = (x) => x !== null && x !== undefined
const geld = (x) => formGeld2(Number(x) || 0)

/**
 * Preis mit genug Stellen für kleine Coins: 0,00001234 als „$0.00" zu zeigen
 * ist schlicht falsch. Ab 1000 zwei Stellen, ab 1 vier, darunter so viele, dass
 * vier signifikante Ziffern sichtbar bleiben.
 */
function preis(x, forex = false) {
    const p = Number(x)
    if (!Number.isFinite(p)) return ''
    if (forex) return p.toFixed(5)
    const a = Math.abs(p)
    const stellen = a >= 1000 || a === 0 ? 2 : a >= 1 ? 4 : Math.min(10, Math.ceil(-Math.log10(a)) + 3)
    return formGeldStellen(p, stellen)
}

/**
 * Liegen zwei Zeitpunkte (Sekunden) am selben Kalendertag der Handelszeitzone?
 * Das Datum zählt, nicht der Abstand: 23:59 und 00:01 sind zwei Tage
 * (docs/spec/f3-trade-dialog.md §3).
 */
const selberHandelstag = (a, b) => formDatum(a) === formDatum(b)

/** Notiztext ohne HTML; Absätze und <br> werden zu Zeilenumbrüchen, damit der Text lesbar bleibt. */
function notizOhneHtml(html) {
    if (!html) return ''
    return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '').trim()
}

/** Trade-Typ-Label; die drei Schlüssel stehen statisch, damit der i18n-Selbsttest sie sieht. */
function typLabel(wert) {
    if (wert === 'scalp') return t('incoming.scalptrade')
    if (wert === 'day') return t('incoming.daytrade')
    if (wert === 'swing') return t('incoming.swingtrade')
    return wert
}

const position = (strategy) => (strategy === 'short' ? t('daily.short') : strategy === 'long' ? t('daily.long') : (strategy ? strategy.charAt(0).toUpperCase() + strategy.slice(1) : ''))

// ── Bot-Hilfen (Pionex) ────────────────────────────────────────────────────

function botMuenze(trade) {
    if (!trade) return 'USDT'
    const sym = String(trade.symbol || '').toUpperCase()
    if (trade.coinM || (trade.marginCoin && trade.marginCoin !== 'USDT')) {
        if (trade.marginCoin && trade.marginCoin !== 'USDT') return trade.marginCoin
        const rest = sym.replace(/USDT/g, '')
        return rest || 'USDT'
    }
    // Invertiertes Symbol (USDTSOL → SOL)
    if (sym.startsWith('USDT') && sym.length > 4) return sym.slice(4)
    return 'USDT'
}

function botBetrag(wert, muenze) {
    const z = parseFloat(wert || 0)
    if (muenze === 'USDT') return formGeld2(z)
    return `${z >= 0 ? '+' : ''}${z.toFixed(4)} ${muenze}`
}

function laufzeit(sek) {
    const s = Math.floor(Number(sek) || 0)
    if (s <= 0) return '–'
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
}

// ── Fills und SL/TP-Protokoll ──────────────────────────────────────────────

const zahl = (x) => parseFloat(x) || 0
const listeVon = (x) => (Array.isArray(x) ? x : [])

function hatMetadaten(m) {
    if (!m) return false
    return listeVon(m.fills).length > 0 || gesetzt(m.sl) || gesetzt(m.tp) || !!m.positionSize
        || listeVon(m.tpslHistory).length > 0 || !!m.rrr
}

/** SL/TP-Einträge bis eine Minute nach dem letzten Fill — danach sind es Polling-Artefakte. */
function gefiltertesProtokoll(m) {
    const historie = listeVon(m?.tpslHistory)
    if (!historie.length) return []
    const fills = listeVon(m.fills)
    if (!fills.length) return historie
    const letzter = fills.reduce((max, f) => Math.max(max, parseInt(f.time, 10) || 0), 0)
    if (letzter === 0) return historie
    return historie.filter(e => e.time <= letzter + 60000)
}

const einstiegsFills = (fills) => listeVon(fills).filter(f => !f.reduceOnly)

function durchschnittEinstieg(fills) {
    const ein = einstiegsFills(fills)
    const menge = ein.reduce((s, f) => s + zahl(f.qty), 0)
    if (!ein.length || menge === 0) return 0
    return ein.reduce((s, f) => s + zahl(f.qty) * zahl(f.price), 0) / menge
}

const fillZeit = (ms) => dayjs(Number(ms)).tz(tradeZeitzone.value).format('DD.MM. HH:mm')

/**
 * Art eines Fills. Schliessend: „close" erst, wenn die bis HIER geschlossene
 * Menge die bis hier eröffnete erreicht — sonst hiessen frühere
 * Teilschliessungen einer am Ende ganz geschlossenen Position auch „close".
 */
function fillTyp(fill, index, liste) {
    if (fill.reduceOnly) {
        let zu = 0
        let auf = 0
        for (let i = 0; i <= index; i++) {
            if (liste[i].reduceOnly) zu += zahl(liste[i].qty)
            else auf += zahl(liste[i].qty)
        }
        return zu >= auf - 1e-12 ? 'close' : 'partialClose'
    }
    if (index === 0 || liste.slice(0, index).every(f => f.reduceOnly)) return 'initial'
    return 'compound'
}

function fillTypText(typ) {
    if (typ === 'close') return t('incoming.fillClose')
    if (typ === 'partialClose') return t('incoming.fillPartialClose')
    if (typ === 'initial') return t('incoming.fillInitial')
    return t('incoming.fillCompound')
}

/** Aufeinanderfolgende Fills derselben Minute und Richtung als Gruppe. */
function gruppiereFills(fills) {
    const liste = listeVon(fills)
    const gruppen = []
    liste.forEach((f, i) => {
        const minute = dayjs(Number(f.time)).tz(tradeZeitzone.value).format('YYYY-MM-DD HH:mm')
        const schluessel = `${minute}|${f.reduceOnly ? 1 : 0}`
        let g = gruppen[gruppen.length - 1]
        if (!g || g.schluessel !== schluessel) {
            // Gleicher Schlüssel später erneut → neue Gruppe; die laufende Nummer macht sie eindeutig
            g = { schluessel, id: `${gruppen.length}|${schluessel}`, fills: [], zeit: f.time, reduceOnly: !!f.reduceOnly, startIndex: i }
            gruppen.push(g)
        }
        g.fills.push(f)
    })
    for (const g of gruppen) {
        g.menge = g.fills.reduce((s, f) => s + zahl(f.qty), 0)
        g.wert = g.fills.reduce((s, f) => s + zahl(f.qty) * zahl(f.price), 0)
        g.preis = g.menge ? g.wert / g.menge : 0
        g.gebuehr = g.fills.reduce((s, f) => s + zahl(f.fee), 0)
        g.istGruppe = g.fills.length > 1
        g.typ = fillTyp(liste[g.startIndex], g.startIndex, liste)
    }
    return gruppen
}

// ── Tageskarten und Reiter ─────────────────────────────────────────────────

const zeigeLeer = computed(() => !journalHatDaten.value || journalTage.length === 0)

const REITER = computed(() => [
    { id: 'trades', titel: t('daily.tabTrades') },
    { id: 'blotter', titel: t('daily.tabBlotter') },
])

/**
 * Offener Reiter je Karte ('' = zugeklappt). Jede Karte für sich (Abschnitt 0,
 * D.16-1): Karte 0 startet mit „Trades", die übrigen zugeklappt; ein erneuter
 * Klick auf den aktiven Reiter klappt zu.
 */
const offenerReiter = reactive({})
function reiterZuruecksetzen() {
    for (const k of Object.keys(offenerReiter)) delete offenerReiter[k]
    offenerReiter[0] = 'trades'
}
function waehleReiter(karte, id) {
    offenerReiter[karte] = offenerReiter[karte] === id ? '' : id
}

const hatBild = (trade) => bilderDesMonats.some(s => s.name === trade.id)

function einstiegHinweis(trade, tag) {
    if (trade.tradesCount == 0) return ''
    if (selberHandelstag(trade.td ?? tag.dateUnix, trade.entryTime)) return ''
    return t('daily.swingFrom', { date: formDatum(trade.entryTime) })
}

// ── Sprung zu einem Tag ────────────────────────────────────────────────────

function springeZuTag(tagUnix, versuch = 0) {
    const el = document.getElementById(`daily-card-${tagUnix}`)
    if (el) {
        scrolleZu(el)
        scrollToDateUnix.value = null
        return
    }
    if (versuch >= 5) {
        scrollToDateUnix.value = null
        return
    }
    setTimeout(() => springeZuTag(tagUnix, versuch + 1), 100)
}

watch(scrollToDateUnix, async (neu) => {
    if (!neu || seiteLaedt.value) return
    await nextTick()
    springeZuTag(neu)
})

// Die Filterleiste füllt `journalTage` jederzeit neu — dann gelten die alten Reiter nicht mehr.
watch(seiteLaedt, (laedt) => { if (!laedt) reiterZuruecksetzen() })

// ── Detailfenster: Zustand ─────────────────────────────────────────────────

/** Sichtbarkeit des <dialog>; getrennt von `tradeDetailOffen`, weil das Schliessen erst speichert. */
const dialogOffen = ref(false)
/** Wechselt bei jedem Öffnen — der Kerzenchart bekommt so einen frischen Knoten und eine frische Instanz. */
const kerzenSchluessel = ref(0)
const kerzenEl = ref(null)
const kerzenFehler = ref(null)
const kerzenLaedt = ref(false)
let groessenBeobachter = null
let kerzenAuftrag = 0

const tradingMeta = ref(null)
const tradeTypeRef = ref('')
const closingTradeTypeRef = ref('')
const notizText = ref('')
const offeneGruppen = reactive(new Set())
const protokollZu = ref(false)
/** Auto-MFE nur angezeigt (Abschnitt 0, D.16-2): gespeichert wird erst nach „Übernehmen" oder eigener Eingabe. */
const mfeAuto = ref(false)
/** Bilder des Tages in dieser Fenster-Sitzung (Öffnen bis Schliessen) schon geprüft. */
let fensterBilderGeprueft = false
/** Zählt jeden Wechsel — ein spätes Auto-MFE-Ergebnis eines verlassenen Trades wird verworfen. */
let wechselNr = 0
/** Inhalt des Fensters; über ihn findet das Schliessen den nativen <dialog>. */
const detailEl = ref(null)

const offeneKarte = computed(() => (offenerTagIndex.value === undefined ? null : journalTage[offenerTagIndex.value] || null))
const offenerTrade = computed(() => offeneKarte.value?.trades?.[tradeIndexAktiv.value] || null)

const dialogTitel = computed(() => {
    const tr = offenerTrade.value
    const k = offeneKarte.value
    if (!tr || !k) return ''
    return `${tr.symbol || ''} · ${formDatumLang(k.dateUnix)}`
})

const hatVorherigen = computed(() => !!offeneKarte.value?.trades?.[tradeIndexAktiv.value - 1])
const hatNaechsten = computed(() => !!offeneKarte.value?.trades?.[tradeIndexAktiv.value + 1])

const metaSichtbar = computed(() => hatMetadaten(tradingMeta.value))
const fillListe = computed(() => listeVon(tradingMeta.value?.fills))
const fillGruppen = computed(() => gruppiereFills(fillListe.value))
const einstiegListe = computed(() => einstiegsFills(fillListe.value))
const einstiegMenge = computed(() => einstiegListe.value.reduce((s, f) => s + zahl(f.qty), 0))
const gebuehrGesamt = computed(() => fillListe.value.reduce((s, f) => s + zahl(f.fee), 0))
const protokoll = computed(() => gefiltertesProtokoll(tradingMeta.value))

function schalteGruppe(g) {
    if (!g.istGruppe) return
    if (offeneGruppen.has(g.id)) offeneGruppen.delete(g.id)
    else offeneGruppen.add(g.id)
}

/** Bot-Aufschlüsselung (Pionex): Trend = Netto − Grid − Funding, die Trading-Gebühr steckt im Trend. */
const botBreakdown = computed(() => {
    const tr = offenerTrade.value
    if (!tr?.botType) return null
    const net = Number(tr.netProceeds ?? tr.netSharePL ?? 0) || 0
    const grid = Number(tr.gridProfit) || 0
    const funding = Number(tr.fundingFee) || 0
    const coin = botMuenze(tr)
    return {
        net, grid, funding, coin,
        tradingFee: Number(tr.tradingFee) || 0,
        trend: net - grid - funding,
        hasGrid: tr.gridProfit !== undefined,
        pnlUsdt: Number(tr.pnlUsdt) || 0,
        showUsdt: coin !== 'USDT' && gesetzt(tr.pnlUsdt),
        leverage: Number(tr.leverage) || 0,
        investment: Number(tr.investment) || 0,
        runtimeSec: Math.floor((Number(tr.exitTime) || 0) - (Number(tr.entryTime) || 0)),
    }
})

const bildQuelle = computed(() => bildInBearbeitung.annotatedBase64 || bildInBearbeitung.originalBase64 || '')

// ── Detailfenster: Speichern ───────────────────────────────────────────────

async function speichereExkursion() {
    const felder = ['stopLoss', 'maePrice', 'mfePrice']
    if (!felder.some(f => gesetzt(exkursionEntwurf[f]))) return
    setupsLaden.value = true
    // Leer, NaN oder fehlend wird null — nie NaN in die DB
    const datensatz = {}
    for (const f of felder) datensatz[f] = istZahl(exkursionEntwurf[f]) ? Number(exkursionEntwurf[f]) : null
    const vorhanden = await dbFirst('excursions', { equalTo: { tradeId: exkursionTradeId.value } })
    if (vorhanden) {
        await dbUpdate('excursions', vorhanden.objectId, datensatz)
    } else {
        await dbCreate('excursions', { ...datensatz, dateUnix: exkursionTagUnix.value, tradeId: exkursionTradeId.value })
        tradeId.value = exkursionTradeId.value
    }
    await bestimmeBereich()
    await ladeExkursionen()
}

/**
 * Ausstehende Änderungen des BISHER gezeigten Trades speichern
 * (docs/spec/f3-trade-dialog.md §4). Bedienbar ist heute nur die Exkursion
 * (MFE-Eingabe, „Übernehmen"). Notiz, Tags und Bild haben im Trade-Fenster
 * keine Eingabe mehr; bekommen sie eine, gilt die Reihenfolge Notiz →
 * Exkursion → Tags → Bild, nacheinander. Ein Fehler bricht ab (Konsole, der
 * zentrale Fehlerhinweis von db.js zeigt ihn); die Merker gehen immer zurück.
 */
async function speichereAusstehendes() {
    try {
        if (tradeExkursionGeaendert.value) await speichereExkursion()
    } catch (fehler) {
        console.error('Tagesansicht: Speichern fehlgeschlagen', fehler)
    } finally {
        tradeExkursionGeaendert.value = false
    }
}

// ── Detailfenster: Kerzenchart ─────────────────────────────────────────────

function entsorgeKerzen() {
    groessenBeobachter?.disconnect()
    groessenBeobachter = null
    const knoten = kerzenEl.value
    // Nie gezeichnet → Diagramm-Modul womöglich nie geladen, dann gibt es nichts zu entsorgen
    if (knoten) geladeneDiagramme()?.disposeCharts([knoten])
}

function beobachteGroesse(instanz) {
    groessenBeobachter?.disconnect()
    if (typeof ResizeObserver === 'undefined' || !kerzenEl.value) return
    groessenBeobachter = new ResizeObserver(() => { if (!instanz.isDisposed?.()) instanz.resize() })
    groessenBeobachter.observe(kerzenEl.value)
}

function kerzenFehlerText(fehler) {
    const status = fehler?.response?.status
    if (status === 429) return t('daily.chartZuViele')
    if (status === 400) return t('daily.chartNichtVerfuegbar')
    if (fehler?.response) return fehler.response.statusText || t('daily.chartNichtVerfuegbar')
    return fehler?.message || t('daily.chartNichtVerfuegbar')
}

/**
 * Kerzen ±6 h um den Einstieg, fest 15m, vom FUTURES-Markt (Abschnitt 0,
 * D.16-3/-4): das Journal handelt Futures, Symbole wie 1000PEPEUSDT haben gar
 * keinen Spot-Markt.
 */
async function zeichneKerzen(trade, karte, meta) {
    if (!binanceChartAn.value || !trade.symbol) return
    const auftrag = ++kerzenAuftrag
    const zone = tradeZeitzone.value
    const mitte = trade.entryTime
        ? Number(trade.entryTime) * 1000
        : dayjs.unix(trade.td ?? karte.dateUnix).tz(zone).startOf('day').add(12, 'hour').valueOf()
    const von = mitte - 6 * 3600 * 1000
    const bis = mitte + 6 * 3600 * 1000
    const symbol = String(trade.symbol).toUpperCase()
    const schluessel = `${symbol}|15m|${von}|${bis}`
    kerzenLaedt.value = true
    try {
        let kerzen = kerzenCache.get(schluessel)
        if (!kerzen) {
            const antwort = await axios.get('/api/binance/klines', {
                params: { symbol, interval: '15m', startTime: von, endTime: bis, limit: 1500, market: 'futures' },
            })
            // Marktdatenquelle aus oder ohne Kerzen (S12): der Server antwortet mit
            // `{ aus, meldung }` statt einer Liste — den Grund zeigen, nicht nur „nicht verfügbar".
            if (antwort.data?.aus) {
                if (auftrag === kerzenAuftrag) kerzenFehler.value = antwort.data.meldung || t('daily.chartNichtVerfuegbar')
                return
            }
            const roh = Array.isArray(antwort.data) ? antwort.data : []
            kerzen = {
                zeiten: roh.map(k => Number(k[0])),
                // Reihenfolge [Schluss, Eröffnung, Tief, Hoch] erwartet kerzenDiagramm
                preise: roh.map(k => [Number(k[4]), Number(k[1]), Number(k[3]), Number(k[2])]),
                volumen: roh.map(k => Number(k[5])),
            }
            if (kerzen.zeiten.length) merkeKerzen(schluessel, kerzen)
        }
        // Inzwischen weitergeblättert oder geschlossen → dieses Ergebnis gehört niemandem mehr
        if (auftrag !== kerzenAuftrag || !tradeDetailOffen.value) return
        if (!kerzen.zeiten.length) {
            kerzenFehler.value = t('daily.chartNichtVerfuegbar')
            return
        }
        await nextTick()
        const d = await ladeDiagramme()
        if (auftrag !== kerzenAuftrag || !tradeDetailOffen.value) return
        // Kopie mit Metadaten: das Store-Objekt in journalTage bleibt unverändert
        const mitMeta = meta ? { ...trade, _tradingMeta: meta } : { ...trade }
        const instanz = await d.kerzenDiagramm(kerzen.zeiten, kerzen.preise, kerzen.volumen, mitMeta, true)
        instanz.resize()
        beobachteGroesse(instanz)
    } catch (fehler) {
        console.error('Tagesansicht: Kerzenchart', fehler)
        if (auftrag === kerzenAuftrag) kerzenFehler.value = kerzenFehlerText(fehler)
    } finally {
        if (auftrag === kerzenAuftrag) kerzenLaedt.value = false
    }
}

/**
 * MFE aus Kerzen zwischen Ein- und Ausstieg. Lange Trades bekommen ein
 * gröberes Intervall, damit die 1500 Kerzen den GANZEN Trade abdecken und nicht
 * nur seinen Anfang.
 */
async function berechneMfe(trade) {
    const ein = Number(trade.entryTime)
    const aus = Number(trade.exitTime)
    if (!ein || !aus || !trade.symbol || aus <= ein) return null
    const minuten = (aus - ein) / 60
    const intervall = minuten <= 1500 ? '1m' : minuten <= 7500 ? '5m' : minuten <= 22500 ? '15m' : '1h'
    try {
        const antwort = await axios.get('/api/binance/klines', {
            params: { symbol: String(trade.symbol).toUpperCase(), interval: intervall, startTime: ein * 1000, endTime: aus * 1000, limit: 1500, market: 'futures' },
        })
        const roh = Array.isArray(antwort.data) ? antwort.data : []
        if (!roh.length) return null
        const werte = roh.map(k => Number(trade.strategy === 'long' ? k[2] : k[3])).filter(Number.isFinite)
        if (!werte.length) return null
        return trade.strategy === 'long' ? Math.max(...werte) : Math.min(...werte)
    } catch (fehler) {
        console.error('Tagesansicht: MFE', fehler)
        return null
    }
}

// ── Detailfenster: Öffnen, Blättern, Schliessen ────────────────────────────

// Ablauf nach docs/spec/f3-trade-dialog.md §5.

/**
 * Das Bild zum Trade: zuerst das eigene (`name` = Trade-ID), sonst das erste
 * Bild des Tages — ein Tagesbild gilt für jeden Trade des Tages.
 */
function findeBild(trade, karte) {
    return bilder.find(b => b?.name === trade.id)
        || bilder.find(b => b?.dateUnixDay === karte.dateUnix)
        || null
}

/** Alles, was das Fenster zum gezeigten Trade braucht (§5.2 Schritte 6–13). */
async function fuelleFenster(karte, trade, meinWechsel) {
    // Tagesbilder einmal je Fenster-Sitzung, wenn die Liste leer ist oder zu einem anderen Tag gehört
    if (!fensterBilderGeprueft) {
        fensterBilderGeprueft = true
        if (!bilder.length || bilder[0]?.dateUnixDay !== karte.dateUnix) await ladeBilderDesTages(karte.dateUnix)
    }

    // Zurücksetzen; der Speicherkontext der Exkursion zeigt SOFORT auf den neuen Trade
    for (const k of Object.keys(exkursionEntwurf)) delete exkursionEntwurf[k]
    Object.assign(exkursionEntwurf, { stopLoss: null, maePrice: null, mfePrice: null })
    tagsDesTrades.length = 0
    offeneGruppen.clear()
    mfeAuto.value = false
    exkursionTradeId.value = trade.id
    exkursionTagUnix.value = karte.dateUnix

    // Bild: kennt die Monatsübersicht eines, das noch nicht geladen ist, die Tagesbilder nachholen
    let bild = findeBild(trade, karte)
    if (!bild && bilderDesMonats.some(b => b.dateUnixDay === karte.dateUnix)) {
        await ladeBilderDesTages(karte.dateUnix)
        bild = findeBild(trade, karte)
    }
    for (const k of Object.keys(bildInBearbeitung)) delete bildInBearbeitung[k]
    Object.assign(bildInBearbeitung, bild ? { ...bild } : { side: null, type: null })
    kerzenFehler.value = null

    // Tags nur des Trades, nicht des Tages
    tagsDesTrades.push(...tagsFuerTrade(trade.id))

    // Notiz (nur Anzeige, ohne HTML), Metadaten und Trade-Typen
    tradingMeta.value = null
    tradeTypeRef.value = ''
    closingTradeTypeRef.value = ''
    notizText.value = ''
    const notiz = notes.find(n => n.tradeId == trade.id)
    if (notiz) {
        notizText.value = notizOhneHtml(notiz.note)
        tradingMeta.value = notiz.tradingMetadata || null
        tradeTypeRef.value = notiz.tradeType || ''
        closingTradeTypeRef.value = notiz.closingTradeType || ''
    }

    const exkursion = excursions.find(x => x.tradeId == trade.id)
    if (exkursion) {
        for (const f of ['stopLoss', 'maePrice', 'mfePrice']) if (gesetzt(exkursion[f])) exkursionEntwurf[f] = exkursion[f]
    }

    // Kerzen nicht abwarten: die Eingaben sollen nicht auf die Börse warten
    zeichneKerzen(trade, karte, tradingMeta.value)

    // Auto-MFE nur zeigen, nicht als Änderung merken (D.16-2)
    if (binanceChartAn.value && !gesetzt(exkursionEntwurf.mfePrice)) {
        const wert = await berechneMfe(trade)
        const nochDa = meinWechsel === wechselNr && tradeDetailOffen.value
        if (Number.isFinite(wert) && nochDa && !gesetzt(exkursionEntwurf.mfePrice)) {
            exkursionEntwurf.mfePrice = wert
            mfeAuto.value = true
        }
    }
}

/**
 * Zu einem Trade der Karte wechseln — beim Öffnen wie beim Blättern (§5.2).
 * Vorher wird gespeichert, was am bisher gezeigten Trade offen ist.
 *
 * @returns {Promise<boolean>} gewechselt ja/nein
 */
async function zeigeTrade(karteIndex, tradeIndex) {
    if (markierungOffen.value) {
        alert(t('common.screenshotSaveAnnotation'))
        return false
    }
    const meinWechsel = ++wechselNr
    setupsLaden.value = true
    await speichereAusstehendes()

    if (!tradeDetailOffen.value) kerzenSchluessel.value++   // frischer Knoten je Öffnen, nicht je Blättern
    offenerTagIndex.value = karteIndex
    tradeIndexAktiv.value = tradeIndex
    tradeDetailOffen.value = true
    dialogOffen.value = true

    const karte = journalTage[karteIndex]
    const trade = karte?.trades?.[tradeIndex]
    if (karte && trade) {
        try {
            await fuelleFenster(karte, trade, meinWechsel)
        } catch (fehler) {
            console.error('Tagesansicht: Trade-Fenster füllen', fehler)
        }
    }
    // Nur der jüngste Wechsel gibt die Knöpfe frei; „Speichern nötig" geht nach JEDEM Wechsel zurück (Eigenart)
    if (tradeDetailOffen.value && meinWechsel === wechselNr) {
        setupsLaden.value = false
        speichernNoetig.value = false
    }
    return true
}

/** Klick oder Enter auf eine Trade-Zeile. Lädt das Fenster gerade, zählt der Klick nicht. */
function oeffneTrade(karteIndex, tradeIndex) {
    if (tradeDetailOffen.value && setupsLaden.value) return
    zeigeTrade(karteIndex, tradeIndex)
}

/** Vorheriger (−1) oder nächster (+1) Trade derselben Karte — nie über die Karte hinaus. */
function blaettere(schritt) {
    if (!tradeDetailOffen.value || setupsLaden.value) return
    const ziel = tradeIndexAktiv.value + schritt
    if (!offeneKarte.value?.trades?.[ziel]) return
    zeigeTrade(offenerTagIndex.value, ziel)
}

/**
 * Speichern und aufräumen (§5.4 ab Schritt 4); der Aufrufer hat den Dialog
 * schon als zu vermerkt.
 *
 * @returns {Promise<boolean>} geschlossen ja/nein (nein: Markierung läuft)
 */
async function beendeTradeFenster() {
    if (markierungOffen.value) {
        alert(t('common.screenshotSaveAnnotation'))
        return false
    }
    setupsLaden.value = true
    await speichereAusstehendes()
    wechselNr++
    entsorgeKerzen()
    kerzenAuftrag++
    setupsLaden.value = false
    offenerTagIndex.value = undefined
    tradeIndexAktiv.value = undefined
    tradeExkursionGeaendert.value = false
    speichernNoetig.value = false
    tradeDetailOffen.value = false
    dialogOffen.value = false
    fensterBilderGeprueft = false
    kerzenFehler.value = null
    kerzenLaedt.value = false
    offeneGruppen.clear()
    tagsDesTrades.length = 0
    return true
}

/**
 * Der eine Schliessweg: ×, Esc und der Knopf unten. Der Dialog-Baustein meldet
 * × und das native `close` beide — das zweite Melden fällt hier durch.
 */
async function schliesseTrade() {
    if (!dialogOffen.value) return false
    if (markierungOffen.value) {
        alert(t('common.screenshotSaveAnnotation'))
        // Esc hat den nativen Dialog schon zugemacht: wieder öffnen
        if (!detailEl.value?.closest('dialog')?.open) {
            dialogOffen.value = false
            await nextTick()
            dialogOffen.value = true
        }
        return false
    }
    dialogOffen.value = false
    return beendeTradeFenster()
}

// ── MFE-Eingabe ────────────────────────────────────────────────────────────

function markiereExkursion() {
    exkursionTagUnix.value = offeneKarte.value?.dateUnix
    exkursionTradeId.value = offenerTrade.value?.id
    tradeExkursionGeaendert.value = true
    speichernNoetig.value = true
    mfeAuto.value = false
}

function mfeGeaendert(e) {
    const roh = e.target.value
    exkursionEntwurf.mfePrice = roh === '' || !Number.isFinite(parseFloat(roh)) ? null : parseFloat(roh)
    markiereExkursion()
}

// ── Orderbuch zum Trade ────────────────────────────────────────────────────

const replayVerfuegbar = ref(false)
const replayGeprueft = ref(false)
let replayAuftrag = 0

const replayFenster = computed(() => {
    const tr = offenerTrade.value
    if (!tr?.symbol || !tr.entryTime) return null
    const puffer = 15 * 60 * 1000
    const ein = Number(tr.entryTime) * 1000
    const aus = tr.exitTime ? Number(tr.exitTime) * 1000 : ein + puffer
    const von = ein - puffer
    // Der Server liefert höchstens 48 h
    const bis = Math.min(aus + puffer, von + 48 * 3600 * 1000)
    return { symbol: String(tr.symbol).toUpperCase(), von, bis, ein, aus }
})

async function pruefeReplay() {
    const auftrag = ++replayAuftrag
    replayGeprueft.value = false
    replayVerfuegbar.value = false
    if (!tradeDetailOffen.value) return
    const f = replayFenster.value
    if (!f) { replayGeprueft.value = true; return }
    let verfuegbar = false
    try {
        const antwort = await axios.get('/api/live/recorder/available', {
            params: { symbol: f.symbol, market: 'futures', from: f.von, to: f.bis },
        })
        verfuegbar = Array.isArray(antwort.data?.stunden) && antwort.data.stunden.length > 0
    } catch {
        verfuegbar = false
    }
    // Späte Antwort eines inzwischen verlassenen Trades verwerfen
    if (auftrag !== replayAuftrag) return
    replayVerfuegbar.value = verfuegbar
    replayGeprueft.value = true
}

watch([tradeDetailOffen, tradeIndexAktiv, offenerTagIndex], () => { if (tradeDetailOffen.value) pruefeReplay() })

/** Per Router (Abschnitt 0, D.16-8); Liquidity liest die Query beim Einhängen. Vorher speichern und schliessen. */
async function oeffneOrderbuch() {
    const f = replayFenster.value
    const tr = offenerTrade.value
    if (!f || !replayVerfuegbar.value || !tr) return
    const query = {
        replay: '1', symbol: f.symbol, market: 'futures',
        from: String(Math.round(f.von)), to: String(Math.round(f.bis)),
        entry: String(Math.round(f.ein)), exit: String(Math.round(f.aus)),
        label: `Trade ${formUhrzeitSek(tr.entryTime)}`,
    }
    if (dialogOffen.value) {
        dialogOffen.value = false
        const zu = await beendeTradeFenster()
        if (!zu) { dialogOffen.value = true; return }
    }
    router.push({ path: '/liquidity', query })
}

// ── Screenshot-Vorschau ────────────────────────────────────────────────────

/** Vorschau rechts im Fuss: das Bild als Einzelbild im Vollbild, das über dem Trade-Fenster liegt. */
function zeigeVollbild() {
    zeigeImVollbild(-1, bildInBearbeitung)
}

// ── KI-Bewertung und Share-Karte ───────────────────────────────────────────

function kiBewertung(karte, index) {
    offenerTagIndex.value = karte
    tradeIndexAktiv.value = index
    const tag = journalTage[karte]
    const tr = tag?.trades?.[index]
    if (!tr) return
    const pnl = Number(tr.grossProceeds || tr.grossSharePL || 0)
    // Datum aus dateUnix: `date` der Tageszeile ist nur die Tageszahl (journal-kern §7.11)
    const agentPrompt = t('daily.aiPrompt', {
        symbol: tr.symbol || '',
        richtung: tr.strategy === 'short' ? 'Short' : 'Long',
        datum: formDatum(tag.dateUnix),
        dateUnix: tag.dateUnix,
        einstieg: tr.entryPrice ?? '',
        ausstieg: tr.exitPrice ?? tr.closePrice ?? '',
        pnl: `$${pnl.toFixed(2)}`,
    })
    router.push({ path: '/ki-coach', query: { agentPrompt } })
}

const shareOffen = ref(false)
const shareTrade = ref(null)

/** Tag-IDs der ersten Katalog-Gruppe — sie gilt als „Strategie" auf der Karte. */
const ersteGruppeIds = () => new Set(listeVon(verfuegbareTags[0]?.tags).map(x => x.id))

function shareObjekt(trade, karte, meta, tagNamen) {
    const richtung = trade.strategy || (trade.side === 'SS' || trade.side === 'BC' ? 'short' : 'long')
    return {
        symbol: trade.symbol || '',
        strategy: richtung,
        entryPrice: trade.entryPrice || 0,
        exitPrice: trade.exitPrice || 0,
        netProceeds: trade.netProceeds || 0,
        grossProceeds: trade.grossProceeds || 0,
        leverage: meta?.leverage || trade.leverage || 0,
        commission: trade.commission || 0,
        fundingFee: trade.fundingFee || 0,
        dateUnix: karte?.dateUnix || 0,
        entryTime: trade.entryTime || karte?.dateUnix || 0,
        exitTime: trade.exitTime || 0,
        tagNames: tagNamen,
        rrr: meta?.rrr || '',
    }
}

function shareAusZeile(karte, index) {
    const tag = journalTage[karte]
    const tr = tag?.trades?.[index]
    if (!tr) return
    const erste = ersteGruppeIds()
    const zuordnung = tags.find(x => x.tradeId == tr.id)
    const namen = listeVon(zuordnung?.tags).filter(id => erste.has(id)).map(id => tagAngaben(id).name).filter(Boolean)
    const meta = notes.find(x => x.tradeId == tr.id)?.tradingMetadata || null
    shareTrade.value = shareObjekt(tr, tag, meta, namen)
    shareOffen.value = true
}

function shareAusFenster() {
    const tr = offenerTrade.value
    if (!tr) return
    const erste = ersteGruppeIds()
    const namen = tagsDesTrades.filter(x => erste.has(x.id)).map(x => x.name).filter(Boolean)
    shareTrade.value = shareObjekt(tr, offeneKarte.value, tradingMeta.value, namen)
    shareOffen.value = true
}

// ── Lebenszyklus ───────────────────────────────────────────────────────────

onMounted(async () => {
    reiterZuruecksetzen()
    await starteTagesansicht()
    if (scrollToDateUnix.value) {
        await nextTick()
        springeZuTag(scrollToDateUnix.value)
    }
})

onBeforeUnmount(() => {
    // Seite verlassen mit offenem Fenster: Änderungen nicht verlieren, Zustand für andere Seiten aufräumen
    if (tradeDetailOffen.value) {
        speichereAusstehendes()
        tradeDetailOffen.value = false
        offenerTagIndex.value = undefined
        tradeIndexAktiv.value = undefined
        speichernNoetig.value = false
    }
    kerzenAuftrag++
    replayAuftrag++
    groessenBeobachter?.disconnect()
    useDisposeJournalCharts()
})
</script>

<template>
    <SeiteLaedt />

    <div v-if="!seiteLaedt" class="tagesansicht">
        <Leerzustand v-if="zeigeLeer" :titel="t('common.noData')" />

        <template v-else>
            <Karte v-for="(karte, ki) in journalTage" :id="`daily-card-${karte.dateUnix}`"
                :key="`${karte.dateUnix}-${ki}`" class="tageskarte">
                <header class="kartenkopf">
                    <h3 class="datum">{{ formDatumLang(karte.dateUnix) }}</h3>

                    <dl v-if="karte.pAndL" class="kennzahlen">
                        <div><dt>{{ t('daily.kzTrades') }}</dt><dd>{{ karte.pAndL.trades }}</dd></div>
                        <div><dt>{{ t('daily.kzWins') }}</dt><dd class="at-gut">{{ karte.pAndL.grossWinsCount }}</dd></div>
                        <div><dt>{{ t('daily.kzLosses') }}</dt><dd class="at-schlecht">{{ karte.pAndL.grossLossCount }}</dd></div>
                        <div><dt>{{ t('daily.kzFees') }}</dt><dd>{{ geld(karte.pAndL.fees) }}</dd></div>
                        <div>
                            <dt>{{ t('daily.colPnlGross') }}</dt>
                            <dd :class="karte.pAndL.grossProceeds >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(karte.pAndL.grossProceeds) }}</dd>
                        </div>
                    </dl>
                    <!-- Bewusst keine Nullen: zwei Tageszeilen am selben Tag, nur eine hat pAndL -->
                    <p v-else class="kennzahlenFehlen">
                        <Symbol name="warnung" />{{ t('daily.kennzahlenFehlen') }}
                    </p>
                </header>

                <!-- Der Reiter-Baustein meldet auch den Klick auf den aktiven Reiter: der klappt zu -->
                <Reiter :model-value="offenerReiter[ki] || ''" :reiter="REITER"
                    @update:model-value="(id) => waehleReiter(ki, id)" />

                <!-- Reiter „Trades" -->
                <div v-if="offenerReiter[ki] === 'trades'" class="at-tabelle-huelle huelle">
                    <table class="at-tabelle dicht">
                        <thead>
                            <tr>
                                <th>{{ t('daily.colSymbol') }}</th>
                                <th v-if="kiAn"><span class="at-unsichtbar">{{ t('daily.aiReview') }}</span></th>
                                <th class="zahl">
                                    <span class="kopfMitInfo">{{ t('daily.colVol') }}<InfoTipp schluessel="daily.volTooltip" /></span>
                                </th>
                                <th>{{ t('daily.colPosition') }}</th>
                                <th>{{ t('daily.entry') }}</th>
                                <th class="zahl">
                                    <span class="kopfMitInfo">{{ t('daily.colPnlStk') }}<InfoTipp schluessel="daily.pnlPerUnitTooltip" /></span>
                                </th>
                                <th class="zahl">{{ t('daily.colPnlNet') }}</th>
                                <th><span class="at-unsichtbar">{{ t('daily.bild') }}</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(trade, ti) in karte.trades" :key="trade.id ?? ti" class="tradezeile" tabindex="0"
                                @click="oeffneTrade(ki, ti)" @keydown.enter="oeffneTrade(ki, ti)">
                                <td class="at-halbfett">{{ trade.symbol }}</td>
                                <td v-if="kiAn" class="aktionen" @click.stop @keydown.stop>
                                    <Knopf art="leise" klein nur-symbol symbol="gehirn" :titel="t('daily.aiReview')"
                                        @click="kiBewertung(ki, ti)" />
                                    <Knopf art="leise" klein nur-symbol symbol="teilen" :titel="t('daily.shareCard')"
                                        @click="shareAusZeile(ki, ti)" />
                                </td>
                                <td class="zahl">{{ trade.buyQuantity + trade.sellQuantity }}</td>
                                <td>{{ position(trade.strategy) }}</td>
                                <td class="at-nowrap">
                                    <template v-if="trade.tradesCount == 0">
                                        <span class="einstieg">
                                            {{ trade.openPosition ? t('daily.open') : t('daily.closed') }}
                                            <InfoTipp :text="trade.openPosition
                                                ? t('daily.swingOpenedOn', { date: formDatum(trade.entryTime) })
                                                : t('daily.swingClosedOn', { date: formDatum(trade.exitTime) })" />
                                        </span>
                                    </template>
                                    <span v-else class="einstieg">
                                        {{ formUhrzeitSek(trade.entryTime) }}
                                        <InfoTipp v-if="einstiegHinweis(trade, karte)" :text="einstiegHinweis(trade, karte)" />
                                    </span>
                                </td>
                                <td class="zahl">
                                    <template v-if="trade.tradesCount != 0">
                                        <span v-if="trade.type === 'forex'">-</span>
                                        <span v-else :class="trade.grossSharePL >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(trade.grossSharePL) }}</span>
                                    </template>
                                </td>
                                <td class="zahl">
                                    <span v-if="trade.tradesCount != 0" :class="trade.netProceeds >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(trade.netProceeds) }}</span>
                                </td>
                                <td class="bildspalte">
                                    <Symbol v-if="hatBild(trade)" name="bild" :titel="t('daily.bild')" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Reiter „Blotter" -->
                <div v-else-if="offenerReiter[ki] === 'blotter'" class="at-tabelle-huelle huelle">
                    <table :id="`table${ki}`" class="at-tabelle dicht">
                        <thead>
                            <tr>
                                <th>{{ t('daily.colSymbol') }}</th>
                                <th class="zahl">{{ t('daily.colVol') }}</th>
                                <th class="zahl">{{ t('daily.colPnlGross') }}</th>
                                <th class="zahl">{{ t('daily.colFeesTotal') }}</th>
                                <th class="zahl">{{ t('daily.colPnlNet') }}</th>
                                <th class="zahl">{{ t('daily.kzWins') }}</th>
                                <th class="zahl">{{ t('daily.kzLosses') }}</th>
                                <th class="zahl">{{ t('daily.kzTrades') }}</th>
                                <th class="zahl">{{ t('daily.colExecutions') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(b, bi) in Object.values(karte.blotter || {})" :key="bi">
                                <td class="at-halbfett">{{ b.symbol }}</td>
                                <td class="zahl">{{ addiereGenau(b.buyQuantity, b.sellQuantity) }}</td>
                                <td class="zahl" :class="b.grossProceeds >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(b.grossProceeds) }}</td>
                                <td class="zahl">{{ geld(b.fees) }}</td>
                                <!-- Farbe nach dem angezeigten Netto-Wert, nicht nach betragArt -->
                                <td class="zahl" :class="b.netProceeds >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(b.netProceeds) }}</td>
                                <td class="zahl">{{ b.grossWinsCount }}</td>
                                <td class="zahl">{{ b.grossLossCount }}</td>
                                <td class="zahl">{{ b.trades }}</td>
                                <td class="zahl">{{ b.executions }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </Karte>
        </template>

        <div v-if="ladeMehr" class="nachladen"><Kreisel /></div>
    </div>

    <!-- Trade-Detailfenster -->
    <Dialog :model-value="dialogOffen" :titel="dialogTitel" breite="72rem" :aussen-schliesst="false" @zu="schliesseTrade">
        <div v-if="tradeDetailOffen && offenerTrade" ref="detailEl" class="detail">
            <!-- Kerzenchart: frischer Knoten je Öffnen (key), ID ist Vorgabe von kerzenDiagramm -->
            <div v-if="binanceChartAn" class="kerzenbereich">
                <div v-show="!kerzenFehler" id="tagesKerzen" :key="kerzenSchluessel" ref="kerzenEl" class="kerzen"></div>
                <div v-if="kerzenLaedt && !kerzenFehler" class="kerzenLaden"><Kreisel :groesse="24" /></div>
                <p v-if="kerzenFehler" class="kerzenFehler">{{ kerzenFehler }}</p>
            </div>

            <!-- Orderbuch zum Trade -->
            <div v-if="replayFenster" class="orderbuch">
                <Knopf v-if="replayVerfuegbar" klein symbol="chart" @click="oeffneOrderbuch">{{ t('daily.orderbuch') }}</Knopf>
                <span v-else-if="replayGeprueft" class="at-gedaempft orderbuchFehlt">
                    {{ t('daily.orderbuchFehlt') }}<InfoTipp :text="t('daily.orderbuchFehltInfo')" />
                </span>
            </div>

            <!-- Detailtabelle -->
            <div class="at-tabelle-huelle huelle">
                <table class="at-tabelle dicht">
                    <thead>
                        <tr>
                            <th>{{ t('daily.colSymbol') }}</th>
                            <th class="zahl">{{ t('daily.colVol') }}</th>
                            <th>{{ t('daily.colPosition') }}</th>
                            <th>{{ t('daily.entry') }}</th>
                            <th class="zahl">{{ t('daily.colPrice') }}</th>
                            <th>{{ t('daily.colExit') }}</th>
                            <th class="zahl">{{ t('daily.colPrice') }}</th>
                            <th>{{ t('daily.colDuration') }}</th>
                            <th class="zahl">{{ t('daily.colPnlVol') }}</th>
                            <th class="zahl">{{ t('daily.colPnlNet') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="at-halbfett">{{ offenerTrade.symbol }}</td>
                            <td class="zahl">{{ offenerTrade.buyQuantity + offenerTrade.sellQuantity }}</td>
                            <td>{{ offenerTrade.side === 'B' ? t('daily.long') : t('daily.short') }}</td>
                            <td class="at-nowrap">
                                <span v-if="offenerTrade.tradesCount == 0" class="einstieg">
                                    {{ offenerTrade.openPosition ? t('daily.open') : t('daily.closed') }}
                                    <InfoTipp :text="offenerTrade.openPosition
                                        ? t('daily.swingOpenedOn', { date: formDatum(offenerTrade.entryTime) })
                                        : t('daily.swingClosedOn', { date: formDatum(offenerTrade.exitTime) })" />
                                </span>
                                <span v-else>{{ formUhrzeitSek(offenerTrade.entryTime) }}</span>
                            </td>
                            <td class="zahl at-nowrap">
                                <span v-if="offenerTrade.tradesCount != 0" class="einstieg">
                                    {{ preis(offenerTrade.entryPrice, offenerTrade.type === 'forex') }}
                                    <InfoTipp v-if="einstiegHinweis(offenerTrade, offeneKarte)" :text="einstiegHinweis(offenerTrade, offeneKarte)" />
                                </span>
                            </td>
                            <td class="at-nowrap">
                                <template v-if="offenerTrade.tradesCount != 0">{{ formUhrzeitSek(offenerTrade.exitTime) }}</template>
                            </td>
                            <td class="zahl at-nowrap">
                                <template v-if="offenerTrade.tradesCount != 0">{{ preis(offenerTrade.exitPrice, offenerTrade.type === 'forex') }}</template>
                            </td>
                            <td class="at-nowrap">
                                <template v-if="offenerTrade.tradesCount != 0">
                                    {{ selberHandelstag(offenerTrade.td ?? offeneKarte.dateUnix, offenerTrade.entryTime)
                                        ? formDauer(offenerTrade.exitTime - offenerTrade.entryTime)
                                        : formDauerTage(offenerTrade.exitTime - offenerTrade.entryTime) }}
                                </template>
                            </td>
                            <td class="zahl">
                                <span v-if="offenerTrade.tradesCount != 0 && offenerTrade.type !== 'forex'"
                                    :class="offenerTrade.grossSharePL >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(offenerTrade.grossSharePL) }}</span>
                            </td>
                            <td class="zahl">
                                <span v-if="offenerTrade.tradesCount != 0"
                                    :class="offenerTrade.netProceeds >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(offenerTrade.netProceeds) }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Trade-Typ -->
            <div v-if="tradeTypeRef || closingTradeTypeRef" class="tradetyp">
                <template v-if="tradeTypeRef && closingTradeTypeRef && tradeTypeRef !== closingTradeTypeRef">
                    <Pille ton="akzent">{{ typLabel(tradeTypeRef) }}</Pille>
                    <Symbol name="pfeilRechts" />
                    <Pille ton="warn">{{ typLabel(closingTradeTypeRef) }}</Pille>
                </template>
                <Pille v-else ton="neutral">{{ typLabel(closingTradeTypeRef || tradeTypeRef) }}</Pille>
            </div>

            <!-- Metadaten: Fills, Positionsgrösse, SL/BE/TP, Protokoll -->
            <section v-if="metaSichtbar" class="block">
                <div class="blockkopf">
                    <span class="at-halbfett">
                        {{ t('incoming.fills') }}
                        <span v-if="einstiegListe.length > 1" class="at-gedaempft">({{ einstiegListe.length }} {{ t('incoming.fillEntries') }})</span>
                    </span>
                    <span v-if="einstiegListe.length" class="at-gedaempft">
                        {{ t('incoming.fillAvgPrice') }}: {{ durchschnittEinstieg(fillListe).toFixed(5) }}
                    </span>
                </div>

                <div v-if="fillListe.length" class="fills">
                    <template v-for="g in fillGruppen" :key="g.id">
                        <div :class="['fillzeile', { schliessend: g.reduceOnly, klickbar: g.istGruppe }]"
                            :role="g.istGruppe ? 'button' : undefined" :tabindex="g.istGruppe ? 0 : undefined"
                            :aria-expanded="g.istGruppe ? offeneGruppen.has(g.id) : undefined"
                            @click="schalteGruppe(g)" @keydown.enter="schalteGruppe(g)">
                            <span class="fillzeit">
                                <Symbol v-if="g.istGruppe" :name="offeneGruppen.has(g.id) ? 'runter' : 'ausklappen'" />
                                {{ fillZeit(g.zeit) }}
                            </span>
                            <span class="fillrechnung">
                                {{ g.menge }} × {{ g.istGruppe ? g.preis.toFixed(5) : zahl(g.fills[0].price) }} = {{ g.wert.toFixed(2) }}
                            </span>
                            <Pille :ton="g.reduceOnly ? 'schlecht' : 'neutral'">
                                {{ fillTypText(g.typ) }}<template v-if="g.istGruppe"> ({{ g.fills.length }})</template>
                            </Pille>
                            <span class="at-gedaempft fillgebuehr">{{ t('incoming.fillFee') }}: {{ g.gebuehr.toFixed(4) }}</span>
                        </div>
                        <template v-if="g.istGruppe && offeneGruppen.has(g.id)">
                            <div v-for="(f, fi) in g.fills" :key="fi" class="fillzeile einzeln at-gedaempft">
                                <span class="fillzeit"></span>
                                <span class="fillrechnung">{{ zahl(f.qty) }} × {{ zahl(f.price) }} = {{ (zahl(f.qty) * zahl(f.price)).toFixed(2) }}</span>
                                <span></span>
                                <span class="fillgebuehr">{{ t('incoming.fillFee') }}: {{ zahl(f.fee).toFixed(4) }}</span>
                            </div>
                        </template>
                    </template>

                    <div v-if="fillListe.length > 1" class="fillsumme">
                        <span>{{ t('incoming.fillTotal') }}: {{ einstiegMenge }}</span>
                        <span>{{ t('incoming.fillFee') }}: {{ gebuehrGesamt.toFixed(4) }}</span>
                    </div>
                </div>

                <!-- Positionsgrösse unabhängig davon, ob Fills existieren -->
                <p v-if="tradingMeta.positionSize" class="zeile">
                    {{ t('incoming.positionSize') }}:
                    {{ zahl(tradingMeta.margin).toFixed(2) }} × {{ tradingMeta.leverage }}x = {{ zahl(tradingMeta.positionSize).toFixed(2) }} USDT
                </p>

                <p v-if="tradingMeta.sl || tradingMeta.tp || tradingMeta.breakeven" class="zeile sltp">
                    <span v-if="tradingMeta.sl" :class="tradingMeta.slAboveBreakeven ? 'slGesichert' : 'at-schlecht'">
                        SL: {{ tradingMeta.sl }}<template v-if="tradingMeta.slQty"> ({{ tradingMeta.slQty }})</template>
                    </span>
                    <span v-if="tradingMeta.breakeven" class="at-gedaempft">BE: {{ zahl(tradingMeta.breakeven).toFixed(2) }}</span>
                    <span v-if="tradingMeta.tp" class="at-warn">
                        TP: {{ tradingMeta.tp }}<template v-if="tradingMeta.tpQty"> ({{ tradingMeta.tpQty }})</template>
                    </span>
                    <span v-if="tradingMeta.rrr" class="rrr">RRR 1:{{ tradingMeta.rrr }}</span>
                </p>

                <div v-if="protokoll.length" class="protokoll">
                    <button type="button" class="protokollkopf" :aria-expanded="!protokollZu" @click="protokollZu = !protokollZu">
                        <Symbol name="verlauf" />
                        <span>{{ t('daily.tpslProtokoll') }}</span>
                        <Symbol :name="protokollZu ? 'runter' : 'hoch'" />
                    </button>
                    <ul v-if="!protokollZu" class="protokollliste">
                        <li v-for="(e, pi) in protokoll" :key="pi">
                            <span class="at-gedaempft">{{ fillZeit(e.time) }}</span>
                            <span :class="e.type === 'SL'
                                ? (tradingMeta.slAboveBreakeven ? 'slGesichert' : 'at-schlecht')
                                : (e.action === 'triggered' ? 'at-gut at-fett' : 'at-warn')">{{ e.type }}</span>
                            <span v-if="e.action === 'set'">
                                → {{ e.newVal }}<template v-if="e.qty"> ({{ e.qty }})</template>
                                <Pille ton="neutral">{{ t('daily.tpslGesetzt') }}</Pille>
                            </span>
                            <span v-else-if="e.action === 'moved'">
                                <s>{{ e.oldVal }}</s> → {{ e.newVal }}<template v-if="e.qty"> ({{ e.qty }})</template>
                                <Pille ton="akzent">{{ t('daily.tpslVerschoben') }}</Pille>
                            </span>
                            <span v-else-if="e.action === 'triggered'">
                                <s>{{ e.oldVal }}</s> → <span class="at-gut">{{ t('daily.tpslAusgeloest') }} ✓</span>
                            </span>
                            <span v-else-if="e.action === 'removed'">
                                <s>{{ e.oldVal }}</s> → {{ t('daily.tpslEntfernt') }}
                            </span>
                            <span v-if="e.rrr" class="rrr rechts">1:{{ e.rrr }}</span>
                        </li>
                    </ul>
                </div>
            </section>

            <!-- Bot-Aufschlüsselung (Pionex) -->
            <section v-if="botBreakdown" class="block">
                <div class="blockkopf"><span class="at-halbfett">{{ t('daily.botPnLBreakdown') }}</span></div>
                <div class="botsumme">
                    <span :class="['botnetto', botBreakdown.net >= 0 ? 'at-gut' : 'at-schlecht']">{{ botBetrag(botBreakdown.net, botBreakdown.coin) }}</span>
                    <span v-if="botBreakdown.showUsdt" class="at-gedaempft">(≈ {{ geld(botBreakdown.pnlUsdt) }})</span>
                    <span class="at-gedaempft">{{ t('daily.gesamtProfit') }}</span>
                </div>
                <div class="kacheln">
                    <template v-if="botBreakdown.hasGrid">
                        <div class="kachel">
                            <span class="kachelname">{{ t('daily.trendPnl') }}</span>
                            <span :class="botBreakdown.trend >= 0 ? 'at-gut' : 'at-schlecht'">{{ botBetrag(botBreakdown.trend, botBreakdown.coin) }}</span>
                        </div>
                        <div class="kachel">
                            <span class="kachelname">{{ t('daily.gridProfit') }}</span>
                            <span :class="botBreakdown.grid >= 0 ? 'at-gut' : 'at-schlecht'">{{ botBetrag(botBreakdown.grid, botBreakdown.coin) }}</span>
                        </div>
                    </template>
                    <div class="kachel">
                        <span class="kachelname">{{ t('daily.funding') }}</span>
                        <span :class="botBreakdown.funding >= 0 ? 'at-gut' : 'at-schlecht'">{{ botBetrag(botBreakdown.funding, botBreakdown.coin) }}</span>
                    </div>
                    <div class="kachel">
                        <span class="kachelname">{{ t('daily.tradingFeeLabel') }}</span>
                        <span>{{ botBetrag(botBreakdown.tradingFee, botBreakdown.coin) }}</span>
                    </div>
                    <div v-if="botBreakdown.leverage" class="kachel">
                        <span class="kachelname">{{ t('daily.leverage') }}</span>
                        <span>{{ botBreakdown.leverage }}x</span>
                    </div>
                    <div v-if="botBreakdown.investment" class="kachel">
                        <span class="kachelname">{{ t('daily.investment') }}</span>
                        <span>{{ botBetrag(botBreakdown.investment, botBreakdown.coin) }}</span>
                    </div>
                    <div v-if="botBreakdown.runtimeSec > 0" class="kachel">
                        <span class="kachelname">{{ t('daily.runtime') }}</span>
                        <span>{{ laufzeit(botBreakdown.runtimeSec) }}</span>
                    </div>
                </div>
                <p v-if="!botBreakdown.hasGrid" class="at-gedaempft zeile">{{ t('daily.botBreakdownReimport') }}</p>
            </section>

            <!-- Tags, MFE, Notiz -->
            <div v-if="setupsLaden" class="nachladen"><Kreisel /></div>
            <div v-else class="eingaben">
                <div class="feldgruppe">
                    <span class="at-label">{{ t('daily.tags') }}</span>
                    <div class="chips">
                        <span v-for="tag in tagsDesTrades" :key="tag.id" class="chip"
                            :style="{ '--chip-farbe': tagAngaben(tag.id).farbe }">{{ tag.name }}</span>
                        <span v-if="!tagsDesTrades.length" class="at-gedaempft">–</span>
                    </div>
                </div>

                <div class="feldgruppe">
                    <label class="at-label kopfMitInfo" for="daily-mfe">
                        {{ t('daily.mfePrice') }}<InfoTipp schluessel="daily.mfeTooltip" />
                    </label>
                    <div class="mfezeile">
                        <input id="daily-mfe" class="at-feld mfefeld" type="number" step="any"
                            :placeholder="t('daily.mfePlatzhalter')" :value="exkursionEntwurf.mfePrice ?? ''" @change="mfeGeaendert" />
                        <template v-if="mfeAuto">
                            <span class="at-gedaempft mfeauto">{{ t('daily.mfeAuto') }}</span>
                            <Knopf klein @click="markiereExkursion">{{ t('daily.mfeUebernehmen') }}</Knopf>
                        </template>
                    </div>
                </div>

                <div v-if="notizText" class="feldgruppe notiz">
                    <span class="at-label">{{ t('daily.note') }}</span>
                    <p class="notiztext">{{ notizText }}</p>
                </div>
            </div>

            <!-- Fuss: Share, Blättern, Schliessen, Screenshot-Vorschau -->
            <div class="detailfuss">
                <div class="fusslinks">
                    <Knopf v-if="hatVorherigen" nur-symbol symbol="einklappen" :titel="t('daily.vorheriger')"
                        :disabled="setupsLaden" @click="blaettere(-1)" />
                    <Knopf v-if="kiAn" symbol="teilen" @click="shareAusFenster">{{ t('daily.shareCard') }}</Knopf>
                </div>
                <Knopf :art="speichernNoetig ? 'haupt' : 'normal'" :disabled="setupsLaden" @click="schliesseTrade">
                    {{ speichernNoetig ? t('daily.closeAndSave') : t('daily.closeModal') }}
                </Knopf>
                <div class="fussrechts">
                    <button v-if="bildQuelle" type="button" class="vorschau" :title="t('common.enlarge')" @click="zeigeVollbild">
                        <img :src="bildQuelle" :alt="t('common.enlarge')" />
                    </button>
                    <Knopf v-if="hatNaechsten" nur-symbol symbol="ausklappen" :titel="t('daily.naechster')"
                        :disabled="setupsLaden" @click="blaettere(1)" />
                </div>
            </div>
        </div>
    </Dialog>

    <!-- Share-Karte: eigener <dialog>, öffnet nach dem Detailfenster und liegt damit darüber -->
    <ShareCardModal :trade="shareTrade" :visible="shareOffen" @close="shareOffen = false" />
</template>

<style scoped>
.tagesansicht {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-4);
    min-width: 0;
}

.tageskarte {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
    scroll-margin-top: calc(var(--kopf-hoehe) + var(--abstand-3));
}

.kartenkopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-2) var(--abstand-4);
}

.datum {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
}

.kennzahlen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2) var(--abstand-5);
    margin: 0;
}

.kennzahlen div {
    display: flex;
    flex-direction: column;
    min-width: 3.5rem;
}

.kennzahlen dt {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
}

.kennzahlen dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
}

.kennzahlenFehlen {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
}

.kennzahlenFehlen :deep(svg) {
    color: var(--warn);
}

.huelle {
    max-width: 100%;
}

.kopfMitInfo,
.einstieg {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.tradezeile {
    cursor: pointer;
}

.tradezeile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}

.aktionen {
    white-space: nowrap;
    width: 1%;
}

.bildspalte {
    width: 1%;
    color: var(--muted);
}

.nachladen {
    display: flex;
    justify-content: center;
    padding: var(--abstand-3);
}

/* ── Detailfenster ── */
.detail {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-4);
    min-width: 0;
}

.kerzenbereich {
    position: relative;
}

.kerzen {
    width: 100%;
    height: 360px;
}

.kerzenLaden {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.kerzenFehler {
    margin: 0;
    padding: var(--abstand-5) var(--abstand-3);
    text-align: center;
    color: var(--muted);
}

.orderbuch {
    display: flex;
    align-items: center;
}

.orderbuchFehlt {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
}

.tradetyp {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    color: var(--muted);
}

.block {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    padding: var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
}

.blockkopf {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--abstand-2);
}

.fills {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
}

.fillzeile {
    display: grid;
    grid-template-columns: minmax(6.5rem, auto) 1fr auto auto;
    align-items: center;
    gap: var(--abstand-2) var(--abstand-3);
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-klein);
}

.fillzeile.schliessend {
    background: var(--bad-flaeche);
}

.fillzeile.klickbar {
    cursor: pointer;
}

.fillzeile.einzeln {
    font-size: 0.8rem;
}

.fillzeit {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
}

.fillrechnung {
    min-width: 0;
    overflow-wrap: anywhere;
}

.fillgebuehr {
    white-space: nowrap;
}

.fillsumme {
    display: flex;
    justify-content: space-between;
    gap: var(--abstand-3);
    padding: 0.3rem 0.5rem;
    border-top: 1px solid var(--line);
    font-weight: 600;
}

.zeile {
    margin: 0;
    font-size: 0.85rem;
}

.sltp {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2) var(--abstand-4);
}

/* SL über Break-even: gesichert, deshalb nicht rot */
.slGesichert {
    color: color-mix(in srgb, var(--good) 70%, var(--text));
}

.rrr {
    margin-left: auto;
    color: var(--accent);
    font-weight: 600;
}

.protokollkopf {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
}

.protokollliste {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: var(--abstand-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.82rem;
}

.protokollliste li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.protokollliste li > span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.protokollliste .rechts {
    margin-left: auto;
}

.botsumme {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--abstand-2);
}

.botnetto {
    font-size: 1.4rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.kacheln {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--abstand-2);
}

.kachel {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: var(--abstand-2) var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel);
    font-variant-numeric: tabular-nums;
}

.kachelname {
    font-size: 0.72rem;
    color: var(--muted);
}

.eingaben {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
}

.feldgruppe {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

/* Hintergrund ist die Farbe der Katalog-Gruppe (Benutzerdaten), Rand und Text über Token */
.chip {
    padding: 0.15rem 0.6rem;
    border-radius: var(--radius-pille);
    background: color-mix(in srgb, var(--chip-farbe) 70%, var(--panel));
    border: 1px solid var(--line-stark);
    color: var(--text);
    font-size: 0.8rem;
}

.mfezeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.mfefeld {
    max-width: 14rem;
}

.mfeauto {
    font-size: 0.8rem;
}

.notiztext {
    margin: 0;
    white-space: pre-line;
    overflow-wrap: anywhere;
}

.detailfuss {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--abstand-2);
    padding-top: var(--abstand-3);
    border-top: 1px solid var(--line);
}

.fusslinks,
.fussrechts {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    min-width: 0;
}

.fussrechts {
    justify-content: flex-end;
}

.vorschau {
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: none;
    cursor: zoom-in;
    overflow: hidden;
}

.vorschau img {
    display: block;
    height: 42px;
    max-width: 96px;
    object-fit: cover;
}

@media (max-width: 600px) {
    .kerzen {
        height: 260px;
    }

    .fillzeile {
        grid-template-columns: 1fr auto;
    }

    .detailfuss {
        grid-template-columns: 1fr;
        justify-items: stretch;
    }

    .fusslinks,
    .fussrechts {
        justify-content: space-between;
    }
}
</style>
