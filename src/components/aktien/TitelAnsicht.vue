<script setup>
/**
 * Titel-Seite einer Aktie (Aktien-Integration): Kurs mit Verlauf, Kennzahlen,
 * was den Kurs zuletzt bewegt hat, Analysten, Ertragsverlauf, Firmenprofil
 * und wo der Titel handelbar ist.
 *
 * Zahlen kommen von Yahoo Finance (`/api/aktien/titel/:ticker`, hinter dem
 * Quellen-Schalter). Der Text «Was den Kurs bewegt hat» ist eine Websuche
 * über Perplexity — sie kostet und läuft deshalb nur auf Knopfdruck; die
 * Seite liest sonst nur, was schon gemerkt ist. Unbekanntes steht als «—».
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

const props = defineProps({ ticker: { type: String, required: true } })
const { t, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const SPANNEN = [{ id: 'm1', tage: 31 }, { id: 'm6', tage: 183 }, { id: 'j1', tage: 366 }, { id: 'j2', tage: 800 }]
const KONSENS_TON = { starkKauf: 'gut', kauf: 'gut', halten: 'neutral', verkauf: 'schlecht', starkVerkauf: 'schlecht' }
const STUFEN = ['starkKauf', 'kauf', 'halten', 'verkauf', 'starkVerkauf']

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
const gross = (v) => (v == null ? '—' : new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 2 }).format(v))
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const zeit = (ms) => (ms ? new Date(ms).toLocaleString(locale.value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const spanneText = (a, b) => (a == null || b == null ? '—' : `${zahl(a)} – ${zahl(b)}`)
const richtung = (v) => (v == null || v === 0 ? '' : v > 0 ? 'auf' : 'ab')
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/* ── Kurslinie ─────────────────────────────────────────────────────── */
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
const diagramm = computed(() => {
    const l = linie.value
    if (l.length < 2) return null
    const farbe = (linieAenderung.value ?? 0) >= 0 ? '#3fbf8f' : '#e0574c'
    return {
        animation: false,
        grid: { left: 8, right: 56, top: 12, bottom: 24 },
        tooltip: {
            trigger: 'axis', backgroundColor: '#131c22', borderColor: '#24323a', textStyle: { color: '#dfe9ec', fontSize: 12 },
            formatter: (p) => `${datum(p[0].value[0])}<br><b>${geld(p[0].value[1])}</b>`,
        },
        xAxis: { type: 'time', axisLine: { lineStyle: { color: '#24323a' } }, axisLabel: { color: '#8ea5af', fontSize: 11 }, splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, position: 'right', axisLabel: { color: '#8ea5af', fontSize: 11 }, splitLine: { lineStyle: { color: '#1a252c' } } },
        series: [{ type: 'line', data: l, showSymbol: false, lineStyle: { color: farbe, width: 1.6 }, areaStyle: { color: farbe, opacity: 0.08 } }],
    }
})

