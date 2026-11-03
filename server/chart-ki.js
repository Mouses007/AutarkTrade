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
import { zeitzoneAus } from '../shared/zeitzone.js'
import { logWarn } from './logger.js'
import { ladeLlmConfigFuerAufgabe, callLLMJson } from './llm.js'
import { kannBilder } from './ai-models.js'
import { getClosedCandles, getHistoricalCandles, isValidTimeframe, TIMEFRAME_MS } from './market-data.js'
import { holeHebelzonen } from './hebelzonen.js'
import { pruefeEinordnung } from './coin-radar/einordnung.js'
import { tradesAusZeilen } from './chart-journal.js'
import { sendeWennAus, istAus } from './quellen/aus.js'
import { ohneUnsichtbares } from '../shared/unsichtbar.js'
import { uebergeordneterTrend, htfTrendKandidaten, htfTrendLabel, htfTrendZeile, HTF_TREND_KERZEN } from './chart-htf-trend.js'
import { baueKandidaten, kandidatenText, HTF_VON, KAND, zahl, preisVon, zeitText, kanalName, kanalKurz, kanalBeschriftung, korrekturAbstand, PROFIL_ARTEN_ALLE, waehleNutzer } from './chart-kandidaten.js'
import { dreieckName, dreieckKurz, dreieckBeschriftung } from './chart-dreiecke.js'
import { umkehrName, umkehrKurz, umkehrBeschriftung } from './chart-umkehr.js'

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
const MAX_TRENDS = 3
const MAX_ZONEN = 3
const MAX_BEDINGUNGEN = 4
const HTF_KERZEN = 120
// Bild des Charts: JPEG oder PNG, base64 höchstens ~2,2 MB (der Browser schickt ~1280 px JPEG, typisch 150–300 kB)
const BILD_MAX_ZEICHEN = 3_000_000
const BILD_TYPEN = ['image/jpeg', 'image/png']
// Einspruch nur gegen gemessene GEOMETRIE — Niveaus sind gezählte Berührungen, da sieht das Bild nicht mehr
const EINSPRUCH_QUELLEN = ['kanal', 'trend', 'dreieck', 'umkehr']

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
export function baueChartEingabe({ symbol, interval, kerzen, kerzenHtf = null, zeichnungen = [], hebelzonen = null, trades = [], paket = null, zeitzone = 'UTC', modus = 'setzen', ergaenzen = false, htfTrend = null, englisch = false }) {
    const eigene = modus === 'eigene'
    const pk = paket || baueKandidaten({ kerzen, kerzenHtf, interval, intervalHtf: HTF_VON[interval] || null, zeichnungen, zeitzone })
    const tz = pk?.zeitzone || zeitzone
    const zeit = (ms) => zeitText(ms, tz)
    const zeilen = [`SYMBOL: ${symbol}`, `ZEITEINHEIT: ${interval}`, `JETZT: ${zeit(Date.now())}`, '']
    if (pk) zeilen.push(kandidatenText(pk, { eigene, mitKandidaten: !eigene || ergaenzen }))
    else zeilen.push('Zu wenige Kerzen für eine Vermessung.')
    if (htfTrend && pk) zeilen.push('', htfTrendZeile(htfTrend, pk.kurs, englisch))
    // Bei „Meine Zeichnungen" geht es um die Zeichnungen — die Liquidationsschätzung lenkt nur ab
    if (!eigene && hebelzonen && (hebelzonen.oben?.length || hebelzonen.unten?.length)) {
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
 * Zwei Arten der Analyse (31.10.2026 — die Kästchen sind weg, der Code baut
 * immer alle Kandidaten):
 *   setzen   „KI-Zeichnungen setzen": das Modell wählt nur, was für ein Setup
 *            JETZT zählt — höchstens `MAX_ZEICHNUNGEN`, gern weniger, auch keine.
 *   eigene   „Meine Zeichnungen analysieren": der Code hat die eigenen Zeichnungen
 *            gemessen (U…), das Modell bewertet sie und — mit `ergaenzen` —
 *            schlägt Korrekturen und höchstens `MAX_FEHLEND` fehlende Marken vor.
 * Bedingungen und Liquidationszonen sind in beiden dabei.
 */
export const MODI = ['setzen', 'eigene']
export const MAX_ZEICHNUNGEN = 6
export const MAX_FEHLEND = 4
const WICHTIG = ['hoch', 'mittel', 'gering']

export function normModus(roh) {
    const modus = MODI.includes(roh?.modus) ? roh.modus : 'setzen'
    return { modus, ergaenzen: modus === 'eigene' ? roh?.ergaenzen !== false : false, htf: roh?.htf === true }
}

/**
 * „Meine Zeichnungen analysieren" (umgebaut 01.11.2026): das Thema sind die
 * Zeichnungen des Nutzers, nicht der Chart. Vorher schrieb das Modell seine
 * eigene Analyse mit den Kandidaten des Codes und hängte die Zeichnungen als
 * Randnotiz an; jetzt bekommt es die Kandidaten nur zum Korrigieren/Ergänzen,
 * Text und Bedingungen dürfen nur U-IDs nennen (`pruefeChartAuswahl` setzt das
 * durch), und es soll sagen, wo eine Zeichnung falsch oder unlogisch ist.
 */
function systemTextEigene(englisch, { mitBild = false, ergaenzen = true } = {}) {
    const sprache = englisch ? 'Write all texts in English.' : 'Schreibe alle Texte auf Deutsch.'
    const regeln = [
        '- THEMA sind die Zeichnungen des Nutzers (U…). Analysiere SIE: was jede einzelne aussagt, ob sie an den Kerzen stimmt, wie sie zusammenspielen und was sie gemeinsam über die Lage sagen. Keine eigene Chart-Analyse daneben.',
        '- Im Text und in den Bedingungen nennst du NUR U-IDs, als [U1] usw.; der Code setzt Name und Preis ein. Schreibe keine eigenen Kurszahlen. Ein Satz mit einer anderen ID wird verworfen.',
        '- Lies die Zeichnungen ZUSAMMEN: die Leiter der eigenen Marken zeigt, was über und unter dem Kurs liegt; „gleiche Höhe" heisst, zwei Zeichnungen bestätigen einander. Sag, welche Zeichnung die nächste Hürde nach oben und die nächste Auffangmarke nach unten ist.',
        '- Zu einer Zone sag, warum sie dort liegt, wenn die Messung es hergibt (Ursprung: Wendepunkt am linken Rand, Bewegung danach, Rückkehr seither) — nicht nur, ob sie berührt wurde.',
        '- Gebrochene Linien: sag, wann sie gebrochen wurden, ob sie vorher gegolten haben (Berührungen davor) und ob der Kurs sie seither von der anderen Seite getestet hat. „Nie durchschlossen" mit grossem Abstand heisst: weit weg, gerade nicht im Spiel.',
        '- Fehler und Unlogisches: Steht bei einer Zeichnung „AUFFÄLLIG", nimm es ernst und erkläre es in "hinweis" (z. B. Linie schneidet durch Kerzenkörper, Anker nicht an einem Hoch/Tief, Beschriftung passt nicht zur Lage, Zone ohne Wendepunkt, Profil vor den geladenen Kerzen). Auch ein logischer Widerspruch zwischen zwei Zeichnungen gehört dorthin. Erfinde keine Fehler: ohne Befund bleibt "hinweis" leer.',
        '- Bewertungen ("bewertungen"): für JEDE eigene Zeichnung eine — "wichtig" hoch|mittel|gering für die Lage jetzt, "text" ≤ 220 Zeichen: was sie zeigt und ob sie noch gilt, "hinweis" ≤ 200 Zeichen oder leer. Berührungen, Durchquerungen, Bruch und Zustand sind GEMESSEN — übernimm sie, zähle nicht selbst.',
        '- Bedingungen: an eine U-ID gebunden ("id": "U3"). "richtung" ueber/unter meint einen Schluss der Zeiteinheit jenseits der Zeichnung — bei einer Zone/einem Profil/Kanal die obere Kante (VAH) für ueber, die untere (VAL) für unter. "ziel" (optional) ist die nächste eigene Zeichnung in dieser Richtung.',
        ergaenzen ? `- Korrekturen ("korrekturen"): steht bei einer eigenen Zeichnung ein „nächster Kandidat", und misst der die Marke klar besser (mehr Berührungen, sauberer), dann {"u": "U2", "id": "N3", "grund": "…"}. Nur bei deutlichem Gewinn.` : null,
        ergaenzen ? `- Fehlendes ("fehlend"): höchstens ${MAX_FEHLEND} wichtige Marken aus den Kandidaten des Codes, die KEINE eigene Zeichnung abdeckt und die für die Lage zählen (nahe am Kurs, mehrfach berührt). Hier — und nur hier und in "korrekturen" — darfst du Kandidaten-IDs (N, V, T, K, M, R, D) verwenden. Linien: {"id": "N4", "label": "...", "grund": "..."}; Zonen: {"ids": ["N3"], …}; Kanäle/Dreiecke/Umkehrmuster in "muster".` : '- Keine Korrekturen, keine neuen Marken: "korrekturen": [] und "fehlend": {}.',
        mitBild ? '- Bild: Du bekommst ein Bild des sichtbaren Charts mit den Zeichnungen. Nutze es, um die Zeichnungen zu verstehen (wo sie liegen, wie sie zum Kursverlauf stehen). Preise liest du NICHT aus dem Bild ab.' : null,
        '- Stütze dich NUR auf die Eingabe. Keine Nachrichten, kein Allgemeinwissen über den Coin.',
        '- KEINE Prognose, KEIN Kursziel, KEINE Handelsempfehlung, kein "dürfte", kein "wird steigen/fallen", kein "kaufen/verkaufen". Beschreibe, was ein Schluss jenseits einer Zeichnung bedeuten würde.',
        `- Höchstens ${MAX_BEDINGUNGEN} Bedingungen.`,
        `- ${sprache}`,
    ].filter(Boolean)
    const zeichnungen = '"linien": [{"id": "N4", "label": "...", "grund": "...", "gewicht": "stark|mittel|schwach"}], "zonen": [{"ids": ["N3"], "label": "...", "grund": "..."}], "muster": [{"id": "K1", "grund": "..."}]'
    const schema = [
        '{"text": "3–5 Sätze: was die Zeichnungen zusammen zeigen, nur [U…]",',
        ' "bewertungen": [{"u": "U1", "wichtig": "hoch|mittel|gering", "text": "...", "hinweis": ""}],',
        ' "bedingungen": [{"id": "U1", "richtung": "ueber|unter", "dann": "...", "ziel": "U2"}],',
        ergaenzen ? ' "korrekturen": [{"u": "U2", "id": "N3", "grund": "..."}],' : ' "korrekturen": [],',
        ergaenzen ? ` "fehlend": {${zeichnungen}}}` : ' "fehlend": {}}',
    ]
    return `Du bist ein nüchterner technischer Analyst und prüfst die Chart-Zeichnungen eines Traders. Der Code hat jede seiner Zeichnungen (U…) an den Kerzen gemessen. Deine Aufgabe: SEINE Zeichnungen analysieren — einzeln und zusammen — und ehrlich sagen, wo eine Zeichnung nicht stimmt.

Regeln:
${regeln.join('\n')}

Antworte NUR mit JSON:
${schema.join('\n')}`
}

export function systemText(englisch, { mitBild = false, modus = 'setzen', ergaenzen = true } = {}) {
    if (modus === 'eigene') return systemTextEigene(englisch, { mitBild, ergaenzen })
    const sprache = englisch ? 'Write all texts in English.' : 'Schreibe alle Texte auf Deutsch.'
    const regeln = [
        '- Verwende NUR IDs aus der Liste. Erfinde keine Preise, keine Zeiten, keine Linien. Eine Marke, die nicht in der Liste steht, gibt es nicht.',
        '- U-IDs (eigene Zeichnungen des Nutzers) darfst du nur im Text erwähnen, nicht auswählen.',
        '- Im Text, in "grund" und "dann" schreibst du Marken als [ID] (z. B. [N4], [T1], [U2]); der Code setzt den Preis ein. Schreibe keine eigenen Kurszahlen.',
        `- Auswahl in ZWEI Schichten — der Nutzer sieht das GANZE Fenster (siehe GANZES FENSTER und GROSSE WELLEN), nicht nur den rechten Rand:`,
        `  1. Übergeordnete Struktur: was den Verlauf des ganzen Fensters trägt — die Trendlinie oder der Kanal der grossen Bewegung, ein Niveau mit vielen Berührungen oder Drehpunkt-Rolle, das Profil einer längeren Seitwärtsphase, eine Marke der höheren Zeiteinheit (D). Mindestens EINE solche Zeichnung, wenn die Liste dafür einen Kandidaten hat, auch wenn sie mehrere ATR vom Kurs entfernt liegt; ein Kandidat zählt dazu, wenn er weit links im Fenster beginnt oder eine grosse Welle begrenzt.`,
        `  2. Was JETZT am Kurs zählt: die nächsten Marken darüber und darunter, mehrfach berührt, deutliche Reaktion, wenig Durchquerungen, oder wo zwei Quellen übereinstimmen.`,
        `  Höchstens ${MAX_ZEICHNUNGEN} Zeichnungen insgesamt: jede Linie, Zone und jeder Kanal zählt eins; mehrere V-Marken desselben Profils zählen zusammen eins. Nur kleine Marken am rechten Rand zu wählen, während der Chart links einen grossen Trend oder Absturz zeigt, ist FALSCH. Der Text beginnt mit der übergeordneten Lage des Fensters (Richtung, grosse Bewegung) und kommt dann zum Kurs. Gibt der Chart nichts her, ist eine leere Auswahl richtig — dann sag das im Text.`,
        '- Linien ("linien"): "id" aus N, V, D (waagerecht) oder T (Trendlinie).',
        '- Volumenprofile gibt es je Seitwärtsphase, je Tag und je Woche. Nimm das aussagekräftigste (für die Struktur meist das einer längeren Seitwärtsphase, für den Kurs das, dessen POC/VAH/VAL nahe am Kurs liegen oder sich mit N/D decken), nicht mehrere Arten für dieselbe Aussage.',
        '- Zonen ("zonen"): "ids" mit einer ID (deren Band) oder zwei benachbarten N/D-IDs (Bereich dazwischen). Nur wo der Kurs mehrfach reagiert hat. Eine Marke ist entweder Linie oder Zone, nicht beides.',
        '- Kanäle und Flaggen (K) hat der Code gemessen (Richtung, Kanten, Muster). Wählst du einen, trage ihn in "muster" ein — nicht in "linien". Eine Seitwärts-Range ist waagerecht: nicht als steigenden oder fallenden Kanal beschreiben.',
        '- Dreiecke, Keile und Wimpel (M) hat der Code ebenfalls gemessen (Form, Kanten, Spitze, Berührungen — der Kurs pendelt nachweislich zwischen den Kanten). Auch sie gehören in "muster". Nenne die Form so, wie der Code sie benennt, und beschreibe, was ein Schluss jenseits der oberen bzw. unteren Kante bedeuten würde — ohne Kursziel aus der Dreieckshöhe. Sind die beiden Kanten zugleich als Trendlinien (T) gelistet, wähle das Muster statt der zwei Linien.',
        '- Umkehrmuster (R: Doppeltop/-boden, Kopf-Schulter, inverse Kopf-Schulter) hat der Code aus bestätigten Wendepunkten gemessen, mit Nackenlinie. Auch sie gehören in "muster". Ob die Nackenlinie gebrochen ist, steht im Namen — erst ein Schluss jenseits der Nackenlinie bestätigt das Muster; nicht gebrochen ist es nur eine mögliche Umkehr. Kein Kursziel aus der Musterhöhe. Eine Bedingung darf an der Nackenlinie hängen (die ID des Musters).',
        '- Gewicht: eine Trendlinie mit nur 2 Berührungen ist unbestätigt — höchstens "mittel". "stark" nur bei ≥ 3 Berührungen oder Übereinstimmung zweier Quellen (z. B. N und T, N und V oder N und D nahe beieinander). Nenne die Übereinstimmung im Grund.',
        '- Niveaus mit vielen Durchquerungen sind Drehpunkte der Spanne, keine harte Grenze — sag das.',
        '- Bedingungen: an eine N/V/D/T/K-ID gebunden; "richtung" ueber/unter meint einen Schluss der Zeiteinheit jenseits der Marke — bei einem Kanal (K) jenseits der oberen Kante für ueber, der unteren für unter, nie der Mitte; "ziel" (optional) ist die nächste ID in dieser Richtung.',
        mitBild ? '- Bild: Du bekommst zusätzlich ein Bild des sichtbaren Charts (rechte Achse Preis, untere Achse Zeit; Linien im Bild sind eigene Zeichnungen des Nutzers oder eine frühere Vorschau — sie sind keine Kandidaten). Prüfe damit jeden Kanal (K) und jede Trendlinie (T) gegen den Augenschein: Richtung, steigend/fallend oder seitwärts, Flagge nach einem Impuls, Berührungen an den Kanten. Widerspricht das Bild der Vermessung klar, trage die ID in "einwaende" ein, mit kurzem Grund, was im Bild zu sehen ist. Eine ID mit Einwand wird nicht gezeichnet — wähle sie nicht und nenne sie nicht im Text. Keinen Einwand aus Vorsicht, nur bei klarem Widerspruch. Preise liest du NICHT aus dem Bild ab; sie kommen aus der Liste.' : null,
        '- Stütze dich NUR auf die Eingabe. Keine Nachrichten, kein Allgemeinwissen über den Coin.',
        '- KEINE Prognose, KEIN Kursziel, KEINE Handelsempfehlung, kein "dürfte", kein "wird steigen/fallen", kein "kaufen/verkaufen". "ziel" ist die nächste Marke, kein Kursziel — beschreibe, was ein Bruch bedeuten würde.',
        `- Höchstens ${MAX_TRENDS} Trendlinien, ${MAX_ZONEN} Zonen, ${MAX_BEDINGUNGEN} Bedingungen.`,
        '- Beschriftung "label" höchstens 40 Zeichen, ohne Uhrzeit (der Chart zeigt die Zeit selbst), "grund" höchstens 200 Zeichen. Trendlinien (T) und Kanäle (K) beschriftet der Code selbst.',
        `- ${sprache}`,
    ].filter(Boolean)
    const zeichnungen = [
        '"linien": [{"id": "N4", "label": "...", "grund": "...", "gewicht": "stark|mittel|schwach"}]',
        '"zonen": [{"ids": ["N3"], "label": "...", "grund": "...", "gewicht": "stark|mittel|schwach"}]',
        '"muster": [{"id": "K1", "grund": "..."}]',
    ]
    const schema = [
        '{"text": "2–4 Sätze zur Lage, Marken als [ID]",',
        ...zeichnungen.map((x) => ` ${x},`),
        ' "bedingungen": [{"id": "N4", "richtung": "ueber|unter", "dann": "...", "ziel": "N2"}]',
    ]
    schema.push(mitBild ? ' ,"einwaende": [{"id": "K1", "grund": "..."}]}' : '}')
    const auftrag = 'Der Code hat den Chart bereits vermessen: Niveaus (N…), Volumenprofile (V…), ungebrochene Trendlinien (T…), Kanäle und Flaggen (K…), Marken der höheren Zeiteinheit (D…), dazu Marktstruktur und Spanne. Jede Marke ist an den Kerzen geprüft. Deine Aufgabe: AUSWÄHLEN, GEWICHTEN, ERKLÄREN — nicht vermessen.'
    return `Du bist ein nüchterner technischer Analyst. ${auftrag}

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

/**
 * Preis, an dem eine Bedingung an einer eigenen Zeichnung hängt: Linien ihr
 * Wert jetzt, Zone/Kanal/Profil die Kante in der Richtung (über → obere, unter → untere).
 */
export function uSchwelle(u, richtung) {
    const oben = richtung !== 'unter'
    if (u.typ === 'rechteck') return oben ? u.hoch : u.tief
    if (u.typ === 'kanal') return oben ? u.obenJetzt : u.untenJetzt
    if (u.typ === 'volprofil') return oben ? u.vah : u.val
    return u.jetzt ?? u.preis ?? null
}

// Ohne unsichtbare Zeichen: ein Nullbreite-Zeichen in „U1" (Grok-Wasserzeichen?) machte die ID unbekannt
const idVon = (x) => ohneUnsichtbares(x).trim().toUpperCase().replace(/^\[|\]$/g, '')
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
export function pruefeChartAuswahl(json, paket, { englisch = false, mitBild = false, modus: modusRoh = 'setzen', ergaenzen: ergaenzenRoh = true } = {}) {
    const { modus, ergaenzen } = normModus({ modus: modusRoh, ergaenzen: ergaenzenRoh })
    const eigene = modus === 'eigene'
    // Woher die Zeichnungen kommen: bei „setzen" die Antwort selbst, bei „eigene" nur `fehlend` (mit Ergänzen)
    const quelle = !eigene ? (json || {}) : ergaenzen && json?.fehlend && typeof json.fehlend === 'object' ? json.fehlend : {}
    const MAX = eigene ? MAX_FEHLEND : MAX_ZEICHNUNGEN
    // Zeichnungen zählen gemeinsam: Linie, Zone, Kanal je eins, ein Profil eins (egal wie viele V-Marken)
    const belegt = new Set()
    const voll = (schl) => !belegt.has(schl) && belegt.size >= MAX
    const schluesselVon = (k) => (k?.quelle === 'volumenprofil' ? `vp:${k.abschnitt}` : k?.id)
    const verworfen = []
    const warnungen = []
    const textOk = (t) => pruefeEinordnung({ text: t }).ok
    const wort = (x, max) => ohneUnsichtbares(x).replace(/\s+/g, ' ').trim().slice(0, max)
    // Beschriftungen ohne Uhrzeit: der Chart zeigt Ortszeit, eine Zeit im Label wäre bestenfalls doppelt,
    // schlimmstenfalls UTC („seit 14:45Z" über einem Chart, der 16:45 zeigt — 20.10.2026).
    const ohneZeit = (x) => wort(x, 80).replace(/\s*(?:\b(?:seit|ab|um|von|bis|since|from|at|until)\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:Z\b|UTC\b)?/gi, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const A = paket.atr, kurs = paket.kurs
    const karte = new Map(paket.kandidaten.map((k) => [k.id, k]))
    const nutzerMap = new Map(paket.nutzer.map((u) => [u.id, u]))

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
        einwaende.push({ id, art: k.quelle, name: k.quelle === 'kanal' ? kanalName(k, englisch) : k.quelle === 'dreieck' ? dreieckName(k, englisch) : k.quelle === 'umkehr' ? umkehrName(k, englisch) : trendLabel(k, englisch), grund })
    }

    // [ID] → Preis. Unbekannte ID: `null` (der Aufrufer entscheidet, was dann geschieht).
    // Ein Kanal wird nur beim ersten Nennen voll ausgeschrieben (Name, Berührungen, Kanten),
    // danach kurz — vorher stand „Bear-Flagge (3/3 Berührungen) K1 (Kanten jetzt …)" bis zu
    // viermal in einem Absatz (27.10.2026). Über alle Texte einer Antwort hinweg.
    const genannt = new Set()
    // `nurU`: bei „Meine Zeichnungen" dürfen Text, Bewertungen und Bedingungen nur eigene Zeichnungen nennen
    const setzeEin = (t, { nurU = false } = {}) => {
        let unbekannt = false
        // Erst unsichtbare Zeichen weg — „[U1]" mit Nullbreite-Zeichen darin passte sonst nicht auf ID_RE und blieb wörtlich stehen
        const aus = ohneUnsichtbares(t).replace(ID_RE, (_, id) => {
            if (nurU && !/^U\d/i.test(id)) { unbekannt = true; return '' }
            const k = karte.get(id.toUpperCase())
            if (k && eingewandt.has(k.id)) { unbekannt = true; return '' }
            if (k?.quelle === 'dreieck') {
                if (genannt.has(k.id)) return `${dreieckKurz(k, englisch)} ${k.id}`
                genannt.add(k.id)
                return `${dreieckName(k, englisch)} ${k.id} (${englisch ? 'edges now' : 'Kanten jetzt'} ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)})`
            }
            if (k?.quelle === 'umkehr') {
                if (genannt.has(k.id)) return `${umkehrKurz(k, englisch)} ${k.id}`
                genannt.add(k.id)
                return `${umkehrName(k, englisch)} ${k.id} (${englisch ? 'neckline now' : 'Nackenlinie jetzt'} ${zahl(k.nackenJetzt)})`
            }
            if (k?.quelle === 'kanal') {
                if (genannt.has(k.id)) return `${kanalKurz(k, englisch)} ${k.id}`
                genannt.add(k.id)
                return `${kanalName(k, englisch)} ${k.id} (${englisch ? 'edges now' : 'Kanten jetzt'} ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)})`
            }
            if (k) return k.quelle === 'trend' ? `Trendlinie ${k.id} (jetzt ${zahl(k.wertJetzt)})` : `${zahl(k.preis)} (${k.id})`
            const u = nutzerMap.get(id.toUpperCase())
            if (u) return `${u.name} (${u.id})`
            unbekannt = true
            return ''
        })
            // „die Zone [U3]" → nicht „die Zone Zone 74910–75600 (U3)"; „Unterstützungslinie Trendlinie T1" → „Unterstützungslinie T1"
            .replace(/(^|[^\p{L}])(\p{L}+)\s+(?=\2\b[^()]*\(U\d+\))/giu, '$1')
            .replace(/(\p{L}*linie)\s+Trendlinie\s+(?=T\d)/giu, '$1 ')
        // „die Trendlinie [T1]" → nicht „die Trendlinie Trendlinie T1 (…)"
        // „die Bear-Flagge [K1]" → nicht „die Bear-Flagge Bear-Flagge (…)"
        return unbekannt ? null : aus.replace(/\b(?:Trendlinie|trend ?line)\s+(?=Trendlinie T\d)/gi, '')
            .replace(/(?:\b(?:Bull|Bear|Seitwärts|Sideways)[- ])?(?:Flagge|flag|Kanal|channel|Range|range)\s+(?=(?:Bull|Bear|Aufsteigender|Absteigender|Ascending|Descending|Seitwärts|Sideways)[- ](?:Flagge|flag|Kanal|channel|Range|range)\b[^.]*?\bK\d)/gi, '')
            // „das symmetrische Dreieck [M1]" → nicht „das symmetrische Dreieck Symmetrisches Dreieck (…)"
            .replace(/(?:\b(?:symmetrische[sn]?|aufsteigende[sn]?|absteigende[sn]?|steigende[rn]?|fallende[rn]?|symmetrical|ascending|descending|rising|falling)\s+)?(?:Dreieck|Keil|triangle|wedge)\s+(?=(?:Symmetrisches|Aufsteigendes|Absteigendes|Steigender|Fallender|Symmetrical|Ascending|Descending|Rising|Falling) (?:Dreieck|Keil|triangle|wedge)\b[^.]*?\bM\d)/gi, '')
    }
    // Zahlen, die zu keiner Marke passen — protokollieren
    const marken = [...paket.kandidaten.flatMap((k) => (k.quelle === 'trend' ? [k.wertJetzt, k.p1, k.p2] : k.quelle === 'kanal' ? [k.untenJetzt, k.obenJetzt, k.p1, k.p2]
        : k.quelle === 'dreieck' ? [k.untenJetzt, k.obenJetzt, k.obenA, k.untenA, k.spitzeP]
        : k.quelle === 'umkehr' ? [k.nackenJetzt, k.nacken.p1, k.nacken.p2, ...k.punkte.map((p) => p.p)] : [k.preis, k.tief, k.hoch])),
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
        const saetze = ohneUnsichtbares(json.text).split(/(?<=[.!?])\s+/).map((x) => {
            const t = setzeEin(x, { nurU: eigene })
            if (t == null && eigene) verworfen.push({ art: 'text', grund: 'fremdeId', inhalt: x.slice(0, 120) })
            return t
        }).filter((x) => x != null)
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
    for (const z of Array.isArray(quelle.zonen) ? quelle.zonen : []) {
        const ids = (Array.isArray(z?.ids) ? z.ids : [z?.id]).map(idVon).filter(Boolean)
        const label = ohneZeit(z?.label)
        const ks = ids.map((id) => karte.get(id))
        if (!ids.length || ids.length > 2 || ks.some((k) => !k)) { verworfen.push({ art: 'zone', grund: 'unbekannteId', inhalt: ids.join('+') || label }); continue }
        if (ks.some((k) => k.quelle === 'trend' || k.quelle === 'kanal' || k.quelle === 'dreieck' || k.quelle === 'umkehr')) { verworfen.push({ art: 'zone', grund: 'zoneAusTrend', inhalt: ids.join('+') }); continue }
        if (ks.length === 2) {
            const [a, b] = [...ks].sort((x, y) => x.preis - y.preis)
            const nb = ks.every((k) => k.quelle === 'niveau' || k.quelle === 'htf')
                && !preisListe.some((k) => k.preis > a.preis && k.preis < b.preis && k.id !== a.id && k.id !== b.id)
            if (!nb) { verworfen.push({ art: 'zone', grund: 'nichtBenachbart', inhalt: ids.join('+') }); continue }
            if (b.hoch - a.tief > 2 * A) { verworfen.push({ art: 'zone', grund: 'zoneZuBreit', inhalt: ids.join('+') }); continue }
        }
        if (ids.some((id) => zonenIds.has(id))) continue
        const zv = ks.find((k) => k.quelle === 'volumenprofil')
        const zSchl = zv ? schluesselVon(zv) : `z:${ids.join('+')}`
        if (zonen.length >= MAX_ZONEN || voll(zSchl)) { verworfen.push({ art: 'zone', grund: 'zuViele', inhalt: ids.join('+') }); continue }
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
        belegt.add(zSchl)
        zonen.push({ art, tief, hoch, label: label || ids.join('+'), grund: wort(grund, 200), gewicht: gewichtVon(z?.gewicht), ids, vonT: Math.min(...ks.map((k) => k.t1 ?? paket.vonT)) })
    }

    const linien = []
    const musterWahl = Array.isArray(quelle.muster) ? [...quelle.muster] : []
    for (const l of Array.isArray(quelle.linien) ? quelle.linien : []) {
        const id = idVon(l?.id)
        const k = karte.get(id)
        // Trendlinien beschriftet der Code: Rolle, Richtung und die GEMESSENE Zahl der Berührungen —
        // das Modell schrieb „3 Berührungen", wo zwei davon dieselbe Welle waren.
        const label = k?.quelle === 'trend' ? trendLabel(k, englisch) : ohneZeit(l?.label)
        if (!k) { verworfen.push({ art: 'linie', grund: 'unbekannteId', inhalt: id || label }); continue }
        if (k.quelle === 'kanal' || k.quelle === 'dreieck' || k.quelle === 'umkehr') { musterWahl.push(l); continue }     // gehört zu den Mustern (unten)
        if (eingewandt.has(id)) { verworfen.push({ art: 'linie', grund: 'bildEinwand', inhalt: id }); continue }
        if (linien.some((x) => x.id === id)) continue
        if (zonenIds.has(id)) { verworfen.push({ art: 'linie', grund: 'doppelt', inhalt: id }); continue }
        const trend = k.quelle === 'trend'
        if (!trend && linien.some((x) => x.quelle !== 'trend' && Math.abs(x.p1 - k.preis) < KAND.DECKT_ATR * A)) { verworfen.push({ art: 'linie', grund: 'doppelt', inhalt: id }); continue }
        if (voll(schluesselVon(k)) || (trend && linien.filter((x) => x.quelle === 'trend').length >= MAX_TRENDS)) { verworfen.push({ art: 'linie', grund: 'zuViele', inhalt: id }); continue }
        const grund = setzeEin(l?.grund)
        if (grund == null) { verworfen.push({ art: 'linie', grund: 'unbekannteId', inhalt: label || id }); continue }
        if (!textOk(`${label}. ${grund}`)) { verworfen.push({ art: 'linie', grund: 'prognose', inhalt: label || id }); continue }
        pruefeZahlen(grund, `linie ${id}`)
        // Eine Trendlinie mit zwei Berührungen ist unbestätigt (zwei Punkte ergeben immer eine Gerade).
        const gewicht = trend && k.beruehrungen < 3 && gewichtVon(l?.gewicht) === 'stark' ? 'mittel' : gewichtVon(l?.gewicht)
        belegt.add(schluesselVon(k))
        const basis = { id, quelle: k.quelle, label: label || id, grund: wort(grund, 200), gewicht }
        if (trend) linien.push({ ...basis, art: 'trend', rolle: k.rolle, beruehrungen: k.beruehrungen, t1: k.t1, p1: k.p1, t2: k.t2, p2: k.p2, ...(Number.isFinite(k.tEnde) ? { tEnde: k.tEnde, pEnde: k.pEnde } : {}) })
        else linien.push({ ...basis, art: artNachLage(k.preis), t1: k.t1 ?? paket.vonT, p1: k.preis, t2: paket.bisT, p2: k.preis, ...(k.abschnitt ? { abschnitt: k.abschnitt, profilBis: k.t2 } : {}) })
    }

    // Kanäle und Flaggen: gemessen vom Code (Kanten, Richtung, Muster, Name aus `kanalName`),
    // gezeichnet nur, wenn das Modell sie wählt (bis 31.10.2026 kamen sie immer dazu).
    const kanalIds = new Set()
    for (const m of musterWahl) {
        const id = idVon(m?.id)
        const k = karte.get(id)
        if (!k || (k.quelle !== 'kanal' && k.quelle !== 'dreieck' && k.quelle !== 'umkehr')) { verworfen.push({ art: 'muster', grund: 'unbekannteId', inhalt: id }); continue }
        if (eingewandt.has(id)) { verworfen.push({ art: 'muster', grund: 'bildEinwand', inhalt: id }); continue }
        if (kanalIds.has(id)) continue
        if (voll(id)) { verworfen.push({ art: 'muster', grund: 'zuViele', inhalt: id }); continue }
        const warum = m?.grund ? setzeEin(m.grund) : ''
        if (warum && !textOk(warum)) { verworfen.push({ art: 'muster', grund: 'prognose', inhalt: id }); continue }
        if (k.quelle === 'umkehr') {
            // Wendepunkte als Pfad, Nackenlinie als Trendlinie (kiZeichnungen.js)
            const gemessenR = englisch
                ? `Measured: height ${k.hoeheAtr.toFixed(1)} ATR; neckline now ${zahl(k.nackenJetzt)}${k.bruch ? ', closed beyond it' : ', not broken'}.`
                : `Gemessen: Höhe ${k.hoeheAtr.toFixed(1)} ATR; Nackenlinie jetzt ${zahl(k.nackenJetzt)}${k.bruch ? ', Schluss jenseits davon' : ', nicht gebrochen'}.`
            kanalIds.add(id)
            belegt.add(id)
            linien.push({
                id: k.id, quelle: 'umkehr', art: 'umkehr', form: k.form, label: umkehrName(k, englisch), labelKurz: umkehrBeschriftung(k, englisch),
                grund: wort(warum ? `${warum} ${gemessenR}` : gemessenR, 300), gewicht: k.bruch ? 'stark' : 'mittel',
                punkte: k.punkte, nacken: k.nacken, bruch: k.bruch,
                p1: k.nacken.p1, p2: k.nacken.p2, t1: k.nacken.t1, t2: k.nacken.t2,
            })
            continue
        }
        if (k.quelle === 'dreieck') {
            // Zwei Kanten bis zur Spitze; gezeichnet als zwei Trendlinien (kiZeichnungen.js)
            const gemessenD = englisch
                ? `Measured: height ${k.hoeheAtr.toFixed(1)} ATR at the start, ${Math.round(k.restPct)} % left; edges now ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
                : `Gemessen: Höhe ${k.hoeheAtr.toFixed(1)} ATR am Anfang, noch ${Math.round(k.restPct)} % übrig; Kanten jetzt ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
            kanalIds.add(id)
            belegt.add(id)
            linien.push({
                id: k.id, quelle: 'dreieck', art: 'dreieck', form: k.form, muster: k.muster ?? null, label: dreieckName(k, englisch), labelKurz: dreieckBeschriftung(k, englisch),
                grund: wort(warum ? `${warum} ${gemessenD}` : gemessenD, 300), gewicht: k.beruehrOben + k.beruehrUnten >= 7 ? 'stark' : 'mittel',
                tA: k.tA, obenA: k.obenA, untenA: k.untenA, tE: k.tE, obenE: k.obenE, untenE: k.untenE,
                tOA: k.tOA ?? null, obenOA: k.obenOA ?? null, tUA: k.tUA ?? null, untenUA: k.untenUA ?? null,
                p1: k.untenJetzt, p2: k.obenJetzt, t1: k.tA, t2: k.tE, bruch: k.bruch,
            })
            continue
        }
        const stange = k.stangeAtr ? (englisch
            ? `, flagpole ${k.stangeAtr.toFixed(1)} ATR in ${k.stangeKerzen} candles, retraced ${Math.round(k.ruecklaufPct)} %`
            : `, Fahnenstange ${k.stangeAtr.toFixed(1)} ATR in ${k.stangeKerzen} Kerzen, davon ${Math.round(k.ruecklaufPct)} % zurückgeholt`) : ''
        const gemessen = englisch
            ? `Measured: width ${k.breiteAtr.toFixed(1)} ATR over ${k.laenge} candles${stange}; edges now ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
            : `Gemessen: Breite ${k.breiteAtr.toFixed(1)} ATR über ${k.laenge} Kerzen${stange}; Kanten jetzt ${zahl(k.untenJetzt)} / ${zahl(k.obenJetzt)}.`
        kanalIds.add(id)
        belegt.add(id)
        linien.push({
            id: k.id, quelle: 'kanal', art: 'kanal', label: kanalName(k, englisch), labelKurz: kanalBeschriftung(k, englisch),
            grund: wort(warum ? `${warum} ${gemessen}` : gemessen, 300), gewicht: k.muster ? 'stark' : 'mittel',
            muster: k.muster, richtung: k.richtung, breite: k.breite,
            t1: k.t1, p1: k.p1, t2: k.t2, p2: k.p2, tEnde: k.tEnde, pEnde: k.pEnde,
        })
    }

    const bedingungen = []
    const iv = paket.interval || ''
    // „Meine Zeichnungen": Bedingungen nur an eigenen Zeichnungen; die Schwelle hängt an der Richtung (Zone: Ober-/Unterkante)
    // Kanal (K): ebenso die Kante in der Richtung — bis 01.11.2026 die Mitte (`k.preis`), dann galt
    // ein Kurs in der oberen Kanalhälfte schon als „über K1" und ein Ziel im Kanal als erreichbar.
    const markeVon = (id, richtung) => {
        if (!eigene) {
            const k = karte.get(id) || null
            if (k?.quelle !== 'kanal') return k
            const oben = richtung !== 'unter'
            return { ...k, preis: oben ? k.obenJetzt : k.untenJetzt, kante: oben ? 'oben' : 'unten' }
        }
        const u = nutzerMap.get(id)
        const p = u ? uSchwelle(u, richtung) : null
        return Number.isFinite(p) ? { id, quelle: 'nutzer', preis: p, name: u.name } : null
    }
    for (const b of Array.isArray(json?.bedingungen) ? json.bedingungen : []) {
        const id = idVon(b?.id)
        const richtungRoh = b?.richtung === 'unter' ? 'unter' : b?.richtung === 'ueber' ? 'ueber' : null
        const k = markeVon(id, richtungRoh || 'ueber')
        if (!k) { verworfen.push({ art: 'bedingung', grund: eigene && !/^U\d/.test(id) ? 'fremdeId' : 'unbekannteId', inhalt: id }); continue }
        // Ein Dreieck hat zwei Kanten, keine einzelne Schwelle — Bedingungen an seine Kanten nur über die Trendlinien
        if (k.quelle === 'dreieck') { verworfen.push({ art: 'bedingung', grund: 'musterOhneSchwelle', inhalt: id }); continue }
        if (eingewandt.has(id) || eingewandt.has(idVon(b?.ziel))) { verworfen.push({ art: 'bedingung', grund: 'bildEinwand', inhalt: id }); continue }
        const richtung = b?.richtung === 'unter' ? 'unter' : b?.richtung === 'ueber' ? 'ueber' : null
        if (!richtung) { verworfen.push({ art: 'bedingung', grund: 'richtung', inhalt: id }); continue }
        const schwelle = eigene ? k.preis : preisVon(k)
        let zielId = null
        if (b?.ziel) {
            zielId = idVon(b.ziel)
            // Ziel einer Zeichnung: die Kante, die der Kurs in dieser Richtung zuerst erreicht
            let z = markeVon(zielId, richtung === 'ueber' ? 'unter' : 'ueber')
            // Kanal als Ziel: liegt die zuerst erreichte Kante hinter der Schwelle, die andere (der Kurs steht schon im Kanal)
            if (z?.quelle === 'kanal') {
                const andere = markeVon(zielId, richtung)
                if (richtung === 'ueber' ? !(z.preis > schwelle) : !(z.preis < schwelle)) z = andere
            }
            if (!z) { verworfen.push({ art: 'bedingung', grund: 'unbekannteId', inhalt: zielId }); continue }
            const zp = eigene ? z.preis : preisVon(z)
            if (richtung === 'ueber' ? !(zp > schwelle) : !(zp < schwelle)) { verworfen.push({ art: 'bedingung', grund: 'zielGegenRichtung', inhalt: `${id}→${zielId}` }); continue }
        }
        if (bedingungen.length >= MAX_BEDINGUNGEN) { verworfen.push({ art: 'bedingung', grund: 'zuViele', inhalt: id }); continue }
        const dann = setzeEin(b?.dann, { nurU: eigene })
        if (dann == null || !wort(dann, 200)) { verworfen.push({ art: 'bedingung', grund: eigene ? 'fremdeId' : 'unbekannteId', inhalt: id }); continue }
        // Den „wenn"-Teil baut der Code — mit der Zahl, an die die Bedingung gebunden ist.
        const seiteJetzt = kurs >= schwelle ? 'ueber' : 'unter'
        const zusatz = k.quelle === 'trend' ? ', Trendlinie' : k.quelle === 'nutzer' ? `, ${k.name}` : k.quelle === 'kanal' ? (k.kante === 'oben' ? ', Oberkante' : ', Unterkante') : ''
        const marke = `${zahl(schwelle)} (${id}${zusatz})`
        const wenn = seiteJetzt === richtung
            ? `solange ${iv}-Schlüsse ${richtung === 'ueber' ? 'über' : 'unter'} ${marke} bleiben`
            : `${iv}-Schluss ${richtung === 'ueber' ? 'über' : 'unter'} ${marke}`
        if (!textOk(`Wenn ${wenn}, dann ${dann}.`)) { verworfen.push({ art: 'bedingung', grund: 'prognose', inhalt: id }); continue }
        pruefeZahlen(dann, `bedingung ${id}`)
        bedingungen.push({ wenn, dann: wort(dann, 200), id, richtung, schwelle, zielId })
    }

    // Eigene Zeichnungen: Bewertungen des Modells und Korrekturen (nur mit „ergänzen")
    const bewertungen = []
    const korrekturen = []
    if (eigene) {
        for (const b of Array.isArray(json?.bewertungen) ? json.bewertungen : []) {
            const u = nutzerMap.get(idVon(b?.u))
            if (!u || bewertungen.some((x) => x.u === u.id)) { verworfen.push({ art: 'bewertung', grund: 'unbekannteId', inhalt: String(b?.u ?? '') }); continue }
            const t = setzeEin(b?.text, { nurU: true })
            if (t == null || !wort(t, 220)) { verworfen.push({ art: 'bewertung', grund: 'unbekannteId', inhalt: u.id }); continue }
            if (!textOk(t)) { verworfen.push({ art: 'bewertung', grund: 'prognose', inhalt: u.id }); continue }
            pruefeZahlen(t, `bewertung ${u.id}`)
            // Hinweis auf einen Fehler in der Zeichnung — fällt allein weg, wenn er nicht durchgeht
            let hinweis = b?.hinweis ? setzeEin(b.hinweis, { nurU: true }) : ''
            if (hinweis == null || (hinweis && !textOk(hinweis))) { verworfen.push({ art: 'hinweis', grund: hinweis == null ? 'fremdeId' : 'prognose', inhalt: u.id }); hinweis = '' }
            bewertungen.push({ u: u.id, zid: u.zid, wichtig: WICHTIG.includes(b?.wichtig) ? b.wichtig : 'mittel', text: wort(t, 220), hinweis: wort(hinweis, 200) })
        }
        for (const k of ergaenzen && Array.isArray(json?.korrekturen) ? json.korrekturen : []) {
            const u = nutzerMap.get(idVon(k?.u))
            const kand = karte.get(idVon(k?.id))
            if (!u || !kand || u.zid == null) { verworfen.push({ art: 'korrektur', grund: 'unbekannteId', inhalt: `${k?.u}→${k?.id}` }); continue }
            if (korrekturen.some((x) => x.u === u.id)) continue
            const d = korrekturAbstand(u, kand, A)
            if (d == null) { verworfen.push({ art: 'korrektur', grund: 'passtNicht', inhalt: `${u.id}→${kand.id}` }); continue }
            if (d < 0.05) { verworfen.push({ art: 'korrektur', grund: 'decktSich', inhalt: `${u.id}→${kand.id}` }); continue }
            if (eingewandt.has(kand.id)) { verworfen.push({ art: 'korrektur', grund: 'bildEinwand', inhalt: `${u.id}→${kand.id}` }); continue }
            const grund = setzeEin(k?.grund) ?? ''
            if (grund && !textOk(grund)) { verworfen.push({ art: 'korrektur', grund: 'prognose', inhalt: u.id }); continue }
            const punkte = korrekturPunkte(u, kand)
            if (!punkte) continue
            korrekturen.push({ u: u.id, zid: u.zid, id: kand.id, typ: u.typ, punkte, abstandAtr: d, grund: wort(grund, 200), name: u.name, label: `${englisch ? 'Correct' : 'Korrektur'} ${u.name}` })
        }
    }
    const nutzer = paket.nutzer.map((u) => ({
        id: u.id, zid: u.zid, typ: u.typ, name: u.name, zustand: u.zustand ?? null, rolle: u.rolle ?? null,
        beruehrungen: u.beruehrungen ?? null, durchquerungen: u.durchquerungen ?? null, abstandAtr: u.abstandAtr ?? null,
        bruchT: u.bruch?.t ?? null, auffaellig: u.auffaellig || [],
    }))

    const leer = !text && !linien.length && !zonen.length && !bedingungen.length && !bewertungen.length && !korrekturen.length
    return { modus, ergaenzen, text, linien, zonen, bedingungen, bewertungen, korrekturen, nutzer, verworfen, warnungen, leer, einwaende }
}

