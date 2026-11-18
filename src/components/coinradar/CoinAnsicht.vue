<script setup>
/**
 * Coin-Ansicht: der Steckbrief eines einzelnen Coins im Coin-Radar — das
 * Gegenstück zur Aktien-Titel-Seite (`components/aktien/TitelAnsicht.vue`),
 * mit demselben Aufbau:
 *
 *   Kopf        Kürzel, Name, Rang und Kategorien; daneben, WO er handelbar ist
 *   Kursband    links Kurs, 24-h-Spanne, 52-Wochen-Spanne, Abstand zum
 *               Allzeithoch; rechts der Verlauf (auf Wunsch gegen BTC)
 *   Streifen    Marktkapitalisierung, FDV, Umlauf, Umsatz, Alter
 *   Zweierreihe Derivate · Radar-Messung
 *   Projekt-Lage Meldungen eines Jahres mit Warnsignalen (`CoinLage.vue`);
 *               KI-Recherche dazu nur auf Knopfdruck
 *   Dreierreihe Projekt · Token-Angebot · Im Haus
 *   Tiefensuche Vertrag, Halter, Projektprüfung — nur auf Knopfdruck
 *
 * WOHER WAS KOMMT
 *   Börse (Marktdatenquelle, sonst Bitunix): Kurs, Spannen, Verlauf, Umsatz
 *     des Perpetuals, Derivate, Messung. Steht immer da.
 *   CoinGecko (`/api/coin-radar/coin-info`, 24 h Vorrat): Name, Rang,
 *     Kategorien, Mengen, Allzeithoch, Projekt. Ohne Freigabe oder Schlüssel
 *     sagt die Ansicht in einem Satz, was fehlt und wo man es einschaltet —
 *     der Rest bleibt vollständig.
 *   Eigene Datenbank: «Im Haus».
 *
 * Die Messung selbst (`bericht`) holt die Seite (`views/CoinRadar.vue`,
 * Einzelprüfung) und reicht sie herein; alles Weitere lädt die Ansicht je
 * Karte für sich, mit eigenem Lade- und Fehlerzustand. Die Tiefensuche kostet
 * Abrufe bei Dritten und läuft deshalb nie von selbst.
 *
 * OHNE FUTURE (`bericht.ohneFuture`, 18.11.2026): Führt keine Börse ein
 * Perpetual, kennt CoinGecko den Coin aber (HONEY/Hivemapper), öffnet die
 * Ansicht trotzdem — gekennzeichnet, mit Kurs, Änderungen und Kennzahlen von
 * CoinGecko und dem CoinGecko-Verlauf (nur Schlusskurse). Ohne Derivate,
 * Messung, Chart-Knopf, Börsen und Favorit (der Coin-Radar-Favorit verlangt
 * ein Perpetual).
 *
 * Die Ansicht beschreibt einen Zustand. Sie empfiehlt nichts.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../basis/Knopf.vue'
import Pille from '../basis/Pille.vue'
import Karte from '../basis/Karte.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import Symbol from '../basis/Symbol.vue'
import Quellenhinweis from '../basis/Quellenhinweis.vue'
import Diagramm from '../strategien/Diagramm.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import TickerZeichen from '../hype/TickerZeichen.vue'
import TiefensucheErgebnis from '../hype/TiefensucheErgebnis.vue'
import CoinDerivate from './CoinDerivate.vue'
import CoinMessung from './CoinMessung.vue'
import CoinProjekt from './CoinProjekt.vue'
import CoinAngebot from './CoinAngebot.vue'
import CoinKontext from './CoinKontext.vue'
import CoinLage from './CoinLage.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { appEinstellungen } from '../../stores/app/rahmen.js'
import { BOERSE_NAME, boerseUrl, aktivierteBoersen } from '../../utils/boersenLinks.js'
import { palette, tooltipStil, schrift } from '../../utils/journal/diagramme/gestaltung.js'
import {
    buendelFaktor, stueckPreis, basisKurz, lageInSpanne, jahresSpanne, abstandZu, marktwerte, alterMonate,
    verlaufsLinie, linienAenderung, gegenBtc,
} from '../../utils/coinAnsicht.js'

const props = defineProps({
    /** Bericht der Einzelprüfung (`/api/coin-radar/einzel`), `gefunden: true`. */
    bericht: { type: Object, required: true },
    konstanten: { type: Object, default: () => ({}) },
    /** Die Seite misst gerade neu. */
    misst: { type: Boolean, default: false },
    favorit: { type: Boolean, default: false },
})
const emit = defineEmits(['neu-messen', 'favorit', 'schliessen'])
const { t } = useI18n()
const { zahl, kurs, prozent, usd, gross, datum, zeit, uhr, richtung } = useCoinFormat()

const SPANNEN = [{ id: 'm1', tage: 31 }, { id: 'm6', tage: 183 }, { id: 'j1', tage: 366 }, { id: 'j2', tage: 800 }]
const HANDELSPLAETZE = ['bitunix', 'bitget', 'pionex']

