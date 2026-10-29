/**
 * Selbsttest: den Chart vermessen (chart-kandidaten.js).
 *
 *   node server/__selftest-chart-kandidaten.mjs
 *
 * Was hier steht, ist das Einzige, was das Modell an Geometrie sieht — eine
 * falsch gruppierte Marke oder eine Linie, durch die Kerzen wachsen, kann es
 * nur noch auswählen, nicht mehr korrigieren.
 */
import fs from 'node:fs'
import { atr as atrReihe } from '../shared/indicators.js'
import { profilAbschnitte, konsolidierungen, periodenAbschnitte, kandidatenKanaele, kanalName, kanalKurz, kanalBeschriftung, fahnenstange, kandidatenNiveaus, waehleNiveaus, kandidatenTrendlinien, marktstruktur, baueKandidaten, kandidatenText, KAND, seitwaertsPhasen, massstab } from './chart-kandidaten.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3600e3
const T0 = 1_760_000_000_000
// Kerze mit Hoch h und Tief l, Spanne 2 (→ ATR ≈ 2)
const kz = (i, h, c = h - 1, v = 100) => ({ t: T0 + i * H, o: c, h, l: h - 2, c, v })

/** Seitwärts bei 100 (Hochs 95…), mit Spitzen an gegebenen Stellen. */
function reiheMitSpitzen(spitzen, n = 80) {
    return Array.from({ length: n }, (_, i) => kz(i, spitzen[i] ?? 95))
}

console.log('\nNiveaus\n')
{
    // drei Hochs bei 100 ± 0,2 (ATR ≈ 2) → ein Niveau mit drei Berührungen
    const k = reiheMitSpitzen({ 10: 100, 30: 100.3, 50: 99.8 })
    const nv = kandidatenNiveaus(k)
    const n100 = nv.filter((x) => x.preis > 99 && x.preis < 101)
    check('drei nahe Hochs → genau ein Niveau mit 3 Berührungen', n100.length === 1 && n100[0].beruehrungen === 3, JSON.stringify(n100.map((x) => [x.preis, x.beruehrungen])))
    const k2 = reiheMitSpitzen({ 10: 100, 30: 103 })
    check('Gegenprobe: zwei Hochs 1,5 ATR auseinander → zwei Niveaus', kandidatenNiveaus(k2).filter((x) => x.preis > 99).length === 2)
}
{
    // Kette 100, 100.8, 101.6, 102.4 (Nachbarabstand 0,4 ATR) darf nicht beliebig breit werden
    const k = reiheMitSpitzen({ 10: 100, 20: 100.8, 30: 101.6, 40: 102.4, 50: 103.2 })
    const breit = kandidatenNiveaus(k).filter((x) => x.preis > 99)
    const atr = 2
    check('lange Kette: keine Gruppe breiter als 1 ATR', breit.every((x) => x.hoch - x.tief <= KAND.CLUSTER_MAX_ATR * atr + 0.6), JSON.stringify(breit.map((x) => [x.tief, x.hoch])))
}
{
    // Seitwärts um 100 VOR dem Niveau bei 110 zählt nicht als Durchquerung
    const k = Array.from({ length: 80 }, (_, i) => {
        if (i < 30) return kz(i, i % 2 ? 112 : 108, i % 2 ? 111 : 107)  // vorher: Schlüsse um 110 herum
        if (i === 40 || i === 60) return kz(i, 110, 108)
        return kz(i, 104, 103)
    })
    const n = kandidatenNiveaus(k).find((x) => Math.abs(x.preis - 110) < 0.5 && x.beruehrungen >= 2)
    check('Durchquerungen erst ab der ersten Berührung', n && n.durchquerungen <= 1, JSON.stringify(n))
}
{
    // absolutes Hoch an der vorletzten Kerze (kein bestätigter Pivot) ist trotzdem ein Niveau
    const k = reiheMitSpitzen({ 78: 120 })
    const n = kandidatenNiveaus(k)
    check('absolutes Hoch am Rand → Niveau mit extrem = hoch', n.some((x) => x.extrem === 'hoch' && x.preis === 120))
}
{
    const viele = Array.from({ length: 12 }, (_, i) => ({ preis: 110 + i, beruehrungen: 3, guete: 10 - i * 0.1, reaktionMaxAtr: 4, durchquerungen: 0 }))
    viele.push({ preis: 99, beruehrungen: 2, guete: 0.1, reaktionMaxAtr: 1, durchquerungen: 0 })
    const w = waehleNiveaus(viele, 100)
    check('Auswahl: das schwache, aber nahe Niveau unter dem Kurs ist dabei', w.some((x) => x.preis === 99))
    check('Gegenprobe: höchstens MAX_NIVEAUS', w.length <= KAND.MAX_NIVEAUS)
}

