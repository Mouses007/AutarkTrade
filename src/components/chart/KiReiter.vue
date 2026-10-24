<script setup>
/**
 * Seitenleiste „KI-Analyse": das Modell liest den aktiven Chart und schlägt
 * Linien, Zonen und Bedingungen vor. Im Chart erscheinen sie gestrichelt als
 * Vorschau; was taugt, wird einzeln (oder alles) in die eigenen Zeichnungen
 * übernommen und ist danach eine ganz normale Linie — verschiebbar, mit
 * Alarm belegbar. Übernehmen und Verwerfen geht hier und per Klick auf die
 * gestrichelte Linie im Chart. „Vorschau erledigt" nimmt die gestrichelten
 * Linien weg; die Analyse bleibt stehen, mit den übernommenen Vorschlägen.
 * „Analyse zurücksetzen" leert den Reiter.
 *
 * Erzeugt wird nur auf Knopfdruck (kostet einen KI-Aufruf); beim Öffnen wird
 * die letzte Analyse für Symbol und Zeiteinheit gelesen, falls es eine gibt.
 */
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { istProfilLinie, istProfilZone } from '../../utils/chart/kiZeichnungen.js'
import {
    kiAnzeige, kiMarken, kiAlle, kiUebernimmtAlle, kiIstUebernommen, setzeKiAnalyse,
    uebernimmKi, verwirfKi, alleKiUebernehmen, schalteKiAlle, kiErledigt, kiZuruecksetzen,
} from '../../stores/chartKi.js'
import KiChat from './KiChat.vue'
import { Symbol, Knopf } from '../basis'
import KiHinweis from '../quellen/KiHinweis.vue'

const props = defineProps({
    panel: { type: Object, required: true },
    // rechter Rand des sichtbaren Bereichs (ms) — für den Chat
    sichtbarBis: { type: Function, default: null },
})
const { t } = useI18n()

/*
 * Analyse oder Chat — eine Frage des Bildschirms, nicht des Layouts, daher im
 * Browser gemerkt. Die Vorschau der Analyse bleibt im Chart stehen, während
 * man chattet: der Chat liest dieselbe Analyse mit.
 */
const MODUS_SCHLUESSEL = 'chartKiModus'
function leseModus() { try { return localStorage.getItem(MODUS_SCHLUESSEL) === 'chat' ? 'chat' : 'analyse' } catch { return 'analyse' } }
const modus = ref(leseModus())
function setzeModus(m) { modus.value = m; try { localStorage.setItem(MODUS_SCHLUESSEL, m) } catch { /* kein Speicher */ } }

/*
 * Was die Analyse liefern soll (Kästchen) — eine Vorliebe, kein Layout-Teil,
 * daher im Browser gemerkt. Abgewähltes bekommt die KI gar nicht zu sehen.
 * Bedingungen und Liquidationszonen sind seit 24.10.2026 fest dabei (ohne
 * Kästchen). Beim Volumenprofil wählt man, worüber es gerechnet wird:
 * Konsolidierungen (Vorgabe), Tage oder Wochen.
 */
const OPTIONEN = ['niveaus', 'trend', 'zonen', 'volumen', 'htf', 'kanal']
const PROFIL_ARTEN = ['konsolidierung', 'tag', 'woche']
const optionen = ref((() => {
    const a = { ...Object.fromEntries(OPTIONEN.map((k) => [k, true])), profilArt: 'konsolidierung' }
    try {
        const roh = JSON.parse(localStorage.getItem('chartKiOptionen') || '{}') || {}
        for (const k of OPTIONEN) if (typeof roh[k] === 'boolean') a[k] = roh[k]
        if (PROFIL_ARTEN.includes(roh.profilArt)) a.profilArt = roh.profilArt
    } catch { /* Vorgabe */ }
    return a
})())
watch(optionen, (v) => { try { localStorage.setItem('chartKiOptionen', JSON.stringify(v)) } catch { /* kein Speicher */ } }, { deep: true })
const keineQuelle = computed(() => !optionen.value.niveaus && !optionen.value.trend && !optionen.value.volumen && !optionen.value.htf && !optionen.value.kanal)
// Zonen entstehen aus Niveaus, Volumenprofil oder höherer Zeiteinheit
const zonenMoeglich = computed(() => optionen.value.niveaus || optionen.value.volumen || optionen.value.htf)

/*
 * Analyse und Zustand der Vorschläge liegen im Speicher `stores/chartKi.js` —
 * der Chart liest denselben Stand (Klick auf eine gestrichelte Linie:
 * Übernehmen/Verwerfen) und zeichnet die Vorschau daraus.
 */