/* ── Analysten ─────────────────────────────────────────────────────── */
const an = computed(() => d.value?.analysten || null)
const verteilung = computed(() => {
    const v = an.value?.verteilung
    if (!v) return null
    const summe = STUFEN.reduce((s, k) => s + (v[k] || 0), 0)
    const teil = (n) => ({ n, pct: summe ? (n / summe) * 100 : 0 })
    return { summe, kauf: teil(v.starkKauf + v.kauf), halten: teil(v.halten), verkauf: teil(v.verkauf + v.starkVerkauf) }
})
/** Lage von Kurs und mittlerem Ziel auf der Strecke tiefstes … höchstes Kursziel (0–100 %). */
const zielLage = computed(() => {
    const a = an.value, preis = d.value?.kurs?.preis
    if (!a || a.zielTief == null || a.zielHoch == null || preis == null) return null
    const von = Math.min(a.zielTief, preis), bis = Math.max(a.zielHoch, preis)
    if (!(bis > von)) return null
    const lage = (v) => (v == null ? null : ((v - von) / (bis - von)) * 100)
    return { preis: lage(preis), tief: lage(a.zielTief), mittel: lage(a.zielMittel), hoch: lage(a.zielHoch) }
})
const potenzial = (ziel) => {
    const preis = d.value?.kurs?.preis
    return ziel && preis ? (ziel / preis - 1) * 100 : null
}
const einstufungen = computed(() => (alleEinstufungen.value ? an.value?.liste : an.value?.liste?.slice(0, 6)) || [])
const stufenTon = (e) => (e.aktion === 'up' ? 'gut' : e.aktion === 'down' ? 'schlecht' : 'neutral')

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
        <div class="kopfzeile">
            <Knopf klein art="leise" symbol="pfeilLinks" :to="{ path: '/aktien' }">{{ t('titel.zurueck') }}</Knopf>
            <div class="wer">
                <h2>{{ d?.profil?.name || seite?.titel?.name || ticker }}</h2>
                <span class="unter">{{ ticker }}<template v-if="d?.profil?.boerse"> · {{ d.profil.boerse }}</template><template
                        v-if="seite?.kursSymbol && seite.kursSymbol !== ticker"> · {{ seite.kursSymbol }}</template></span>
            </div>
            <div class="rechts">
                <Knopf v-if="chartZiel" klein symbol="chart" :to="chartZiel">{{ t('titel.zumChart') }}</Knopf>
                <Knopf klein symbol="aktualisieren" :laedt="laedt" @click="lade(true)">{{ t('titel.aktualisieren') }}</Knopf>
            </div>
        </div>

        <QuelleAus v-if="aus" :aus="aus" />
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <Kreisel v-if="laedt && !seite" />
        <Hinweis v-if="seite && grundText" art="warn">{{ grundText }}</Hinweis>

        <div v-if="seite && seite.ok" class="raster">
            <div class="haupt">
                <!-- Kurs und Verlauf -->
                <Karte v-if="d || linie.length">
                    <div v-if="d" class="kurs">
                        <div>
                            <span class="preis">{{ geld(d.kurs.preis) }}</span>
                            <span :class="['delta', richtung(d.kurs.aenderungPct)]">{{ zahl(d.kurs.aenderung) }} · {{ prozent(d.kurs.aenderungPct) }}</span>
                            <p class="klein">{{ t('titel.schluss', { zeit: zeit(d.kurs.zeit) }) }}</p>
                        </div>
                        <div v-if="d.kurs.nachPreis != null && d.kurs.zustand !== 'REGULAR'">
                            <span class="preis zweit">{{ geld(d.kurs.nachPreis) }}</span>
                            <span :class="['delta', richtung(d.kurs.nachPct)]">{{ prozent(d.kurs.nachPct) }}</span>
                            <p class="klein">{{ t('titel.nachboerslich', { zeit: zeit(d.kurs.nachZeit) }) }}</p>
                        </div>
                    </div>
                    <div v-if="seite.linie?.length" class="spannen" role="group" :aria-label="t('titel.zeitraum')">
                        <button v-for="s in SPANNEN" :key="s.id" type="button" :class="{ aktiv: spanne === s.id }"
                            :aria-pressed="spanne === s.id" @click="spanne = s.id">{{ t('titel.spanne_' + s.id) }}</button>
                        <span v-if="linieAenderung != null" :class="['delta', richtung(linieAenderung)]">{{ prozent(linieAenderung, 1) }}</span>
                    </div>
                    <Diagramm v-if="diagramm" :option="diagramm" :hoehe="260" />
                    <dl v-if="d" class="kennzahlen">
                        <div><dt>{{ t('titel.marktkap') }}</dt><dd>{{ gross(d.kennzahlen.marktkap) }}</dd></div>
                        <div><dt>{{ t('titel.kgv') }}</dt><dd>{{ zahl(d.kennzahlen.kgv) }}</dd></div>
                        <div><dt>{{ t('titel.kgvVoraus') }}</dt><dd>{{ zahl(d.kennzahlen.kgvVoraus) }}</dd></div>
                        <div><dt>{{ t('titel.eps') }}</dt><dd>{{ zahl(d.kennzahlen.eps) }}</dd></div>
                        <div><dt>{{ t('titel.tagesspanne') }}</dt><dd>{{ spanneText(d.kennzahlen.tagTief, d.kennzahlen.tagHoch) }}</dd></div>
                        <div><dt>{{ t('titel.jahresspanne') }}</dt><dd>{{ spanneText(d.kennzahlen.jahrTief, d.kennzahlen.jahrHoch) }}</dd></div>
                        <div><dt>{{ t('titel.volumen') }}</dt><dd>{{ gross(d.kennzahlen.volumen) }}</dd></div>
                        <div><dt>{{ t('titel.volumenSchnitt') }}</dt><dd>{{ gross(d.kennzahlen.volumenSchnitt) }}</dd></div>
                        <div><dt>{{ t('titel.dividende') }}</dt><dd>{{ d.kennzahlen.dividendePct == null ? '—' : zahl(d.kennzahlen.dividendePct) + ' %' }}</dd></div>
                        <div><dt>{{ t('titel.umsatzWachstum') }}</dt><dd :class="richtung(d.kennzahlen.umsatzWachstumPct)">{{ prozent(d.kennzahlen.umsatzWachstumPct, 1) }}</dd></div>
                        <div><dt>{{ t('titel.marge') }}</dt><dd>{{ d.kennzahlen.margePct == null ? '—' : zahl(d.kennzahlen.margePct, 1) + ' %' }}</dd></div>
                        <div><dt>{{ t('titel.beta') }}</dt><dd>{{ zahl(d.kennzahlen.beta) }}</dd></div>
                    </dl>
                </Karte>

                <!-- Was den Kurs bewegt hat -->
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

                <!-- Einstufungen der Analysten -->
                <Karte v-if="an?.liste?.length" :titel="t('titel.einstufungen')">
                    <div class="tabellenrahmen">
                        <table class="tabelle">
                            <thead>
                                <tr>
                                    <th>{{ t('titel.datum') }}</th>
                                    <th>{{ t('titel.firma') }}</th>
                                    <th>{{ t('titel.stufe') }}</th>
                                    <th class="rechts">{{ t('titel.kursziel') }}</th>
                                    <th class="rechts">{{ t('titel.potenzial') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="e in einstufungen" :key="e.firma + e.zeit">
                                    <td>{{ datum(e.zeit) }}</td>
                                    <td>{{ e.firma }}</td>
                                    <td>
                                        <Pille :ton="stufenTon(e)">{{ e.stufe || '—' }}</Pille>
                                        <span v-if="e.vorher && e.vorher !== e.stufe" class="klein"> {{ t('titel.vorher', { stufe: e.vorher }) }}</span>
                                    </td>
                                    <td class="rechts">
                                        {{ e.ziel == null ? '—' : zahl(e.ziel, 0) }}
                                        <span v-if="e.zielVorher && e.zielVorher !== e.ziel" class="klein">{{ t('titel.von', { ziel: zahl(e.zielVorher, 0) }) }}</span>
                                    </td>
                                    <td :class="['rechts', richtung(potenzial(e.ziel))]">{{ prozent(potenzial(e.ziel), 1) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button v-if="an.liste.length > 6" type="button" class="mehr" @click="alleEinstufungen = !alleEinstufungen">
                        {{ alleEinstufungen ? t('titel.weniger') : t('titel.mehr', { n: an.liste.length - 6 }) }}
                    </button>
                </Karte>
            </div>

            <div class="seitenspalte">
                <!-- Analysten-Konsens -->
                <Karte v-if="an" :titel="t('titel.konsens')" :unter="an.anzahl ? t('titel.analystenAnzahl', { n: an.anzahl }) : ''">
                    <p v-if="an.konsens" class="konsens"><Pille :ton="KONSENS_TON[an.konsens]" gross>{{ t('titel.konsens_' + an.konsens) }}</Pille></p>
                    <template v-if="verteilung">
                        <div class="balken" role="img" :aria-label="t('titel.verteilung', { kauf: verteilung.kauf.n, halten: verteilung.halten.n, verkauf: verteilung.verkauf.n })">
                            <span class="kauf" :style="{ width: verteilung.kauf.pct + '%' }"></span>
                            <span class="halten" :style="{ width: verteilung.halten.pct + '%' }"></span>
                            <span class="verkauf" :style="{ width: verteilung.verkauf.pct + '%' }"></span>
                        </div>
                        <div class="legende">
                            <span><b class="auf">{{ verteilung.kauf.n }}</b> {{ t('titel.kaufen') }}</span>
                            <span><b>{{ verteilung.halten.n }}</b> {{ t('titel.halten') }}</span>
                            <span><b class="ab">{{ verteilung.verkauf.n }}</b> {{ t('titel.verkaufen') }}</span>
                        </div>
                    </template>
                    <template v-if="zielLage">
                        <h4>{{ t('titel.kursziele') }}</h4>
                        <div class="strecke">
                            <span class="band" :style="{ left: zielLage.tief + '%', width: (zielLage.hoch - zielLage.tief) + '%' }"></span>
                            <span v-if="zielLage.mittel != null" class="marke mittel" :style="{ left: zielLage.mittel + '%' }" :title="t('titel.zielMittel')"></span>
                            <span class="marke preis" :style="{ left: zielLage.preis + '%' }" :title="t('titel.aktuell')"></span>
                        </div>
                        <dl class="ziele">
                            <div><dt>{{ t('titel.aktuell') }}</dt><dd>{{ zahl(d.kurs.preis) }}</dd></div>
                            <div><dt>{{ t('titel.zielTief') }}</dt><dd>{{ zahl(an.zielTief, 0) }}</dd></div>
                            <div><dt>{{ t('titel.zielMittel') }}</dt><dd>{{ zahl(an.zielMittel, 0) }} <span :class="['klein', richtung(potenzial(an.zielMittel))]">{{ prozent(potenzial(an.zielMittel), 0) }}</span></dd></div>
                            <div><dt>{{ t('titel.zielHoch') }}</dt><dd>{{ zahl(an.zielHoch, 0) }}</dd></div>
                        </dl>
                    </template>
                    <p class="klein fuss">{{ t('titel.analystenHinweis') }}</p>
                </Karte>

                <!-- Ertragsverlauf -->
                <Karte v-if="d?.ertraege?.length || d?.termin" :titel="t('titel.ertraege')"
                    :unter="d.termin ? t(d.termin.geschaetzt ? 'titel.terminGeschaetzt' : 'titel.termin', { datum: datum(d.termin.zeit) }) : ''">
                    <table v-if="d.ertraege.length" class="tabelle">
                        <thead>
                            <tr>
                                <th>{{ t('titel.quartal') }}</th>
                                <th class="rechts">{{ t('titel.eps') }}</th>
                                <th class="rechts">{{ t('titel.schaetzung') }}</th>
                                <th class="rechts">{{ t('titel.ueberraschung') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="q in d.ertraege" :key="q.quartal">
                                <td>{{ q.quartal }}</td>
                                <td class="rechts">{{ zahl(q.eps) }}</td>
                                <td class="rechts">{{ zahl(q.schaetzung) }}</td>
                                <td :class="['rechts', richtung(q.ueberraschungPct)]">{{ prozent(q.ueberraschungPct, 1) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <p v-if="d.termin?.epsSchaetzung != null" class="klein fuss">{{ t('titel.terminSchaetzung', { eps: zahl(d.termin.epsSchaetzung) }) }}</p>
                </Karte>

                <!-- Firma -->
                <Karte :titel="t('titel.firmaTitel')">
                    <dl class="profil">
                        <div><dt>{{ t('titel.symbol') }}</dt><dd>{{ ticker }}</dd></div>
                        <div v-if="seite.ipoDatum != null"><dt>{{ t('titel.ersterHandel') }}</dt><dd>{{ datum(seite.ipoDatum) }}</dd></div>
                        <template v-if="d">
                            <div v-if="d.profil.chef"><dt>{{ t('titel.chef') }}</dt><dd>{{ d.profil.chef }}</dd></div>
                            <div v-if="d.profil.mitarbeiter != null"><dt>{{ t('titel.mitarbeiter') }}</dt><dd>{{ zahl(d.profil.mitarbeiter, 0) }}</dd></div>
                            <div v-if="d.profil.sektor"><dt>{{ t('titel.sektor') }}</dt><dd>{{ d.profil.sektor }}</dd></div>
                            <div v-if="d.profil.branche"><dt>{{ t('titel.branche') }}</dt><dd>{{ d.profil.branche }}</dd></div>
                            <div v-if="d.profil.land"><dt>{{ t('titel.land') }}</dt><dd>{{ d.profil.land }}</dd></div>
                            <div v-if="d.profil.webseite"><dt>{{ t('titel.webseite') }}</dt><dd><a :href="d.profil.webseite" target="_blank" rel="noopener noreferrer">{{ host(d.profil.webseite) }}</a></dd></div>
                        </template>
                    </dl>
                    <p v-if="d?.profil?.beschreibung" class="beschreibung">{{ d.profil.beschreibung }}</p>
                    <h4>{{ t('aktien.handelbarBei') }}</h4>
                    <div class="plaetze">
                        <Pille v-for="l in listungen" :key="l.handelsplatz + l.art + l.symbol" :ton="TON[l.art]" :title="l.symbol">
                            {{ PLATZ[l.handelsplatz] || l.handelsplatz }} · {{ t('aktien.art_' + l.art) }}<template
                                v-if="l.maxHebel"> · {{ t('aktien.hebel', { n: l.maxHebel }) }}</template>
                        </Pille>
                        <span v-if="!listungen.length" class="klein">—</span>
                    </div>
                </Karte>
            </div>
        </div>

        <p v-if="seite?.daten || seite?.linie?.length" class="klein quelle">
            {{ t('titel.quelle') }}<template v-if="seite.stand"> · {{ t('titel.stand', { zeit: zeit(seite.stand) }) }}</template>
        </p>
    </div>
</template>

<style scoped>
.titel-seite {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1rem;
}

.wer {
    flex: 1 1 12rem;
    min-width: 0;
}

.wer h2 {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 600;
}

.unter,
.klein {
    color: var(--muted);
    font-size: 0.82rem;
}

.rechts {
    display: flex;
    gap: 0.5rem;
}

.raster {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
    gap: 0.9rem;
    align-items: start;
}

.haupt,
.seitenspalte {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-width: 0;
}

@media (max-width: 1099.98px) {
    .raster {
        grid-template-columns: minmax(0, 1fr);
    }
}

.kurs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 2.4rem;
}

.kurs p {
    margin: 0.15rem 0 0;
}

.preis {
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    margin-right: 0.6rem;
}

.preis.zweit {
    font-size: 1.15rem;
}

.delta {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
}

.auf {
    color: var(--good);
}

.ab {
    color: var(--bad);
}

.spannen {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0.9rem 0 0.2rem;
}

.spannen button {
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
}

.spannen button.aktiv {
    background: var(--accent-flaeche);
    border-color: var(--accent-rand);
    color: var(--accent);
}

.spannen .delta {
    margin-left: 0.5rem;
    font-size: 0.85rem;
}

.kennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0 1.4rem;
    margin: 0.6rem 0 0;
}

.kennzahlen div,
.profil div,
.ziele div {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.42rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.88rem;
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

.kennzahlen dd {
    white-space: nowrap;
}

.profil,
.ziele {
    margin: 0;
}

.bewegungText {
    margin: 0;
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

a {
    color: var(--accent);
    text-decoration: none;
}

a:hover {
    text-decoration: underline;
}

.tabellenrahmen {
    overflow-x: auto;
}

.tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
}

.tabelle th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
}

.tabelle td {
    padding: 0.42rem 0.5rem;
    border-bottom: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
}

.tabelle .rechts {
    display: table-cell;
    text-align: right;
    white-space: nowrap;
}

.mehr {
    margin-top: 0.6rem;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0;
}

.konsens {
    margin: 0 0 0.8rem;
}

.balken {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--line);
}

.balken .kauf {
    background: var(--good);
}

.balken .halten {
    background: var(--muted);
}

.balken .verkauf {
    background: var(--bad);
}

.legende {
    display: flex;
    justify-content: space-between;
    margin-top: 0.4rem;
    font-size: 0.82rem;
    color: var(--muted);
}

.legende b {
    color: var(--text);
}

.legende b.auf {
    color: var(--good);
}

.legende b.ab {
    color: var(--bad);
}

h4 {
    margin: 1.1rem 0 0.5rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--muted);
}

.strecke {
    position: relative;
    height: 14px;
    margin: 0.2rem 6px 0.5rem;
}

.strecke::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 6px;
    height: 2px;
    background: var(--line);
}

.strecke .band {
    position: absolute;
    top: 5px;
    height: 4px;
    border-radius: 2px;
    background: var(--accent-schwach);
}

.strecke .marke {
    position: absolute;
    top: 1px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    box-sizing: border-box;
}

.strecke .marke.preis {
    background: var(--text);
}

.strecke .marke.mittel {
    border: 2px solid var(--accent);
    background: var(--panel);
}

.fuss {
    margin: 0.8rem 0 0;
}

.beschreibung {
    margin: 0.8rem 0 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--muted);
    display: -webkit-box;
    -webkit-line-clamp: 7;
    line-clamp: 7;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.plaetze {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.quelle {
    margin: 0;
}
</style>
