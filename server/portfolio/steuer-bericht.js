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
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

const ART = { staking: 'Staking', airdrop: 'Airdrop', belohnung: 'Belohnung', eingeordnet: 'Ertrag' }
const ERSATZ = {
    plattform: 'Jahresendkurs der Plattform, auf der gehandelt wurde', gaengigste: 'Jahresendkurs der gängigsten Börse',
    beides: 'gängigste Börse oder eigene Plattform', verkehrswert: 'Verkehrswert', fremdwaehrung: 'Kurs in USD/EUR, umgerechnet in CHF',
}
const MINING = {
    vermoegensertrag: 'Vermögensertrag', selbstaendig: 'selbständige Erwerbstätigkeit', erwerb: 'Erwerbseinkommen',
    einzelfall: 'je nach Umständen', widerspruch: 'widersprüchlich geregelt',
}

/** Vermögen je Ort: aus den Coin-Zeilen (ein Kurs je Coin) die Positionen je Verwahrort. */
export function vermoegenJeOrt(vermoegen) {
    const orte = new Map()
    for (const p of vermoegen) {
        for (const o of p.orte || []) {
            if (!(o.menge > 0)) continue
            const l = orte.get(o.name) || []
            l.push({
                asset: p.asset, token: !!p.token, valor: p.valor || null, menge: o.menge,
                kursChf: p.kursChf ?? null, kursQuelle: p.kursQuelle || '', chf: p.kursChf != null ? o.menge * p.kursChf : null,
                kaufkurs: p.kaufkurs ?? null, kostenbasis: p.kaufkurs != null ? o.menge * p.kaufkurs : null,
                sicherheit: o.sicherheit || 'beleg',
            })
            orte.set(o.name, l)
        }
    }
    return [...orte].map(([name, posten]) => ({
        name, posten: posten.sort((a, b) => (b.chf ?? -1) - (a.chf ?? -1)),
        summe: posten.reduce((s, x) => s + (x.chf || 0), 0),
    })).sort((a, b) => b.summe - a.summe)
}

const kriterienText = (k) => {
    const m = k.monate || 6
    if (k.id === 'haltedauer') return [`Haltedauer mindestens ${m} Monate`, `${Math.round((k.wert || 0) * 100)} % des Erlöses aus Coins, die kürzer als ${m} Monate gehalten wurden`]
    if (k.id === 'volumen') return ['Transaktionsvolumen höchstens das Fünffache des Vermögens am Jahresanfang',
        k.wert != null ? `Volumen CHF ${chf(k.volumen)} = ${zahl(k.wert, 1)}× des Anfangsvermögens (CHF ${chf(k.vermoegenAnfang)})` : 'Anfangsvermögen nicht bestimmbar']
    if (k.id === 'einkommen') return ['Kapitalgewinne unter 50 % des Reineinkommens', 'nicht aus den Daten bestimmbar — mit der Steuererklärung prüfen']
    if (k.id === 'fremdfinanzierung') return ['Keine Fremdfinanzierung (oder Vermögenserträge > Schuldzinsen)', 'nicht aus den Daten bestimmbar']
    if (k.id === 'derivate') return ['Derivate nur zur Absicherung', k.wert ? `${k.wert} Futures-/Derivate-Trades im Jahr` : 'keine Derivate-Trades']
    return [k.id, '']
}
const ampel = (e) => (e === true ? '<span class="ok">erfüllt</span>' : e === false ? '<span class="nein">nicht erfüllt</span>' : '<span class="offen">offen</span>')

/**
 * @param {object} s     Ergebnis von `berechneSteuerjahr`
 * @param {{ erstellt?: number, version?: string, totalverluste?: object[], rechtshinweis: string }} o
 */