console.log('\nTrendlinien\n')
{
    // wie BTC 4h: Top bei 8, echte Abwärtslinie an den Hochs 20, 40, 60
    const linie = (i) => 125 - 0.85 * (i - 20)
    const k = Array.from({ length: 75 }, (_, i) => {
        let h = linie(i) - 6
        if (i === 20 || i === 40 || i === 60) h = linie(i)
        if (i === 8) h = 132
        return { t: T0 + i * H, o: h - 2, h, l: h - 3, c: h - 1, v: 100 }
    })
    const t = kandidatenTrendlinien(k, 3)
    check('echte Abwärtslinie 20 → 60 gefunden', t.some((x) => x.seite === 'hoch' && x.t1 === T0 + 20 * H && x.t2 === T0 + 60 * H && x.beruehrungen === 3), JSON.stringify(t))
    check('Gegenprobe: keine Linie vom Top (8), durch die Kerzen wachsen', !t.some((x) => x.t1 === T0 + 8 * H))
    // fast flach: zwei Hochs 0,3 ATR auseinander → waagerechte Marke, keine Trendlinie
    const flach = reiheMitSpitzen({ 10: 100, 40: 100.6 })
    check('fast flache Linie zwischen den zwei Spitzen (< 0,75 ATR Höhenunterschied) kommt nicht',
        !kandidatenTrendlinien(flach, 2).some((x) => x.t1 === T0 + 10 * H && x.t2 === T0 + 40 * H))
}

console.log('\nStruktur\n')
{
    // Treppe aufwärts, dann Schluss unter das letzte Tief
    const k = []
    let i = 0
    for (let w = 0; w < 5; w++) {
        for (let j = 0; j < 5; j++, i++) k.push({ t: T0 + i * H, o: 0, h: 100 + w * 4 + j, l: 98 + w * 4 + j, c: 99 + w * 4 + j, v: 1 })
        for (let j = 0; j < 3; j++, i++) k.push({ t: T0 + i * H, o: 0, h: 104 + w * 4 - j, l: 102 + w * 4 - j, c: 103 + w * 4 - j, v: 1 })
    }
    const auf = marktstruktur(k)
    check('Treppe aufwärts → Zustand 1, letzter Bruch aufwärts', auf.zustand === 1 && auf.bruch?.richtung === 'auf', JSON.stringify(auf))
    const tiefster = Math.min(...auf.tiefs.map((x) => x.p))
    for (let j = 0; j < 6; j++, i++) k.push({ t: T0 + i * H, o: 0, h: 110 - j * 3, l: 108 - j * 3, c: 108.5 - j * 3, v: 1 })
    const ab = marktstruktur(k)
    check('danach Schluss unter dem letzten Tief → Bruch abwärts', ab.bruch?.richtung === 'ab' && ab.bruch.marke >= tiefster, JSON.stringify(ab.bruch))
}

console.log('\nPaket\n')
{
    const k = Array.from({ length: 150 }, (_, i) => {
        const m = 100 + 6 * Math.sin(i / 9) + 2 * Math.sin(i / 3)
        return { t: T0 + i * H, o: m - 0.4, h: m + 1, l: m - 1, c: m + 0.4, v: 500 + (i % 7) * 50 }
    })
    const a = baueKandidaten({ kerzen: k, interval: '1h' })
    const b = baueKandidaten({ kerzen: k, interval: '1h' })
    check('gleiche Kerzen → gleiche IDs und Preise (deterministisch)', JSON.stringify(a.kandidaten) === JSON.stringify(b.kandidaten))
    check('IDs je Quelle: N…, V1–V3', a.kandidaten.some((x) => x.id === 'N1') && ['V1', 'V2', 'V3'].every((id) => a.kandidaten.some((x) => x.id === id)))
    const v = a.kandidaten.filter((x) => x.quelle === 'volumenprofil')
    check('V nahe an einem N trägt „deckt"', v.every((x) => x.deckt === null || /^N\d+$/.test(x.deckt)))
    const text = kandidatenText(a)
    check('Text bei 150 Kerzen unter 3500 Zeichen', text.length < 3500, String(text.length))
    check('Gegenprobe: keine 150 Zeitstempel im Text (nur die letzten 12 roh)', (text.match(/\d\d\.\d\d\. \d\d:\d\d,/g) || []).length === KAND.ROH_KERZEN)
    check('zu wenige Kerzen → null statt halber Vermessung', baueKandidaten({ kerzen: k.slice(0, 20) }) === null)
}

