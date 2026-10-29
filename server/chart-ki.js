/**
 * KI-Analyse im Chart: das Modell liest den Chart und liefert Linien, Zonen
 * und Bedingungen als JSON — der Chart zeichnet sie.
 *
 *   GET  /api/chart/ki-analyse?symbol=&interval=   letzte Analyse (kostet nichts, erzeugt nichts)
 *   POST /api/chart/ki-analyse {symbol, interval, markt, bild?}  erzeugt — kostet einen KI-Aufruf
 *
 * Dieselben Grundregeln wie Gesamtlage und Handelslage:
 *   1. Die KI liest ab, sie recherchiert nicht — alles, worauf sie sich
 *      stützen darf, steht in der Eingabe (Kerzen, eigene Linien, Hebelzonen).
 *   2. Keine Prognose, kein Kursziel, keine Empfehlung — wohl aber Marken und
 *      Bedingungen („solange über X …"). Geprüft mit demselben Wächter wie die
 *      Coin-Radar-Einordnung (`pruefeEinordnung`). Die Prüfung gilt IMMER:
 *      den Schalter `kiEmpfehlungenAn`, der sie abschaltete, gibt es seit S12
 *      (19.10.2026) nicht mehr — eine persönliche Kauf-/Verkaufsempfehlung
 *      verlangt bei den KI-Anbietern menschliche Prüfung (Verkaufs-Prüfung 2.8).
 *   5. Die Antwort trägt `kiGeneriert: true` (EU AI Act Art. 50) — die
 *      Oberfläche hängt daran das Label „KI-generiert – keine Anlageberatung“.
 *   3. GET erzeugt nie. Ein Lauf je Symbol+Zeiteinheit wird zusammengelegt,
 *      und zwischen zwei erzwungenen Läufen liegen mindestens 45 s.
 *   4. Was die Prüfung verwirft, steht im Protokoll und in der Antwort
 *      (`verworfen`) — sonst wüsste niemand, ob sie nützt oder frisst.
 *
 * Seit 18.10.2026 vermisst der CODE den Chart (`chart-kandidaten.js`: Niveaus,
 * Volumenprofil, ungebrochene Trendlinien, höhere Zeiteinheit, Struktur — mit
 * IDs), und das Modell wählt nur noch per ID aus und erklärt. Vorher las es
 * 150 Roh-Kerzen und erfand Geometrie: Schrägen aus zwei Preisen einer Marke,
 * Trendlinien, durch die die Kerzen wuchsen.
 *
 * Seit 27.10.2026 schickt der Browser ein Bild des sichtbaren Charts mit
 * (`bild`), sofern der Anbieter Bilder versteht (`kannBilder`). Das Modell
 * VERMISST damit nichts — Preise und Zeiten bleiben die des Codes —, es legt
 * nur Einspruch ein: ein Kanal (K) oder eine Trendlinie (T), die im Bild nicht
 * zu sehen ist, landet in `einwaende` und wird nicht gezeichnet. Anlass:
 * HBARUSDT 4h, wo der Code eine Seitwärts-Range als schräge Flagge vermessen
 * hatte — ein Blick aufs Bild hätte das gesehen, die Zahlenliste nicht.
 *
 * `baueChartEingabe` und `pruefeChartAuswahl` sind rein (Selbsttest:
 * `server/__selftest-chart-ki.mjs`).
 */
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { ladeLlmConfigFuerAufgabe, callLLMJson } from './llm.js'
import { kannBilder } from './ai-models.js'
import { getClosedCandles, isValidTimeframe, TIMEFRAME_MS } from './market-data.js'
import { holeHebelzonen } from './hebelzonen.js'
import { pruefeEinordnung } from './coin-radar/einordnung.js'
import { tradesAusZeilen } from './chart-journal.js'
import { sendeWennAus } from './quellen/aus.js'
import { baueKandidaten, kandidatenText, HTF_VON, KAND, zahl, preisVon, zeitText, kanalName, kanalKurz, kanalBeschriftung } from './chart-kandidaten.js'

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
/*
 * Fenster der Analyse: was im Chart SICHTBAR ist (vom Browser geschickt), mindestens
 * `KERZEN_MIN`, höchstens `KERZEN_MAX`; ohne Angabe `KERZEN`. Bis 26.10.2026 fest 150 —
 * auf 15m gut 37 Stunden: alle Marken begannen am rechten Rand, das Tief zwei Tage
 * vorher fehlte, und die Seitwärtsphase davor lag gar nicht im Fenster.
 */
const KERZEN = 500
const KERZEN_MIN = 150
const KERZEN_MAX = 1000
const TTL_MS = 30 * 60 * 1000
const SPERRE_MS = 45 * 1000
const CACHE_MAX = 12
const MAX_LINIEN = 6
const MAX_TRENDS = 3
const MAX_ZONEN = 3
const MAX_BEDINGUNGEN = 4
const HTF_KERZEN = 120
// Bild des Charts: JPEG oder PNG, base64 höchstens ~2,2 MB (der Browser schickt ~1280 px JPEG, typisch 150–300 kB)
const BILD_MAX_ZEICHEN = 3_000_000
const BILD_TYPEN = ['image/jpeg', 'image/png']
// Einspruch nur gegen gemessene GEOMETRIE — Niveaus sind gezählte Berührungen, da sieht das Bild nicht mehr
const EINSPRUCH_QUELLEN = ['kanal', 'trend']

/** Bild aus dem Request prüfen — rein. Ungültig → null (die Analyse läuft dann ohne Bild). */
export function pruefeBild(roh) {
    if (!roh || typeof roh !== 'object') return null
    const mediaType = String(roh.mediaType || '')
    const base64 = typeof roh.base64 === 'string' ? roh.base64 : ''
    if (!BILD_TYPEN.includes(mediaType) || base64.length < 100 || base64.length > BILD_MAX_ZEICHEN) return null
    if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return null
    return { kind: 'image', mediaType, base64, name: 'chart' }
}


