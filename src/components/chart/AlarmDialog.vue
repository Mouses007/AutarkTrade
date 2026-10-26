<script setup>
/**
 * Alarm anlegen oder ändern. Drei Arten:
 *   preis  über/unter/kreuzt einen festen Preis
 *   linie  über/unter/kreuzt eine gezeichnete Linie (auch schräg — der Server
 *          rechnet den Linienpreis zur jeweiligen Zeit)
 *   zone   Rechteck oder Kanal betreten/verlassen
 *   momentum  Signalpunkte des Momentum Radar (nur grosse oder alle, optional eine
 *          Richtung) auf dem Symbol oder auf Watchlists, in mehreren Zeiteinheiten
 *          zugleich; gerechnet auf geschlossenen Kerzen (`server/chart-alarm-momentum.js`)
 *   lsob   Retest oder neue Box des Indikators „LSOB-Boxen", ebenso über Symbol oder
 *          Watchlists und mehrere Zeiteinheiten (`server/chart-alarm-lsob.js`); die
 *          Box-Einstellungen kommen aus dem LSOB-Boxen-Indikator des Charts (`lsobParams`).
 *          Per Rechtsklick auf eine Box (`vorlage.box`): Alarm auf GENAU diese Box —
 *          Symbol und Zeiteinheit des Charts, meldet Berühren und Bruch; umstellen
 *          auf Watchlists macht daraus den allgemeinen LSOB-Alarm.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { legeAlarmAn, aendereAlarm } from '../../stores/chartAlarme.js'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    // Neu: { symbol, markt, art, preis?, zeichnung? } — Ändern: der Alarm selbst (mit id)
    vorlage: { type: Object, required: true },
    // Für Momentum-Alarme: die Watchlists des Charts ({ id, name, symbole })
    watchlists: { type: Array, default: () => [] },
})
const emit = defineEmits(['schliesse'])

// Esc schliesst — im Erfassungsmodus, damit die Chart-Tastatur (Entf, Strg+Z) es nicht zuerst sieht.
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); emit('schliesse') } }
onMounted(() => window.addEventListener('keydown', esc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', esc, true))
const { t } = useI18n()

const istNeu = !props.vorlage.id
const v = props.vorlage
const zeichnungTyp = v.zeichnung?.typ || null
const art = v.art
// Momentum und LSOB: Symbol ODER Watchlists, mehrere Zeiteinheiten, je Kerzenschluss geprüft
const mehrfach = art === 'momentum' || art === 'lsob'
const richtung = ref(v.bedingung?.richtung || (art === 'zone' ? 'betreten' : mehrfach ? 'beide' : 'kreuzt'))
const preis = ref(v.bedingung?.preis ?? v.preis ?? '')
const profil = v.zeichnung?.profil || null      // Volumenprofil: { poc, vah, val } wie im Chart
const kante = ref(v.bedingung?.kante || (zeichnungTyp === 'volprofil' ? 'poc' : 'oben'))
const PROFIL_NAME = { poc: 'POC', vah: 'VAH', val: 'VAL' }
// Ein Momentum-Alarm über Watchlists soll weiterlaufen — je Kerze meldet er ohnehin nur einmal.
const einmalig = ref(v.einmalig ?? !mehrfach)
const sperreMin = ref(v.bedingung?.sperreMin ?? 15)
const schwere = ref((v.bedingung?.schwere === 'kritisch' ? 'einstieg' : v.bedingung?.schwere) || 'warnung')
const push = ref(v.kanaele?.push !== false)
const mail = ref(v.kanaele?.mail !== false)
const notiz = ref(v.notiz || '')
const fehler = ref('')
const speichert = ref(false)

const richtungen = computed(() => (art === 'zone' ? ['betreten', 'verlassen'] : mehrfach ? ['beide', 'long', 'short'] : ['kreuzt', 'ueber', 'unter']))

// ── Momentum ──
const ZEITEINHEITEN = ['5m', '15m', '1h', '4h', '1d', '1w']
const symbolZiel = v.symbol || v.chartSymbol || ''
// LSOB auf eine Box: die Box aus dem Rechtsklick bzw. aus dem gespeicherten Alarm
const box = art === 'lsob' ? (v.box || v.bedingung?.box || null) : null
const boxTf = v.bedingung?.box ? v.zeiteinheiten?.[0] : v.interval
const ziel = ref(v.watchlistIds?.length ? 'listen' : box ? 'box' : 'symbol')
const listenIds = ref([...(v.watchlistIds || [])])
const zeiteinheiten = ref(v.zeiteinheiten?.length ? [...v.zeiteinheiten] : [ZEITEINHEITEN.includes(v.interval) ? v.interval : '15m'])
// Ein Feld „Auslösen bei" für Grösse und Divergenz: gross | alle | divGross | divAlle.
// Gespeichert wird weiter getrennt (`punktgroesse` + `bedingung.divergenz`).
const ausloeser = ref((v.bedingung?.divergenz ? 'div' : '') + ((v.punktgroesse || 'gross') === 'alle' ? (v.bedingung?.divergenz ? 'Alle' : 'alle') : (v.bedingung?.divergenz ? 'Gross' : 'gross')))
const punktgroesse = computed(() => (/alle$/i.test(ausloeser.value) ? 'alle' : 'gross'))
const divergenz = computed(() => ausloeser.value.startsWith('div'))
// ── LSOB ──
const ereignis = ref(v.bedingung?.ereignis || 'retest')
// Gespeicherte Einstellungen beim Ändern, sonst die des LSOB-Boxen-Indikators im Chart (oder Vorgaben)
const lsobParams = v.bedingung?.params || v.lsobParams || null
const zahl = (p) => Number(Number(p).toPrecision(7))
const boxName = box ? `${box.seite === 'long' ? 'Long' : 'Short'}-Box ${zahl(box.tief)}–${zahl(box.hoch)} · ${boxTf}` : ''
/** Wen der Alarm überwacht — im Titel: das Symbol, oder bei Watchlists deren Namen statt des Coins. */
const zielName = computed(() => {
    if (!mehrfach || ziel.value !== 'listen') return `${v.symbol || symbolZiel}${v.markt === 'spot' ? ' Spot' : ''}`
    const namen = props.watchlists.filter((w) => listenIds.value.includes(w.id)).map((w) => w.name)
    return namen.length ? namen.join(', ') : t('chart.alarm.momentum.listen')
})
/** Symbole × Zeiteinheiten — wie der Server zählt (Doppelte in zwei Listen einmal). */
const paare = computed(() => {
    if (ziel.value === 'box') return ZEITEINHEITEN.includes(boxTf) ? 1 : 0
    if (ziel.value === 'symbol') return symbolZiel ? zeiteinheiten.value.length : 0
    const s = new Set()
    for (const w of props.watchlists) if (listenIds.value.includes(w.id)) for (const x of w.symbole || []) s.add(`${x.symbol}|${x.markt}`)
    return s.size * zeiteinheiten.value.length
})
// Auf 1w gibt es keine grossen Punkte (keine höhere Zeiteinheit) — der Server lehnt das ab, hier schon sagen.
const wocheOhneGrosse = computed(() => art === 'momentum' && punktgroesse.value === 'gross' && zeiteinheiten.value.includes('1w'))
const momentumUnvollstaendig = computed(() => mehrfach && ((ziel.value !== 'box' && !zeiteinheiten.value.length) || !paare.value || wocheOhneGrosse.value))