console.log('\nProfil-Abschnitte\n')
{
    // Drei Bewegungen à 30 Kerzen: auf 100→129, ab 128→99, wieder auf 100→114.5 — ATR ≈ 1
    const k = []
    const kerze = (t, m) => ({ t: t * 3_600_000, o: m, h: m + 0.5, l: m - 0.5, c: m, v: 100 })
    for (let i = 0; i < 30; i++) k.push(kerze(k.length, 100 + i))
    for (let i = 0; i < 30; i++) k.push(kerze(k.length, 128 - i))
    for (let i = 0; i < 30; i++) k.push(kerze(k.length, 100 + i * 0.5))
    const ab = profilAbschnitte(k, 1, { schwelle: 5, minKerzen: 15, max: 3 })
    check('Wendepunkte Hoch (29) und Tief (59) → drei Abschnitte', ab.length === 3 && ab[0].bis === 29 && ab[1].von === 29 && ab[1].bis === 59 && ab[2].bis === 89, JSON.stringify(ab))
    const flach = Array.from({ length: 40 }, (_, i) => kerze(i, 100 + (i % 2)))
    const fa = profilAbschnitte(flach, 1)
    check('Gegenprobe: ohne Wendepunkt EIN Abschnitt über alles', fa.length === 1 && fa[0].von === 0 && fa[0].bis === 39, JSON.stringify(fa))
    const p = baueKandidaten({ kerzen: k, interval: '1h' })
    const v = p.kandidaten.filter((x) => x.quelle === 'volumenprofil')
    check('je Abschnitt POC/VAH/VAL mit Zeitraum, A1 = jüngster', v.length === 9 && v[0].abschnitt === 'A1' && v[0].t2 === k[89].t && v[0].t1 === k[59].t, JSON.stringify(v.slice(0, 3)))
}