export function steuerBerichtHtml(s, o) {
    const kt = s.kanton
    const f = s.futures && !s.futures.fehler ? s.futures : null
    const orte = vermoegenJeOrt(s.vermoegen)
    const ohneKurs = s.vermoegen.filter((p) => p.chf == null)
    const mitKaufpreis = s.vermoegen.filter((p) => String(p.kursQuelle).startsWith('Kaufpreis'))
    const abgeleitet = s.vermoegen.some((p) => (p.orte || []).some((x) => x.sicherheit && x.sicherheit !== 'beleg'))
    const futuresChf = f?.guthabenChf || 0
    const total = s.vermoegenSumme + futuresChf
    const halteMonate = s.kriterien.find((k) => k.id === 'haltedauer')?.monate || 6
    const tvJahr = (o.totalverluste || []).filter((z) => s.jahr >= z.abJahr)
    const jeQuelle = new Map()
    for (const p of s.vermoegen) {
        const q = String(p.kursQuelle || 'kein Kurs').replace(/ \d{2}\.\d{2}\..*$/, '').replace(/ \(Ø-Einstand.*$/, '')
        jeQuelle.set(q, (jeQuelle.get(q) || 0) + 1)
    }

    const h = []
    h.push(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Krypto-Steuerbericht ${s.jahr}${kt ? ` · ${esc(kt.name)}` : ''}</title>
<link rel="stylesheet" href="bericht.css"><script src="bericht.js" defer></script></head><body>`)
    h.push(`<div class="leiste"><button id="drucken" type="button">Drucken / Als PDF speichern</button><span>Tipp: im Druckdialog „Als PDF speichern“ wählen, Kopf- und Fusszeilen des Browsers ausschalten.</span></div>`)

    // ── Kopf ──
    h.push(`<header class="kopf">
<div><h1>Krypto-Steuerbericht ${s.jahr}</h1>
<p class="unter">Vermögen am 31.12.${s.jahr} · Erträge · Veräusserungen${s.laufend ? ' · <b>provisorisch (Jahr nicht abgeschlossen)</b>' : ''}</p></div>
<dl class="meta"><dt>Kanton</dt><dd>${kt ? `${esc(kt.name)} (${esc(kt.kz)})` : 'nicht gewählt'}</dd>
<dt>Stichtag</dt><dd>31.12.${s.jahr}, 23:59 Uhr (Europe/Zurich)</dd>
<dt>Erstellt</dt><dd>${datum(o.erstellt || Date.now())} · AutarkTrade ${esc(o.version || '')}</dd></dl>
</header>
<p class="recht"><b>Keine Steuerberatung.</b> ${esc(o.rechtshinweis)}</p>`)

    // ── Zusammenfassung ──
    h.push(`<section><h2>Zusammenfassung</h2><table class="zus"><tbody>
<tr><th>Kryptowährungen am 31.12.${s.jahr}</th><td class="z">CHF ${chf(s.vermoegenSumme)}</td></tr>
${f ? `<tr><th>Guthaben auf Futures-Börsen am 31.12.${s.jahr}</th><td class="z">CHF ${chf(futuresChf)}</td></tr>` : ''}
<tr class="total"><th>Steuerwert total (Wertschriftenverzeichnis)</th><td class="z">CHF ${chf(total)}</td></tr>
<tr><th>Bruttoertrag ohne Verrechnungssteuer (Rubrik B)</th><td class="z">CHF ${chf(s.einkommen.summe)}</td></tr>
<tr><th>Veräusserungen: Erlös / Gewinn (privat steuerfrei, zur Information)</th><td class="z">CHF ${chf(s.veraeusserungen.erloes)} / ${s.veraeusserungen.gewinn >= 0 ? '+' : ''}${chf(s.veraeusserungen.gewinn)}</td></tr>
</tbody></table>`)
    if (kt) {
        h.push(`<div class="uebertrag"><h3>Übertrag in die Steuererklärung — Kanton ${esc(kt.name)}</h3><table><tbody>
<tr><th>Formular</th><td>${esc(kt.formular || 'nicht geregelt')}</td></tr>
<tr><th>Rubrik / Code</th><td>${esc(kt.rubrik || 'nicht geregelt')}${kt.code ? ` · <b>Code ${esc(kt.code)}</b>` : ''}</td></tr>
<tr><th>Steuerwert</th><td>CHF ${chf(total)}</td></tr>
<tr><th>Bruttoertrag Rubrik B</th><td>CHF ${chf(s.einkommen.summe)}</td></tr>
<tr><th>Beilagen</th><td>${kt.belege.length ? kt.belege.map(esc).join('; ') : 'keine krypto-spezifische Vorgabe gefunden'}; dieser Bericht</td></tr>
</tbody></table></div>`)
    }
    h.push('</section>')

    // ── §1 Vermögen ──
    h.push(`<section class="neu"><h2>1 Vermögen am 31.12.${s.jahr}</h2>
<p class="erkl">Bestand je Verwahrort zum Stichtag. Kurs: ESTV-Kursliste (mit Valorennummer), sonst Tagesschlusskurs der Börse × USD/CHF der EZB am 31.12.${mitKaufpreis.length ? ', sonst Kaufpreis (Ø-Einstand), soweit der Kanton ihn zulässt' : ''}. Ø-Kaufkurs und Kostenbasis nach FIFO, zur Information.</p>`)
    for (const ort of orte) {
        h.push(`<h3>${esc(ort.name)}</h3><table class="pos"><thead><tr><th>Coin</th><th>Valor</th><th class="z">Menge</th><th class="z">Kurs CHF</th><th>Kursquelle</th><th class="z">Ø-Kaufkurs</th><th class="z">Kostenbasis</th><th class="z">Steuerwert CHF</th></tr></thead><tbody>`)
        for (const p of ort.posten) {
            const mark = p.sicherheit !== 'beleg' ? '<sup>A</sup>' : ''
            h.push(`<tr><td>${esc(p.asset)}${p.token ? ' <small>(Token)</small>' : ''}${mark}</td><td>${esc(p.valor || '')}</td><td class="z">${menge(p.menge)}</td><td class="z">${kurs(p.kursChf)}</td><td class="q">${esc(p.kursQuelle)}</td><td class="z">${kurs(p.kaufkurs)}</td><td class="z">${chf(p.kostenbasis)}</td><td class="z">${chf(p.chf)}</td></tr>`)
        }
        h.push(`</tbody><tfoot><tr><td colspan="7">Summe ${esc(ort.name)}</td><td class="z">${chf(ort.summe)}</td></tr></tfoot></table>`)
    }
    if (f && f.guthaben?.length) {
        h.push(`<h3>Guthaben auf Futures-Börsen</h3><table class="pos"><thead><tr><th>Börse</th><th class="z">USDT</th><th class="z">USD/CHF</th><th>Herkunft</th><th class="z">Steuerwert CHF</th></tr></thead><tbody>`)
        for (const g of f.guthaben) h.push(`<tr><td>${esc(g.name)}</td><td class="z">${chf(g.usd)}</td><td class="z">${kurs(f.stichtagKurs)}</td><td class="q">${g.sicherheit === 'beleg' ? 'Kontoauszug' : g.sicherheit === 'abgeleitet' ? 'zurückgerechnet (heute − Ergebnis seither)<sup>B</sup>' : 'unbekannt'}</td><td class="z">${chf(g.chf)}</td></tr>`)
        h.push(`</tbody><tfoot><tr><td colspan="4">Summe Futures-Guthaben</td><td class="z">${chf(futuresChf)}</td></tr></tfoot></table>`)
    }
    h.push(`<table class="zus endsumme"><tbody><tr class="total"><th>Steuerwert total</th><td class="z">CHF ${chf(total)}</td></tr></tbody></table>`)
    const fuss = []
    if (abgeleitet) fuss.push('<sup>A</sup> Bestand abgeleitet (aus Bewegungen rekonstruiert, nicht durch einen Auszug belegt).')
    if (f?.guthaben?.some((g) => g.sicherheit === 'abgeleitet')) fuss.push('<sup>B</sup> Ein- und Auszahlungen nach dem Stichtag sind nicht abgezogen; mit dem Kontoauszug der Börse prüfen.')
    if (ohneKurs.length) fuss.push(`Ohne Kurs (Steuerwert nicht enthalten): ${ohneKurs.map((p) => `${esc(p.asset)} ${menge(p.menge)}`).join(', ')}.`)
    if (fuss.length) h.push(`<p class="fuss">${fuss.join('<br>')}</p>`)
    h.push('</section>')

    // ── §2 Erträge ──
    h.push(`<section class="neu"><h2>2 Erträge ${s.jahr} (Rubrik B, ohne Verrechnungssteuer)</h2>
<p class="erkl">Zuflüsse aus Staking, Airdrops und Belohnungen, bewertet zum CHF-Wert im Zeitpunkt des Zuflusses.</p>`)
    if (s.einkommen.zeilen.length) {
        h.push('<table class="zus klein"><tbody>')
        for (const [art, v] of Object.entries(s.einkommen.jeArt || {})) h.push(`<tr><th>${esc(ART[art] || art)}</th><td class="z">CHF ${chf(v)}</td></tr>`)
        h.push(`<tr class="total"><th>Total Bruttoertrag</th><td class="z">CHF ${chf(s.einkommen.summe)}</td></tr></tbody></table>`)
        h.push(`<table class="pos"><thead><tr><th>Datum</th><th>Ort</th><th>Art</th><th>Coin</th><th class="z">Menge</th><th class="z">Wert CHF</th></tr></thead><tbody>`)
        for (const e of s.einkommen.zeilen) h.push(`<tr><td>${datum(e.zeit)}</td><td>${esc(e.quelle)}</td><td>${esc(ART[e.art] || e.art)}</td><td>${esc(e.asset)}</td><td class="z">${menge(e.menge)}</td><td class="z">${e.chfWert != null ? chf(e.chfWert) : 'ohne Wert'}</td></tr>`)
        h.push(`</tbody><tfoot><tr><td colspan="5">Total</td><td class="z">${chf(s.einkommen.summe)}</td></tr></tfoot></table>`)
        if (s.einkommen.ohneWert) h.push(`<p class="fuss">${s.einkommen.ohneWert} Zuflüsse ohne bekannten CHF-Wert (meist Kleinstbeträge) sind im Total nicht enthalten.</p>`)
    } else h.push('<p>Keine Erträge im Steuerjahr.</p>')
    h.push('</section>')

    // ── §3 Veräusserungen ──
    const vs = s.veraeusserungen
    h.push(`<section class="neu"><h2>3 Veräusserungen ${s.jahr} (zur Information)</h2>
<p class="erkl">Kapitalgewinne aus privatem Vermögen sind steuerfrei, Verluste nicht abziehbar. Einstand nach FIFO je Coin über alle Orte. Die Angaben dienen der Beurteilung der Gewerbsmässigkeit (Anhang A).</p>
<table class="zus klein"><tbody><tr><th>Erlös</th><td class="z">CHF ${chf(vs.erloes)}</td></tr><tr><th>Einstand</th><td class="z">CHF ${chf(vs.kosten)}</td></tr><tr class="total"><th>Gewinn / Verlust</th><td class="z">CHF ${vs.gewinn >= 0 ? '+' : ''}${chf(vs.gewinn)}</td></tr></tbody></table>`)
    if (vs.abgaenge.length) {
        h.push(`<table class="pos"><thead><tr><th>Datum</th><th>Ort</th><th>Coin</th><th class="z">Menge</th><th class="z">Erlös</th><th class="z">Einstand</th><th class="z">Gewinn</th><th class="z">&lt; ${halteMonate} Mt.</th></tr></thead><tbody>`)
        for (const a of [...vs.abgaenge].sort((x, y) => x.zeit - y.zeit)) {
            h.push(`<tr><td>${datum(a.zeit)}</td><td>${esc(a.quelle)}</td><td>${esc(a.asset)}</td><td class="z">${menge(a.menge)}</td><td class="z">${chf(a.erloes)}</td><td class="z">${chf(a.kosten)}</td><td class="z">${a.gewinn != null ? chf(a.gewinn) : '—'}</td><td class="z">${a.kurzfristigAnteil > 0 ? `${Math.round(a.kurzfristigAnteil * 100)} %` : ''}</td></tr>`)
        }
        h.push(`</tbody><tfoot><tr><td colspan="4">Total</td><td class="z">${chf(vs.erloes)}</td><td class="z">${chf(vs.kosten)}</td><td class="z">${chf(vs.gewinn)}</td><td></td></tr></tfoot></table>`)
    }
    h.push('</section>')

    // ── §4 Futures ──
    if (f && f.boersen?.length) {
        h.push(`<section><h2>4 Futures und Bots ${s.jahr} (zur Information)</h2><p class="erkl">Ergebnis der geschlossenen Positionen aus dem Journal (Jahr = Schliessdatum), in CHF zum EZB-Kurs des Tages. Im Privatvermögen steuerfrei; Derivate-Handel ist ein Indiz für Gewerbsmässigkeit.</p>
<table class="pos"><thead><tr><th>Börse</th><th class="z">Trades</th><th class="z">Gebühren USDT</th><th class="z">Funding USDT</th><th class="z">Volumen CHF</th><th class="z">Netto CHF</th></tr></thead><tbody>`)
        for (const b of f.boersen) h.push(`<tr><td>${esc(b.name)}</td><td class="z">${b.n}${b.bots ? ` (${b.bots} Bots)` : ''}</td><td class="z">${chf(b.gebuehrUsd)}</td><td class="z">${chf(b.fundingUsd)}</td><td class="z">${chf(b.volumenChf)}</td><td class="z">${chf(b.nettoChf)}</td></tr>`)
        h.push(`</tbody><tfoot><tr><td>Total</td><td class="z">${f.summe.n}</td><td class="z">${chf(f.summe.gebuehrUsd)}</td><td class="z">${chf(f.summe.fundingUsd)}</td><td class="z">${chf(f.summe.volumenChf)}</td><td class="z">${chf(f.summe.nettoChf)}</td></tr></tfoot></table></section>`)
    }

    // ── §5 Totalverluste ──
    if (tvJahr.length) {
        h.push(`<section><h2>5 Abgeschriebene Coins (Totalverlust)</h2><p class="erkl">Projekte ohne Wert (Konkurs, eingestellt). Ab dem genannten Steuerjahr nicht im Vermögen. Der Verlust ist im Privatvermögen nicht abziehbar.</p>
<table class="pos"><thead><tr><th>Coin</th><th class="z">Menge</th><th class="z">Ø-Kaufkurs</th><th class="z">Einstand CHF</th><th>ab Steuerjahr</th></tr></thead><tbody>`)
        for (const z of tvJahr) h.push(`<tr><td>${esc(z.asset)}</td><td class="z">${menge(z.menge)}</td><td class="z">${kurs(z.kaufkurs)}</td><td class="z">${chf(z.einstandChf)}</td><td>${z.abJahr}</td></tr>`)
        h.push('</tbody></table></section>')
    }

    // ── Anhang A: Kriterien ──
    h.push(`<section class="neu"><h2>Anhang A — Kriterien gewerbsmässiger Handel (ESTV-Kreisschreiben Nr. 36)</h2>
<p class="erkl">Sind alle Kriterien erfüllt, geht die Steuerverwaltung von privater Vermögensverwaltung aus. Ein nicht erfülltes Kriterium bedeutet nicht automatisch Gewerbsmässigkeit; dann wird der Einzelfall beurteilt.${halteMonate !== 6 ? ` Der Kanton nennt eine Haltedauer von ${halteMonate} Monaten; für die direkte Bundessteuer gelten nach KS 36 sechs Monate.` : ''}</p>
<table class="pos"><thead><tr><th>Kriterium</th><th>Wert</th><th>Beurteilung</th></tr></thead><tbody>`)
    for (const k of s.kriterien) { const [titel, wert] = kriterienText(k); h.push(`<tr><td>${esc(titel)}</td><td>${esc(wert)}</td><td>${ampel(k.erfuellt)}</td></tr>`) }
    h.push('</tbody></table></section>')

    // ── Anhang B: Methode ──
    h.push(`<section><h2>Anhang B — Methode und Kursquellen</h2><ul class="methode">
<li>Stichtag 31.12.${s.jahr}, 23:59 Uhr Schweizer Zeit; Bestände aus den Bewegungen aller Orte (Börsen-API, Wallet-Adressen, Datei-Importe).</li>
<li>Kurse in dieser Reihenfolge: ESTV-Kursliste Kryptowährungen ${s.jahr}${s.estv?.anzahl ? ` (${s.estv.anzahl} Coins übernommen)` : ' (nicht verfügbar)'}; Tagesschlusskurs der Börse (Binance, sonst Bitget) × USD/CHF der EZB; Bitpanda bzw. CoinGecko für Coins ohne Börsenpaar${kt?.kaufpreis === true ? '; Kaufpreis (Ø-Einstand), da der Kanton ihn als letzte Stufe zulässt' : ''}. Stablecoins zum USD/CHF-Kurs, CHF-Token 1:1.</li>
<li>Verwendete Kursquellen: ${[...jeQuelle].map(([q, n]) => `${esc(q)} (${n})`).join(', ')}.</li>
<li>Einstand und Gewinne nach FIFO je Coin über alle Orte; Umbuchungen zwischen eigenen Orten sind keine Veräusserung; Token-Umstellungen (z. B. CHSB→BORG) übernehmen Einstand und Kaufdatum.</li>
<li>Werbe-Tokens (Spam-Airdrops ohne Wert) sind nicht aufgeführt.</li>
</ul></section>`)

    // ── Anhang C: Kanton ──
    if (kt) {
        h.push(`<section><h2>Anhang C — Angaben des Kantons ${esc(kt.name)}</h2><table class="pos"><tbody>
<tr><th>Kurs ohne ESTV-Wert</th><td>${esc(kt.ersatzkurs ? ERSATZ[kt.ersatzkurs] : 'nicht geregelt')}; Kaufpreis als letzte Stufe: ${kt.kaufpreis === true ? 'ja' : kt.kaufpreis === false ? 'nicht genannt' : kt.kaufpreis === 'widerspruch' ? 'widersprüchlich' : 'nicht geregelt'}</td></tr>
<tr><th>Erträge</th><td>${esc(kt.ertraege || 'nicht geregelt')}${kt.ertragZeitpunkt ? ` (Bewertung: ${esc(kt.ertragZeitpunkt)})` : ''}</td></tr>
<tr><th>Mining</th><td>${esc(kt.mining ? MINING[kt.mining] : 'nicht geregelt')}</td></tr>
<tr><th>Gewerbsmässigkeit</th><td>${esc(kt.gewerbs || 'nicht geregelt')}</td></tr>
<tr><th>Quellen</th><td>${kt.quellen.map((q) => `${esc(q.name)} (${esc(q.fassung)})<br><small>${esc(q.url)}</small>`).join('<br>')}</td></tr>
</tbody></table></section>`)
    }
    h.push(`<footer class="ende">Krypto-Steuerbericht ${s.jahr}${kt ? ` · Kanton ${esc(kt.name)}` : ''} · erstellt ${datum(o.erstellt || Date.now())} mit AutarkTrade ${esc(o.version || '')} · Keine Steuerberatung</footer>`)
    h.push('</body></html>')
    return h.join('\n')
}

export const BERICHT_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-right { content: "Seite " counter(page) " / " counter(pages); font: 8pt system-ui, sans-serif; color: #666; } }
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
.recht { font-size: 8pt; color: #333; border: 1px solid #bbb; padding: 6px 8px; margin: 10px 0 0; }
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
.ok { color: #166534; } .nein { color: #b91c1c; font-weight: 600; } .offen { color: #92400e; }
small { color: #666; } sup { font-size: 6.5pt; color: #555; }
.ende { margin-top: 20px; padding-top: 6px; border-top: 1px solid #bbb; font-size: 7.5pt; color: #666; }
section.neu { break-before: auto; }
h2, h3 { break-after: avoid; } tr { break-inside: avoid; } thead { display: table-header-group; }
@media print { body { padding: 0; max-width: none; } .leiste { display: none; } }
`

export const BERICHT_JS = `document.getElementById('drucken')?.addEventListener('click', () => window.print())\n`
