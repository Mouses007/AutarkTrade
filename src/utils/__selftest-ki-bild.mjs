/**
 * Selbsttest: das Bild für die Chart-KI enthält keine Kontowerte — ohne Browser.
 *
 *   node src/utils/__selftest-ki-bild.mjs
 *
 * Audit 4.3.4, SEC-L6-001 (01.11.2026): „Meine Zeichnungen analysieren" schickt
 * immer ein Bild des sichtbaren Charts an den Anbieter. Darin stand der Text-Block
 * des Positionsrechners („Einsatz 2.5 % vom Konto", „Stop −50 USDT (0.41 % Konto)")
 * — der Kontostand der Börse liess sich daraus auf 1–2 % genau zurückrechnen —
 * und das Netto-Ergebnis der Journal-Trades in USDT. `ChartPanel.bildschirmfoto`
 * schaltet für dieses Bild den Fotomodus der Ebenen ein (`setzeFoto`); geprüft
 * wird hier, was die Ebenen dann noch beschriften. Gegenprobe: ohne Fotomodus
 * bleibt alles wie vorher (das Kamera-Bild des Nutzers ändert sich nicht).
 * Nachbesserung: auch der Titel der Einstiegslinie einer offenen Börsen-Position
 * („Long 0.045766 · +12.34" — Menge und Live-P&L) stand im Bild; im Fotomodus
 * steht dort nur „Long"/„Short" (`positionsTitel(…, { foto })`).
 */
import { readFileSync } from 'node:fs'
let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nPositionsrechner im KI-Bild\n')
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const ctx = { measureText: (t) => ({ width: t.length * 7 }) }
    const beschrifte = (foto, stop) => {
        const e = Object.create(ZeichenEbene.prototype)
        const texte = []
        Object.assign(e, { konto: 12345.67, mmr: 0.004, zuY: () => 100, linie() {}, formatPreis: (p) => p.toFixed(1), beschriftung: (c, t) => texte.push(t), requestUpdate() {} })
        e.setzeFoto(foto)
        e.zeichneRechner(ctx, [{ t: 1, p: 77600 }, { t: 2, p: 79400 }, { t: 0, p: stop }], { modus: 'risiko', betrag: 50, hebel: stop < 75000 ? 20 : 10, konto: 0, gebuehrPct: 0.06 }, 0, 200, 100, 200, 600, false)
        return texte
    }
    const normal = beschrifte(false, 76600)
    check('Gegenprobe ohne Fotomodus: Beträge und Kontoanteile stehen da', normal.some((t) => /vom Konto/.test(t)) && normal.some((t) => /% Konto/.test(t)) && normal.some((t) => /USDT/.test(t)), JSON.stringify(normal))
    const foto = beschrifte(true, 76600)
    check('Fotomodus: nur die Liq-Linie, kein USDT, kein Kontoanteil', foto.length === 1 && foto[0].startsWith('Liq ') && !foto.some((t) => /USDT|Konto/.test(t)), JSON.stringify(foto))
    const liq = beschrifte(true, 70000)
    check('Fotomodus mit Liq vor dem Stop: Warnung ohne Betrag', liq.some((t) => t === '⚠ Liq vor dem Stop') && !liq.some((t) => /USDT/.test(t)), JSON.stringify(liq))
    check('Gegenprobe: Warnung ohne Fotomodus mit Betrag', beschrifte(false, 70000).some((t) => /^⚠ Liq vor dem Stop — Verlust .* USDT$/.test(t)))
}

console.log('\nJournal-Trades im KI-Bild\n')
{
    const { JournalEbene } = await import('./chart/overlays/JournalEbene.js')
    const texte = (foto) => {
        const e = Object.create(JournalEbene.prototype)
        Object.assign(e, { zuX: (t) => t, zuY: (p) => 1000 - p, hervor: null, requestUpdate() {} })
        e.setzeFoto(foto)
        const aus = []
        const ctx = { measureText: (t) => ({ width: t.length * 7 }), fillText: (t) => aus.push(t), fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, arc() {}, setLineDash() {}, save() {}, restore() {} }
        e.zeichneTrade(ctx, { id: 1, richtung: 'long', einstieg: { t: 100, p: 500 }, ausstieg: { t: 200, p: 520 }, r: 1.5, netto: 123.45 }, 800)
        return aus
    }
    check('Gegenprobe ohne Fotomodus: R und Netto', texte(false).some((t) => t.includes('+1.50R') && t.includes('+123.45')), JSON.stringify(texte(false)))
    check('Fotomodus: nur R, kein Netto-Betrag', texte(true).some((t) => t.includes('+1.50R')) && !texte(true).some((t) => t.includes('123.45')), JSON.stringify(texte(true)))
}

console.log('\nOffene Positionen im KI-Bild\n')
{
    const { positionsTitel } = await import('./chart/overlays/positionsTitel.js')
    const long = { richtung: 'long', einstieg: 2430.37, menge: 0.045766 }
    const short = { richtung: 'short', einstieg: 2430.37, menge: 0.045766 }
    check('Gegenprobe ohne Fotomodus: Menge und Live-P&L im Titel', positionsTitel(long, 2700) === 'Long 0.045766 · +12.34', positionsTitel(long, 2700))
    check('Fotomodus: nur „Long", keine Menge, kein P&L', positionsTitel(long, 2700, { foto: true }) === 'Long', positionsTitel(long, 2700, { foto: true }))
    check('Fotomodus: nur „Short", auch ohne Kurs', positionsTitel(short, 2700, { foto: true }) === 'Short' && positionsTitel(short, null, { foto: true }) === 'Short')
    // Verdrahtung: bildschirmfoto setzt die Titel um das Foto herum um und danach zurück.
    const panel = readFileSync(new URL('../components/chart/ChartPanel.vue', import.meta.url), 'utf8')
    const i = panel.indexOf('function bildschirmfoto(')
    const rumpf = i < 0 ? '' : panel.slice(i, panel.indexOf('\n}\n', i))
    const an = rumpf.indexOf('fotoModus = true'), foto = rumpf.indexOf('takeScreenshot(true)', an), aus = rumpf.indexOf('fotoModus = false', foto)
    check('bildschirmfoto: Fotomodus der Positionslinien vor dem Foto an, danach aus, Titel jeweils nachgeführt',
        an > 0 && foto > an && aus > foto && rumpf.slice(an, foto).includes('aktualisierePositionsTitel()') && rumpf.slice(aus).includes('aktualisierePositionsTitel()'))
    check('positionsTitel im Panel liest den Fotomodus', /function positionsTitel\(pos, kurs\) \{\s*return positionsTitelFuer\(pos, kurs, \{ foto: fotoModus \}\)/.test(panel))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
