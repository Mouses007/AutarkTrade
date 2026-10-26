/**
 * Spot-Portfolio: geteilter Zustand der drei Ansichten (Übersicht,
 * Bewegungen, Quellen). Die Übersicht kommt aus der DB des Servers — Holen
 * kostet keinen Börsenabruf; „Aktualisieren" startet einen Abruf im
 * Hintergrund und fragt, bis er fertig ist.
 */
import { ref, computed } from 'vue'
import axios from 'axios'
import { appEinstellungen } from './settings.js'
import i18n from '../i18n'

const t = (k, p) => i18n.global.t(k, p)

export const uebersicht = ref(null)
export const laedt = ref(false)
export const ladeFehler = ref('')
export const abrufLaeuft = ref(false)
export const abrufQuelle = ref(null)

let abfrage = null
let nachgeholt = false

/** Coin als Totalverlust markieren bzw. die Markierung aufheben, danach neu laden. */
/** @param {number} [abJahr]  erstes Steuerjahr ohne den Coin (Vorgabe Vorjahr) */
export async function setzeTotalverlust(asset, an, abJahr) {
    await axios.put('/api/portfolio/totalverlust', { asset, an, abJahr })
    await ladeUebersicht()
}

/** Spam von Hand: true = Spam, false = kein Spam, null = die Namensregel entscheidet. */
export async function setzeSpam(asset, spam) {
    await axios.put('/api/portfolio/spam', { asset, spam })
    await ladeUebersicht()
}