/**
 * Die Eingabe an das Modell — rein. Statt 150 Roh-Kerzen die vom Code
 * vermessenen Kandidaten mit IDs (`chart-kandidaten.js`), dazu Hebelzonen und
 * eigene Trades. Ohne `paket` wird es aus den Kerzen gebaut (KI-Chat).
 * @returns {string}
 */
export function baueChartEingabe({ symbol, interval, kerzen, kerzenHtf = null, zeichnungen = [], hebelzonen = null, trades = [], paket = null, zeitzone = 'UTC' }) {
    const pk = paket || baueKandidaten({ kerzen, kerzenHtf, interval, intervalHtf: HTF_VON[interval] || null, zeichnungen, zeitzone })
    const tz = pk?.zeitzone || zeitzone
    const zeit = (ms) => zeitText(ms, tz)
    const zeilen = [`SYMBOL: ${symbol}`, `ZEITEINHEIT: ${interval}`, `JETZT: ${zeit(Date.now())}`, '']
    if (pk) zeilen.push(kandidatenText(pk))
    else zeilen.push('Zu wenige Kerzen für eine Vermessung.')
    if (hebelzonen && (hebelzonen.oben?.length || hebelzonen.unten?.length)) {
        zeilen.push('', 'GESCHÄTZTE LIQUIDATIONSZONEN (Modell aus Open Interest, keine Messung; nur zur Einordnung, nicht als Linie auswählbar):')
        for (const z of (hebelzonen.oben || []).slice(0, 3)) zeilen.push(`- darüber ${zahl(z.preis)} (~${Math.round(z.usd / 1e6)} Mio USD Shorts)`)
        for (const z of (hebelzonen.unten || []).slice(0, 3)) zeilen.push(`- darunter ${zahl(z.preis)} (~${Math.round(z.usd / 1e6)} Mio USD Longs)`)
    }
    if (trades.length) {
        zeilen.push('', 'EIGENE TRADES AUF DIESEM SYMBOL IM ZEITRAUM (nur zur Einordnung, nicht bewerten):')
        for (const t of trades.slice(-5)) {
            zeilen.push(`- ${t.richtung} ${zeit(t.einstieg.t)} @ ${zahl(t.einstieg.p)}${t.ausstieg ? ` → ${zeit(t.ausstieg.t)} @ ${zahl(t.ausstieg.p)}` : ' (offen)'}`)
        }
    }
    return zeilen.join('\n')
}

/*
 * Was die Analyse liefern soll — Kästchen im KI-Reiter. Abgewählte Quellen
 * kommen gar nicht erst in die Eingabe: das Modell kann sie weder wählen noch
 * erfinden, und die Eingabe wird kürzer.
 */
export const AUSWAHL_STANDARD = { niveaus: true, trend: true, zonen: true, volumen: true, htf: true, kanal: true, bedingungen: true, hebel: true, profilArt: 'konsolidierung' }
const QUELLE_ZU_AUSWAHL = { niveau: 'niveaus', trend: 'trend', volumenprofil: 'volumen', htf: 'htf', kanal: 'kanal' }
export const PROFIL_ARTEN = ['konsolidierung', 'tag', 'woche']
// Seit 24.10.2026 fest dabei, ohne Kästchen: Bedingungen und die Liquidationszonen als Kontext.
const IMMER_AN = ['bedingungen', 'hebel']

export function normAuswahl(roh) {
    const a = { ...AUSWAHL_STANDARD }
    if (roh && typeof roh === 'object') {
        for (const k of Object.keys(a)) if (k !== 'profilArt' && roh[k] !== undefined) a[k] = roh[k] !== false
        if (PROFIL_ARTEN.includes(roh.profilArt)) a.profilArt = roh.profilArt
    }
    for (const k of IMMER_AN) a[k] = true
    // Zonen entstehen aus Niveaus (N) oder Marken der höheren Zeiteinheit (D)
    if (!a.niveaus && !a.htf && !a.volumen) a.zonen = false
    return a
}
export const auswahlLeer = (a) => !a.niveaus && !a.trend && !a.volumen && !a.htf && !a.kanal

/** Paket auf die gewählten Quellen beschränken (rein). */
export function filterePaket(paket, a) {
    if (!paket) return paket
    return { ...paket, kandidaten: paket.kandidaten.filter((k) => a[QUELLE_ZU_AUSWAHL[k.quelle]] !== false) }
}

