<script setup>
/**
 * Aktien-Radar: welche Aktien-Futures lassen sich JETZT handeln — dieselbe
 * Messung wie der Coin-Radar (Bewegung, Volumen, Trend, Haltekosten,
 * Ausführung), über die Aktien-Kontrakte der Marktdatenquelle.
 *
 * Bewusst eine eigene, schlanke Seite statt eines Schalters in `CoinRadar.vue`:
 * Abverkaufs-Wache, Tiefensuche, Favoriten und Erfolgskontrolle dort sind auf
 * Coins gebaut. Der Server ist derselbe (`/api/coin-radar/*?markt=aktien`).
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import Kaufzettel from '../components/aktien/Kaufzettel.vue'
import Pille from '../components/basis/Pille.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import { marktdaten, ladeMarktdaten } from '../utils/marktdaten.js'

const { t, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const MARKT = { markt: 'aktien' }

/* Sprung in den Chart: das Symbol einer Zeile ist das der Marktdatenquelle, also auch deren Kerzen. */
ladeMarktdaten()
function chartZiel(z) {
    const boerse = marktdaten.value?.wahl
    return { path: '/chart', query: { symbol: z.symbol, ...(boerse && boerse !== 'aus' ? { boerse } : {}) } }
}

const zeilen = ref([])
const lauf = ref(null)
const mitHuerden = ref(false)
const laedt = ref(true)
const laeuft = ref(false)
const zettelTicker = ref('')
const fortschritt = ref(null)
const fehler = ref('')

