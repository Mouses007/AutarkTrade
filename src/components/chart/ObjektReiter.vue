<script setup>
/**
 * Alle Zeichnungen des aktiven Symbols — auch die versteckten und die, die
 * nur auf einer anderen Zeiteinheit erscheinen. Ohne diese Liste wäre eine
 * versteckte Linie nicht mehr wiederzufinden.
 *
 * Eigene Gruppen (31.10.2026): „Gruppieren" schaltet Kästchen ein, die
 * markierten Zeichnungen kommen in eine benannte Gruppe (neu oder bestehend).
 * Eine Gruppe lässt sich auf- und zuklappen (gemerkt im Browser), umbenennen,
 * gesamthaft ein-/ausblenden, sperren, auflösen oder löschen. Die Zugehörigkeit
 * steht an der Zeichnung (`gruppe`), gilt also je Symbol.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { gruppiereZeichnungen, gruppenName } from '../../utils/chart/zeichnungsGruppen.js'
import { Symbol } from '../basis'

const props = defineProps({
    symbol: { type: String, required: true },
    zeichnungen: { type: Array, default: () => [] },
    auswahlId: { type: Number, default: null },
})
const emit = defineEmits(['waehle', 'bearbeite', 'aendere', 'loesche'])
const { t } = useI18n()

const liste = computed(() => gruppiereZeichnungen(props.zeichnungen))
const gruppenNamen = computed(() => liste.value.gruppen.map((g) => g.name))

// Zugeklappte Gruppen je Symbol, im Browser gemerkt
const ZU_SCHLUESSEL = 'chartZeichnungsGruppenZu'
const leseZu = () => { try { return JSON.parse(localStorage.getItem(ZU_SCHLUESSEL) || '{}') || {} } catch { return {} } }
const zu = ref(leseZu())
const istZu = (name) => !!zu.value[`${props.symbol}|${name}`]
function klappe(name) {
    const k = `${props.symbol}|${name}`
    const neu = { ...zu.value }
    if (neu[k]) delete neu[k]; else neu[k] = 1
    zu.value = neu
    try { localStorage.setItem(ZU_SCHLUESSEL, JSON.stringify(neu)) } catch { /* kein Speicher */ }
}

// Markieren und gruppieren
const markieren = ref(false)
const markiert = ref(new Set())
const zielName = ref('')
watch(() => props.symbol, () => { markieren.value = false; markiert.value = new Set(); umbenennen.value = null })
function schalteMarke(id) {
    const n = new Set(markiert.value)
    if (n.has(id)) n.delete(id); else n.add(id)
    markiert.value = n
}
function beende() { markieren.value = false; markiert.value = new Set(); zielName.value = '' }
const ausgewaehlte = () => props.zeichnungen.filter((z) => markiert.value.has(z.id))
function inGruppe() {
    const name = gruppenName(zielName.value)
    if (!name || !markiert.value.size) return
    for (const z of ausgewaehlte()) if (z.gruppe !== name) emit('aendere', z, { gruppe: name })
    // Die neue Gruppe offen zeigen
    if (istZu(name)) klappe(name)
    beende()
}
function ausGruppe() {
    for (const z of ausgewaehlte()) if (z.gruppe) emit('aendere', z, { gruppe: null })
    beende()
}

// Gruppe gesamthaft
const alle = (g, patch) => { for (const z of g.zeichnungen) emit('aendere', z, patch) }
const schalteSichtbar = (g) => alle(g, { versteckt: !g.alleVersteckt })
const schalteSperre = (g) => alle(g, { gesperrt: !g.alleGesperrt })
function aufloesen(g) {
    if (window.confirm(t('chart.gruppe.aufloesenFrage', { name: g.name }))) alle(g, { gruppe: null })
}
function loescheGruppe(g) {
    if (!window.confirm(t('chart.gruppe.loeschenFrage', { name: g.name, n: g.zeichnungen.length }))) return
    for (const z of g.zeichnungen) emit('loesche', z)
}
const umbenennen = ref(null)       // { alt, neu }
function starteUmbenennen(g) { umbenennen.value = { alt: g.name, neu: g.name } }
function speichereName() {
    const u = umbenennen.value
    umbenennen.value = null
    const name = gruppenName(u?.neu)
    if (!u || !name || name === u.alt) return
    const g = liste.value.gruppen.find((x) => x.name === u.alt)
    if (g) alle(g, { gruppe: name })
}

function preisText(z) {
    const p = z.punkte?.[0]?.p
    if (p == null) return ''
    const s = Math.abs(p) >= 1000 ? 2 : Math.abs(p) >= 1 ? 4 : 6
    return p.toFixed(s)
}

function beschreibung(z) {
    const text = stilFuer(z).text
    return text ? `„${text}"` : preisText(z)
}
</script>