const symbol = computed(() => props.bericht.symbol)
/** Kein Perpetual — Daten von CoinGecko. */
const ohneFuture = computed(() => props.bericht.ohneFuture === true)
/** CoinGecko-Verlauf: ein Schlusskurs je Tag, ein Jahr. */
const nurSchluss = computed(() => verlauf.value?.nurSchluss === true)
const spannenListe = computed(() => (nurSchluss.value ? SPANNEN.filter((s) => s.tage <= (verlauf.value?.tage || 365) + 1) : SPANNEN))
const basis = computed(() => basisKurz(symbol.value))
const faktor = computed(() => buendelFaktor(symbol.value))
const preis = computed(() => props.bericht.preis ?? null)
const stueck = computed(() => stueckPreis(preis.value, symbol.value))

/* ── Stammdaten (CoinGecko) ────────────────────────────────────────── */
const info = ref(undefined)        // undefined = (noch) nichts, null = kein Treffer
const infoLaedt = ref(false)
const infoAus = ref(null)
const infoFehler = ref('')
/* ── Tagesverlauf (Börse) ──────────────────────────────────────────── */
const verlauf = ref(null)
const verlaufLaedt = ref(false)
const verlaufAus = ref(null)
const verlaufFehler = ref('')
const spanne = ref('m6')
const mitBtc = ref(false)
/* ── Tiefensuche (nur auf Knopfdruck) ──────────────────────────────── */
const tiefe = ref(null)
const tiefeLaeuft = ref(false)
const tiefeFehler = ref('')

let lauf = 0
async function ladeInfo(eigener) {
    infoLaedt.value = true
    try {
        const { data } = await axios.get('/api/coin-radar/coin-info', { params: { symbol: symbol.value } })
        if (eigener !== lauf) return
        if (data?.aus) infoAus.value = data
        else info.value = data?.info ?? null
    } catch (e) {
        if (eigener === lauf) infoFehler.value = e.response?.data?.error || e.message
    } finally {
        if (eigener === lauf) infoLaedt.value = false
    }
}
async function ladeVerlauf(eigener) {
    verlaufLaedt.value = true
    try {
        const { data } = await axios.get('/api/coin-radar/ansicht/verlauf', { params: { symbol: symbol.value }, timeout: 40000 })
        if (eigener !== lauf) return
        if (data?.aus) verlaufAus.value = data
        else if (data?.gefunden) verlauf.value = data
    } catch (e) {
        if (eigener === lauf) verlaufFehler.value = e.response?.data?.error || e.message
    } finally {
        if (eigener === lauf) verlaufLaedt.value = false
    }
}
function lade() {
    const eigener = ++lauf
    info.value = undefined
    infoAus.value = null
    infoFehler.value = ''
    verlauf.value = null
    verlaufAus.value = null
    verlaufFehler.value = ''
    tiefe.value = null
    tiefeFehler.value = ''
    mitBtc.value = false
    ladeInfo(eigener)
    ladeVerlauf(eigener)
}
watch(symbol, lade, { immediate: true })

async function tiefensuche() {
    if (tiefeLaeuft.value) return
    const fuer = symbol.value
    tiefeLaeuft.value = true
    tiefeFehler.value = ''
    try {
        const { data } = await axios.get('/api/coin-radar/tiefensuche', { params: { symbol: fuer }, timeout: 120000 })
        if (fuer === symbol.value) tiefe.value = data
    } catch (e) {
        if (fuer === symbol.value) tiefeFehler.value = e.response?.data?.error || e.message
    } finally {
        tiefeLaeuft.value = false
    }
}

/* ── Kopf ──────────────────────────────────────────────────────────── */
const name = computed(() => info.value?.name || t('coinAnsicht.perpName', { basis: basis.value }))
const unterzeile = computed(() => {
    const teile = []
    if (info.value?.marketCapRang) teile.push(t('coinradar.coinInfoRang', { n: info.value.marketCapRang }))
    for (const k of (info.value?.kategorien || []).slice(0, 2)) teile.push(k)
    if (!ohneFuture.value) teile.push(t(faktor.value > 1 ? 'coinAnsicht.perpBuendel' : 'coinAnsicht.perp', { n: gross(faktor.value, 0) }))
    return teile.join(' · ')
})
/**
 * Wo das Perpetual handelbar ist. Die Listungsprüfung der Messung, sonst —
 * wenn sie nicht zu holen war — wenigstens das, was die Messung selbst weiss.
 */
