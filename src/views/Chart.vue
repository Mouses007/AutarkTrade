<script setup>
/**
 * Chart-Arbeitsplatz — ersetzt seit 18.10.2026 die frühere Übersicht.
 *
 * Deren Marktkacheln stehen alle auch im Marktradar, ihre Journal-Kacheln im
 * Journal selbst; doppelt war sie überflüssig. Was hier stattdessen steht, ist
 * ein Chart im Stil von TradingView — aber mit dem, was TradingView nicht hat:
 * Journal, Strategie-Schicht und eigene Marktdaten im selben Bild.
 *
 * Aufteilung: diese Seite hält den Arbeitsstand (Layout, Watchlists) und die
 * Synchronisation zwischen den Panels; jedes `ChartPanel` holt und zeichnet
 * seine Kerzen selbst. Gespeichert wird in der Datenbank, nicht im
 * localStorage — ein Layout soll auf NAS, Dev-Rechner und Handy dasselbe sein.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ChartPanel from '../components/chart/ChartPanel.vue'
import ChartKopfleiste from '../components/chart/ChartKopfleiste.vue'
import WatchlistReiter from '../components/chart/WatchlistReiter.vue'
import IndikatorDialog from '../components/chart/IndikatorDialog.vue'
import Zeichenleiste from '../components/chart/Zeichenleiste.vue'
import ObjektReiter from '../components/chart/ObjektReiter.vue'
import StrategieReiter from '../components/chart/StrategieReiter.vue'
import AlarmReiter from '../components/chart/AlarmReiter.vue'
import KiReiter from '../components/chart/KiReiter.vue'
import AlarmDialog from '../components/chart/AlarmDialog.vue'
import MomentumBox from '../components/chart/MomentumBox.vue'
import IndikatorSchalter from '../components/chart/IndikatorSchalter.vue'
import VorlagenMenue from '../components/chart/VorlagenMenue.vue'
import { OVERLAYS, overlayAn } from '../utils/chart/overlays/liste.js'
import OffeneReiter from '../components/chart/OffeneReiter.vue'
import { Symbol, Hinweis, Kreisel } from '../components/basis'
import { alarme, abonniereAlarme, neueAusloesungen, quittiere } from '../stores/chartAlarme.js'
import { zeichnungenVon, aendere as zeichnungAendern, loesche as zeichnungLoeschen, macheRueckgaengig, macheWiederholen, fehlerMeldung } from '../stores/chartZeichnungen.js'
import { neueInstanz, saubereParams, INDIKATOREN } from '../utils/chart/indikatorRegister.js'
import { useIstTelefon } from '../utils/geraet.js'
import { api, standardLayout, vervollstaendige, passeAnRaster, PANELS_JE_RASTER, STANDARD_WATCHLIST } from '../utils/chart/arbeitsplatz.js'
import { passePanelAn, vorgabeBoerse, waehlbareBoersen, INTERVALLE, INTERVALLE_SICHTBAR, QUELLEN_OHNE, boerseFuer } from '../utils/chart/kerzenQuelle.js'
import { ladeMarktdaten } from '../utils/marktdaten.js'
import { useFetchOpenPositions } from '../utils/incoming.js'
import { incomingPollingActive } from '../stores/journal/offenePositionen.js'

const { t } = useI18n()
const telefon = useIstTelefon()

const layouts = ref([])
const layoutId = ref(null)
const daten = ref(standardLayout())
const watchlists = ref([])
const bereit = ref(false)
const ladeFehler = ref('')
const kopf = ref(null)
const panelRefs = ref([])

const sichtbareAnzahl = computed(() => (telefon.value ? 1 : PANELS_JE_RASTER[daten.value.raster] || 1))

/*
 * Vollbild: Doppelklick/Doppeltipp auf die Kerzen eines Panels. Gezeigt wird nur
 * dieses Panel über die ganze Fläche (CSS, fixed) — die anderen bleiben gemountet
 * und nur ausgeblendet, damit Kerzen und Ansicht beim Zurückschalten noch da sind.
 * Wo der Browser es erlaubt, zusätzlich echtes Vollbild (ohne Adressleiste);
 * iPhone-Safari kennt das für Seiten nicht, dort bleibt es beim CSS-Vollbild.
 * Zurück: noch einmal doppelt, Esc, oder das Verlassen des echten Vollbilds.
 */
const vollbild = ref(false)
function schalteVollbild(i) {
    if (!vollbild.value) {
        fokus(i)
        vollbild.value = true
        const el = document.documentElement
        if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => { /* nur CSS */ })
    } else {
        vollbild.value = false
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
}
/*
 * Im Vollbild: vom linken Rand hereinwischen → Indikator-Kurzwahl, vom rechten
 * Rand → Momentum Radar, als Schublade über dem Chart. Zu: Tipp daneben, zurück
 * zum Rand wischen oder Esc. Die Randzone ist 60 px breit, damit man knapp
 * NEBEN der Rückgeste von Android ansetzen kann (die schluckt den äussersten Rand).
 * Ein Wisch aus der Randzone erreicht den Chart nicht: Lightweight Charts hört
 * selbst auf touchstart/touchmove und verschob sonst das Bild, statt die
 * Schublade aufgehen zu lassen (Brave/Android, 21.10.2026). Rechts gilt das erst,
 * wenn die Bewegung waagrecht ist — senkrecht zieht man dort die Preisachse.
 */
const schublade = ref(null)          // null | 'links' | 'rechts'
const RAND = 60
const WISCH = 50
let wisch = null
function wischStart(e) {
    if (!vollbild.value || e.touches.length !== 1) { wisch = null; return }
    const x = e.touches[0].clientX, y = e.touches[0].clientY
    if (schublade.value) { wisch = { x, y, zu: true }; return }
    const breite = window.innerWidth
    wisch = x <= RAND ? { x, y, seite: 'links' } : x >= breite - RAND ? { x, y, seite: 'rechts' } : null
    // Links liegt nur Kerzenfläche: sofort abschirmen, sonst schiebt der Chart mit.
    // Rechts liegt die Preisachse — dort entscheidet erst die Richtung (siehe wischZug),
    // sonst liesse sich die Achse im Vollbild nicht mehr ziehen (21.10.2026).
    if (wisch?.seite === 'links') { wisch.fest = true; e.stopPropagation() }
}
function wischZug(e) {
    if (!wisch || e.touches.length !== 1) return
    const x = e.touches[0].clientX, y = e.touches[0].clientY
    if (!wisch.zu && !wisch.fest) {
        const dx = Math.abs(x - wisch.x), dy = Math.abs(y - wisch.y)
        if (dx < 8 && dy < 8) return
        // Senkrecht = Achse ziehen: die Geste gehört dem Chart.
        if (dy >= dx) { wisch = null; return }
        wisch.fest = true
    }
    if (wisch.fest) e.stopPropagation()
    wischAuswerten(x, y)
}
// Auch am Ende der Berührung: der Browser liefert touchmove gedrosselt oder bricht sie
// ab, sobald er selbst scrollt — dann käme die Geste sonst nie an.
function wischEnde(e) {
    if (wisch?.fest) e.stopPropagation()
    const p = e.changedTouches?.[0]
    if (wisch && p && (wisch.fest || wisch.zu)) wischAuswerten(p.clientX, p.clientY)
    wisch = null
}
function wischAuswerten(x, y) {
    const dx = x - wisch.x, dy = y - wisch.y
    // Etwas schräg ist erlaubt (Daumen ziehen selten waagrecht), steiler als ~56° nicht.
    if (Math.abs(dx) < WISCH || Math.abs(dy) > 1.5 * Math.abs(dx)) return
    // Nur eine Bewegung in die passende Richtung entscheidet; ein Ausreisser in die
    // Gegenrichtung beendet die Geste nicht.
    if (wisch.zu) {
        if ((schublade.value === 'links' && dx < 0) || (schublade.value === 'rechts' && dx > 0)) { schublade.value = null; wisch = null }
    } else if ((wisch.seite === 'links' && dx > 0) || (wisch.seite === 'rechts' && dx < 0)) {
        schublade.value = wisch.seite
        wisch = null
    }
}
watch(vollbild, (v) => { if (!v) schublade.value = null; else tfFavoriten.value = leseTfFavoriten() })

/*
 * Handy-Vollbild: die Kopfleiste ist weg, die Zeiteinheit soll trotzdem dezent
 * wählbar bleiben — nur die Favoriten (dieselben wie in der Kopfleiste,
 * `chartTfFavoriten` im Browser; gewählt werden sie dort über „…" und Stern).
 */
function leseTfFavoriten() {
    try {
        const roh = JSON.parse(localStorage.getItem('chartTfFavoriten') || 'null')
        const gueltig = Array.isArray(roh) ? roh.filter((i) => INTERVALLE.includes(i)) : []
        if (gueltig.length) return INTERVALLE.filter((i) => gueltig.includes(i))
    } catch { /* kein Speicher */ }
    return [...INTERVALLE_SICHTBAR]
}
const tfFavoriten = ref(leseTfFavoriten())
const tfGesperrt = computed(() => new Set(QUELLEN_OHNE[boerseFuer(aktivesPanel.value)] || []))

function vollbildVerlassen() {
    if (!document.fullscreenElement && vollbild.value) vollbild.value = false
}
const sichtbarePanels = computed(() => daten.value.panels.slice(0, sichtbareAnzahl.value))
const aktivIndex = computed(() => Math.min(daten.value.aktiv, sichtbareAnzahl.value - 1))
const aktivesPanel = computed(() => daten.value.panels[aktivIndex.value])
const rasterKlasse = computed(() => (telefon.value || vollbild.value ? 'r1' : 'r' + daten.value.raster))

