/**
 * Ergebnis der KI-Analyse → Zeichnungen. Einmal für die gestrichelte Vorschau,
 * einmal für das Übernehmen in die eigenen Zeichnungen — dieselbe Umrechnung,
 * damit die übernommene Linie genau dort liegt, wo die Vorschau sie zeigte.
 */
// Unterstützung grün, Widerstand rot, Trend im KI-Lila — gestrichelt bleibt alles,
// das sagt „Vorschlag der KI". Gleiche Töne wie Kauf/Verkauf im übrigen Chart.
export const KI_FARBEN = { unterstuetzung: '#26a69a', widerstand: '#ef5350', trend: '#ab47bc' }
const FARBE = KI_FARBEN.trend
const farbeVon = (art) => KI_FARBEN[art] || FARBE

// „Label (N4)" — die ID verbindet die Linie im Chart mit dem Eintrag im Reiter.
const mitId = (label, id) => (id && !String(label || '').includes(id) ? `${label || ''} (${id})`.trim() : label)

export function linieAlsZeichnung(l) {
    if (l.art === 'kanal') return kanalAlsZeichnung(l)
    const stil = { farbe: farbeVon(l.art), breite: l.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt', text: mitId(l.label, l.id) }
    // Waagerechte Marke: als Strahl ab ihrem ersten Punkt — sie gilt ab dort. Unterstützung und
    // Widerstand sind IMMER waagerecht, auch wenn eine ältere Analyse (vor 18.10.2026) zwei
    // Preise trägt: dann der äussere, so wie der Server es heute ablegt.
    if (l.p1 === l.p2 || l.art === 'unterstuetzung' || l.art === 'widerstand') {
        const p = l.art === 'widerstand' ? Math.max(l.p1, l.p2) : l.art === 'unterstuetzung' ? Math.min(l.p1, l.p2) : l.p1
        return { typ: 'strahlH', punkte: [{ t: Math.min(l.t1, l.t2 ?? l.t1), p }], stil: { ...stil, textPos: 'rechts' } }
    }
    return { typ: 'trendlinie', ...trendPunkte(l), stil: { ...stil, textPos: 'ende', rechts: !Number.isFinite(l.tEnde) } }
}

/*
 * Kanal bzw. Flagge als Parallelkanal (Werkzeug `kanal`): untere Kante vom
 * ersten Punkt bis `tEnde`, dritter Punkt = obere Kante über dem ersten.
 * Bull-Flagge grün, Bear-Flagge rot, sonst im KI-Lila; Name vom Code.
 */
export function kanalAlsZeichnung(l) {
    const farbe = l.muster === 'bullFlagge' ? KI_FARBEN.unterstuetzung : l.muster === 'bearFlagge' ? KI_FARBEN.widerstand : FARBE
    const t2 = Number.isFinite(l.tEnde) ? l.tEnde : l.t2, p2 = Number.isFinite(l.pEnde) ? l.pEnde : l.p2
    return {
        typ: 'kanal',
        punkte: [{ t: l.t1, p: l.p1 }, { t: t2, p: p2 }, { t: l.t1, p: l.p1 + (l.breite || 0) }],
        stil: { farbe, breite: l.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt', fuellung: true, text: mitId(l.labelKurz || l.label, l.id) },
    }
}

/*
 * Dreieck bzw. Keil (`art: 'dreieck'`, server/chart-dreiecke.js): zwei Kanten
 * vom Beginn bis zur Spitze (höchstens ein Stück über die letzte Kerze), als
 * zwei Trendlinien; der Name steht an der oberen. Grün für Formen, die nach
 * oben aufgelöst werden (aufsteigendes Dreieck, fallender Keil), rot für die
 * Gegenstücke, symmetrisch im KI-Lila — die Farbe sagt, welche Kante die
 * Lehrbuchseite ist, nicht wohin es geht.
 */
const DREIECK_FARBE = { aufsteigend: KI_FARBEN.unterstuetzung, fallenderKeil: KI_FARBEN.unterstuetzung, absteigend: KI_FARBEN.widerstand, steigenderKeil: KI_FARBEN.widerstand }
export function dreieckAlsZeichnungen(l) {
    const stil = { farbe: (l.muster === 'bullWimpel' ? KI_FARBEN.unterstuetzung : l.muster === 'bearWimpel' ? KI_FARBEN.widerstand : DREIECK_FARBE[l.form]) || FARBE, breite: l.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt' }
    return [
        // Jede Kante ab ihrer eigenen ersten Berührung (seit 03.11.2026); ältere Analysen ab dem gemeinsamen Anfang
        { typ: 'trendlinie', punkte: [{ t: l.tOA ?? l.tA, p: l.obenOA ?? l.obenA }, { t: l.tE, p: l.obenE }], stil: { ...stil, text: mitId(l.labelKurz || l.label, l.id), textPos: 'ende' } },
        { typ: 'trendlinie', punkte: [{ t: l.tUA ?? l.tA, p: l.untenUA ?? l.untenA }, { t: l.tE, p: l.untenE }], stil: { ...stil, ...(l.id ? { text: `${l.id} unten`, textPos: 'ende' } : {}) } },
    ]
}

/*
 * Trendlinie vom ersten Anker bis `tEnde` (letzte Kerze plus ein Teil der
 * Spanne, server/chart-trendlinien.js) — bis 20.10.2026 lief sie ohne Ende
 * nach rechts und stand auf BTC 15m 3 000 USD über dem Kurs. Ältere Analysen
 * ohne `tEnde`: wie bisher durch beide Anker, nach rechts verlängert.
 */
function trendPunkte(l) {
    if (Number.isFinite(l.tEnde) && Number.isFinite(l.pEnde)) return { punkte: [{ t: l.t1, p: l.p1 }, { t: l.tEnde, p: l.pEnde }] }
    return { punkte: [{ t: l.t1, p: l.p1 }, { t: l.t2, p: l.p2 }] }
}

export function zoneAlsZeichnung(z, ab, bis) {
    // Ab der ersten Berührung (neuere Analysen tragen `vonT`), sonst über den ganzen Bereich.
    const von = Number.isFinite(z.vonT) ? z.vonT : ab
    return {
        typ: 'rechteck',
        punkte: [{ t: von, p: z.tief }, { t: Math.max(bis, von), p: z.hoch }],
        stil: { farbe: farbeVon(z.art), breite: z.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt', fuellung: true, rechts: true, text: mitId(z.label, (z.ids || []).join('+')) },
    }
}

/**
 * Was zur Wahl stand, aber nicht gewählt wurde — grau gepunktet, nur auf
 * Wunsch („Alle Kandidaten zeigen"). So sieht man, ob die Auswahl der KI
 * etwas Wichtiges ausgelassen hat.
 */
export function kandidatenVorschau(analyse) {
    const k = analyse?.auswahl?.kandidaten
    if (!Array.isArray(k)) return []
    const gewaehlt = new Set([...(analyse.linien || []).map((l) => l.id), ...(analyse.zonen || []).flatMap((z) => z.ids || [])])
    const stil = (text) => ({ farbe: '#8a9199', breite: 1, strich: 'gepunktet', text })
    // V-Kandidaten gehören zum Profil, nicht als einzelne graue Linien
    // Kanäle zeichnet der Code ohnehin ein — kein grauer Doppelgänger
    return k.filter((x) => !gewaehlt.has(x.id) && x.quelle !== 'volumenprofil' && x.quelle !== 'kanal' && x.quelle !== 'dreieck').map((x, i) => {
        if (x.quelle === 'trend') return { id: -300 - i, typ: 'trendlinie', ...trendPunkte(x), stil: { ...stil(x.id), textPos: 'ende', rechts: !Number.isFinite(x.tEnde) } }
        return { id: -300 - i, typ: 'strahlH', punkte: [{ t: x.t1 ?? analyse.kerzenVon, p: x.preis }], stil: { ...stil(x.name ? `${x.id} ${x.name}` : x.id), textPos: 'rechts' } }
    })
}

/*
 * Volumenprofil: Die V-Marken (POC/VAH/VAL) gehören je zu einem ABSCHNITT
 * zwischen zwei grossen Wendepunkten (server/chart-kandidaten.js). Wählt die
 * KI eine davon, erscheint über diesem Abschnitt ein Fixed-Range-Profil wie
 * vom eigenen Profil-Werkzeug — im zuletzt benutzten Stil des Werkzeugs
 * (`basis`), sonst einfarbig in der Hausfarbe mit POC/VAH/VAL. Die Marken selbst nicht
 * noch einmal als eigene Linien. Analysen ohne Abschnitte (älter als
 * 19.10.2026): ein Profil über den ganzen Bereich.
 */
export const PROFIL_STIL = { farbe: '#1fd6c4', zeilen: 96, rechts: false, marken: true }
const istV = (id) => /^V\d+$/.test(String(id || ''))
export const istProfilLinie = (l) => l?.quelle === 'volumenprofil' || istV(l?.id)
export const istProfilZone = (z) => (z?.ids || []).some(istV)
export function hatProfil(analyse) {
    return (analyse?.linien || []).some(istProfilLinie) || (analyse?.zonen || []).some(istProfilZone)
}
export function profileAlsZeichnungen(analyse, basis = {}) {
    // POC/VAH/VAL immer nach rechts verlängert und am Rand beschriftet (26.10.2026, Wunsch nach
    // dem Bild mit zwei Phasenprofilen): die Marke gilt bis jetzt, nicht nur über der Phase.
    const stil = { ...PROFIL_STIL, ...basis, rechts: true, marken: true }
    const kand = new Map((analyse?.auswahl?.kandidaten || []).map((k) => [k.id, k]))
    const ids = [...(analyse?.linien || []).filter(istProfilLinie).map((l) => l.id), ...(analyse?.zonen || []).flatMap((z) => (z.ids || []).filter(istV))]
    const bereiche = new Map()
    for (const id of ids) {
        const k = kand.get(id)
        const t1 = k?.t1, t2 = k?.t2
        const schluessel = k?.abschnitt && t1 && t2 ? k.abschnitt : 'ganz'
        if (!bereiche.has(schluessel)) bereiche.set(schluessel, schluessel === 'ganz' ? [analyse.kerzenVon, analyse.kerzenBis] : [t1, t2])
    }
    return [...bereiche.values()].map(([t1, t2]) => ({ typ: 'volprofil', punkte: [{ t: t1, p: 0 }, { t: t2, p: 0 }], stil: { ...stil } }))
}

/*
 * Korrektur einer EIGENEN Zeichnung („Meine Zeichnungen analysieren"): dieselbe
 * Zeichnungsart mit den Punkten des Kandidaten, gestrichelt im KI-Lila neben der
 * eigenen. Übernehmen verschiebt die eigene Zeichnung dorthin (chartKi.js).
 */
export function korrekturAlsZeichnung(k) {
    const stil = { farbe: FARBE, breite: 1, strich: 'gestrichelt', text: `${k.u} → ${k.id}` }
    if (k.typ === 'strahlH' || k.typ === 'horizontale') return { typ: k.typ, punkte: k.punkte, stil: { ...stil, textPos: 'rechts' } }
    if (k.typ === 'kanal') return { typ: 'kanal', punkte: k.punkte, stil: { ...stil, fuellung: false } }
    return { typ: k.typ, punkte: k.punkte, stil: { ...stil, textPos: 'ende' } }
}

/**
 * Alles aus einer Analyse als Vorschau (negative ids: nie verwechselbar mit gespeicherten).
 * `ki` trägt den Schlüssel des Vorschlags (`linie3`, `zone1`, `profil`) — daran erkennt
 * die Zeichenebene einen Klick auf eine gestrichelte Linie (Übernehmen/Verwerfen im Chart).
 * Graue Kandidaten tragen keinen: sie sind nicht vorgeschlagen.
 */
export function kiVorschau(analyse, { profilStil = {} } = {}) {
    if (!analyse) return []
    const ab = analyse.kerzenVon
    const bis = analyse.kerzenBis
    const schluessel = (x, art, i) => x._key || `${art}${i}`
    return [
        ...(analyse.linien || []).flatMap((l, i) => (istProfilLinie(l) ? []
            : l.art === 'dreieck' ? dreieckAlsZeichnungen(l).map((z, j) => ({ id: -600 - 2 * i - j, ki: schluessel(l, 'linie', i), ...z }))
                : [{ id: -100 - i, ki: schluessel(l, 'linie', i), ...linieAlsZeichnung(l) }])),
        ...(analyse.zonen || []).map((z, i) => (istProfilZone(z) ? null : { id: -200 - i, ki: schluessel(z, 'zone', i), ...zoneAlsZeichnung(z, ab, bis) })).filter(Boolean),
        ...(hatProfil(analyse) ? profileAlsZeichnungen(analyse, profilStil).map((z, j) => ({ id: -150 - j, ki: 'profil', ...z })) : []),
        ...(analyse.korrekturen || []).map((k, i) => ({ id: -400 - i, ki: schluessel(k, 'korr', i), ...korrekturAlsZeichnung(k) })),
        ...(analyse._alle ? kandidatenVorschau(analyse) : []),
    ]
}

/*
 * Was mit den Vorschlägen einer Analyse geschehen ist — je Analyse (Symbol,
 * Zeiteinheit, Markt, Zeitpunkt) gemerkt, damit ein Neuladen oder ein Wechsel
 * des Reiters die übernommenen Linien nicht wieder gestrichelt daneben zeigt.
 *   uebernommen  Schlüssel (`linie3`, `zone1`, `profil`, `korr0`), jetzt eigene Zeichnungen
 *                (bei `korr…`: die eigene Zeichnung wurde dorthin verschoben)
 *   geloescht    im Chart oder im Reiter verworfen
 *   erledigt     „Vorschau erledigt": keine gestrichelten Linien mehr, im Reiter
 *                bleibt die Analyse mit den übernommenen Vorschlägen stehen
 *   zurueck      „Analyse zurücksetzen": der Reiter ist leer
 */
export const leereMarken = () => ({ uebernommen: [], geloescht: [], erledigt: false, zurueck: false })
export const markenSchluessel = (a) => (a ? `${a.symbol}|${a.interval}|${a.markt === 'spot' ? 'spot' : 'futures'}|${a.stand}` : '')

/** Linien und Zonen mit ihrem Schlüssel (`_key`), nach dem Zustand gefiltert. */
function gefiltert(analyse, behalte) {
    const linien = (analyse.linien || []).map((l, i) => ({ ...l, _key: `linie${i}` })).filter((l) => behalte(l._key, istProfilLinie(l)))
    const zonen = (analyse.zonen || []).map((z, i) => ({ ...z, _key: `zone${i}` })).filter((z) => behalte(z._key, istProfilZone(z)))
    const korrekturen = (analyse.korrekturen || []).map((k, i) => ({ ...k, _key: `korr${i}` })).filter((k) => behalte(k._key, false))
    return { ...analyse, linien, zonen, korrekturen }
}

/**
 * Was der Reiter zeigt: vor „erledigt" alles ausser dem Verworfenen, danach nur
 * noch das Übernommene (das, was jetzt im Chart eingezeichnet ist). Nach
 * „zurücksetzen" nichts.
 */
export function anzeigeAnalyse(analyse, marken = leereMarken()) {
    if (!analyse || marken.zurueck) return null
    const ue = new Set(marken.uebernommen), weg = new Set(marken.geloescht)
    return gefiltert(analyse, (k, profil) => (marken.erledigt ? ue.has(k) || (profil && ue.has('profil')) : !weg.has(k)))
}

/** Was gestrichelt im Chart steht: nur Offenes — nicht Übernommenes (ist jetzt eine eigene Linie), nicht Verworfenes. */
export function vorschauAnalyse(analyse, marken = leereMarken()) {
    if (!analyse || marken.zurueck || marken.erledigt) return null
    const ue = new Set(marken.uebernommen), weg = new Set(marken.geloescht)
    return gefiltert(analyse, (k, profil) => !ue.has(k) && !weg.has(k) && !(profil && ue.has('profil')))
}
