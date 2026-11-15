/**
 * CryptoQuant — Zugang, Abruf und Einlagerung der ETF-Bestände (BTC und ETH)
 * und des Coinbase-Premium-Index.
 *
 * Warum überhaupt eine Fremdquelle mit Schlüssel, wo sonst alles ohne
 * auskommt: den Netto-Zufluss der Bitcoin-Spot-ETFs gibt es frei nirgends,
 * und er ist seit deren Zulassung einer der meistgenannten Treiber. Der
 * Gratis-Tarif („Basic") reicht dafür — `fund-data` zählt bei CryptoQuant als
 * *Marktdaten* und ist damit auf jedem Tarif offen, im Gegensatz zu allem
 * On-Chain (Börsenflüsse, MVRV, Bull Score), das Professional verlangt.
 *
 * Drei Eigenheiten des Gratis-Tarifs bestimmen den Aufbau dieser Datei:
 *
 * 1. **30 Tage Rückblick.** Mehr gibt die Quelle nicht her. Die Kurve muss
 *    also selbst gesammelt werden — genau wie bei der BTC-Dominanz, und über
 *    dieselbe Tabelle `market_snapshots`. Fällt der Zugang später weg, bleibt
 *    der eingelagerte Bestand erhalten.
 * 2. **10 Anfragen pro Minute.** Die Fonds werden deshalb NACHEINANDER mit
 *    Abstand geholt, nie parallel.
 * 3. **10'000 Credits im Monat**, und jede Antwortzeile kostet. Abgerufen wird
 *    darum im Hintergrundtakt (höchstens alle sechs Stunden, über
 *    `db-claim.js` auch bei Doppelbetrieb nur einmal) und mit kleinem `limit`,
 *    sobald der Bestand einmal steht. **Die Kachel selbst ruft nie ab** — sie
 *    liest nur, was eingelagert ist. Ein Klick auf „Alle aktualisieren" kann
 *    damit keine Credits verbrennen.
 *
 * Die Zahlen sind Bestände in BTC, keine Dollar-Flüsse: der Zufluss ist die
 * Bestandsänderung zum Vortag. Umrechnen in Dollar wäre eine zweite Annahme
 * (welcher Kurs?) und bleibt der Kachel überlassen.
 *
 * Dazugekommen sind die Ethereum-Spot-ETFs (derselbe Endpunkt unter `/eth/`)
 * und der Coinbase-Premium-Index: beides Marktdaten und damit ebenfalls im
 * Gratis-Tarif. Alle Reihen laufen durch denselben Hintergrundlauf — siehe
 * `ABRUFE`. Mehr Reihen heisst mehr Credits; `abrufLimit` holt deshalb nur
 * noch, was fehlt, statt fest acht Tage je Reihe.
 */

import { getKnex } from './database.js'
import { decrypt, encrypt } from './crypto.js'
import { logWarn } from './logger.js'
import { beansprucheAufgabe, meldeFehler } from './db-claim.js'
import { ausCache, sendeRadar, sendRadarError, verwerfeCache } from './marktradar-api.js'
import { baueNutzlast, reiheAusAntwort, frischeHinweis, abrufLimit, verdichtePremium } from './etf-fluss.js'
import { istTestbetrieb } from './umgebung.js'

const CQ_BASE = 'https://api.cryptoquant.com/v1'
const HTTP_TIMEOUT = 15000

/** Abstand zwischen zwei Abrufen: Basic erlaubt 10/min, wir bleiben darunter. */
const ABSTAND_MS = 7000

/**
 * Welche Fonds abgefragt werden.
 *
 * Bewusst nicht alle vierzehn: jeder Fonds ist ein eigener Abruf, und die
 * kleinen bewegen zusammen weniger als IBIT an einem ruhigen Tag. `all_symbol`
 * deckt sie trotzdem ab — es ist die Summe ÜBER ALLE Fonds, auch die hier
 * nicht gelisteten. Was auf sie entfällt, weist die Kachel als Rest aus.
 *
 * Erweitern kostet nur einen Eintrag; die Einlagerung ist je Fonds getrennt.
 */
export const FONDS = [
    { id: 'all_symbol', name: 'Alle Fonds' },
    { id: 'ibit', name: 'iShares (IBIT)' },
    { id: 'fbtc', name: 'Fidelity (FBTC)' },
    { id: 'gbtc', name: 'Grayscale (GBTC)' },
    { id: 'btc', name: 'Grayscale Mini (BTC)' },
    { id: 'bitb', name: 'Bitwise (BITB)' },
    { id: 'arkb', name: 'ARK 21Shares (ARKB)' },
]

