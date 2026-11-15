<script setup>
/**
 * Titel-Seite einer Aktie (Aktien-Integration): ein Steckbrief für die Frage
 * «lohnt der Blick, und wo kann ich handeln?».
 *
 * Aufbau von oben nach unten, bewusst eigen:
 *   Kopf        Name und gleich daneben, WO der Titel handelbar ist
 *   Kursband    links Kurs und Lage in der 52-Wochen-Spanne, rechts der Verlauf
 *   Streifen    sieben Kennzahlen als schmale Kacheln
 *   Dreierreihe Analysten (Abstand der Kursziele als Balken) · Quartalszahlen
 *               (Gewinn gegen Schätzung als Säulen) · Firma
 *   Zweierreihe letzte Einstufungen als Zeitleiste mit Bilanz · Recherche
 *
 * Zahlen kommen von Yahoo Finance (`/api/aktien/titel/:ticker`, hinter dem
 * Quellen-Schalter). Die Recherche «Was den Kurs bewegt hat» ist eine Websuche
 * über Perplexity — sie kostet und läuft deshalb nur auf Knopfdruck.
 * Unbekanntes steht als «—»; gerechnet wird in `utils/aktienTitel.js`.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../basis/Knopf.vue'
import Pille from '../basis/Pille.vue'
import Karte from '../basis/Karte.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import Diagramm from '../strategien/Diagramm.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { marktdaten, ladeMarktdaten } from '../../utils/marktdaten.js'
import { symbolBei, vorzug } from '../../utils/chart/aktienSymbole.js'
import { vorgabeBoerse, waehlbareBoersen } from '../../utils/chart/kerzenQuelle.js'
import { lageInSpanne, abstandPct, tageBis, einstufungsBilanz, zielBalken } from '../../utils/aktienTitel.js'

const props = defineProps({ ticker: { type: String, required: true } })
const { t, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const SPANNEN = [{ id: 'm1', tage: 31 }, { id: 'm6', tage: 183 }, { id: 'j1', tage: 366 }, { id: 'j2', tage: 800 }]
const KONSENS_TON = { starkKauf: 'gut', kauf: 'gut', halten: 'neutral', verkauf: 'schlecht', starkVerkauf: 'schlecht' }
const STUFEN = ['starkKauf', 'kauf', 'halten', 'verkauf', 'starkVerkauf']
const STIMMEN = [{ id: 'kauf', name: 'kaufen' }, { id: 'halten', name: 'halten' }, { id: 'verkauf', name: 'verkaufen' }]
const GUT = '#3fbf8f', SCHLECHT = '#e0574c', GRAU = '#4a5d66'

const seite = ref(null)
const aus = ref(null)
const laedt = ref(true)
const fehler = ref('')
const spanne = ref('m6')
const bewegung = ref(null)
const bewegungLaedt = ref(false)
const bewegungHinweis = ref('')
const alleEinstufungen = ref(false)

const d = computed(() => seite.value?.daten || null)
const waehrung = computed(() => d.value?.profil?.waehrung || '')

async function lade(neu = false) {
    laedt.value = true
    fehler.value = ''
    aus.value = null
    try {
        await ladeMarktdaten()
        const { data } = await axios.get(`/api/aktien/titel/${encodeURIComponent(props.ticker)}`, { params: neu ? { neu: 1 } : {}, timeout: 40000 })
        if (data?.aus) { aus.value = data; seite.value = null; return }
        seite.value = data
        axios.get(`/api/aktien/titel/${encodeURIComponent(props.ticker)}/bewegung`).then((r) => { bewegung.value = r.data?.bewegung || null }).catch(() => { })
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}
watch(() => props.ticker, () => { seite.value = null; bewegung.value = null; bewegungHinweis.value = ''; alleEinstufungen.value = false; lade() }, { immediate: true })

async function holeBewegung() {
    bewegungLaedt.value = true
    bewegungHinweis.value = ''
    try {
        const { data } = await axios.post(`/api/aktien/titel/${encodeURIComponent(props.ticker)}/bewegung`, { sprache: locale.value }, { timeout: 90000 })
        if (data?.ok) bewegung.value = data.bewegung
        else bewegungHinweis.value = t(data?.grund === 'schluesselFehlt' ? 'titel.bewegungOhneSchluessel' : 'titel.bewegungVerworfen')
    } catch (e) {
        bewegungHinweis.value = e.response?.data?.error || e.message
    } finally {
        bewegungLaedt.value = false
    }
}

/* ── Zahlenformate ─────────────────────────────────────────────────── */
const zahl = (v, n = 2) => (v == null ? '—' : Number(v).toLocaleString(locale.value, { minimumFractionDigits: n, maximumFractionDigits: n }))
const geld = (v, n = 2) => (v == null ? '—' : `${zahl(v, n)} ${waehrung.value}`.trim())
const prozent = (v, n = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${zahl(v, n)} %`)
const anteil = (v, n = 1) => (v == null ? '—' : `${zahl(v, n)} %`)
const gross = (v) => (v == null ? '—' : new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 2 }).format(v))
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const tagMonat = (ms) => (ms ? new Date(ms).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' }) : '—')
const zeit = (ms) => (ms ? new Date(ms).toLocaleString(locale.value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const richtung = (v) => (v == null || v === 0 ? '' : v > 0 ? 'auf' : 'ab')
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/* ── Kursband ──────────────────────────────────────────────────────── */
const lage52 = computed(() => lageInSpanne(d.value?.kurs?.preis, d.value?.kennzahlen?.jahrTief, d.value?.kennzahlen?.jahrHoch))
const lageTag = computed(() => lageInSpanne(d.value?.kurs?.preis, d.value?.kennzahlen?.tagTief, d.value?.kennzahlen?.tagHoch))
const linie = computed(() => {
    const alle = seite.value?.linie || []
    if (!alle.length) return []
    const ab = alle[alle.length - 1][0] - SPANNEN.find((s) => s.id === spanne.value).tage * 86_400_000
    return alle.filter((p) => p[0] >= ab)
})
const linieAenderung = computed(() => {
    const l = linie.value
    return l.length > 1 && l[0][1] > 0 ? (l[l.length - 1][1] / l[0][1] - 1) * 100 : null
})
const achse = { axisLine: { lineStyle: { color: '#24323a' } }, axisTick: { show: false }, axisLabel: { color: '#8ea5af', fontSize: 11 } }
const tipp = { backgroundColor: '#131c22', borderColor: '#24323a', textStyle: { color: '#dfe9ec', fontSize: 12 } }
const verlauf = computed(() => {
    const l = linie.value
    if (l.length < 2) return null
    return {
        animation: false,
        grid: { left: 52, right: 12, top: 10, bottom: 24 },
        tooltip: { trigger: 'axis', ...tipp, formatter: (p) => `${datum(p[0].value[0])}<br><b>${geld(p[0].value[1])}</b>` },
        xAxis: { type: 'time', ...achse, splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...achse, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1a252c', type: 'dashed' } } },
        // Türkise Hauslinie in Stufen statt einer rot/grünen Fläche: der Verlauf ist Kontext, das Vorzeichen steht daneben.
        series: [{ type: 'line', step: 'end', data: l, showSymbol: false, lineStyle: { color: '#1fd6c4', width: 1.4 } }],
    }
})

/* ── Kennzahlen-Streifen ───────────────────────────────────────────── */
const volumenFach = computed(() => {
    const k = d.value?.kennzahlen
    return k?.volumen != null && k.volumenSchnitt > 0 ? k.volumen / k.volumenSchnitt : null
})
const streifen = computed(() => {
    const k = d.value?.kennzahlen
    if (!k) return []
    return [
        { id: 'boersenwert', wert: gross(k.marktkap) },
        { id: 'kgv', wert: zahl(k.kgv, 1), neben: k.kgvVoraus == null ? '' : t('titel.erwartet', { wert: zahl(k.kgvVoraus, 1) }) },
        { id: 'eps', wert: zahl(k.eps) },
        { id: 'umsatzWachstum', wert: prozent(k.umsatzWachstumPct, 1), ton: richtung(k.umsatzWachstumPct) },
        { id: 'marge', wert: anteil(k.margePct) },
        { id: 'dividende', wert: anteil(k.dividendePct, 2) },
        { id: 'volumen', wert: gross(k.volumen), neben: volumenFach.value == null ? '' : t('titel.volumenFach', { n: zahl(volumenFach.value, 1) }) },
    ]
})

/* ── Analysten ─────────────────────────────────────────────────────── */
const an = computed(() => d.value?.analysten || null)
const verteilung = computed(() => {
    const v = an.value?.verteilung
    if (!v) return null
    const summe = STUFEN.reduce((s, k) => s + (v[k] || 0), 0)
    const teil = (n) => ({ n, pct: summe ? (n / summe) * 100 : 0 })
    return { kauf: teil(v.starkKauf + v.kauf), halten: teil(v.halten), verkauf: teil(v.verkauf + v.starkVerkauf) }
})
const ziele = computed(() => zielBalken(an.value, d.value?.kurs?.preis))
const bilanz = computed(() => einstufungsBilanz(an.value?.liste || []))
const einstufungen = computed(() => (alleEinstufungen.value ? an.value?.liste : an.value?.liste?.slice(0, 7)) || [])
const AKTION = { up: 'herauf', down: 'herab', init: 'neu' }
const aktionText = (e) => t('titel.aktion_' + (AKTION[e.aktion] || 'bestaetigt'))
const aktionTon = (e) => (e.aktion === 'up' ? 'auf' : e.aktion === 'down' ? 'ab' : '')

/* ── Quartalszahlen ────────────────────────────────────────────────── */
const terminTage = computed(() => tageBis(d.value?.termin?.zeit))
const terminText = computed(() => {
    const n = terminTage.value
    if (n == null || n < 0) return ''
    return n === 0 ? t('titel.heute') : n === 1 ? t('titel.morgen') : t('titel.inTagen', { n })
})
const saeulen = computed(() => {
    const q = d.value?.ertraege || []
    if (!q.length) return null
    return {
        animation: false,
        grid: { left: 36, right: 8, top: 14, bottom: 22 },
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' }, ...tipp,
            formatter: (p) => {
                const z = q[p[0].dataIndex]
                return `${z.quartal}<br>${t('titel.gemeldet')}: <b>${zahl(z.eps)}</b><br>${t('titel.schaetzung')}: ${zahl(z.schaetzung)}`
                    + (z.ueberraschungPct == null ? '' : `<br>${t('titel.ueberraschung')}: ${prozent(z.ueberraschungPct, 1)}`)
            },
        },
        xAxis: { type: 'category', data: q.map((z) => z.quartal), ...achse },
        yAxis: { type: 'value', ...achse, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1a252c', type: 'dashed' } } },
        series: [
            { type: 'bar', barGap: '10%', barMaxWidth: 16, data: q.map((z) => z.schaetzung), itemStyle: { color: GRAU, borderRadius: [2, 2, 0, 0] } },
            {
                type: 'bar', barMaxWidth: 16,
                data: q.map((z) => ({ value: z.eps, itemStyle: { color: z.eps != null && z.schaetzung != null && z.eps < z.schaetzung ? SCHLECHT : GUT, borderRadius: [2, 2, 0, 0] } })),
            },
        ],
    }
})

/* ── Handelbar ─────────────────────────────────────────────────────── */
const listungen = computed(() => [...(seite.value?.titel?.listungen || [])].sort((a, b) => RANG[a.art] - RANG[b.art] || a.handelsplatz.localeCompare(b.handelsplatz)))
const chartZiel = computed(() => {
    void marktdaten.value
    const ziel = symbolBei({ symbole: seite.value?.chart || {} }, vorzug(vorgabeBoerse(), waehlbareBoersen()))
    return ziel ? { path: '/chart', query: { symbol: ziel.symbol, boerse: ziel.boerse } } : null
})
const grundText = computed(() => {
    const g = seite.value?.grund
    return g ? t('titel.grund_' + g) : seite.value?.datenFehler ? t('titel.datenFehler', { fehler: seite.value.datenFehler }) : ''
})
</script>

<template>
    <div class="titel-seite">
        <!-- Kopf: wer, und wo handelbar -->
        <header class="kopf">
            <Knopf klein art="leise" symbol="pfeilLinks" :to="{ path: '/aktien' }">{{ t('titel.zurueck') }}</Knopf>
            <div class="wer">
                <span class="kuerzel">{{ ticker }}</span>
                <div>
                    <h2>{{ d?.profil?.name || seite?.titel?.name || ticker }}</h2>
                    <span class="klein">
                        <template v-if="d?.profil?.boerse">{{ d.profil.boerse }}</template><template
                            v-if="d?.profil?.sektor"> · {{ d.profil.sektor }}</template><template
                            v-if="seite?.kursSymbol && seite.kursSymbol !== ticker"> · {{ seite.kursSymbol }}</template>
                    </span>
                </div>
            </div>
            <div v-if="listungen.length" class="plaetze">
                <span class="klein">{{ t('aktien.handelbarBei') }}</span>
                <Pille v-for="l in listungen" :key="l.handelsplatz + l.art + l.symbol" :ton="TON[l.art]" :title="l.symbol">
                    {{ PLATZ[l.handelsplatz] || l.handelsplatz }} · {{ t('aktien.art_' + l.art) }}<template
                        v-if="l.maxHebel"> · {{ t('aktien.hebel', { n: l.maxHebel }) }}</template>
                </Pille>
            </div>
            <div class="knoepfe">
                <Knopf v-if="chartZiel" klein art="haupt" symbol="chart" :to="chartZiel">{{ t('titel.zumChart') }}</Knopf>
                <Knopf klein nur-symbol symbol="aktualisieren" :titel="t('titel.aktualisieren')" :laedt="laedt" @click="lade(true)" />
            </div>
        </header>

        <QuelleAus v-if="aus" :aus="aus" />
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <Kreisel v-if="laedt && !seite" />
        <Hinweis v-if="seite && grundText" art="warn">{{ grundText }}</Hinweis>

        <template v-if="seite && seite.ok">
            <!-- Kursband -->
            <section v-if="d || seite.linie?.length" class="band">
                <div v-if="d" class="stand">
                    <p class="preis">{{ zahl(d.kurs.preis) }}<span class="einheit">{{ waehrung }}</span></p>
                    <p :class="['delta', richtung(d.kurs.aenderungPct)]">{{ prozent(d.kurs.aenderungPct) }} <span class="klein">({{ zahl(d.kurs.aenderung) }})</span></p>
                    <p class="klein">{{ t('titel.schluss', { zeit: zeit(d.kurs.zeit) }) }}</p>
                    <p v-if="d.kurs.nachPreis != null && d.kurs.zustand !== 'REGULAR'" class="nach">
                        <span class="klein">{{ t('titel.nachboerslichKurz') }}</span>
                        {{ zahl(d.kurs.nachPreis) }} <span :class="richtung(d.kurs.nachPct)">{{ prozent(d.kurs.nachPct) }}</span>
                    </p>

                    <div v-if="lage52 != null" class="lage">
                        <div class="lageKopf"><span>{{ t('titel.jahresspanne') }}</span><b>{{ t('titel.lageProzent', { n: zahl(lage52, 0) }) }}</b></div>
                        <div class="skala"><i :style="{ width: lage52 + '%' }"></i></div>
                        <div class="lageFuss"><span>{{ zahl(d.kennzahlen.jahrTief) }}</span><span>{{ zahl(d.kennzahlen.jahrHoch) }}</span></div>
                    </div>
                    <div v-if="lageTag != null" class="lage">
                        <div class="lageKopf"><span>{{ t('titel.tagesspanne') }}</span></div>
                        <div class="skala"><i :style="{ width: lageTag + '%' }"></i></div>
                        <div class="lageFuss"><span>{{ zahl(d.kennzahlen.tagTief) }}</span><span>{{ zahl(d.kennzahlen.tagHoch) }}</span></div>
                    </div>
                </div>
                <div v-if="seite.linie?.length" class="verlauf">
                    <div class="spannen" role="group" :aria-label="t('titel.zeitraum')">
                        <span v-if="linieAenderung != null" :class="['delta', richtung(linieAenderung)]">{{ prozent(linieAenderung, 1) }}</span>
                        <button v-for="s in SPANNEN" :key="s.id" type="button" :class="{ aktiv: spanne === s.id }"
                            :aria-pressed="spanne === s.id" @click="spanne = s.id">{{ t('titel.spanne_' + s.id) }}</button>
                    </div>
                    <Diagramm v-if="verlauf" :option="verlauf" :hoehe="250" />
                </div>
            </section>

            <!-- Kennzahlen-Streifen -->
            <section v-if="streifen.length" class="streifen">
                <div v-for="k in streifen" :key="k.id" class="zelle">
                    <span class="name">{{ t('titel.' + k.id) }}</span>
                    <span :class="['wert', k.ton]">{{ k.wert }}</span>
                    <span v-if="k.neben" class="klein">{{ k.neben }}</span>
                </div>
            </section>

            <!-- Analysten · Quartalszahlen · Firma -->
            <div class="reihe drei">
                <Karte v-if="an" :titel="t('titel.konsens')" :unter="an.anzahl ? t('titel.analystenAnzahl', { n: an.anzahl }) : ''">
                    <template v-if="an.konsens" #aktionen><Pille :ton="KONSENS_TON[an.konsens]">{{ t('titel.konsens_' + an.konsens) }}</Pille></template>
                    <ul v-if="verteilung" class="stimmen">
                        <li v-for="s in STIMMEN" :key="s.id">
                            <span class="name">{{ t('titel.' + s.name) }}</span>
                            <span class="spur"><i :class="s.id" :style="{ width: verteilung[s.id].pct + '%' }"></i></span>
                            <b>{{ verteilung[s.id].n }}</b>
                        </li>
                    </ul>
                    <template v-if="ziele.length">
                        <h4>{{ t('titel.zielAbstand') }}</h4>
                        <ul class="stimmen">
                            <li v-for="z in ziele" :key="z.id">
                                <span class="name">{{ t('titel.' + z.id) }}</span>
                                <span class="spur"><i :class="z.pct >= 0 ? 'kauf' : 'verkauf'" :style="{ width: z.breite + '%' }"></i></span>
                                <b :class="richtung(z.pct)" :title="geld(z.wert)">{{ prozent(z.pct, 0) }}</b>
                            </li>
                        </ul>
                        <p class="klein fuss">{{ t('titel.zielWerte', { tief: zahl(an.zielTief, 0), mittel: zahl(an.zielMittel, 0), hoch: zahl(an.zielHoch, 0), waehrung }) }}</p>
                    </template>
                    <p class="klein fuss">{{ t('titel.analystenHinweis') }}</p>
                </Karte>

                <Karte v-if="d?.ertraege?.length || d?.termin" :titel="t('titel.ertraege')" :unter="t('titel.ertraegeUnter')">
                    <template v-if="d.termin" #aktionen>
                        <span class="termin" :title="t(d.termin.geschaetzt ? 'titel.terminGeschaetzt' : 'titel.termin', { datum: datum(d.termin.zeit) })">
                            <b>{{ tagMonat(d.termin.zeit) }}</b><span v-if="terminText" class="klein">{{ terminText }}</span>
                        </span>
                    </template>
                    <Diagramm v-if="saeulen" :option="saeulen" :hoehe="170" />
                    <p class="legende">
                        <span><i class="grau"></i>{{ t('titel.schaetzung') }}</span>
                        <span><i class="gut"></i>{{ t('titel.gemeldetDrueber') }}</span>
                        <span><i class="schlecht"></i>{{ t('titel.gemeldetDrunter') }}</span>
                    </p>
                    <p v-if="d.termin?.epsSchaetzung != null" class="klein fuss">{{ t('titel.terminSchaetzung', { eps: zahl(d.termin.epsSchaetzung) }) }}</p>
                </Karte>

                <Karte :titel="t('titel.firmaTitel')">
                    <p v-if="d?.profil?.beschreibung" class="beschreibung">{{ d.profil.beschreibung }}</p>
                    <dl class="profil">
                        <div v-if="d?.profil?.branche"><dt>{{ t('titel.branche') }}</dt><dd>{{ d.profil.branche }}</dd></div>
                        <div v-if="d?.profil?.land"><dt>{{ t('titel.land') }}</dt><dd>{{ d.profil.land }}</dd></div>
                        <div v-if="d?.profil?.mitarbeiter != null"><dt>{{ t('titel.mitarbeiter') }}</dt><dd>{{ zahl(d.profil.mitarbeiter, 0) }}</dd></div>
                        <div v-if="d?.profil?.chef"><dt>{{ t('titel.chef') }}</dt><dd>{{ d.profil.chef }}</dd></div>
                        <div v-if="seite.ipoDatum != null"><dt>{{ t('titel.ersterHandel') }}</dt><dd>{{ datum(seite.ipoDatum) }}</dd></div>
                        <div v-if="d?.kennzahlen?.beta != null"><dt>{{ t('titel.beta') }}</dt><dd>{{ zahl(d.kennzahlen.beta) }}</dd></div>
                        <div v-if="d?.profil?.webseite"><dt>{{ t('titel.webseite') }}</dt><dd><a :href="d.profil.webseite" target="_blank" rel="noopener noreferrer">{{ host(d.profil.webseite) }}</a></dd></div>
                    </dl>
                </Karte>
            </div>

            <!-- Einstufungen · Recherche -->
            <div class="reihe zwei">
                <Karte v-if="an?.liste?.length" :titel="t('titel.einstufungen')"
                    :unter="t('titel.bilanz', { n: bilanz.anzahl, herab: bilanz.herab, herauf: bilanz.herauf, gesenkt: bilanz.zielGesenkt, erhoeht: bilanz.zielErhoeht })">
                    <ol class="zeitleiste">
                        <li v-for="e in einstufungen" :key="e.firma + e.zeit" :class="aktionTon(e)">
                            <span class="tag">{{ tagMonat(e.zeit) }}</span>
                            <div class="was">
                                <b>{{ e.firma }}</b>
                                <span :class="aktionTon(e)">{{ aktionText(e) }}</span>
                                <span>{{ e.stufe || '—' }}<template v-if="e.vorher && e.vorher !== e.stufe"> <span class="klein">{{ t('titel.vorher', { stufe: e.vorher }) }}</span></template></span>
                            </div>
                            <span v-if="e.ziel != null" class="ziel">
                                {{ zahl(e.ziel, 0) }}
                                <span v-if="e.zielVorher && e.zielVorher !== e.ziel" class="klein">{{ t('titel.von', { ziel: zahl(e.zielVorher, 0) }) }}</span>
                                <span :class="['klein', richtung(abstandPct(e.ziel, d.kurs.preis))]">{{ prozent(abstandPct(e.ziel, d.kurs.preis), 0) }}</span>
                            </span>
                        </li>
                    </ol>
                    <button v-if="an.liste.length > 7" type="button" class="mehr" @click="alleEinstufungen = !alleEinstufungen">
                        {{ alleEinstufungen ? t('titel.weniger') : t('titel.mehr', { n: an.liste.length - 7 }) }}
                    </button>
                </Karte>

                <Karte :titel="t('titel.bewegung')" :unter="bewegung ? t('titel.bewegungStand', { zeit: zeit(bewegung.zeit) }) : t('titel.bewegungUnter')">
                    <template #aktionen>
                        <Knopf klein symbol="suche" :laedt="bewegungLaedt" @click="holeBewegung">{{ t(bewegung ? 'titel.bewegungNeu' : 'titel.bewegungHolen') }}</Knopf>
                    </template>
                    <Hinweis v-if="bewegungHinweis" art="warn">{{ bewegungHinweis }}</Hinweis>
                    <div v-if="bewegung" data-ki-generiert="true">
                        <p class="bewegungText">{{ bewegung.text }}</p>
                        <ol v-if="bewegung.quellen?.length" class="quellen">
                            <li v-for="q in bewegung.quellen" :key="q"><a :href="q" target="_blank" rel="noopener noreferrer">{{ host(q) }}</a></li>
                        </ol>
                    </div>
                </Karte>
            </div>

            <p v-if="seite.daten || seite.linie?.length" class="klein quelle">
                {{ t('titel.quelle') }}<template v-if="seite.stand"> · {{ t('titel.stand', { zeit: zeit(seite.stand) }) }}</template>
            </p>
        </template>
    </div>
</template>

<style scoped>
.titel-seite {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

p {
    margin: 0;
}

.klein {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
}

.auf {
    color: var(--good);
}

.ab {
    color: var(--bad);
}

a {
    color: var(--accent);
    text-decoration: none;
}

a:hover {
    text-decoration: underline;
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

.kuerzel {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--accent-rand);
    border-radius: var(--radius-knopf);
    background: var(--accent-flaeche);
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.04em;
}

.wer h2 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
}

.plaetze {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 18rem;
}

.knoepfe {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
}

/* ── Kursband ── */
.band {
    display: grid;
    grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
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
}

.preis {
    font-size: 2.1rem;
    font-weight: 600;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
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

.nach {
    margin-top: 0.3rem;
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
}

.lage {
    margin-top: 0.9rem;
}

.lageKopf,
.lageFuss {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.lageKopf b {
    color: var(--text);
    font-weight: 500;
}

.skala {
    height: 6px;
    margin: 0.3rem 0;
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
    padding: 0.8rem 0.9rem 0.4rem;
    min-width: 0;
}

.spannen {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.3rem;
}

.spannen .delta {
    margin-right: auto;
    font-size: 0.88rem;
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

/* ── Kennzahlen-Streifen ── */
.streifen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
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

/* ── Reihen ── */
.reihe {
    display: grid;
    gap: 0.9rem;
    align-items: start;
}

.reihe.drei {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.reihe.zwei {
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
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
}

h4 {
    margin: 1rem 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--muted);
}

.fuss {
    margin-top: 0.7rem;
}

/* Waagrechte Balken: Stimmen der Analysten und Abstand der Kursziele */
.stimmen {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
}

.stimmen li {
    display: grid;
    grid-template-columns: 6.2rem minmax(0, 1fr) 3.6rem;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.86rem;
}

.stimmen .name {
    color: var(--muted);
}

.stimmen b {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.spur {
    height: 10px;
    border-radius: 2px;
    background: var(--panel-soft);
    overflow: hidden;
}

.spur i {
    display: block;
    height: 100%;
    min-width: 2px;
}

.spur .kauf {
    background: var(--good);
}

.spur .halten {
    background: var(--muted);
}

.spur .verkauf {
    background: var(--bad);
}

/* Quartalszahlen */
.termin {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.2;
}

.termin b {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
}

.legende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.9rem;
    font-size: 0.78rem;
    color: var(--muted);
}

.legende span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
}

.legende i {
    width: 9px;
    height: 9px;
    border-radius: 2px;
}

.legende .grau {
    background: #4a5d66;
}

.legende .gut {
    background: var(--good);
}

.legende .schlecht {
    background: var(--bad);
}

/* Firma */
.beschreibung {
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--muted);
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.profil {
    margin: 0.7rem 0 0;
}

.profil div {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.38rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.86rem;
}

dt {
    color: var(--muted);
}

dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
}

/* Zeitleiste der Einstufungen */
.zeitleiste {
    list-style: none;
    margin: 0;
    padding: 0;
}

.zeitleiste li {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr) auto;
    gap: 0.7rem;
    align-items: baseline;
    padding: 0.5rem 0 0.5rem 0.8rem;
    border-left: 2px solid var(--line);
    color: var(--text);
    font-size: 0.86rem;
}

.zeitleiste li.auf {
    border-left-color: var(--good);
}

.zeitleiste li.ab {
    border-left-color: var(--bad);
}

.zeitleiste .tag {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.zeitleiste .was {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.6rem;
    min-width: 0;
}

.zeitleiste .was .klein,
.zeitleiste .ziel .klein {
    margin-left: 0.4rem;
}

/* Knöpfe und Marken im Kartenkopf nicht umbrechen */
:deep(.at-karte .aktionen) {
    flex: 0 0 auto;
    white-space: nowrap;
}

.zeitleiste .ziel {
    text-align: right;
    white-space: nowrap;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.mehr {
    margin-top: 0.6rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

/* Recherche */
.bewegungText {
    line-height: 1.55;
    white-space: pre-line;
}

.quellen {
    margin: 0.7rem 0 0;
    padding-left: 1.3rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 1.6rem;
    font-size: 0.82rem;
    color: var(--muted);
}
</style>
