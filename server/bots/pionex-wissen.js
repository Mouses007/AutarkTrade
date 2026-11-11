/**
 * Wissen über die Bot-Typen von Pionex — rein, ohne Netz.
 *
 * Eine Quelle für die Bot-Seite (Erklärung zum Typ), die KI-Optimierung
 * (fester Prompt-Teil) und die App-Hilfe. Zusammengetragen am 11.11.2026 aus
 * dem Pionex Help Center (help.pionex.com) und der API-Doku (pionex.com/docs);
 * jede Angabe nennt ihre Quelle. Was die Doku offen lässt, steht unter
 * `unsicher` und wird nie als Tatsache verwendet.
 *
 * Geprüft gegen eine echte Antwort von GET /api/v1/bot/orders (11.11.2026):
 * die Liste trägt bereits das volle buOrderData (gridProfit, condition,
 * totalRealizedProfit inklusive) — die Modell-Doku, die das für Futures-Grids
 * verneint, ist veraltet.
 */

export const STAND = '2026-11-11'

const HILFE = 'https://help.pionex.com/en/articles/'
const DOKU = 'https://www.pionex.com/docs/api-docs/bot-api/'

/** Handelsgebühren laut Pionex (Anteil, nicht Prozent). VIP-Rabatte nicht berücksichtigt. */
export const GEBUEHREN = {
    spot: { maker: 0.0005, taker: 0.0005 },
    futures: { maker: 0.0002, taker: 0.0005 },
    gewinnAnteil: 0.2,   // Futures Moon, Leveraged Grid, Margin Grid: 0 % Handel, 20 % vom Gewinn
    quelle: 'https://intercom.help/pionex/en/articles/14993683-pionex-trading-fee-overview',
    stand: STAND,
}

/** Gemeinsame Bausteine der Grid-Bots. */
const GRID_PARAMETER = [
    { feld: 'bottom', name: 'Untergrenze', einheit: 'Preis' },
    { feld: 'top', name: 'Obergrenze', einheit: 'Preis' },
    { feld: 'row', name: 'Anzahl Grids', einheit: 'Stück' },
    { feld: 'gridType', name: 'Grid-Art', einheit: 'arithmetic = gleiche Preisabstände, geometric = gleiche Prozentabstände' },
    { feld: 'condition', name: 'Trigger-Preis', einheit: 'Preis, Start erst wenn erreicht (conditionDirection −1/1)' },
    { feld: 'lossStop', name: 'Stop-Loss', einheit: 'je nach lossStopType: price, price_limit, profit_amount, profit_ratio' },
    { feld: 'profitStop', name: 'Take-Profit', einheit: 'je nach profitStopType: price, price_limit, profit_amount, profit_ratio' },
]

