/**
 * Krypto-Steuerbericht als eigenständiges Dokument (HTML für Druck / PDF).
 *
 * Bis 26.10.2026 war „Drucken“ die Webseite selbst: Seitenmenü, Warnboxen,
 * Knöpfe, ineinanderlaufende Spalten. Ein Steuerauszug ist ein Dokument für
 * Steueramt und Treuhand — darum ein eigenes Layout (A4, Abschnitte wie ein
 * Bankauszug), ohne ein Bedienelement. Gebaut aus demselben Ergebnis wie die
 * Seite (`berechneSteuerjahr`), damit Bildschirm, CSV und Bericht dieselben
 * Zahlen tragen.
 *
 * Rein: Daten rein, HTML raus. Jeder Text aus den Daten wird escaped — Token-
 * Namen kommen von fremden Ketten und können alles enthalten.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c])

const zahl = (v, stellen = 2) => (v == null || !Number.isFinite(Number(v)) ? '—'
    : Number(v).toLocaleString('de-CH', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }))
const chf = (v) => (v == null ? '—' : zahl(v, 2))
const menge = (v) => (v == null ? '—' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: 8 }))
const kurs = (v) => (v == null ? '—' : Number(v).toLocaleString('de-CH', { maximumSignificantDigits: 6 }))
const fx = (v) => (v == null ? '—' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 4, maximumFractionDigits: 4 }))
const tagIso = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')
/** Coin-Zelle: Kürzel, darunter der volle Name. */
const coinZelle = (asset, name, token) => `${esc(asset)}${token ? ' <small>(Token)</small>' : ''}${name ? `<br><small class="name">${esc(name)}</small>` : ''}`
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

const ART = { staking: 'Staking', airdrop: 'Airdrop', belohnung: 'Belohnung', eingeordnet: 'Ertrag' }
/** Vermögen je Ort: aus den Coin-Zeilen (ein Kurs je Coin) die Positionen je Verwahrort. */
export function vermoegenJeOrt(vermoegen) {
    const orte = new Map()
    for (const p of vermoegen) {
        for (const o of p.orte || []) {
            if (!(o.menge > 0)) continue
            const l = orte.get(o.name) || []
            l.push({
                asset: p.asset, name: p.name || null, token: !!p.token, valor: p.valor || null, menge: o.menge,
                kursChf: p.kursChf ?? null, kursQuelle: p.kursQuelle || '', chf: p.kursChf != null ? o.menge * p.kursChf : null,
            })
            orte.set(o.name, l)
        }
    }
    return [...orte].map(([name, posten]) => ({
        name, posten: posten.sort((a, b) => (b.chf ?? -1) - (a.chf ?? -1)),
        summe: posten.reduce((s, x) => s + (x.chf || 0), 0),
    })).sort((a, b) => b.summe - a.summe)
}

/**
 * @param {object} s     Ergebnis von `berechneSteuerjahr`
 * @param {{ erstellt?: number, version?: string, totalverluste?: object[] }} o
 *
 * Der Bericht ist die Beilage fürs Steueramt und enthält nur, was die Ämter
 * verlangen (LU SteuerPraxis 4/2024 Ziff. 3, LU StB Bd. 1 § 43 Nr. 2, ESTV-
 * Arbeitspapier): Bestände je Verwahrort mit Kurs und Kursquelle, Steuerwert,
 * Erträge, Bestandesrechnung und die Veränderungen samt Herkunft. Gewinne,
 * Einstand, Haltedauer und die KS-36-Kriterien zeigt nur die App.
 */