/**
 * Ethereum-Spot-ETFs. Kürzer als die BTC-Liste, weil der Markt kleiner ist und
 * jede Reihe Credits kostet; `all_symbol` deckt auch hier alle übrigen ab.
 */
export const FONDS_ETH = [
    { id: 'all_symbol', name: 'Alle Fonds' },
    { id: 'etha', name: 'iShares (ETHA)' },
    { id: 'ethe', name: 'Grayscale (ETHE)' },
    { id: 'feth', name: 'Fidelity (FETH)' },
]

const KIND = (id) => `etfBtc_${id}`
const KIND_ETH = (id) => `etfEth_${id}`
const KIND_PREMIUM = 'cbPremium'

/**
 * Alles, was ein Lauf holt — in dieser Reihenfolge.
 *
 * BTC zuerst: geht mitten im Lauf etwas schief (Credits leer), ist das
 * Wichtigste schon da. `feld` ist das Wertfeld der Antwort, `name` steht in
 * Fehlermeldungen und im Fortschritt.
 */
export const ABRUFE = [
    ...FONDS.map(f => ({
        name: `ETF BTC ${f.id}`, kind: KIND(f.id),
        pfad: '/btc/fund-data/digital-asset-holdings', params: { symbol: f.id },
    })),
    ...FONDS_ETH.map(f => ({
        name: `ETF ETH ${f.id}`, kind: KIND_ETH(f.id),
        pfad: '/eth/fund-data/digital-asset-holdings', params: { symbol: f.id },
    })),
    {
        name: 'Coinbase-Premium', kind: KIND_PREMIUM,
        pfad: '/btc/market-data/coinbase-premium-index', params: {},
        feld: 'coinbase_premium_index',
    },
]

/** Letzter Fehler des Abrufs — die Kachel soll sagen können, WARUM nichts kommt. */
let letzterFehler = null
let takt = null

/**
 * Ein Lauf zur Zeit, prozessweit.
 *
 * Nötig geworden, weil `erzwingen` (der Knopf in den Einstellungen) den
 * Anspruch bewusst umgeht: klickt jemand, während der Hintergrundtakt gerade
 * läuft, holen zwei Schleifen gleichzeitig — und verdoppeln damit die
 * Anfragerate gegen eine Grenze von 10 pro Minute. Der Anspruch schützt gegen
 * ZWEITE PROZESSE, nicht gegen zwei Läufe im selben.
 */
let lauf = null   // { start, fertig, gesamt, fonds }

// ── Zugang ──────────────────────────────────────────────────────────────

/**
 * Schlüssel aus den Einstellungen holen.
 *
 * Verschlüsselt gespeichert wie alle anderen Zugangsdaten. Fehlt er, ist das
 * kein Fehler, sondern der Normalzustand einer frischen Installation.
 */
export async function ladeSchluessel() {
    try {
        const row = await getKnex()('settings').select('cryptoquantApiKey').where('id', 1).first()
        const roh = row?.cryptoquantApiKey
        return roh ? decrypt(roh) : ''
    } catch (e) {
        logWarn('cryptoquant', `Schlüssel nicht lesbar: ${e.message}`)
        return ''
    }
}

/**
 * Ein Abruf gegen die CryptoQuant-API.
 *
 * Die Fehlercodes werden hier in Klartext übersetzt, weil sie beim Gratis-
 * Tarif konkrete Bedeutungen haben: 402 heisst „Credits aufgebraucht", 403
 * „dein Tarif kennt diesen Endpunkt nicht" (bei On-Chain-Daten der Normalfall)
 * und 429 „zu schnell". Ein nacktes „HTTP 403" hätte den Nutzer zum
 * Schlüsseltausch verleitet, obwohl der Schlüssel stimmt.
 */
async function cqHole(pfad, params, schluessel) {
    const url = new URL(`${CQ_BASE}${pfad}`)
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v))

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT)
    try {
        const r = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                Authorization: `Bearer ${schluessel}`,
                Accept: 'application/json',
                'User-Agent': 'AutarkTrade',
            },
        })
        if (!r.ok) {
            const texte = {
                401: 'Schlüssel ungültig oder abgelaufen',
                402: 'Credits aufgebraucht — sie werden monatlich neu vergeben',
                403: 'Dieser Endpunkt gehört nicht zum gebuchten Tarif',
                429: 'Zu viele Anfragen — CryptoQuant bremst',
            }
            const e = new Error(texte[r.status] || `HTTP ${r.status}`)
            e.status = r.status
            throw e
        }
        const d = await r.json()
        if (!d?.result?.data) throw new Error('Antwort ohne Datenteil')
        return d.result.data
    } finally {
        clearTimeout(timer)
    }
}

