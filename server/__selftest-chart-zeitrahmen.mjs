/**
 * Lage über alle Zeitrahmen (chart-zeitrahmen.js) und ihre Prüfung in
 * `pruefeChartAuswahl`. Was still danebenginge: zwei Marken desselben Zeitrahmens
 * gelten als Bestätigung, ein fehlender Zeitrahmen wird als „offen" gezählt, oder
 * eine 4h-Marke wird mit 1h-Schlüssen geprüft.
 */
import { zeitrahmenFuer, messeZeitrahmen, findeTreffen, baueZeitrahmen, zeitrahmenText, zeitrahmenTabelle } from './chart-zeitrahmen.js'
import { pruefeChartAuswahl, baueChartEingabe } from './chart-ki.js'

let fehler = 0, gut = 0
const check = (name, ok, info = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` ${info}`}`); if (ok) gut++; else fehler++ }

const H = 3600000
const T0 = Date.UTC(2026, 9, 1)
// Steigt mit Rücksetzern: echte Wendepunkte, Struktur aufwärts
const steigend = (n, iv = H) => Array.from({ length: n }, (_, i) => {
    const m = 100 + i * 0.2 + 3 * Math.sin(i / 4)
    return { t: T0 + i * iv, o: m - 0.1, h: m + 0.5, l: m - 0.5, c: m, v: 100 }
})
const fallend = (n, iv = H) => Array.from({ length: n }, (_, i) => {
    const m = 300 - i * 0.2 + 3 * Math.sin(i / 4)
    return { t: T0 + i * iv, o: m + 0.1, h: m + 0.5, l: m - 0.5, c: m, v: 100 }
})

console.log('\nZeitrahmen\n')
{
    check('von gross nach klein', zeitrahmenFuer('1h').join() === '1w,1d,4h,1h,15m')
    check('Chart-Zeiteinheit kommt dazu und reiht sich ein', zeitrahmenFuer('5m').join() === '1w,1d,4h,1h,15m,5m' && zeitrahmenFuer('30m').join() === '1w,1d,4h,1h,30m,15m')
    check('zu wenige Kerzen: null, kein erfundener Stand', messeZeitrahmen(steigend(10), '1h') === null && messeZeitrahmen(null, '1h') === null)
    const a = messeZeitrahmen(steigend(300), '1h')
    check('Aufwärtsstruktur erkannt', a.zustand === 1, String(a.zustand))
    check('Abwärtsstruktur erkannt', messeZeitrahmen(fallend(300), '1h').zustand === -1)
    check('Lage und Momentum gemessen', a.lagePct >= 0 && a.lagePct <= 100 && Number.isFinite(a.welle) && !!a.momentum, JSON.stringify([a.lagePct, a.welle]))
    check('höchstens zwei Marken je Seite', a.marken.filter((m) => m.preis > a.kurs).length <= 2 && a.marken.filter((m) => m.preis <= a.kurs).length <= 2)
}

console.log('\nZusammentreffen\n')
{
    const m = (id, preis, quelle) => ({ id, preis, quelle })
    const tr = findeTreffen([m('Z1', 100, '4h'), m('Z2', 100.3, '1h'), m('Z3', 110, '1d')], 0.5, 101)
    check('zwei Zeitrahmen auf gleicher Höhe treffen zusammen', tr.length === 1 && tr[0].id === 'C1' && tr[0].ids.join() === 'Z1,Z2', JSON.stringify(tr))
    check('Gegenprobe: zwei Marken desselben Zeitrahmens zählen nicht', findeTreffen([m('Z1', 100, '4h'), m('Z2', 100.3, '4h')], 0.5, 101).length === 0)
    check('Gegenprobe: zu weit auseinander', findeTreffen([m('Z1', 100, '4h'), m('Z2', 101, '1h')], 0.5, 101).length === 0)
    check('eigene Zeichnung zählt als Quelle', findeTreffen([m('Z1', 100, '4h'), m('U1', 100.2, 'eigene')], 0.5, 101).length === 1)
    const nah = findeTreffen([m('A', 90, '4h'), m('B', 90.1, '1h'), m('C', 100, '4h'), m('D', 100.1, '1h')], 0.5, 101)
    check('das nächste zuerst', nah[0].ids.join() === 'C,D', JSON.stringify(nah))
    check('ungültige Toleranz: nichts', findeTreffen([m('Z1', 100, '4h'), m('Z2', 100, '1h')], 0, 101).length === 0)
}

console.log('\nDas ganze Bild\n')
const serien = { '1w': steigend(120, 7 * 24 * H), '1d': steigend(300, 24 * H), '4h': fallend(300, 4 * H), '1h': steigend(300), '15m': null }
const zr = baueZeitrahmen({ serien, interval: '1h', kurs: 150, atrChart: 1, eigene: [{ u: 'U1', art: 'POC', preis: 150 }], jetzt: T0 + 400 * H })
{
    check('fehlender Zeitrahmen bleibt unbekannt und zählt nicht als offen', zr.zeilen.find((z) => z.tf === '15m').unbekannt === true && zr.gleichlauf.auf + zr.gleichlauf.ab + zr.gleichlauf.offen === 4, JSON.stringify(zr.gleichlauf))
    check('Gleichlauf zählt die Richtungen', zr.gleichlauf.auf === 3 && zr.gleichlauf.ab === 1, JSON.stringify(zr.gleichlauf))
    check('Marken laufen über alle Zeitrahmen durch', zr.marken.every((m, i) => m.id === `Z${i + 1}` && m.tf))
    const text = zeitrahmenText(zr, (ms) => new Date(ms).toISOString())
    check('Eingabe nennt jeden Zeitrahmen', ['1w:', '1d:', '4h:', '1h:', '15m: unbekannt'].every((x) => text.includes(x)), text.slice(0, 300))
    const tab = zeitrahmenTabelle(zr)
    check('Tabelle ohne Marken, je Zeitrahmen eine Zeile', tab.length === 5 && tab.every((z) => !('marken' in z)))
}

console.log('\nPrüfung der Antwort\n')
{
    const marken = [{ id: 'Z1', tf: '4h', preis: 120 }, { id: 'Z2', tf: '1h', preis: 90 }, { id: 'Z3', tf: '1d', preis: 130 }]
    const zeit = { marken, treffen: [{ id: 'C1', preis: 120, ids: ['Z1', 'U1'], quellen: ['4h', 'eigene'] }], zeilen: [{ tf: '4h', tief: 80, hoch: 140 }, { tf: '15m', unbekannt: true }], gleichlauf: { auf: 1, ab: 0, offen: 0 } }
    const paket = { atr: 1, kurs: 100, interval: '1h', roh: [], kandidaten: [{ id: 'N1', quelle: 'niveau', preis: 105, tief: 104, hoch: 106, t1: T0 }],
        nutzer: [{ id: 'U1', zid: 7, typ: 'horizontale', name: 'Horizontale 120', preis: 120, jetzt: 120, punkte: [{ t: T0, p: 120 }] }] }
    const opt = { modus: 'zeitrahmen', zeitrahmen: zeit }
    const r = pruefeChartAuswahl({
        text: 'Die 4h liegt über [Z2]. Darüber wartet [N1].',
        bestimmend: { tf: '4h', grund: 'Dort liegt [Z1].' },
        treffen: [{ id: 'C1', text: '[Z1] und [U1] liegen gleich hoch.' }, { id: 'C9', text: 'gibt es nicht' }],
        bedingungen: [{ id: 'Z1', richtung: 'ueber', dann: 'Dann wäre [Z3] die nächste Marke.', ziel: 'Z3', kippt: true }, { id: 'Z2', richtung: 'unter', dann: 'Die Struktur wäre gebrochen.', kippt: true }, { id: 'N1', richtung: 'ueber', dann: 'x' }],
    }, paket, opt)
    check('Z-Marke wird mit Zeitrahmen und Preis eingesetzt', r.text.includes('1h-Marke') && r.text.includes('90'), r.text)
    check('Satz mit Kandidaten-ID fällt weg', !r.text.includes('N1') && !r.text.includes('Darüber') && r.verworfen.some((v) => v.art === 'text' && v.grund === 'fremdeId'), r.text)
    check('bestimmender Zeitrahmen übernommen', r.bestimmend?.tf === '4h' && r.bestimmend.grund.includes('4h-Marke'), JSON.stringify(r.bestimmend))
    check('Zusammentreffen: nur bekannte C-IDs, Preis vom Code', r.treffen.length === 1 && r.treffen[0].preis === 120 && r.verworfen.some((v) => v.art === 'treffen'), JSON.stringify(r.treffen))
    check('4h-Marke gilt mit 4h-Schlüssen', r.bedingungen[0].wenn.includes('4h-Schluss') && r.bedingungen[0].schwelle === 120, r.bedingungen[0]?.wenn)
    check('nur EINE Bedingung trägt „kippt"', r.bedingungen.filter((b) => b.kippt).length === 1 && r.bedingungen[0].kippt === true)
    check('Bedingung an Kandidaten verworfen', r.bedingungen.length === 2 && r.verworfen.some((v) => v.art === 'bedingung' && v.grund === 'fremdeId'), JSON.stringify(r.verworfen))
    const mitC = pruefeChartAuswahl({ text: 'Solange [C1] hält, bleibt es so.', bestimmend: { tf: '4h', grund: 'Dort liegt [C1].' } }, paket, opt)
    check('[C…] im Text wird zum Zusammentreffen mit Preis (erster echter Lauf: drei Sätze fielen deswegen weg)', mitC.text.includes('Zusammentreffen 120') && mitC.bestimmend?.grund.includes('Zusammentreffen 120') && !mitC.verworfen.length, JSON.stringify(mitC.verworfen))
    const dop = pruefeChartAuswahl({ text: 'Unter der 1h-Marke [Z2] liegt die Marke [Z1].' }, paket, opt)
    check('kein „1h-Marke 1h-Marke"', !dop.text.includes('Marke 1h-Marke') && !dop.text.includes('Marke 4h-Marke') && dop.text.includes('1h-Marke 90') && dop.text.includes('4h-Marke 120'), dop.text)
    const unb = pruefeChartAuswahl({ text: 'x', bestimmend: { tf: '15m', grund: 'y' } }, paket, opt)
    check('unbekannter Zeitrahmen kann nicht bestimmen', unb.bestimmend === null)
    const prog = pruefeChartAuswahl({ treffen: [{ id: 'C1', text: 'Der Kurs dürfte hier steigen.' }] }, paket, opt)
    check('Prognose-Wächter auch beim Zusammentreffen', !prog.treffen.length && prog.verworfen.some((v) => v.grund === 'prognose'))
    const ohne = pruefeChartAuswahl({ text: 'Die 1h läuft gegen die 4h.', bestimmend: { tf: '4h', grund: 'Grösserer Rahmen.' } }, { ...paket, nutzer: [] }, opt)
    check('ohne eigene Zeichnung ist die Antwort gültig', !ohne.leer && ohne.bewertungen.length === 0)
    const eing = baueChartEingabe({ symbol: 'BTCUSDT', interval: '1h', kerzen: steigend(200), hebelzonen: { oben: [{ preis: 200, usd: 5e6 }], unten: [] }, modus: 'zeitrahmen', zeitrahmen: zr })
    check('Eingabe: Zeitrahmen vorn, Liquidationszonen dabei, keine Kandidaten', eing.indexOf('ZEITRAHMEN') >= 0 && eing.includes('LIQUIDATIONSZONEN') && !eing.includes('NIVEAUS'))
}

console.log(`\n${gut} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler ? 1 : 0)