const kerzenIndex = (k, t) => k.findIndex((x) => x.t === t)
console.log('\nKonsolidierungen, Tage/Wochen, Kanäle und Flaggen (24.10.2026)\n')
{
    const H = 3_600_000
    const kerze = (t, m, sp = 0.5) => ({ t: t * H, o: m - 0.1, h: m + sp, l: m - sp, c: m + 0.1, v: 100 })
    const zick = (i) => { const p = i % 10; return (p < 5 ? p : 10 - p) * 0.6 - 1.5 }
    // Anstieg 100→129, dann seitwärts um 129
    const k3 = []
    for (let i = 0; i < 30; i++) k3.push(kerze(i, 100 + i))
    for (let i = 0; i < 30; i++) k3.push(kerze(k3.length, 129 + (i % 3) * 0.4))
    const ko = konsolidierungen(k3, 1)
    check('Seitwärtsphase nach dem Anstieg ist eine Konsolidierung, der Anstieg nicht', ko.length === 1 && ko[0].bis === 59 && ko[0].von >= 25 && ko[0].von <= 30, JSON.stringify(ko))
    const kv = baueKandidaten({ kerzen: k3, interval: '1h' }).kandidaten.filter((x) => x.quelle === 'volumenprofil')
    check('Volumenprofil über der Konsolidierung (bereich konsolidierung, Zeitraum der Phase)', kv.length === 3 && kv[0].bereich === 'konsolidierung' && kv[0].t1 === k3[ko[0].von].t && kv[0].t2 === k3[59].t, JSON.stringify(kv.slice(0, 1)))
    // Drei Tage Stundenkerzen
    const k4 = Array.from({ length: 72 }, (_, i) => kerze(i, 100))
    const tage = periodenAbschnitte(k4, 'tag')
    check('Tage: drei Abschnitte à 24 Kerzen (UTC)', tage.length === 3 && tage.every((x) => x.bis - x.von === 23))
    check('Woche ab Montag: 01.–03.01.1970 liegen in derselben Woche', periodenAbschnitte(k4, 'woche').length === 1)
    const wk = baueKandidaten({ kerzen: k4.map((x, i) => ({ ...x, c: 100 + (i % 5) * 0.2 })), interval: '1h', profilArt: 'tag' }).kandidaten.filter((x) => x.quelle === 'volumenprofil')
    check('profilArt tag → je Tag ein Profil', new Set(wk.map((x) => x.abschnitt)).size === 3 && wk.every((x) => x.bereich === 'tag'))
    // Fahnenstange 100→129, danach fallender Kanal mit Zickzack: Bull-Flagge
    const k = []
    for (let i = 0; i < 30; i++) k.push(kerze(k.length, 100 + i))
    for (let i = 0; i < 40; i++) k.push(kerze(k.length, 129 - i * 0.12 + zick(i)))
    const [f] = kandidatenKanaele(k, 1)
    check('Stange auf + fallender Kanal = Bull-Flagge', f?.muster === 'bullFlagge' && f.richtung === 'ab' && f.beruehrOben >= 2 && f.beruehrUnten >= 2, JSON.stringify(f && { m: f.muster, r: f.richtung, o: f.beruehrOben, u: f.beruehrUnten }))
    check('Name vom Code', kanalName(f) === `Bull-Flagge (${f.beruehrOben}/${f.beruehrUnten} Berührungen)`)
    check('Kanten parallel: unten jetzt + Breite = oben jetzt', Math.abs(f.untenJetzt + f.breite - f.obenJetzt) < 1e-9)
    // Gespiegelt: Bear-Flagge
    const g = k.map((x) => ({ ...x, o: 300 - x.o, c: 300 - x.c, h: 300 - x.l, l: 300 - x.h }))
    check('gespiegelt: Stange ab + steigender Kanal = Bear-Flagge', kandidatenKanaele(g, 1)[0]?.muster === 'bearFlagge')
    // Steigender Kanal ohne Stange: kein Muster, aber Kanal
    const k2 = Array.from({ length: 80 }, (_, i) => kerze(i, 100 + i * 0.1 + zick(i)))
    const [a] = kandidatenKanaele(k2, 1)
    check('steigender Kanal ohne Stange: „Aufsteigender Kanal"', a?.muster === null && a.richtung === 'auf' && kanalName(a).startsWith('Aufsteigender Kanal'))
    // Kurzes Überschiessen am mittleren Kontakt (Docht 1,6, zwei Schlüsse draussen) bricht den Kanal nicht
    const k5 = k2.map((x) => ({ ...x }))
    k5[45] = { ...k5[45], h: k5[45].h + 1.6, c: k5[45].c + 1.0 }
    k5[46] = { ...k5[46], c: k5[46].c + 0.9, h: k5[46].h + 0.9 }
    const [ue] = kandidatenKanaele(k5, 1)
    check('kurzes Überschiessen am mittleren Kontakt: Kanal besteht weiter (über den Ausreisser hinweg)', ue && ue.laenge >= 40 && ue.ausserhalb >= 1 && kerzenIndex(k5, ue.t1) < 45, JSON.stringify(ue && { L: ue.laenge, a: ue.ausserhalb }))
    const k6 = k2.map((x, i) => (i >= 70 ? { ...x, o: x.o + 5, c: x.c + 5, h: x.h + 5, l: x.l + 5 } : x))
    check('Gegenprobe: Kurs bleibt 5 ATR draussen → gebrochen, kein Kanal', kandidatenKanaele(k6, 1).length === 0)
    check('Gegenprobe: flache Spanne ist kein Kanal', kandidatenKanaele(Array.from({ length: 80 }, (_, i) => kerze(i, 100 + zick(i))), 1).length === 0)
    check('Kanal im Paket als K1', baueKandidaten({ kerzen: k, interval: '1h' }).kandidaten.some((x) => x.id === 'K1' && x.quelle === 'kanal'))
}

