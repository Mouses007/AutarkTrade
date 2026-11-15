/**
 * Coin-Radar, der Lauf: vom Universum zur Rangfolge.
 *
 * Der Zustand steht in der Datenbank, nicht im Speicher — ein Lauf dauert
 * Minuten und muss einen Neustart überleben. Dasselbe Muster wie bei der
 * Coin-Rangliste, aus demselben Grund; die Wiederaufnahme hängt an
 * `unique(laufId, symbol)`: „was fehlt noch" heisst „welches Symbol hat noch
 * keine Zeile".
 *
 * Die Reihenfolge der Stufen ist der eigentliche Entwurf:
 *
 *   1. Universum — nur was auf Bitunix handelbar UND bei Binance messbar ist
 *   2. Marktweite Hürden — drei Abrufe für alle, Umsatz und Spread sieben aus
 *   3. Kerzen und Kennzahlen — nur noch für die Übriggebliebenen
 *  3b. Ausführungsgüte — Orderbücher von Bitunix und Bitget, nur für dieselben
 *  3c. BTC-Vergleich — 4h-Kerzen über rund einen Monat, wieder nur für dieselben
 *   4. Bewertung und Rangfolge (ZWEI Achsen: Gelegenheit und Ausführung)
 *   5. Beharrlichkeit gegen den Vorlauf
 *
 * Stufe 2 vor Stufe 3 ist keine Sparmassnahme, sondern der Grund, warum ein
 * Lauf über sechshundert Coins in einer Minute durch ist statt in zwanzig.
 * Für Stufe 3b gilt dasselbe doppelt: ein Orderbuch je Symbol UND Börse ist
 * der teuerste Abruf des ganzen Laufs.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { holeHandelbar, holeTestbar } from '../coin-universum.js'
import { holeMarktweit, holeKerzenGebremst } from './daten.js'
import { holeAusfuehrungGebremst } from './boersen.js'
import { ladeListungen, pruefeListung } from '../hype-radar/listungen.js'
import { vergleicheMitBtc, BTC_REFERENZ, BTC_ZEITEINHEIT } from './btc-vergleich.js'
import { rechneAlle, fundingJahresRate } from './kennzahlen.js'
import {
    bewerte, pruefeHuerden, vergibRaenge, rangkorrelation,
    STANDARD_GEWICHTE, STANDARD_HUERDEN, STANDARD_HUERDEN_AKTIEN,
} from './bewertung.js'
import { rvolTageszeit, staerkeGegenIndex, staerkeImFeld, bewerteAktie, GEWICHTE_AKTIEN } from './aktien-kennzahlen.js'
import { ladeTagesdaten, INDEX } from './aktien-tagesdaten.js'
import { sitzungVon } from '../../shared/aktien-sitzung.js'
import { ladeTermine } from '../aktien/termine.js'
import { kursSymbolKandidaten } from '../newcomer-radar/kursquelle-kern.js'
import { terminListe, tageBisZahlen } from '../../shared/aktien-zahlen.js'
import * as marktdaten from '../marktdaten/index.js'
import { ladeAktienUniversum, waehleReferenz, boersenFelder } from './aktien-universum.js'

/**
 * Obergrenze der zu vermessenden Coins.
 *
 * Nicht aus Angst vor der Rechenzeit, sondern weil eine Rangliste mit
 * dreihundert Einträgen niemand liest — und weil jeder weitere Coin Gewicht
 * kostet, das die Handels-Engine gebrauchen könnte. Sortiert wird vorher nach
 * Umsatz: was ganz unten liegt, war ohnehin nie ein Kandidat.
 */
const MAX_VERMESSEN = 200

/**
 * Die Kennzahlen, die es nur für BEWERTETE Zeilen gibt.
 *
 * Ein an einer Hürde gescheiterter Coin hat keine Kerzen gesehen — für ihn
 * wurde nichts davon gerechnet. Weggelassen würden die Spalten über ihren
 * Vorgabewert zu 0, und die Datenbank behauptete eine Messung, die nie
 * stattfand. Im ersten Anlauf des Audit-Fixes war genau das übrig geblieben:
 * 412 von 494 Zeilen trugen „ATR 0", kein einziges `null`.
 */