async function lade() {
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/coin-radar/zeilen', { params: { ...MARKT, huerden: mitHuerden.value ? 1 : 0 } })
        lauf.value = data?.lauf || null
        zeilen.value = data?.zeilen || []
    } catch (e) {
        fehler.value = `${t('aktienradar.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

// Der Lauf meldet seinen Fortschritt als Ereignisstrom — wie beim Coin-Radar.
let strom = null
async function starteLauf() {
    if (laeuft.value) return
    laeuft.value = true
    fehler.value = ''
    fortschritt.value = { schritt: 'universum' }
    strom = new AbortController()
    let laufFehler = ''
    try {
        const antwort = await fetch('/api/coin-radar/lauf?markt=aktien', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: strom.signal,
        })
        if (!antwort.ok) {
            const j = await antwort.json().catch(() => ({}))
            throw new Error(j.error || `HTTP ${antwort.status}`)
        }
        const leser = antwort.body.getReader()
        const dekoder = new TextDecoder()
        let puffer = ''
        while (true) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekoder.decode(value, { stream: true })
            const teile = puffer.split('\n')
            puffer = teile.pop() || ''
            for (const z of teile) {
                if (!z.startsWith('data: ')) continue
                let e
                try { e = JSON.parse(z.slice(6)) } catch { continue }
                if (e.type === 'fortschritt') fortschritt.value = e
                else if (e.type === 'fehler') laufFehler = e.aus ? t('aktienradar.quelleAus') : e.fehler
            }
        }
        await lade()
        // `lade()` räumt die Fehlerzeile ab — ein gescheiterter Lauf muss danach noch dastehen.
        if (laufFehler) fehler.value = t('aktienradar.laufFehler', { fehler: laufFehler })
    } catch (e) {
        if (e.name !== 'AbortError') fehler.value = e.message
    } finally {
        laeuft.value = false
        fortschritt.value = null
        strom = null
    }
}

watch(mitHuerden, lade)
onMounted(lade)
onBeforeUnmount(() => strom?.abort())

const referenz = computed(() => lauf.value?.quellenStand?.referenz?.ticker || null)
const schrittText = computed(() => {
    const f = fortschritt.value
    if (!f) return ''
    const name = t('aktienradar.schritt_' + (f.schritt || 'universum'))
    return f.gesamt ? `${name} ${f.fertig ?? 0}/${f.gesamt}` : name
})

const zahl = (x, stellen = 1) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x))
const gross = (x) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(x)))
const zeit = (ms) => (ms ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(ms))) : '—')
const geordnet = (liste = []) => [...liste].sort((a, b) => RANG[a.art] - RANG[b.art] || a.boerse.localeCompare(b.boerse))
const rund = (x) => (x == null ? '—' : Math.round(x))
const prozent = (x, stellen = 0) => (x == null ? '—' : `${x > 0 ? '+' : ''}${zahl(x, stellen)} %`)
// Läufe von vor dem Umbau tragen noch die Coin-Teilnoten (mit `kosten`).
const teilText = (n) => ('staerke' in (n || {})
    ? t('aktienradar.teilnotenNeu', { staerke: rund(n.staerke), hochNaehe: rund(n.hochNaehe), imSpiel: rund(n.imSpiel), bewegung: rund(n.bewegung), trend: rund(n.trend) })
    : t('aktienradar.teilnoten', { bewegung: n?.bewegung ?? '—', imSpiel: n?.imSpiel ?? '—', trend: n?.trend ?? '—', kosten: n?.kosten ?? '—' }))
const tages = (z) => z.jeZeiteinheit?.tages || null
const staerkeText = (z) => {
    const g = tages(z)
    return g ? t('aktienradar.staerkeWerte', { m3: prozent(g.rs3m), m6: prozent(g.rs6m), m12: prozent(g.rs12m), index: staerke.value?.index || 'SPY' }) : ''
}
const rvolText = (z) => {
    const g = tages(z)
    return g?.rvolBasis ? t('aktienradar.rvolBasis_' + g.rvolBasis, { n: g.rvolProben }) : t('aktienradar.rvolOhne')
}
const zahlenText = (z) => {
    const g = tages(z)
    return g?.zahlenZeit ? t(g.zahlenGeschaetzt ? 'aktienradar.zahlenAmGeschaetzt' : 'aktienradar.zahlenAm', { zeit: zeit(g.zahlenZeit) }) : ''
}
const staerke = computed(() => lauf.value?.quellenStand?.staerke || null)
const sitzung = computed(() => lauf.value?.quellenStand?.sitzung || null)
</script>

<template>
    <div class="aktienradar-seite">
        <div class="leiste">
            <label class="haken"><input v-model="mitHuerden" type="checkbox" /> {{ t('aktienradar.zeigeHuerden') }}</label>
            <Knopf klein symbol="aktualisieren" :laedt="laeuft" @click="starteLauf">{{ t('aktienradar.lauf') }}</Knopf>
        </div>

        <p v-if="laeuft" class="leise" role="status">{{ schrittText }}</p>
        <p v-else-if="lauf" class="leise">
            {{ t('aktienradar.stand', { zeit: zeit(lauf.beendetAm || lauf.erstelltAm), geprueft: lauf.geprueft, bewertet: lauf.geprueft - lauf.verworfenHuerde }) }}
            <template v-if="referenz"> {{ t('aktienradar.referenz', { ticker: referenz }) }}</template>
            <template v-else> {{ t('aktienradar.ohneReferenz') }}</template>
        </p>
        <p v-if="!laeuft && sitzung" class="leise">
            {{ t('aktienradar.sitzung', { sitzung: t('strategies.aktien.sitzung_' + sitzung) }) }}
            <template v-if="sitzung !== 'regulaer'"> {{ t('aktienradar.sitzungDuenn') }}</template>
        </p>
        <Hinweis v-if="!laeuft && staerke && !staerke.ok" art="warn">{{ t('aktienradar.staerkeFehlt_' + (staerke.grund || 'abrufFehlgeschlagen')) }}</Hinweis>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Kreisel v-if="laedt" />
        <Leerzustand v-else-if="!lauf && !laeuft" :titel="t('aktienradar.leerTitel')" :text="t('aktienradar.leerText')" symbol="listeNummer">
            <Knopf art="haupt" symbol="aktualisieren" @click="starteLauf">{{ t('aktienradar.lauf') }}</Knopf>
        </Leerzustand>
        <Leerzustand v-else-if="!zeilen.length && !laeuft" :titel="t('aktienradar.keineTitel')" :text="t('aktienradar.keineTitelText')" symbol="suche" />

        <div v-else-if="zeilen.length" class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th class="rechts">{{ t('aktienradar.rang') }}</th>
                        <th class="rechts" :title="t('aktienradar.noteInfo')">{{ t('aktienradar.note') }}</th>
                        <th>{{ t('aktienradar.ticker') }}</th>
                        <th>{{ t('aktienradar.name') }}</th>
                        <th class="rechts">{{ t('aktienradar.umsatz') }}</th>
                        <th class="rechts">{{ t('aktienradar.spread') }}</th>
                        <template v-if="!mitHuerden">
                            <th class="rechts" :title="t('aktienradar.staerkeInfo')">{{ t('aktienradar.staerke') }}</th>
                            <th class="rechts" :title="t('aktienradar.hochInfo')">{{ t('aktienradar.hoch') }}</th>
                            <th class="rechts" :title="t('aktienradar.zahlenInfo')">{{ t('aktienradar.zahlen') }}</th>
                            <th class="rechts" :title="t('aktienradar.atrInfo')">ATR %</th>
                            <th class="rechts" :title="t('aktienradar.rvolInfo')">RVOL</th>
                            <th class="rechts" :title="t('aktienradar.adxInfo')">ADX</th>
                            <th class="rechts" :title="t('aktienradar.fundingInfo')">{{ t('aktienradar.funding') }}</th>
                            <th class="rechts" :title="t('aktienradar.ausfuehrungInfo')">{{ t('aktienradar.ausfuehrung') }}</th>
                            <th class="rechts" :title="t('aktienradar.kopplungInfo')">{{ referenz ? t('aktienradar.kopplung', { ticker: referenz }) : t('aktienradar.kopplungOhne') }}</th>
                        </template>
                        <th v-else>{{ t('aktienradar.grund') }}</th>
                        <th>{{ t('aktienradar.handelbar') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="z in zeilen" :key="z.symbol">
                        <td class="rechts">{{ z.rang || '—' }}</td>
                        <td class="rechts note" :title="teilText(z.teilnoten)">{{ z.note == null ? '—' : zahl(z.note, 0) }}</td>
                        <td class="ticker" :title="z.symbol">
                            <router-link :to="chartZiel(z)" :title="t('aktienradar.zumChart')">{{ z.boersen?.ticker || z.symbol }}</router-link>
                            <span v-if="z.boersen?.unterart && z.boersen.unterart !== 'aktie'" class="art">{{ t('aktien.art_' + z.boersen.unterart) }}</span>
                        </td>
                        <td class="name">
                            <router-link v-if="z.boersen?.ticker" :to="{ path: '/aktien', query: { titel: z.boersen.ticker } }" :title="t('titel.oeffnen')">{{ z.boersen?.name || z.boersen.ticker }}</router-link>
                            <template v-else>—</template>
                        </td>
                        <td class="rechts">{{ gross(z.umsatz24h) }}</td>
                        <td class="rechts">{{ z.spreadBp == null ? '—' : zahl(z.spreadBp, 1) + ' bp' }}</td>
                        <template v-if="!mitHuerden">
                            <td class="rechts" :title="staerkeText(z)">{{ rund(tages(z)?.staerkeRang) }}</td>
                            <td class="rechts">{{ tages(z)?.abstandHochPct == null ? '—' : zahl(tages(z).abstandHochPct, 0) + ' %' }}</td>
                            <td class="rechts" :class="{ bald: tages(z)?.zahlenIn != null && tages(z).zahlenIn <= 2 }" :title="zahlenText(z)">
                                {{ tages(z)?.zahlenIn == null ? '—' : tages(z).zahlenIn === 0 ? t('aktienradar.zahlenHeute') : t('aktienradar.zahlenTage', { n: tages(z).zahlenIn }) }}
                            </td>
                            <td class="rechts">{{ zahl(z.atrPct, 2) }}</td>
                            <td class="rechts" :title="rvolText(z)">{{ z.rvol == null ? '—' : zahl(z.rvol, 1) + '×' }}</td>
                            <td class="rechts">{{ zahl(z.adx, 0) }}</td>
                            <td class="rechts">{{ z.fundingJahresRate == null ? '—' : zahl(z.fundingJahresRate, 0) + ' %' }}</td>
                            <td class="rechts" :title="z.besteBoerse ? t('aktienradar.besteBoerse', { boerse: PLATZ[z.besteBoerse] || z.besteBoerse, bp: zahl(z.rundlaufBp, 1) }) : ''">
                                {{ z.noteAusfuehrung == null ? '—' : zahl(z.noteAusfuehrung, 0) }}
                            </td>
                            <td class="rechts">
                                {{ z.btcKorrelation == null ? '—' : zahl(z.btcKorrelation * 100, 0) + ' %' }}
                                <span v-if="z.btcBeta != null" class="leise">β {{ zahl(z.btcBeta, 1) }}</span>
                            </td>
                        </template>
                        <td v-else class="name">{{ t('aktienradar.huerde_' + (z.huerdeGrund || 'unbekannt')) }}</td>
                        <td class="plaetze">
                            <Pille v-for="l in geordnet(z.boersen?.liste)" :key="l.boerse + l.art" :ton="TON[l.art]" :title="l.symbol">
                                {{ PLATZ[l.boerse] || l.boerse }} · {{ t('aktien.art_' + l.art) }}
                            </Pille>
                            <Knopf v-if="z.boersen?.ticker" klein nur-symbol art="leise" symbol="dokument"
                                :titel="t('kaufzettel.knopfTitel', { ticker: z.boersen.ticker })" @click="zettelTicker = z.boersen.ticker" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="leise">{{ t('aktienradar.hinweis') }}</p>

        <Kaufzettel v-if="zettelTicker" :model-value="true" :ticker="zettelTicker" @update:model-value="zettelTicker = ''" />
    </div>
</template>

<style scoped>
.bald {
    color: var(--warn);
    font-weight: 600;
}

.aktienradar-seite {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem 1rem;
}

.haken {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.88rem;
    cursor: pointer;
}

.leise {
    margin: 0;
    color: var(--muted);
    font-size: 0.86rem;
}

.rolle {
    overflow-x: auto;
}

.liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}

.liste th {
    text-align: left;
    padding: 0.5rem 0.6rem;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
}

.liste th[title] {
    cursor: help;
}

.liste td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    white-space: nowrap;
}

.liste .rechts {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.note {
    font-weight: 700;
    color: var(--accent);
    cursor: help;
}

.ticker a,
.name a {
    color: inherit;
    text-decoration: none;
}

.ticker a:hover,
.name a:hover {
    color: var(--accent);
}

.ticker {
    font-weight: 700;
}

.art {
    margin-left: 0.3rem;
    color: var(--muted);
    font-weight: 400;
    font-size: 0.78rem;
}

.liste td.name {
    color: var(--muted);
    white-space: normal;
    min-width: 9rem;
}

.liste td.plaetze {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.3rem;
    /* Eine Zeile je Titel: mit den Spalten Stärke und 52-Wochen-Hoch rollt die
       Tabelle ohnehin waagrecht — umbrechende Marken machten jede Zeile turmhoch. */
    white-space: nowrap;
}
</style>