/*
 * Seitenleisten-Reiter. Weitere (Journal, Strategien, Alarme, Objekte) kommen
 * mit ihren Ausbaustufen dazu; ein leerer Reiter wird gar nicht erst gezeigt.
 */
/*
 * Handy: die Reiterleiste steht ÜBER dem Chart (auch im Vollbild); ein Tipp
 * öffnet den Reiter als Fläche über dem Chart, derselbe Tipp schliesst ihn.
 */
const mobilReiter = ref(null)
function schalteMobilReiter(id) {
    if (mobilReiter.value === id) { mobilReiter.value = null; return }
    mobilReiter.value = id
    daten.value.seitenleiste.reiter = id
}
watch(telefon, (v) => { if (!v) mobilReiter.value = null })

const REITER = [
    { id: 'watchlist', icon: 'stern' },
    { id: 'offen', icon: 'fadenkreuz' },
    { id: 'objekte', icon: 'ebenen' },
    { id: 'strategien', icon: 'ki' },
    { id: 'alarme', icon: 'glocke' },
    { id: 'ki', icon: 'gehirn' },
]

// ── Laden und Speichern ─────────────────────────────────────────────────
let speicherUhr = null
let ignoriereNaechsteAenderung = false
// Stand des Layouts, wie er zuletzt gespeichert oder geladen wurde — gespeichert wird nur,
// was davon abweicht (vorher speicherte jeder Seitenabbau, auch ein unberührter Hintergrund-Tab).
let gespeichertText = ''
const konfliktHinweis = ref('')
/** Gespeicherte Binance-Panels wurden auf die Marktdatenquelle umgestellt (S12). */
const quellenHinweis = ref('')
const standVon = (id) => layouts.value.find((l) => l.id === id)?.geaendertAm

async function lade() {
    try {
        // Erst die Marktdatenquelle kennen: sie entscheidet, ob Binance-Panels bleiben dürfen.
        await ladeMarktdaten()
        let liste = await api.layouts()
        if (!liste.length) liste = [await api.layoutNeu(t('chart.layoutStandard'), standardLayout(), true)]
        layouts.value = liste
        const aktiv = liste.find((l) => l.aktiv) || liste[0]
        waehleLayout(aktiv)
        uebernimmSymbolAusAdresse()

        let wl = await api.watchlists()
        if (!wl.length) wl = [await api.watchlistNeu(t('chart.watchlistStandard'), STANDARD_WATCHLIST)]
        watchlists.value = wl
        bereit.value = true
    } catch (e) {
        ladeFehler.value = e.response?.data?.error || e.message
    }
}

/*
 * `/chart?symbol=XYZUSDT[&markt=spot][&boerse=bitunix]` — so verlinken Coin-Radar,
 * Hype-Radar und die Kacheln in den Chart (früher zu TradingView). Das Symbol geht
 * ins aktive Panel; danach verschwindet die Abfrage aus der Adresse, sonst setzte
 * jedes Neuladen das Panel wieder zurück.
 */
const route = useRoute()
const router = useRouter()
function uebernimmSymbolAusAdresse() {
    const roh = String(route.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!roh || !daten.value?.panels?.length) return
    const markt = route.query.markt === 'spot' ? 'spot' : 'futures'
    const patch = { symbol: roh, markt }
    const boerse = String(route.query.boerse || '').toLowerCase()
    if (boerse && waehlbareBoersen().includes(boerse)) patch.boerse = boerse
    // Aus Research & Co. geöffnet: eigener Coin-Tab (oder der vorhandene)
    oeffneCoinTab(roh, markt)
    setzePanel(patch)
    passePanelAn(aktivesPanel.value)
    router.replace({ query: {} })
    // Läuft direkt nach dem Laden des Layouts — dessen erster Änderungsschub wird
    // bewusst nicht gespeichert (ignoriereNaechsteAenderung). Ohne diesen Aufruf
    // ging der neue Tab beim nächsten Öffnen verloren.
    setTimeout(() => speichere(), 1000)
}

/*
 * Coin-Tabs unter der Kopfleiste: mehrere Coins offen halten und mit einem
 * Klick wechseln (wie Browser-Tabs). Gespeichert im Layout (`coinTabs`,
 * `coinTabAktiv`), also auf allen Geräten gleich. Ein Tab ist nur Symbol und
 * Markt; Zeiteinheit und Indikatoren bleiben die des Panels. Wechselt das
 * Symbol auf anderem Weg (Watchlist, Suche), übernimmt der aktive Tab es — ausser
 * ein anderer Tab hat es schon, dann wird der aktiv.
 */
const COIN_TABS_MAX = 12
const coinTabs = computed(() => {
    const t = daten.value?.coinTabs
    return Array.isArray(t) && t.length ? t : [{ symbol: aktivesPanel.value?.symbol || 'BTCUSDT', markt: aktivesPanel.value?.markt || 'futures' }]
})
const coinTabAktiv = computed(() => Math.min(Number(daten.value?.coinTabAktiv) || 0, coinTabs.value.length - 1))
const tabName = (tab) => String(tab.symbol).replace(/USDT$/, '') + (tab.markt === 'spot' ? ' · Spot' : '')
function setzeTabs(liste, aktiv) {
    daten.value.coinTabs = liste
    daten.value.coinTabAktiv = aktiv
}
function oeffneCoinTab(symbol, markt) {
    const liste = [...coinTabs.value]
    let i = liste.findIndex((t) => t.symbol === symbol && t.markt === markt)
    if (i < 0) {
        liste.push({ symbol, markt })
        while (liste.length > COIN_TABS_MAX) liste.shift()
        i = liste.length - 1
    }
    setzeTabs(liste, i)
}
/** Mittelklick in Watchlist / Offene Trades: Coin in neuem (oder seinem vorhandenen) Tab. */
function coinInNeuemTab(symbol, markt = 'futures') {
    oeffneCoinTab(symbol, markt)
    setzePanel({ symbol, markt })
}
function waehleCoinTab(i) {
    const tab = coinTabs.value[i]
    if (!tab) return
    setzeTabs([...coinTabs.value], i)
    setzePanel({ symbol: tab.symbol, markt: tab.markt })
}
// „+": das nächste gewählte Symbol kommt in einen neuen Tab. Bricht man die
// Suche ab, entsteht kein Tab.
let neuerTabWartet = false
function neuerCoinTab() {
    if (coinTabs.value.length >= COIN_TABS_MAX) return
    neuerTabWartet = true
    // Suche abgebrochen: nach einer Weile gilt der nächste Wechsel wieder dem aktiven Tab
    setTimeout(() => { neuerTabWartet = false }, 30_000)
    kopf.value?.oeffneSuche()
}
function schliesseCoinTab(i) {
    const liste = coinTabs.value.filter((_, j) => j !== i)
    if (!liste.length) return
    let aktiv = coinTabAktiv.value
    if (i < aktiv || aktiv >= liste.length) aktiv = Math.max(0, aktiv - 1)
    const war = i === coinTabAktiv.value
    setzeTabs(liste, aktiv)
    if (war) setzePanel({ symbol: liste[aktiv].symbol, markt: liste[aktiv].markt })
}
// Symbol auf anderem Weg gewechselt: aktiven Tab nachziehen (oder passenden aktivieren)
watch(() => [aktivesPanel.value?.symbol, aktivesPanel.value?.markt], ([symbol, markt]) => {
    if (!symbol || !bereit.value) return
    if (neuerTabWartet) { neuerTabWartet = false; oeffneCoinTab(symbol, markt); return }
    const liste = [...coinTabs.value]
    const i = liste.findIndex((t) => t.symbol === symbol && t.markt === markt)
    if (i >= 0) { if (i !== coinTabAktiv.value) daten.value.coinTabAktiv = i; return }
    liste[coinTabAktiv.value] = { symbol, markt }
    setzeTabs(liste, coinTabAktiv.value)
})
watch(() => route.query.symbol, (s) => { if (s && bereit.value) uebernimmSymbolAusAdresse() })

function waehleLayout(layout) {
    ignoriereNaechsteAenderung = true
    layoutId.value = layout.id
    const d = vervollstaendige(layout.daten)
    gespeichertText = JSON.stringify(d)
    /*
     * Panels auf Binance-Kerzen, obwohl Binance nicht (mehr) die Marktdaten-
     * quelle ist: auf die Vorgabe-Börse stellen und das sagen. Der Text oben
     * bleibt der alte Stand, damit die Umstellung gespeichert wird.
     */
    if (d.panels.map(passePanelAn).some(Boolean)) {
        const name = { bitget: 'Bitget', bitunix: 'Bitunix' }[vorgabeBoerse()] || vorgabeBoerse()
        quellenHinweis.value = t('chart.quelleUmgestellt', { quelle: name })
    }
    daten.value = d
    const i = layouts.value.findIndex((l) => l.id === layout.id)
    if (i >= 0) layouts.value[i] = { ...layouts.value[i], geaendertAm: layout.geaendertAm }
}

/*
 * Breite der Seitenleiste: am linken Rand ziehbar. Bewusst im Browser statt im
 * Layout — sie hängt am Bildschirm, nicht am Arbeitsplatz (Handy ≠ Monitor).
 */
const LEISTE_MIN = 200
const LEISTE_MAX = 720
const LEISTE_SCHLUESSEL = 'chartLeisteBreite'
function leseLeistenBreite() {
    try {
        const n = Number(localStorage.getItem(LEISTE_SCHLUESSEL))
        if (n >= LEISTE_MIN && n <= LEISTE_MAX) return n
    } catch { /* kein Speicher */ }
    return 260
}
const leisteBreite = ref(leseLeistenBreite())
let leisteZug = null