const warte = (ms) => new Promise(r => setTimeout(r, ms))

// ── Einlagerung ─────────────────────────────────────────────────────────

/** Eingelagerte Reihe lesen (`kind` wie in `ABRUFE`). */
async function leseReihe(kind) {
    const zeilen = await getKnex()('market_snapshots')
        .where('kind', kind).orderBy('dayUnix', 'asc').select('dayUnix', 'value')
    return zeilen.map(z => [Number(z.dayUnix), Number(z.value)])
}

/** Reihe einlagern. Der spätere Wert gewinnt — die Quelle korrigiert nach. */
async function schreibeReihe(kind, reihe) {
    if (!reihe.length) return 0
    const knex = getKnex()
    const zeilen = reihe.map(([tag, wert]) => ({
        kind, dayUnix: tag, value: wert, createdAt: Date.now(),
    }))
    for (let i = 0; i < zeilen.length; i += 200) {
        await knex('market_snapshots').insert(zeilen.slice(i, i + 200))
            .onConflict(['kind', 'dayUnix']).merge(['value', 'createdAt'])
    }
    return zeilen.length
}

/**
 * Bestände nachführen.
 *
 * Der Anspruch (`db-claim.js`) sorgt dafür, dass NAS-Container und
 * Entwicklerrechner sich nicht gegenseitig die Credits wegnehmen. Sechs
 * Stunden sind reichlich: die Quelle aktualisiert einmal täglich gegen 12:00
 * UTC und korrigiert danach gelegentlich nach.
 *
 * Wie weit zurück geholt wird, entscheidet der eigene Bestand (`abrufLimit`):
 * beim ersten Mal die vollen 30 Tage, die der Gratis-Tarif hergibt, danach die
 * fehlenden Tage plus drei — das fängt Nachkorrekturen ein, ohne jedes Mal
 * denselben Monat zu bezahlen.
 */
export async function aktualisiereEtf({ erzwingen = false } = {}) {
    if (lauf) return { uebersprungen: 'läuft bereits', lauf: { ...lauf } }
    const schluessel = await ladeSchluessel()
    if (!schluessel) return { uebersprungen: 'kein Schlüssel' }
    if (!erzwingen && !(await beansprucheAufgabe('snap_etf', 6 * 60 * 60 * 1000))) {
        return { uebersprungen: 'zu früh' }
    }

    lauf = { start: Date.now(), fertig: 0, gesamt: ABRUFE.length, fonds: '' }
    try {
        return await laufeDurch(schluessel)
    } finally {
        lauf = null
    }
}

/** Die eigentliche Schleife. Getrennt, damit der Laufzustand sicher endet. */
async function laufeDurch(schluessel) {
    let geholt = 0
    let zeilen = 0
    let fehler = null
    // Endpunkte, die der Tarif nicht kennt (403): gilt für jede weitere Reihe
    // desselben Pfads genauso — die anderen Endpunkte laufen trotzdem.
    const gesperrt = new Set()
    for (const abruf of ABRUFE) {
        lauf.fonds = abruf.name
        if (gesperrt.has(abruf.pfad)) { lauf.fertig++; continue }
        try {
            const vorhanden = await leseReihe(abruf.kind)
            const daten = await cqHole(abruf.pfad,
                { ...abruf.params, window: 'day', limit: abrufLimit(vorhanden) }, schluessel)
            zeilen += await schreibeReihe(abruf.kind, reiheAusAntwort(daten, abruf.feld))
            geholt++
        } catch (e) {
            fehler = { fonds: abruf.name, text: e.message, ts: Date.now(), status: e.status || 0 }
            logWarn('cryptoquant', `${abruf.name}: ${e.message}`)
            await meldeFehler('snap_etf', `${abruf.name}: ${e.message}`)
            // 401/402 gelten für jeden weiteren Abruf genauso — weiterlaufen
            // hiesse nur, dieselbe Absage elfmal einzusammeln.
            if ([401, 402].includes(e.status)) break
            if (e.status === 403) gesperrt.add(abruf.pfad)
        }
        lauf.fertig++
        await warte(ABSTAND_MS)
    }
    // Der Fehler eines Laufs bleibt stehen, bis ein Lauf ohne durchgeht — auch
    // wenn nach der gescheiterten Reihe noch andere gelangen.
    letzterFehler = fehler

    if (geholt) {
        verwerfeCache('etf|')
        console.log(` -> CryptoQuant: nachgeführt (${geholt} von ${ABRUFE.length} Reihen, ${zeilen} Tageswerte)`)
    }
    return { geholt, zeilen, fehler: letzterFehler }
}