export function systemText(englisch, auswahl = AUSWAHL_STANDARD, { mitBild = false } = {}) {
    const a = normAuswahl(auswahl)
    const geprueft = [a.kanal && 'Kanal (K)', a.trend && 'Trendlinie (T)'].filter(Boolean)
    const sprache = englisch ? 'Write all texts in English.' : 'Schreibe alle Texte auf Deutsch.'
    const quellen = [a.niveaus && 'Niveaus (N…)', a.volumen && 'Volumenprofil-Marken (V…)', a.trend && 'ungebrochene Trendlinien (T…)', a.htf && 'Marken der höheren Zeiteinheit (D…)', a.kanal && 'Kanäle und Flaggen (K…)'].filter(Boolean).join(', ')
    const waagerecht = [a.niveaus && 'N', a.volumen && 'V', a.htf && 'D'].filter(Boolean)
    const linienIds = [...waagerecht.length ? [`${waagerecht.join(', ')} (waagerecht)`] : [], ...a.trend ? ['T (Trendlinie)'] : []].join(' oder ')
    const regeln = [
        '- Verwende NUR IDs aus der Liste. Erfinde keine Preise, keine Zeiten, keine Linien. Eine Marke, die nicht in der Liste steht, gibt es nicht. U-IDs (eigene Linien) darfst du nur im Text erwähnen, nicht auswählen.',
        `- Im Text, in "grund"${a.bedingungen ? ' und "dann"' : ''} schreibst du Marken als [ID] (z. B. [N4], [T1]); der Code setzt den Preis ein. Schreibe keine eigenen Kurszahlen.`,
        `- Linien: "id" aus ${linienIds}. Wähle, was ein erfahrener Trader einzeichnen würde: nahe am Kurs, mehrfach berührt, deutliche Reaktion, wenig Durchquerungen. Mindestens je eine Marke über und unter dem Kurs, sofern vorhanden.`,
        a.zonen ? '- Zonen: "ids" mit einer ID (deren Band) oder zwei benachbarten N/D-IDs (Bereich dazwischen). Nur wo der Kurs mehrfach reagiert hat. Eine Marke ist entweder Linie oder Zone, nicht beides.' : '- Keine Zonen — der Nutzer möchte nur Linien. Gib "zonen": [] zurück.',
        '- Gewicht: eine Trendlinie mit nur 2 Berührungen ist unbestätigt — höchstens "mittel". "stark" nur bei ≥ 3 Berührungen oder Übereinstimmung zweier Quellen (z. B. N und T, N und V oder N und D nahe beieinander). Nenne die Übereinstimmung im Grund.',
        a.niveaus ? '- Niveaus mit vielen Durchquerungen sind Drehpunkte der Spanne, keine harte Grenze — sag das.' : null,
        a.kanal ? '- Kanäle (K): der Code hat Richtung, Kanten und Muster (Bull-/Bear-Flagge, Seitwärts-Range nach einem Impuls) gemessen und zeichnet sie selbst ein. Eine Seitwärts-Range ist waagerecht: nicht als steigenden oder fallenden Kanal beschreiben. Nicht in "linien" aufführen; im Text als [K1] nennen, wenn der Kanal für die Lage wichtig ist, und beschreiben, was ein Bruch einer Kante bedeuten würde.' : null,
        a.bedingungen ? '- Bedingungen: an eine ID gebunden; "richtung" ueber/unter meint einen Schluss der Zeiteinheit jenseits der Marke; "ziel" (optional) ist die nächste ID in dieser Richtung.' : '- Keine Bedingungen. Gib "bedingungen": [] zurück.',
        mitBild && geprueft.length ? `- Bild: Du bekommst zusätzlich ein Bild des sichtbaren Charts (rechte Achse Preis, untere Achse Zeit; Linien im Bild können eigene Zeichnungen des Nutzers oder eine frühere Vorschau sein — sie sind keine Kandidaten). Prüfe damit jeden ${geprueft.join(' und jede ')} gegen den Augenschein: Richtung, steigend/fallend oder seitwärts, Flagge nach einem Impuls, Berührungen an den Kanten. Widerspricht das Bild der Vermessung klar, trage die ID in "einwaende" ein, mit kurzem Grund, was im Bild zu sehen ist. Eine ID mit Einwand wird nicht gezeichnet — wähle sie nicht und nenne sie nicht im Text. Keinen Einwand aus Vorsicht, nur bei klarem Widerspruch. Preise liest du NICHT aus dem Bild ab; sie kommen aus der Liste.` : null,
        '- Stütze dich NUR auf die Eingabe. Keine Nachrichten, kein Allgemeinwissen über den Coin.',
        `- KEINE Prognose, KEIN Kursziel, KEINE Handelsempfehlung, kein "dürfte", kein "wird steigen/fallen", kein "kaufen/verkaufen".${a.bedingungen ? ' "ziel" ist die nächste Marke, kein Kursziel —' : ''} beschreibe, was ein Bruch bedeuten würde.`,
        `- Höchstens ${MAX_LINIEN} Linien${a.trend ? ` (davon höchstens ${MAX_TRENDS} Trendlinien)` : ''}${a.zonen ? `, ${MAX_ZONEN} Zonen` : ''}${a.bedingungen ? `, ${MAX_BEDINGUNGEN} Bedingungen` : ''}. Lieber wenige gute.`,
        '- Beschriftung "label" höchstens 40 Zeichen, ohne Uhrzeit (der Chart zeigt die Zeit selbst), "grund" höchstens 200 Zeichen. Trendlinien (T) beschriftet der Code selbst.',
        `- ${sprache}`,
    ].filter(Boolean)
    const schema = [
        '{"text": "2–4 Sätze zur Lage, Marken als [ID]",',
        ' "linien": [{"id": "N4", "label": "...", "grund": "...", "gewicht": "stark|mittel|schwach"}],',
        a.zonen ? ' "zonen": [{"ids": ["N3"], "label": "...", "grund": "...", "gewicht": "stark|mittel|schwach"}],' : ' "zonen": [],',
        a.bedingungen ? ' "bedingungen": [{"id": "N4", "richtung": "ueber|unter", "dann": "...", "ziel": "N2"}]' : ' "bedingungen": []',
        mitBild && geprueft.length ? ' ,"einwaende": [{"id": "K1", "grund": "..."}]}' : '}',
    ]
    return `Du bist ein nüchterner technischer Analyst. Der Code hat den Chart bereits vermessen: ${quellen}, dazu Marktstruktur und Spanne. Jede Marke ist an den Kerzen geprüft. Deine Aufgabe: AUSWÄHLEN, GEWICHTEN, ERKLÄREN — nicht vermessen.

Regeln:
${regeln.join('\n')}

Antworte NUR mit JSON:
${schema.join('\n')}`
}

/** Beschriftung einer Trendlinie aus dem Kandidaten (Rolle, Richtung, Berührungen). */
export function trendLabel(k, englisch = false) {
    const ab = k.richtung === 'ab'
    const w = k.rolle === 'widerstand'
    if (englisch) return `${ab ? 'Falling' : 'Rising'} ${w ? 'resistance' : 'support'} (${k.beruehrungen} touches)`
    return `${w ? (ab ? 'Fallender Widerstand' : 'Steigender Widerstand') : (ab ? 'Fallende Unterstützung' : 'Steigende Unterstützung')} (${k.beruehrungen} Berührungen)`
}

const idVon = (x) => String(x ?? '').trim().toUpperCase().replace(/^\[|\]$/g, '')
const ID_RE = /\[([A-Za-z]\d{1,2})\]/g