/** Die Linie des übergeordneten Trends als KI-Linie (gestrichelt, übernehmbar wie die übrigen). */
export function htfTrendLinie(h, englisch = false) {
    const l = h.linie
    const grund = englisch
        ? `Measured on the ${h.tf} chart: ${l.beruehrungen} touches, matches the ${h.zustand === 1 ? 'uptrend' : 'downtrend'} structure there.`
        : `Gemessen im ${h.tf}-Chart: ${l.beruehrungen} Berührungen, passt zur ${h.zustand === 1 ? 'Aufwärts' : 'Abwärts'}struktur dort.`
    return {
        id: 'H1', quelle: 'htfTrend', art: 'trend', rolle: l.rolle, tf: h.tf, label: htfTrendLabel(h, englisch), grund,
        gewicht: l.beruehrungen >= 3 ? 'stark' : 'mittel', beruehrungen: l.beruehrungen,
        t1: l.t1, p1: l.p1, t2: l.t2, p2: l.p2, ...(Number.isFinite(l.tEnde) ? { tEnde: l.tEnde, pEnde: l.pEnde } : {}),
    }
}

/** Neue Punkte einer eigenen Zeichnung aus dem Kandidaten — gleicher Typ, gleiche Punktzahl. */
export function korrekturPunkte(u, k) {
    if (u.typ === 'horizontale' || u.typ === 'strahlH') return [{ t: u.punkte[0].t, p: k.preis }]
    if (u.typ === 'trendlinie' || u.typ === 'strahl') return [{ t: k.t1, p: k.p1 }, { t: k.t2, p: k.p2 }]
    if (u.typ === 'kanal') {
        const t2 = Number.isFinite(k.tEnde) ? k.tEnde : k.t2, p2 = Number.isFinite(k.pEnde) ? k.pEnde : k.p2
        return [{ t: k.t1, p: k.p1 }, { t: t2, p: p2 }, { t: k.t1, p: k.p1 + (k.breite || 0) }]
    }
    return null
}