const analyse = kiAnzeige
const laeuft = ref(false)
const fehler = ref('')
const alle = kiAlle
const uebernimmtAlle = kiUebernimmtAlle
const offen = computed(() => !kiMarken.value.erledigt)
const istUebernommen = (x) => kiIstUebernommen(x._key) || ((istProfilLinie(x) || istProfilZone(x)) && kiIstUebernommen('profil'))

/*
 * Jede Antwort gehört zu dem Panel-Stand, für den sie bestellt wurde. Ein Lauf
 * dauert bis zu 2 × 90 s; wer währenddessen das Symbol wechselt, bekam sonst
 * die BTC-Analyse im ETH-Panel — und „Alle übernehmen" legte BTC-Preise als
 * ETH-Zeichnungen an.
 */
const stand = () => `${props.panel.symbol}|${props.panel.interval}|${props.panel.markt === 'spot' ? 'spot' : 'futures'}`
let nr = 0

async function ladeLetzte() {
    const meine = ++nr
    const fuer = stand()
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/chart/ki-analyse', { params: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt } })
        if (meine !== nr || fuer !== stand()) return
        setzeKiAnalyse(data.leer ? null : data)
    } catch { if (meine === nr) setzeKiAnalyse(null) }
}

async function erstelle() {
    const meine = ++nr
    const fuer = stand()
    laeuft.value = true
    fehler.value = ''
    const beginn = Date.now()
    try {
        const { data } = await axios.post('/api/chart/ki-analyse', {
            symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt,
            auswahl: { ...optionen.value, zonen: optionen.value.zonen && zonenMoeglich.value, bedingungen: true, hebel: true },
        })
        // Inzwischen anderes Symbol: verwerfen. Der Server hat sie abgelegt — zurück
        // auf dem alten Symbol zeigt der Reiter sie wieder, ohne neu zu bezahlen.
        if (meine !== nr || fuer !== stand()) return
        setzeKiAnalyse(data)
    } catch (e) {
        // Brach nur der Browser ab, rechnet der Server weiter und legt das Ergebnis ab —
        // dann nachsehen statt einen Fehler für bezahlte Arbeit zu zeigen.
        if (e.code === 'ECONNABORTED' && meine === nr && fuer === stand()) {
            if (await warteAufErgebnis(beginn, meine, fuer)) return
        }
        if (meine === nr && fuer === stand()) fehler.value = e.response?.data?.error || e.message
    } finally {
        laeuft.value = false
    }
}

/** Nach einem Abbruch im Browser bis zu 5 Minuten im Server-Cache nachsehen. */
async function warteAufErgebnis(beginn, meine, fuer) {
    fehler.value = t('chart.ki.dauertLaenger')
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 10_000))
        if (meine !== nr || fuer !== stand()) return true
        try {
            const { data } = await axios.get('/api/chart/ki-analyse', { params: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt } })
            // 30 s Spielraum für eine abweichende Server-Uhr
            if (!data.leer && data.stand >= beginn - 30_000) {
                fehler.value = ''
                setzeKiAnalyse(data)
                return true
            }
        } catch { /* weiter warten */ }
    }
    return false
}

const uebernimm = (x) => uebernimmKi(x._key, props.panel.symbol)
const verwirf = (x) => verwirfKi(x._key)
const alleUebernehmen = () => alleKiUebernehmen(props.panel.symbol)
const schalteAlle = schalteKiAlle
const ZUSTAND = { 1: 'auf', '-1': 'ab', 0: 'offen' }
const struktur = (a) => {
    const s = a?.auswahl
    if (!s?.struktur) return ''
    const br = s.struktur.bruch
    return t('chart.ki.struktur', {
        tf: a.interval, zustand: t('chart.ki.zustand.' + ZUSTAND[s.struktur.zustand]),
        bruch: br ? t('chart.ki.bruch.' + br.richtung, { p: preis(br.marke), zeit: new Date(br.t).toLocaleDateString() }) : '',
        von: s.spanne ? preis(s.spanne.tief) : '—', bis: s.spanne ? preis(s.spanne.hoch) : '—', pos: s.spanne ? Math.round(s.spanne.positionPct) : '—',
    })
}

const zeit = (ms) => (ms ? new Date(ms).toLocaleString() : '')
const preis = (p) => (Math.abs(p) >= 1000 ? p.toFixed(1) : Math.abs(p) >= 1 ? p.toFixed(3) : p.toPrecision(4))

watch(() => [props.panel.symbol, props.panel.interval, props.panel.markt], ladeLetzte, { immediate: true })
</script>