/**
 * Antwort des Modells auf die Kandidaten abbilden — rein.
 *
 * Das Modell nennt IDs; Preise und Zeiten kommen ausschliesslich aus `paket`.
 * Verworfen wird mit Grund: unbekannte ID, Zone aus einer Trendlinie, zu
 * breite oder nicht benachbarte Zone, Ziel gegen die Richtung, doppelt,
 * zu viele, Prognose/Empfehlung (immer, siehe Kopf Punkt 2). Zahlen im Text, die
 * zu keiner Marke passen, kommen nur in `warnungen` (erst beobachten, dann
 * scharf schalten).
 */
export function pruefeChartAuswahl(json, paket, { auswahl = AUSWAHL_STANDARD, englisch = false, mitBild = false } = {}) {
    const wahl = normAuswahl(auswahl)
    const verworfen = []
    const warnungen = []
    const textOk = (t) => pruefeEinordnung({ text: t }).ok
    const wort = (x, max) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
    // Beschriftungen ohne Uhrzeit: der Chart zeigt Ortszeit, eine Zeit im Label wäre bestenfalls doppelt,
    // schlimmstenfalls UTC („seit 14:45Z" über einem Chart, der 16:45 zeigt — 20.10.2026).
    const ohneZeit = (x) => wort(x, 80).replace(/\s*(?:\b(?:seit|ab|um|von|bis|since|from|at|until)\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:Z\b|UTC\b)?/gi, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const A = paket.atr, kurs = paket.kurs
    const karte = new Map(paket.kandidaten.map((k) => [k.id, k]))
    const nutzerIds = new Set(paket.nutzer.map((u) => u.id))

    // Einwände aus dem Bild (nur mit Bild, nur gegen Kanäle und Trendlinien): diese IDs
    // werden weder gezeichnet noch im Text genannt — ein Satz, der eine nennt, fällt weg.
    const einwaende = []
    const eingewandt = new Set()
    for (const e of mitBild && Array.isArray(json?.einwaende) ? json.einwaende : []) {
        const id = idVon(e?.id)
        const k = karte.get(id)
        if (!k || !EINSPRUCH_QUELLEN.includes(k.quelle) || eingewandt.has(id)) continue
        const grund = wort(String(e?.grund ?? '').replace(ID_RE, '$1'), 200)
        if (grund && !textOk(grund)) continue
        eingewandt.add(id)
        einwaende.push({ id, art: k.quelle, name: k.quelle === 'kanal' ? kanalName(k, englisch) : trendLabel(k, englisch), grund })
    }

    // [ID] → Preis. Unbekannte ID: `null` (der Aufrufer entscheidet, was dann geschieht).
    // Ein Kanal wird nur beim ersten Nennen voll ausgeschrieben (Name, Berührungen, Kanten),
    // danach kurz — vorher stand „Bear-Flagge (3/3 Berührungen) K1 (Kanten jetzt …)" bis zu
    // viermal in einem Absatz (27.10.2026). Über alle Texte einer Antwort hinweg.
    const genannt = new Set()
    const setzeEin = (t) => {
        let unbekannt = false
        const aus = String(t ?? '').replace(ID_RE, (_, id) => {
            const k = karte.get(id.toUpperCase())
            if (k && eingewandt.has(k.id)) { unbekannt = true; return '' }
            if (k?.quelle === 'kanal') {
                if (genannt.has(k.id)) return `${kanalKurz(k, englisch)} ${k.id}`
                genannt.add(k.id)
                return `${kanalName(k, englisch)} ${k.id} (${englisch ? 'edges now' : 'Kanten jetzt'} ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)})`
            }
            if (k) return k.quelle === 'trend' ? `Trendlinie ${k.id} (jetzt ${zahl(k.wertJetzt)})` : `${zahl(k.preis)} (${k.id})`
            if (nutzerIds.has(id.toUpperCase())) return `eigene Linie ${id.toUpperCase()}`
            unbekannt = true
            return ''
        })
        // „die Trendlinie [T1]" → nicht „die Trendlinie Trendlinie T1 (…)"
        // „die Bear-Flagge [K1]" → nicht „die Bear-Flagge Bear-Flagge (…)"
        return unbekannt ? null : aus.replace(/\b(?:Trendlinie|trend ?line)\s+(?=Trendlinie T\d)/gi, '')
            .replace(/(?:\b(?:Bull|Bear|Seitwärts|Sideways)[- ])?(?:Flagge|flag|Kanal|channel|Range|range)\s+(?=(?:Bull|Bear|Aufsteigender|Absteigender|Ascending|Descending|Seitwärts|Sideways)[- ](?:Flagge|flag|Kanal|channel|Range|range)\b[^.]*?\bK\d)/gi, '')
    }
    // Zahlen, die zu keiner Marke passen — protokollieren
    const marken = [...paket.kandidaten.flatMap((k) => (k.quelle === 'trend' ? [k.wertJetzt, k.p1, k.p2] : k.quelle === 'kanal' ? [k.untenJetzt, k.obenJetzt, k.p1, k.p2] : [k.preis, k.tief, k.hoch])),
        ...paket.roh.flatMap((r) => [r.h, r.l]), paket.spanne?.tief, paket.spanne?.hoch].filter(Number.isFinite)
    const pruefeZahlen = (t, wo) => {
        for (const m of String(t).matchAll(/\d[\d'’ ]*(?:[.,]\d+)?/g)) {
            const z = Number(m[0].replace(/['’ ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
            if (!(z > 0.5 * kurs && z < 2 * kurs)) continue
            if (!marken.some((x) => Math.abs(x - z) <= 0.3 * A)) warnungen.push({ wo, zahl: z })
        }
    }

    // Text: ein Satz mit unbekannter ID fällt weg, der Rest bleibt.
    let text = ''
    if (json?.text) {
        const saetze = String(json.text).split(/(?<=[.!?])\s+/).map((x) => setzeEin(x)).filter((x) => x != null)
        text = wort(saetze.join(' '), 1200)
        if (text && !textOk(text)) { verworfen.push({ art: 'text', grund: 'prognose', inhalt: text.slice(0, 120) }); text = '' }
        if (text) pruefeZahlen(text, 'text')
    }
    const gewichtVon = (g) => (['stark', 'mittel', 'schwach'].includes(g) ? g : 'mittel')
    const artNachLage = (preis) => (preis >= kurs ? 'widerstand' : 'unterstuetzung')

    // Zonen zuerst — eine ID als Linie UND Zone: die Zone gewinnt.
    const zonen = []
    const zonenIds = new Set()
    const preisListe = paket.kandidaten.filter((k) => k.quelle === 'niveau' || k.quelle === 'htf').sort((a, b) => a.preis - b.preis)
    for (const z of wahl.zonen && Array.isArray(json?.zonen) ? json.zonen : []) {
        const ids = (Array.isArray(z?.ids) ? z.ids : [z?.id]).map(idVon).filter(Boolean)
        const label = ohneZeit(z?.label)
        const ks = ids.map((id) => karte.get(id))
        if (!ids.length || ids.length > 2 || ks.some((k) => !k)) { verworfen.push({ art: 'zone', grund: 'unbekannteId', inhalt: ids.join('+') || label }); continue }
        if (ks.some((k) => k.quelle === 'trend' || k.quelle === 'kanal')) { verworfen.push({ art: 'zone', grund: 'zoneAusTrend', inhalt: ids.join('+') }); continue }
        if (ks.length === 2) {
            const [a, b] = [...ks].sort((x, y) => x.preis - y.preis)
            const nb = ks.every((k) => k.quelle === 'niveau' || k.quelle === 'htf')
                && !preisListe.some((k) => k.preis > a.preis && k.preis < b.preis && k.id !== a.id && k.id !== b.id)
            if (!nb) { verworfen.push({ art: 'zone', grund: 'nichtBenachbart', inhalt: ids.join('+') }); continue }
            if (b.hoch - a.tief > 2 * A) { verworfen.push({ art: 'zone', grund: 'zoneZuBreit', inhalt: ids.join('+') }); continue }
        }
        if (ids.some((id) => zonenIds.has(id))) continue
        if (zonen.length >= MAX_ZONEN) { verworfen.push({ art: 'zone', grund: 'zuViele', inhalt: ids.join('+') }); continue }
        const grund = setzeEin(z?.grund)
        if (grund == null) { verworfen.push({ art: 'zone', grund: 'unbekannteId', inhalt: label }); continue }
        if (!textOk(`${label}. ${grund}`)) { verworfen.push({ art: 'zone', grund: 'prognose', inhalt: label }); continue }
        pruefeZahlen(grund, `zone ${ids.join('+')}`)
        const tief = Math.min(...ks.map((k) => k.tief)), hoch = Math.max(...ks.map((k) => k.hoch))
        const mitte = (tief + hoch) / 2
        const art = kurs >= tief && kurs <= hoch
            ? (ks[0].rolle === 'widerstand' || ks[0].rolle === 'unterstuetzung' ? ks[0].rolle : artNachLage(mitte))
            : artNachLage(mitte)
        ids.forEach((id) => zonenIds.add(id))
        zonen.push({ art, tief, hoch, label: label || ids.join('+'), grund: wort(grund, 200), gewicht: gewichtVon(z?.gewicht), ids, vonT: Math.min(...ks.map((k) => k.t1 ?? paket.vonT)) })
    }

    const linien = []
    for (const l of Array.isArray(json?.linien) ? json.linien : []) {
        const id = idVon(l?.id)
        const k = karte.get(id)
        // Trendlinien beschriftet der Code: Rolle, Richtung und die GEMESSENE Zahl der Berührungen —
        // das Modell schrieb „3 Berührungen", wo zwei davon dieselbe Welle waren.
        const label = k?.quelle === 'trend' ? trendLabel(k, englisch) : ohneZeit(l?.label)
        if (!k) { verworfen.push({ art: 'linie', grund: 'unbekannteId', inhalt: id || label }); continue }
        if (k.quelle === 'kanal') continue     // Kanäle zeichnet der Code selbst (unten)
        if (eingewandt.has(id)) { verworfen.push({ art: 'linie', grund: 'bildEinwand', inhalt: id }); continue }
        if (linien.some((x) => x.id === id)) continue
        if (zonenIds.has(id)) { verworfen.push({ art: 'linie', grund: 'doppelt', inhalt: id }); continue }
        const trend = k.quelle === 'trend'
        if (!trend && linien.some((x) => x.quelle !== 'trend' && Math.abs(x.p1 - k.preis) < KAND.DECKT_ATR * A)) { verworfen.push({ art: 'linie', grund: 'doppelt', inhalt: id }); continue }
        if (linien.length >= MAX_LINIEN || (trend && linien.filter((x) => x.quelle === 'trend').length >= MAX_TRENDS)) { verworfen.push({ art: 'linie', grund: 'zuViele', inhalt: id }); continue }
        const grund = setzeEin(l?.grund)
        if (grund == null) { verworfen.push({ art: 'linie', grund: 'unbekannteId', inhalt: label || id }); continue }
        if (!textOk(`${label}. ${grund}`)) { verworfen.push({ art: 'linie', grund: 'prognose', inhalt: label || id }); continue }
        pruefeZahlen(grund, `linie ${id}`)
        // Eine Trendlinie mit zwei Berührungen ist unbestätigt (zwei Punkte ergeben immer eine Gerade).
        const gewicht = trend && k.beruehrungen < 3 && gewichtVon(l?.gewicht) === 'stark' ? 'mittel' : gewichtVon(l?.gewicht)
        const basis = { id, quelle: k.quelle, label: label || id, grund: wort(grund, 200), gewicht }
        if (trend) linien.push({ ...basis, art: 'trend', rolle: k.rolle, beruehrungen: k.beruehrungen, t1: k.t1, p1: k.p1, t2: k.t2, p2: k.p2, ...(Number.isFinite(k.tEnde) ? { tEnde: k.tEnde, pEnde: k.pEnde } : {}) })
        else linien.push({ ...basis, art: artNachLage(k.preis), t1: k.t1 ?? paket.vonT, p1: k.preis, t2: paket.bisT, p2: k.preis, ...(k.abschnitt ? { abschnitt: k.abschnitt, profilBis: k.t2 } : {}) })
    }

    // Kanäle und Flaggen zeichnet der Code ein, nicht das Modell: Kanten, Richtung und
    // Muster sind gemessen, der Name kommt aus `kanalName`. Zählen nicht gegen MAX_LINIEN.
    if (wahl.kanal) {
        for (const k of paket.kandidaten.filter((x) => x.quelle === 'kanal' && !eingewandt.has(x.id))) {
            const stange = k.stangeAtr ? (englisch
                ? `, flagpole ${k.stangeAtr.toFixed(1)} ATR in ${k.stangeKerzen} candles, retraced ${Math.round(k.ruecklaufPct)} %`
                : `, Fahnenstange ${k.stangeAtr.toFixed(1)} ATR in ${k.stangeKerzen} Kerzen, davon ${Math.round(k.ruecklaufPct)} % zurückgeholt`) : ''
            const grund = englisch
                ? `Measured: width ${k.breiteAtr.toFixed(1)} ATR over ${k.laenge} candles${stange}; edges now ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
                : `Gemessen: Breite ${k.breiteAtr.toFixed(1)} ATR über ${k.laenge} Kerzen${stange}; Kanten jetzt ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
            linien.push({
                id: k.id, quelle: 'kanal', art: 'kanal', label: kanalName(k, englisch), labelKurz: kanalBeschriftung(k, englisch), grund, gewicht: k.muster ? 'stark' : 'mittel',
                muster: k.muster, richtung: k.richtung, breite: k.breite,
                t1: k.t1, p1: k.p1, t2: k.t2, p2: k.p2, tEnde: k.tEnde, pEnde: k.pEnde,
            })
        }
    }

    const bedingungen = []
    const iv = paket.interval || ''
    for (const b of wahl.bedingungen && Array.isArray(json?.bedingungen) ? json.bedingungen : []) {
        const id = idVon(b?.id)
        const k = karte.get(id)
        if (!k) { verworfen.push({ art: 'bedingung', grund: 'unbekannteId', inhalt: id }); continue }
        if (eingewandt.has(id) || eingewandt.has(idVon(b?.ziel))) { verworfen.push({ art: 'bedingung', grund: 'bildEinwand', inhalt: id }); continue }
        const richtung = b?.richtung === 'unter' ? 'unter' : b?.richtung === 'ueber' ? 'ueber' : null
        if (!richtung) { verworfen.push({ art: 'bedingung', grund: 'richtung', inhalt: id }); continue }
        const schwelle = preisVon(k)
        let zielId = null
        if (b?.ziel) {
            zielId = idVon(b.ziel)
            const z = karte.get(zielId)
            if (!z) { verworfen.push({ art: 'bedingung', grund: 'unbekannteId', inhalt: zielId }); continue }
            const zp = preisVon(z)
            if (richtung === 'ueber' ? !(zp > schwelle) : !(zp < schwelle)) { verworfen.push({ art: 'bedingung', grund: 'zielGegenRichtung', inhalt: `${id}→${zielId}` }); continue }
        }
        if (bedingungen.length >= MAX_BEDINGUNGEN) { verworfen.push({ art: 'bedingung', grund: 'zuViele', inhalt: id }); continue }
        const dann = setzeEin(b?.dann)
        if (dann == null || !wort(dann, 200)) { verworfen.push({ art: 'bedingung', grund: 'unbekannteId', inhalt: id }); continue }
        // Den „wenn"-Teil baut der Code — mit der Zahl, an die die Bedingung gebunden ist.
        const seiteJetzt = kurs >= schwelle ? 'ueber' : 'unter'
        const marke = `${zahl(schwelle)} (${id}${k.quelle === 'trend' ? ', Trendlinie' : ''})`
        const wenn = seiteJetzt === richtung
            ? `solange ${iv}-Schlüsse ${richtung === 'ueber' ? 'über' : 'unter'} ${marke} bleiben`
            : `${iv}-Schluss ${richtung === 'ueber' ? 'über' : 'unter'} ${marke}`
        if (!textOk(`Wenn ${wenn}, dann ${dann}.`)) { verworfen.push({ art: 'bedingung', grund: 'prognose', inhalt: id }); continue }
        pruefeZahlen(dann, `bedingung ${id}`)
        bedingungen.push({ wenn, dann: wort(dann, 200), id, richtung, schwelle, zielId })
    }

    const leer = !text && !linien.length && !zonen.length && !bedingungen.length
    return { text, linien, zonen, bedingungen, verworfen, warnungen, leer, einwaende }
}

/** Kompakte Kandidatenliste für den Reiter (was zur Wahl stand). */
export function kandidatenKurz(paket) {
    if (!paket) return null
    return {
        kurs: paket.kurs, atr: paket.atr, intervalHtf: paket.intervalHtf, spanne: paket.spanne, struktur: paket.struktur,
        kandidaten: paket.kandidaten.slice(0, 24).map((k) => ({
            id: k.id, quelle: k.quelle, name: k.name || null,
            preis: k.quelle === 'trend' ? null : k.preis, tief: k.tief ?? null, hoch: k.hoch ?? null,
            t1: k.t1 ?? null, p1: k.p1 ?? null, t2: k.t2 ?? null, p2: k.p2 ?? null, wertJetzt: k.wertJetzt ?? null,
            tEnde: k.tEnde ?? null, pEnde: k.pEnde ?? null, beruehrT: k.beruehrT ?? null, gegen: k.gegen ?? null,
            beruehrungen: k.beruehrungen ?? null, durchquerungen: k.durchquerungen ?? null, letzteT: k.letzteT ?? null,
            abstandAtr: k.abstandAtr ?? null, rolle: k.rolle ?? null, deckt: k.deckt ?? null, abschnitt: k.abschnitt ?? null, bereich: k.bereich ?? null,
            breite: k.breite ?? null, muster: k.muster ?? null, richtung: k.richtung ?? null,
        })),
    }
}

// ── Erzeugen ─────────────────────────────────────────────────────────────
const cache = new Map()      // `${symbol}|${interval}` → { ts, payload }
const laufend = new Map()

/*
 * Schlüssel mit Markt: Spot und Perpetual haben andere Kerzen — eine geteilte
 * Ablage zeigte die Spot-Analyse im Futures-Panel, und die 45-s-Sperre gab der
 * Futures-Anfrage das Spot-Ergebnis.
 */
const schluesselVon = (symbol, interval, markt) => `${symbol}|${interval}|${markt === 'spot' ? 'spot' : 'futures'}`
// Fehlschläge sperren ebenfalls — die Antwort war bezahlt, ein sofortiger zweiter Klick bezahlte erneut.
const fehlschlaege = new Map()   // schluessel → { ts, meldung }

export function letzteChartAnalyse(symbol, interval, markt = 'futures') {
    const e = cache.get(schluesselVon(symbol, interval, markt))
    if (!e || Date.now() - e.ts > TTL_MS) return null
    return { ...e.payload, stand: e.ts, alterMs: Date.now() - e.ts }
}

/**
 * Alles, was die KI über einen Chart liest — für die Analyse und für den
 * KI-Chat (Tool `query_chart`), damit beide dieselben Daten sehen.
 * @param {{ symbol, interval, markt?, anzahl?, bisT? }} p  `bisT`: nur Kerzen bis dahin (sichtbarer Bereich)
 */
export async function ladeChartDaten({ symbol, interval, markt = 'futures', anzahl = KERZEN, bisT = null }) {
    let kerzen = await getClosedCandles(symbol, interval, Math.min(1000, anzahl + (bisT ? 500 : 0)), { market: markt })
    if (bisT) kerzen = kerzen.filter((k) => k.t <= bisT)
    kerzen = kerzen.slice(-anzahl)
    const vonT = kerzen[0]?.t ?? Date.now()
    const knex = getKnex()
    const [zeichnungenRoh, hebel, tagesZeilen, s] = await Promise.all([
        knex('chart_zeichnungen').where('symbol', symbol).catch(() => []),
        markt === 'spot' ? null : holeHebelzonen(symbol).catch(() => null),
        knex('trades').select('dateUnix', 'broker', 'trades')
            .where('dateUnix', '>=', Math.floor(vonT / 1000) - 7 * 86400).catch(() => []),
        knex('settings').select('language', 'timeZone').where('id', 1).first().catch(() => null),
    ])
    const zeichnungen = zeichnungenRoh.map((z) => ({ ...z, punkte: JSON.parse(z.punkte || '[]'), stil: JSON.parse(z.stil || '{}') }))
    const trades = tradesAusZeilen(tagesZeilen, symbol, vonT, Date.now())
    return {
        kerzen, zeichnungen, hebel, trades,
        englisch: s?.language === 'en',
        zeitzone: s?.timeZone || 'UTC',
    }
}

/**
 * Sichtbarer Bereich → Kerzenzahl und rechter Rand. Liegt der rechte Rand hinter der
 * letzten Kerze (Platz rechts im Chart), zählt bis jetzt. Ohne Angabe `KERZEN`.
 */
export function fensterAus(fenster, ivMs, jetzt = Date.now()) {
    const vonT = Number(fenster?.vonT), bisT = Number(fenster?.bisT)
    if (!(ivMs > 0) || !Number.isFinite(vonT) || !Number.isFinite(bisT) || bisT <= vonT) return { anzahl: KERZEN, bisT: null }
    const rechts = Math.min(bisT, jetzt)
    const anzahl = Math.max(KERZEN_MIN, Math.min(KERZEN_MAX, Math.round((rechts - vonT) / ivMs)))
    return { anzahl, bisT: bisT < jetzt - ivMs ? bisT : null }
}

export async function erzeugeChartAnalyse({ symbol, interval, markt = 'futures', auswahl = null, fenster = null, bild = null }) {
    const wahl = normAuswahl(auswahl)
    const fen = fensterAus(fenster, TIMEFRAME_MS[interval])
    if (auswahlLeer(wahl)) { const e = new Error('Mindestens Niveaus, Trendlinien, Volumenprofil oder höhere Zeiteinheit wählen'); e.status = 400; throw e }
    // Anderer Ausschnitt = andere Analyse: die Sperre gilt nur für dieselbe Auswahl UND dasselbe Fenster
    const wahlText = JSON.stringify({ ...wahl, fenster: fen })
    const schluessel = schluesselVon(symbol, interval, markt)
    // Der Cache hält die LETZTE Analyse je Chart; die Sperre greift nur bei gleicher Auswahl —
    // wer ein Kästchen umstellt, will eine andere Analyse, nicht die eben bezahlte.
    const alt = cache.get(schluessel)
    if (alt && Date.now() - alt.ts < SPERRE_MS && JSON.stringify({ ...(alt.payload.optionen || AUSWAHL_STANDARD), fenster: alt.payload.fenster || null }) === wahlText) return { ...alt.payload, stand: alt.ts, alterMs: Date.now() - alt.ts, aus: 'sperre' }
    const laufSchluessel = `${schluessel}|${wahlText}`
    if (laufend.has(laufSchluessel)) return laufend.get(laufSchluessel)
    const fehl = fehlschlaege.get(schluessel)
    if (fehl && Date.now() - fehl.ts < SPERRE_MS) {
        const e = new Error(`${fehl.meldung} — nächster Versuch in ${Math.ceil((SPERRE_MS - (Date.now() - fehl.ts)) / 1000)} s`)
        e.status = 429
        throw e
    }

    const lauf = (async () => {
        const intervalHtf = HTF_VON[interval] || null
        const [{ kerzen, zeichnungen, hebel, trades, englisch, zeitzone }, kerzenHtf] = await Promise.all([
            ladeChartDaten({ symbol, interval, markt, anzahl: fen.anzahl, bisT: fen.bisT }),
            intervalHtf && wahl.htf ? getClosedCandles(symbol, intervalHtf, HTF_KERZEN, { market: markt }).catch(() => null) : null,
        ])
        if (kerzen.length < 30) throw new Error('Zu wenige Kerzen für eine Analyse')
        const vonT = kerzen[0].t
        const bisT = kerzen[kerzen.length - 1].t
        // Der Code vermisst, das Modell wählt aus (chart-kandidaten.js).
        const paket = filterePaket(baueKandidaten({ kerzen, kerzenHtf: wahl.htf ? kerzenHtf : null, interval, intervalHtf, zeichnungen, zeitzone, profilArt: wahl.profilArt }), wahl)
        if (!paket) throw new Error('Zu wenige Kerzen für eine Vermessung')

        const cfg = await ladeLlmConfigFuerAufgabe('chart-analyse')
        // Die bestellte Antwort ist lang (Linien mit Gründen). Nach Textlänge
        // bemessen frisst ein Reasoning-Modell den Deckel und liefert leeren
        // Inhalt bei voller Rechnung — deshalb grosszügig, und bei
        // abgeschnittenem JSON einmal mit doppeltem Deckel.
        cfg.maxTokens = 3000
        // Bildprüfung: nur wenn der Browser ein Bild schickte, der Anbieter Bilder versteht
        // und es überhaupt Geometrie zu prüfen gibt (Kanäle oder Trendlinien im Paket).
        const zuPruefen = paket.kandidaten.some((k) => EINSPRUCH_QUELLEN.includes(k.quelle))
        let bildPruefung = !bild ? 'ohneBild' : !kannBilder(cfg.provider) ? 'anbieterOhneBild' : !zuPruefen ? 'nichtsZuPruefen' : 'an'
        const user = baueChartEingabe({ symbol, interval, paket, hebelzonen: wahl.hebel ? hebel : null, trades })
        const buchung = { zweck: 'chart-analyse', ausloeser: 'manuell', bezug: { typ: 'symbol', id: symbol } }
        const frage = () => {
            const mitBild = bildPruefung === 'an'
            return callLLMJson(cfg, { system: systemText(englisch, wahl, { mitBild }), user, timeoutMs: 90000, anhaenge: mitBild ? [bild] : [], ...buchung })
        }
        let antwort
        try { antwort = await frage() } catch (e) {
            // Ein Modell ohne Bildverständnis (z. B. ein lokales Textmodell unter Ollama) lehnt den
            // Anhang ab — dann einmal ohne Bild, statt die ganze Analyse scheitern zu lassen.
            if (bildPruefung !== 'an') throw e
            logWarn('chart-ki', `${symbol} ${interval}: Bild abgelehnt (${e.message}) — ohne Bild`)
            bildPruefung = 'fehlgeschlagen'
            antwort = await frage()
        }
        // Kosten beider Aufrufe zusammen anzeigen — bei abgeschnittener Antwort wurde der erste auch bezahlt.
        let kosten = antwort.costUsd ?? null
        if (!antwort.json && antwort.abgeschnitten) {
            cfg.maxTokens = 6000
            antwort = await frage()
            if (antwort.costUsd != null) kosten = (kosten ?? 0) + antwort.costUsd
        }
        const ergebnis = pruefeChartAuswahl(antwort.json, paket, { auswahl: wahl, englisch, mitBild: bildPruefung === 'an' })
        for (const e of ergebnis.einwaende) logWarn('chart-ki', `${symbol} ${interval}: Bild widerspricht ${e.id} (${e.name}) — ${e.grund}`)
        for (const v of ergebnis.verworfen) logWarn('chart-ki', `${symbol} ${interval}: ${v.art} verworfen (${v.grund}) — ${v.inhalt}`)
        for (const w of ergebnis.warnungen) logWarn('chart-ki', `${symbol} ${interval}: Zahl ${w.zahl} in ${w.wo} passt zu keiner Marke`)
        if (ergebnis.leer) throw new Error('Die KI hat keine verwertbare Analyse geliefert')

        const payload = {
            symbol, interval, ...ergebnis, kerzenVon: vonT, kerzenBis: bisT, auswahl: kandidatenKurz(paket), optionen: wahl, fenster: fen,
            markt, provider: cfg.provider, model: cfg.model, costUsd: kosten, bildPruefung,
            kiGeneriert: true,
        }
        cache.set(schluessel, { ts: Date.now(), payload })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
        return { ...payload, stand: Date.now(), alterMs: 0, aus: 'neu' }
    })()
    laufend.set(laufSchluessel, lauf)
    try {
        const r = await lauf
        fehlschlaege.delete(schluessel)
        return r
    } catch (e) {
        if (e.status !== 429) fehlschlaege.set(schluessel, { ts: Date.now(), meldung: e.message })
        throw e
    } finally { laufend.delete(laufSchluessel) }
}

export function setupChartKiRoutes(app) {
    app.get('/api/chart/ki-analyse', (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        const interval = String(req.query.interval || '')
        res.set('Cache-Control', 'no-store')
        const markt = req.query.markt === 'spot' ? 'spot' : 'futures'
        res.json(letzteChartAnalyse(symbol, interval, markt) || { leer: true, symbol, interval, markt })
    })

    app.post('/api/chart/ki-analyse', async (req, res) => {
        const symbol = String(req.body?.symbol || '').toUpperCase()
        const interval = String(req.body?.interval || '')
        if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'symbol ungültig' })
        if (!isValidTimeframe(interval)) return res.status(400).json({ error: `Zeiteinheit ${interval} wird nicht unterstützt` })
        try {
            res.json(await erzeugeChartAnalyse({ symbol, interval, markt: req.body?.markt === 'spot' ? 'spot' : 'futures', auswahl: req.body?.auswahl, fenster: req.body?.fenster, bild: pruefeBild(req.body?.bild) }))
        } catch (e) {
            if (sendeWennAus(res, e)) return
            logWarn('chart-ki', `${symbol} ${interval}: ${e.message}`)
            res.status(e.status === 429 || e.status === 400 ? e.status : 502).json({ error: e.message })
        }
    })
}
