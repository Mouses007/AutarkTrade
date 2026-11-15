/**
 * Selbsttest: Aktien-Radar im Alltag — Zeitplan, Einstellungen, Erfolgskontrolle.
 *
 *   node server/coin-radar/__selftest-aktien-alltag.mjs
 *
 * Ohne Netz und ohne Datenbank. Geprüft wird vor allem, was still Falsches
 * täte: ein Lauf am Wochenende oder Feiertag, ein nachgeholter Lauf Stunden
 * nach der Eröffnung, eine Stunde Versatz bei Sommerzeit, eine Vorgabe, die in
 * der Datenbank einfriert, ein leeres Feld als 0, und eine Erfolgskontrolle,
 * die den Index gegen sich selbst misst.
 */
import assert from 'node:assert/strict'
import {
    ZEITPLAN_VORGABE, FENSTER_MIN, bereinigeZeitplan, leseZeitplan, faelligerPlatz, naechsterPlatz, nyZeitpunkt,
} from './aktien-zeitplan.js'
import {
    bereinigeHuerdenAktien, bereinigeGewichteAktien, bereinigeAktienEinstellungen, zahlAus, fehlerText, HUERDEN_GRENZEN,
} from './aktien-einstellungen.js'
import {
    ART_AKTIEN, HORIZONTE_AKTIEN, KERZEN_AKTIEN, waehleAktienRadar, werteAktienLaufAus, werteAusAktien, URTEILE_AKTIEN,
} from './aktien-erfolg.js'
import { STANDARD_HUERDEN_AKTIEN, STANDARD_HUERDEN, STANDARD_GEWICHTE } from './bewertung.js'
import { GEWICHTE_AKTIEN } from './aktien-kennzahlen.js'
import { VORGABEN } from './einstellungen.js'
import { HORIZONTE, DECKEL_JE_ART, rechneFenster } from '../radar-ergebnisse.js'
import { timeframeMs } from '../market-data.js'
import { aktienZeitplanTakt } from '../coin-radar-api.js'
import { zahlAus as zahlAusBrowser, pruefeZahl } from '../../src/utils/aktienRadarEingabe.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

const utc = (j, m, t, h = 0, min = 0) => Date.UTC(j, m - 1, t, h, min)
const AN = { an: true, nachEroeffnungMin: 30, vorSchlussMin: 30 }

// ── 1. Zeitplan: wann ist ein Platz fällig ──────────────────────────────
// Montag 16.11.2026, Winterzeit (New York = UTC−5): Eröffnung 14:30 UTC, Schluss 21:00 UTC.
gleich(faelligerPlatz(utc(2026, 11, 16, 15, 0), AN), { platz: 'eroeffnung', handelstag: '2026-11-16' }, '10:00 New York: Platz Eröffnung')
gleich(faelligerPlatz(utc(2026, 11, 16, 14, 59), AN), null, '09:59: noch nicht fällig')
gleich(faelligerPlatz(utc(2026, 11, 16, 14, 35), AN), null, 'fünf Minuten nach der Eröffnung: noch nicht')
gleich(faelligerPlatz(utc(2026, 11, 16, 15, FENSTER_MIN - 1), AN)?.platz, 'eroeffnung', 'bis zum Ende des Fensters')
gleich(faelligerPlatz(utc(2026, 11, 16, 15, FENSTER_MIN), AN), null, 'nach dem Fenster wird NICHT nachgeholt')
gleich(faelligerPlatz(utc(2026, 11, 16, 18, 0), AN), null, 'mittags: kein Platz')
gleich(faelligerPlatz(utc(2026, 11, 16, 20, 30), AN), { platz: 'schluss', handelstag: '2026-11-16' }, '15:30 New York: Platz Schluss')
gleich(faelligerPlatz(utc(2026, 11, 16, 20, 59), AN)?.platz, 'schluss', 'bis zur Schlussglocke')
gleich(faelligerPlatz(utc(2026, 11, 16, 21, 0), AN), null, '16:00: Börse zu, kein Platz')
gleich(faelligerPlatz(utc(2026, 11, 17, 2, 0), AN), null, 'Nacht in New York: kein Platz')