function leisteZiehenStart(e) {
    leisteZug = { x: e.clientX, breite: leisteBreite.value }
    e.target.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
}
function leisteZiehen(e) {
    if (!leisteZug) return
    // Griff sitzt links: nach links ziehen macht die Leiste breiter.
    const max = Math.min(LEISTE_MAX, window.innerWidth * 0.6)
    leisteBreite.value = Math.round(Math.max(LEISTE_MIN, Math.min(max, leisteZug.breite + leisteZug.x - e.clientX)))
}
function leisteZiehenEnde() {
    if (!leisteZug) return
    leisteZug = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { localStorage.setItem(LEISTE_SCHLUESSEL, String(leisteBreite.value)) } catch { /* kein Speicher */ }
}
function leisteZuruecksetzen() {
    leisteBreite.value = 260
    try { localStorage.removeItem(LEISTE_SCHLUESSEL) } catch { /* kein Speicher */ }
}

/*
 * Eingeklappte Seitenleiste: ein schmaler Streifen mit den Reiter-Symbolen,
 * wie das Seitenmenü links. Ein Klick auf ein Symbol klappt auf und öffnet
 * diesen Reiter. Wie die Breite im Browser gespeichert, nicht im Layout; am
 * Telefon und unter 992 px (Leiste unter dem Chart) gibt es den Streifen nicht.
 */
const LEISTE_SCHMAL = 46
const SCHMAL_SCHLUESSEL = 'chartLeisteSchmal'
const leisteSchmal = ref((() => { try { return localStorage.getItem(SCHMAL_SCHLUESSEL) === '1' } catch { return false } })())
const breitGenug = ref(typeof window === 'undefined' || window.innerWidth > 991)
function pruefeBreite() { breitGenug.value = window.innerWidth > 991 }
onMounted(() => window.addEventListener('resize', pruefeBreite))
onBeforeUnmount(() => window.removeEventListener('resize', pruefeBreite))
const istSchmal = computed(() => leisteSchmal.value && !telefon.value && breitGenug.value)
function schalteLeisteSchmal(an = !leisteSchmal.value) {
    leisteSchmal.value = an
    try { localStorage.setItem(SCHMAL_SCHLUESSEL, an ? '1' : '0') } catch { /* kein Speicher */ }
}
function oeffneReiter(id) {
    daten.value.seitenleiste.reiter = id
    schalteLeisteSchmal(false)
}

/*
 * Momentum-Box unten in der Seitenleiste: Höhe ziehbar, ein-/ausklappbar.
 * Beides im Browser — wie die Leistenbreite eine Frage des Bildschirms.
 */