export function steuerBerichtHtml(s, o) {
    const kt = s.kanton
    const dv = s.devisen?.usdChf ? s.devisen : null
    const f = s.futures && !s.futures.fehler ? s.futures : null
    const orte = vermoegenJeOrt(s.vermoegen)
    const ohneKurs = s.vermoegen.filter((p) => p.chf == null)
    const mitKaufpreis = s.vermoegen.filter((p) => String(p.kursQuelle).startsWith('Kaufpreis'))
    const futuresChf = f?.guthabenChf || 0
    const total = s.vermoegenSumme + futuresChf
    const tvJahr = (o.totalverluste || []).filter((z) => s.jahr >= z.abJahr && z.menge > 0)
    const jeQuelle = new Map()
    for (const p of s.vermoegen) {
        const q = String(p.kursQuelle || 'kein Kurs').replace(/ \d{2}\.\d{2}\..*$/, '').replace(/ \(Ø-Einstand.*$/, '')
        jeQuelle.set(q, (jeQuelle.get(q) || 0) + 1)
    }

    const h = []
    h.push(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Krypto-Steuerbericht ${s.jahr}${kt ? ` · ${esc(kt.name)}` : ''}</title>
<link rel="stylesheet" href="bericht.css?jahr=${s.jahr}${kt ? `&amp;kt=${esc(kt.kz)}` : ''}${s.laufend ? '&amp;laufend=1' : ''}"><script src="bericht.js" defer></script></head><body>`)
    h.push(`<div class="leiste"><button id="drucken" type="button">Drucken / Als PDF speichern</button><span>Tipp: im Druckdialog „Als PDF speichern“ wählen, Kopf- und Fusszeilen des Browsers ausschalten.</span></div>`)

    // ── Kopf ──
    h.push(`<header class="kopf">
<div><h1>Krypto-Steuerbericht ${s.jahr}</h1>
<p class="unter">Vermögen am 31.12.${s.jahr} · Erträge · Veränderungen${s.laufend ? ' · <b>provisorisch (Jahr nicht abgeschlossen)</b>' : ''}</p></div>
<dl class="meta"><dt>Kanton</dt><dd>${kt ? `${esc(kt.name)} (${esc(kt.kz)})` : 'nicht gewählt'}</dd>
<dt>Stichtag</dt><dd>31.12.${s.jahr}, 23:59 Uhr (Europe/Zurich)</dd>
<dt>Erstellt</dt><dd>${datum(o.erstellt || Date.now())} · AutarkTrade ${esc(o.version || '')}</dd></dl>
</header>`)

    // ── Zusammenfassung ──
    h.push(`<section><h2>Zusammenfassung</h2><table class="zus"><tbody>
<tr><th>Kryptowährungen am 31.12.${s.jahr}</th><td class="z">CHF ${chf(s.vermoegenSumme)}</td></tr>
${f ? `<tr><th>Guthaben auf Futures-Börsen am 31.12.${s.jahr}</th><td class="z">CHF ${chf(futuresChf)}</td></tr>` : ''}
<tr class="total"><th>Steuerwert total (Wertschriftenverzeichnis)</th><td class="z">CHF ${chf(total)}</td></tr>
<tr><th>Bruttoertrag ohne Verrechnungssteuer (Rubrik B)</th><td class="z">CHF ${chf(s.einkommen.summe)}</td></tr>
${dv ? `<tr><th>Devisenkurse EZB zum ${tagIso(dv.datum)}</th><td class="z">USD/CHF ${fx(dv.usdChf)} · EUR/CHF ${fx(dv.eurChf)}</td></tr>` : ''}
</tbody></table>`)
    if (kt) {
        h.push(`<div class="uebertrag"><h3>Übertrag in die Steuererklärung — Kanton ${esc(kt.name)}</h3><table><tbody>
<tr><th>Formular</th><td>${esc(kt.formular || 'nicht geregelt')}</td></tr>
<tr><th>Rubrik / Code</th><td>${esc(kt.rubrik || 'nicht geregelt')}${kt.code ? ` · <b>Code ${esc(kt.code)}</b>` : ''}</td></tr>
<tr><th>Steuerwert</th><td>CHF ${chf(total)}</td></tr>
<tr><th>Bruttoertrag Rubrik B</th><td>CHF ${chf(s.einkommen.summe)}</td></tr>
</tbody></table></div>`)
    }
    h.push('</section>')

    // ── §1 Vermögen ──
    h.push(`<section class="neu"><h2>1 Vermögen am 31.12.${s.jahr}</h2>
<p class="erkl">Bestand je Verwahrort zum Stichtag. Kurs: ESTV-Kursliste (mit Valorennummer), sonst Tagesschlusskurs der Börse × USD/CHF der EZB am 31.12.${dv ? ` (${fx(dv.usdChf)})` : ''}${mitKaufpreis.length ? ', sonst Kaufpreis' : ''}.</p>`)
    for (const ort of orte) {
        h.push(`<h3>${esc(ort.name)}</h3><table class="pos"><thead><tr><th>Coin</th><th>Valor</th><th class="z">Menge</th><th class="z">Kurs CHF</th><th>Kursquelle</th><th class="z">Steuerwert CHF</th></tr></thead><tbody>`)
        for (const p of ort.posten) {
            h.push(`<tr><td>${coinZelle(p.asset, p.name, p.token)}</td><td>${esc(p.valor || '')}</td><td class="z">${menge(p.menge)}</td><td class="z">${kurs(p.kursChf)}</td><td class="q">${esc(p.kursQuelle)}</td><td class="z">${chf(p.chf)}</td></tr>`)
        }
        h.push(`</tbody><tfoot><tr><td colspan="5">Summe ${esc(ort.name)}</td><td class="z">${chf(ort.summe)}</td></tr></tfoot></table>`)
    }
    if (f && f.guthaben?.length) {
        h.push(`<h3>Guthaben auf Futures-Börsen</h3><table class="pos"><thead><tr><th>Börse</th><th class="z">USDT</th><th class="z">USD/CHF</th><th>Saldo</th><th class="z">Steuerwert CHF</th></tr></thead><tbody>`)
        for (const g of f.guthaben) h.push(`<tr><td>${esc(g.name)}</td><td class="z">${chf(g.usd)}</td><td class="z">${kurs(f.stichtagKurs)}</td><td class="q">${g.sicherheit === 'beleg' ? 'Kontoauszug' : 'aus dem Handelsjournal'}</td><td class="z">${chf(g.chf)}</td></tr>`)
        h.push(`</tbody><tfoot><tr><td colspan="4">Summe Futures-Guthaben</td><td class="z">${chf(futuresChf)}</td></tr></tfoot></table>`)
    }
    h.push(`<table class="zus endsumme"><tbody><tr class="total"><th>Steuerwert total</th><td class="z">CHF ${chf(total)}</td></tr></tbody></table>`)
    const fuss = []
    if (ohneKurs.length) fuss.push(`Ohne Kurs (Steuerwert nicht enthalten): ${ohneKurs.map((p) => `${esc(p.asset)} ${menge(p.menge)}`).join(', ')}.`)
    if (fuss.length) h.push(`<p class="fuss">${fuss.join('<br>')}</p>`)
    h.push('</section>')

    // ── §2 Bestandesrechnung ──
    const br = s.bestandesrechnung || []
    if (br.length) {
        const mitUebrige = br.some((z) => z.uebrige)
        h.push(`<section class="neu"><h2>2 Bestandesrechnung ${s.jahr}</h2>
<p class="erkl">Je Coin über alle Orte: Bestand am 1.1. + Zugänge − Abgänge = Bestand am 31.12. Zugänge: Käufe, Tausch, Erträge, Einzahlungen von aussen. Abgänge: Verkäufe, Tausch, Gebühren, Auszahlungen nach aussen. Umbuchungen zwischen eigenen Orten heben sich auf (verbleibende Netzgebühren zählen als Abgang).${mitUebrige ? ' „Übrige“: Ausbuchungen (Totalverlust, aufgelöste Konten) und Bestände ohne vollständige Historie.' : ''}</p>
<table class="pos"><thead><tr><th>Coin</th><th class="z">Bestand 1.1.</th><th class="z">Zugänge</th><th class="z">Abgänge</th>${mitUebrige ? '<th class="z">Übrige</th>' : ''}<th class="z">Bestand 31.12.</th></tr></thead><tbody>`)
        for (const z of br) {
            h.push(`<tr><td>${coinZelle(z.asset, z.name, !!z.kontrakt)}</td><td class="z">${menge(z.anfang)}</td><td class="z">${z.zugang ? menge(z.zugang) : ''}</td><td class="z">${z.abgang ? menge(z.abgang) : ''}</td>${mitUebrige ? `<td class="z">${z.uebrige ? (z.uebrige > 0 ? '+' : '') + menge(z.uebrige) : ''}</td>` : ''}<td class="z">${menge(z.ende)}</td></tr>`)
        }
        h.push('</tbody></table></section>')
    }

    // ── §3 Erträge ──
    h.push(`<section class="neu"><h2>3 Erträge ${s.jahr} (Rubrik B, ohne Verrechnungssteuer)</h2>
<p class="erkl">Zuflüsse aus Staking, Airdrops und Belohnungen, bewertet zum CHF-Wert im Zeitpunkt des Zuflusses.</p>`)
    if (s.einkommen.zeilen.length) {
        h.push('<table class="zus klein"><tbody>')
        for (const [art, v] of Object.entries(s.einkommen.jeArt || {})) h.push(`<tr><th>${esc(ART[art] || art)}</th><td class="z">CHF ${chf(v)}</td></tr>`)
        h.push(`<tr class="total"><th>Total Bruttoertrag</th><td class="z">CHF ${chf(s.einkommen.summe)}</td></tr></tbody></table>`)
        if (s.einkommen.jeCoin?.length) {
            h.push(`<h3>Je Coin</h3><table class="pos"><thead><tr><th>Coin</th><th class="z">Zuflüsse</th><th class="z">Menge</th><th class="z">Wert CHF</th></tr></thead><tbody>`)
            for (const c of s.einkommen.jeCoin) h.push(`<tr><td>${coinZelle(c.asset, c.name)}</td><td class="z">${c.n}</td><td class="z">${menge(c.menge)}</td><td class="z">${chf(c.chf)}${c.ohneWert ? `<sup>*</sup>` : ''}</td></tr>`)
            h.push(`</tbody><tfoot><tr><td colspan="3">Total</td><td class="z">${chf(s.einkommen.summe)}</td></tr></tfoot></table>`)
            if (s.einkommen.jeCoin.some((c) => c.ohneWert)) h.push('<p class="fuss"><sup>*</sup> enthält Zuflüsse ohne bekannten CHF-Wert (nicht im Wert).</p>')
            h.push('<h3>Einzelne Zuflüsse</h3>')
        }
        h.push(`<table class="pos"><thead><tr><th>Datum</th><th>Ort</th><th>Art</th><th>Coin</th><th class="z">Menge</th><th class="z">Wert CHF</th></tr></thead><tbody>`)
        for (const e of s.einkommen.zeilen) h.push(`<tr><td>${datum(e.zeit)}</td><td>${esc(e.quelle)}</td><td>${esc(ART[e.art] || e.art)}</td><td>${esc(e.asset)}</td><td class="z">${menge(e.menge)}</td><td class="z">${e.chfWert != null ? chf(e.chfWert) : 'ohne Wert'}</td></tr>`)
        h.push(`</tbody><tfoot><tr><td colspan="5">Total</td><td class="z">${chf(s.einkommen.summe)}</td></tr></tfoot></table>`)
        if (s.einkommen.ohneWert) h.push(`<p class="fuss">${s.einkommen.ohneWert} Zuflüsse ohne bekannten CHF-Wert (meist Kleinstbeträge) sind im Total nicht enthalten.</p>`)
    } else h.push('<p>Keine Erträge im Steuerjahr.</p>')
    h.push('</section>')

    // ── §4 Veränderungen ──
    const vg = s.veraenderungen || []
    const seite = (x) => (x ? `${menge(x.menge)} ${esc(x.asset)}${x.token ? ' <small>(Token)</small>' : ''}` : '')
    h.push(`<section class="neu"><h2>4 Veränderungen ${s.jahr}</h2>
<p class="erkl">Käufe, Verkäufe, Tausch sowie Ein- und Auszahlungen von und nach aussen, je Verwahrort. Umbuchungen zwischen eigenen Orten und Erträge (Abschnitt 3) sind nicht aufgeführt.</p>`)
    if (vg.length) {
        h.push(`<table class="pos"><thead><tr><th>Datum</th><th>Ort</th><th>Art</th><th class="z">Abgang</th><th class="z">Zugang</th><th class="z">Wert CHF</th></tr></thead><tbody>`)
        for (const v of vg) h.push(`<tr><td>${datum(v.zeit)}</td><td>${esc(v.quelle)}</td><td>${esc(v.art)}</td><td class="z">${seite(v.ab)}</td><td class="z">${seite(v.zu)}</td><td class="z">${v.chfWert != null ? chf(v.chfWert) : '—'}</td></tr>`)
        h.push('</tbody></table>')
    } else h.push('<p>Keine Veränderungen im Steuerjahr.</p>')
    h.push('</section>')

    // ── §5 Totalverluste ──
    if (tvJahr.length) {
        h.push(`<section><h2>5 Ausgebuchte Coins (Totalverlust)</h2><p class="erkl">Projekte ohne Wert (Konkurs, eingestellt); ab dem genannten Steuerjahr nicht mehr im Vermögen.</p>
<table class="pos"><thead><tr><th>Coin</th><th class="z">Menge</th><th>ab Steuerjahr</th></tr></thead><tbody>`)
        for (const z of tvJahr) h.push(`<tr><td>${esc(z.asset)}</td><td class="z">${menge(z.menge)}</td><td>${z.abJahr}</td></tr>`)
        h.push('</tbody></table></section>')
    }

    // ── Anhang: Methode ──
    h.push(`<section><h2>Anhang — Methode und Kursquellen</h2><ul class="methode">
<li>Stichtag 31.12.${s.jahr}, 23:59 Uhr Schweizer Zeit; Bestände aus den Bewegungen aller Orte (Börsen-API, Wallet-Adressen, Datei-Importe).</li>
<li>Kurse in dieser Reihenfolge: ESTV-Kursliste Kryptowährungen ${s.jahr}${s.estv?.anzahl ? ` (${s.estv.anzahl} Coins übernommen)` : ' (nicht verfügbar)'}; Tagesschlusskurs der Börse (Binance, sonst Bitget) × USD/CHF der EZB; Bitpanda bzw. CoinGecko für Coins ohne Börsenpaar${kt?.kaufpreis === true ? '; Kaufpreis als letzte Stufe' : ''}. Stablecoins zum USD/CHF-Kurs, CHF-Token 1:1.</li>
${dv ? `<li>Devisenkurse: EZB-Referenzkurs, letzter Handelstag bis ${tagIso(dv.datum)} — USD/CHF ${fx(dv.usdChf)}, EUR/CHF ${fx(dv.eurChf)}.</li>` : ''}
<li>Verwendete Kursquellen: ${[...jeQuelle].map(([q, n]) => `${esc(q)} (${n})`).join(', ')}.</li>
<li>Werbe-Tokens (Spam-Airdrops ohne Wert) sind nicht aufgeführt.</li>
</ul></section>`)
    h.push(`<footer class="ende">Krypto-Steuerbericht ${s.jahr}${kt ? ` · Kanton ${esc(kt.name)}` : ''} · erstellt ${datum(o.erstellt || Date.now())} mit AutarkTrade ${esc(o.version || '')}</footer>`)
    h.push('</body></html>')
    return h.join('\n')
}

/** Text für eine CSS-Zeichenkette: nur harmlose Zeichen (kommt aus der Adresszeile). */
const cssText = (v) => String(v ?? '').replace(/[^\p{L}\p{N} .,·()\-]/gu, '')

/**
 * Stil des Berichts. Der Seitenkopf (Jahr, Stichtag, Kanton) steht in der
 * @page-Randbox — so trägt ihn JEDE gedruckte Seite, nicht nur die erste.
 * @param {{ jahr?: number, kanton?: string, laufend?: boolean }} [o]
 */
export function berichtCss(o = {}) {
    const j = Number.isInteger(o.jahr) ? o.jahr : null
    const kopf = j ? cssText(`Krypto-Steuerbericht ${j} · Stichtag 31.12.${j}${o.laufend ? ' (provisorisch)' : ''}${o.kanton ? ` · Kanton ${o.kanton}` : ''}`) : ''
    return BERICHT_CSS.replace('/*KOPF*/', kopf ? ` @top-left { content: "${kopf}"; font: 8pt system-ui, sans-serif; color: #666; }` : '')
}

export const BERICHT_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm;/*KOPF*/ @bottom-right { content: "Seite " counter(page) " / " counter(pages); font: 8pt system-ui, sans-serif; color: #666; } }
* { box-sizing: border-box; }
body { font: 9.5pt/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; background: #fff; margin: 0 auto; max-width: 190mm; padding: 10mm 0; }
.leiste { display: flex; gap: 12px; align-items: center; padding: 10px 12px; margin-bottom: 16px; background: #f1f5f4; border: 1px solid #cfdcd9; border-radius: 6px; font-size: 9pt; color: #444; }
.leiste button { font: inherit; font-weight: 600; padding: 6px 14px; border: 0; border-radius: 4px; background: #0f766e; color: #fff; cursor: pointer; }
h1 { font-size: 18pt; margin: 0; }
h2 { font-size: 12pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #111; }
h3 { font-size: 10pt; margin: 12px 0 4px; }
.kopf { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #111; padding-bottom: 8px; }
.unter { margin: 4px 0 0; color: #444; }
.meta { display: grid; grid-template-columns: auto auto; gap: 1px 10px; margin: 0; font-size: 8.5pt; }
.meta dt { color: #666; } .meta dd { margin: 0; }
.erkl { color: #444; font-size: 8.5pt; margin: 0 0 6px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 2.5px 5px; vertical-align: top; }
.pos thead th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .03em; color: #555; border-bottom: 1px solid #111; }
.pos tbody td { border-bottom: 0.5px solid #ddd; font-size: 8.5pt; }
.pos tfoot td { border-top: 1px solid #111; font-weight: 700; }
.pos tbody th { width: 30%; font-weight: 600; border-bottom: 0.5px solid #ddd; }
.z { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.q { color: #555; font-size: 7.5pt; }
.zus { max-width: 125mm; margin: 4px 0; }
.zus.klein { max-width: 90mm; }
.zus th { font-weight: 400; } .zus td, .zus th { border-bottom: 0.5px solid #ddd; }
.zus .total th, .zus .total td { font-weight: 700; border-top: 1px solid #111; border-bottom: 0; }
.endsumme { margin-top: 10px; }
.uebertrag { margin-top: 12px; border: 1.5px solid #111; padding: 6px 10px; }
.uebertrag h3 { margin-top: 2px; }
.uebertrag th { width: 32%; color: #444; font-weight: 400; }
.fuss { font-size: 7.5pt; color: #555; margin: 6px 0 0; }
.methode { font-size: 8.5pt; padding-left: 16px; } .methode li { margin: 2px 0; }
small { color: #666; } sup { font-size: 6.5pt; color: #555; } small.name { font-size: 7.5pt; }
.ende { margin-top: 20px; padding-top: 6px; border-top: 1px solid #bbb; font-size: 7.5pt; color: #666; }
section.neu { break-before: auto; }
h2, h3 { break-after: avoid; } tr { break-inside: avoid; } thead { display: table-header-group; }
@media print { body { padding: 0; max-width: none; } .leiste { display: none; } }
`

export const BERICHT_JS = `document.getElementById('drucken')?.addEventListener('click', () => window.print())\n`