const UNGEMESSEN = {
    note: null, fundingJahresRate: null, atrPct: null, rvol: null, adx: null,
    noteAusfuehrung: null, rundlaufBp: null,
    slippageKaufBp: null, slippageVerkaufBp: null, tiefe25Bp: null,
    // Der BTC-Vergleich braucht Kerzen — für einen an der Hürde gescheiterten
    // Coin wurde keine geholt. `null` heisst hier „nicht gemessen"; eine 0
    // hiesse „läuft unabhängig von BTC" und wäre schlicht erfunden.
    btcKorrelation: null, btcBeta: null, btcPunkte: null,
    btcKorrelationH1: null, btcKorrelationH2: null, btcZerfallZ: null,
}

/**
 * Einen Lauf durchführen.
 *
 * Mit `lauf.anlageklasse === 'aktien'` läuft dieselbe Pipeline über die
 * Aktien-Futures der Marktdatenquelle (`aktien-universum.js`): eigenes
 * Universum, eigene Hürden, Kopplung gegen einen Index-ETF statt gegen BTC.
 *
 * @param {object} lauf   Zeile aus `coinradar_laeufe`
 * @param {object} einst  Einstellungen
 * @param {function} melde Fortschritt
 * @param {function} abbruch  liefert true, wenn abgebrochen werden soll
 */