<template>
    <div class="kiReiter">
        <div class="modus" role="group">
            <button type="button" :class="{ an: modus === 'analyse' }" :aria-pressed="modus === 'analyse'" @click="setzeModus('analyse')">
                <Symbol name="linie" /> {{ t('chart.ki.modusAnalyse') }}</button>
            <button type="button" :class="{ an: modus === 'chat' }" :aria-pressed="modus === 'chat'" @click="setzeModus('chat')">
                <Symbol name="nachricht" /> {{ t('chart.ki.modusChat') }}</button>
        </div>
        <KiChat v-if="modus === 'chat'" class="chatFlaeche" :panel="panel" :sichtbar-bis="sichtbarBis" />
        <template v-else>
        <Knopf klein symbol="ki" :laedt="laeuft" :disabled="keineQuelle" class="erstellen" @click="erstelle">
            <template v-if="!laeuft">{{ t('chart.ki.erstellen', { symbol: panel.symbol, tf: panel.interval }) }}</template>
        </Knopf>
        <div class="optionen">
            <label v-for="o in OPTIONEN" :key="o" class="option" :class="{ aus: o === 'zonen' && !zonenMoeglich }" :title="t('chart.ki.optTipp.' + o)">
                <input v-model="optionen[o]" type="checkbox" :disabled="o === 'zonen' && !zonenMoeglich" />
                {{ t('chart.ki.opt.' + o) }}
            </label>
        </div>
        <div v-if="optionen.volumen" class="profilArt" role="group" :aria-label="t('chart.ki.profilArt.titel')">
            <span>{{ t('chart.ki.profilArt.titel') }}</span>
            <button v-for="p in PROFIL_ARTEN" :key="p" type="button" :class="{ an: optionen.profilArt === p }" :aria-pressed="optionen.profilArt === p"
                :title="t('chart.ki.profilArt.tipp.' + p)" @click="optionen.profilArt = p">{{ t('chart.ki.profilArt.' + p) }}</button>
        </div>
        <div v-if="keineQuelle" class="fehler">{{ t('chart.ki.optLeer') }}</div>
        <div class="hinweis">{{ t('chart.ki.hinweis') }}</div>
        <div v-if="fehler" class="fehler">{{ fehler }}</div>

        <template v-if="analyse">
            <div class="kopf">
                <small>{{ zeit(analyse.stand) }} · {{ analyse.provider }}/{{ analyse.model }}<template v-if="analyse.costUsd != null">
                        · {{ analyse.costUsd.toFixed(4) }} $</template></small>
            </div>
            <!-- S12: Pflichtlabel an der KI-Analyse (Text, Bedingungen, Vorschläge). -->
            <KiHinweis klein />
            <div v-if="analyse.auswahl" class="struktur">{{ struktur(analyse) }}</div>
            <p v-if="analyse.text" class="text" data-ki-generiert="true">{{ analyse.text }}</p>

            <div v-if="analyse.bedingungen?.length" class="abschnitt">{{ t('chart.ki.bedingungen') }}</div>
            <div v-for="(b, i) in analyse.bedingungen" :key="'b' + i" class="bedingung" data-ki-generiert="true">
                <b>{{ t('chart.ki.wenn') }}</b> {{ b.wenn }} → {{ b.dann }}<span v-if="b.zielId" class="id">→ {{ b.zielId }}</span>
            </div>

            <div v-if="analyse.linien?.length || analyse.zonen?.length" class="abschnitt">
                {{ t(offen ? 'chart.ki.vorschlaege' : 'chart.ki.eingezeichnet') }}
                <template v-if="offen">
                    <button type="button" class="textKnopf abstandLinks" :disabled="uebernimmtAlle" @click="alleUebernehmen">{{ t('chart.ki.alleUebernehmen') }}</button>
                    <button v-if="analyse.auswahl" class="textKnopf abstandLinks" :class="{ an: alle }" @click="schalteAlle">{{ t(alle ? 'chart.ki.kandidatenAus' : 'chart.ki.kandidatenZeigen') }}</button>
                </template>
            </div>
            <div v-if="offen && (analyse.linien?.length || analyse.zonen?.length)" class="hinweis">{{ t('chart.ki.klickImChart') }}</div>
            <div v-for="l in analyse.linien" :key="l._key" class="vorschlag" data-ki-generiert="true">
                <div class="zeile">
                    <span class="art">{{ t('chart.ki.art.' + l.art) }}</span>
                    <span v-if="l.id" class="id" :class="l.gewicht">{{ l.id }}</span>
                    <span class="label">{{ l.label }}</span>
                    <span class="preis">{{ l.p1 === l.p2 ? preis(l.p1) : `${preis(l.p1)} → ${preis(l.p2)}` }}</span>
                    <span v-if="istUebernommen(l)" class="erledigtMarke" :title="t('chart.ki.uebernommenTitel')">✓</span>
                    <template v-else-if="offen">
                        <button type="button" class="textKnopf" @click="uebernimm(l)">{{ t('chart.ki.uebernehmen') }}</button>
                        <button type="button" class="textKnopf" :title="t('chart.ki.verwerfenTitel')" :aria-label="t('chart.ki.verwerfenTitel')" @click="verwirf(l)">✕</button>
                    </template>
                </div>
                <small>{{ l.grund }}</small>
            </div>
            <div v-for="z in analyse.zonen" :key="z._key" class="vorschlag" data-ki-generiert="true">
                <div class="zeile">
                    <span class="art">{{ t('chart.ki.zone') }}</span>
                    <span v-if="z.ids?.length" class="id" :class="z.gewicht">{{ z.ids.join('+') }}</span>
                    <span class="label">{{ z.label }}</span>
                    <span class="preis">{{ preis(z.tief) }}–{{ preis(z.hoch) }}</span>
                    <span v-if="istUebernommen(z)" class="erledigtMarke" :title="t('chart.ki.uebernommenTitel')">✓</span>
                    <template v-else-if="offen">
                        <button type="button" class="textKnopf" @click="uebernimm(z)">{{ t('chart.ki.uebernehmen') }}</button>
                        <button type="button" class="textKnopf" :title="t('chart.ki.verwerfenTitel')" :aria-label="t('chart.ki.verwerfenTitel')" @click="verwirf(z)">✕</button>
                    </template>
                </div>
                <small>{{ z.grund }}</small>
            </div>
            <div v-if="!offen && !analyse.linien?.length && !analyse.zonen?.length" class="hinweis">{{ t('chart.ki.nichtsEingezeichnet') }}</div>
            <div v-if="analyse.verworfen?.length" class="verworfen">{{ t('chart.ki.verworfen', { n: analyse.verworfen.length }) }}</div>
            <div class="schluss">
                <button v-if="offen" type="button" class="textKnopf" @click="kiErledigt">{{ t('chart.ki.vorschauErledigt') }}</button>
                <button v-else type="button" class="textKnopf" @click="kiZuruecksetzen">{{ t('chart.ki.analyseZuruecksetzen') }}</button>
            </div>
        </template>
        </template>
    </div>