const plaetze = computed(() => {
    const liste = props.bericht.boersen?.liste
    const namen = Array.isArray(liste)
        ? HANDELSPLAETZE.filter((b) => liste.some((e) => e.boerse === b && e.futures !== false))
        : (props.bericht.aufBitunix ? ['bitunix'] : [])
    const mitLink = aktivierteBoersen(appEinstellungen.value?.boersenLinks)
    return namen.map((b) => ({ id: b, name: BOERSE_NAME[b] || b, url: mitLink.includes(b) ? boerseUrl(b, symbol.value) : null }))
})
const plaetzeUnbekannt = computed(() => (props.bericht.boersen?.unbekannt || []).filter((b) => HANDELSPLAETZE.includes(b)).map((b) => BOERSE_NAME[b] || b))
/** Der Chart folgt der Quelle der Messung: ein Paar, das Binance nicht führt, lädt er von Bitunix. */
const chartZiel = computed(() => boerseUrl('tradingview', symbol.value, props.bericht.quelle === 'bitunix' ? 'BITUNIX' : 'BINANCE'))
const quelleName = computed(() => (ohneFuture.value ? 'CoinGecko' : props.bericht.quelle === 'bitunix' ? 'Bitunix' : (verlauf.value?.quelleName || t('coinAnsicht.marktdatenquelle'))))

/* ── Kursband ──────────────────────────────────────────────────────── */
const tag = computed(() => props.bericht.tag || null)
const lageTag = computed(() => lageInSpanne(preis.value, tag.value?.tief, tag.value?.hoch))
const jahr = computed(() => jahresSpanne(verlauf.value?.kerzen, preis.value, props.bericht.gemessenAm))
const lageJahr = computed(() => lageInSpanne(preis.value, jahr.value?.tief, jahr.value?.hoch))
// Ohne Future ist der Kurs der von CoinGecko; gerechnet wird wie sonst (FDV mit der Höchstmenge), nur die Fusszeile sagt es anders.
const werte = computed(() => marktwerte(info.value?.markt, stueck.value))
/** Allzeithoch und -tief in der Einheit des Kontrakts (bei Bündeln × 1000), nur wenn der Coin sichtlich derselbe ist. */
const allzeit = computed(() => {
    const m = info.value?.markt
    if (!m?.athUsd || werte.value.passt === false) return null
    const hoch = m.athUsd * faktor.value
    const tief = m.atlUsd ? m.atlUsd * faktor.value : null
    const ueber = preis.value != null && preis.value > hoch
    return {
        hoch, tief, hochAm: m.athAm, tiefAm: m.atlAm, ueber,
        abstandPct: abstandZu(preis.value, hoch),
        lage: ueber ? 100 : lageInSpanne(preis.value, tief ?? 0.0000000001, hoch),
    }
})

const spanneTage = computed(() => SPANNEN.find((s) => s.id === spanne.value).tage)
const linie = computed(() => verlaufsLinie(verlauf.value?.kerzen, spanneTage.value, props.bericht.gemessenAm, preis.value))
const linieAenderung = computed(() => linienAenderung(linie.value))
const btcLinie = computed(() => {
    const b = verlauf.value?.btc
    if (!b?.length) return []
    const ab = props.bericht.gemessenAm - spanneTage.value * 86_400_000
    return b.filter((p) => p[0] >= ab)
})
/** Vergleich über den Abschnitt aus geschlossenen Tagen — beide Reihen enden am selben Tag. */
const vergleich = computed(() => gegenBtc(linie.value.filter((p) => p[0] < props.bericht.gemessenAm), btcLinie.value))
const diagramm = computed(() => {
    const p = palette()
    const zeitAchse = { type: 'time', axisLine: { lineStyle: { color: p.line } }, axisTick: { show: false }, axisLabel: schrift(p), splitLine: { show: false } }
    const wertAchse = { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } } }
    if (mitBtc.value && vergleich.value) {
        const v = vergleich.value
        return {
            animation: false,
            grid: { left: 52, right: 12, top: 10, bottom: 24 },
            tooltip: {
                trigger: 'axis', ...tooltipStil(p),
                formatter: (x) => `${datum(x[0].value[0])}<br>${x.map((s) => `${s.seriesName}: <b>${prozent(s.value[1], 1)}</b>`).join('<br>')}`,
            },
            xAxis: zeitAchse,
            yAxis: { ...wertAchse, axisLabel: { ...schrift(p), formatter: (w) => `${zahl(w, 0)} %` } },
            series: [
                { name: 'BTC', type: 'line', data: v.btc, showSymbol: false, lineStyle: { color: p.leise, width: 1.2 }, itemStyle: { color: p.leise } },
                { name: basis.value, type: 'line', data: v.coin, showSymbol: false, lineStyle: { color: p.accent, width: 1.5 }, itemStyle: { color: p.accent } },
            ],
        }
    }
    const l = linie.value
    if (l.length < 2) return null
    return {
        animation: false,
        grid: { left: 62, right: 12, top: 10, bottom: 24 },
        tooltip: { trigger: 'axis', ...tooltipStil(p), formatter: (x) => `${datum(x[0].value[0])}<br><b>${kurs(x[0].value[1])}</b> USDT` },
        xAxis: zeitAchse,
        yAxis: { ...wertAchse, axisLabel: { ...schrift(p), formatter: (w) => kurs(w) } },
        // Türkise Hauslinie in Stufen wie auf der Titel-Seite: der Verlauf ist Kontext, das Vorzeichen steht daneben.
        series: [{ type: 'line', step: 'end', data: l, showSymbol: false, lineStyle: { color: p.accent, width: 1.4 } }],
    }
})