export async function fuehreLaufAus(lauf, einst, melde = () => {}, abbruch = () => false) {
    const knex = getKnex()
    const jetzt = Date.now()
    const zeiteinheiten = einst.zeiteinheiten?.length ? einst.zeiteinheiten : ['1h', '15m']
    const haupt = zeiteinheiten[0]

    // ── Stufe 1: Universum ──────────────────────────────────────────────
    melde({ schritt: 'universum' })
    const aktien = lauf.anlageklasse === 'aktien'
    let aktienTitel = null
    if (aktien) {
        // Wirft `MarktdatenAus`, bevor ein leerer Stamm als Grund herhalten muss.
        const quelle = (await marktdaten.fordere('ticker', { markt: 'futures' })).id
        aktienTitel = await ladeAktienUniversum(knex, quelle)
        if (!aktienTitel.size) {
            throw new Error('Im Stamm steht kein Aktien-Future der Marktdatenquelle. Zuerst unter «Handelbare Titel» den Abgleich laufen lassen.')
        }
    }
    const [handelbar, testbar] = aktien ? [null, null] : await Promise.all([holeHandelbar(), holeTestbar()])
    /*
     * Die Schnittmenge, nicht die Vereinigung: Ein Coin, den Bitunix führt,
     * bei Binance aber keine Kerzen hat, lässt sich nicht bewerten. Und einer
     * mit Kerzen, den Bitunix nicht führt, nützt hier nichts — gehandelt wird
     * auf Bitunix.
     */
    const universum = aktien ? [...aktienTitel.keys()] : [...handelbar.keys()].filter((s) => testbar.has(s))
    melde({ schritt: 'universum', anzahl: universum.length })

    // ── Stufe 2: marktweite Hürden ──────────────────────────────────────
    melde({ schritt: 'marktweit' })
    /*
     * Die Börsenlistungen kommen hier schon mit, obwohl sie erst in der
     * Anzeige gebraucht werden. Sie kosten drei Abrufe für den GANZEN Lauf
     * (12-Stunden-Cache in `listungen.js`), nicht einen je Coin — und so
     * bekommen auch die an einer Hürde gescheiterten Zeilen ihre Listung,
     * die sonst leer bliebe, weil sie vor Stufe 3 geschrieben werden.
     */
    const [{ jeSymbol, quellenStand }, listen] = await Promise.all([
        holeMarktweit({ alle: aktien }),
        // Aktien: «handelbar bei» steht im Stamm, die Coin-Listungen braucht es nicht.
        aktien ? null : ladeListungen().catch((e) => {
            logWarn('coin-radar', `Börsenlistungen nicht abrufbar: ${e.message}`)
            return null
        }),
    ])
    /*
     * Binance-Perp-Symbol → Basiswert, wie ihn die Listungen führen.
     *
     * Zweimal abschneiden, nicht einmal: `1000PEPEUSDT` heisst bei Bitget und
     * Pionex schlicht `PEPE`. Bliebe die Tausenderbündelung stehen, gälten
     * genau die Kleinstpreis-Coins als nirgends gelistet — und das sind nicht
     * die Ausnahmen, sondern ein guter Teil dessen, was hier oben landet.
     * `pruefeListung` prüft die Gegenrichtung ohnehin mit.
     */
    const listungFuer = (symbol) => {
        if (aktien) return boersenFelder(aktienTitel.get(symbol))
        if (!listen) return {}
        const basis = String(symbol || '').replace(/USDT$/, '').replace(/^1000+/, '')
        const { liste, unbekannt } = pruefeListung(basis, listen)
        return { liste, unbekannt }
    }
    const huerden = aktien
        ? { ...STANDARD_HUERDEN_AKTIEN, ...(einst.huerdenAktien || {}) }
        : { ...STANDARD_HUERDEN, ...(einst.huerden || {}) }
    // Woran die Kopplung gemessen wird — steht im Lauf, damit die Seite es nennen kann.
    const referenz = aktien ? waehleReferenz(aktienTitel) : { symbol: BTC_REFERENZ, ticker: 'BTC' }
    if (aktien) quellenStand.referenz = referenz

    /*
     * Ohne Umsatz oder Orderbuch-Spitze gibt es keine Hürdenprüfung — dann
     * wird abgebrochen, nicht weitergerechnet. Bis zum 07.10.2026 scheiterten
     * bei einem Ausfall von `ticker/24hr` ALLE Coins an „Umsatz zu klein"
     * (einer Behauptung, die nie gemessen wurde), der Lauf stand als „fertig"
     * mit null Coins da, verdrängte die letzte gute Rangliste und bezahlte
     * trotzdem die KI-Einordnung. Ein Fehler hält die alte Liste stehen.
     */
    const fehlend = ['umsatz', 'buch'].filter((q) => !quellenStand[q]?.ok)
    if (fehlend.length) {
        throw new Error(`Marktdaten unvollständig (${fehlend.join(', ')}): `
            + fehlend.map((q) => quellenStand[q]?.fehler || 'keine Antwort').join('; '))
    }

    const anwaerter = []
    const gescheitert = []
    for (const symbol of universum) {
        const roh = jeSymbol.get(symbol)
        if (!roh) {
            gescheitert.push({ symbol, grund: 'keine_marktdaten', roh: {} })
            continue
        }
        const urteil = pruefeHuerden(roh, huerden)
        if (urteil.ok) anwaerter.push({ symbol, roh })
        else gescheitert.push({ symbol, grund: urteil.grund, roh })
    }

    // Nach Umsatz absteigend — wer gedeckelt wird, ist der unbedeutendste.
    anwaerter.sort((a, b) => (b.roh.umsatz24h || 0) - (a.roh.umsatz24h || 0))
    const vermessen = anwaerter.slice(0, MAX_VERMESSEN)

    melde({
        schritt: 'gesiebt',
        anzahl: vermessen.length,
        verworfen: gescheitert.length,
        gesamt: universum.length,
    })

    await knex('coinradar_laeufe').where('id', lauf.id).update({
        status: 'laeuft',
        geprueft: universum.length,
        verworfenHuerde: gescheitert.length,
        gesamt: vermessen.length,
        quellenStand: JSON.stringify(quellenStand),
    })

    // Die an der Hürde Gescheiterten sofort ablegen — sie sind fertig, und
    // die Wiederaufnahme soll sie nicht erneut durchgehen.
    await schreibeZeilen(knex, lauf.id, gescheitert.map((g) => ({
        laufId: lauf.id,
        symbol: g.symbol,
        status: 'huerde',
        huerdeGrund: g.grund,
        umsatz24h: zahlOderNull(g.roh.umsatz24h),
        spreadBp: zahlOderNull(g.roh.spreadBp),
        tiefeUsd: zahlOderNull(g.roh.tiefeUsd),
        // AUSDRÜCKLICH null, nicht weggelassen: Die Spalten tragen
        // `defaultTo(0)`, und ein weggelassenes Feld wird damit zur gemessenen
        // Null. Für einen Coin, der an der Liquiditätshürde scheiterte, wurde
        // nie eine Kerze geholt — „ATR 0" wäre eine Behauptung.
        ...UNGEMESSEN,
        boersen: JSON.stringify(listungFuer(g.symbol)),
        erstelltAm: jetzt,
    })))

    // ── Stufe 3: Kerzen und Kennzahlen ──────────────────────────────────
    // Bereits vermessene Symbole überspringen (Wiederaufnahme nach Neustart).
    const fertig = new Set((await knex('coinradar_zeilen')
        .select('symbol').where({ laufId: lauf.id, status: 'bewertet' })).map((z) => z.symbol))
    const offen = vermessen.filter((a) => !fertig.has(a.symbol))

    const kerzenJeZe = {}
    for (const ze of zeiteinheiten) {
        if (abbruch()) return { abgebrochen: true }
        melde({ schritt: 'kerzen', zeiteinheit: ze, gesamt: offen.length })
        kerzenJeZe[ze] = await holeKerzenGebremst(
            offen.map((a) => a.symbol), ze,
            (f) => melde({ schritt: 'kerzen', zeiteinheit: ze, ...f }),
        )
    }

    /*
     * ── Stufe 3b: Ausführungsgüte ───────────────────────────────────────
     *
     * Was eine Order WIRKLICH kostet — Slippage über 5 000 USD, getrennt für
     * Kauf und Verkauf, auf jeder Börse, die den Coin führt. Erst hier, nach
     * den Hürden: ein Orderbuch je Symbol und Börse ist der teuerste Abruf des
     * Laufs, und für die 400 Aussortierten wäre er verschenkt.
     *
     * Das beantwortet die Frage, die der Coin-Radar im Namen trägt und bisher
     * nur ungefähr traf: nicht „bewegt sich viel", sondern „hier komme ich zu
     * einem vertretbaren Preis hinein und wieder heraus — und zwar dort".
     */
    let ausfuehrung = new Map()
    if (!abbruch()) {
        melde({ schritt: 'ausfuehrung', gesamt: offen.length })
        try {
            ausfuehrung = await holeAusfuehrungGebremst(
                offen.map((a) => a.symbol),
                (f) => melde({ schritt: 'ausfuehrung', ...f }),
                aktien
                    ? (symbol, boerse) => aktienTitel.get(symbol)?.listungen
                        .find((l) => l.handelsplatz === boerse && l.art === 'perp')?.symbol || null
                    : undefined,
            )
        } catch (e) {
            // Ohne Ausführungsdaten bleibt die Gelegenheits-Note stehen — sie
            // ist die ältere und für sich genommen brauchbare Aussage.
            logWarn('coin-radar', `Ausführungsgüte nicht messbar: ${e.message}`)
        }
    }

    /*
     * ── Stufe 3c: BTC-Vergleich ─────────────────────────────────────────
     *
     * Hängt der Coin an Bitcoin, und wie kräftig? Eigene Zeiteinheit (4h) und
     * eigener Zeitraum (200 Kerzen ≈ 33 Tage), unabhängig von `zeiteinheiten`:
     * Wer die Lauf-Zeiteinheit umstellt, soll nicht nebenbei den Zeitraum
     * verschieben, über den die Kopplung gemessen wird — zwei Läufe wären
     * sonst nicht vergleichbar.
     *
     * Kostenpunkt: 200 Coins × 2 Gewicht = 400, gemessen rund zehn Sekunden.
     * Zusammen mit dem übrigen Lauf bleibt das unter dem Eigendeckel von 1000
     * je Minute. Und weil `getClosedCandles` bis zur nächsten Kerzenöffnung
     * zwischenspeichert, kostet ein zweiter Lauf innerhalb derselben vier
     * Stunden gar nichts mehr.
     */
    const btcVergleich = new Map()
    if (!abbruch() && referenz) {
        melde({ schritt: 'btc', gesamt: offen.length })
        try {
            const btcKerzen = (await holeKerzenGebremst([referenz.symbol], BTC_ZEITEINHEIT))
                .get(referenz.symbol)
            if (btcKerzen?.length) {
                const jeSymbol4h = await holeKerzenGebremst(
                    offen.map((a) => a.symbol), BTC_ZEITEINHEIT,
                    (f) => melde({ schritt: 'btc', ...f }),
                )
                for (const [sym, kerzen] of jeSymbol4h) {
                    const v = vergleicheMitBtc(kerzen, btcKerzen)
                    if (v) btcVergleich.set(sym, v)
                }
            } else {
                /*
                 * Ohne die Referenz ist KEIN Vergleich möglich — dann bleiben
                 * alle Felder leer. Der Lauf deswegen abzubrechen wäre falsch:
                 * Gelegenheit und Ausführung stehen bereits und sind für sich
                 * brauchbar.
                 */
                logWarn('coin-radar', `${referenz.symbol} ${BTC_ZEITEINHEIT}: keine Kerzen, Vergleich entfällt`)
            }
        } catch (e) {
            logWarn('coin-radar', `BTC-Vergleich nicht möglich: ${e.message}`)
        }
    }

    /*
     * ── Stufe 3d (nur Aktien): Stärke gegen den Index ───────────────────
     *
     * Rendite über 3, 6 und 12 Monate gegen SPY und der Abstand zum
     * 52-Wochen-Hoch — aus Tageskursen der echten Aktie, nicht des Futures
     * (`aktien-tagesdaten.js`). Fällt die Kursquelle aus, läuft der Radar
     * weiter; die Stärke ist dann unbekannt und fällt aus der Note.
     */
    let tagesdaten = { je: new Map(), index: null, grund: null, gemerkt: 0, abgerufen: 0 }
    const staerkeJe = new Map()
    if (aktien && !abbruch()) {
        melde({ schritt: 'staerke', gesamt: offen.length })
        try {
            tagesdaten = await ladeTagesdaten(
                knex,
                offen.map((a) => ({ symbol: a.symbol, id: aktienTitel.get(a.symbol)?.id ?? null, ticker: aktienTitel.get(a.symbol)?.ticker })),
                (f) => melde({ schritt: 'staerke', ...f }),
            )
        } catch (e) {
            tagesdaten.grund = 'abrufFehlgeschlagen'
            logWarn('coin-radar', `Tagesdaten nicht ladbar: ${e.message}`)
        }
        const index = tagesdaten.index?.[INDEX.haupt]
        const liste = offen.map((a) => {
            const t = tagesdaten.je.get(a.symbol)
            const st = t && index ? staerkeGegenIndex(t, index) : { rs3m: null, rs6m: null, rs12m: null }
            staerkeJe.set(a.symbol, st)
            return st
        })
        // Rang im Feld der Titel, die die Hürden genommen haben — je Zeitraum, dann gemittelt.
        staerkeImFeld(liste).forEach((rang, i) => { staerkeJe.get(offen[i].symbol).rang = rang })
    }

    /*
     * ── Stufe 3e (nur Aktien): nächster Zahlentermin ────────────────────
     *
     * Wer in zwei Tagen Zahlen meldet, ist ein anderer Kandidat als einer mit
     * Ruhe bis ins nächste Quartal. Der Termin geht NICHT in die Note — er
     * steht daneben. Ein Abruf je Titel, zwölf Stunden gemerkt; bremst die
     * Quelle, hört der Lauf auf zu fragen.
     */
    const zahlenJe = new Map()
    let zahlenGrund = null
    if (aktien && !abbruch()) {
        melde({ schritt: 'zahlen', gesamt: offen.length })
        for (const [i, a] of offen.entries()) {
            const kursSymbol = kursSymbolKandidaten(aktienTitel.get(a.symbol)?.ticker)[0]
            if (!kursSymbol) continue
            const { termine, grund } = await ladeTermine(kursSymbol)
            if (grund === 'gebremst' || grund === 'quelleAus') { zahlenGrund = grund; break }
            if (termine) {
                const liste = terminListe(termine).liste
                const tage = tageBisZahlen(liste, jetzt)
                if (tage != null) zahlenJe.set(a.symbol, { tage, zeit: termine.naechster?.zeit ?? null, geschaetzt: termine.naechster?.geschaetzt === true })
            }
            if ((i + 1) % 10 === 0) melde({ schritt: 'zahlen', fertig: i + 1, gesamt: offen.length })
        }
    }

    // ── Stufe 4: Bewertung ──────────────────────────────────────────────
    melde({ schritt: 'bewerten', gesamt: offen.length })
    const gewichte = aktien
        ? { ...GEWICHTE_AKTIEN, ...(einst.gewichteAktien || {}) }
        : { ...STANDARD_GEWICHTE, ...(einst.gewichte || {}) }
    const zeilen = []

    for (const [i, a] of offen.entries()) {
        if (abbruch()) return { abgebrochen: true }
        try {
            const kerzen = {}
            for (const ze of zeiteinheiten) {
                const k = kerzenJeZe[ze]?.get(a.symbol)
                if (k) kerzen[ze] = k
            }
            const ze = rechneAlle(kerzen)

            /*
             * Ohne Kerzen auf der Hauptzeiteinheit keine Bewertung. Das als
             * Hürde zu führen wäre falsch — der Coin ist nicht illiquide,
             * es fehlen bloss die Daten. Ein eigener Grund macht das sichtbar.
             */
            if (!ze[haupt] || ze[haupt].atrPct === null) {
                zeilen.push({
                    laufId: lauf.id, symbol: a.symbol, status: 'huerde',
                    huerdeGrund: 'keine_kerzen',
                    umsatz24h: zahlOderNull(a.roh.umsatz24h),
                    spreadBp: zahlOderNull(a.roh.spreadBp),
                    tiefeUsd: zahlOderNull(a.roh.tiefeUsd),
                    ...UNGEMESSEN,
                    boersen: JSON.stringify(listungFuer(a.symbol)),
                    erstelltAm: jetzt,
                })
                continue
            }

            const jahresRate = fundingJahresRate(a.roh.fundingRate, a.roh.fundingIntervallH)
            /*
             * Aktien bekommen eine eigene Note (`aktien-kennzahlen.js`): Stärke
             * gegen den Index, Nähe zum 52-Wochen-Hoch, Volumen gegen dieselbe
             * Tageszeit. Funding zählt dort nicht mit — es steht als
             * Kostenzeile daneben.
             */
            let b, tages = null
            if (aktien) {
                const tz = rvolTageszeit(kerzen[haupt])
                const st = staerkeJe.get(a.symbol) || {}
                const t = tagesdaten.je.get(a.symbol) || null
                b = bewerteAktie({ kerzen: ze[haupt], rvol: tz?.rvol ?? null, staerkeRang: st.rang ?? null, abstandHochPct: t?.abstandHochPct ?? null }, gewichte)
                b.bestaetigt = null
                tages = {
                    rs3m: st.rs3m ?? null, rs6m: st.rs6m ?? null, rs12m: st.rs12m ?? null, staerkeRang: st.rang ?? null,
                    perf3m: t?.perf3m ?? null, perf6m: t?.perf6m ?? null, perf12m: t?.perf12m ?? null,
                    abstandHochPct: t?.abstandHochPct ?? null, quelle: t?.quelle ?? null,
                    rvolBasis: tz?.basis ?? null, rvolProben: tz?.proben ?? null, rvolAlt: ze[haupt].rvol,
                    gewichtBekannt: b.gewichtBekannt, duenn: b.duenn, sitzung: tz?.sitzung ?? null,
                    // Nächster Zahlentermin: Tage bis dahin (0 = heute oder gerade gemeldet), sonst null
                    zahlenIn: zahlenJe.get(a.symbol)?.tage ?? null, zahlenZeit: zahlenJe.get(a.symbol)?.zeit ?? null,
                    zahlenGeschaetzt: zahlenJe.get(a.symbol)?.geschaetzt ?? null,
                }
                // Die Spalte `rvol` trägt bei Aktien den tageszeitbereinigten Wert — unbekannt bleibt leer.
                ze[haupt] = { ...ze[haupt], rvol: tz?.rvol ?? null }
            } else {
                b = bewerte({ ...a.roh, fundingJahresRate: jahresRate }, ze, gewichte, haupt)
            }

            zeilen.push({
                laufId: lauf.id,
                symbol: a.symbol,
                status: 'bewertet',
                note: b.note,
                umsatz24h: zahlOderNull(a.roh.umsatz24h),
                spreadBp: zahlOderNull(a.roh.spreadBp),
                tiefeUsd: zahlOderNull(a.roh.tiefeUsd),
                fundingJahresRate: zahlOderNull(jahresRate),
                atrPct: zahlOderNull(ze[haupt].atrPct),
                rvol: zahlOderNull(ze[haupt].rvol),
                adx: zahlOderNull(ze[haupt].adx),
                // Die zweite Achse — bewusst NICHT mit `note` verrechnet.
                ...ausfuehrungsFelder(ausfuehrung.get(a.symbol)),
                ...btcFelder(btcVergleich.get(a.symbol)),
                boersen: JSON.stringify(listungFuer(a.symbol)),
                jeZeiteinheit: JSON.stringify({ ...ze, hinweise: b.hinweise, bestaetigt: b.bestaetigt, ...(tages ? { tages } : {}) }),
                teilnoten: JSON.stringify(b.teilnoten),
                erstelltAm: jetzt,
            })
        } catch (e) {
            // Ein Coin darf den Lauf nicht mitreissen.
            logWarn('coin-radar', `${a.symbol}: ${e.message}`)
        }
        if ((i + 1) % 20 === 0) melde({ schritt: 'bewerten', fertig: i + 1, gesamt: offen.length })
    }

    /*
     * Bei einer Wiederaufnahme liegen bereits bewertete Zeilen in der
     * Datenbank. Nur die neuen zu ranken hiesse, zweimal einen Rang 1 zu
     * vergeben — die Rangfolge gilt für den LAUF, nicht für den Durchgang.
     * Deshalb kommen die alten dazu, werden gemeinsam geordnet und alle
     * zurückgeschrieben.
     */
    const schon = (await knex('coinradar_zeilen')
        .where({ laufId: lauf.id, status: 'bewertet' })
        .whereNotIn('symbol', zeilen.length ? zeilen.map((z) => z.symbol) : ['']))
        // Die eigene `id` muss weg: sie zurückzuschreiben würde den
        // Schlüssel setzen wollen, den die Datenbank selbst vergibt.
        .map(({ id, ...rest }) => rest)

    const alleZeilen = [...zeilen, ...schon]
    vergibRaenge(alleZeilen)
    await schreibeZeilen(knex, lauf.id, alleZeilen)

    const bewertet = alleZeilen.filter((z) => z.status === 'bewertet')

    // ── Stufe 5: Beharrlichkeit ─────────────────────────────────────────
    // Über ALLE Zeilen des Laufs, nicht nur die dieses Durchgangs — sonst
    // vergliche eine Wiederaufnahme eine halbe Rangfolge mit einer ganzen.
    const vergleich = await beharrlichkeit(knex, lauf.id, alleZeilen, aktien ? 'aktien' : 'krypto')

    if (aktien) {
        // Woher die Stärke kam und in welcher Börsensitzung gemessen wurde — das
        // Volumen eines Sonntags ist ein anderes als das eines Dienstags um zehn.
        quellenStand.staerke = {
            ok: Boolean(tagesdaten.index) && tagesdaten.je.size > 0,
            grund: tagesdaten.grund, index: INDEX.haupt,
            mit: tagesdaten.je.size, gemerkt: tagesdaten.gemerkt, abgerufen: tagesdaten.abgerufen,
            indexPerf: tagesdaten.index?.[INDEX.haupt] || null, zweit: tagesdaten.index?.[INDEX.zweit] || null,
        }
        quellenStand.zahlen = { mit: zahlenJe.size, grund: zahlenGrund }
        quellenStand.sitzung = sitzungVon(jetzt)
        await knex('coinradar_laeufe').where('id', lauf.id).update({ quellenStand: JSON.stringify(quellenStand) })
    }

    await knex('coinradar_laeufe').where('id', lauf.id).update({
        status: 'fertig',
        beendetAm: Date.now(),
        fortschritt: alleZeilen.length,
        rangkorrelation: vergleich.wert,
        vergleichslauf: vergleich.laufId || 0,
    })

    melde({ schritt: 'fertig', bewertet: bewertet.length })
    return {
        bewertet: bewertet.length,
        verworfen: gescheitert.length,
        quellenStand,
        rangkorrelation: vergleich,
    }
}