const BOX_VORGABE = 330
function leseBox(schluessel, vorgabe) {
    try { const v = localStorage.getItem(schluessel); return v == null ? vorgabe : JSON.parse(v) } catch { return vorgabe }
}
function schreibeBox(schluessel, wert) {
    try { localStorage.setItem(schluessel, JSON.stringify(wert)) } catch { /* kein Speicher */ }
}
const boxOffen = ref(leseBox('chartMomentumBoxOffen', true) !== false)
const boxHoehe = ref(Math.max(80, Math.min(900, Number(leseBox('chartMomentumBoxHoehe', BOX_VORGABE)) || BOX_VORGABE)))
let boxZug = null
function schalteBox() { boxOffen.value = !boxOffen.value; schreibeBox('chartMomentumBoxOffen', boxOffen.value) }
function boxZiehenStart(e) {
    if (!boxOffen.value) return
    boxZug = { y: e.clientY, hoehe: boxHoehe.value, max: (e.currentTarget.parentElement?.clientHeight || 800) - 120 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    document.body.style.userSelect = 'none'
}
function boxZiehen(e) {
    if (!boxZug) return
    // Trenner sitzt ÜBER der Box: nach oben ziehen macht sie höher.
    boxHoehe.value = Math.round(Math.max(80, Math.min(boxZug.max, boxZug.hoehe + boxZug.y - e.clientY)))
}
function boxZiehenEnde() {
    if (!boxZug) return
    boxZug = null
    document.body.style.userSelect = ''
    schreibeBox('chartMomentumBoxHoehe', boxHoehe.value)
}
function boxHoeheZurueck() { boxHoehe.value = BOX_VORGABE; schreibeBox('chartMomentumBoxHoehe', BOX_VORGABE) }

/*
 * Eckgriff je Karte der Seitenleiste (Reiter-Inhalt, Indikatoren, Momentum Radar):
 * senkrecht ziehen = Höhe DIESER Karte, waagrecht = Breite der ganzen Leiste (sie
 * ist eine Spalte, alle Karten teilen sich die Breite). Doppelklick = zurück.
 * Der Griff sitzt UNTEN LINKS, weil die Leiste rechts steht und links wächst.
 * Gespeichert im Browser wie Leistenbreite und Box-Höhe; ohne Wert gilt das alte
 * Verhalten (Reiter füllt den Rest, Indikatoren so hoch wie ihr Inhalt).
 */
const KARTEN_SCHLUESSEL = 'chartKartenHoehe'
const KARTE_MIN = 60
const kartenHoehe = ref((() => { const v = leseBox(KARTEN_SCHLUESSEL, {}); return v && typeof v === 'object' ? v : {} })())
let eckZug = null
function kartenStil(karte) {
    const h = kartenHoehe.value[karte]
    return h ? { height: h + 'px' } : null
}
function eckStart(e, karte) {
    const karteEl = e.currentTarget.parentElement
    eckZug = {
        karte, x: e.clientX, y: e.clientY, breite: leisteBreite.value,
        hoehe: karte === 'momentum' ? boxHoehe.value : Math.round(karteEl.getBoundingClientRect().height),
        mitBreite: !telefon.value && breitGenug.value,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'nesw-resize'
    document.body.style.userSelect = 'none'
}
function eckZiehen(e) {
    if (!eckZug) return
    const h = Math.round(Math.max(KARTE_MIN, Math.min(1400, eckZug.hoehe + e.clientY - eckZug.y)))
    if (eckZug.karte === 'momentum') boxHoehe.value = Math.max(80, h)
    else kartenHoehe.value = { ...kartenHoehe.value, [eckZug.karte]: h }
    if (eckZug.mitBreite) {
        const max = Math.min(LEISTE_MAX, window.innerWidth * 0.6)
        leisteBreite.value = Math.round(Math.max(LEISTE_MIN, Math.min(max, eckZug.breite + eckZug.x - e.clientX)))
    }
}
function eckEnde() {
    if (!eckZug) return
    const { karte, mitBreite } = eckZug
    eckZug = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (karte === 'momentum') schreibeBox('chartMomentumBoxHoehe', boxHoehe.value)
    else schreibeBox(KARTEN_SCHLUESSEL, kartenHoehe.value)
    if (mitBreite) { try { localStorage.setItem(LEISTE_SCHLUESSEL, String(leisteBreite.value)) } catch { /* kein Speicher */ } }
}
function eckZurueck(karte) {
    if (karte === 'momentum') { boxHoeheZurueck(); return }
    const neu = { ...kartenHoehe.value }
    delete neu[karte]
    kartenHoehe.value = neu
    schreibeBox(KARTEN_SCHLUESSEL, neu)
}

watch(daten, () => {
    if (ignoriereNaechsteAenderung) { ignoriereNaechsteAenderung = false; return }
    clearTimeout(speicherUhr)
    speicherUhr = setTimeout(speichere, 800)
}, { deep: true })

/*
 * Speichern in einer Reihe: zwei gleichzeitige Speicherungen (Takt + Seitenabbau)
 * trügen denselben Stand, und die zweite liefe auf 409 gegen das eigene Fenster.
 */
let speicherKette = Promise.resolve()
function speichere() {
    speicherKette = speicherKette.then(speichereJetzt, speichereJetzt)
    return speicherKette
}
async function speichereJetzt() {
    const id = layoutId.value
    if (!id) return
    const text = JSON.stringify(daten.value)
    if (text === gespeichertText) return
    try {
        const neu = await api.layoutSpeichern(id, { daten: JSON.parse(text), stand: standVon(id) })
        if (layoutId.value === id) gespeichertText = text
        const i = layouts.value.findIndex((l) => l.id === neu.id)
        if (i >= 0) layouts.value[i] = { ...layouts.value[i], geaendertAm: neu.geaendertAm }
    } catch (e) {
        // Ein anderes Fenster hat dieses Layout inzwischen gespeichert: dessen Stand
        // übernehmen und es sagen — still überschreiben verlor dort die Arbeit.
        const aktuell = e.response?.status === 409 ? e.response.data?.aktuell : null
        if (aktuell && layoutId.value === id) {
            waehleLayout(aktuell)
            konfliktHinweis.value = t('chart.layoutKonflikt')
        }
        // sonst: nächste Änderung versucht es erneut
    }
}

/*
 * Das Layout liegt in der Datenbank und gilt für ALLE Geräte. Ein Fenster, das
 * schon offen war (Handy, Tablet, zweiter Tab), zeigte bisher den Stand vom
 * Öffnen — wer am PC einen Schalter umlegte, sah ihn am Tablet nicht und hielt
 * die Einstellung für ungespeichert. Darum: beim Zurückkehren ins Fenster und
 * jede Minute, solange es sichtbar ist, den Stand prüfen und übernehmen — aber
 * nur, wenn hier nichts Ungespeichertes liegt (das gewinnt, und ein Konflikt
 * meldet sich wie bisher beim Speichern).
 */
let abgleichLaeuft = false
async function gleicheLayoutAb() {
    const id = layoutId.value
    if (!id || abgleichLaeuft || document.visibilityState === 'hidden') return
    if (JSON.stringify(daten.value) !== gespeichertText) return
    abgleichLaeuft = true
    try {
        const frisch = (await api.layouts()).find((x) => x.id === id)
        if (!frisch || !(frisch.geaendertAm > (standVon(id) || 0))) return
        // Während des Abrufs geändert oder gewechselt? Dann nichts überschreiben.
        if (layoutId.value !== id || JSON.stringify(daten.value) !== gespeichertText) return
        waehleLayout(frisch)
    } catch { /* nächster Versuch beim nächsten Anlass */ } finally { abgleichLaeuft = false }
}
const sichtbarAbgleich = () => { if (document.visibilityState === 'visible') gleicheLayoutAb() }
let abgleichUhr = null
let positionenUhr = null
function holePositionen() {
    if (document.hidden || incomingPollingActive.value) return
    useFetchOpenPositions().catch(() => { /* Fehler zeigt die Seite Pendente Trades */ })
}

async function layoutWechsel(id) {
    await speichere()
    const l = layouts.value.find((x) => x.id === id)
    if (!l) return
    // Den gespeicherten Stand frisch holen — ein anderes Gerät kann ihn
    // inzwischen geändert haben.
    const frisch = (await api.layouts()).find((x) => x.id === id) || l
    waehleLayout(frisch)
    await api.layoutSpeichern(id, { aktiv: true })
}

async function layoutNeu(name) {
    await speichere()
    const kopie = JSON.parse(JSON.stringify(daten.value))
    const neu = await api.layoutNeu(name, kopie, true)
    layouts.value = [...layouts.value.map((l) => ({ ...l, aktiv: false })), neu]
    waehleLayout(neu)
}

async function layoutUmbenennen(name) {
    const neu = await api.layoutSpeichern(layoutId.value, { name })
    layouts.value = layouts.value.map((l) => (l.id === neu.id ? { ...l, name: neu.name, geaendertAm: neu.geaendertAm } : l))
}

async function layoutLoeschen() {
    const weg = layoutId.value
    await api.layoutLoeschen(weg)
    layouts.value = layouts.value.filter((l) => l.id !== weg)
    if (layouts.value.length) await layoutWechsel(layouts.value[0].id)
}

// ── Panels ──────────────────────────────────────────────────────────────
function setzePanel(patch) {
    const d = daten.value
    const ziele = new Set([aktivIndex.value])
    if (d.sync.symbol && (patch.symbol || patch.markt)) d.panels.forEach((_, i) => ziele.add(i))
    if (d.sync.interval && patch.interval) d.panels.forEach((_, i) => ziele.add(i))
    for (const i of ziele) {
        const p = d.panels[i]
        const eigen = i === aktivIndex.value ? patch : {
            ...(d.sync.symbol && patch.symbol ? { symbol: patch.symbol, markt: patch.markt || p.markt } : {}),
            ...(d.sync.interval && patch.interval ? { interval: patch.interval } : {}),
        }
        Object.assign(p, eigen)
    }
}

function setzeRaster(r) {
    passeAnRaster(daten.value, r)
}

function setzeSync(patch) {
    Object.assign(daten.value.sync, patch)
}

function fokus(i) {
    if (daten.value.aktiv !== i) daten.value.aktiv = i
}

// ── Zeichnen ────────────────────────────────────────────────────────────
// Das Werkzeug gilt nur im aktiven Panel; Magnet und „alles verstecken"
// stehen im Layout, damit sie einen Neustart überleben.
const werkzeug = ref(null)
const aktiveZeichnungen = computed(() => zeichnungenVon(aktivesPanel.value.symbol).value)
const aktiveAuswahl = computed(() => panelRefs.value[aktivIndex.value]?.auswahlId ?? null)

function waehleWerkzeug(typ) {
    werkzeug.value = typ
}

function fehlerSchliessen() {
    fehlerMeldung.value = ''
}

function alleLoeschen() {
    const symbol = aktivesPanel.value.symbol
    const liste = aktiveZeichnungen.value.filter((z) => !z.gesperrt)
    if (!liste.length) return
    if (!window.confirm(t('chart.alleLoeschenFrage', { n: liste.length, symbol }, liste.length))) return
    for (const z of liste) zeichnungLoeschen(symbol, z.id)
}

const aktivesPanelRef = computed(() => panelRefs.value[aktivIndex.value] || null)

// ── Alarme ──────────────────────────────────────────────────────────────
const alarmVorlage = ref(null)
let alarmAbo = null

/** Aktive Preis-Alarme je Panel — als Linien im Chart. */
function alarmLinienFuer(p) {
    return alarme.value.filter((a) => a.aktiv && a.art === 'preis' && a.symbol === p.symbol && a.markt === p.markt)
}

function alarmBeiPreis(preis) {
    const p = aktivesPanel.value
    alarmVorlage.value = { symbol: p.symbol, markt: p.markt, art: 'preis', preis }
}

function alarmAufZeichnung(z) {
    const p = aktivesPanel.value
    const art = z.typ === 'rechteck' || z.typ === 'kanal' ? 'zone' : 'linie'
    alarmVorlage.value = { symbol: p.symbol, markt: p.markt, art, zeichnung: z }
}

function alarmBearbeiten(a) {
    alarmVorlage.value = { ...a }
}

const aktuellerKurs = computed(() => {
    const k = panelRefs.value[aktivIndex.value]?.kerzen
    return k?.length ? k[k.length - 1].c : null
})

function strategieFilter(f) {
    daten.value.panels[aktivIndex.value].strategieFilter = f
}

function objektWaehlen(z) {
    if (z.versteckt) zeichnungAendern(z.symbol, z.id, { versteckt: false })
    panelRefs.value[aktivIndex.value]?.waehleZeichnung(z.id)
}

// ── Indikatoren ─────────────────────────────────────────────────────────
// `dialog` = null | { panel, instanz: null (hinzufügen) | Objekt (einstellen) }
const dialog = ref(null)

function oeffneIndikatoren() {
    dialog.value = { panel: aktivIndex.value, instanz: null }
}

function indikatorHinzu(typ) {
    const p = daten.value.panels[dialog.value.panel]
    p.indikatoren = [...(p.indikatoren || []), neueInstanz(typ)]
    dialog.value = null
}

/** Schnelleinstellungen (IndikatorSchalter): einzelne Parameter einer Instanz des aktiven Charts. */
function vvSchalten(id, patch) {
    const p = aktivesPanel.value
    if (!p) return
    p.indikatoren = (p.indikatoren || []).map((x) => (x.id === id ? { ...x, params: { ...x.params, ...patch } } : x))
}

function indikatorSpeichern(instanz) {
    const p = daten.value.panels[dialog.value.panel]
    p.indikatoren = p.indikatoren.map((x) => (x.id === instanz.id ? instanz : x))
    dialog.value = null
}

/**
 * Vorlage auf den aktiven Chart: ersetzen (wie TradingView) oder dazunehmen.
 * Jede Instanz bekommt eine neue ID — die Vorlage speichert keine, sonst
 * trügen zwei Panels dieselbe. Typen, die dieser Stand nicht kennt (Vorlage
 * von einem neueren Codestand), fallen weg statt ein leeres Fenster zu bauen.
 */
function vorlageAnwenden({ indikatoren, modus }) {
    const p = daten.value.panels[aktivIndex.value]
    if (!p) return
    const neu = (indikatoren || []).filter((x) => INDIKATOREN[x.typ]).map((x) => ({
        ...neueInstanz(x.typ),
        params: saubereParams(x.typ, x.params),
        farben: { ...(x.farben || {}) },
        sichtbar: x.sichtbar !== false,
    }))
    p.indikatoren = modus === 'hinzu' ? [...(p.indikatoren || []), ...neu] : neu
}

function indikatorAktion(i, { aktion, id }) {
    const p = daten.value.panels[i]
    if (aktion === 'volumen') { p.volumen = p.volumen === false; return }
    const inst = (p.indikatoren || []).find((x) => x.id === id)
    if (!inst) return
    if (aktion === 'entfernen') p.indikatoren = p.indikatoren.filter((x) => x.id !== id)
    else if (aktion === 'umschalten') inst.sichtbar = inst.sichtbar === false
    else if (aktion === 'bearbeiten') dialog.value = { panel: i, instanz: inst }
}

// ── Synchronisation ─────────────────────────────────────────────────────
function kreuz(i, info) {
    if (!daten.value.sync.kreuz) return
    panelRefs.value.forEach((p, j) => { if (j !== i) p?.setzeKreuz(info) })
}

let zeitRahmen = 0
function bereich(i) {
    if (!daten.value.sync.zeit || i !== aktivIndex.value || zeitRahmen) return
    zeitRahmen = requestAnimationFrame(() => {
        zeitRahmen = 0
        const r = panelRefs.value[i]?.sichtbarerZeitraum()
        if (!r) return
        panelRefs.value.forEach((p, j) => { if (j !== i) p?.setzeZeitraum(r.von, r.bis) })
    })
}

// ── Watchlists ──────────────────────────────────────────────────────────
const wlSchluessel = (e) => `${e.markt}|${e.symbol}`
/*
 * Mit Stand speichern. Hat ein anderes Fenster die Liste inzwischen geändert (409),
 * wird die EIGENE Änderung — hinzugefügt/entfernt — auf deren Stand neu angewandt,
 * statt sie zu verwerfen oder die fremde zu überschreiben. Die Reihenfolge der
 * fremden Liste bleibt, eigene Neuzugänge kommen ans Ende.
 */
async function watchlistAendern(id, symbole) {
    const alt = watchlists.value.find((w) => w.id === id)
    try {
        const neu = await api.watchlistSpeichern(id, { symbole, stand: alt?.geaendertAm })
        watchlists.value = watchlists.value.map((w) => (w.id === id ? neu : w))
    } catch (e) {
        const aktuell = e.response?.status === 409 ? e.response.data?.aktuell : null
        if (!aktuell || !alt) throw e
        const vorher = new Set(alt.symbole.map(wlSchluessel))
        const nachher = new Set(symbole.map(wlSchluessel))
        const weg = new Set([...vorher].filter((k) => !nachher.has(k)))
        const dazu = symbole.filter((x) => !vorher.has(wlSchluessel(x)))
        const zusammen = [...aktuell.symbole.filter((x) => !weg.has(wlSchluessel(x))), ...dazu]
        const neu = await api.watchlistSpeichern(id, { symbole: zusammen, stand: aktuell.geaendertAm })
        watchlists.value = watchlists.value.map((w) => (w.id === id ? neu : w))
    }
}

async function watchlistNeu(name) {
    const neu = await api.watchlistNeu(name, [])
    watchlists.value = [...watchlists.value, neu]
}

async function watchlistLoeschen(id) {
    await api.watchlistLoeschen(id)
    watchlists.value = watchlists.value.filter((w) => w.id !== id)
}

// ── Sonstiges ───────────────────────────────────────────────────────────
function foto() {
    const leinwand = panelRefs.value[aktivIndex.value]?.bildschirmfoto()
    if (!leinwand) return
    leinwand.toBlob((blob) => {
        if (!blob) return
        const p = aktivesPanel.value
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${p.symbol}_${p.interval}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    })
}

/*
 * Tippen öffnet die Symbolsuche — wie bei TradingView. Nur wenn kein
 * Eingabefeld den Fokus hat, sonst frässe die Suche jede Notiz auf.
 */
function taste(e) {
    const ziel = e.target
    if (ziel && (ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName))) return
    // Auch hinter dem Alarm-Dialog: Entf löschte sonst die Linie, auf die gerade ein Alarm entsteht.
    if (dialog.value || alarmVorlage.value) return
    const panel = panelRefs.value[aktivIndex.value]
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); macheRueckgaengig() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); macheWiederholen() }
        return
    }
    if (e.key === 'Escape' && mobilReiter.value) { mobilReiter.value = null; return }
    if (e.key === 'Escape' && schublade.value) { schublade.value = null; return }
    if (e.key === 'Escape' && vollbild.value) { schalteVollbild(); return }
    if (e.altKey) return
    if (e.key === 'Escape') {
        if (panel?.abbrechen()) return
        werkzeug.value = null
        return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (panel?.loescheAuswahl()) e.preventDefault()
        return
    }
    if (/^[a-z0-9]$/i.test(e.key)) kopf.value?.oeffneSuche()
}