// Wochenende und Feiertag
gleich(faelligerPlatz(utc(2026, 11, 14, 15, 0), AN), null, 'Samstag: kein Lauf')
gleich(faelligerPlatz(utc(2026, 11, 15, 15, 0), AN), null, 'Sonntag: kein Lauf')
gleich(faelligerPlatz(utc(2026, 11, 26, 15, 0), AN), null, 'Thanksgiving: kein Lauf')
gleich(faelligerPlatz(utc(2026, 7, 3, 14, 0), AN), null, 'begangener Unabhängigkeitstag (Freitag 3.7.2026): kein Lauf')
gleich(faelligerPlatz(utc(2026, 12, 25, 15, 0), AN), null, 'Weihnachten: kein Lauf')

// Sommerzeit (New York = UTC−4): Montag 6.7.2026, 10:00 New York = 14:00 UTC
gleich(faelligerPlatz(utc(2026, 7, 6, 14, 0), AN)?.platz, 'eroeffnung', 'Sommerzeit: 14:00 UTC ist 10:00 New York')
gleich(faelligerPlatz(utc(2026, 7, 6, 15, 0), AN), null, 'Sommerzeit: 15:00 UTC ist schon nach dem Fenster')
gleich(faelligerPlatz(utc(2026, 7, 6, 19, 30), AN)?.platz, 'schluss', 'Sommerzeit: 19:30 UTC ist 15:30 New York')
// Woche zwischen US- und EU-Umstellung (USA ab 8.3.2026 Sommerzeit): Montag 9.3.2026
gleich(faelligerPlatz(utc(2026, 3, 9, 14, 0), AN)?.platz, 'eroeffnung', 'nach der US-Umstellung zählt die New Yorker Uhr')

// Aus heisst aus — auch bei kaputtem Inhalt
gleich(faelligerPlatz(utc(2026, 11, 16, 15, 0), { ...AN, an: false }), null, 'ausgeschaltet: nichts fällig')
gleich(faelligerPlatz(utc(2026, 11, 16, 15, 0), undefined), null, 'ohne Plan: nichts fällig')
gleich(faelligerPlatz(utc(2026, 11, 16, 15, 0), 'kaputt'), null, 'kaputter Plan: nichts fällig')
gleich(faelligerPlatz(utc(2026, 11, 16, 15, 0), { an: true, nachEroeffnungMin: 9999 }), null, 'ungültiger Abstand fällt auf «aus», nicht auf einen erfundenen Wert')
ok(ZEITPLAN_VORGABE.an === false && VORGABEN.aktienZeitplan.an === false, 'Zeitplan ist ab Werk aus')

// Andere Abstände
gleich(faelligerPlatz(utc(2026, 11, 16, 14, 45), { an: true, nachEroeffnungMin: 15, vorSchlussMin: 60 })?.platz, 'eroeffnung', '15 Minuten nach der Eröffnung')
gleich(faelligerPlatz(utc(2026, 11, 16, 20, 0), { an: true, nachEroeffnungMin: 15, vorSchlussMin: 60 })?.platz, 'schluss', '60 Minuten vor dem Schluss')
// Liegen die Plätze dicht beieinander, überlappen ihre Fenster nicht
{
    const eng = { an: true, nachEroeffnungMin: 180, vorSchlussMin: 180 }   // 12:30 und 13:00
    gleich(faelligerPlatz(utc(2026, 11, 16, 17, 45), eng)?.platz, 'eroeffnung', 'enger Plan: 12:45 gehört zur Eröffnung')
    gleich(faelligerPlatz(utc(2026, 11, 16, 18, 0), eng)?.platz, 'schluss', 'enger Plan: 13:00 gehört zum Schluss')
}