/**
 * Die Ausführungsfelder einer Zeile.
 *
 * Fehlt die Messung, bleibt alles `null` — nicht 0. Eine Null hiesse
 * „denkbar schlechte Ausführung", und das wäre eine Behauptung über einen
 * Coin, dessen Buch wir nie gesehen haben (siehe R-10).
 */
function ausfuehrungsFelder(a) {
    if (!a?.beste) {
        /*
         * Zwei verschiedene Fälle, bis zum 07.10.2026 beide `null`: Kein Buch
         * gesehen (unbekannt) — oder Bücher gesehen, aber 5 000 USD passen auf
         * keiner Börse hinein. Das zweite ist eine MESSUNG, und zwar die
         * schlechteste: dort gibt es keine Ausführung. Sie bekommt die 0, die
         * `ausfuehrung.js` für diesen Fall verspricht.
         */
        const gemessenUnpassend = Object.values(a?.jeBoerse || {})
            .some((b) => b && b.passt5k === false)
        return {
            noteAusfuehrung: gemessenUnpassend ? 0 : null, besteBoerse: '', rundlaufBp: null,
            slippageKaufBp: null, slippageVerkaufBp: null, tiefe25Bp: null,
            jeBoerse: JSON.stringify(a?.jeBoerse || {}),
        }
    }
    const b = a.jeBoerse[a.beste.boerse]
    return {
        noteAusfuehrung: Math.round(a.beste.note),
        besteBoerse: a.beste.boerse,
        rundlaufBp: zahlOderNull(a.beste.rundlaufBp),
        slippageKaufBp: zahlOderNull(b?.slippageKaufBp),
        slippageVerkaufBp: zahlOderNull(b?.slippageVerkaufBp),
        tiefe25Bp: zahlOderNull(b?.tiefe25Bp),
        jeBoerse: JSON.stringify(a.jeBoerse),
    }
}