/*
 * Höhe der Seite: genau das, was unter dem Kopf bleibt. Eine feste Abzugszahl
 * (früher 100dvh − 130px) stimmte nie ganz — Kopf und Moduszeile sind 147 px
 * hoch, auf schmalen Fenstern bricht die Kopfleiste um — und die Seite liess
 * sich 30 px scrollen. Gemessen wird die Lage der Seite und der Rand darunter.
 */
const seite = ref(null)
let randUnten = 13          // Polster des Layouts unter der Seite (gemessen: 13 px)
let hoehenWaechter = null
/*
 * Chart-Höhe von Hand: Eckgriff ganz aussen unten rechts (Ecke der Seitenleiste,
 * ohne Leiste die des Charts). Senkrecht = Höhe, waagrecht = Breite der Seitenleiste. Gemerkt
 * im Browser; Doppelklick = wieder ans Fenster angepasst. Am Telefon zählt die
 * Höhe des Chart-Rasters, sonst die der ganzen Seite (Leiste wächst mit).
 */
const HOEHE_SCHLUESSEL = 'chartHoehe'
const HOEHE_MIN = 300
const chartHoehe = ref((() => {
    try { const v = Number(localStorage.getItem(HOEHE_SCHLUESSEL)); return v >= HOEHE_MIN ? v : null } catch { return null }
})())
let hoehenZug = null
function hoeheStart(e) {
    const ziel = telefon.value || window.innerWidth <= 991 ? e.currentTarget.parentElement?.querySelector('.raster') : seite.value
    hoehenZug = {
        x: e.clientX, y: e.clientY, breite: leisteBreite.value,
        hoehe: Math.round(ziel?.getBoundingClientRect().height || 600),
        mitBreite: daten.value.seitenleiste.offen && !istSchmal.value && !telefon.value && breitGenug.value,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
}
function hoeheZiehen(e) {
    if (!hoehenZug) return
    chartHoehe.value = Math.round(Math.max(HOEHE_MIN, Math.min(3000, hoehenZug.hoehe + e.clientY - hoehenZug.y)))
    if (hoehenZug.mitBreite) {
        // Ecke nach rechts = Chart breiter = Leiste schmaler
        const max = Math.min(LEISTE_MAX, window.innerWidth * 0.6)
        leisteBreite.value = Math.round(Math.max(LEISTE_MIN, Math.min(max, hoehenZug.breite - (e.clientX - hoehenZug.x))))
    }
    passeHoehe()
}
function hoeheEnde() {
    if (!hoehenZug) return
    const { mitBreite } = hoehenZug
    hoehenZug = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { localStorage.setItem(HOEHE_SCHLUESSEL, String(chartHoehe.value || '')) } catch { /* nur Komfort */ }
    if (mitBreite) { try { localStorage.setItem(LEISTE_SCHLUESSEL, String(leisteBreite.value)) } catch { /* kein Speicher */ } }
}
function hoeheZurueck() {
    chartHoehe.value = null
    try { localStorage.removeItem(HOEHE_SCHLUESSEL) } catch { /* nur Komfort */ }
    nextTick(passeHoehe)
}
const rasterStil = computed(() =>
    chartHoehe.value && (telefon.value || breiteFenster.value <= 991) && !vollbild.value ? { height: chartHoehe.value + 'px' } : null)
const breiteFenster = ref(window.innerWidth)

function passeHoehe() {
    const el = seite.value
    if (!el) return
    breiteFenster.value = window.innerWidth
    // Telefon und schmale Fenster: Chart und Leiste untereinander, die Seite darf scrollen.
    if (telefon.value || window.innerWidth <= 991) { el.style.height = ''; return }
    if (chartHoehe.value) { el.style.height = chartHoehe.value + 'px'; return }
    const r = el.getBoundingClientRect()
    const oben = r.top + window.scrollY
    // Den Rand nur messen, solange die Seite überläuft — passt sie, enthielte die
    // Messung den leeren Platz darunter, und die Seite schrumpfte bei jedem Aufruf.
    const sh = document.scrollingElement.scrollHeight
    if (sh > window.innerHeight + 1) randUnten = Math.max(0, Math.min(60, sh - (r.bottom + window.scrollY)))
    el.style.height = Math.max(460, Math.floor(window.innerHeight - oben - randUnten)) + 'px'
}
watch(telefon, () => nextTick(passeHoehe))

onMounted(() => {
    lade()
    nextTick(passeHoehe)
    window.addEventListener('resize', passeHoehe)
    // Nicht jede Grössenänderung schickt ein resize-Ereignis (Zoom, Geräte-Emulation,
    // ein- und ausgeklapptes Seitenmenü) — die Grösse des Dokuments selbst schon.
    hoehenWaechter = new ResizeObserver(() => passeHoehe())
    hoehenWaechter.observe(document.documentElement)
    window.addEventListener('keydown', taste)
    document.addEventListener('fullscreenchange', vollbildVerlassen)
    document.addEventListener('visibilitychange', sichtbarAbgleich)
    window.addEventListener('focus', gleicheLayoutAb)
    abgleichUhr = setInterval(gleicheLayoutAb, 60_000)
    // Offene Positionen: solange der Chart offen ist, alle 15 s bei der Börse
    // nachfragen (das globale Polling tut es nur alle 60 s). Läuft schon ein
    // Abruf (Pendente Trades, globales Polling), wird dieser Takt übersprungen.
    holePositionen()
    positionenUhr = setInterval(holePositionen, 15_000)
    alarmAbo = abonniereAlarme()
})
onBeforeUnmount(() => {
    window.removeEventListener('resize', passeHoehe)
    hoehenWaechter?.disconnect()
    window.removeEventListener('keydown', taste)
    document.removeEventListener('fullscreenchange', vollbildVerlassen)
    document.removeEventListener('visibilitychange', sichtbarAbgleich)
    window.removeEventListener('focus', gleicheLayoutAb)
    clearInterval(abgleichUhr)
    clearInterval(positionenUhr)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    alarmAbo?.()
    clearTimeout(speicherUhr)
    cancelAnimationFrame(zeitRahmen)
    speichere()
})

watch(sichtbareAnzahl, async () => {
    await nextTick()
    panelRefs.value = panelRefs.value.slice(0, sichtbareAnzahl.value)
})
</script>

<template>
    <div ref="seite" class="chartSeite" :class="{ telefon, vollbild }">
        <Hinweis v-if="ladeFehler" art="warn" class="seitenHinweis">{{ t('chart.arbeitsplatzFehler') }}: {{ ladeFehler }}</Hinweis>
        <Hinweis v-if="konfliktHinweis" art="info" schliessbar class="seitenHinweis knapp" @zu="konfliktHinweis = ''">
            {{ konfliktHinweis }}
        </Hinweis>
        <Hinweis v-if="quellenHinweis" art="info" schliessbar class="seitenHinweis knapp" @zu="quellenHinweis = ''">
            {{ quellenHinweis }}
        </Hinweis>

        <template v-if="bereit">
            <ChartKopfleiste ref="kopf" :panel="aktivesPanel" :raster="daten.raster" :sync="daten.sync" :layouts="layouts"
                :layout-id="layoutId" :seitenleiste-offen="daten.seitenleiste.offen" :telefon="telefon"
                @panel="setzePanel" @indikatoren="oeffneIndikatoren" @vorlage="vorlageAnwenden" @raster="setzeRaster" @sync="setzeSync" @layout-wechsel="layoutWechsel"
                @layout-neu="layoutNeu" @layout-umbenennen="layoutUmbenennen" @layout-loeschen="layoutLoeschen"
                @seitenleiste="daten.seitenleiste.offen = !daten.seitenleiste.offen" @foto="foto" />

            <div v-if="!vollbild" class="coinTabs" role="tablist" :aria-label="t('chart.coinTabs.titel')">
                <div v-for="(tab, i) in coinTabs" :key="tab.symbol + '|' + tab.markt" class="coinTab" :class="{ an: i === coinTabAktiv }"
                    role="tab" :aria-selected="i === coinTabAktiv" tabindex="0"
                    @click="waehleCoinTab(i)" @keydown.enter="waehleCoinTab(i)" @auxclick.middle.prevent="schliesseCoinTab(i)">
                    <span class="coinTabName">{{ tabName(tab) }}</span>
                    <button v-if="coinTabs.length > 1" type="button" class="coinTabZu" :title="t('chart.coinTabs.schliessen')"
                        :aria-label="t('chart.coinTabs.schliessen')" @click.stop="schliesseCoinTab(i)"><Symbol name="schliessen" /></button>
                </div>
                <button v-if="coinTabs.length < COIN_TABS_MAX" type="button" class="coinTabNeu" :title="t('chart.coinTabs.neu')"
                    :aria-label="t('chart.coinTabs.neu')" @click="neuerCoinTab"><Symbol name="plus" /></button>
            </div>

            <div v-for="n in neueAusloesungen" :key="n.id + '-' + n.t" class="leistenMeldung alarmBanner"
                @click="quittiere(n.id)">
                <Symbol name="glocke" /> {{ n.text }} <small>({{ t('chart.alarm.quittieren') }})</small></div>
            <div v-if="fehlerMeldung" class="leistenMeldung" @click="fehlerSchliessen">
                {{ t('chart.zeichnungFehler') }}: {{ fehlerMeldung }}</div>

            <div class="arbeitsflaeche" :class="{ mitLeiste: daten.seitenleiste.offen }"
                :style="{ '--leisteBreite': (istSchmal ? LEISTE_SCHMAL : leisteBreite) + 'px' }"
                @touchstart.capture.passive="wischStart" @touchmove.capture.passive="wischZug" @touchend.capture.passive="wischEnde">
                <template v-if="vollbild">
                    <Transition name="schubHg">
                        <div v-if="schublade" class="schubladeHg" @click="schublade = null"></div>
                    </Transition>
                    <Transition name="schubLinks">
                        <aside v-if="schublade === 'links'" class="schublade links" :aria-label="t('chart.indBox.titel')">
                            <IndikatorSchalter :panel="aktivesPanel" @aendere="vvSchalten"
                                @umschalten="(id) => indikatorAktion(aktivIndex, { aktion: 'umschalten', id })"
                                @volumen="indikatorAktion(aktivIndex, { aktion: 'volumen' })" />
                            <div class="schubAktionen">
                                <button type="button" class="schubKnopf" @click="schublade = null; oeffneIndikatoren()">
                                    <Symbol name="plus" /> {{ t('chart.indikatorenTitel') }}</button>
                                <VorlagenMenue :aktuelle="aktivesPanel.indikatoren || []" @anwenden="vorlageAnwenden" />
                            </div>
                            <div class="schubGruppe">
                                <div class="schubTitel">{{ t('chart.schublade.imChart') }}</div>
                                <div class="schubChips">
                                    <button v-for="o in OVERLAYS" :key="o.id" type="button" class="schubChip"
                                        :class="{ an: overlayAn(aktivesPanel, o.id) }" :aria-pressed="overlayAn(aktivesPanel, o.id)"
                                        @click="aktivesPanel.overlays = { ...(aktivesPanel.overlays || {}), [o.id]: !overlayAn(aktivesPanel, o.id) }">
                                        {{ t('chart.overlay.' + o.id) }}</button>
                                </div>
                            </div>
                        </aside>
                    </Transition>
                    <Transition name="schubRechts">
                        <aside v-if="schublade === 'rechts'" class="schublade rechts" :aria-label="t('chart.mbox.titel')">
                            <div class="reiterTitel">{{ t('chart.mbox.titel') }}</div>
                            <MomentumBox :symbol="aktivesPanel.symbol" :interval="aktivesPanel.interval" :markt="aktivesPanel.markt" />
                        </aside>
                    </Transition>
                </template>
                <div v-if="telefon" class="reiter mobilReiter">
                    <button v-for="r in REITER" :key="r.id" :class="{ an: mobilReiter === r.id }" :aria-pressed="mobilReiter === r.id"
                        :title="t('chart.reiter.' + r.id)" :aria-label="t('chart.reiter.' + r.id)" @click="schalteMobilReiter(r.id)">
                        <Symbol :name="r.icon" />
                    </button>
                </div>
                <div v-if="telefon && vollbild" class="tfLeiste" role="group" :aria-label="t('chart.tfFavoriten')">
                    <button v-for="i in tfFavoriten" :key="i" type="button" :class="{ an: aktivesPanel.interval === i }"
                        :disabled="tfGesperrt.has(i)" @click="setzePanel({ interval: i })">{{ i }}</button>
                </div>
                <Zeichenleiste v-if="!telefon" class="werkzeuge" :symbol="aktivesPanel.symbol" :markt="aktivesPanel.markt" :werkzeug="werkzeug" :magnet="!!daten.zeichnen?.magnet"
                    :versteckt="!!daten.zeichnen?.versteckt" @werkzeug="waehleWerkzeug"
                    @magnet="daten.zeichnen = { ...(daten.zeichnen || {}), magnet: !daten.zeichnen?.magnet }"
                    @versteckt="daten.zeichnen = { ...(daten.zeichnen || {}), versteckt: !daten.zeichnen?.versteckt }"
                    @alle-loeschen="alleLoeschen" />
                <div class="raster" :class="rasterKlasse" :style="rasterStil">
                    <ChartPanel v-for="(p, i) in sichtbarePanels" :key="layoutId + '-' + i"
                        :ref="(el) => { if (el) panelRefs[i] = el }" :panel="p" :nummer="i"
                        :class="{ ausgeblendet: vollbild && i !== aktivIndex }" @vollbild="schalteVollbild(i)"
                        :seite-scrollt="telefon && !vollbild" :zeit-mit-einpassen="telefon"
                        :aktiv="sichtbareAnzahl > 1 && i === aktivIndex" @fokus="fokus(i)" @kreuz="kreuz(i, $event)"
                        @bereich="bereich(i)" @indikator="indikatorAktion(i, $event)"
                        :werkzeug="i === aktivIndex ? werkzeug : null" :magnet="!!daten.zeichnen?.magnet"
                        :zeichnungen-versteckt="!!daten.zeichnen?.versteckt" @werkzeug-fertig="werkzeug = null"
                        :alarm-linien="alarmLinienFuer(p)" @alarm-bei-preis="(x) => { fokus(i); alarmBeiPreis(x) }"
                        @alarm-auf-zeichnung="(z) => { fokus(i); alarmAufZeichnung(z) }"
                        @alle-loeschen="() => { fokus(i); alleLoeschen() }"
                        @panel="(patch) => Object.assign(daten.panels[i], patch)" />
                </div>

                <!-- Eingeklappt: nur der Streifen mit Aufklappen und den Reiter-Symbolen. -->
                <aside v-if="daten.seitenleiste.offen && istSchmal" class="seitenleiste schmal">
                    <button class="schmalKnopf" :title="t('chart.leisteAusklappen')" :aria-label="t('chart.leisteAusklappen')"
                        @click="schalteLeisteSchmal(false)">
                        <Symbol name="doppelLinks" />
                    </button>
                    <button v-for="r in REITER" :key="r.id" class="schmalKnopf" :class="{ an: daten.seitenleiste.reiter === r.id }"
                        :title="t('chart.reiter.' + r.id)" :aria-label="t('chart.reiter.' + r.id)" @click="oeffneReiter(r.id)">
                        <Symbol :name="r.icon" />
                    </button>
                </aside>
                <aside v-else-if="daten.seitenleiste.offen || telefon" class="seitenleiste">
                    <div class="leisteGriff" :title="t('chart.leisteBreite')" @pointerdown.prevent="leisteZiehenStart"
                        @pointermove="leisteZiehen" @pointerup="leisteZiehenEnde" @pointercancel="leisteZiehenEnde"
                        @dblclick="leisteZuruecksetzen"></div>
                    <div v-if="REITER.length > 1 && !telefon" class="reiter">
                        <button v-if="!telefon && breitGenug" class="einklappen" :title="t('chart.leisteEinklappen')"
                            :aria-label="t('chart.leisteEinklappen')" @click="schalteLeisteSchmal(true)">
                            <Symbol name="doppelRechts" />
                        </button>
                        <button v-for="r in REITER" :key="r.id" :class="{ an: daten.seitenleiste.reiter === r.id }"
                            :title="t('chart.reiter.' + r.id)" @click="daten.seitenleiste.reiter = r.id" :aria-label="t('chart.reiter.' + r.id)">
                            <Symbol :name="r.icon" />
                        </button>
                    </div>
                    <div v-show="!telefon || mobilReiter" class="karte reiterKarte" :class="{ fest: kartenHoehe.reiter && !telefon, mobilOverlay: telefon }"
                        :style="telefon ? null : kartenStil('reiter')">
                    <div class="reiterInhalt">
                    <div class="reiterTitel">{{ t('chart.reiter.' + daten.seitenleiste.reiter) }}</div>
                    <WatchlistReiter v-if="daten.seitenleiste.reiter === 'watchlist'" :watchlists="watchlists"
                        :aktives-symbol="aktivesPanel.symbol" :aktiver-markt="aktivesPanel.markt"
                        @waehle="setzePanel({ symbol: $event.symbol, markt: $event.markt }); mobilReiter = null"
                        @neuer-tab="(s) => coinInNeuemTab(s.symbol, s.markt)" @aendere="watchlistAendern"
                        @neu="watchlistNeu" @loesche="watchlistLoeschen" />
                    <OffeneReiter v-else-if="daten.seitenleiste.reiter === 'offen'" :panel="aktivesPanel"
                        @waehle="(s) => { setzePanel({ symbol: s, markt: 'futures' }); mobilReiter = null }"
                        @neuer-tab="(s) => coinInNeuemTab(s, 'futures')"
                        @overlay="(an) => { aktivesPanel.overlays = { ...(aktivesPanel.overlays || {}), positionen: an } }" />
                    <ObjektReiter v-else-if="daten.seitenleiste.reiter === 'objekte'" :symbol="aktivesPanel.symbol"
                        :zeichnungen="aktiveZeichnungen" :auswahl-id="aktiveAuswahl" @waehle="objektWaehlen"
                        @aendere="(z, patch) => zeichnungAendern(z.symbol, z.id, patch)"
                        @loesche="(z) => zeichnungLoeschen(z.symbol, z.id)" />
                    <StrategieReiter v-else-if="daten.seitenleiste.reiter === 'strategien'" :panel="aktivesPanel"
                        :daten="aktivesPanelRef?.strategieDaten" :vorschau="aktivesPanelRef?.strategieVorschau"
                        :backtest="aktivesPanelRef?.strategieBacktest" @filter="strategieFilter"
                        @vorschau="(v) => aktivesPanelRef?.setzeStrategieVorschau(v)"
                        @backtest="(b) => aktivesPanelRef?.setzeBacktest(b)" />
                    <AlarmReiter v-else-if="daten.seitenleiste.reiter === 'alarme'" :symbol="aktivesPanel.symbol"
                        :markt="aktivesPanel.markt" :kurs="aktuellerKurs" @neu="alarmBeiPreis" @bearbeite="alarmBearbeiten" />
                    <KiReiter v-else-if="daten.seitenleiste.reiter === 'ki'" :panel="aktivesPanel"
                        :sichtbar-bis="() => aktivesPanelRef?.sichtbarerZeitraum()?.bis"
                        @vorschau="(a) => aktivesPanelRef?.setzeKiVorschau(a)" />
                    </div>
                        <span class="eckGriff" :title="t('chart.eckGriff')" role="separator" :aria-label="t('chart.eckGriff')"
                            @pointerdown.prevent.stop="eckStart($event, 'reiter')" @pointermove="eckZiehen" @pointerup="eckEnde"
                            @pointercancel="eckEnde" @dblclick.stop="eckZurueck('reiter')"></span>
                    </div>
                    <div v-if="!telefon" class="karte vvKarte" :class="{ fest: kartenHoehe.indikatoren }" :style="kartenStil('indikatoren')">
                        <IndikatorSchalter class="vvSchalter" :panel="aktivesPanel" @aendere="vvSchalten"
                            @umschalten="(id) => indikatorAktion(aktivIndex, { aktion: 'umschalten', id })"
                            @volumen="indikatorAktion(aktivIndex, { aktion: 'volumen' })" />
                        <span class="eckGriff" :title="t('chart.eckGriff')" role="separator" :aria-label="t('chart.eckGriff')"
                            @pointerdown.prevent.stop="eckStart($event, 'indikatoren')" @pointermove="eckZiehen" @pointerup="eckEnde"
                            @pointercancel="eckEnde" @dblclick.stop="eckZurueck('indikatoren')"></span>
                    </div>
                    <!-- Momentum-Box  unter dem Reiter: Trenner ziehen = Höhe, Pfeil = ein-/ausklappen. -->
                    <div class="boxTrenner" :class="{ zu: !boxOffen }" @pointerdown="boxZiehenStart" @pointermove="boxZiehen"
                        @pointerup="boxZiehenEnde" @pointercancel="boxZiehenEnde" @dblclick="boxHoeheZurueck"
                        :title="t('chart.mbox.trenner')">
                        <!-- Titel klappt ein/aus wie bei der VWAP-Vector-Box; ziehen geht über den Rest der Leiste. -->
                        <span class="boxTitel" role="button" tabindex="0" :aria-expanded="boxOffen" :title="t(boxOffen ? 'chart.mbox.zu' : 'chart.mbox.auf')"
                            @pointerdown.stop @dblclick.stop @click.stop="schalteBox" @keydown.enter.prevent="schalteBox">{{ t('chart.mbox.titel') }}</span>
                        <button @pointerdown.stop @click.stop="schalteBox" :title="t(boxOffen ? 'chart.mbox.zu' : 'chart.mbox.auf')" :aria-label="t(boxOffen ? 'chart.mbox.zu' : 'chart.mbox.auf')">
                            <Symbol :name="boxOffen ? 'runter' : 'hoch'" /></button>
                    </div>
                    <div v-if="boxOffen" class="karte boxKarte">
                        <div class="boxBereich" :style="{ height: boxHoehe + 'px' }">
                            <MomentumBox :symbol="aktivesPanel.symbol" :interval="aktivesPanel.interval" :markt="aktivesPanel.markt" />
                        </div>
                        <span class="eckGriff" :title="t('chart.eckGriff')" role="separator" :aria-label="t('chart.eckGriff')"
                            @pointerdown.prevent.stop="eckStart($event, 'momentum')" @pointermove="eckZiehen" @pointerup="eckEnde"
                            @pointercancel="eckEnde" @dblclick.stop="eckZurueck('momentum')"></span>
                    </div>
                    <!-- Lizenzhinweis der Chart-Bibliothek (Apache-2.0, NOTICE). Zusätzlich zum
                         TradingView-Logo im Chart (`attributionLogo: true` in ChartPanel). -->
                    <a class="lizenz" href="https://www.tradingview.com/" target="_blank" rel="noopener">
                        Charts: TradingView Lightweight Charts™ · © TradingView, Inc.</a>
                </aside>
                <span v-if="!vollbild" class="hoehenGriff" role="separator" :title="t('chart.hoehenGriff')" :aria-label="t('chart.hoehenGriff')"
                    @pointerdown.prevent.stop="hoeheStart" @pointermove="hoeheZiehen" @pointerup="hoeheEnde"
                    @pointercancel="hoeheEnde" @dblclick.stop="hoeheZurueck"></span>

            </div>
        </template>
        <AlarmDialog v-if="alarmVorlage" :vorlage="alarmVorlage" @schliesse="alarmVorlage = null" />
        <IndikatorDialog v-if="dialog" :key="dialog.instanz?.id || 'neu'" :instanz="dialog.instanz"
            :aktive="daten.panels[dialog.panel]?.indikatoren || []" @hinzu="indikatorHinzu" @speichere="indikatorSpeichern"
            @bearbeite="(id) => indikatorAktion(dialog.panel, { aktion: 'bearbeiten', id })"
            @entferne="(id) => indikatorAktion(dialog.panel, { aktion: 'entfernen', id })"
            @umschalten="(id) => indikatorAktion(dialog.panel, { aktion: 'umschalten', id })"
            @schliesse="dialog = null" />
        <div v-else-if="!ladeFehler && !bereit" class="laden"><Kreisel /></div>
    </div>
</template>

<style scoped>
.chartSeite {
    display: flex;
    flex-direction: column;
    /* Vorläufig — passeHoehe() setzt die gemessene Höhe. */
    height: calc(100dvh - 160px);
    min-height: 460px;
}

.arbeitsflaeche {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px;
}

.arbeitsflaeche.mitLeiste {
    grid-template-columns: auto 1fr var(--leisteBreite, 260px);
}

.raster {
    display: grid;
    gap: 6px;
    min-height: 0;
    min-width: 0;
    position: relative;
}

/* Eckgriff ganz aussen unten rechts am Arbeitsplatz: Höhe + Leistenbreite. */
.hoehenGriff {
    position: absolute;
    right: -7px;
    bottom: -7px;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    z-index: 7;
    touch-action: none;
    opacity: 0.55;
    background:
        linear-gradient(315deg, transparent 0 30%, var(--line-stark) 30% 38%, transparent 38% 50%, var(--line-stark) 50% 58%, transparent 58%);
    transition: opacity 0.15s;
}

.hoehenGriff:hover {
    opacity: 1;
    background:
        linear-gradient(315deg, transparent 0 30%, var(--accent) 30% 38%, transparent 38% 50%, var(--accent) 50% 58%, transparent 58%);
}

.raster.r1 {
    grid-template: 1fr / 1fr;
}

.raster.r2h {
    grid-template: 1fr / 1fr 1fr;
}

.raster.r2v {
    grid-template: 1fr 1fr / 1fr;
}

.raster.r4 {
    grid-template: 1fr 1fr / 1fr 1fr;
}

.seitenleiste {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    padding: 8px;
    background: var(--panel);
    position: relative;
    min-width: 0;
}

/* Griff zum Ziehen der Breite, über dem linken Rand. */
.leisteGriff {
    position: absolute;
    left: -6px;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: col-resize;
    z-index: 5;
    touch-action: none;
}

.leisteGriff::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 50%;
    width: 2px;
    height: 36px;
    transform: translateY(-50%);
    border-radius: 2px;
    background: var(--line-stark);
    transition: background 0.15s, height 0.15s;
}

