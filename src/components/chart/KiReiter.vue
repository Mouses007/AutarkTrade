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
import InfoTipp from '../InfoTipp.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    panel: { type: Object, required: true },
    // rechter Rand des sichtbaren Bereichs (ms) — für den Chat
    sichtbarBis: { type: Function, default: null },
    // linker Rand des sichtbaren Bereichs (ms) — die Analyse rechnet über das, was man sieht
    sichtbarVon: { type: Function, default: null },
    // Leinwand mit dem Bild des Charts — geht als Gegenprüfung an die KI (siehe bildFuerKi)
    bild: { type: Function, default: null },
})
const { t, te } = useI18n()
const emit = defineEmits(['waehle'])

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
 * Zwei Knöpfe statt Kästchen (31.10.2026): „KI-Zeichnungen setzen" — der Code
 * vermisst alles (Niveaus, Trendlinien, Zonen, Volumenprofile je Phase/Tag/Woche,
 * Kanäle, höhere Zeiteinheit), die KI zeichnet nur, was für ein Setup zählt
 * (höchstens 6, auch keine). „Meine Zeichnungen analysieren" — die KI liest den
 * Chart anhand der eigenen Zeichnungen, auf Wunsch mit Korrekturen und Fehlendem.
 */
const ERGAENZEN_SCHLUESSEL = 'chartKiErgaenzen'
const ergaenzen = ref((() => { try { return localStorage.getItem(ERGAENZEN_SCHLUESSEL) !== 'aus' } catch { return true } })())
watch(ergaenzen, (v) => { try { localStorage.setItem(ERGAENZEN_SCHLUESSEL, v ? 'an' : 'aus') } catch { /* kein Speicher */ } })

/*
 * Ein Bild des sichtbaren Charts geht immer mit (seit 31.10.2026 ohne Schalter): die
 * KI legt damit Einspruch ein, wo ein gemessener Kanal oder eine Trendlinie im Bild
 * nicht zu sehen ist. Der Server nimmt es nur, wenn der Anbieter Bilder versteht.
 * Das Bild entsteht ohne Kontowerte (`ohneKontowerte`, seit 01.11.2026): der
 * Positionsrechner zeigt darin nur Liq-Linie und Warnung, Journal-Trades nur R —
 * vorher stand „Einsatz 2.5 % vom Konto" samt USDT-Beträgen im Bild an den Anbieter.
 */
const BILD_BREITE = 1280

/** Leinwand → JPEG (höchstens 1280 px breit), als {mediaType, base64}; ohne Bild null. */
function bildFuerKi() {
    try {
        const quelle = props.bild?.({ ohneKontowerte: true })
        if (!quelle?.width) return null
        const f = Math.min(1, BILD_BREITE / quelle.width)
        const l = document.createElement('canvas')
        l.width = Math.round(quelle.width * f)
        l.height = Math.round(quelle.height * f)
        l.getContext('2d').drawImage(quelle, 0, 0, l.width, l.height)
        const url = l.toDataURL('image/jpeg', 0.82)
        const i = url.indexOf(',')
        return i > 0 ? { mediaType: 'image/jpeg', base64: url.slice(i + 1) } : null
    } catch { return null }
}

/*
 * Analyse und Zustand der Vorschläge liegen im Speicher `stores/chartKi.js` —
 * der Chart liest denselben Stand (Klick auf eine gestrichelte Linie:
 * Übernehmen/Verwerfen) und zeichnet die Vorschau daraus.
 */
const analyse = kiAnzeige
const laeuft = ref(null)       // null | 'setzen' | 'eigene'
const fehler = ref('')
// Marktdaten aus: die Route antwortet 200 `{aus: true, …}` — ein Zustand, keine Analyse (QuelleAus)
const quelleAus = ref(null)
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
    quelleAus.value = null
    try {
        const { data } = await axios.get('/api/chart/ki-analyse', { params: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt } })
        if (meine !== nr || fuer !== stand()) return
        setzeKiAnalyse(data.leer ? null : data)
    } catch { if (meine === nr) setzeKiAnalyse(null) }
}

/** Sichtbarer Bereich des Charts (ms); der Server zählt daraus die Kerzen (150–1000). */
function sichtbarFenster() {
    try {
        const vonT = props.sichtbarVon?.(), bisT = props.sichtbarBis?.()
        return Number.isFinite(vonT) && Number.isFinite(bisT) && bisT > vonT ? { vonT, bisT } : null
    } catch { return null }
}