/**
 * Die Felder des BTC-Vergleichs.
 *
 * Ohne Ergebnis bleibt alles `null`. Der Unterschied zu einer Null ist hier
 * grösser als bei den übrigen Kennzahlen: `btcKorrelation = 0` hiesse
 * „bewegt sich nachweislich unabhängig von Bitcoin" — eine Aussage, auf die
 * jemand einen Trade stützt. Für einen frisch gelisteten Coin mit zehn Tagen
 * Historie wäre sie frei erfunden.
 */
function btcFelder(v) {
    if (!v) {
        return {
            btcKorrelation: null, btcBeta: null, btcPunkte: null,
            btcKorrelationH1: null, btcKorrelationH2: null, btcZerfallZ: null,
        }
    }
    return {
        btcKorrelation: zahlOderNull(v.korrelation),
        btcBeta: zahlOderNull(v.beta),
        btcPunkte: zahlOderNull(v.punkte),
        btcKorrelationH1: zahlOderNull(v.korrelationH1),
        btcKorrelationH2: zahlOderNull(v.korrelationH2),
        btcZerfallZ: zahlOderNull(v.zerfallZ),
    }
}

/**
 * Eine Zahl — oder `null`, wenn sie fehlt.
 *
 * Vor dem Audit vom 19.08.2026 stand hier überall `|| 0`. Die Bewertung
 * behandelte „unbekannt" korrekt (mittlere Punktzahl plus Hinweis), die
 * SPEICHERUNG warf die Unterscheidung weg — und die Oberfläche zeigte
 * anschliessend gemessene Kostenfreiheit und einen Spread von null, wo in
 * Wahrheit gar keine Quelle geantwortet hatte.
 *
 * Die Spalten sind seit jeher nullable (`defaultTo(0)` greift nur beim
 * Weglassen), es braucht also keine Migration. Altbestand bleibt bei 0 —
 * rückwirkend lässt sich „unbekannt" von „gemessen null" nicht mehr trennen.
 */
