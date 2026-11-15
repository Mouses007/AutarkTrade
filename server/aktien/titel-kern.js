/**
 * Titel-Seite einer Aktie: Yahoos `quoteSummary`-Antwort → die Felder der Seite.
 *
 * Rein, kein Netz (das Holen steht in `newcomer-radar/kursquelle.js`). Geprüft
 * gegen eine echte Antwort vom 15.11.2026 (`server/fixtures/yahoo-quotesummary-nvda.json`).
 *
 * Zwei Fallen der Quelle:
 *   - Zahlen kommen als `{raw, fmt}`, Zeitstempel teils als nackte Sekunden.
 *   - Prozentwerte sind BRÜCHE (`regularMarketChangePercent: -0.0201`,
 *     `dividendYield: 0.0061`), nur `surprisePct` der Quartale ist schon Prozent.
 *
 * Unbekannt bleibt `null` — nie 0. Ein Titel ohne Analysten hat `analysten: null`,
 * nicht «0 Analysten, Kursziel 0».
 */

/** `{raw}` oder nackte Zahl → endliche Zahl, sonst null. */
export function zahl(x) {
    const v = x && typeof x === 'object' ? x.raw : x
    return typeof v === 'number' && Number.isFinite(v) ? v : null
}
const ms = (x) => { const s = zahl(x); return s && s > 0 ? s * 1000 : null }
const pct = (x) => { const v = zahl(x); return v == null ? null : v * 100 }
const text = (x, max = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null)

/** Yahoos Stufen-Schlüssel → unsere fünf. Unbekanntes bleibt null. */
const KONSENS = { strong_buy: 'starkKauf', buy: 'kauf', hold: 'halten', underperform: 'verkauf', sell: 'starkVerkauf' }
const MAX_EINSTUFUNGEN = 15

function analysten(r) {
    const f = r.financialData || {}
    const anzahl = zahl(f.numberOfAnalystOpinions)
    const jetzt = (r.recommendationTrend?.trend || []).find((t) => t.period === '0m')
    const verteilung = jetzt ? {
        starkKauf: zahl(jetzt.strongBuy) || 0, kauf: zahl(jetzt.buy) || 0, halten: zahl(jetzt.hold) || 0,
        verkauf: zahl(jetzt.sell) || 0, starkVerkauf: zahl(jetzt.strongSell) || 0,
    } : null
    const summe = verteilung ? Object.values(verteilung).reduce((a, b) => a + b, 0) : 0
    const liste = (r.upgradeDowngradeHistory?.history || []).slice(0, MAX_EINSTUFUNGEN).map((e) => ({
        zeit: ms(e.epochGradeDate),
        firma: text(e.firm, 60),
        stufe: text(e.toGrade, 30),
        vorher: text(e.fromGrade, 30),
        // up | down | main (bestätigt) | init (neu) | reit
        aktion: text(e.action, 10),
        // 0 heisst bei Yahoo «kein Kursziel genannt»
        ziel: zahl(e.currentPriceTarget) || null,
        zielVorher: zahl(e.priorPriceTarget) || null,
    })).filter((e) => e.firma && e.zeit)
    if (!anzahl && !summe && !liste.length) return null
    return {
        anzahl: anzahl || null,
        konsens: KONSENS[f.recommendationKey] || null,
        zielTief: zahl(f.targetLowPrice), zielMittel: zahl(f.targetMeanPrice),
        zielMedian: zahl(f.targetMedianPrice), zielHoch: zahl(f.targetHighPrice),
        verteilung: summe ? verteilung : null,
        liste,
    }
}

function ertraege(r) {
    return (r.earnings?.earningsChart?.quarterly || []).map((q) => {
        const eps = zahl(q.actual), schaetzung = zahl(q.estimate)
        const ueber = Number(q.surprisePct)
        return {
            quartal: text(q.date, 10),
            ende: ms(q.periodEndDate), gemeldet: ms(q.reportedDate),
            eps, schaetzung,
            ueberraschungPct: q.surprisePct != null && q.surprisePct !== '' && Number.isFinite(ueber) ? ueber : null,
        }
    }).filter((q) => q.quartal && (q.eps != null || q.schaetzung != null))
}