</template>

<style scoped>
.profilArt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    color: var(--muted);
}

.profilArt button {
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
}

.profilArt button.an {
    border-color: var(--accent);
    background: var(--accent-schwach);
    color: var(--text);
}

.kiReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    height: 100%;
    font-size: 12px;
}

.kiReiter:has(.chatFlaeche) {
    overflow: hidden;
}

.optionen {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    flex-shrink: 0;
}

.option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
}

.option input {
    margin: 0;
    width: 12px;
    height: 12px;
}

.option.aus {
    opacity: 0.45;
}

.struktur {
    color: var(--muted);
    font-size: 11px;
}

.id {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--line);
    color: var(--muted);
    margin: 0 2px;
}

.id.stark {
    background: var(--warn-flaeche);
    color: var(--warn);
}

.id.schwach {
    opacity: 0.6;
}

.textKnopf.an {
    font-weight: 600;
}

.abstandLinks {
    margin-left: var(--abstand-2);
}

.erstellen {
    flex-shrink: 0;
}

/* Umschalter Analyse/Chat: zwei gleich breite Segmente. */
.modus {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    overflow: hidden;
}

.modus button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
}

.modus button + button {
    border-left: 1px solid var(--line-stark);
}

.modus button:hover {
    color: var(--text);
}

.modus button.an {
    background: var(--accent-flaeche);
    color: var(--accent);
}

.option input {
    accent-color: var(--accent);
}

/* Text-Knopf: Handlung ohne Fläche, für Zeilen in der dichten Seitenleiste. */
.textKnopf {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
}

.textKnopf:hover:not(:disabled) {
    text-decoration: underline;
}

.textKnopf:disabled {
    opacity: 0.45;
    cursor: default;
}


.hinweis,
.kopf small,
.erledigtMarke {
    color: var(--good);
    font-weight: 600;
}

.schluss {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
    border-top: 1px solid var(--line);
}

.verworfen {
    color: var(--muted);
    font-size: 11px;
}

.fehler {
    color: var(--bad);
}

.text {
    margin: 0;
    line-height: 1.45;
}

.abschnitt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-top: 6px;
}

.bedingung {
    line-height: 1.4;
}

.bedingung b {
    color: var(--accent);
    font-weight: 500;
}

.vorschlag {
    border-left: 2px solid #ab47bc;
    padding-left: 6px;
}

.vorschlag .zeile {
    display: flex;
    gap: 6px;
    align-items: center;
}

.vorschlag .art {
    font-size: 10px;
    color: #ab47bc;
}

.vorschlag .label {
    flex: 1;
}

.vorschlag .preis {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
}

.vorschlag small {
    color: var(--muted);
}
</style>