async function speichern() {
    fehler.value = ''
    speichert.value = true
    const bedingung = { richtung: richtung.value, schwere: schwere.value }
    if (art === 'preis') bedingung.preis = Number(preis.value)
    if (art === 'momentum' && divergenz.value) bedingung.divergenz = true
    if (art === 'lsob') {
        bedingung.ereignis = ereignis.value
        if (lsobParams) bedingung.params = lsobParams
        if (ziel.value === 'box') bedingung.box = box
    }
    if (zeichnungTyp === 'kanal' && art === 'linie') bedingung.kante = kante.value
    if (zeichnungTyp === 'volprofil' && profil) { bedingung.kante = kante.value; bedingung.niveau = profil[kante.value] }
    if (!einmalig.value && !mehrfach) bedingung.sperreMin = Number(sperreMin.value) || 0
    const gemeinsam = { bedingung, einmalig: einmalig.value, kanaele: { push: push.value, mail: mail.value }, notiz: notiz.value }
    if (mehrfach) {
        Object.assign(gemeinsam, {
            watchlistIds: ziel.value === 'listen' ? listenIds.value : [],
            zeiteinheiten: ziel.value === 'box' ? [boxTf] : ZEITEINHEITEN.filter((z) => zeiteinheiten.value.includes(z)),
            ...(art === 'momentum' ? { punktgroesse: punktgroesse.value } : {}),
            ...(ziel.value !== 'listen' ? { symbol: symbolZiel } : {}),
        })
    }
    try {
        if (mehrfach && istNeu) {
            await legeAlarmAn({ markt: v.markt, art, ...gemeinsam })
        } else if (istNeu) {
            await legeAlarmAn({ symbol: v.symbol, markt: v.markt, art, zeichnungId: v.zeichnung?.id ?? null, ...gemeinsam })
        } else {
            await aendereAlarm(v.id, { ...gemeinsam, aktiv: true })
        }
        emit('schliesse')
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        speichert.value = false
    }
}
</script>