/* ── Kennzahlen-Streifen ───────────────────────────────────────────── */
const cgZustand = computed(() => (infoLaedt.value ? 'laedt' : info.value ? 'da' : 'fehlt'))
const alterText = (seit) => {
    const m = alterMonate(seit, props.bericht.gemessenAm)
    if (m == null) return '—'
    return m < 24 ? t('coinAnsicht.alterMonate', { n: m }, m) : t('coinAnsicht.alterJahre', { n: Math.floor(m / 12) }, Math.floor(m / 12))
}
const streifen = computed(() => {
    const w = werte.value
    const m = info.value?.markt
    const cg = (wert) => (cgZustand.value === 'laedt' ? '…' : wert)
    const dilution = w.marktkap && w.fdv ? Math.max(1, w.fdv / w.marktkap) : null
    const alter = info.value?.genesis
        ? { wert: alterText(info.value.genesis), neben: t('coinAnsicht.seitGenesis', { datum: datum(info.value.genesis) }) }
        : nurSchluss.value
            ? { wert: '—', neben: '' }
            : verlauf.value?.ersterTag
            ? { wert: alterText(verlauf.value.ersterTag), neben: t('coinAnsicht.seitHandel', { datum: datum(verlauf.value.ersterTag), boerse: quelleName.value }) }
            : verlauf.value?.kerzen?.length
                ? { wert: t('coinAnsicht.alterUeber', { n: 2 }), neben: t('coinAnsicht.seitHandelUeber', { boerse: quelleName.value }) }
                : { wert: verlaufLaedt.value ? '…' : '—', neben: '' }
    const zellen = [
        { id: 'marktkap', wert: cg(usd(w.marktkap)), neben: info.value?.marketCapRang ? t('coinAnsicht.rangKurz', { n: info.value.marketCapRang }) : '' },
        { id: 'fdv', wert: cg(usd(w.fdv)), neben: dilution ? t('coinAnsicht.fdvFach', { n: zahl(dilution, 2) }) : '' },
        { id: 'umlauf', wert: cg(gross(m?.umlauf)), neben: w.umlaufAnteilPct != null ? t('coinAnsicht.umlaufVon_' + w.deckeArt, { n: zahl(w.umlaufAnteilPct, 0) }) : '' },
        { id: 'umsatzPerp', wert: usd(props.bericht.umsatz24h), neben: t('coinAnsicht.umsatzPerpNeben', { boerse: quelleName.value }) },
        { id: 'umsatzGesamt', wert: cg(usd(m?.umsatz24hUsd)), neben: w.umsatzZuMarktkapPct != null ? t('coinAnsicht.umsatzZuKap', { n: zahl(w.umsatzZuMarktkapPct, 1) }) : '' },
        { id: 'alter', wert: alter.wert, neben: alter.neben },
    ]
    // Ohne Future gibt es keinen Perp-Umsatz; es bleibt der Spot-Umsatz von CoinGecko.
    return ohneFuture.value ? zellen.filter((z) => z.id !== 'umsatzPerp') : zellen
})
/** Änderungen 7 T / 30 T / 1 J aus dem CoinGecko-Markt (nur ohne Future; mit Future trägt der Verlauf das). */
const aenderungen = computed(() => {
    const a = props.bericht.aenderungen
    if (!ohneFuture.value || !a) return []
    return [['d7', a.d7], ['d30', a.d30], ['j1', a.j1]].filter(([, w]) => w != null).map(([id, w]) => ({ id, w }))
})