export const TYPEN = {
    spot_grid: {
        name: 'Spot-Grid',
        funktion: 'Legt Kauf- und Verkaufslimits in ein festes Preisband. Jeder abgeschlossene Zyklus «tief kaufen, höher verkaufen» bringt den Abstand eines Grids als Gewinn.',
        gutBei: 'Seitwärtsmarkt, der im Band hin und her pendelt.',
        schlechtBei: 'Anhaltender Fall unter die Untergrenze: der Bot hält dann die volle Coin-Menge mit Verlust. Über der Obergrenze ist alles verkauft und er verdient nichts mehr.',
        gewinn: 'Gesamt = Grid-Gewinn (realisiert) + Trend-PnL (schwebender Wert des gehaltenen Bestands).',
        parameter: [
            ...GRID_PARAMETER,
            { feld: 'quoteTotalInvestment', name: 'Investition', einheit: 'USDT (oder USDT + Coin)' },
            { feld: 'trailingUp', name: 'Trailing Up', einheit: 'Band steigt mit dem MA über 720 min; kein Trailing Down' },
            { feld: 'closeSellModel', name: 'Beim Schliessen', einheit: 'NOT_SELL, TO_QUOTE, TO_USDT' },
        ],
        aenderbar: ['Range (kann Bestand mit Verlust verkaufen)', 'Trailing', 'Stop-Loss/Take-Profit', 'Reinvest', 'Investition erhöhen (nicht senken)', 'Gewinn entnehmen', 'Pause'],
        rat: [
            'Die KI-Grids von Pionex zielen auf etwa 0,3 % Gewinn pro Grid vor Gebühren.',
            'Ein Zyklus kostet zweimal 0,05 % Gebühr; zu enge Grids fressen den Gewinn.',
            'Menge pro Grid ≈ Investition ÷ Grids und muss über der Mindestordergrösse liegen, sonst bleibt Kapital ungenutzt.',
            'Trailing Up brachte im Pionex-Backtest in steigenden Märkten etwa den doppelten Gewinn.',
        ],
        risiken: ['Bestand verliert unter der Untergrenze an Wert', 'Gebühren bei zu engen Grids'],
        gebuehren: 'spot',
        api: { buOrderType: 'spot_grid', lesen: true, aendern: ['adjustParams (top, bottom, row, quoteInvest)', 'investIn', 'profit', 'cancel'] },
        quellen: [`${HILFE}14616349-grid-trading-bot`, `${HILFE}15500905-grid-trading-bot-faq`, `${HILFE}14616329-trailing-up-grid-range-moves-with-the-price`, `${HILFE}14616302-grid-trading-bot-quantity-per-grid`, `${DOKU}spot-grid.md`],
    },

    futures_grid: {
        name: 'Futures-Grid',
        funktion: 'Grid auf einem Perpetual-Future (USDT-margined, isolierte Marge) mit Hebel. Long startet mit einer Long-Position, Short mit einer Short-Position, Neutral ohne Startposition: Shorts über, Longs unter dem Kurs.',
        gutBei: 'Long: seitwärts bis leicht steigend. Short: seitwärts bis leicht fallend. Neutral: echter Seitwärtsmarkt.',
        schlechtBei: 'Starker Trend gegen die Richtung: das Band wird verlassen, die volle Position bleibt stehen, Verluste wachsen bis zur Liquidation.',
        gewinn: 'Total = Grid-Gewinn + Trend-PnL. Trend-PnL enthält unrealisierten PnL, Gebühren, Spread aus Range-Anpassungen und das Funding (alle 8 h). Der Total-PnL kann trotz positivem Grid-Gewinn negativ sein.',
        parameter: [
            ...GRID_PARAMETER,
            { feld: 'trend', name: 'Richtung', einheit: 'long, short, no_trend (neutral)' },
            { feld: 'leverage', name: 'Hebel', einheit: 'x, bis zum Maximum des Symbols' },
            { feld: 'quoteInvestment', name: 'Investition', einheit: 'USDT' },
            { feld: 'extraMargin', name: 'Extra-Marge (dynamische Marge)', einheit: 'USDT' },
            { feld: 'lossStopHigh', name: 'Oberer Stop (nur Neutral)', einheit: 'Preis' },
            { feld: 'movingIndicatorType', name: 'Trailing Move', einheit: 'Band folgt dem SMA (Schwelle 1–50 %), optional Grenzen movingTop/movingBottom; nicht bei Neutral' },
        ],
        aenderbar: ['Range und Grids', 'Hebel', 'Investition erhöhen', 'Extra-Marge hinzufügen oder abziehen', 'Stop-Loss/Take-Profit', 'Reinvest', 'Pause und Fortsetzen (auch per Preis)', 'Position reduzieren'],
        rat: [
            'Hebel konservativ wählen und die Extra-Marge eingeschaltet lassen.',
            'Die Range an die erwartete Schwankung anpassen.',
            'Die Gridzahl ändert die Kapitalauslastung nicht, der Hebel schon. Mehr Grids erhöhen die Mindestinvestition.',
            'Jede Grid-Order muss die Kontrakt-Mindestgrösse erfüllen (z. B. 0,0001 BTC).',
            'Der Liquidationspreis ist ein Worst Case: er nimmt an, dass alle Orders der Risikoseite gefüllt sind.',
            'Gegenläufige Bots auf demselben Paar hedgen nur teilweise.',
        ],
        risiken: ['Liquidation (über den Mark-Preis)', 'Funding gegen die Richtung', 'Trend aus dem Band'],
        gebuehren: 'futures',
        api: { buOrderType: 'futures_grid', lesen: true, aendern: ['adjustParams (top, bottom, row, quoteInvestment, extraMargin)', 'addMargin/reduceMargin', 'updateTriggerProfitLoss', 'pause/resume', 'reduce', 'cancel'] },
        quellen: [`${HILFE}14616311-futures-grid-bot`, `${HILFE}16556011-neutral-futures-grid`, `${HILFE}16637342-futures-grid-trend-pnl-explained`, `${HILFE}16639763-how-grid-count-affects-margin-usage-and-capital-utilization`, `${DOKU}futures-grid.md`],
    },

    coinm_grid: {
        name: 'Coin-M Futures-Grid',
        funktion: 'Futures-Grid auf einem coin-margined (inversen) Perpetual. Investition, Marge und Gewinn laufen in der Coin, z. B. SOL. Long, Short oder Neutral.',
        gutBei: 'Wer die Coin ohnehin hält und sie im Seitwärtsmarkt vermehren will.',
        schlechtBei: 'Fallende Coin: der USDT-Wert der Marge fällt mit, der Liquidationspreis reagiert sehr empfindlich.',
        gewinn: 'Wie beim Futures-Grid, aber in der Coin gemessen. Der USD-Wert hängt zusätzlich vom Coin-Kurs ab.',
        parameter: [
            ...GRID_PARAMETER,
            { feld: 'trend', name: 'Richtung', einheit: 'in der API auf der USDT-Seite: short = Long der Coin' },
            { feld: 'leverage', name: 'Hebel', einheit: 'x' },
            { feld: 'quoteInvestment', name: 'Investition', einheit: 'Coin' },
        ],
        aenderbar: ['wie Futures-Grid'],
        rat: [
            'Der Grid-Abstand sollte grösser als etwa das Doppelte der Futures-Maker-Gebühr sein.',
            'Grids liegen unten dichter und oben dünner (inverser Kontrakt).',
        ],
        risiken: ['Doppeltes Kursrisiko: Position und Marge hängen an derselben Coin', 'Liquidation'],
        gebuehren: 'futures',
        api: { buOrderType: 'futures_grid', cateType: 'FUTURE_GRID_COIN_MARGINED', lesen: true, aendern: ['wie Futures-Grid'] },
        hinweisApi: 'Preise in der API sind invers (USDT je Coin als Kehrwert, base = USDT.PERP). Die App rechnet sie in USDT pro Coin um.',
        quellen: [`${HILFE}14616317-coin-m-futures-grid-bot`],
    },

    coinm_hedging: {
        name: 'Coin-M Hedging',
        funktion: '1x-Short auf Coin-Basis. Schützt die Coin-Menge, nicht den USD-Wert. Teilweise: Grid in einer Range, Ertrag aus Grid und Funding. Voll: Short sofort oder per Trigger, Ertrag nur aus Funding.',
        gutBei: 'Coin halten, ohne die Menge zu riskieren, bei positivem Funding.',
        schlechtBei: 'Fällt der Kurs unter die Range, werden die Shorts geschlossen.',
        gewinn: 'Grid-Gewinn und/oder Funding.',
        parameter: GRID_PARAMETER,
        aenderbar: [],
        rat: [],
        risiken: ['Negatives Funding'],
        gebuehren: 'futures',
        api: { buOrderType: 'futures_grid', cateType: 'FULLY_HEDGING', lesen: true, aendern: [] },
        unsicher: ['Dass cateType FULLY_HEDGING dieser Bot ist, steht nicht in der Doku.'],
        quellen: [`${HILFE}14616305-coin-m-futures-grid-bot-hedging-strategy`],
    },

    cross_margin_grid: {
        name: 'Cross-Margin Futures-Grid',
        funktion: 'Ein Long- und ein Short-Grid auf demselben Paar mit gemeinsamer Marge.',
        gutBei: 'Seitwärtsmarkt, beide Seiten verdienen.',
        schlechtBei: 'Erreicht der Kurs einen Liquidationspreis, werden BEIDE Seiten liquidiert. Ausserhalb der Range schliesst der Bot nicht.',
        gewinn: 'Summe beider Grids.',
        parameter: [{ feld: 'long/short', name: 'Je Seite', einheit: 'Investition, Hebel, Range, TP/SL' }],
        aenderbar: [],
        rat: [],
        risiken: ['Gemeinsame Liquidation beider Seiten'],
        gebuehren: 'futures',
        api: { buOrderType: 'future_hedge_grid', lesen: true, nurListe: true, aendern: [] },
        quellen: [`${HILFE}14616323-cross-margin-futures-grids-bot`],
    },

    leveraged_grid: {
        name: 'Leveraged Grid',
        funktion: 'Grid mit Futures-Hebel 1–5x, Long oder Short.',
        gutBei: 'Wie Spot-Grid, mit mehr Kapitalwirkung.',
        schlechtBei: 'Trend aus dem Band, Funding fällt auch bei 1x an.',
        gewinn: 'Grid-Gewinn; keine Handelsgebühren, dafür 20 % des Gesamtgewinns beim Schliessen, Reduzieren oder Entnehmen.',
        parameter: GRID_PARAMETER,
        aenderbar: ['Stop-Loss/Take-Profit', 'Marge', 'Gewinn entnehmen'],
        rat: ['Den Liquidationspreis ausserhalb der Range legen.'],
        risiken: ['Liquidation', 'Funding'],
        gebuehren: 'gewinnAnteil',
        api: { buOrderType: 'futures_grid', cateType: 'LEVERAGE_GRID', lesen: true, aendern: [] },
        quellen: [`${HILFE}14616336-leveraged-grid`],
    },

    margin_grid: {
        name: 'Margin Grid',
        funktion: 'Eine Coin dient als Sicherheit, die andere wird geliehen. Long = Coins investieren, Short = USDT investieren. Hebel 1–5x.',
        gutBei: 'Wie Leveraged Grid.',
        schlechtBei: 'Wie Leveraged Grid.',
        gewinn: 'Wie Leveraged Grid (20 % vom Gewinn statt Handelsgebühren).',
        parameter: GRID_PARAMETER,
        aenderbar: ['Stop-Loss/Take-Profit', 'Marge', 'Gewinn entnehmen'],
        rat: ['Den Liquidationspreis ausserhalb der Range legen.'],
        risiken: ['Liquidation', 'Funding'],
        gebuehren: 'gewinnAnteil',
        api: { buOrderType: 'futures_grid', cateType: 'LOAN_GRID', lesen: true, aendern: [] },
        unsicher: ['Dass cateType LOAN_GRID dieser Bot ist, steht nicht in der Doku.'],
        quellen: [`${HILFE}14616330-margin-grid`],
    },

    futures_moon: {
        name: 'Futures Moon',
        funktion: 'Sehr breites, dichtes Grid (etwa 0,1 % pro Grid) nur auf BTC oder ETH, Long oder Short. Die Range folgt dem MA.',
        gutBei: 'Langfristig klare Richtung mit hoher Schwankung.',
        schlechtBei: 'Geradliniger Trend ohne Rücksetzer.',
        gewinn: '0 % Handelsgebühr, 20 % vom Gewinn.',
        parameter: [{ feld: 'leverage', name: 'Hebel', einheit: 'x, Standard 5, höchstens 30' }, { feld: 'quoteInvestment', name: 'Investition', einheit: 'min. 500 USDT (BTC) / 150 USDT (ETH)' }],
        aenderbar: [],
        rat: [],
        risiken: ['Liquidation'],
        gebuehren: 'gewinnAnteil',
        api: { buOrderType: 'futures_grid', cateType: 'FUTURES_MOON', lesen: true, aendern: [] },
        quellen: [`${HILFE}14616320-futures-moon-bot`],
    },

    infinity_grid: {
        name: 'Infinity Grid',
        funktion: 'Spot-Bot ohne Obergrenze. Hält den Portfoliowert in USDT konstant: verkauft bei Anstieg, kauft bei Fall.',
        gutBei: 'Qualitäts-Coins, Einstieg nahe Tiefs, schwankender Aufwärtstrend.',
        schlechtBei: 'Einstieg nach einem starken Anstieg.',
        gewinn: 'Gewinn pro Grid (0,09–10 %).',
        parameter: [{ feld: 'bottom', name: 'Untergrenze', einheit: 'Preis, darunter pausiert der Bot' }, { feld: 'gewinnProGrid', name: 'Gewinn pro Grid', einheit: '0,09–10 %' }],
        aenderbar: ['nur Stoppen'],
        rat: ['Gewinn pro Grid nicht zu tief, sonst fressen die Gebühren ihn.'],
        risiken: ['Geringe Kapitaleffizienz'],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: [`${HILFE}15653264-infinity-grid`],
    },

    reverse_grid: {
        name: 'Reverse Grid',
        funktion: 'Grid in der Coin gemessen, mit dem Ziel, die Coin-Menge zu vermehren. Keine Short-Strategie.',
        gutBei: 'Erwarteter Fall oder Seitwärtsmarkt, wenn man die Coin hält.',
        schlechtBei: 'Starker Anstieg: der Bot verkauft die Coin zu früh.',
        gewinn: 'Entsteht in USDT und wird in der Coin angezeigt.',
        parameter: GRID_PARAMETER,
        aenderbar: ['Stop-Loss/Take-Profit'],
        rat: [],
        risiken: [],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: [`${HILFE}14616346-reverse-grid-bot`],
    },

    spot_dca: {
        name: 'DCA / Martingale (Spot)',
        funktion: 'Kauft gestaffelt in Rücksetzer mit wachsender Ordergrösse und verkauft die ganze Runde bei Ø-Kosten × (1 + Take-Profit). Danach beginnt die nächste Runde. Kein Hebel.',
        gutBei: 'Liquide Coins, die schwanken und sich erholen.',
        schlechtBei: 'Dauerfall: nach der letzten Safety-Order ist das Kapital erschöpft.',
        gewinn: 'Take-Profit pro Runde; Gebühren kommen dazu.',
        parameter: [
            { feld: 'abweichung', name: 'Preisabweichung', einheit: '% bis zur nächsten Safety-Order' },
            { feld: 'tp', name: 'Take-Profit', einheit: '%' },
            { feld: 'volumeScale', name: 'Volume Scale', einheit: 'Faktor je Stufe' },
            { feld: 'safetyOrders', name: 'Safety-Orders', einheit: 'Anzahl/Anteile (Standard 32 Anteile)' },
            { feld: 'sl', name: 'Stop-Loss', einheit: '%' },
        ],
        aenderbar: ['Range', 'Take-Profit', 'Stop-Loss', 'Investition'],
        rat: ['Ein zu kleiner Take-Profit bringt nach Gebühren nichts.', 'Stop-Loss unter die letzte Safety-Order setzen.'],
        risiken: ['Kapital gebunden im Dauerfall'],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: [`${HILFE}14616344-dca-martingale-bot-simple-mode`, `${HILFE}14616338-dca-martingale-bot-diy`],
    },

    futures_dca: {
        name: 'Futures-DCA',
        funktion: 'DCA Long oder Short mit Hebel.',
        gutBei: 'Wie Spot-DCA, mit Hebel.',
        schlechtBei: 'Trend gegen die Richtung: Liquidation, wenn alle Stufen gefüllt sind.',
        gewinn: 'Take-Profit pro Runde.',
        parameter: [{ feld: 'leverage', name: 'Hebel', einheit: 'x' }, { feld: 'tp', name: 'Take-Profit', einheit: 'Preis/%' }],
        aenderbar: ['Investition erhöhen'],
        rat: ['Der Liquidationspreis nimmt an, dass alle Stufen gefüllt sind.'],
        risiken: ['Liquidation'],
        gebuehren: 'futures',
        api: { lesen: false },
        quellen: [`${HILFE}14616315-futures-dca-bot`],
    },

    rebalancing: {
        name: 'Rebalancing / HODL',
        funktion: 'Hält 2–20 Coins auf Zielgewichten und gleicht nach Schwelle, Zeit oder Momentum aus.',
        gutBei: 'Langfristiges Portfolio mit schwankenden Gewichten.',
        schlechtBei: 'Kleine Abweichungen unter der Mindestordergrösse werden nicht gehandelt.',
        gewinn: 'Ausgleichsgewinne zwischen den Coins.',
        parameter: [{ feld: 'gewichte', name: 'Zielgewichte', einheit: '%' }, { feld: 'modus', name: 'Modus', einheit: 'Schwelle, periodisch, Momentum-Rotation, aus' }],
        aenderbar: ['Coins', 'Gewichte', 'Modus', 'Stop-Loss/Take-Profit'],
        rat: [],
        risiken: [],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: [`${HILFE}14616327-rebalancing-bot`, `${HILFE}16955250-pionex-hodl-bot-guide`],
    },

    smart_trade: {
        name: 'Smart Trade / Trailing / TWAP',
        funktion: 'Ausführungshilfen: Einstieg mit festem oder nachgezogenem Take-Profit und Stop (Smart Trade), Kauf/Verkauf nach Rücksetzer (Trailing), Aufteilen in Intervalle (TWAP).',
        gutBei: 'Einzelne Trades geordnet ausführen.',
        schlechtBei: 'Illiquide Coins (Ausführung zum Marktpreis).',
        gewinn: 'Wie ein einzelner Trade.',
        parameter: [],
        aenderbar: [],
        rat: ['Das Trailing-% an die übliche Schwankung der Coin anpassen.'],
        risiken: ['Slippage'],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: [`${HILFE}14616341-smart-trade-bot`, `${HILFE}17012219-trailing-buy-and-sell`, `${HILFE}15258618-twap-bot`],
    },

    signal_bot: {
        name: 'Signal-Bot (TradingView)',
        funktion: 'Führt Futures-Signale aus einem Webhook aus, Hebel bis 10x.',
        gutBei: 'Eigene, geprüfte Signale.',
        schlechtBei: 'Ungeprüfte Signale.',
        gewinn: 'Aus den Signalen; optional Gewinnbeteiligung 0–30 % an den Autor.',
        parameter: [],
        aenderbar: [],
        rat: [],
        risiken: ['Liquidation'],
        gebuehren: 'futures',
        api: { lesen: false },
        quellen: [`${HILFE}14616290-signal-bot`],
    },

    smart_copy: {
        name: 'Smart Copy',
        funktion: 'Portfolio aus Signalquellen anderer Händler mit eigenem Hebel, Anteil und TP/SL je Quelle.',
        gutBei: 'Verteilung auf mehrere Signalgeber.',
        schlechtBei: 'Signalgeber mit wenig Historie.',
        gewinn: 'Aus den kopierten Signalen, abzüglich Gewinnbeteiligung.',
        parameter: [{ feld: 'portfolio', name: 'Quellen', einheit: 'Hebel, Anteil, profit_stop_ratio, loss_stop_ratio je Quelle' }],
        aenderbar: [],
        rat: [],
        risiken: ['Liquidation'],
        gebuehren: 'futures',
        api: { buOrderType: 'smart_copy', lesen: true, aendern: ['cancel'] },
        quellen: [`${DOKU}models.md`],
    },

    arbitrage: {
        name: 'Arbitrage (Earn)',
        funktion: 'Spot long plus Perp short; Ertrag aus dem Funding alle 8 h. Liegt bei Pionex unter Earn, nicht unter Bots.',
        gutBei: 'Positives Funding.',
        schlechtBei: 'Negatives Funding.',
        gewinn: 'Funding abzüglich 0–20 % Versicherungsfonds und 10 % Risikoreserve.',
        parameter: [],
        aenderbar: [],
        rat: [],
        risiken: ['Negatives Funding'],
        gebuehren: 'spot',
        api: { lesen: false },
        quellen: ['https://intercom.help/pionex/en/articles/14616449-arbitrage'],
    },
}