export async function ladeUebersicht() {
    laedt.value = !uebersicht.value
    try {
        const { data } = await axios.get('/api/portfolio/uebersicht')
        uebersicht.value = data
        ladeFehler.value = ''
        abrufLaeuft.value = !!data.lauf?.laeuft
        if (abrufLaeuft.value) beobachteAbruf()
        // Beim ersten Öffnen: ist der letzte Abruf älter als der Takt (oder
        // läuft gar keiner, etwa im Testbetrieb), selbst nachholen.
        else if (!nachgeholt && data.quellen?.length) {
            nachgeholt = true
            const juengster = Math.max(0, ...data.quellen.map((q) => q.letzterAbruf || 0))
            if (Date.now() - juengster > 15 * 60e3) starteAbruf()
        }
    } catch (e) {
        ladeFehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

/** Abruf starten (alle oder eine Quelle) und bis zum Ende nachfragen. */
export async function starteAbruf(quelle = null) {
    abrufLaeuft.value = true
    try { await axios.post('/api/portfolio/abruf', quelle ? { quelle } : {}) } catch { /* Stand zeigt es */ }
    beobachteAbruf()
}

function beobachteAbruf() {
    if (abfrage) return
    abfrage = setInterval(async () => {
        try {
            const { data } = await axios.get('/api/portfolio/abruf')
            abrufQuelle.value = data.quelle || null
            if (!data.laeuft) {
                clearInterval(abfrage)
                abfrage = null
                abrufLaeuft.value = false
                abrufQuelle.value = null
                await ladeUebersicht()
            }
        } catch { /* nächster Versuch */ }
    }, 2500)
}

/** Kleinstbestände zeigen? (pro Gerät gemerkt) */
export const staubZeigen = ref((() => { try { return localStorage.getItem('at.portfolio.staub') === '1' } catch { return false } })())
export function setzeStaub(v) {
    staubZeigen.value = v
    try { localStorage.setItem('at.portfolio.staub', v ? '1' : '0') } catch { /* privat */ }
}

/** Beträge verbergen (Bildschirm teilen) — pro Gerät gemerkt. */
export const verborgen = ref((() => { try { return localStorage.getItem('at.portfolio.verborgen') === '1' } catch { return false } })())
export function schalteVerborgen() {
    verborgen.value = !verborgen.value
    try { localStorage.setItem('at.portfolio.verborgen', verborgen.value ? '1' : '0') } catch { /* privat */ }
}

const chfFormat = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function chf(v, { vorzeichen = false } = {}) {
    if (v == null || !Number.isFinite(Number(v))) return '—'
    if (verborgen.value) return 'CHF ••••'
    const s = chfFormat.format(Math.abs(Number(v)))
    const z = vorzeichen ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '')
    return `${z}CHF ${s}`
}
export function menge(v) {
    if (v == null) return '—'
    if (verborgen.value) return '••••'
    const a = Math.abs(Number(v))
    const st = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.0001 ? 6 : 8
    return Number(v).toLocaleString('de-CH', { maximumFractionDigits: st })
}
export function prozent(v) {
    return v == null ? '—' : `${(v * 100).toLocaleString('de-CH', { maximumFractionDigits: v < 0.01 ? 2 : 1 })} %`
}
export function vorZeit(ms) {
    if (!ms) return '—'
    const d = Math.max(0, Date.now() - ms) / 1000
    if (d < 60) return t('portfolio.zeitJetzt')
    if (d < 3600) return t('portfolio.zeitMin', { n: Math.round(d / 60) })
    if (d < 86400) return t('portfolio.zeitStd', { n: Math.round(d / 3600) })
    return t('portfolio.zeitTage', { n: Math.round(d / 86400) })
}

/** Spot/Futures-Wahl je Börse (Einstellungsspalte `portfolioBoersen`). */
export const BOERSEN = [
    { id: 'bitunix', name: 'Bitunix', futures: true },
    { id: 'bitget', name: 'Bitget', futures: true },
    { id: 'pionex', name: 'Pionex', futures: true },
    { id: 'bitpanda', name: 'Bitpanda', futures: false },
]
export function boersenMaerkte(einstellungen = appEinstellungen.value) {
    let w = {}
    try { w = JSON.parse(einstellungen?.portfolioBoersen || '{}') || {} } catch { w = {} }
    const aus = {}
    for (const b of BOERSEN) {
        aus[b.id] = {
            futures: b.futures ? Number(w[b.id]?.futures ?? 1) === 1 : false,
            spot: Number(w[b.id]?.spot ?? 0) === 1,
        }
    }
    return aus
}

/** Farbe je Asset: stabil aus dem Namen (gleicher Coin = gleiche Farbe überall). */
const PALETTE = ['#1fd6c4', '#f0a04b', '#7c8cf8', '#e06c9f', '#5fd38d', '#d8a33a', '#36c2d6', '#b98cf0', '#ef7d5a', '#8fbf3f']
const FEST = { BTC: '#f7931a', ETH: '#7c8cf8', SOL: '#b98cf0', USDT: '#3fbf8f', USDC: '#4a90e2', BNB: '#f0b90b' }
/*
 * Die grössten Posten bekommen der Reihe nach verschiedene Farben — ein Hash
 * allein gab CRO und RENDER dasselbe Orange, nebeneinander im Band.
 */
const rangFarben = computed(() => {
    const m = new Map()
    const frei = PALETTE.filter((f) => !Object.values(FEST).includes(f))
    let i = 0
    for (const p of uebersicht.value?.posten || []) {
        const a = String(p.asset).toUpperCase()
        if (FEST[a] || m.has(a)) continue
        m.set(a, frei[i++ % frei.length])
    }
    return m
})
export function farbeVon(asset) {
    const a = String(asset || '').toUpperCase()
    if (FEST[a]) return FEST[a]
    if (rangFarben.value.has(a)) return rangFarben.value.get(a)
    let h = 0
    for (const c of a) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
}

export const offeneAnzahl = ref(0)
export const hatQuellen = computed(() => !!uebersicht.value?.quellen?.length)

/**
 * Spot/Futures einer Börse umschalten. Schreibt die Einstellung und zieht
 * `appEinstellungen` im selben Takt nach (Seitenmenü, Polling lesen daraus).
 */
export async function setzeBoersenMarkt(boerse, markt, an) {
    const { dbUpdateSettings } = await import('../utils/db.js')
    let w = {}
    try { w = JSON.parse(appEinstellungen.value?.portfolioBoersen || '{}') || {} } catch { w = {} }
    w[boerse] = { ...(w[boerse] || {}), [markt]: an ? 1 : 0 }
    const json = JSON.stringify(w)
    await dbUpdateSettings({ portfolioBoersen: json })
    if (appEinstellungen.value) appEinstellungen.value.portfolioBoersen = json
}
