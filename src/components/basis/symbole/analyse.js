/**
 * Zusätzliche Symbole für den Analyse-Bereich (Marktradar, Nachrichten,
 * Hype-/Coin-Radar, KI-Agent, Lernen) — S6.
 *
 * Gleiche Regeln wie in `Symbol.vue`: 24er-Raster, nur Striche, keine Füllung,
 * selbst gezeichnet. Bewusst keine Markenzeichen (YouTube, X, Telegram,
 * GitHub, Bitcoin): wo die Oberfläche eine Quelle meinte, steht ein neutrales
 * Zeichen für die Art (Video, Kurznachricht, Kanal, Code, Münze).
 */
const kreis = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const SYMBOLE_ANALYSE = {
    dokument: ['M6 3.5h8l4 4V20.5H6z', 'M14 3.5v4h4', 'M9 12h6M9 15.5h6'],
    dokumentSuche: ['M13 20.5H6v-17h8l4 4V11', 'M14 3.5v4h4', kreis(16, 16, 2.6), 'M18 18l2.5 2.5'],
    dokumentHaken: ['M6 3.5h8l4 4V20.5H6z', 'M14 3.5v4h4', 'M9 14l2 2 4-4'],
    lupePlus: [kreis(11, 11, 6.5), 'M16 16l4.5 4.5', 'M11 8.5v5M8.5 11h5'],
    prozessor: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5'],
    pauseKreis: [kreis(12, 12, 9), 'M10 9v6M14 9v6'],
    hinweisKreis: [kreis(12, 12, 9), 'M12 7.5V13M12 16.2v.1'],
    video: ['M3.5 6.5h17v11h-17z', 'M10 9.5v5l4.5-2.5z'],
    person: [kreis(12, 8, 3.8), 'M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6'],
    rss: ['M5 11a8 8 0 0 1 8 8', 'M5 5a14 14 0 0 1 14 14', 'M5.5 18.5v.1'],
    regenbogen: ['M3 18a9 9 0 0 1 18 0', 'M6.5 18a5.5 5.5 0 0 1 11 0', 'M10 18a2 2 0 0 1 4 0'],
    zeitung: ['M4 5h13v14H6a2 2 0 0 1-2-2z', 'M17 9h3v8a2 2 0 0 1-2 2', 'M7.5 8.5h6v3.5h-6z', 'M7.5 15h6'],
    anker: [kreis(12, 5.5, 2), 'M12 7.5V21', 'M8 11h8', 'M4.5 13.5a7.5 7.5 0 0 0 15 0'],
    gebaeude: ['M3.5 9 12 4l8.5 5z', 'M5 20.5h14', 'M6.5 11v7M10 11v7M14 11v7M17.5 11v7'],
    thermometer: ['M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z', 'M12 11v5'],
    senden: ['M21 3.5 3 11l7 2.5 2.5 7z', 'M21 3.5 10 13.5'],
    tabelle: ['M4 4.5h16v15H4z', 'M4 9.5h16M4 14.5h16', 'M10 9.5v10'],
    sternHalb: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z', 'M12 3.5v13.3'],
    aufnahme: [kreis(12, 12, 9), kreis(12, 12, 3.5)],
    megafon: ['M4 10v4h3l7 4.5v-13L7 10z', 'M17.5 9.5a3.5 3.5 0 0 1 0 5', 'M7 14l1.5 5.5h2.5L10 15.5'],
    schluessel: [kreis(7.5, 15.5, 3.5), 'M10 13 19.5 3.5', 'M16 7l2.5 2.5M14 9l2 2'],
    sanduhr: ['M6.5 3.5h11M6.5 20.5h11', 'M7.5 3.5c0 4 4.5 5.5 4.5 8.5S7.5 16.5 7.5 20.5', 'M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5'],
    code: ['M8.5 7.5 4 12l4.5 4.5', 'M15.5 7.5 20 12l-4.5 4.5', 'M13.5 5l-3 14'],
    filter: ['M4 5h16l-6 7.5V19l-4 1.5v-8z'],
    tausch: ['M4 8.5h14', 'M14.5 5l3.5 3.5-3.5 3.5', 'M20 15.5H6', 'M9.5 12 6 15.5 9.5 19'],
    dollar: ['M12 3v18', 'M16.5 7c-.6-1.5-2.4-2.5-4.5-2.5-2.5 0-4.5 1.4-4.5 3.4 0 4.6 9 2.6 9 7.2 0 2-2 3.4-4.5 3.4-2.2 0-4-1-4.6-2.6'],
    krone: ['M3.5 7.5 7.5 12 12 5l4.5 7 4-4.5-1.5 11h-14z'],
    kreis: [kreis(12, 12, 8)],
    torte: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z', 'M14.5 3.8A8.5 8.5 0 0 1 20.2 9.5H14.5z'],
    abwaerts: ['M4 3v17h17', 'M7 8l4 4 3-3 6 7', 'M16 16h4v-4'],
    ziel: [kreis(12, 12, 9), kreis(12, 12, 5), 'M12 12v.1'],
    pfeilHochRechts: ['M7 17 17 7', 'M9 7h8v8'],
    pfeilRunterRechts: ['M7 7l10 10', 'M17 9v8H9'],
    pfeilKreisRechts: [kreis(12, 12, 9), 'M8 12h8', 'M13 9l3 3-3 3'],
    pfeilKreisLinks: [kreis(12, 12, 9), 'M16 12H8', 'M11 9l-3 3 3 3'],
    analyse: ['M4 3v17h17', 'M7 15l3.5-4 2.5 2.5 3-3.5', kreis(17.5, 7.5, 2.5)],
    puls: ['M3 12h4l2.5-6 4 12L16 9l1.5 3H21'],
}