/** Welcher Typ aus TYPEN ist dieser Bot? (buOrderType + cateType der API) */
export function typVon(buOrderType, cateType) {
    const b = String(buOrderType || '').toLowerCase()
    const c = String(cateType || '').toUpperCase()
    if (b === 'spot_grid') return 'spot_grid'
    if (b === 'future_hedge_grid') return 'cross_margin_grid'
    if (b === 'smart_copy') return 'smart_copy'
    if (b === 'futures_grid') {
        if (c === 'FUTURE_GRID_COIN_MARGINED') return 'coinm_grid'
        if (c === 'LEVERAGE_GRID') return 'leveraged_grid'
        if (c === 'FUTURES_MOON') return 'futures_moon'
        if (c === 'FULLY_HEDGING') return 'coinm_hedging'
        if (c === 'LOAN_GRID') return 'margin_grid'
        return 'futures_grid'
    }
    return null
}

/** Gebühr eines Grid-Zyklus (Kauf + Verkauf als Maker) als Anteil; null beim Gewinnanteil-Modell. */
export function zyklusGebuehr(typId) {
    const art = TYPEN[typId]?.gebuehren
    if (art === 'spot') return 2 * GEBUEHREN.spot.maker
    if (art === 'futures') return 2 * GEBUEHREN.futures.maker
    return null
}