<template>
    <div class="objekte">
        <div v-if="!zeichnungen.length" class="leer">{{ t('chart.objekteLeer', { symbol }) }}</div>
        <template v-else>
            <div class="leiste">
                <button v-if="!markieren" type="button" class="textKnopf" @click="markieren = true">
                    <Symbol name="ebenen" /> {{ t('chart.gruppe.gruppieren') }}</button>
                <template v-else>
                    <input v-model="zielName" class="at-feld klein name" list="zeichnungsGruppen" maxlength="80"
                        :placeholder="t('chart.gruppe.namePlatzhalter')" @keyup.enter="inGruppe" @keyup.escape="beende" />
                    <datalist id="zeichnungsGruppen"><option v-for="n in gruppenNamen" :key="n" :value="n" /></datalist>
                    <button type="button" class="textKnopf" :disabled="!markiert.size || !zielName.trim()" @click="inGruppe">
                        {{ t('chart.gruppe.inGruppe', { n: markiert.size }) }}</button>
                    <button v-if="ausgewaehlte().some((z) => z.gruppe)" type="button" class="textKnopf" @click="ausGruppe">{{ t('chart.gruppe.ausGruppe') }}</button>
                    <button type="button" class="textKnopf leise" @click="beende">{{ t('chart.gruppe.abbrechen') }}</button>
                </template>
            </div>
            <div v-if="markieren" class="hinweis">{{ t('chart.gruppe.hinweis') }}</div>

            <section v-for="g in liste.gruppen" :key="g.name" class="gruppe" :class="{ aus: g.alleVersteckt }">
                <div class="gKopf">
                    <button type="button" class="klappe" :aria-expanded="!istZu(g.name)" :title="t(istZu(g.name) ? 'chart.gruppe.aufklappen' : 'chart.gruppe.zuklappen')"
                        :aria-label="t(istZu(g.name) ? 'chart.gruppe.aufklappen' : 'chart.gruppe.zuklappen')" @click="klappe(g.name)">{{ istZu(g.name) ? '▸' : '▾' }}</button>
                    <input v-if="umbenennen?.alt === g.name" v-model="umbenennen.neu" class="at-feld klein name" maxlength="80"
                        @keyup.enter="speichereName" @keyup.escape="umbenennen = null" @blur="speichereName" />
                    <span v-else class="gName" :title="t('chart.gruppe.umbenennen')" @dblclick="starteUmbenennen(g)">{{ g.name }}</span>
                    <span class="anzahl">{{ g.zeichnungen.length }}</span>
                    <span class="werkzeug">
                        <button type="button" :title="t('chart.gruppe.umbenennen')" :aria-label="t('chart.gruppe.umbenennen')" @click="starteUmbenennen(g)"><Symbol name="stift" /></button>
                        <button type="button" :title="t(g.alleVersteckt ? 'chart.gruppe.einblenden' : 'chart.gruppe.ausblenden')"
                            :aria-label="t(g.alleVersteckt ? 'chart.gruppe.einblenden' : 'chart.gruppe.ausblenden')" @click="schalteSichtbar(g)">
                            <Symbol :name="g.alleVersteckt ? 'augeAus' : 'auge'" /></button>
                        <button type="button" :title="t(g.alleGesperrt ? 'chart.gruppe.entsperren' : 'chart.gruppe.sperren')"
                            :aria-label="t(g.alleGesperrt ? 'chart.gruppe.entsperren' : 'chart.gruppe.sperren')" @click="schalteSperre(g)">
                            <Symbol :name="g.alleGesperrt ? 'schloss' : 'schlossOffen'" /></button>
                        <button type="button" :title="t('chart.gruppe.aufloesen')" :aria-label="t('chart.gruppe.aufloesen')" @click="aufloesen(g)"><Symbol name="schliessen" /></button>
                        <button type="button" :title="t('chart.gruppe.loeschen')" :aria-label="t('chart.gruppe.loeschen')" @click="loescheGruppe(g)"><Symbol name="muell" /></button>
                    </span>
                </div>
                <template v-if="!istZu(g.name) || markieren">
                    <div v-for="z in g.zeichnungen" :key="z.id" class="zeile eingerueckt" :class="{ an: z.id === auswahlId, aus: z.versteckt }"
                        @click="markieren ? schalteMarke(z.id) : emit('waehle', z)">
                        <input v-if="markieren" type="checkbox" :checked="markiert.has(z.id)" @click.stop="schalteMarke(z.id)" />
                        <span class="punkt" :style="{ background: stilFuer(z).farbe || '#888' }"></span>
                        <span class="name">{{ t('chart.wz.' + z.typ) }}</span>
                        <span class="info">{{ beschreibung(z) }}</span>
                        <span v-if="Array.isArray(z.sichtbarAuf) && z.sichtbarAuf.length" class="tf">{{ z.sichtbarAuf.join(',') }}</span>
                        <span v-if="!markieren" class="werkzeug" @click.stop>
                            <button type="button" :title="t(z.typ === 'position' ? 'chart.objektRechner' : 'chart.objektBearbeiten')"
                                @click="emit('bearbeite', z)" :aria-label="t(z.typ === 'position' ? 'chart.objektRechner' : 'chart.objektBearbeiten')">
                                <Symbol :name="z.typ === 'position' ? 'rechner' : 'stift'" /></button>
                            <button type="button" :title="t(z.versteckt ? 'chart.einblenden' : 'chart.ausblenden')"
                                @click="emit('aendere', z, { versteckt: !z.versteckt })" :aria-label="t(z.versteckt ? 'chart.einblenden' : 'chart.ausblenden')">
                                <Symbol :name="z.versteckt ? 'augeAus' : 'auge'" /></button>
                            <button type="button" :title="t(z.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
                                @click="emit('aendere', z, { gesperrt: !z.gesperrt })" :aria-label="t(z.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')">
                                <Symbol :name="z.gesperrt ? 'schloss' : 'schlossOffen'" /></button>
                            <button type="button" :title="t('chart.entfernen')" @click="emit('loesche', z)" :aria-label="t('chart.entfernen')"><Symbol name="muell" /></button>
                        </span>
                    </div>
                </template>
            </section>

            <div v-for="z in liste.ohne" :key="z.id" class="zeile" :class="{ an: z.id === auswahlId, aus: z.versteckt }"
                @click="markieren ? schalteMarke(z.id) : emit('waehle', z)">
                <input v-if="markieren" type="checkbox" :checked="markiert.has(z.id)" @click.stop="schalteMarke(z.id)" />
                <span class="punkt" :style="{ background: stilFuer(z).farbe || '#888' }"></span>
                <span class="name">{{ t('chart.wz.' + z.typ) }}</span>
                <span class="info">{{ beschreibung(z) }}</span>
                <span v-if="Array.isArray(z.sichtbarAuf) && z.sichtbarAuf.length" class="tf">{{ z.sichtbarAuf.join(',') }}</span>
                <span v-if="!markieren" class="werkzeug" @click.stop>
                    <button type="button" :title="t(z.typ === 'position' ? 'chart.objektRechner' : 'chart.objektBearbeiten')"
                        @click="emit('bearbeite', z)" :aria-label="t(z.typ === 'position' ? 'chart.objektRechner' : 'chart.objektBearbeiten')">
                        <Symbol :name="z.typ === 'position' ? 'rechner' : 'stift'" /></button>
                    <button type="button" :title="t(z.versteckt ? 'chart.einblenden' : 'chart.ausblenden')"
                        @click="emit('aendere', z, { versteckt: !z.versteckt })" :aria-label="t(z.versteckt ? 'chart.einblenden' : 'chart.ausblenden')">
                        <Symbol :name="z.versteckt ? 'augeAus' : 'auge'" /></button>
                    <button type="button" :title="t(z.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
                        @click="emit('aendere', z, { gesperrt: !z.gesperrt })" :aria-label="t(z.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')">
                        <Symbol :name="z.gesperrt ? 'schloss' : 'schlossOffen'" /></button>
                    <button type="button" :title="t('chart.entfernen')" @click="emit('loesche', z)" :aria-label="t('chart.entfernen')"><Symbol name="muell" /></button>
                </span>
            </div>
        </template>
    </div>