/** Kompakte Kandidatenliste für den Reiter (was zur Wahl stand). */
export function kandidatenKurz(paket) {
    if (!paket) return null
    return {
        kurs: paket.kurs, atr: paket.atr, intervalHtf: paket.intervalHtf, spanne: paket.spanne, struktur: paket.struktur,
        kandidaten: paket.kandidaten.slice(0, 48).map((k) => ({
            id: k.id, quelle: k.quelle, name: k.name || null,
            preis: k.quelle === 'trend' ? null : k.preis, tief: k.tief ?? null, hoch: k.hoch ?? null,
            t1: k.t1 ?? null, p1: k.p1 ?? null, t2: k.t2 ?? null, p2: k.p2 ?? null, wertJetzt: k.wertJetzt ?? null,
            tEnde: k.tEnde ?? null, pEnde: k.pEnde ?? null, beruehrT: k.beruehrT ?? null, gegen: k.gegen ?? null,
            beruehrungen: k.beruehrungen ?? null, durchquerungen: k.durchquerungen ?? null, letzteT: k.letzteT ?? null,
            abstandAtr: k.abstandAtr ?? null, rolle: k.rolle ?? null, deckt: k.deckt ?? null, abschnitt: k.abschnitt ?? null, bereich: k.bereich ?? null,
            breite: k.breite ?? null, muster: k.muster ?? null, richtung: k.richtung ?? null, form: k.form ?? null,
            tA: k.tA ?? null, obenA: k.obenA ?? null, untenA: k.untenA ?? null, tE: k.tE ?? null, obenE: k.obenE ?? null, untenE: k.untenE ?? null,
            tOA: k.tOA ?? null, obenOA: k.obenOA ?? null, tUA: k.tUA ?? null, untenUA: k.untenUA ?? null,
            punkte: k.punkte ?? null, nacken: k.nacken ?? null, nackenJetzt: k.nackenJetzt ?? null,
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

/**
 * Sperrt dieser Fehler den Chart für `SPERRE_MS`? Nicht, was nichts gekostet hat:
 * 400 (keine eigene Zeichnung), 429 (schon gesperrt) und „Quelle/Marktdaten aus" —
 * da wurde niemand gefragt. Bis 01.11.2026 sperrte „aus" 45 s, auch nachdem die
 * Marktdaten wieder an waren („429 Marktdaten sind ausgeschaltet"). Rein.
 */
export function sperrtNachFehler(e) {
    return !istAus(e) && e?.status !== 429 && e?.status !== 400
}

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
        // Feste Reihenfolge (neueste zuerst); welche in die Analyse kommen, entscheidet `waehleNutzer`
        knex('chart_zeichnungen').where('symbol', symbol).orderBy('geaendertAm', 'desc').orderBy('id', 'desc').catch(() => []),
        markt === 'spot' ? null : holeHebelzonen(symbol).catch(() => null),
        knex('trades').select('dateUnix', 'broker', 'trades')
            .where('dateUnix', '>=', Math.floor(vonT / 1000) - 7 * 86400).catch(() => []),
        knex('settings').select('language', 'timeZone').where('id', 1).first().catch(() => null),
    ])
    const liste = (x) => { try { const v = typeof x === 'string' ? JSON.parse(x) : x; return Array.isArray(v) ? v : null } catch { return null } }
    const zeichnungen = zeichnungenRoh.map((z) => ({ ...z, punkte: JSON.parse(z.punkte || '[]'), stil: JSON.parse(z.stil || '{}'), sichtbarAuf: liste(z.sichtbarAuf) }))
    const trades = tradesAusZeilen(tagesZeilen, symbol, vonT, Date.now())
    return {
        kerzen, zeichnungen, hebel, trades,
        englisch: s?.language === 'en',
        zeitzone: zeitzoneAus(s?.timeZone),
    }
}

/** Höchstens so viele Kerzen lädt „Meine Zeichnungen" vor das Analysefenster nach. */
export const NUTZER_KERZEN_MAX = 4000

/**
 * Kerzen ab der ältesten eigenen Zeichnung (20 Kerzen Vorlauf, damit ein Wendepunkt
 * am linken Rand erkennbar ist) bis zum Analysefenster, davor angehängt. Fehlt die
 * Historie, misst der Code mit dem Fenster allein — und sagt bei Zone/Profil, dass
 * sie vor den geladenen Kerzen beginnen. Zählt nur die Zeichnungen, die auch in die
 * Analyse kommen (`waehleNutzer`: diese Zeiteinheit, im Bild, messbar) — eine alte
 * Zeichnung „nur 4h" lud vorher in der 1h-Analyse bis 4000 Kerzen nach.
 */
async function ladeNutzerKerzen({ symbol, interval, markt, kerzen, zeichnungen, vonT }) {
    const iv = TIMEFRAME_MS[interval]
    if (!iv || !kerzen.length) return null
    const { liste } = waehleNutzer(zeichnungen, Math.min(kerzen[0].t, vonT ?? kerzen[0].t), kerzen[kerzen.length - 1].t, { interval, kurs: kerzen[kerzen.length - 1].c })
    const ts = liste.flatMap((z) => (z.punkte || []).map((q) => Number(q.t))).filter(Number.isFinite)
    if (!ts.length) return null
    const von = Math.max(Math.min(...ts) - 20 * iv, kerzen[0].t - NUTZER_KERZEN_MAX * iv)
    if (von >= kerzen[0].t) return null
    try {
        const davor = await getHistoricalCandles(symbol, interval, von, kerzen[0].t, { market: markt, maxCandles: NUTZER_KERZEN_MAX })
        const vorher = davor.filter((k) => k.t < kerzen[0].t)
        return vorher.length ? [...vorher, ...kerzen] : null
    } catch (e) {
        logWarn('chart-ki', `${symbol} ${interval}: Kerzen vor dem Fenster nicht geladen (${e.message}) — Zeichnungen nur im Fenster gemessen`)
        return null
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

export async function erzeugeChartAnalyse({ symbol, interval, markt = 'futures', modus: modusRoh = 'setzen', ergaenzen: ergaenzenRoh = true, htf: htfRoh = false, fenster = null, bild = null }) {
    const wahl = normModus({ modus: modusRoh, ergaenzen: ergaenzenRoh, htf: htfRoh })
    const fen = fensterAus(fenster, TIMEFRAME_MS[interval])
    // Anderer Ausschnitt oder andere Art = andere Analyse: die Sperre gilt nur für dieselbe Art UND dasselbe Fenster
    const wahlText = JSON.stringify({ ...wahl, fenster: fen })
    const schluessel = schluesselVon(symbol, interval, markt)
    // Der Cache hält die LETZTE Analyse je Chart; die Sperre greift nur bei gleicher Auswahl —
    // wer ein Kästchen umstellt, will eine andere Analyse, nicht die eben bezahlte.
    const alt = cache.get(schluessel)
    // `herkunft` (bis 01.11.2026 `aus`): `aus` heisst bei allen anderen Routen „Quelle abgeschaltet" (`{aus: true}`)
    if (alt && Date.now() - alt.ts < SPERRE_MS && JSON.stringify({ modus: alt.payload.modus || 'setzen', ergaenzen: !!alt.payload.ergaenzen, htf: !!alt.payload.htf, fenster: alt.payload.fenster || null }) === wahlText) return { ...alt.payload, stand: alt.ts, alterMs: Date.now() - alt.ts, herkunft: 'sperre' }
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
        // Übergeordneter Trend (Häkchen): Tages-, 4h- und Wochenkerzen, je nach Chart (chart-htf-trend.js)
        const trendTfs = wahl.htf ? htfTrendKandidaten(interval) : []
        const [{ kerzen, zeichnungen, hebel, trades, englisch, zeitzone }, kerzenHtf, ...trendSerien] = await Promise.all([
            ladeChartDaten({ symbol, interval, markt, anzahl: fen.anzahl, bisT: fen.bisT }),
            intervalHtf ? getClosedCandles(symbol, intervalHtf, HTF_KERZEN, { market: markt }).catch(() => null) : null,
            ...trendTfs.map((tf) => getClosedCandles(symbol, tf, HTF_TREND_KERZEN, { market: markt }).catch(() => null)),
        ])
        if (kerzen.length < 30) throw new Error('Zu wenige Kerzen für eine Analyse')
        const vonT = kerzen[0].t
        const bisT = kerzen[kerzen.length - 1].t
        // „Meine Zeichnungen": gemessen wird ab der ältesten Zeichnung, nicht nur im Analysefenster
        // (bis 01.11.2026 bekam eine Zone vom September „ohne Eintritt", ein Profil vom August fremde Zahlen).
        const nutzerKerzen = wahl.modus === 'eigene' ? await ladeNutzerKerzen({ symbol, interval, markt, kerzen, zeichnungen, vonT: Number(fenster?.vonT) || null }) : null
        // Der Code vermisst, das Modell wählt aus (chart-kandidaten.js).
        const paket = baueKandidaten({
            kerzen, kerzenHtf, interval, intervalHtf, zeichnungen, zeitzone, profilArten: PROFIL_ARTEN_ALLE,
            nutzerKerzen, nutzerVonT: Number(fenster?.vonT) || null,
        })
        if (!paket) throw new Error('Zu wenige Kerzen für eine Vermessung')
        const htfTrend = wahl.htf
            ? uebergeordneterTrend(Object.fromEntries(trendTfs.map((tf, i) => [tf, trendSerien[i]])), interval, { bisT, ivMs: TIMEFRAME_MS[interval] })
            : null
        // Ohne eigene Zeichnung im Bild gibt es nichts zu analysieren — Bescheid statt bezahltem Aufruf.
        // Stehen nur Zeichnungen im Bild, die der Code nicht misst (Fib-Extension, Pfeil …), sagt der Code das (`nurUngemessene`).
        if (wahl.modus === 'eigene' && !paket.nutzer.length) {
            const nur = paket.nutzerUebergangen?.length > 0
            const e = new Error(nur ? 'nurUngemessene' : 'keineZeichnungen'); e.status = 400; e.code = e.message
            if (nur) e.uebergangen = paket.nutzerUebergangen
            throw e
        }

        const cfg = await ladeLlmConfigFuerAufgabe('chart-analyse')
        // Die bestellte Antwort ist lang (Linien mit Gründen). Nach Textlänge
        // bemessen frisst ein Reasoning-Modell den Deckel und liefert leeren
        // Inhalt bei voller Rechnung — deshalb grosszügig, und bei
        // abgeschnittenem JSON einmal mit doppeltem Deckel.
        cfg.maxTokens = 3000
        // Bildprüfung: nur wenn der Browser ein Bild schickte, der Anbieter Bilder versteht
        // und es überhaupt Geometrie zu prüfen gibt (Kanäle oder Trendlinien im Paket).
        // Bei „Meine Zeichnungen" dient das Bild dem Verständnis der Zeichnungen, nicht der Prüfung von Kandidaten
        const zuPruefen = wahl.modus === 'eigene' || paket.kandidaten.some((k) => EINSPRUCH_QUELLEN.includes(k.quelle))
        let bildPruefung = !bild ? 'ohneBild' : !kannBilder(cfg.provider) ? 'anbieterOhneBild' : !zuPruefen ? 'nichtsZuPruefen' : 'an'
        const user = baueChartEingabe({ symbol, interval, paket, hebelzonen: hebel, trades, ...wahl, htfTrend, englisch })
        const buchung = { zweck: wahl.modus === 'eigene' ? 'chart-analyse-eigene' : 'chart-analyse', ausloeser: 'manuell', bezug: { typ: 'symbol', id: symbol } }
        const frage = () => {
            const mitBild = bildPruefung === 'an'
            return callLLMJson(cfg, { system: systemText(englisch, { mitBild, ...wahl }), user, timeoutMs: 90000, anhaenge: mitBild ? [bild] : [], ...buchung })
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
        const ergebnis = pruefeChartAuswahl(antwort.json, paket, { ...wahl, englisch, mitBild: bildPruefung === 'an' })
        for (const e of ergebnis.einwaende) logWarn('chart-ki', `${symbol} ${interval}: Bild widerspricht ${e.id} (${e.name}) — ${e.grund}`)
        for (const v of ergebnis.verworfen) logWarn('chart-ki', `${symbol} ${interval}: ${v.art} verworfen (${v.grund}) — ${v.inhalt}`)
        for (const w of ergebnis.warnungen) logWarn('chart-ki', `${symbol} ${interval}: Zahl ${w.zahl} in ${w.wo} passt zu keiner Marke`)
        if (ergebnis.leer) throw new Error('Die KI hat keine verwertbare Analyse geliefert')
        // Die Linie des übergeordneten Trends zeichnet der Code selbst — zusätzlich, nicht gegen die 6 Zeichnungen gezählt
        if (htfTrend?.linie) ergebnis.linien.push(htfTrendLinie(htfTrend, englisch))

        const payload = {
            symbol, interval, ...ergebnis, htf: wahl.htf, htfTrend: htfTrend ? { tf: htfTrend.tf, zustand: htfTrend.zustand, linie: !!htfTrend.linie } : null, kerzenVon: vonT, kerzenBis: bisT, auswahl: kandidatenKurz(paket), fenster: fen,
            nutzerWeggelassen: paket.nutzerWeggelassen || 0, nutzerUebergangen: paket.nutzerUebergangen || [],
            markt, provider: cfg.provider, model: cfg.model, costUsd: kosten, bildPruefung,
            kiGeneriert: true,
        }
        cache.set(schluessel, { ts: Date.now(), payload })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
        return { ...payload, stand: Date.now(), alterMs: 0, herkunft: 'neu' }
    })()
    laufend.set(laufSchluessel, lauf)
    try {
        const r = await lauf
        fehlschlaege.delete(schluessel)
        return r
    } catch (e) {
        if (sperrtNachFehler(e)) fehlschlaege.set(schluessel, { ts: Date.now(), meldung: e.message })
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
            res.json(await erzeugeChartAnalyse({
                symbol, interval, markt: req.body?.markt === 'spot' ? 'spot' : 'futures', modus: req.body?.modus, ergaenzen: req.body?.ergaenzen !== false, htf: req.body?.htf === true,
                fenster: req.body?.fenster, bild: pruefeBild(req.body?.bild),
            }))
        } catch (e) {
            if (sendeWennAus(res, e)) return
            if (e.code === 'keineZeichnungen' || e.code === 'nurUngemessene') return res.status(400).json({ error: e.message, code: e.code, ...(e.uebergangen ? { uebergangen: e.uebergangen } : {}) })
            logWarn('chart-ki', `${symbol} ${interval}: ${e.message}`)
            res.status(e.status === 429 || e.status === 400 ? e.status : 502).json({ error: e.message })
        }
    })
}
