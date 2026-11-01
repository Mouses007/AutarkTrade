/**
 * Chart-Alarme im Browser: Liste, Anlegen/Ändern/Löschen und ein Blick alle
 * zehn Sekunden, ob einer ausgelöst hat.
 *
 * Geprüft wird auf dem SERVER (`server/chart-alarme.js`) — auch bei
 * geschlossener Seite, Meldung per Push/Mail. Hier geht es nur darum, eine
 * Auslösung auch auf der offenen Seite zu zeigen: als Banner, und als
 * Browser-Meldung, wenn der Tab im Hintergrund liegt.
 */
import { ref } from 'vue'
import axios from 'axios'
import { sendNotification } from '../utils/notify.js'
import { abrufFolge, findeNeue, hinweisSchluessel } from '../utils/chart/alarmHinweise.js'

export const alarme = ref([])
// Bis zu 50 Hinweise gemerkt; die Leiste zeigt fünf, der Rest ist darunter scrollbar.
const MAX_HINWEISE = 50
export const neueAusloesungen = ref([])     // [{ id, symbol, titel, text, t, ziel: { symbol, markt, tf } }]

let uhr = null
let nutzer = 0
/*
 * Welche Auslösungen als Hinweis erscheinen (31.10.2026): JEDER neue Eintrag im
 * Verlauf eines Alarms, nicht nur der letzte — ein Watchlist-Alarm meldete
 * BNB und später SOL, im Browser stand nur SOL. Nach dem Öffnen der Seite auch
 * die der letzten `RUECKBLICK_MS`, solange sie nicht geschlossen wurden (das
 * Schliessen wird im Browser gemerkt). Desktop-Meldungen nur für Auslösungen
 * nach dem Öffnen — ältere hat das Handy schon gemeldet. Was neu ist, entscheidet
 * `findeNeue` (`utils/chart/alarmHinweise.js`) je Eintrag, nicht über eine
 * gemeinsame Zeitmarke; Selbstabschaltungen (`hinweis`) sind nie eine Auslösung.
 * Eine Antwort, die ein später gestarteter Abruf überholt hat, wird verworfen
 * (`abrufFolge`), damit ihr älterer Stand keine Auslösung ein zweites Mal meldet.
 */
const START = Date.now()
const RUECKBLICK_MS = 6 * 3_600_000
const QUITT_SCHLUESSEL = 'chartAlarmQuittiert'
const QUITT_MAX = 300
const AB = START - RUECKBLICK_MS
let gesehen = new Set()
// Überholte Antworten (älterer Stand, später angekommen) zählen nicht — sonst doppelte Hinweise.
const folge = abrufFolge()
const quittiert = (() => { try { return new Set(JSON.parse(localStorage.getItem(QUITT_SCHLUESSEL) || '[]')) } catch { return new Set() } })()
function merkeQuittiert(schluessel) {
    for (const k of schluessel) quittiert.add(k)
    const liste = [...quittiert].slice(-QUITT_MAX)
    quittiert.clear(); liste.forEach((k) => quittiert.add(k))
    try { localStorage.setItem(QUITT_SCHLUESSEL, JSON.stringify(liste)) } catch { /* kein Speicher */ }
}

/** Ein Verlaufseintrag als Hinweis (Leiste und Desktop-Meldung sagen dasselbe wie Push und Handy). */
function alsHinweis(a, v) {
    const mehrfach = MEHRFACH.includes(a.art)
    const symbol = a.symbol || v?.treffer?.[0]?.symbol || (a.art === 'lsob' ? 'LSOB' : 'Momentum')
    const kurz = mehrfach && v?.treffer?.length
        ? v.treffer.map(trefferText).join(' · ')
        : `${a.symbol}: ${beschreibe(a)}${v?.p != null ? ` — ${v.p}` : ''}`
    // Text vom Server (seit 22.10.2026 im Verlauf); ältere Einträge ohne Text: die Kurzform.
    const text = v?.text ? v.text.split('\n').filter(Boolean).join(' · ') : kurz
    // Wohin ein Klick führt: Momentum/LSOB → der (erste) Treffer mit seiner Zeiteinheit;
    // Preis/Linie/Zone → das Symbol des Alarms (Zeiteinheit bleibt).
    const tr = mehrfach ? v?.treffer?.[0] : null
    const ziel = tr ? { symbol: tr.symbol, markt: tr.markt || 'futures', tf: tr.tf || null }
        : a.symbol ? { symbol: a.symbol, markt: a.markt || 'futures', tf: null } : null
    return { id: a.id, symbol, titel: v?.titel || `Alarm ${symbol}`, text, t: v.t, ziel, meldung: v?.text || kurz }
}

