/**
 * Spracheingabe über den Server — der rechnende Kern, ohne Netz und Datenbank.
 *
 * Warum es das gibt: Die eingebaute Erkennung des Browsers (`SpeechRecognition`)
 * schickt den Ton an den Dienst des Herstellers. Brave, Chromium aus der
 * Paketquelle, Vivaldi und Opera haben die Schnittstelle, aber keinen Zugang
 * zu diesem Dienst — sie melden nur `network` (16.11.2026, Brave). Firefox hat
 * sie gar nicht. Für diese Browser nimmt das Mikrofon den Ton selbst auf
 * (`MediaRecorder`), und der Server lässt ihn umschreiben:
 *   - `openai`: OpenAI `/v1/audio/transcriptions` mit dem hinterlegten OpenAI-Schlüssel;
 *   - `eigen`:  ein eigener, OpenAI-kompatibler Whisper-Dienst (z. B. Speaches/
 *               faster-whisper-server, whisper.cpp `server --inference-path
 *               /v1/audio/transcriptions`) im eigenen Netz, ohne Schlüssel.
 * `browser` bleibt die Voreinstellung: dort, wo die Browser-Erkennung geht,
 * ist sie sofort da und kostet nichts.
 */

export const SPRACHE_ARTEN = ['browser', 'openai', 'eigen']
export const OPENAI_BASIS = 'https://api.openai.com/v1'
export const STANDARD_MODELL = { openai: 'gpt-4o-mini-transcribe', eigen: 'whisper-1' }

/** OpenAI nimmt bis 25 MB; mit Rand. Opus/WebM sind etwa 1 MB je 4–5 Minuten. */
export const MAX_BYTES = 20 * 1024 * 1024

/** USD je Minute Ton (OpenAI-Preisliste). Unbekanntes Modell → Whisper-Preis, lieber zu hoch gebucht. */
const PREIS_JE_MINUTE = {
    'gpt-4o-mini-transcribe': 0.003,
    'gpt-4o-transcribe': 0.006,
    'whisper-1': 0.006,
}

export function normArt(art) {
    const a = String(art || '').trim()
    return SPRACHE_ARTEN.includes(a) ? a : 'browser'
}

/** Adresse des Dienstes → Basis bis `/v1`; ein mitkopiertes `/audio/transcriptions` fällt weg. '' = unbrauchbar. */
export function spracheBasis(roh) {
    const s = String(roh || '').trim()
    if (!s) return ''
    let u
    try { u = new URL(s) } catch { return '' }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (u.username || u.password || u.search || u.hash) return ''
    const pfad = u.pathname.replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '')
    return `${u.origin}${pfad}`
}

export function gueltigesModell(m) {
    const s = String(m || '').trim()
    if (!s) return true                     // leer = Vorgabe der Art
    return s.length <= 120 && /^[A-Za-z0-9._:\/-]+$/.test(s) && !s.includes('..') && !s.startsWith('-')
}

/**
 * Eingabe der Einstellungsseite prüfen. Wirft mit einem Code (`fehlerCode`),
 * die Oberfläche übersetzt ihn.
 */
export function pruefeSpracheEinstellung(roh = {}) {
    const art = normArt(roh.art)
    const modell = String(roh.modell || '').trim()
    if (!gueltigesModell(modell)) throw Object.assign(new Error('modell'), { fehlerCode: 'modell' })
    const url = String(roh.url || '').trim()
    const basis = url ? spracheBasis(url) : ''
    if (url && !basis) throw Object.assign(new Error('url'), { fehlerCode: 'url' })
    if (art === 'eigen' && !basis) throw Object.assign(new Error('urlFehlt'), { fehlerCode: 'urlFehlt' })
    return { art, url: basis, modell }
}

/** Wohin der Ton geht. `null` = mit dieser Einstellung nicht möglich (Grund in `fehlt`). */
export function zielFuer({ art, url, modell, openaiSchluessel }) {
    const a = normArt(art)
    if (a === 'openai') {
        if (!openaiSchluessel) return { fehlt: 'schluessel' }
        return {
            url: `${OPENAI_BASIS}/audio/transcriptions`,
            schluessel: openaiSchluessel,
            modell: String(modell || '').trim() || STANDARD_MODELL.openai,
            anbieter: 'openai',
        }
    }
    if (a === 'eigen') {
        const basis = spracheBasis(url)
        if (!basis) return { fehlt: 'url' }
        return { url: `${basis}/audio/transcriptions`, schluessel: '', modell: String(modell || '').trim() || STANDARD_MODELL.eigen, anbieter: 'whisper' }
    }
    return { fehlt: 'browser' }
}

/** MIME-Typ der Aufnahme → Dateiname; der Dienst erkennt das Format an der Endung. */
export function dateiName(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim()
    const endung = {
        'audio/webm': 'webm', 'video/webm': 'webm',
        'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'video/mp4': 'mp4',
        'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    }[m]
    return endung ? `aufnahme.${endung}` : null
}

/** 'de-CH' → 'de'. Unbekanntes → '' (dann rät der Dienst selbst). */
export function sprachCode(roh) {
    const s = String(roh || '').trim().slice(0, 2).toLowerCase()
    return /^[a-z]{2}$/.test(s) ? s : ''
}

/** Kosten einer Umschrift. Eigener Dienst = 0; ohne bekannte Dauer wird nach Grösse geschätzt (Opus ≈ 4 kB/s). */
export function kostenUsd({ anbieter, modell, sekunden, bytes }) {
    if (anbieter !== 'openai') return 0
    let sek = Number(sekunden)
    if (!Number.isFinite(sek) || sek <= 0) sek = Math.max(1, (Number(bytes) || 0) / 4000)
    const preis = PREIS_JE_MINUTE[modell] ?? 0.006
    return Math.round(preis * sek / 60 * 1e6) / 1e6
}

/** Antwort des Dienstes → Text. JSON `{text}` oder reiner Text; alles andere → ''. */
export function textAusAntwort(antwort) {
    if (typeof antwort === 'string') {
        const s = antwort.trim()
        if (s.startsWith('{')) {
            try { return textAusAntwort(JSON.parse(s)) } catch { return '' }
        }
        return s.slice(0, 20000)
    }
    if (antwort && typeof antwort.text === 'string') return antwort.text.trim().slice(0, 20000)
    return ''
}