async function erstelle(modus) {
    const meine = ++nr
    const fuer = stand()
    laeuft.value = modus
    fehler.value = ''
    quelleAus.value = null
    const beginn = Date.now()
    try {
        const { data } = await axios.post('/api/chart/ki-analyse', {
            symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt,
            modus, ergaenzen: ergaenzen.value,
            fenster: sichtbarFenster(),
            bild: bildFuerKi(),
        })
        // Inzwischen anderes Symbol: verwerfen. Der Server hat sie abgelegt — zurück
        // auf dem alten Symbol zeigt der Reiter sie wieder, ohne neu zu bezahlen.
        if (meine !== nr || fuer !== stand()) return
        // `aus: true` streng: bis 01.11.2026 trug auch die Erfolgsantwort ein `aus` ('neu'|'sperre', jetzt
        // `herkunft`), und `{aus: true}` stand als Analyse da („Die KI hat nichts eingezeichnet …").
        // Die vorige Analyse bleibt stehen — die KI wurde gar nicht gefragt.
        if (data?.aus === true) { quelleAus.value = data; return }
        setzeKiAnalyse(data)
    } catch (e) {
        // Brach nur der Browser ab, rechnet der Server weiter und legt das Ergebnis ab —
        // dann nachsehen statt einen Fehler für bezahlte Arbeit zu zeigen.
        if (e.code === 'ECONNABORTED' && meine === nr && fuer === stand()) {
            if (await warteAufErgebnis(beginn, meine, fuer)) return
        }
        if (meine === nr && fuer === stand()) fehler.value = fehlerText(e)
    } finally {
        if (meine === nr) laeuft.value = null
    }
}

/** Zeichnungsarten als „1× Pfeil, 2× Kreis / Ellipse" (Namen wie in der Zeichenleiste). */
const artenText = (liste) => (liste || []).map((x) => `${x.anzahl}× ${te('chart.wz.' + x.typ) ? t('chart.wz.' + x.typ) : x.typ}`).join(', ')