// Nächster Platz
gleich(naechsterPlatz(utc(2026, 11, 15, 12, 0), AN), { platz: 'eroeffnung', zeit: utc(2026, 11, 16, 15, 0), handelstag: '2026-11-16' }, 'Sonntag → Montag 10:00 New York')
gleich(naechsterPlatz(utc(2026, 11, 16, 15, 30), AN)?.zeit, utc(2026, 11, 16, 20, 30), 'nach der Eröffnung → Schluss desselben Tags')
gleich(naechsterPlatz(utc(2026, 11, 20, 21, 30), AN)?.zeit, utc(2026, 11, 23, 15, 0), 'Freitag nach Schluss → Montag')
gleich(naechsterPlatz(utc(2026, 11, 25, 21, 30), AN)?.handelstag, '2026-11-27', 'Mittwoch vor Thanksgiving → Freitag')
// Verkürzter Handelstag (27.11.2026, Schluss 13:00): der Schluss-Platz rückt auf 12:30 vor.
gleich(faelligerPlatz(utc(2026, 11, 27, 17, 35), AN)?.platz, 'schluss', 'verkürzter Tag: 12:35 New York ist der Schluss-Platz')
gleich(faelligerPlatz(utc(2026, 11, 27, 20, 35), AN), null, 'verkürzter Tag: 15:35 New York ist nach dem Schluss')
gleich(naechsterPlatz(utc(2026, 7, 5, 12, 0), AN)?.zeit, utc(2026, 7, 6, 14, 0), 'Sommerzeit: Montag 14:00 UTC')
gleich(naechsterPlatz(utc(2026, 11, 15, 12, 0), { an: false }), null, 'aus: kein nächster Lauf')
// Jeder gemeldete nächste Platz ist dann auch wirklich fällig
for (const start of [utc(2026, 3, 6, 23), utc(2026, 10, 30, 23), utc(2026, 12, 31, 12), utc(2027, 1, 1, 12)]) {
    const nae = naechsterPlatz(start, AN)
    gleich(faelligerPlatz(nae.zeit, AN), { platz: nae.platz, handelstag: nae.handelstag }, `nächster Platz ab ${new Date(start).toISOString()} ist fällig, wenn er kommt`)
}
gleich(nyZeitpunkt('2026-11-16', 9 * 60 + 30), utc(2026, 11, 16, 14, 30), 'New Yorker Wanduhr → Zeitpunkt (Winter)')
gleich(nyZeitpunkt('2026-07-06', 9 * 60 + 30), utc(2026, 7, 6, 13, 30), 'New Yorker Wanduhr → Zeitpunkt (Sommer)')

// Eingabeprüfung des Zeitplans
gleich(bereinigeZeitplan({ an: true, nachEroeffnungMin: '45', vorSchlussMin: 20 }).plan, { an: true, nachEroeffnungMin: 45, vorSchlussMin: 20 }, 'Zeitplan: Zahlen als Text gelten')
gleich(bereinigeZeitplan({ an: true }).plan, { an: true, nachEroeffnungMin: 30, vorSchlussMin: 30 }, 'Zeitplan: fehlende Abstände nehmen die Vorgabe')
gleich(bereinigeZeitplan({ an: true, nachEroeffnungMin: 2 }).fehler, 'zeitplanAbstand', 'Zeitplan: zu kleiner Abstand abgelehnt')
gleich(bereinigeZeitplan({ an: true, vorSchlussMin: 400 }).fehler, 'zeitplanAbstand', 'Zeitplan: zu grosser Abstand abgelehnt')
gleich(bereinigeZeitplan({ an: true, vorSchlussMin: 'bald' }).fehler, 'zeitplanAbstand', 'Zeitplan: Text abgelehnt')
gleich(bereinigeZeitplan({ an: 'ja' }).plan.an, false, 'Zeitplan: nur true/1 schaltet ein')
gleich(leseZeitplan(null), { ...ZEITPLAN_VORGABE }, 'Zeitplan: nichts gespeichert = Vorgabe')