<template>
    <div class="dialogHintergrund" @click.self="emit('schliesse')">
        <div class="dialog" role="dialog" aria-modal="true" :aria-label="t(istNeu ? 'chart.alarm.neu' : 'chart.alarm.aendern')">
            <div class="kopf">
                <b class="titel"><Symbol name="glocke" /> {{ t(istNeu ? 'chart.alarm.neu' : 'chart.alarm.aendern') }} — {{ zielName }}</b>
                <button type="button" class="zu" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('schliesse')"><Symbol name="schliessen" /></button>
            </div>
            <div class="art">{{ t('chart.alarm.art.' + art) }}<template v-if="zeichnungTyp"> · {{ t('chart.wz.' + zeichnungTyp) }}</template></div>
            <template v-if="mehrfach">
                <label v-if="art === 'lsob' && ziel !== 'box'" class="zeile">
                    <span>{{ t('chart.alarm.lsob.ereignis') }}</span>
                    <select v-model="ereignis" class="at-feld klein">
                        <option v-for="e in ['retest', 'box', 'beide']" :key="e" :value="e">{{ t('chart.alarm.lsob.' + e) }}</option>
                    </select>
                </label>
                <label v-else-if="art === 'momentum'" class="zeile">
                    <span>{{ t('chart.alarm.momentum.punkte') }}</span>
                    <select v-model="ausloeser" class="at-feld klein">
                        <option value="gross">{{ t('chart.alarm.momentum.gross') }}</option>
                        <option value="alle">{{ t('chart.alarm.momentum.alle') }}</option>
                        <option value="divGross">{{ t('chart.alarm.momentum.divGross') }}</option>
                        <option value="divAlle">{{ t('chart.alarm.momentum.divAlle') }}</option>
                    </select>
                </label>
                <div class="gruppe">
                    <span>{{ t('chart.alarm.momentum.ueberwachen') }}</span>
                    <label v-if="box" class="haken"><input v-model="ziel" type="radio" value="box" />
                        {{ t('chart.alarm.lsob.dieseBox', { box: boxName }) }}</label>
                    <label v-else class="haken"><input v-model="ziel" type="radio" value="symbol" :disabled="!symbolZiel" />
                        {{ t('chart.alarm.momentum.diesesSymbol', { symbol: symbolZiel || '—' }) }}</label>
                    <label class="haken"><input v-model="ziel" type="radio" value="listen" /> {{ t('chart.alarm.momentum.listen') }}</label>
                    <div v-if="ziel === 'listen'" class="liste">
                        <label v-for="w in watchlists" :key="w.id" class="haken">
                            <input v-model="listenIds" type="checkbox" :value="w.id" /> {{ w.name }} <small>({{ (w.symbole || []).length }})</small></label>
                        <small v-if="!watchlists.length" class="leise">{{ t('chart.alarm.momentum.keineListen') }}</small>
                    </div>
                </div>
                <small v-if="ziel === 'box'" :class="paare ? 'leise' : 'fehler'">{{ t(paare ? 'chart.alarm.lsob.boxHinweis' : 'chart.alarm.lsob.boxTfFehlt', { tf: boxTf }) }}</small>
                <div v-else class="gruppe">
                    <span>{{ t('chart.alarm.momentum.zeiteinheiten') }}</span>
                    <div class="haken tfs">
                        <label v-for="z in ZEITEINHEITEN" :key="z"><input v-model="zeiteinheiten" type="checkbox" :value="z" /> {{ z }}</label>
                    </div>
                    <small class="leise">{{ t('chart.alarm.momentum.paare', { n: paare }, paare) }}</small>
                    <small v-if="wocheOhneGrosse" class="fehler">{{ t('chart.alarm.momentum.wocheOhneGrosse') }}</small>
                </div>
                <small v-if="art === 'lsob'" class="leise">{{ t(lsobParams ? 'chart.alarm.lsob.ausChart' : 'chart.alarm.lsob.vorgaben') }}</small>
            </template>
            <label v-if="ziel !== 'box'" class="zeile">
                <span>{{ t(mehrfach ? 'chart.alarm.momentum.richtungTitel' : 'chart.alarm.bedingung') }}</span>
                <select v-model="richtung" class="at-feld klein">
                    <option v-for="r in richtungen" :key="r" :value="r">{{ t('chart.alarm.richtung.' + r) }}</option>
                </select>
            </label>
            <label v-if="art === 'preis'" class="zeile">
                <span>{{ t('chart.alarm.preis') }}</span>
                <input v-model="preis" type="number" step="any" class="at-feld klein" />
            </label>
            <template v-if="zeichnungTyp === 'volprofil'">
                <label class="zeile">
                    <span>{{ t('chart.alarm.profilLinie') }}</span>
                    <select v-model="kante" class="at-feld klein" :disabled="!profil">
                        <option v-for="k in ['poc', 'vah', 'val']" :key="k" :value="k">
                            {{ PROFIL_NAME[k] }}{{ profil ? ' — ' + Number(profil[k].toPrecision(7)) : '' }}</option>
                    </select>
                </label>
                <div class="hinweis">{{ t(profil ? 'chart.alarm.profilHinweis' : 'chart.alarm.profilFehlt') }}</div>
            </template>
            <div v-else-if="!istNeu && PROFIL_NAME[v.bedingung?.kante]" class="art">
                {{ t('chart.alarm.profilLinie') }}: {{ PROFIL_NAME[v.bedingung.kante] }} — {{ Number(Number(v.bedingung.niveau).toPrecision(7)) }}</div>
            <label v-if="art === 'linie' && zeichnungTyp === 'kanal'" class="zeile">
                <span>{{ t('chart.alarm.kante') }}</span>
                <select v-model="kante" class="at-feld klein">
                    <option value="oben">{{ t('chart.alarm.kanten.oben') }}</option>
                    <option value="mitte">{{ t('chart.alarm.kanten.mitte') }}</option>
                    <option value="unten">{{ t('chart.alarm.kanten.unten') }}</option>
                </select>
            </label>
            <label class="haken"><input v-model="einmalig" type="checkbox" /> {{ t('chart.alarm.einmalig') }}</label>
            <label v-if="!einmalig && !mehrfach" class="zeile">
                <span>{{ t('chart.alarm.sperre') }}</span>
                <input v-model="sperreMin" type="number" min="0" class="at-feld klein" />
            </label>
            <label class="zeile">
                <span>{{ t('chart.alarm.schwere') }}</span>
                <select v-model="schwere" class="at-feld klein">
                    <option value="info">{{ t('chart.alarm.schweren.info') }}</option>
                    <option value="warnung">{{ t('chart.alarm.schweren.warnung') }}</option>
                    <option value="einstieg">{{ t('chart.alarm.schweren.einstieg') }}</option>
                </select>
            </label>
            <div class="haken">
                <label><input v-model="push" type="checkbox" /> {{ t('chart.alarm.push') }}</label>
                <label><input v-model="mail" type="checkbox" /> {{ t('chart.alarm.mail') }}</label>
            </div>
            <input v-model="notiz" class="at-feld klein" maxlength="300" :placeholder="t('chart.alarm.notiz')" />
            <div class="hinweis">{{ t(art === 'lsob' ? 'chart.alarm.lsob.hinweis' : art === 'momentum' ? 'chart.alarm.momentum.hinweis' : 'chart.alarm.hinweis') }}</div>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
            <div class="fuss">
                <Knopf art="leise" klein @click="emit('schliesse')">{{ t('chart.alarm.abbrechen') }}</Knopf>
                <Knopf art="haupt" klein :disabled="speichert || (art === 'preis' && !(Number(preis) > 0)) || momentumUnvollstaendig || (zeichnungTyp === 'volprofil' && !profil)" @click="speichern">
                    {{ t('chart.alarm.speichern') }}</Knopf>
            </div>
        </div>
    </div>
</template>

<style scoped>
.dialogHintergrund {
    position: fixed;
    inset: 0;
    z-index: 2100; /* über dem Chart-Vollbild (2000) */
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 16px 16px;
}

.dialog {
    width: 380px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    padding: 12px;
    font-size: 12px;
}

.kopf {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.titel {
    display: inline-flex;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    align-items: center;
    gap: var(--abstand-1);
}

.zu {
    background: transparent;
    border: none;
    color: var(--muted);
    display: inline-flex;
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
}

.art {
    color: var(--muted);
}

.zeile {
    display: grid;
    grid-template-columns: 1fr 210px;
    align-items: center;
    gap: 8px;
}

.haken {
    display: flex;
    gap: 14px;
    align-items: center;
}

.haken label {
    display: flex;
    gap: 6px;
    align-items: center;
}

.gruppe {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.tfs {
    flex-wrap: wrap;
    gap: 6px 12px;
}

.liste {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 20px;
    max-height: 140px;
    overflow-y: auto;
}

.leise {
    color: var(--muted);
}

.hinweis {
    color: var(--muted);
    font-size: 11px;
}

.fehler {
    color: var(--bad);
}

.fuss {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
</style>
