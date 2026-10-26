/**
 * Zeilen der Tabelle in einem Indikator-Fenster: Kennzahlen
 * (`fensterKennzahlen.js`) → [{ titel, wert, ton }] in Klartext. `t` ist die
 * i18n-Funktion des Panels (Schlüssel unter `chart.tab.*`); `ton` färbt den
 * Wert ('gut' | 'schlecht' | 'warn' | null).
 *
 * Grundsatz wie in der ganzen App: eine Einordnung, keine Empfehlung — die
 * Zeile „Lesart" sagt, was die Zahlen zusammen bedeuten, nicht was zu tun ist.
 */
const zahl = (v, st = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('de-CH', { maximumFractionDigits: st, minimumFractionDigits: st }))
const preis = (v) => {
    if (v == null || !Number.isFinite(v)) return '—'
    const a = Math.abs(v)
    return zahl(v, a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : 6)
}
const vz = (v, st = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${zahl(v, st)}`)
function kompakt(v) {
    if (v == null || !Number.isFinite(v)) return '—'
    const a = Math.abs(v)
    if (a >= 1e9) return zahl(v / 1e9, 2) + ' Mrd'
    if (a >= 1e6) return zahl(v / 1e6, 2) + ' Mio'
    if (a >= 1e4) return zahl(v / 1e3, 1) + 'k'
    return zahl(v, 0)
}

/** „auf der letzten Kerze" / „vor 3 Kerzen". */
const wann = (n, t) => (n === 0 ? t('chart.tab.jetzt') : t('chart.tab.vor', { n }, n))

const ZEILEN = {
    atr(k, t) {
        const z = [
            { titel: t('chart.tab.atr.wert'), wert: `${preis(k.atr)} (${zahl(k.atrPct, 2)} %)` },
        ]
        if (k.stufe) {
            z.push({
                titel: t('chart.tab.atr.einordnung'),
                wert: t('chart.tab.atr.einordnungWert', { stufe: t('chart.tab.stufe.' + k.stufe), p: k.perzentil, x: zahl(k.vielfaches, 1) }),
                ton: k.stufe === 'hoch' ? 'warn' : null,
            })
        }
        if (k.richtungPct != null) z.push({ titel: t('chart.tab.atr.richtung'), wert: `${t(k.richtungPct > 3 ? 'chart.tab.steigt' : k.richtungPct < -3 ? 'chart.tab.faellt' : 'chart.tab.flach')} (${vz(k.richtungPct, 0)} %)` })
        z.push({ titel: t('chart.tab.atr.kerze'), wert: `${zahl(k.kerzeAtr, 1)} ATR`, ton: k.kerzeAtr > 1.5 ? 'warn' : null })
        z.push({ titel: t('chart.tab.atr.stops'), wert: k.stops.map((s) => `${zahl(s.faktor, 1)}× ${preis(s.abstand)} (${zahl(s.pct, 2)} %)`).join(' · ') })
        if (k.tag) {
            z.push({
                titel: t('chart.tab.atr.tag'),
                wert: t('chart.tab.atr.tagWert', { pct: zahl(k.tag.anteilPct, 0), spanne: preis(k.tag.spanne), median: preis(k.tag.ueblich), n: k.tag.tage }),
                ton: k.tag.anteilPct >= 100 ? 'warn' : null,
            })
        }
        return z
    },
    adx(k, t) {
        const seite = k.seite === 'long' ? t('chart.tab.adx.kaeufer') : k.seite === 'short' ? t('chart.tab.adx.verkaeufer') : t('chart.tab.adx.ausgeglichen')
        const z = [
            { titel: t('chart.tab.adx.trend'), wert: `${t('chart.tab.adx.stufe.' + k.stufe)} (${zahl(k.adx, 1)})`, ton: k.stufe === 'keinTrend' ? null : 'gut' },
            { titel: t('chart.tab.adx.druck'), wert: `${seite} · +DI ${zahl(k.plus, 1)} / −DI ${zahl(k.minus, 1)}`, ton: k.seite === 'long' ? 'gut' : k.seite === 'short' ? 'schlecht' : null },
        ]
        if (k.tendenz) z.push({ titel: t('chart.tab.adx.kraft'), wert: `${t('chart.tab.' + k.tendenz)} (${vz(k.steigung)} ${t('chart.tab.inKerzen', { n: 3 })})` })
        if (k.kreuzung) z.push({ titel: t('chart.tab.adx.kreuzung'), wert: t(k.kreuzung.nach === 'long' ? 'chart.tab.adx.kreuzungLong' : 'chart.tab.adx.kreuzungShort', { wann: wann(k.kreuzung.vorKerzen, t) }) })
        // Lesart: was die drei Linien zusammen sagen
        let lesart
        if (k.stufe === 'keinTrend') lesart = 'seitwaerts'
        else if (k.stufe === 'entsteht') lesart = k.tendenz === 'steigt' ? 'entsteht' : 'schwach'
        else if (k.tendenz === 'faellt') lesart = (k.stufe === 'stark' || k.stufe === 'sehrStark') ? 'erschoepfung' : 'laesstNach'
        else lesart = k.seite === 'long' ? 'trendLong' : 'trendShort'
        z.push({ titel: t('chart.tab.lesart'), wert: t('chart.tab.adx.lesart.' + lesart) })
        return z
    },
    mfi(k, t) {
        const z = [
            { titel: 'MFI', wert: `${zahl(k.mfi, 1)} · ${t('chart.tab.mfi.zone.' + k.zone)}`, ton: k.zone === 'ueberkauft' ? 'warn' : k.zone === 'ueberverkauft' ? 'warn' : null },
            { titel: t('chart.tab.mfi.fluss'), wert: t('chart.tab.mfi.' + k.fluss), ton: k.fluss === 'zufluss' ? 'gut' : k.fluss === 'abfluss' ? 'schlecht' : null },
        ]
        if (k.tendenz) z.push({ titel: t('chart.tab.tendenz'), wert: `${t('chart.tab.' + k.tendenz)} (${vz(k.diff)} ${t('chart.tab.inKerzen', { n: 3 })})` })
        z.push({ titel: t('chart.tab.mfi.seit'), wert: t('chart.tab.kerzen', { n: k.seitKerzen }, k.seitKerzen) })
        z.push({ titel: t('chart.tab.divergenz'), wert: t('chart.tab.div.' + (k.divergenz || 'keine')), ton: k.divergenz ? 'warn' : null })
        return z
    },
    obv(k, t) {
        return [
            { titel: t('chart.tab.obv.netto', { n: k.kerzen }), wert: `${vz(k.nettoPct, 0)} %`, ton: k.nettoPct > 10 ? 'gut' : k.nettoPct < -10 ? 'schlecht' : null },
            { titel: t('chart.tab.kurs', { n: k.kerzen }), wert: `${vz(k.kursPct, 2)} %` },
            { titel: t('chart.tab.obv.abgleich'), wert: t('chart.tab.obv.' + k.abgleich), ton: k.abgleich === 'verteilung' || k.abgleich === 'akkumulation' ? 'warn' : null },
            ...(k.lage ? [{ titel: t('chart.tab.obv.lage', { n: k.kerzen }), wert: t('chart.tab.obv.lage_' + k.lage) }] : []),
        ]
    },
    oi(k, t) {
        const zeile = (f) => (f ? `OI ${vz(f.oiPct, 2)} % · ${t('chart.tab.kursKurz')} ${vz(f.kursPct, 2)} % → ${f.lage ? t('chart.tab.oi.' + f.lage) : '—'}` : '—')
        const ton = (f) => (!f?.lage ? null : f.lage === 'neueLongs' || f.lage === 'shortEindeckung' ? 'gut' : f.lage === 'neueShorts' || f.lage === 'longAusstieg' ? 'schlecht' : null)
        return [
            { titel: 'Open Interest', wert: kompakt(k.oi) },
            { titel: t('chart.tab.oi.letzte'), wert: zeile(k.letzte), ton: ton(k.letzte) },
            ...(k.fenster ? [{ titel: t('chart.tab.kerzen', { n: k.fenster.kerzen }, k.fenster.kerzen), wert: zeile(k.fenster), ton: ton(k.fenster) }] : []),
        ]
    },
    rsi(k, t) {
        const z = osz(k, t, 70, 30)
        z.splice(1, 0, { titel: t('chart.tab.rsi.mitte'), wert: t('chart.tab.rsi.mitte_' + k.mitte), ton: k.mitte === 'ueber' ? 'gut' : k.mitte === 'unter' ? 'schlecht' : null })
        if (k.maKreuzung) z.push({ titel: t('chart.tab.rsi.ma'), wert: t(k.maKreuzung.nach === 'oben' ? 'chart.tab.rsi.maOben' : 'chart.tab.rsi.maUnten', { wann: wann(k.maKreuzung.vorKerzen, t) }) })
        return z
    },
    stoch(k, t) { return stoch(k, t) },
    stochRsi(k, t) { return stoch(k, t) },
    macd(k, t) {
        const z = [
            { titel: t('chart.tab.macd.trend'), wert: t('chart.tab.macd.' + k.trend), ton: k.trend === 'ueberNull' ? 'gut' : k.trend === 'unterNull' ? 'schlecht' : null },
            { titel: t('chart.tab.macd.linie'), wert: t('chart.tab.macd.' + k.linie), ton: k.linie === 'ueberSignal' ? 'gut' : 'schlecht' },
        ]
        if (k.schwung) z.push({ titel: t('chart.tab.macd.schwung'), wert: t('chart.tab.macd.schwung_' + k.schwung) })
        if (k.kreuzung) z.push({ titel: t('chart.tab.macd.kreuzung'), wert: t(k.kreuzung.nach === 'oben' ? 'chart.tab.macd.kreuzungOben' : 'chart.tab.macd.kreuzungUnten', { wann: wann(k.kreuzung.vorKerzen, t) }) })
        if (k.nullKreuzung) z.push({ titel: t('chart.tab.macd.null'), wert: t(k.nullKreuzung.nach === 'oben' ? 'chart.tab.macd.nullOben' : 'chart.tab.macd.nullUnten', { wann: wann(k.nullKreuzung.vorKerzen, t) }) })
        return z
    },
    funding(k, t) {
        const z = [
            { titel: t('chart.tab.funding.letzte'), wert: `${vz(k.letzte, 4)} % · ${t('chart.tab.funding.stufe.' + k.stufe)}`, ton: k.stufe === 'hoch' || k.stufe === 'negativ' ? 'warn' : null },
            { titel: t('chart.tab.funding.zahlt'), wert: t(k.zahlt === 'longs' ? 'chart.tab.funding.longsZahlen' : k.zahlt === 'shorts' ? 'chart.tab.funding.shortsZahlen' : 'chart.tab.funding.niemand') },
        ]
        if (k.tagPct != null) z.push({ titel: '24 h', wert: `${vz(k.tagPct, 4)} % · ${t('chart.tab.funding.jahr', { pct: vz(k.jahrPct, 1) })}` })
        if (k.wochePct != null) z.push({ titel: t('chart.tab.funding.woche'), wert: `${vz(k.wochePct, 3)} %` })
        return z
    },
    longShort(k, t) {
        const z = [
            { titel: t('chart.tab.long.anteil'), wert: `${zahl(k.wert, 1)} % ${t('chart.tab.long.konten')}`, ton: null },
        ]
        if (k.perzentil != null) z.push({ titel: t('chart.tab.long.einordnung'), wert: t('chart.tab.long.perzentil', { p: k.perzentil }), ton: k.gedraenge ? 'warn' : null })
        if (k.diff20 != null) z.push({ titel: t('chart.tab.long.aenderung'), wert: `${vz(k.diff20, 1)} ${t('chart.tab.punkte')}` })
        z.push({ titel: t('chart.tab.lesart'), wert: t('chart.tab.long.lesart_' + (k.gedraenge || 'normal')) })
        return z
    },
    volSma(k, t) {
        const z = [
            { titel: t('chart.tab.vol.letzte'), wert: t('chart.tab.vol.rvol', { x: zahl(k.rvol, 1), n: k.laenge }), ton: k.rvol >= 2 ? 'warn' : null },
            { titel: t('chart.tab.vol.laufend'), wert: `${zahl(k.laufend, 1)}× ${t('chart.tab.vol.bisher')}` },
        ]
        if (k.perzentil != null) z.push({ titel: t('chart.tab.vol.rang'), wert: t('chart.tab.vol.perzentil', { p: k.perzentil }) })
        if (k.trendPct != null) z.push({ titel: t('chart.tab.vol.trend'), wert: `${t(k.trendPct > 10 ? 'chart.tab.steigt' : k.trendPct < -10 ? 'chart.tab.faellt' : 'chart.tab.flach')} (${vz(k.trendPct, 0)} %)` })
        return z
    },
}

/** Gemeinsame Zeilen der Oszillatoren 0–100. */
function osz(k, t, oben, unten) {
    const z = [{ titel: t('chart.tab.wert'), wert: `${zahl(k.wert, 1)} · ${t('chart.tab.mfi.zone.' + k.zone)}`, ton: k.zone === 'neutral' ? null : 'warn' }]
    if (k.tendenz) z.push({ titel: t('chart.tab.tendenz'), wert: `${t('chart.tab.' + k.tendenz)} (${vz(k.diff)} ${t('chart.tab.inKerzen', { n: 3 })})` })
    z.push({ titel: t('chart.tab.mfi.seit'), wert: t('chart.tab.kerzen', { n: k.seitKerzen }, k.seitKerzen) + (k.zone !== 'neutral' ? ` (${t('chart.tab.zoneHinweis', { o: oben, u: unten })})` : '') })
    z.push({ titel: t('chart.tab.divergenz'), wert: t('chart.tab.div.' + (k.divergenz || 'keine')), ton: k.divergenz ? 'warn' : null })
    return z
}

function stoch(k, t) {
    const z = osz(k, t, 80, 20)
    if (k.kUeberD != null) z.splice(1, 0, { titel: '%K / %D', wert: t(k.kUeberD ? 'chart.tab.stoch.kUeber' : 'chart.tab.stoch.kUnter', { d: zahl(k.d, 1) }), ton: k.kUeberD ? 'gut' : 'schlecht' })
    if (k.kreuzung) z.push({ titel: t('chart.tab.adx.kreuzung'), wert: t(k.kreuzung.nach === 'oben' ? 'chart.tab.stoch.kreuzOben' : 'chart.tab.stoch.kreuzUnten', { wann: wann(k.kreuzung.vorKerzen, t) }) + (k.kreuzung.vorKerzen <= 2 && k.zone !== 'neutral' ? ` — ${t('chart.tab.stoch.inZone')}` : '') })
    return z
}

/** Zeilen für ein Fenster, oder [] ohne Kennzahlen. */
export function tabellenZeilen(art, kennzahlen, t) {
    if (!kennzahlen || !ZEILEN[art]) return []
    return ZEILEN[art](kennzahlen, t)
}