// ── 2. Takt: Reihenfolge und Abbrüche ───────────────────────────────────
{
    const baue = (ueber = {}) => {
        const protokoll = []
        const d = {
            jetzt: () => utc(2026, 11, 16, 15, 0),
            modusAn: async () => true,
            leseEinstellungen: async () => ({ aktienZeitplan: AN }),
            beansprucheFuehrung: async () => { protokoll.push('fuehrung'); return true },
            gibFuehrungFrei: async () => { protokoll.push('frei') },
            beansprucheAufgabe: async (k) => { protokoll.push(`anspruch:${k}`); return true },
            meldeFehler: async (k, text) => { protokoll.push(`fehler:${text}`) },
            lauf: async (einst, f) => { protokoll.push(`lauf:${f.platz}`) },
            ...ueber,
        }
        return { d, protokoll }
    }
    let t = baue()
    gleich(await aktienZeitplanTakt(t.d), 'gelaufen', 'Takt: fälliger Platz läuft')
    gleich(t.protokoll, ['fuehrung', 'anspruch:aktienradar_lauf_eroeffnung', 'lauf:eroeffnung', 'fehler:', 'frei'], 'Takt: Führung vor Anspruch vor Lauf, Führung am Ende frei')

    t = baue({ modusAn: async () => false })
    gleich(await aktienZeitplanTakt(t.d), 'modusAus', 'Takt: ohne Aktien-Modus kein Lauf')
    gleich(t.protokoll, [], 'Takt: ohne Aktien-Modus weder Führung noch Anspruch')

    t = baue({ leseEinstellungen: async () => ({ aktienZeitplan: { ...AN, an: false } }) })
    gleich(await aktienZeitplanTakt(t.d), 'aus', 'Takt: Zeitplan aus')
    gleich(t.protokoll, [], 'Takt: Zeitplan aus beansprucht nichts')

    t = baue({ jetzt: () => utc(2026, 11, 15, 15, 0) })
    gleich(await aktienZeitplanTakt(t.d), 'nichtFaellig', 'Takt: Sonntag nichts fällig')
    gleich(t.protokoll, [], 'Takt: nicht fällig beansprucht nichts')

    // Hält ein anderer Rechner die Führung, bleibt der Platz für den nächsten Takt frei
    t = baue({ beansprucheFuehrung: async () => false })
    gleich(await aktienZeitplanTakt(t.d), 'belegt', 'Takt: Führung vergeben')
    ok(!t.protokoll.some((p) => p.startsWith('anspruch')), 'Takt: ohne Führung wird der Platz NICHT verbraucht')

    // Der Platz ist heute schon gelaufen
    t = baue({ beansprucheAufgabe: async () => false })
    gleich(await aktienZeitplanTakt(t.d), 'vergeben', 'Takt: Platz schon gelaufen')
    ok(!t.protokoll.some((p) => p.startsWith('lauf')) && t.protokoll.at(-1) === 'frei', 'Takt: kein zweiter Lauf, Führung trotzdem frei')

    // Scheitert der Lauf, steht der Grund da und die Führung ist frei
    t = baue({ lauf: async () => { throw new Error('Marktdaten aus') } })
    await assert.rejects(() => aktienZeitplanTakt(t.d), /Marktdaten aus/); n++
    ok(t.protokoll.includes('fehler:Marktdaten aus') && t.protokoll.at(-1) === 'frei', 'Takt: Fehler vermerkt, Führung frei')

    // Schluss-Platz hat seinen eigenen Anspruch
    t = baue({ jetzt: () => utc(2026, 11, 16, 20, 30) })
    await aktienZeitplanTakt(t.d)
    ok(t.protokoll.includes('anspruch:aktienradar_lauf_schluss'), 'Takt: Schluss-Platz sperrt nicht den Eröffnungs-Platz')
}

// ── 3. Einstellungen: Hürden und Gewichte ───────────────────────────────
ok('huerdenAktien' in VORGABEN && 'gewichteAktien' in VORGABEN && 'aktienZeitplan' in VORGABEN, 'Aktien-Schlüssel stehen in den Vorgaben (sonst liest sie niemand)')
gleich(VORGABEN.huerdenAktien, STANDARD_HUERDEN_AKTIEN, 'Vorgabe der Hürden = Konstante des Laufs')
gleich(VORGABEN.gewichteAktien, GEWICHTE_AKTIEN, 'Vorgabe der Gewichte = Konstante des Laufs')
// Krypto unverändert
gleich(VORGABEN.huerden, STANDARD_HUERDEN, 'Coin-Hürden unverändert')
gleich(VORGABEN.gewichte, STANDARD_GEWICHTE, 'Coin-Gewichte unverändert')
ok(VORGABEN.aktiv === false && VORGABEN.intervallStunden === 1, 'Coin-Zeitplan unverändert')