function fehlerText(e) {
    const d = e.response?.data
    if (d?.code === 'keineZeichnungen') return t('chart.ki.keineZeichnungen')
    if (d?.code === 'nurUngemessene') return t('chart.ki.nurUngemessene', { arten: artenText(d.uebergangen) })
    return d?.error || e.message
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
// Eigene Zeichnungen: gemessener Stand (Code) und Bewertung (KI) in einer Zeile, Wichtiges zuerst
const RANG = { hoch: 0, mittel: 1, gering: 2 }
const eigeneZeilen = computed(() => {
    const a = analyse.value
    if (a?.modus !== 'eigene') return []
    const bew = new Map((a.bewertungen || []).map((b) => [b.u, b]))
    return (a.nutzer || []).map((u) => ({ ...u, bewertung: bew.get(u.id) || null }))
        .sort((x, y) => (RANG[x.bewertung?.wichtig] ?? 3) - (RANG[y.bewertung?.wichtig] ?? 3))
})
// Eigene Zeichnungen, die NICHT in der Analyse sind: über 20 hinaus und Arten, die der Code nicht misst
const ausserListe = computed(() => {
    const a = analyse.value
    if (a?.modus !== 'eigene') return ''
    const teile = []
    if (a.nutzerWeggelassen > 0) teile.push(t('chart.ki.weggelassen', { n: a.nutzerWeggelassen }))
    if (a.nutzerUebergangen?.length) teile.push(t('chart.ki.uebergangen', { arten: artenText(a.nutzerUebergangen) }))
    return teile.join(' ')
})
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
        <div class="knoepfe">
            <Knopf klein symbol="ki" :laedt="laeuft === 'setzen'" :disabled="!!laeuft" class="erstellen" @click="erstelle('setzen')">
                {{ t('chart.ki.setzen', { symbol: panel.symbol, tf: panel.interval }) }}</Knopf>
            <Knopf klein symbol="stift" :laedt="laeuft === 'eigene'" :disabled="!!laeuft" class="erstellen" @click="erstelle('eigene')">
                {{ t('chart.ki.eigene') }}</Knopf>
            <div class="optionZeile">
                <label class="option" :title="t('chart.ki.ergaenzenTipp')">
                    <input v-model="ergaenzen" type="checkbox" /> {{ t('chart.ki.ergaenzen') }}
                </label>
                <InfoTipp schluessel="chart.ki.hinweis" breit />
            </div>
        </div>
        <div v-if="fehler" class="fehler">{{ fehler }}</div>
        <QuelleAus v-if="quelleAus" :aus="quelleAus" klein />

        <template v-if="analyse">
            <div class="kopf">
                <small>{{ zeit(analyse.stand) }} · {{ analyse.provider }}/{{ analyse.model }}<template v-if="analyse.costUsd != null">
                        · {{ analyse.costUsd.toFixed(4) }} $</template></small>
            </div>
            <div v-if="analyse.auswahl" class="struktur">{{ struktur(analyse) }}</div>
            <div class="artZeile">{{ t(analyse.modus === 'eigene' ? 'chart.ki.artEigene' : 'chart.ki.artSetzen') }}</div>
            <p v-if="analyse.text" class="text" data-ki-generiert="true">{{ analyse.text }}</p>
            <template v-if="eigeneZeilen.length">
                <div class="abschnitt">{{ t('chart.ki.meineZeichnungen') }}</div>
                <div v-if="ausserListe" class="hinweis">{{ ausserListe }}</div>
                <button v-for="u in eigeneZeilen" :key="u.id" type="button" class="eigene" data-ki-generiert="true"
                    :title="t('chart.ki.markieren')" @click="u.zid != null && emit('waehle', u.zid)">
                    <span class="zeile">
                        <span class="id" :class="u.bewertung?.wichtig === 'hoch' ? 'stark' : u.bewertung?.wichtig === 'gering' ? 'schwach' : 'mittel'">{{ u.id }}</span>
                        <span class="label">{{ u.name }}</span>
                        <span v-if="u.zustand" class="zustand" :class="u.zustand">{{ t('chart.ki.zustandU.' + u.zustand) }}<template
                            v-if="u.zustand === 'gebrochen' && u.rolle"> · {{ t('chart.ki.rolleU.' + u.rolle) }}</template></span>
                    </span>
                    <small v-if="u.bewertung">{{ u.bewertung.text }}</small>
                    <small v-else class="leise">{{ t('chart.ki.ohneBewertung') }}</small>
                    <!-- Fehler oder Unstimmigkeit: was die KI dazu sagt, sonst was der Code gemessen hat -->
                    <small v-if="u.bewertung?.hinweis || u.auffaellig?.length" class="achtung">
                        {{ t('chart.ki.achtung') }} {{ u.bewertung?.hinweis || u.auffaellig.join(' · ') }}</small>
                </button>
            </template>
            <div v-if="analyse.korrekturen?.length" class="abschnitt">{{ t('chart.ki.korrekturen') }}</div>
            <div v-for="k in analyse.korrekturen" :key="k._key" class="vorschlag" data-ki-generiert="true">
                <div class="zeile">
                    <span class="art">{{ t('chart.ki.korrektur') }}</span>
                    <span class="id">{{ k.u }} → {{ k.id }}</span>
                    <span class="label">{{ k.name }}</span>
                    <span v-if="istUebernommen(k)" class="erledigtMarke" :title="t('chart.ki.uebernommenTitel')">✓</span>
                    <template v-else-if="offen">
                        <button type="button" class="textKnopf" @click="uebernimm(k)">{{ t('chart.ki.korrigieren') }}</button>
                        <button type="button" class="textKnopf" :title="t('chart.ki.verwerfenTitel')" :aria-label="t('chart.ki.verwerfenTitel')" @click="verwirf(k)">✕</button>
                    </template>
                </div>
                <small>{{ k.grund }}<template v-if="k.abstandAtr != null"> ({{ t('chart.ki.daneben', { atr: k.abstandAtr.toFixed(1) }) }})</template></small>
            </div>
            <div v-if="analyse.einwaende?.length" class="abschnitt">{{ t('chart.ki.einwaende') }}</div>
            <div v-for="e in analyse.einwaende" :key="'e' + e.id" class="einwand" data-ki-generiert="true">
                <span class="id">{{ e.id }}</span> <s>{{ e.name }}</s><small v-if="e.grund"> — {{ e.grund }}</small>
            </div>
            <div v-if="['anbieterOhneBild', 'fehlgeschlagen'].includes(analyse.bildPruefung)" class="hinweis">{{ t('chart.ki.bildStatus.' + analyse.bildPruefung, { anbieter: analyse.provider }) }}</div>

            <div v-if="analyse.bedingungen?.length" class="abschnitt">{{ t('chart.ki.bedingungen') }}</div>
            <div v-for="(b, i) in analyse.bedingungen" :key="'b' + i" class="bedingung" data-ki-generiert="true">
                <b>{{ t('chart.ki.wenn') }}</b> {{ b.wenn }} → {{ b.dann }}<span v-if="b.zielId" class="id">→ {{ b.zielId }}</span>
            </div>

            <div v-if="analyse.linien?.length || analyse.zonen?.length" class="abschnitt">
                {{ t(offen ? (analyse.modus === 'eigene' ? 'chart.ki.fehlend' : 'chart.ki.vorschlaege') : 'chart.ki.eingezeichnet') }}
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
            <div v-if="offen && analyse.modus !== 'eigene' && !analyse.linien?.length && !analyse.zonen?.length" class="hinweis">{{ t('chart.ki.keinSetup') }}</div>
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
.einwand {
    font-size: 12px;
    color: var(--muted);
    padding: 2px 0;
}
.einwand s {
    color: var(--text);
}
.knoepfe {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    flex-shrink: 0;
}

.artZeile {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.eigene {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
}

.eigene:hover {
    border-color: var(--accent);
}

.eigene .zeile {
    display: flex;
    align-items: center;
    gap: 4px;
}

.eigene .zustand {
    margin-left: auto;
    font-size: 10px;
    color: var(--muted);
}

.eigene .zustand.gebrochen {
    color: var(--warn);
}

.eigene .zustand.haelt {
    color: var(--good);
}

.eigene .zustand.drehpunkt {
    color: var(--muted);
}

.eigene .achtung {
    color: var(--warn);
}

.eigene .leise {
    color: var(--muted);
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

.optionZeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
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