export async function ladeAlarme() {
    const nummer = folge.beginne()
    try {
        const { data } = await axios.get('/api/chart/alarme')
        if (!folge.uebernimm(nummer)) return
        const erg = findeNeue(data, gesehen, AB)
        gesehen = erg.gesehen
        const neu = erg.neu.filter(({ a, v }) => !quittiert.has(hinweisSchluessel(a.id, v.t))).map(({ a, v }) => alsHinweis(a, v))
        if (neu.length) {
            neu.sort((x, y) => x.t - y.t)
            neueAusloesungen.value = [...neueAusloesungen.value, ...neu].slice(-MAX_HINWEISE)
            for (const n of neu) if (n.t > START) sendNotification('chartAlarm', n.titel, n.meldung, { tag: `chartAlarm-${n.id}-${n.t}` })
        }
        alarme.value = data
    } catch { /* nächster Versuch in zehn Sekunden */ }
}

const MEHRFACH = ['momentum', 'lsob']
const LSOB_WAS = { retest: 'Retest', box: 'neue Box', beruehrt: 'Box berührt', bruch: 'Box gebrochen' }

/**
 * Ein Treffer eines Momentum-Alarms: „BTCUSDT 15m ● Long" (● gross, • klein);
 * eines LSOB-Alarms: „BTCUSDT 1h LSOB Retest Long".
 */
export function trefferText(tr) {
    if (Array.isArray(tr.ereignisse)) {
        const was = tr.ereignisse.map((e) => `${LSOB_WAS[e.typ] || e.typ} ${e.seite === 'long' ? 'Long' : 'Short'}`).join(', ')
        return `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf} LSOB ${was}`
    }
    return `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf} ${tr.stark ? '●' : '•'} ${tr.seite === 'long' ? 'Long' : 'Short'}${tr.divergenz ? ' Div' : ''}`
}

/** Kurzbeschreibung für Liste, Banner und Preislinie. */
export function beschreibe(a) {
    const b = a.bedingung || {}
    if (a.art === 'momentum') {
        const groesse = a.punktgroesse === 'alle' ? '●• grosse + kleine' : '● grosse'
        const r = b.richtung === 'long' ? ' Long' : b.richtung === 'short' ? ' Short' : ''
        return `Momentum ${groesse}${b.divergenz ? ' mit Divergenz' : ''}${r} · ${(a.zeiteinheiten || []).join(', ')}`
    }
    if (a.art === 'lsob' && b.box) {
        const z = (p) => Number(Number(p).toPrecision(7))
        return `LSOB ${b.box.seite === 'long' ? 'Long' : 'Short'}-Box ${z(b.box.tief)}–${z(b.box.hoch)} · ${(a.zeiteinheiten || []).join(', ')}`
    }
    if (a.art === 'lsob') {
        const was = { retest: 'Retest', box: 'neue Box', beide: 'Retest + neue Box' }[b.ereignis] || 'Retest'
        const r = b.richtung === 'long' ? ' Long' : b.richtung === 'short' ? ' Short' : ''
        return `LSOB ${was}${r} · ${(a.zeiteinheiten || []).join(', ')}`
    }
    const r = { ueber: '↑ über', unter: '↓ unter', kreuzt: '↕ kreuzt', betreten: '→ Zone betreten', verlassen: '← Zone verlassen' }[b.richtung || (a.art === 'zone' ? 'betreten' : 'kreuzt')]
    if (a.art === 'preis') return `${r} ${b.preis}`
    const profil = { poc: 'POC', vah: 'VAH', val: 'VAL' }[b.kante]
    if (a.art === 'linie' && profil) return `${r} ${profil}${Number(b.niveau) > 0 ? ` ${Number(Number(b.niveau).toPrecision(7))}` : ''}`
    if (a.art === 'linie') return `${r} Linie${b.kante && b.kante !== 'oben' ? ` (${b.kante})` : ''}`
    return r
}

/** Polling starten — mehrere Nutzer (Seite, Reiter) teilen einen Takt. */
export function abonniereAlarme() {
    nutzer++
    if (!uhr) {
        ladeAlarme()
        uhr = setInterval(ladeAlarme, 10_000)
    }
    return () => {
        nutzer--
        if (nutzer <= 0) { clearInterval(uhr); uhr = null; nutzer = 0 }
    }
}

export async function legeAlarmAn(daten) {
    const { data } = await axios.post('/api/chart/alarme', daten)
    alarme.value = [data, ...alarme.value]
    return data
}

export async function aendereAlarm(id, patch) {
    const { data } = await axios.put(`/api/chart/alarme/${id}`, patch)
    alarme.value = alarme.value.map((a) => (a.id === id ? data : a))
    return data
}

export async function loescheAlarm(id) {
    await axios.delete(`/api/chart/alarme/${id}`)
    alarme.value = alarme.value.filter((a) => a.id !== id)
}

/** Einen Hinweis schliessen — mit `t` genau diesen (ein wiederholender Alarm kann mehrere haben), ohne alle des Alarms. */
export function quittiere(id, t = null) {
    const weg = neueAusloesungen.value.filter((x) => x.id === id && (t == null || x.t === t))
    merkeQuittiert(weg.map((x) => hinweisSchluessel(x.id, x.t)))
    neueAusloesungen.value = neueAusloesungen.value.filter((x) => !weg.includes(x))
}

export function alleQuittieren() {
    merkeQuittiert(neueAusloesungen.value.map((x) => hinweisSchluessel(x.id, x.t)))
    neueAusloesungen.value = []
}