gleich(zahlAus('1,5'), 1.5, 'Komma als Dezimaltrenner')
gleich(zahlAus("1'000'000"), 1_000_000, 'Tausender-Apostroph')
gleich(zahlAus(''), null, 'leer ist keine Null')
gleich(zahlAus('abc'), null, 'Text ist keine Zahl')
gleich(zahlAus('1e9'), null, 'Exponentialschreibweise gilt nicht')
gleich(zahlAus(Infinity), null, 'Unendlich gilt nicht')
gleich(zahlAus(NaN), null, 'NaN gilt nicht')
for (const w of ['1,5', "2'500", '', ' ', 'x', '-3', '0', 7, null, undefined]) {
    gleich(zahlAusBrowser(w), zahlAus(w), `Browser und Server lesen «${w}» gleich`)
}
gleich(pruefeZahl('', { min: 0, max: 10 }), { wert: null, fehler: 'leer' }, 'Browser: leeres Feld ist ein Fehler, keine 0')
gleich(pruefeZahl('11', { min: 0, max: 10 }).fehler, 'bereich', 'Browser: ausserhalb der Grenzen')
gleich(pruefeZahl('2,5', { min: 0, max: 10, ganz: true }).fehler, 'ganzzahl', 'Browser: nur ganze Zahlen')
gleich(pruefeZahl('2,5', { min: 0, max: 10 }), { wert: 2.5, fehler: null }, 'Browser: gültige Eingabe')

gleich(bereinigeHuerdenAktien({ minUmsatz24hUsd: '2500000', maxSpreadBp: '7,5' }).wert,
    { ...STANDARD_HUERDEN_AKTIEN, minUmsatz24hUsd: 2_500_000, maxSpreadBp: 7.5 }, 'Hürden: Eingabe übernommen, Rest Vorgabe')
gleich(bereinigeHuerdenAktien({ ...STANDARD_HUERDEN_AKTIEN }).wert, null, 'Hürden: gleich der Vorgabe wird nicht eingefroren')
gleich(bereinigeHuerdenAktien(null).wert, null, 'Hürden: null = Vorgabe wiederherstellen')
gleich(bereinigeHuerdenAktien({ maxSpreadBp: 0 }).fehler, 'bereich', 'Hürden: Spread 0 liesse nichts durch — abgelehnt')
gleich(bereinigeHuerdenAktien({ maxSpreadBp: -1 }).fehler, 'bereich', 'Hürden: negativ abgelehnt')
gleich(bereinigeHuerdenAktien({ minUmsatz24hUsd: '' }), { fehler: 'keineZahl', feld: 'minUmsatz24hUsd' }, 'Hürden: leeres Feld wird nicht zu 0')
gleich(bereinigeHuerdenAktien({ minKerzen: 30.5 }).fehler, 'ganzzahl', 'Hürden: Kerzenzahl ganzzahlig')
gleich(bereinigeHuerdenAktien({ minKerzen: 5 }).fehler, 'bereich', 'Hürden: zu wenige Kerzen abgelehnt')
gleich(bereinigeHuerdenAktien([1, 2]).fehler, 'form', 'Hürden: Liste abgelehnt')
gleich(bereinigeHuerdenAktien('x').fehler, 'form', 'Hürden: Text abgelehnt')
ok(!('fremd' in bereinigeHuerdenAktien({ fremd: 1, maxSpreadBp: 5 }).wert), 'Hürden: unbekannte Felder fallen weg')
for (const [feld, g] of Object.entries(HUERDEN_GRENZEN)) {
    ok(STANDARD_HUERDEN_AKTIEN[feld] >= g.min && STANDARD_HUERDEN_AKTIEN[feld] <= g.max, `Hürden: Vorgabe ${feld} liegt in den Grenzen`)
}

