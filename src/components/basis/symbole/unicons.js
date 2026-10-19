/**
 * Übergang: Unicons-Name → Symbolname.
 *
 * Für Stellen, an denen ein Symbol als DATEN ankommt (Kachel-Registries,
 * Menüeinträge) und noch eine alte Angabe wie `'uil uil-sync'` tragen kann —
 * etwa weil die Registry einer anderen Sitzung gehört. `symbolName()` nimmt
 * beides an. Fällt mit Unicons in S9 weg; neue Registries tragen gleich den
 * Symbolnamen.
 */
export const UNICONS = {
    'exclamation-triangle': 'warnung', 'angle-down': 'runter', 'times': 'schliessen', 'trash-alt': 'muell', 'sync': 'aktualisieren',
    'star': 'stern', 'favorite': 'stern', 'angle-up': 'hoch', 'robot': 'ki', 'angle-right': 'ausklappen', 'angle-left': 'einklappen',
    'info-circle': 'info', 'file-alt': 'dokument', 'external-link-alt': 'extern', 'check-circle': 'hakenKreis', 'expand-arrows-alt': 'vergroessern',
    'brain': 'gehirn', 'archive': 'archiv', 'setting': 'einstellungen', 'cog': 'einstellungen', 'search-plus': 'lupePlus', 'search': 'suche', 'search-alt': 'suche',
    'question-circle': 'frage', 'processor': 'prozessor', 'pause-circle': 'pauseKreis', 'link': 'verknuepfung', 'exclamation-circle': 'hinweisKreis',
    'copy': 'kopieren', 'chart-line': 'linie', 'chart-growth': 'wachstum', 'bolt-alt': 'blitz', 'bolt': 'blitz', 'youtube': 'video', 'web-grid': 'raster',
    'user': 'person', 'twitter': 'nachricht', 'sliders-v-alt': 'regler', 'shield-exclamation': 'schildWarnung', 'rss': 'rss', 'rainbow': 'regenbogen',
    'plus': 'plus', 'newspaper': 'zeitung', 'message': 'nachricht', 'globe': 'globus', 'compass': 'kompass', 'check-square': 'hakenKasten',
    'calendar-alt': 'kalender', 'bell-slash': 'glockeAus', 'bell': 'glocke', 'apps': 'raster', 'anchor': 'anker', 'wallet': 'geldbeutel',
    'university': 'gebaeude', 'temperature-half': 'thermometer', 'telegram': 'senden', 'table': 'tabelle', 'sync-exclamation': 'aktualisieren',
    'star-half-alt': 'sternHalb', 'square-full': 'quadrat', 'record-audio': 'aufnahme', 'play': 'play', 'percentage': 'prozent', 'pause': 'pause',
    'palette': 'palette', 'megaphone': 'megafon', 'list-ul': 'liste', 'key-skeleton': 'schluessel', 'hourglass': 'sanduhr', 'history': 'verlauf',
    'heart-rate': 'puls', 'github': 'code', 'fire': 'feuer', 'filter': 'filter', 'file-search-alt': 'dokumentSuche', 'file-download': 'herunterladen',
    'file-check-alt': 'dokumentHaken', 'eye-slash': 'augeAus', 'eye': 'auge', 'exclamation-octagon': 'stopp', 'exchange': 'tausch', 'edit': 'stift',
    'draggabledots': 'ziehgriff', 'dollar-sign': 'dollar', 'crown': 'krone', 'crosshairs': 'fadenkreuz', 'comment-dots': 'nachricht',
    'comment-alt-lines': 'nachricht', 'clock-three': 'uhr', 'circle-layer': 'ebenen', 'circle': 'kreis', 'check': 'haken', 'chart-pie': 'torte',
    'chart-down': 'abwaerts', 'bullseye': 'ziel', 'building': 'gebaeude', 'bitcoin-circle': 'muenzen', 'balance-scale': 'waage',
    'arrow-up-right': 'pfeilHochRechts', 'arrow-right': 'pfeilRechts', 'arrow-left': 'pfeilLinks', 'arrow-growth': 'wachstum',
    'arrow-down-right': 'pfeilRunterRechts', 'arrow-circle-right': 'pfeilKreisRechts', 'arrow-circle-left': 'pfeilKreisLinks', 'analysis': 'analyse',
    'download-alt': 'herunterladen', 'upload': 'hochladen', 'clock': 'uhr', 'lock': 'schloss', 'redo': 'aktualisieren', 'bars': 'menue',
}

/** 'uil uil-sync' | 'uil-sync' | 'aktualisieren' → 'aktualisieren' ('' bleibt ''). */
export function symbolName(angabe) {
    if (!angabe) return ''
    const alt = String(angabe).split(/\s+/).find((t) => t.startsWith('uil-'))
    if (!alt) return String(angabe).trim()
    return UNICONS[alt.slice(4)] || 'info'
}