console.log('\nSeitwärtsphasen, saubere Marken, lange Kanäle (26.10.2026)\n')
{
    const H = 3_600_000
    // Hoch 100, dann zweimal 100↔110 hin und her (Wendepunkte je ~10 bei ATR ~1), dann Absturz auf 80, dann 80↔88
    const k = []
    const lauf = (von, bis, schritte) => { for (let i = 1; i <= schritte; i++) { const m = von + (bis - von) * i / schritte; k.push({ t: k.length * H, o: m - 0.3, h: m + 0.5, l: m - 0.5, c: m + 0.3, v: 100 }) } }
    lauf(90, 110, 20); lauf(110, 100, 10); lauf(100, 110, 10); lauf(110, 100, 10); lauf(100, 110, 10); lauf(110, 80, 15)
    lauf(80, 88, 10); lauf(88, 80, 10); lauf(80, 88, 10); lauf(88, 81, 10); lauf(81, 85, 8)
    const ph = seitwaertsPhasen(k, { zickzack: 3, spielraum: 1, minKerzen: 20 })
    check('zwei Seitwärtsphasen (100–110 und 80–88), der Absturz dazwischen keine', ph.length === 2 && k[ph[0].bis].h >= 109 && k[ph[1].von].l <= 81, JSON.stringify(ph))
    check('Phasen überschneiden sich nicht, die jüngste läuft bis jetzt', ph[0].bis <= ph[1].von && ph[1].bis === k.length - 1 && ph[1].laufend)
    // Stich unter den Kasten und zurück: bleibt EINE Phase
    const ks = []
    const lauf2 = (von, bis, schritte) => { for (let i = 1; i <= schritte; i++) { const m = von + (bis - von) * i / schritte; ks.push({ t: ks.length * H, o: m - 0.3, h: m + 0.5, l: m - 0.5, c: m + 0.3, v: 100 }) } }
    // Unterkante 100 zweimal belegt, dann ein Stich auf 94 und zurück
    lauf2(90, 110, 20); lauf2(110, 100, 10); lauf2(100, 110, 10); lauf2(110, 100, 10); lauf2(100, 110, 10); lauf2(110, 94, 10); lauf2(94, 110, 12); lauf2(110, 100, 10); lauf2(100, 108, 10)
    const st = seitwaertsPhasen(ks, { zickzack: 3, spielraum: 1, minKerzen: 20 })
    check('kurzer Stich unter die belegte Unterkante und zurück: eine Phase, kein Ausbruch', st.length === 1 && st[0].bis === ks.length - 1, JSON.stringify(st))
    // Gleich weit, aber die Unterkante ist noch nicht belegt und es geht weiter abwärts: Trend, die Phase beginnt unten
    const kt = []
    const lauf3 = (von, bis, schritte) => { for (let i = 1; i <= schritte; i++) { const m = von + (bis - von) * i / schritte; kt.push({ t: kt.length * H, o: m - 0.3, h: m + 0.5, l: m - 0.5, c: m + 0.3, v: 100 }) } }
    lauf3(120, 100, 20); lauf3(100, 104, 6); lauf3(104, 88, 16); lauf3(88, 96, 10); lauf3(96, 88, 10); lauf3(88, 96, 10); lauf3(96, 89, 10); lauf3(89, 94, 8)
    const tr = seitwaertsPhasen(kt, { zickzack: 3, spielraum: 1, minKerzen: 20 })
    check('Absturz in Stufen: die Phase beginnt erst am Tief, nicht davor', tr.length === 1 && kt[tr[0].von].l <= 88, JSON.stringify(tr))
    const trend = []
    for (let i = 0; i < 120; i++) { const m = 100 + i * 0.5 + Math.sin(i / 3) * 2; trend.push({ t: i * H, o: m, h: m + 0.6, l: m - 0.6, c: m, v: 1 }) }
    check('Gegenprobe: ein stetiger Trend ist keine Seitwärtsphase', seitwaertsPhasen(trend, { minKerzen: 20 }).length === 0, JSON.stringify(seitwaertsPhasen(trend, { minKerzen: 20 })))
    const nv = (preis, b, d, extra = {}) => ({ preis, beruehrungen: b, durchquerungen: d, guete: b, rolle: 'widerstand', ...extra })
    const w = waehleNiveaus([nv(110, 9, 7, { rolle: 'wechsel' }), nv(108, 2, 0), nv(106, 1, 0), nv(104, 11, 13, { rolle: 'wechsel' }), nv(95, 1, 0, { extrem: 'tief' }), nv(102, 4, 1)], 100)
    const preise = w.map((x) => x.preis).sort((a, b) => a - b).join()
    check('saubere Marken bleiben, einmal berührte und oft durchquerte fallen weg (ein Drehpunkt bleibt)', preise === '95,102,108,110', preise)
}