</template>

<style scoped>
.objekte {
    overflow-y: auto;
    min-height: 0;
}

.leer,
.hinweis {
    color: var(--muted);
    font-size: 12px;
    padding: 8px 4px;
}

.hinweis {
    font-size: 11px;
    padding: 0 6px 4px;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 2px 6px 6px;
}

.leiste .name {
    flex: 1 1 140px;
    min-width: 0;
}

.textKnopf {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
}

.textKnopf:disabled {
    opacity: 0.4;
    cursor: default;
}

.textKnopf.leise {
    color: var(--muted);
}

.gruppe {
    border-top: 1px solid var(--line);
    padding-top: 2px;
}

.gruppe.aus .gName {
    opacity: 0.55;
}

.gKopf {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    font-size: 12px;
}

.gKopf .name {
    flex: 1;
    min-width: 0;
}

.klappe {
    background: none;
    border: none;
    color: var(--muted);
    padding: 0 2px;
    width: 16px;
    cursor: pointer;
    font-size: 12px;
}

.gName {
    flex: 1;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.anzahl {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    padding: 0 6px;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
}

.zeile.eingerueckt {
    padding-left: 24px;
}

.zeile input[type='checkbox'] {
    margin: 0;
}

.zeile:hover {
    background: var(--line);
}

.zeile.an {
    background: var(--accent-flaeche);
}

.zeile.aus {
    opacity: 0.5;
}

.punkt {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.name {
    flex-shrink: 0;
}

.info {
    flex: 1;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tf {
    font-size: 10px;
    color: var(--accent);
}

.werkzeug {
    display: flex;
}

.werkzeug button {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 0 3px;
    display: inline-flex;
    cursor: pointer;
}

.werkzeug button:hover {
    color: var(--text);
}
</style>