gleich(bereinigeGewichteAktien({ staerke: 50, trend: 0 }).wert, { ...GEWICHTE_AKTIEN, staerke: 50, trend: 0 }, 'Gewichte: Eingabe übernommen')
gleich(bereinigeGewichteAktien({ ...GEWICHTE_AKTIEN }).wert, null, 'Gewichte: gleich der Vorgabe wird nicht eingefroren')
gleich(bereinigeGewichteAktien({ staerke: 0, hochNaehe: 0, imSpiel: 0, bewegung: 0, trend: 0 }).fehler, 'gewichteNull', 'Gewichte: alle null abgelehnt')
gleich(bereinigeGewichteAktien({ staerke: 101 }).fehler, 'bereich', 'Gewichte: über 100 abgelehnt')
gleich(bereinigeGewichteAktien({ staerke: -5 }).fehler, 'bereich', 'Gewichte: negativ abgelehnt')
gleich(bereinigeGewichteAktien({ staerke: 'viel' }), { fehler: 'keineZahl', feld: 'staerke' }, 'Gewichte: Text abgelehnt')
ok(!('kosten' in bereinigeGewichteAktien({ kosten: 20, staerke: 40 }).wert), 'Gewichte: Funding («kosten») wird nie zur Teilnote')

// Die Route prüft nur die Aktien-Schlüssel; Coin-Schlüssel fasst sie nicht an
gleich(bereinigeAktienEinstellungen({ gewichte: { atr: 1 }, aktiv: true }).neu, {}, 'Coin-Schlüssel bleiben unberührt')
gleich(bereinigeAktienEinstellungen({ aktienZeitplan: { an: true } }).neu, { aktienZeitplan: { an: true, nachEroeffnungMin: 30, vorSchlussMin: 30 } }, 'Zeitplan einschalten wird gespeichert')
gleich(bereinigeAktienEinstellungen({ aktienZeitplan: { an: false } }).neu, { aktienZeitplan: null }, 'Zeitplan gleich der Vorgabe wird nicht eingefroren')
gleich(bereinigeAktienEinstellungen({ huerdenAktien: null, gewichteAktien: null, aktienZeitplan: null }).neu,
    { huerdenAktien: null, gewichteAktien: null, aktienZeitplan: null }, 'Vorgabe wiederherstellen für alle drei Blöcke')
gleich(bereinigeAktienEinstellungen({ gewichteAktien: { staerke: 'x' } }), { fehler: 'keineZahl', feld: 'staerke', block: 'gewichteAktien' }, 'Fehler nennt Block und Feld')
gleich(bereinigeAktienEinstellungen({ aktienZeitplan: { an: true, vorSchlussMin: 1 } }).block, 'aktienZeitplan', 'Zeitplan-Fehler nennt den Block')
for (const code of ['form', 'keineZahl', 'bereich', 'ganzzahl', 'gewichteNull', 'zeitplanAbstand']) {
    ok(fehlerText({ fehler: code }).length > 10 && fehlerText({ fehler: code }) !== fehlerText({ fehler: 'gibtsNicht' }), `Fehlertext für ${code}`)
}