const quellen = computed(() => [
    // Ohne Future kommt alles von CoinGecko — die Pflichtzeile genügt.
    ...(ohneFuture.value ? [] : [{ name: quelleName.value, art: 'daten' }]),
    ...(info.value ? [{ name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' }] : []),
])
</script>

<template>
    <article class="coin-ansicht" :aria-label="t('coinAnsicht.aria', { symbol: basis })" :aria-busy="misst ? 'true' : 'false'">
        <!-- Kopf: wer, und wo handelbar -->
        <header class="kopf">
            <div class="wer">
                <!-- Logo nur, wenn der Server eines mitliefert (Schalter «tokenbilder»); sonst trägt das Kürzel allein. -->
                <TickerZeichen v-if="info?.bild" :symbol="basis" :bild="info.bild" />
                <span class="kuerzel">{{ basis }}</span>
                <div class="namen">
                    <h2>{{ name }}</h2>
                    <span class="ca-klein">{{ unterzeile }}</span>
                </div>
            </div>
            <div v-if="plaetze.length || plaetzeUnbekannt.length" class="plaetze">
                <span class="ca-klein">{{ t('aktien.handelbarBei') }}</span>
                <template v-for="p in plaetze" :key="p.id">
                    <a v-if="p.url" :href="p.url" target="_blank" rel="noopener noreferrer" class="platzLink" :title="t('coinradar.gelistetAuf', { b: p.name })">
                        <Pille ton="akzent">{{ p.name }} · {{ t('coinAnsicht.perpKurz') }}</Pille>
                    </a>
                    <Pille v-else ton="akzent" :title="t('coinradar.gelistetAuf', { b: p.name })">{{ p.name }} · {{ t('coinAnsicht.perpKurz') }}</Pille>
                </template>
                <Pille v-if="plaetzeUnbekannt.length" ton="neutral" :title="t('coinAnsicht.plaetzeUnbekanntTitel')">
                    {{ t('coinAnsicht.plaetzeUnbekannt', { boersen: plaetzeUnbekannt.join(', ') }) }}
                </Pille>
            </div>
            <div class="knoepfe">
                <button v-if="!ohneFuture" type="button" :class="['stern', { an: favorit }]" :aria-pressed="favorit ? 'true' : 'false'"
                    :title="favorit ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')" @click="emit('favorit')">
                    <Symbol name="stern" :gefuellt="favorit" />
                    <span>{{ t(favorit ? 'favoriten.istFavorit' : 'favoriten.merken') }}</span>
                </button>
                <Knopf v-if="!ohneFuture" klein art="haupt" symbol="chart" :to="chartZiel">{{ t('coinAnsicht.zumChart') }}</Knopf>
                <Knopf klein nur-symbol symbol="aktualisieren" :titel="t('coinAnsicht.neuMessen')" :laedt="misst" @click="emit('neu-messen')" />
                <Knopf klein nur-symbol art="leise" symbol="schliessen" :titel="t('coinradar.epSchliessen')" @click="emit('schliessen')" />
            </div>
        </header>

        <!-- Kein Perpetual: deutlich sagen, woher die Zahlen kommen und was fehlt. -->
        <Hinweis v-if="ohneFuture" art="info" class="ohneFuture">{{ t('coinAnsicht.ohneFuture', { basis }) }}</Hinweis>
        <p v-if="bericht.ergaenzt && !ohneFuture" class="ca-klein">{{ t('coinradar.epErgaenzt', { s: bericht.symbol }) }}</p>
        <!-- Der Kurs passt nicht zu dem, was CoinGecko unter diesem Kürzel führt: Stammdaten mit Vorsicht. -->
        <Hinweis v-if="info && werte.passt === false" art="warn">
            {{ t('coinAnsicht.kursPasstNicht', { name: info.name, cg: kurs(info.markt.preisUsd), boerse: kurs(stueck) }) }}
        </Hinweis>

        <!-- Kursband -->
        <section class="band">
            <div class="stand">
                <p class="preis">{{ kurs(preis) }}<span class="einheit">{{ ohneFuture ? 'USD' : 'USDT' }}</span></p>
                <p :class="['delta', 'ca-' + richtung(tag?.aenderungPct)]">
                    {{ prozent(tag?.aenderungPct) }} <span class="ca-klein">{{ t('coinAnsicht.in24h') }}</span>
                </p>
                <p class="ca-klein">{{ t('coinAnsicht.stand', { zeit: uhr(bericht.gemessenAm), quelle: quelleName }) }}</p>
                <p v-if="aenderungen.length" class="aenderungen">
                    <span v-for="a in aenderungen" :key="a.id">
                        <span class="ca-klein">{{ t('coinAnsicht.aenderung_' + a.id) }}</span>
                        <b :class="'ca-' + richtung(a.w)">{{ prozent(a.w, 1) }}</b>
                    </span>
                </p>

                <div class="lage">
                    <div class="ca-lageKopf"><span>{{ t('coinAnsicht.spanne24h') }}</span><b v-if="lageTag != null">{{ t('titel.lageProzent', { n: zahl(lageTag, 0) }) }}</b></div>
                    <div class="skala"><i v-if="lageTag != null" :style="{ width: lageTag + '%' }"></i></div>
                    <div class="ca-lageFuss"><span>{{ kurs(tag?.tief) }}</span><span>{{ kurs(tag?.hoch) }}</span></div>
                </div>
                <div class="lage">
                    <div class="ca-lageKopf">
                        <span>{{ jahr && !jahr.voll && !nurSchluss ? t('coinAnsicht.spanneSeit', { n: jahr.tage }, jahr.tage) : t('titel.jahresspanne') }}<template v-if="nurSchluss"> · {{ t('coinAnsicht.ausSchluss') }}</template></span>
                        <b v-if="lageJahr != null">{{ t('titel.lageProzent', { n: zahl(lageJahr, 0) }) }}</b>
                    </div>
                    <div class="skala"><i v-if="lageJahr != null" :style="{ width: lageJahr + '%' }"></i></div>
                    <div class="ca-lageFuss"><span>{{ verlaufLaedt ? '…' : kurs(jahr?.tief) }}</span><span>{{ verlaufLaedt ? '…' : kurs(jahr?.hoch) }}</span></div>
                </div>
                <div class="lage">
                    <div class="ca-lageKopf">
                        <span>{{ t('coinAnsicht.allzeit') }}</span>
                        <b v-if="allzeit">{{ allzeit.ueber ? t('coinAnsicht.allzeitUeber') : t('coinAnsicht.allzeitAbstand', { n: prozent(allzeit.abstandPct, Math.abs(allzeit.abstandPct) >= 99 ? 1 : 0) }) }}</b>
                    </div>
                    <div class="skala"><i v-if="allzeit?.lage != null" :style="{ width: allzeit.lage + '%' }"></i></div>
                    <div class="ca-lageFuss">
                        <template v-if="allzeit">
                            <span :title="datum(allzeit.tiefAm)">{{ kurs(allzeit.tief) }}</span>
                            <span :title="datum(allzeit.hochAm)">{{ kurs(allzeit.hoch) }} <span class="ca-klein">({{ datum(allzeit.hochAm) }})</span></span>
                        </template>
                        <span v-else>{{ infoLaedt ? '…' : t('coinAnsicht.allzeitFehlt') }}</span>
                    </div>
                </div>
            </div>

            <div class="verlauf">
                <div class="spannen" role="group" :aria-label="t('titel.zeitraum')">
                    <span v-if="mitBtc && vergleich" class="delta vergleich">
                        <span :class="'ca-' + richtung(vergleich.coinPct)">{{ prozent(vergleich.coinPct, 1) }}</span>
                        <span class="ca-klein">BTC {{ prozent(vergleich.btcPct, 1) }} · {{ t(vergleich.diffPct >= 0 ? 'coinAnsicht.staerker' : 'coinAnsicht.schwaecher', { n: zahl(Math.abs(vergleich.diffPct), 1) }) }}</span>
                    </span>
                    <span v-else-if="linieAenderung != null" :class="['delta', 'ca-' + richtung(linieAenderung)]">{{ prozent(linieAenderung, 1) }}</span>
                    <button v-if="verlauf?.btc?.length" type="button" class="btc" :class="{ aktiv: mitBtc }" :aria-pressed="mitBtc ? 'true' : 'false'"
                        :title="t('coinAnsicht.gegenBtcTitel')" @click="mitBtc = !mitBtc">{{ t('coinAnsicht.gegenBtc') }}</button>
                    <button v-for="s in spannenListe" :key="s.id" type="button" :class="{ aktiv: spanne === s.id }"
                        :aria-pressed="spanne === s.id ? 'true' : 'false'" @click="spanne = s.id">{{ t('titel.spanne_' + s.id) }}</button>
                </div>
                <div class="flaeche">
                    <Kreisel v-if="verlaufLaedt" :groesse="24" :titel="t('coinAnsicht.laedt')" />
                    <QuelleAus v-else-if="verlaufAus" :aus="verlaufAus" klein />
                    <p v-else-if="verlaufFehler" class="ca-klein">{{ verlaufFehler }}</p>
                    <Diagramm v-else-if="diagramm" :option="diagramm" :hoehe="270" />
                    <p v-else class="ca-klein">{{ t(mitBtc ? 'coinAnsicht.vergleichFehlt' : 'coinAnsicht.verlaufFehlt') }}</p>
                </div>
                <p v-if="nurSchluss && diagramm" class="ca-klein">{{ t('coinAnsicht.verlaufCoinGecko') }}</p>
            </div>
        </section>

        <!-- Kennzahlen-Streifen -->
        <section class="streifen" :aria-label="t('coinAnsicht.kennzahlen')">
            <div v-for="k in streifen" :key="k.id" class="zelle">
                <span class="name">{{ t('coinAnsicht.' + k.id) }}</span>
                <span class="wert">{{ k.wert }}</span>
                <span class="ca-klein neben">{{ k.neben }}</span>
            </div>
        </section>
        <!-- CoinGecko aus oder kennt das Kürzel nicht: ein Satz, was fehlt — der Rest steht. -->
        <div v-if="infoAus" class="cgFehlt">
            <p class="ca-klein">{{ t('coinAnsicht.cgFehltSatz') }}</p>
            <QuelleAus :aus="infoAus" klein />
        </div>
        <p v-else-if="info === null" class="ca-klein">{{ t('coinAnsicht.cgKenntNicht', { symbol: basis }) }}</p>
        <p v-else-if="info && !werte.frisch && werte.passt !== false" class="ca-klein">{{ t('coinAnsicht.cgStand', { zeit: zeit(info.markt.stand) }) }}</p>

        <!-- Derivate · Radar-Messung (ohne Future gibt es beides nicht — der Hinweis oben sagt es) -->
        <div v-if="!ohneFuture" class="reihe zwei">
            <CoinDerivate :bericht="bericht" />
            <CoinMessung :bericht="bericht" :konstanten="konstanten" />
        </div>

        <!-- Projekt-Lage: was sich am Projekt geändert hat — direkt über der Projekt-Karte, damit
             eine gute Projektbeschreibung nicht ohne die Meldungen dasteht. -->
        <CoinLage :symbol="symbol" />

        <!-- Projekt · Token-Angebot · Im Haus -->
        <div class="reihe drei">
            <CoinProjekt :symbol="basis" :info="info" :laedt="infoLaedt" :aus="infoAus" :fehler="infoFehler" />
            <CoinAngebot :info="info" :werte="werte" :laedt="infoLaedt" :aus="infoAus" :ohne-future="ohneFuture" />
            <CoinKontext :symbol="symbol" :favorit="favorit && !ohneFuture" />
        </div>

        <!-- Tiefensuche: der Token HINTER dem Perpetual. Kostet Abrufe bei Dritten — nur auf Knopfdruck. -->
        <Karte :titel="t('coinAnsicht.tiefe')" :unter="t('coinradar.tsHinweis')">
            <template #aktionen>
                <Knopf klein symbol="lupePlus" :laedt="tiefeLaeuft" @click="tiefensuche">{{ t(tiefe ? 'coinAnsicht.tiefeNeu' : 'coinradar.tsKnopf') }}</Knopf>
            </template>
            <Hinweis v-if="tiefeFehler" art="warn">{{ tiefeFehler }}</Hinweis>
            <QuelleAus v-else-if="tiefe?.aus" :aus="tiefe" klein />
            <TiefensucheErgebnis v-else-if="tiefe" :daten="tiefe" />
            <p v-else class="ca-klein">{{ t('coinAnsicht.tiefeVorher') }}</p>
        </Karte>

        <Quellenhinweis :quellen="quellen">{{ t('coinAnsicht.keineEmpfehlung') }}</Quellenhinweis>
    </article>
</template>

<!-- Gemeinsame Bausteine der Ansicht und ihrer Karten (`Coin*.vue`): bewusst
     nicht scoped, dafür alle unter `.coin-ansicht` und mit Vorsilbe `ca-`. -->
<style>
.coin-ansicht p {
    margin: 0;
}

.coin-ansicht .ca-klein {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
}

.coin-ansicht .ca-auf {
    color: var(--good);
}

.coin-ansicht .ca-ab {
    color: var(--bad);
}

.coin-ansicht .ca-warn {
    color: var(--warn);
}

.coin-ansicht .ca-schlecht {
    color: var(--bad);
}

.coin-ansicht .ca-fuss {
    margin-top: 0.7rem;
}

.coin-ansicht .ca-abstand {
    margin-top: 0.8rem;
}

.coin-ansicht .ca-h4 {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 1rem 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--muted);
}

.coin-ansicht .ca-link {
    margin-left: 0.5rem;
    color: var(--accent);
    font-size: 0.8rem;
    text-decoration: none;
}

.coin-ansicht .ca-link:hover {
    text-decoration: underline;
}

.coin-ansicht .ca-mehr {
    margin-top: 0.4rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.coin-ansicht .ca-nur-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

/* Ladefläche einer Karte: feste Mindesthöhe, damit beim Eintreffen nichts springt. */
.coin-ansicht .ca-laedt {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 9rem;
}

.coin-ansicht .ca-laedt.hoch {
    min-height: 15rem;
}

/* Kleine Kennzahl-Kacheln in einer Karte */
.coin-ansicht .ca-fakten {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--line);
    overflow: hidden;
}

.coin-ansicht .ca-fakt {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.75rem;
    background: var(--panel-soft);
    min-width: 0;
}

.coin-ansicht .ca-fakt .name {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
}

.coin-ansicht .ca-fakt .wert {
    font-size: 1.05rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

/* Waagrechte Balken (Teilnoten, Mengen) */
.coin-ansicht .ca-balken {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
}

.coin-ansicht .ca-balken li {
    display: grid;
    grid-template-columns: 6.6rem minmax(0, 1fr) 2.4rem;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.86rem;
}

.coin-ansicht .ca-balken.breit li {
    grid-template-columns: 6.6rem minmax(0, 1fr) 5.2rem;
}

.coin-ansicht .ca-balken .name {
    color: var(--muted);
}

.coin-ansicht .ca-balken b {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.coin-ansicht .ca-balken .spur {
    height: 10px;
    border-radius: 2px;
    background: var(--panel-soft);
    overflow: hidden;
}

.coin-ansicht .ca-balken .spur i {
    display: block;
    height: 100%;
    min-width: 2px;
    background: var(--accent);
}

/* Beschriftung über und unter einer Skala */
.coin-ansicht .ca-lageKopf,
.coin-ansicht .ca-lageFuss {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.coin-ansicht .ca-lageKopf b {
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
}

.coin-ansicht .ca-lageFuss {
    margin-top: 0.3rem;
}

/* Zeilen Name → Wert */
.coin-ansicht .ca-profil {
    margin: 0.7rem 0 0;
}

.coin-ansicht .ca-profil div {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.38rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.86rem;
}

.coin-ansicht .ca-profil dt {
    color: var(--muted);
    font-weight: 400;
}

.coin-ansicht .ca-profil dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

/* Kleine Zahlentabellen */
.coin-ansicht .ca-tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
    font-variant-numeric: tabular-nums;
}

.coin-ansicht .ca-tabelle th,
.coin-ansicht .ca-tabelle td {
    padding: 0.32rem 0.3rem;
    border-top: 1px solid var(--line);
    text-align: right;
    font-weight: 400;
}

.coin-ansicht .ca-tabelle thead th {
    border-top: 0;
    color: var(--muted);
    font-size: 0.74rem;
    white-space: nowrap;
}

.coin-ansicht .ca-tabelle th[scope='row'] {
    text-align: left;
    font-weight: 600;
}

/* Knöpfe und Marken im Kartenkopf nicht umbrechen */
.coin-ansicht .at-karte .aktionen {
    flex: 0 1 auto;
    justify-content: flex-end;
}

@media (max-width: 479.98px) {
    .coin-ansicht .ca-fakten {
        grid-template-columns: minmax(0, 1fr);
    }

    .coin-ansicht .ca-fakten.sechs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>

<style scoped>
.coin-ansicht {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    margin-top: 0.9rem;
}

a {
    color: var(--accent);
    text-decoration: none;
}

/* ── Kopf ── */
.kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem 1.2rem;
}

.wer {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
}

.namen {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.kuerzel {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--accent-rand);
    border-radius: var(--radius-knopf);
    background: var(--accent-flaeche);
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
}

.wer h2 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.plaetze {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 16rem;
}

.platzLink {
    display: inline-flex;
    border-radius: var(--radius-pille);
}

.platzLink:hover,
.platzLink:focus-visible {
    filter: brightness(1.2);
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
}

.stern {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem;
    border: 0;
    border-radius: var(--radius-klein);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.86rem;
    line-height: 1;
    cursor: pointer;
}

.stern:hover,
.stern.an {
    color: var(--accent);
}

.stern:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

/* ── Kursband ── */
.band {
    display: grid;
    grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    overflow: hidden;
}

.stand {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1.1rem 1.2rem;
    border-right: 1px solid var(--line);
    background: var(--panel-soft);
    min-width: 0;
}

.preis {
    font-size: 2.1rem;
    font-weight: 600;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

.einheit {
    margin-left: 0.4rem;
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--muted);
}

.delta {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.lage {
    margin-top: 0.8rem;
}

.skala {
    height: 6px;
    margin-top: 0.3rem;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
}

.skala i {
    display: block;
    height: 100%;
    background: var(--accent);
}

.verlauf {
    display: flex;
    flex-direction: column;
    padding: 0.8rem 0.9rem 0.4rem;
    min-width: 0;
}

.spannen {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.9rem;
}

.spannen .delta {
    margin-right: auto;
    font-size: 0.88rem;
}

.spannen .vergleich {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.1rem 0.6rem;
}

.spannen button {
    padding: 0.15rem 0.55rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
}

.spannen button.aktiv {
    color: var(--text);
    border-bottom-color: var(--accent);
}

.spannen button.btc {
    margin-right: 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
}

.spannen button.btc.aktiv {
    border-color: var(--accent-rand);
    background: var(--accent-flaeche);
    color: var(--accent);
}

/* Feste Höhe: Kreisel, Hinweis und Diagramm belegen dieselbe Fläche. */
.flaeche {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    min-height: 270px;
}

.flaeche > :deep(.diagramm) {
    align-self: stretch;
}

/* ── Kennzahlen-Streifen ── */
.streifen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    gap: 1px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--line);
    overflow: hidden;
}

.zelle {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.7rem 0.9rem;
    background: var(--panel);
    min-width: 0;
}

.zelle .name {
    font-size: 0.74rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
}

.zelle .wert {
    font-size: 1.15rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* Die Nebenzeile hält ihren Platz auch leer — sonst springt der Streifen, wenn CoinGecko eintrifft. */
.zelle .neben {
    min-height: 1.1em;
}

.cgFehlt {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

/* ── Reihen ── */
.reihe {
    display: grid;
    gap: 0.9rem;
    align-items: start;
}

.reihe.drei {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.aenderungen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    margin-top: 0.3rem !important;
    font-size: 0.86rem;
}

.aenderungen b {
    margin-left: 0.25rem;
    font-variant-numeric: tabular-nums;
}

.reihe.zwei {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
}

@media (max-width: 1199.98px) {
    .reihe.drei {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 899.98px) {
    .band,
    .reihe.drei,
    .reihe.zwei {
        grid-template-columns: minmax(0, 1fr);
    }

    .stand {
        border-right: 0;
        border-bottom: 1px solid var(--line);
    }

    .knoepfe {
        margin-left: 0;
    }
}

@media (max-width: 479.98px) {
    .preis {
        font-size: 1.7rem;
    }
}
</style>
