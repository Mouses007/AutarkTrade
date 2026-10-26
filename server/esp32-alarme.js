/**
 * Auslösungen der Chart-Alarme für Abrufer ohne Sitzung (Android-Widget).
 *
 *   GET /api/esp32/alarme?seit=<ms>&arten=preis,linie,zone,momentum,lsob   (Route in esp32-api.js)
 *
 * Rein: Zeilen von `chart_alarme` → flache Liste der Auslösungen. Eine eigene
 * Tabelle gibt es nicht und braucht es nicht — jede Auslösung steht ohnehin im
 * `verlauf` ihres Alarms (die letzten 20), mit Zeit und Preis, seit 22.10.2026
 * auch mit Titel und Text. Ein Gerät, das alle paar Minuten fragt, verpasst
 * davon nichts, solange ein Alarm zwischen zwei Abrufen nicht 20-mal auslöst.
 *
 * Warum Abruf statt Push: ein selbst gehosteter Server ohne Firebase erreicht
 * ein Android-Gerät nur über eine Verbindung, die das Gerät selbst hält. ntfy
 * macht genau das (und ist als Kanal schon da); das Widget fragt nach. Die
 * Verzögerung ist also der Abfragetakt des Geräts, im Doze-Schlaf länger.
 *
 * Die Kennung einer Auslösung ist `alarmId-t`: das Gerät fragt mit Überlappung
 * (der Verlaufseintrag wird erst NACH der Zustellung an ntfy/Telegram
 * geschrieben, kann also eine Zeit tragen, die vor dem letzten Abruf liegt)
 * und sortiert Doppelte über die Kennung aus.
 */
import { momentumText } from './chart-alarm-momentum.js'

export const ARTEN = ['preis', 'linie', 'zone', 'momentum', 'lsob']
/** Arten über mehrere Symbole/Zeiteinheiten: Symbol und Markt stehen in den Treffern. */
const MEHRFACH = new Set(['momentum', 'lsob'])
export const MAX_ANTWORT = 50
const SEITE = { long: 'Long', short: 'Short' }

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

function zahl(p) {
    if (!Number.isFinite(p)) return '—'
    const a = Math.abs(p)
    const stellen = a >= 1000 ? 2 : a >= 1 ? 4 : 8
    return Number(p.toFixed(stellen)).toLocaleString('de-CH', { maximumFractionDigits: stellen })
}

/** `?arten=` → Menge bekannter Arten; leer oder unbekannt heisst alle. */
export function leseArten(roh) {
    const teile = String(roh || '').split(',').map((s) => s.trim()).filter((s) => ARTEN.includes(s))
    return new Set(teile.length ? teile : ARTEN)
}

/**
 * Wortlaut für Einträge von vor dem 22.10.2026, die noch keinen Text tragen.
 * Momentum lässt sich aus den gespeicherten Treffern genau nachbauen; bei
 * Linie und Zone fehlt die Zeichnung, dort bleibt es beim Preis.
 */
function ersatzText(alarm, e) {
    if (alarm.art === 'momentum' && Array.isArray(e.treffer) && e.treffer.length) {
        const tr = e.treffer.map((x) => ({ ...x, punkt: { stark: !!x.stark, divergenz: !!x.divergenz, seite: SEITE[x.seite] ? x.seite : 'long' } }))
        return momentumText(alarm, tr, zahl)
    }
    const markt = alarm.markt === 'spot' ? ' Spot' : ''
    const was = { preis: 'Preisalarm', linie: 'Linienalarm', zone: 'Zonenalarm' }[alarm.art] || 'Alarm'
    const titel = `${alarm.symbol}${markt} ${was}${Number.isFinite(e.niveau) ? ` bei ${zahl(e.niveau)}` : ''}`
    return { titel, text: `${titel} — jetzt ${zahl(Number(e.p))}${alarm.notiz ? `\n${alarm.notiz}` : ''}` }
}

/**
 * @param zeilen  Rohzeilen aus `chart_alarme` (JSON-Spalten als Text oder Objekt)
 * @param opt.seit  nur Auslösungen mit t > seit (ms)
 * @param opt.arten Set der gewünschten Arten
 * @returns neueste zuerst, höchstens `opt.grenze` (Vorgabe MAX_ANTWORT)
 */
export function ausloesungenAus(zeilen, { seit = 0, arten = new Set(ARTEN), grenze = MAX_ANTWORT } = {}) {
    const aus = []
    for (const r of zeilen || []) {
        const art = r.art
        if (!arten.has(art)) continue
        // Wer für einen Alarm Push abgeschaltet hat, will ihn auch nicht auf dem Handy.
        const kanaele = parse(r.kanaele, null)
        if (kanaele && kanaele.push === false) continue
        const alarm = { id: Number(r.id), art, symbol: r.symbol || '', markt: r.markt === 'spot' ? 'spot' : 'futures', notiz: r.notiz || '' }
        // Dringlichkeit fürs Handy (Sprachausgabe je Stufe); „kritisch“ ist der alte Name von „einstieg“
        const s = parse(r.bedingung, {})?.schwere
        const schwere = s === 'kritisch' ? 'einstieg' : ['info', 'warnung', 'einstieg'].includes(s) ? s : 'warnung'
        for (const e of parse(r.verlauf, [])) {
            const t = Number(e?.t)
            if (!(t > seit)) continue
            // Hinweise (z. B. „Linie endet, Alarm aus") sind keine Auslösung.
            if (e.hinweis) continue
            const { titel, text } = e.titel ? { titel: e.titel, text: e.text || e.titel } : ersatzText(alarm, e)
            const symbole = MEHRFACH.has(art)
                ? [...new Set((e.treffer || []).map((x) => x.symbol).filter(Boolean))]
                : [alarm.symbol].filter(Boolean)
            const markt = MEHRFACH.has(art) ? (e.treffer?.[0]?.markt === 'spot' ? 'spot' : 'futures') : alarm.markt
            aus.push({
                id: `${alarm.id}-${t}`, alarmId: alarm.id, art, zeit: t,
                symbol: symbole[0] || '', symbole, markt,
                preis: Number.isFinite(Number(e.p)) ? Number(e.p) : null,
                niveau: Number.isFinite(e.niveau) ? e.niveau : null,
                tf: MEHRFACH.has(art) ? e.treffer?.[0]?.tf || null : null,
                titel, text, schwere,
            })
        }
    }
    aus.sort((a, b) => b.zeit - a.zeit || b.alarmId - a.alarmId)
    return aus.slice(0, grenze)
}