.leisteGriff:hover::after {
    background: var(--accent);
    height: 64px;
}

.reiter {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 6px;
}

.reiter button {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 4px;
    border-radius: var(--radius-klein);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    cursor: pointer;
}

.reiter button:hover {
    color: var(--text);
}

/* Einklapp-Knopf: schmaler als die Reiter, durch eine Linie abgesetzt. */
.reiter button.einklappen {
    flex: 0 0 auto;
    padding: 4px 6px;
    margin-right: 4px;
    border-right: 1px solid var(--line);
    border-radius: 0;
}

/* Eingeklappte Leiste: Symbole untereinander wie im Seitenmenü links. */
.seitenleiste.schmal {
    align-items: center;
    padding: 8px 4px;
    gap: 4px;
}

.schmalKnopf {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-klein);
    color: var(--muted);
    cursor: pointer;
}

.schmalKnopf:first-child {
    margin-bottom: 6px;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
}

.schmalKnopf:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.schmalKnopf.an {
    color: var(--accent);
}

.reiter button.an {
    color: var(--accent);
    background: var(--accent-flaeche);
}

.lizenz {
    margin-top: auto;
    font-size: 9px;
    color: var(--muted);
    opacity: 0.6;
    text-decoration: none;
}

.lizenz:hover {
    opacity: 1;
}