// ── Kachel ──────────────────────────────────────────────────────────────

/**
 * Nutzlast der Kachel. Liest ausschliesslich den eigenen Bestand.
 *
 * Kein Schlüssel und kein Bestand ist ein eigener Zustand, kein Fehler: die
 * Kachel zeigt dann, was zu tun ist, statt einen roten Punkt.
 */
export async function holeEtf() {
    return ausCache('etf|btc', 10 * 60 * 1000, async () => {
        const reihen = new Map()
        for (const f of FONDS) reihen.set(f.id, await leseReihe(KIND(f.id)))

        const hatDaten = [...reihen.values()].some(r => r.length)
        if (!hatDaten) {
            const schluessel = await ladeSchluessel()
            return {
                leer: true,
                ohneSchluessel: !schluessel,
                hinweis: schluessel
                    ? (letzterFehler?.text || 'Bestände werden beim nächsten Takt geholt')
                    : null,
            }
        }

        const nutzlast = baueNutzlast(reihen, FONDS)
        const hinweise = [
            frischeHinweis(nutzlast.gesamt.tag),
            letzterFehler ? `${letzterFehler.fonds}: ${letzterFehler.text}` : null,
        ].filter(Boolean)

        // Ethereum-Fonds und Coinbase-Premium sind Beigaben: fehlen sie (noch
        // nicht geholt, Endpunkt gesperrt), bleibt das Feld `null` und die
        // Kachel zeigt den BTC-Teil wie bisher.
        const reihenEth = new Map()
        for (const f of FONDS_ETH) reihenEth.set(f.id, await leseReihe(KIND_ETH(f.id)))
        const eth = reihenEth.get('all_symbol').length ? baueNutzlast(reihenEth, FONDS_ETH) : null
        const premium = verdichtePremium(await leseReihe(KIND_PREMIUM))

        return {
            ...nutzlast,
            eth,
            premium,
            // Wie viel eigene Geschichte schon zusammengekommen ist — nach der
            // Einrichtung sind es 30 Tage, danach wächst es täglich.
            tageEigen: nutzlast.reihe.length,
            hinweis: hinweise.length ? hinweise.join(' · ') : undefined,
        }
    })
}

// ── Routen ──────────────────────────────────────────────────────────────