const MAX_INSIDER = 150

/** Art eines Insider-Geschäfts aus Yahoos Freitext. Zuteilungen aus Vergütungsplänen sind KEIN Kauf. */
function insiderArt(text) {
    const t = String(text || '')
    if (/^Sale\b/i.test(t)) return 'verkauf'
    if (/^Purchase\b/i.test(t)) return 'kauf'
    if (/Award|Grant/i.test(t)) return 'zuteilung'
    return 'sonstig'
}

/** Streubesitz, Leerverkäufe, Anteile von Insidern und Institutionen, Insider-Geschäfte. `null`, wenn nichts davon gemeldet ist. */
function eigentum(r) {
    const k = r.defaultKeyStatistics || {}
    const streubesitz = zahl(k.floatShares), ausstehend = zahl(k.sharesOutstanding)
    const insider = (r.insiderTransactions?.transactions || []).slice(0, MAX_INSIDER).map((e) => ({
        zeit: ms(e.startDate), name: text(e.filerName, 60), rolle: text(e.filerRelation, 60),
        art: insiderArt(e.transactionText), stueck: zahl(e.shares), wert: zahl(e.value) || null,
    })).filter((e) => e.zeit)
    const aus = {
        streubesitz, ausstehend,
        streubesitzPct: streubesitz != null && ausstehend > 0 ? (streubesitz / ausstehend) * 100 : null,
        shortStueck: zahl(k.sharesShort), shortVormonatStueck: zahl(k.sharesShortPriorMonth),
        shortPctStreubesitz: pct(k.shortPercentOfFloat),
        // «Days to cover»: leerverkaufte Stücke geteilt durch das übliche Tagesvolumen
        shortTage: zahl(k.shortRatio), shortStand: ms(k.dateShortInterest),
        insiderPct: pct(k.heldPercentInsiders), institutionenPct: pct(k.heldPercentInstitutions),
        insider,
    }
    const leer = !insider.length && Object.entries(aus).every(([feld, v]) => feld === 'insider' || v == null)
    return leer ? null : aus
}

/** Barmittel, Schulden und Cashflow der letzten zwölf Monate. `null`, wenn nichts gemeldet ist. */
function kasse(r) {
    const f = r.financialData || {}
    const aus = { barmittel: zahl(f.totalCash), schulden: zahl(f.totalDebt), freierCashflow: zahl(f.freeCashflow), betrieblicherCashflow: zahl(f.operatingCashflow), bruttomargePct: pct(f.grossMargins) }
    return Object.values(aus).every((v) => v == null) ? null : aus
}

/**
 * @param {object} json  rohe `quoteSummary`-Antwort
 * @returns {{profil, kurs, kennzahlen, analysten, ertraege, termin, eigentum, kasse}}
 * @throws wenn die Antwort keinen Titel enthält
 */