/** Das Wissen zu einem Typ als Text für einen KI-Prompt. */
export function wissenAlsText(typId) {
    const t = TYPEN[typId]
    if (!t) return ''
    const z = [`BOT-TYP ${t.name} (Pionex, Stand ${STAND})`, `Funktion: ${t.funktion}`, `Geeignet: ${t.gutBei}`, `Ungeeignet: ${t.schlechtBei}`, `Gewinn: ${t.gewinn}`]
    if (t.parameter?.length) z.push('Parameter: ' + t.parameter.map(p => `${p.name} (${p.einheit})`).join('; '))
    if (t.aenderbar?.length) z.push('Im Betrieb änderbar: ' + t.aenderbar.join(', '))
    if (t.rat?.length) z.push('Was Pionex rät: ' + t.rat.join(' '))
    if (t.risiken?.length) z.push('Risiken: ' + t.risiken.join(', '))
    const g = zyklusGebuehr(typId)
    z.push(g == null ? 'Gebühren: 0 % Handel, 20 % vom Gewinn.' : `Gebühren: ${(g * 100).toFixed(2)} % pro Grid-Zyklus (2 × Maker).`)
    if (t.hinweisApi) z.push(t.hinweisApi)
    if (t.unsicher?.length) z.push('Unsicher: ' + t.unsicher.join(' '))
    return z.join('\n')
}