const zahlOderNull = (w) => (Number.isFinite(Number(w)) && w !== null && w !== '' ? Number(w) : null)

/**
 * Zeilen in Stücken schreiben — SQLite deckelt die Platzhalter je Anweisung.
 * `onConflict().merge()` macht den Schreibvorgang wiederholbar.
 */
async function schreibeZeilen(knex, laufId, zeilen) {
    for (let i = 0; i < zeilen.length; i += 25) {
        await knex('coinradar_zeilen')
            .insert(zeilen.slice(i, i + 25))
            .onConflict(['laufId', 'symbol'])
            .merge()
    }
}

/**
 * Sagt der vorige Lauf diesen voraus?
 *
 * Verglichen wird mit dem letzten FERTIGEN Lauf — ein abgebrochener hat eine
 * halbe Rangfolge, und die zu vergleichen ergäbe eine Zahl, die nur aussagt,
 * wie weit er gekommen ist.
 */
async function beharrlichkeit(knex, laufId, neueZeilen, anlageklasse = 'krypto') {
    try {
        // Nur gegen einen Lauf desselben Markts: Coins und Aktien teilen kein Symbol.
        const vorher = await knex('coinradar_laeufe')
            .where('status', 'fertig').andWhere('anlageklasse', anlageklasse).andWhere('id', '<', laufId)
            .orderBy('id', 'desc').first()
        if (!vorher) return { wert: null, gemeinsam: 0, laufId: 0 }

        const alt = await knex('coinradar_zeilen')
            .select('symbol', 'rang').where({ laufId: vorher.id, status: 'bewertet' })
        const r = rangkorrelation(alt, neueZeilen)
        return { ...r, laufId: vorher.id }
    } catch (e) {
        logWarn('coin-radar', `Beharrlichkeit nicht rechenbar: ${e.message}`)
        return { wert: null, gemeinsam: 0, laufId: 0 }
    }
}