export function ausZusammenfassung(json) {
    const fehler = json?.quoteSummary?.error
    if (fehler) throw new Error(fehler.description || fehler.code || 'Fehlerantwort')
    const r = json?.quoteSummary?.result?.[0]
    if (!r) throw new Error('leere Antwort')
    const p = r.price || {}, a = r.assetProfile || {}, d = r.summaryDetail || {}, k = r.defaultKeyStatistics || {}, f = r.financialData || {}
    const chef = (a.companyOfficers || []).find((o) => /\bCEO\b|Chief Executive/i.test(o?.title || ''))
    const termin = r.calendarEvents?.earnings
    return {
        profil: {
            name: text(p.longName) || text(p.shortName), art: text(p.quoteType, 20),
            boerse: text(p.exchangeName, 40), waehrung: text(p.currency, 8),
            sektor: text(a.sector, 60), branche: text(a.industry, 80), land: text(a.country, 60),
            webseite: /^https?:\/\//.test(a.website || '') ? text(a.website, 200) : null,
            mitarbeiter: zahl(a.fullTimeEmployees), chef: text(chef?.name, 80),
            beschreibung: text(a.longBusinessSummary, 1500),
        },
        kurs: {
            preis: zahl(p.regularMarketPrice), aenderung: zahl(p.regularMarketChange), aenderungPct: pct(p.regularMarketChangePercent),
            zeit: ms(p.regularMarketTime), vortag: zahl(p.regularMarketPreviousClose),
            nachPreis: zahl(p.postMarketPrice), nachPct: pct(p.postMarketChangePercent), nachZeit: ms(p.postMarketTime),
            // REGULAR | PRE | POST | CLOSED …
            zustand: text(p.marketState, 12),
        },
        kennzahlen: {
            marktkap: zahl(p.marketCap) ?? zahl(d.marketCap),
            kgv: zahl(d.trailingPE), kgvVoraus: zahl(d.forwardPE), eps: zahl(k.trailingEps),
            dividendePct: pct(d.dividendYield),
            tagTief: zahl(d.dayLow), tagHoch: zahl(d.dayHigh), jahrTief: zahl(d.fiftyTwoWeekLow), jahrHoch: zahl(d.fiftyTwoWeekHigh),
            volumen: zahl(d.volume), volumenSchnitt: zahl(d.averageVolume), beta: zahl(d.beta),
            umsatzWachstumPct: pct(f.revenueGrowth), margePct: pct(f.profitMargins ?? k.profitMargins),
        },
        analysten: analysten(r),
        ertraege: ertraege(r),
        eigentum: eigentum(r),
        kasse: kasse(r),
        termin: termin?.earningsDate?.length ? {
            zeit: ms(termin.earningsDate[0]), geschaetzt: termin.isEarningsDateEstimate === true,
            epsSchaetzung: zahl(termin.earningsAverage),
        } : null,
    }
}

/**
 * Zahlentermine aus derselben Antwort: der nächste Termin und die Meldezeitpunkte
 * der letzten Quartale (Yahoo nennt vier). Für die Simulation
 * (`shared/aktien-zahlen.js`) und die Spalte im Aktien-Radar.
 *
 * @returns {{naechster: {zeit: number, geschaetzt: boolean}|null, vergangene: number[]}}
 * @throws wenn die Antwort keinen Titel enthält
 */
export function termineAus(json) {
    const fehler = json?.quoteSummary?.error
    if (fehler) throw new Error(fehler.description || fehler.code || 'Fehlerantwort')
    const r = json?.quoteSummary?.result?.[0]
    if (!r) throw new Error('leere Antwort')
    const t = r.calendarEvents?.earnings
    const zeit = ms(t?.earningsDate?.[0])
    return {
        naechster: zeit ? { zeit, geschaetzt: t.isEarningsDateEstimate === true } : null,
        vergangene: (r.earnings?.earningsChart?.quarterly || []).map((q) => ms(q.reportedDate)).filter(Boolean).sort((a, b) => a - b),
    }
}

/**
 * Tageskerzen → Punkte für die Kurslinie der Seite: `[t, schluss]`, höchstens
 * `max` (jeder n-te, der letzte immer).
 */
export function kursLinie(kerzen = [], max = 520) {
    const schritt = Math.max(1, Math.ceil(kerzen.length / max))
    const aus = []
    kerzen.forEach((k, i) => { if (i % schritt === 0 || i === kerzen.length - 1) aus.push([k.t, k.c]) })
    return aus
}

/** Die Frage an die Websuche: was die Aktie zuletzt bewegt hat. Keine Prognose, keine Beratung. */
export function bewegungsFrage({ name, symbol, sprache = 'de' }) {
    const wer = name ? `${name} (${symbol})` : symbol
    return sprache === 'en'
        ? `What moved the stock ${wer} over the last few days? Name the concrete news with date and figures: earnings, guidance, `
            + 'analyst rating changes, management changes, regulation, deals. Sober and factual, at most 150 words. '
            + 'No investment advice, no forecasts, no price targets of your own. If there is nothing, say so in one sentence.'
        : `Was hat die Aktie ${wer} in den letzten Tagen bewegt? Nenne die konkreten Meldungen mit Datum und Zahlen: Quartalszahlen, Ausblick, `
            + 'Analysten-Einstufungen, Wechsel im Management, Regulierung, Übernahmen. Nüchtern und faktisch, auf Deutsch, höchstens 150 Wörter. '
            + 'Keine Anlageberatung, keine Prognosen, keine eigenen Kursziele. Gibt es nichts, sag das in einem Satz.'
}