console.log('\nFlaggen: Stange ist ein Impuls, Flagge kurz, Bruch im Namen (27.10.2026)\n')
{
    const H = 3_600_000
    const kerze = (t, m, sp = 0.5) => ({ t: t * H, o: m - 0.1, h: m + sp, l: m - sp, c: m + 0.1, v: 100 })
    const zick = (i) => { const p = i % 10; return (p < 5 ? p : 10 - p) * 0.6 - 1.5 }
    const flagge = (stange, schritt, lang) => {
        const k = []
        for (let i = 0; i < 20; i++) k.push(kerze(k.length, 100))
        for (let i = 0; i < stange.n; i++) k.push(kerze(k.length, 100 + (i + 1) * stange.je))
        const oben = k[k.length - 1].c
        for (let i = 0; i < lang; i++) k.push(kerze(k.length, oben - i * schritt + zick(i)))
        return k
    }
    const gut = kandidatenKanaele(flagge({ n: 12, je: 1.2 }, 0.12, 30), 1)[0]
    check('Impuls 14 ATR in 12 Kerzen + kurzer fallender Kanal = Bull-Flagge mit Stangenlänge', gut?.muster === 'bullFlagge' && gut.stangeKerzen <= 15 && gut.ruecklaufPct < 50, JSON.stringify(gut && { m: gut.muster, k: gut.stangeKerzen, r: gut.ruecklaufPct }))
    const langsam = kandidatenKanaele(flagge({ n: 60, je: 0.2 }, 0.12, 30), 1)[0]
    check('Gegenprobe: 12 ATR, aber über 60 Kerzen (Trend, kein Impuls) → keine Flagge', langsam && langsam.muster === null, JSON.stringify(langsam && { m: langsam.muster, s: langsam.stangeAtr }))
    const tief = kandidatenKanaele(flagge({ n: 12, je: 1.2 }, 0.35, 30), 1)[0]
    check('Gegenprobe: Kanal holt mehr als die Hälfte der Stange zurück → keine Flagge', !tief || tief.muster === null, JSON.stringify(tief && { m: tief.muster, r: tief.ruecklaufPct }))
    const lang = kandidatenKanaele(flagge({ n: 12, je: 1.2 }, 0.05, 70), 1)[0]
    check('Gegenprobe: 70 Kerzen nach der Stange sind keine Flagge mehr', !lang || lang.muster === null, JSON.stringify(lang && { m: lang.muster, L: lang.laenge }))
    check('fahnenstange: Kanal steigt steil → keine Bull-Flagge', fahnenstange(flagge({ n: 12, je: 1.2 }, 0.12, 30), 32, 1, 2, 5) === null)
    check('Name mit Bruch', kanalName({ muster: 'bearFlagge', beruehrOben: 3, beruehrUnten: 3, bruch: 'unten' }) === 'Bear-Flagge (3/3 Berührungen, nach unten gebrochen)'
        && kanalName({ muster: null, richtung: 'auf', beruehrOben: 2, beruehrUnten: 4, bruch: 'oben' }) === 'Aufsteigender Kanal (2/4 Berührungen, nach oben verlassen)'
        && kanalKurz({ muster: 'bullFlagge' }) === 'Bull-Flagge')
    check('Beschriftung im Chart: kurz, mit Bruch, ohne Zahlen', kanalBeschriftung({ muster: null, richtung: 'ab', beruehrOben: 5, beruehrUnten: 3, bruch: 'unten' }) === 'Absteigender Kanal, nach unten verlassen'
        && kanalBeschriftung({ muster: 'bearFlagge', bruch: 'unten' }) === 'Bear-Flagge, nach unten gebrochen'
        && kanalBeschriftung({ form: 'range', muster: 'bearFlagge' }) === 'Seitwärts-Range')

    // Echter Fall: HBARUSDT 4h, KI-Analyse vom 27.10.2026 16:32
    const roh = JSON.parse(fs.readFileSync(new URL('./fixtures/chart-hbar-4h-flagge.json', import.meta.url))).kerzen
    const alle = roh.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const lauf = (N) => { const k = alle.slice(-N); const a = atrReihe(k, 14); return kandidatenKanaele(k, a[a.length - 1])[0] }
    const k200 = lauf(200)
    check('HBAR 200 Kerzen: Range nach Abwärts-Impuls ≤ 15 Kerzen, nach unten verlassen', k200?.muster === 'bearFlagge' && k200.stangeKerzen <= 15 && k200.bruch === 'unten' && k200.laenge <= 40, JSON.stringify(k200 && { m: k200.muster, k: k200.stangeKerzen, b: k200.bruch, L: k200.laenge }))
    check('HBAR: seitwärts heisst waagerecht — kein steigender Kanal (Kanten 0.0762 / 0.0781)', k200.form === 'range' && k200.richtung === 'seitwaerts' && k200.p1 === k200.p2 && k200.pEnde === k200.p1
        && Math.abs(k200.untenJetzt - 0.07621) < 0.0002 && Math.abs(k200.obenJetzt - 0.07814) < 0.0002, JSON.stringify(k200 && { f: k200.form, u: k200.untenJetzt, o: k200.obenJetzt }))
    check('HBAR: Name sagt Range, nicht Flagge', kanalName(k200) === `Seitwärts-Range nach Abwärts-Impuls (${k200.beruehrOben}/${k200.beruehrUnten} Berührungen, nach unten verlassen)` && kanalKurz(k200) === 'Seitwärts-Range', kanalName(k200))
    check('Gegenprobe: deutlich fallende Flagge bleibt schräg', gut.form === 'kanal' && gut.p1 !== gut.p2)
    const k490 = lauf(490)
    // 29.10.2026: das Fenster bestimmt den Massstab — vorher fanden 150 und 1000 Kerzen dieselben Linien
    check('Massstab: bis 150 Kerzen 1, dann √(n/150), höchstens 3', massstab(100) === 1 && massstab(150) === 1 && Math.abs(massstab(600) - 2) < 1e-9 && massstab(5000) === 3)
    const kanaele = (N) => { const k = alle.slice(-N); const a = atrReihe(k, 14); return kandidatenKanaele(k, a[a.length - 1]) }
    const g490 = kanaele(490)
    const lang490 = g490.find((k) => k.laenge >= KAND.KANAL_LANG_ANTEIL * 490)
    check('HBAR 490 Kerzen: übergeordneter Kanal über ≥ ⅓ des Fensters neben dem kurzen', g490.length === 2 && lang490 && g490[0].laenge * 2 <= lang490.laenge, JSON.stringify(g490.map((k) => k.laenge)))
    check('… der kurze steht zuerst (K1), der übergeordnete danach (K2)', g490[0].laenge < g490[1].laenge)
    const tl = (N) => { const k = alle.slice(-N); const a = atrReihe(k, 14); return kandidatenTrendlinien(k, a[a.length - 1]).map((x) => `${x.t1}|${x.t2}`).join() }
    // Weites Fenster: Zonen wachsen mit, sonst zerfallen sie in Einzelpunkte
    {
        const k = alle.slice(-490); const a = atrReihe(k, 14); const A = a[a.length - 1]; const M = massstab(490)
        const eng = kandidatenNiveaus(k, { atrWert: A, k: Math.round(3 * M) }), weit = kandidatenNiveaus(k, { atrWert: A, k: Math.round(3 * M), M })
        const mehr = (l) => l.filter((x) => x.beruehrungen >= 4).length
        check('HBAR 490 Kerzen: mit Zonen im Massstab mehr Marken mit ≥ 4 Berührungen', mehr(weit) > mehr(eng), `${mehr(eng)} → ${mehr(weit)}`)
        check('… Band ist mindestens BAND_MIN × Massstab breit', weit.every((x) => x.hoch - x.tief >= 2 * KAND.BAND_MIN_ATR * A * M - 1e-12))
    }
    check('grösseres Fenster, andere Trendlinien', tl(150) !== tl(490), tl(150))
    check('HBAR 490 Kerzen: der Monat Abwärtstrend ist keine „Bull-Flagge" mehr', k490 && k490.muster !== 'bullFlagge', JSON.stringify(k490 && { m: k490.muster, L: k490.laenge }))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