export function setupCryptoquantRoutes(app) {
    /**
     * Kachel-Endpunkt. Liest nur.
     *
     * `force=1` stösst zwar einen Nachschlag an, aber ohne den Anspruch zu
     * umgehen — wer den Knopf zehnmal drückt, löst höchstens alle sechs
     * Stunden einen echten Abruf aus. Das ist der Unterschied zur
     * Gesamtlage-Kachel: dort kostet ein Lauf Geld und darf deshalb nur per
     * POST laufen, hier kostet er Credits aus einem monatlichen Topf.
     */
    app.get('/api/marktradar/etf', async (req, res) => {
        try {
            if (req.query.force === '1') {
                // NICHT abwarten: die Reihen werden mit sieben Sekunden Abstand
                // geholt, ein voller Durchlauf dauert gut eine Minute. Wer
                // auf den Pfeil drückt, bekommt sofort den aktuellen Bestand;
                // das Nachgeführte steht beim nächsten Takt drin.
                aktualisiereEtf().catch(() => { })
            }
            sendeRadar(res, await holeEtf())
        } catch (e) {
            sendRadarError(res, e, 'ETF-Bestände')
        }
    })

    /**
     * Von Hand nachführen — umgeht den Anspruch bewusst (Einstellungsseite).
     *
     * Antwortet SOFORT und lässt den Lauf im Hintergrund weiterarbeiten. Der
     * Grund steht in einer verlorenen Anfrage: zwölf Reihen mit sieben
     * Sekunden Abstand sind gut eine Minute, und eine Minute überlebt eine
     * Browseranfrage nicht zuverlässig — es genügt ein Neustart des Servers
     * oder ein Gegenstück mit kurzem Zeitlimit dazwischen, und der Nutzer
     * sieht „Network Error", obwohl die Arbeit läuft. Den Fortschritt holt
     * sich die Oberfläche über `/status`.
     */
    app.post('/api/cryptoquant/aktualisieren', (req, res) => {
        if (lauf) return res.json({ success: true, laeuft: true, bereitsAmLaufen: true })
        aktualisiereEtf({ erzwingen: true }).catch((e) => {
            letzterFehler = { fonds: '—', text: e.message, ts: Date.now(), status: 0 }
        })
        res.json({ success: true, laeuft: true, gestartet: true })
    })

    /** Zustand für die Einstellungsseite: Schlüssel hinterlegt? Bestand wie alt? */
    app.get('/api/cryptoquant/status', async (req, res) => {
        try {
            const schluessel = await ladeSchluessel()
            const reihe = await leseReihe(KIND('all_symbol'))
            const letzter = reihe[reihe.length - 1] || null
            res.json({
                schluesselGesetzt: !!schluessel,
                tage: reihe.length,
                letzterTag: letzter ? letzter[0] : null,
                fehler: letzterFehler,
                fonds: FONDS.map(f => f.id),
                reihen: ABRUFE.length,
                // Läuft gerade ein Nachschlag? Die Oberfläche fragt hier nach,
                // statt auf eine minutenlange Antwort zu warten.
                laeuft: !!lauf,
                fortschritt: lauf ? { fertig: lauf.fertig, gesamt: lauf.gesamt, fonds: lauf.fonds } : null,
            })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    /**
     * Schlüssel speichern. Eigener Endpunkt, weil die allgemeine
     * Einstellungs-Route Geheimnisse weder schreibt noch herausgibt.
     */
    app.post('/api/cryptoquant/settings', async (req, res) => {
        try {
            const roh = req.body?.cryptoquantApiKey
            if (roh === undefined) return res.status(400).json({ error: 'cryptoquantApiKey fehlt' })
            // Maskierte Anzeige („••••") heisst „unverändert lassen"
            if (String(roh).includes('•')) return res.json({ success: true, unveraendert: true })
            const wert = String(roh).trim()
            await getKnex()('settings').where('id', 1).update({
                cryptoquantApiKey: wert ? encrypt(wert) : '',
            })
            letzterFehler = null
            verwerfeCache('etf|')
            res.json({ success: true, gesetzt: !!wert })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    /**
     * Schlüssel prüfen: ein einziger Abruf mit `limit=1`.
     *
     * Geprüft wird der übergebene Schlüssel, nicht der gespeicherte — sonst
     * müsste man erst speichern, um zu erfahren, ob er taugt. Ist das Feld
     * maskiert oder leer, wird der gespeicherte genommen.
     */
    app.post('/api/cryptoquant/test', async (req, res) => {
        try {
            let schluessel = req.body?.cryptoquantApiKey
            if (!schluessel || String(schluessel).includes('•')) schluessel = await ladeSchluessel()
            if (!schluessel) return res.status(400).json({ error: 'Kein Schlüssel hinterlegt' })

            const daten = await cqHole('/btc/fund-data/digital-asset-holdings',
                { symbol: 'all_symbol', window: 'day', limit: 1 }, String(schluessel).trim())
            const reihe = reiheAusAntwort(daten)
            if (!reihe.length) return res.status(502).json({ error: 'Antwort ohne verwertbare Zeile' })
            const [tag, wert] = reihe[reihe.length - 1]
            res.json({ success: true, tag, bestand: Math.round(wert) })
        } catch (e) {
            res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502)
                .json({ error: e.message })
        }
    })

    // Beim Start einmal nachsehen, danach halbstündlich — der Anspruch macht
    // daraus höchstens vier echte Abrufe am Tag. Der Versatz von 12 s hält den
    // Serverstart frei; die Fonds werden ohnehin mit Abstand geholt.
    if (!istTestbetrieb()) {
        setTimeout(() => { aktualisiereEtf().catch(() => { }) }, 12000)
        takt = setInterval(() => { aktualisiereEtf().catch(() => { }) }, 30 * 60 * 1000)
    }

    console.log(' -> CryptoQuant (ETF, Coinbase-Premium) routes initialized')
}

export function stopCryptoquant() {
    clearInterval(takt)
    takt = null
}