.karte {
    position: relative;
    min-height: 0;
}

.reiterKarte {
    flex: 1;
    min-height: 60px;
    display: flex;
    flex-direction: column;
}

.reiterKarte.fest {
    flex: 0 0 auto;
}

.vvKarte {
    flex-shrink: 0;
}

.vvKarte.fest > .vvSchalter {
    height: 100%;
    overflow-y: auto;
}

.boxKarte {
    flex-shrink: 0;
}

/* Eckgriff unten links: kleines Dreieck aus zwei Linien, erst beim Darüberfahren deutlich. */
.eckGriff {
    position: absolute;
    left: -2px;
    bottom: -2px;
    width: 14px;
    height: 14px;
    cursor: nesw-resize;
    z-index: 4;
    touch-action: none;
    opacity: 0.45;
    background:
        linear-gradient(225deg, transparent 0 55%, var(--line-stark) 55% 63%, transparent 63% 75%, var(--line-stark) 75% 83%, transparent 83%);
    transition: opacity 0.15s;
}

.karte:hover > .eckGriff {
    opacity: 0.8;
}

.eckGriff:hover {
    opacity: 1;
    background:
        linear-gradient(225deg, transparent 0 55%, var(--accent) 55% 63%, transparent 63% 75%, var(--accent) 75% 83%, transparent 83%);
}