// ── 4. Erfolgskontrolle gegen den Index ─────────────────────────────────
gleich(HORIZONTE[ART_AKTIEN], HORIZONTE_AKTIEN, 'Horizonte der Aktien stehen in der Erfolgskontrolle')
ok(DECKEL_JE_ART[ART_AKTIEN] > 0, 'eigene Warteschlange für die Aktien-Messung')
gleich(HORIZONTE.coinradar, { '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3 }, 'Coin-Horizonte unverändert')
gleich([DECKEL_JE_ART.frueh, DECKEL_JE_ART.hype, DECKEL_JE_ART.coinradar, DECKEL_JE_ART.abverkauf], [4, 20, 40, 10], 'Deckel der anderen Arten unverändert')
for (const [h, ms] of Object.entries(HORIZONTE_AKTIEN)) {
    const schritt = timeframeMs(KERZEN_AKTIEN[h])
    ok(schritt > 0 && ms / schritt >= 90 && ms / schritt <= 200, `Horizont ${h}: ${ms / schritt} Kerzen je Messung`)
}
// Das Messfenster hält auch mit groben Kerzen und krummer Startzeit
{
    const schritt = timeframeMs('4h')
    const von = utc(2026, 11, 16, 15, 7)
    const bis = von + HORIZONTE_AKTIEN['28d']
    const kerzen = []
    for (let t = Math.ceil(von / schritt) * schritt; t < bis; t += schritt) kerzen.push({ t, o: 100, h: 110, l: 95, c: 104 })
    const r = rechneFenster(kerzen, von, bis, schritt)
    gleich([r.renditePct, r.mfePct, r.maePct], [4, 10, -5], 'Messfenster über 28 Tage mit 4h-Kerzen')
}

{
    const lauf = Array.from({ length: 60 }, (_, i) => ({ symbol: i === 3 ? 'SPYUSDT' : `T${i}USDT`, rang: i + 1, note: 100 - i, atrPct: 2 }))
    const wahl = waehleAktienRadar(lauf, 'SPYUSDT', () => 0.5)
    const spitze = wahl.filter((z) => z.gruppe === 'spitze')
    const kontrolle = wahl.filter((z) => z.gruppe === 'kontrolle')
    gleich(spitze.length, 20, '20 Spitzenplätze')
    gleich(kontrolle.length, 10, '10 in der Kontrolle')
    ok(kontrolle.every((z) => z.rang > 30), 'Kontrolle kommt aus der unteren Hälfte')
    gleich(wahl.filter((z) => z.symbol === 'SPYUSDT').map((z) => z.gruppe), ['referenz'], 'die Referenz steht nur als Referenz da, nicht in Spitze oder Kontrolle')
    gleich(new Set(wahl.map((z) => z.symbol)).size, wahl.length, 'kein Symbol doppelt (eindeutiger Schlüssel je Lauf und Horizont)')
    ok(!waehleAktienRadar(lauf, null).some((z) => z.gruppe === 'referenz'), 'ohne Referenz im Lauf kein Referenz-Auftrag')
    gleich(waehleAktienRadar([], 'SPYUSDT').map((z) => z.gruppe), ['referenz'], 'leerer Lauf: nur die Referenz (angelegt wird ein solcher Lauf gar nicht)')
}

const zeile = (laufId, gruppe, renditePct, mehr = {}) => ({ laufId, gruppe, renditePct, maePct: -1, status: 'gemessen', ...mehr })
const lauf = (id, spitze, kontrolle, referenz) => [
    ...Array.from({ length: 8 }, () => zeile(id, 'spitze', spitze)),
    ...Array.from({ length: 6 }, () => zeile(id, 'kontrolle', kontrolle)),
    ...(referenz === null ? [] : [zeile(id, 'referenz', referenz)]),
]
{
    const l = werteAktienLaufAus(lauf(1, 3, 1, 2))
    gleich([l.mehrrendite, l.abstand, l.referenzPct], [1, 2, 2], 'Lauf: Mehrrendite gegen den Index, Abstand zur Kontrolle')
    gleich(l.vorIndex, { k: 8, n: 8 }, 'Lauf: alle acht vor dem Index')
    const ohne = werteAktienLaufAus(lauf(2, 3, 1, null))
    gleich([ohne.mehrrendite, ohne.vorIndex, ohne.abstand], [null, null, 2], 'Lauf ohne Referenz: keine Mehrrendite (nicht 0), Abstand zur Kontrolle bleibt')
    // Gemischt: Median statt Mittel, ein Ausreisser kippt das Bild nicht
    const gemischt = [...[1, 1, 1, 1, 500].map((r) => zeile(3, 'spitze', r)), zeile(3, 'referenz', 2)]
    gleich(werteAktienLaufAus(gemischt).mehrrendite, -1, 'Lauf: ein Ausreisser macht die Spitze nicht zum Sieger')
    gleich(werteAktienLaufAus(gemischt).vorIndex, { k: 1, n: 5 }, 'Lauf: nur einer von fünf vor dem Index')
    // Zu wenige gemessene Titel: kein Vergleich
    gleich(werteAktienLaufAus([zeile(4, 'spitze', 5), zeile(4, 'referenz', 1)]).mehrrendite, null, 'Lauf mit einem einzigen Titel wird nicht verglichen')
    // Offene und gescheiterte Zeilen zählen nicht
    gleich(werteAktienLaufAus([...lauf(5, 3, 1, 2), zeile(5, 'spitze', -90, { status: 'offen' })]).mehrrendite, 1, 'offene Zeilen fliessen nicht ein')
}
{
    gleich(werteAusAktien([], '7d').urteil, URTEILE_AKTIEN.zuWenig, 'ohne Daten: zu wenig')
    gleich(werteAusAktien([...lauf(1, 3, 1, 2), ...lauf(2, 3, 1, 2)], '7d').urteil, URTEILE_AKTIEN.zuWenig, 'zwei Läufe sind zu wenig')
    const viele = (spitze, kontrolle, referenz, anzahl = 12) => Array.from({ length: anzahl }, (_, i) => lauf(i + 1, spitze, kontrolle, referenz)).flat()
    const gut = werteAusAktien(viele(3, 1, 2), '7d')
    gleich(gut.urteil, URTEILE_AKTIEN.traegt, 'zwölf Läufe, Spitze vor Index und Kontrolle: trägt')
    gleich([gut.mehrrenditeMedian, gut.abstandMedian, gut.laeufeMitReferenz, gut.laeufeMitKontrolle], [1, 2, 12, 12], 'Zusammenfassung über die Läufe')
    gleich(gut.vorIndex, { k: 96, n: 96, wert: 1 }, 'Anteil vor dem Index mit Zähler und Nenner')
    gleich(gut.anzahl, 12 * 14, 'die Referenz zählt nicht als gemessener Titel')
    ok(gut.vorzeichenP < 0.05, 'zwölf von zwölf ist gesichert')
    gleich(werteAusAktien(viele(1, 0, 2), '7d').urteil, URTEILE_AKTIEN.nichtVorIndex, 'Spitze hinter dem Index')
    gleich(werteAusAktien(viele(2, 0, 2), '7d').urteil, URTEILE_AKTIEN.nichtVorIndex, 'gleichauf mit dem Index ist kein Vorsprung')
    gleich(werteAusAktien(viele(3, 4, 2), '7d').urteil, URTEILE_AKTIEN.nichtVorKontrolle, 'schlägt den Index, aber die untere Hälfte schlägt ihn stärker')
    // Sechs Läufe vorn, sechs hinten mit grösserem Vorsprung: Median positiv, aber nicht gesichert
    const wackelig = [
        ...Array.from({ length: 7 }, (_, i) => lauf(i + 1, 3, 1, 2)).flat(),
        ...Array.from({ length: 5 }, (_, i) => lauf(i + 20, 1, 0, 2)).flat(),
    ]
    gleich(werteAusAktien(wackelig, '7d').urteil, URTEILE_AKTIEN.nichtGesichert, 'sieben zu fünf ist nicht gesichert')
    // Läufe ohne Referenz zählen nicht für das Urteil gegen den Index
    const ohneRef = werteAusAktien(viele(3, 1, null), '7d')
    gleich([ohneRef.urteil, ohneRef.laeufeMitReferenz, ohneRef.laeufeMitKontrolle], [URTEILE_AKTIEN.zuWenig, 0, 12], 'ohne Referenz kein Urteil gegen den Index — nicht «trägt»')
    gleich(ohneRef.mehrrenditeMedian, null, 'ohne Referenz bleibt die Mehrrendite unbekannt, nicht 0')
}

console.log(`Aktien-Radar im Alltag: ${n} bestanden, 0 fehlgeschlagen`)