.reiterInhalt {
    flex: 1;
    min-height: 60px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
}

.boxTrenner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 2px;
    border-top: 1px solid var(--line-stark);
    cursor: row-resize;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    touch-action: none;
    flex-shrink: 0;
}

.boxTrenner.zu {
    cursor: default;
}

.boxTrenner:hover:not(.zu) {
    border-top-color: var(--accent);
}

.boxTrenner button {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 0 4px;
    cursor: pointer;
}

.boxTitel {
    cursor: pointer;
}

.boxTitel:hover {
    color: var(--text);
}

.boxTrenner button {
    display: inline-flex;
    align-items: center;
    font-size: 16px;
}

.vvSchalter {
    flex-shrink: 0;
    margin: 0 8px;
}

.boxBereich {
    flex-shrink: 0;
    overflow-y: auto;
    min-height: 0;
}

.reiterTitel {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
}

.seitenHinweis {
    margin: var(--abstand-2);
}

.seitenHinweis.knapp {
    padding: var(--abstand-1) var(--abstand-2);
    align-items: center;
}

/* Alarm- und Zeichenfehler: schmale Zeile über der Arbeitsfläche, Klick quittiert. */
.leistenMeldung {
    display: flex;
    align-items: center;
    gap: var(--abstand-1);
    margin: var(--abstand-1) 0;
    padding: var(--abstand-1) var(--abstand-2);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
    border-radius: var(--radius-klein);
    background: var(--warn-flaeche);
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
}

.leistenMeldung > :first-child {
    color: var(--warn);
}

.laden {
    display: flex;
    justify-content: center;
    padding: 40px;
}

/* Coin-Tabs unter der Kopfleiste */
.coinTabs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0 6px;
    overflow-x: auto;
    scrollbar-width: thin;
}

.coinTab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px 3px 10px;
    border: 1px solid var(--line);
    border-radius: 8px 8px 0 0;
    border-bottom-color: transparent;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}

.coinTab:hover {
    color: var(--text);
}

.coinTab.an {
    color: var(--text);
    background: var(--panel);
    border-color: var(--accent-rand);
    border-bottom-color: var(--accent);
}

.coinTabZu {
    display: inline-flex;
    background: transparent;
    border: none;
    padding: 1px;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
    opacity: 0.6;
}

.coinTabZu:hover {
    opacity: 1;
    color: var(--text);
}

.coinTabNeu {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    background: transparent;
    border: 1px dashed var(--line);
    border-radius: 8px;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
}

.coinTabNeu:hover {
    color: var(--accent);
    border-color: var(--accent-rand);
}

/* Handy-Vollbild: Zeiteinheiten-Favoriten, bewusst leise */
.tfLeiste {
    display: flex;
    gap: 2px;
    justify-content: center;
    padding: 0 4px;
}

.tfLeiste button {
    flex: 0 1 auto;
    min-width: 38px;
    padding: 3px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
}

.tfLeiste button.an {
    color: var(--accent);
    background: var(--accent-flaeche);
}

.tfLeiste button:disabled {
    opacity: 0.35;
}

/* Linke Schublade: Aktionen und Einblenden eigener Daten unter den Indikatoren */
.schubAktionen {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

.schubKnopf {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel-soft);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
}

.schubGruppe {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-soft);
}

.schubTitel {
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
}

.schubChips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.schubChip {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
}

.schubChip.an {
    color: var(--text);
    border-color: var(--accent-rand);
    background: var(--accent-flaeche);
}

/* Schubladen im Vollbild (Wischen vom Rand) */
.schubladeHg {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.45);
}

.schublade {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 21;
    width: min(88vw, 380px);
    overflow-y: auto;
    padding: 10px;
    padding-top: max(10px, env(safe-area-inset-top));
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    background: var(--panel);
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.schublade.links {
    left: 0;
    border-right: 1px solid var(--line);
}

.schublade.rechts {
    right: 0;
    border-left: 1px solid var(--line);
}

.schubLinks-enter-active, .schubLinks-leave-active,
.schubRechts-enter-active, .schubRechts-leave-active {
    transition: transform 0.2s ease;
}

.schubLinks-enter-from, .schubLinks-leave-to {
    transform: translateX(-100%);
}

.schubRechts-enter-from, .schubRechts-leave-to {
    transform: translateX(100%);
}

.schubHg-enter-active, .schubHg-leave-active {
    transition: opacity 0.2s;
}

.schubHg-enter-from, .schubHg-leave-to {
    opacity: 0;
}

/* Vollbild: das Panel deckt den ganzen Bildschirm, alles andere tritt zurück. */
.chartSeite.vollbild .arbeitsflaeche {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: block;
    padding: 4px;
    background: var(--bg);
}

.chartSeite.vollbild .werkzeuge,
.chartSeite.vollbild .seitenleiste {
    display: none;
}

.chartSeite.vollbild .raster {
    height: 100%;
    min-height: 0;
}

.raster .ausgeblendet {
    display: none;
}

.chartSeite.telefon.vollbild .raster {
    flex: 1;
    height: auto;
    min-height: 0;
}

/* Telefon: ein Panel, Seitenleiste unter dem Chart statt daneben. Keine
   Zeichenleiste — mit dem Finger zeichnet niemand genau, und sie frass die Breite. */
.chartSeite.telefon .arbeitsflaeche,
.chartSeite.telefon .arbeitsflaeche.mitLeiste {
    grid-template-columns: 1fr;
}

.chartSeite.telefon {
    height: auto;
}


.chartSeite.telefon .seitenleiste {
    grid-column: 1 / -1;
    /* static: der Reiter-Inhalt legt sich über den Chart, nicht über die Leiste */
    position: static;
}

.chartSeite.telefon:not(.vollbild) .arbeitsflaeche {
    position: relative;
}

.mobilReiter {
    grid-column: 1 / -1;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel);
}

.mobilReiter button {
    padding: 7px 4px;
}

.reiterKarte.mobilOverlay {
    position: absolute;
    left: 0;
    right: 0;
    top: 46px;
    z-index: 15;
    max-height: min(72%, 560px);
    padding: 10px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
}

.reiterKarte.mobilOverlay > .eckGriff {
    display: none;
}

/* Handy im Vollbild: Leiste oben, Chart darunter, vom Rest der Seitenleiste nur der Reiter-Inhalt. */
.chartSeite.telefon.vollbild .arbeitsflaeche {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.chartSeite.telefon.vollbild .seitenleiste {
    display: contents;
}

.chartSeite.telefon.vollbild .seitenleiste > :not(.reiterKarte) {
    display: none;
}

.chartSeite.telefon .raster {
    height: 62dvh;
    min-height: 340px;
}

.chartSeite.telefon .seitenleiste {
    max-height: 50dvh;
}

.chartSeite.telefon .leisteGriff {
    display: none;
}

@media (max-width: 991px) {
    .arbeitsflaeche,
    .arbeitsflaeche.mitLeiste {
        grid-template-columns: auto 1fr;
    }

    .seitenleiste {
        grid-column: 1 / -1;
    }

    .leisteGriff {
        display: none;
    }

    .chartSeite {
        height: auto;
    }

    .raster {
        height: 62dvh;
        min-height: 340px;
    }
}
</style>
