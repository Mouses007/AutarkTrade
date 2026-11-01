<script setup>
/**
 * Regel-Editor einer eigenen Strategie (Bibliothek, /strategien/bibliothek/:id).
 *
 * Bis 01.11.2026 die Seite „Strategie-Editor" mit Vorlagen und Liste; die
 * stehen jetzt in der Bibliothek. Hier bleibt das Bearbeiten: Regeln in
 * Sätzen oben, die Bausteine darunter in der Reihenfolge der Sätze, ein
 * KI-Chat, dessen Änderungen als Vorschlag kommen, und ein Test, der den
 * ENTWURF rechnet (nicht den gespeicherten Stand).
 *
 * Der Chat ist derselbe wie früher auf der Seite „Neue Strategie" (mit
 * Anhängen: Text, Bilder, PDF je nach Anbieter). Mit `start.beschreiben`
 * beginnt der Editor NUR mit dem Gespräch: erst der übernommene Vorschlag
 * macht daraus ein Regelwerk mit Namen. Das Gespräch hängt an der Strategie
 * (`strategy_drafts.strategyId`) und ist beim nächsten Öffnen wieder da.
 *
 * Hier entstehen Strategien ohne eine Zeile Code: Bausteine zusammenstellen,
 * prüfen lassen, backtesten. Der Server führt die Beschreibung mit einem festen
 * Interpreter aus — es wird nichts erzeugt und nichts ausgewertet, was von hier
 * kommt.
 *
 * Der Aufbau folgt dem Lebenslauf eines Setups, weil Strategien so gedacht
 * werden: Was löst aus? Was muss dabei stimmen? Wann steige ich ein? Was bricht
 * ab? Wo liegen Stop und Ziel?
 */
import { ref, computed, onBeforeMount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import ZahlOderParam from '../ZahlOderParam.vue'
import StrategieChart from './StrategieChart.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../basis'
import { logError } from '../../utils/logger.js'
import { apiFehlerText } from '../../utils/apiError.js'
import { ausBacktest } from '../../../shared/strategieChart.js'

const props = defineProps({
    // { id?, strategyId, name, description, rules, beschreiben?, gespraech?: {draftId, verlauf} }
    // — ohne id ist es neu
    start: { type: Object, required: true },
})
const emit = defineEmits(['gespeichert', 'zurueck'])
const { t } = useI18n()

const bausteine = ref({ indikatoren: [], signale: [], einstieg: [], vergleiche: [], anker: [], ziele: [],
    vwapAnker: [], muster: [] })

/** VWAP-Anker als Klartext. Schlüssel: vwapAnchorSession, vwapAnchorSwingHigh, … */
const ankerLabel = (a) => t('strategies.vwapAnchor' + a.charAt(0).toUpperCase() + a.slice(1))
const meldung = ref('')
const fehler = ref('')
const pruefung = ref(null)

const entwurf = ref(JSON.parse(JSON.stringify(props.start)))
const istNeu = ref(!props.start.id)
const speichert = ref(false)

// ── Backtest direkt aus dem Editor ──────────────────────────────────────
const test = ref({ symbol: 'BTCUSDT', timeframe: props.start.rules?.timeframes?.[0] || '1h', tage: 180 })
const testLaeuft = ref(false)
const testErgebnis = ref(null)
// Marktdaten abgeschaltet: der Server antwortet 200 mit `{ aus: true, … }`.
// Das ist kein Testergebnis — als solches gelesen stürzte die Vorlage an
// `stats.trades` ab, und der Editor samt ungespeichertem Entwurf verschwand
// (BUG-F5-001). Es gehört in den QuelleAus-Kasten, wie im Labor.
const testAus = ref(null)

const ZEITEINHEITEN = ['5m', '15m', '30m', '1h', '4h', '1d']

// ── Im Gespräch bauen, direkt im Editor ─────────────────────────────────
// Derselbe Endpunkt wie die Seite „Neue Strategie", aber die Antwort landet
// im offenen Regelwerk statt in einem eigenen Entwurf. Der Gewinn ist nicht
// der Chat — den gab es schon —, sondern dass man SIEHT, welches Feld ein
// Satz verändert hat.
// Die Sätze sind die Hauptansicht; die Bausteine klappen darunter auf. Eine
// neue Strategie beginnt offen — dort wird gebaut, nicht gelesen. (Bis
// 01.11.2026 ein Umschalter Einfach/Experte, der Fehler in versteckten
// Bausteinen meldete.)
const bausteineOffen = ref(!props.start.id)
const chatOffen = ref(true)
const chatVerlauf = ref([])
const chatEingabe = ref('')
const chatLaeuft = ref(false)
const chatFehler = ref('')
const chatFragen = ref([])
const chatNichtUmsetzbar = ref([])
const chatGeaendert = ref([])
const chatDraftId = ref(props.start.gespraech?.draftId || 0)
if (props.start.gespraech?.verlauf) chatVerlauf.value = [...props.start.gespraech.verlauf]
const saetze = ref([])
const vorschlag = ref(null)     // { regeln, geaendert } — Antwort des Chats, noch nicht übernommen

// „Beschreiben": bis zum ersten übernommenen Vorschlag gibt es nur das
// Gespräch — ein leeres Gerüst daneben würde wie eine fertige Regel aussehen.
const nurGespraech = ref(Boolean(props.start.beschreiben))

async function vorschlagUebernehmen() {
    if (!vorschlag.value) return
    const neu = vorschlag.value.regeln
    chatGeaendert.value = vorschlag.value.geaendert
    entwurf.value.rules = neu
    // Name und Kurzname gehören dem Nutzer — vergibt er keine, nimmt die
    // Strategie die des Modells (Kurzname nur, solange sie neu ist).
    if (!entwurf.value.name) entwurf.value.name = neu.name || ''
    if (istNeu.value && !entwurf.value.strategyId) entwurf.value.strategyId = neu.id || ''
    if (!entwurf.value.description) entwurf.value.description = neu.description || ''
    vorschlag.value = null
    if (nurGespraech.value) nurGespraech.value = false
    else bausteineOffen.value = true
    await pruefen()
}
function vorschlagVerwerfen() { vorschlag.value = null }

/** Welche Abschnitte des Regelwerks hat die Antwort angefasst? */
function abschnitteDiff(alt, neu) {
    const schluessel = new Set([...Object.keys(alt || {}), ...Object.keys(neu || {})])
    const raus = []
    for (const k of schluessel) {
        if (JSON.stringify(alt?.[k]) !== JSON.stringify(neu?.[k])) raus.push(k)
    }
    return raus
}

/** Hebt einen Formularblock hervor, wenn die letzte Antwort ihn angefasst hat. */
function chatBetrifft(schluessel) {
    const liste = Array.isArray(schluessel) ? schluessel : [schluessel]
    return liste.some((k) => chatGeaendert.value.includes(k))
}

/** Beim Wechsel des Regelwerks gehoert das Gespraech zurueckgesetzt — sonst
 *  bezieht sich der Verlauf auf eine andere Strategie als die offene. */
function chatZuruecksetzen() {
    chatVerlauf.value = []
    chatFragen.value = []
    chatNichtUmsetzbar.value = []
    chatGeaendert.value = []
    chatFehler.value = ''
    chatEingabe.value = ''
    chatDraftId.value = 0
}

// ── Anhänge: Text immer, Bilder und PDF nur, wenn der Anbieter sie liest ──
const faehigkeiten = ref({ provider: '', model: '', pdf: false, image: false })
const anhaenge = ref([])
const anhangFeld = ref(null)
const MAX_BYTES = 8 * 1024 * 1024
const erlaubteTypen = computed(() => {
    const x = ['.txt', '.md', '.json', '.csv']
    if (faehigkeiten.value.image) x.push('image/png', 'image/jpeg', 'image/webp')
    if (faehigkeiten.value.pdf) x.push('.pdf')
    return x.join(',')
})
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB')

/** Datei → base64 (ohne den `data:`-Präfix, den die Anbieter nicht wollen). */
function alsBase64(datei) {
    return new Promise((resolve, reject) => {
        const leser = new FileReader()
        leser.onload = () => resolve(String(leser.result).split(',')[1] || '')
        leser.onerror = reject
        leser.readAsDataURL(datei)
    })
}

async function dateienGewaehlt(ereignis) {
    chatFehler.value = ''
    for (const datei of [...ereignis.target.files].slice(0, 10)) {
        const typ = datei.type || ''
        if (datei.size > MAX_BYTES) { chatFehler.value = t('strategies.fileTooBig', { name: datei.name }); continue }
        if (typ === 'application/pdf' && !faehigkeiten.value.pdf) {
            chatFehler.value = t('strategies.pdfUnsupported', { provider: faehigkeiten.value.provider }); continue
        }
        if (typ.startsWith('image/') && !faehigkeiten.value.image) {
            chatFehler.value = t('strategies.imageUnsupported', { provider: faehigkeiten.value.provider }); continue
        }
        anhaenge.value.push({ name: datei.name, mediaType: typ || 'text/plain', groesse: datei.size, base64: await alsBase64(datei) })
    }
    ereignis.target.value = ''
}
const anhangWeg = (i) => anhaenge.value.splice(i, 1)

function frageUebernehmen(frage) {
    chatEingabe.value = chatEingabe.value ? `${chatEingabe.value}\n${frage} ` : `${frage} `
}

async function chatSenden() {
    const text = chatEingabe.value.trim()
    if ((!text && !anhaenge.value.length) || chatLaeuft.value) return
    chatLaeuft.value = true
    chatFehler.value = ''
    chatVerlauf.value.push({ role: 'user', content: text || `[${anhaenge.value.map((a) => a.name).join(', ')}]` })
    const gesendet = text
    const mit = anhaenge.value
    chatEingabe.value = ''

    try {
        const r = await axios.post('/api/strategies/builder/rules/chat', {
            draftId: chatDraftId.value,
            // Die gespeicherte Strategie findet ihr Gespräch auch ohne draftId.
            strategyId: istNeu.value ? '' : entwurf.value.strategyId,
            message: gesendet,
            attachments: mit.map((a) => ({ name: a.name, mediaType: a.mediaType, base64: a.base64 })),
            // Der aktuelle Stand geht mit, sonst überschreibt die Antwort
            // stillschweigend, was gerade von Hand geändert wurde. Beim
            // Beschreiben gibt es noch keinen — das leere Gerüst ist keiner.
            rules: nurGespraech.value ? null : (entwurf.value?.rules || null),
        })
        anhaenge.value = []
        chatVerlauf.value.push({ role: 'assistant', content: r.data.antwort })
        chatFragen.value = r.data.offeneFragen || []
        chatNichtUmsetzbar.value = r.data.nichtUmsetzbar || []
        chatDraftId.value = r.data.draftId || chatDraftId.value

        if (r.data.regeln) {
            // Als VORSCHLAG — übernommen wird erst auf Knopfdruck. Bis
            // 01.11.2026 ersetzte die Antwort sofort das Regelwerk, ohne
            // Rückweg. Name und Kurzname gehören dem Nutzer, die bleiben.
            vorschlag.value = { regeln: r.data.regeln, geaendert: abschnitteDiff(entwurf.value.rules, r.data.regeln) }
        } else {
            vorschlag.value = null
        }
    } catch (e) {
        chatFehler.value = apiFehlerText(e, t('strategies.builderFailed'), t)
        chatVerlauf.value.pop()
        chatEingabe.value = gesendet
        anhaenge.value = mit
    } finally {
        chatLaeuft.value = false
    }
}

async function laden() {
    try {
        const b = await axios.get('/api/strategies/rules/blocks')
        bausteine.value = b.data.bausteine
    } catch (e) {
        logError('RegelEditor', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

// Betroffene Instanzen: eine Regeländerung gilt ab sofort für jede laufende
// Instanz dieser Strategie (neue Version) — das soll man VOR dem Speichern wissen.
const instanzen = ref([])
onBeforeMount(async () => {
    await laden()
    if (!nurGespraech.value) await pruefen()
    const [inst, f, g] = await Promise.all([
        axios.get('/api/strategies/instances').catch(() => ({ data: [] })),
        axios.get('/api/strategies/builder/capabilities').catch(() => ({ data: null })),
        props.start.id && !props.start.gespraech
            ? axios.get('/api/strategies/builder/drafts', { params: { strategyId: props.start.strategyId } }).catch(() => ({ data: [] }))
            : { data: [] },
    ])
    instanzen.value = inst.data || []
    if (f.data) faehigkeiten.value = f.data
    const gespraech = g.data?.[0]
    if (gespraech && !chatVerlauf.value.length) {
        chatDraftId.value = gespraech.id
        chatVerlauf.value = gespraech.messages || []
    }
})
const betroffene = computed(() => instanzen.value.filter((i) => i.strategyId === entwurf.value.strategyId && !Number(i.archiviert)))
const speicherFrage = ref(false)

/** Alle Referenzen, die in einem Vergleich stehen dürfen. */
const referenzen = computed(() => [
    ...(bausteine.value.anker || []),
    ...(entwurf.value?.rules.indicators || []).map((i) => i.id),
])

const parameterNamen = computed(() => (entwurf.value?.rules.params || []).map((p) => p.key))

/** Prüfung ohne Speichern — zeigt Fehler, während man baut. */
async function pruefen() {
    if (!entwurf.value) return
    try {
        const r = await axios.post('/api/strategies/rules/validate', {
            rules: { ...entwurf.value.rules, id: entwurf.value.strategyId || 'entwurf', name: entwurf.value.name },
        })
        pruefung.value = r.data
        saetze.value = r.data.saetze || []
    } catch (e) {
        pruefung.value = null
        saetze.value = []
    }
}

// ── Bausteine hinzufügen und entfernen ──────────────────────────────────
const r = () => entwurf.value.rules

function indikatorHinzu() {
    const n = r().indicators.length + 1
    r().indicators.push({ id: `ema${n}`, type: 'ema', period: 20 })
    pruefen()
}
const indikatorWeg = (i) => { r().indicators.splice(i, 1); pruefen() }

function paramHinzu() {
    r().params.push({ key: `wert${r().params.length + 1}`, type: 'number', label: '', default: 1, min: 0, max: 100, step: 0.1 })
    pruefen()
}
const paramWeg = (i) => { r().params.splice(i, 1); pruefen() }

function bedingungHinzu(liste) {
    if (!Array.isArray(r()[liste])) r()[liste] = []
    r()[liste].push({ left: 'close', op: 'gt', right: referenzen.value[0] || 'close', code: '' })
    pruefen()
}
const bedingungWeg = (l, i) => { r()[l].splice(i, 1); pruefen() }

function abbruchHinzu(typ) {
    if (typ === 'timeout') r().invalidations.push({ type: 'timeout', code: 'zu_lang', candles: 20 })
    else r().invalidations.push({ type: 'condition', code: 'abbruch', when: { op: 'isBullish' } })
    pruefen()
}
const abbruchWeg = (i) => { r().invalidations.splice(i, 1); pruefen() }

const zeiteinheitAn = (tf) => {
    const l = r().timeframes
    const i = l.indexOf(tf)
    if (i >= 0) l.splice(i, 1); else l.push(tf)
    pruefen()
}

/** Referenz kann Text (Anker/Indikator) oder Parameter sein. */
function refText(ref) {
    if (ref && typeof ref === 'object') return ref.param ? `param:${ref.param}` : String(ref.value ?? '')
    return String(ref ?? '')
}
function refSetzen(obj, feld, wert) {
    obj[feld] = wert.startsWith('param:') ? { param: wert.slice(6) } : wert
    pruefen()
}

// ── Speichern, Kopieren, Löschen ────────────────────────────────────────
async function sichern(bestaetigt = false) {
    if (!istNeu.value && betroffene.value.length && !bestaetigt) { speicherFrage.value = true; return }
    speicherFrage.value = false
    speichert.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = {
            strategyId: entwurf.value.strategyId,
            name: entwurf.value.name,
            description: entwurf.value.description,
            rules: entwurf.value.rules,
        }
        if (istNeu.value) {
            const a = await axios.post('/api/strategies/rules', { ...daten, entwurfId: chatDraftId.value || 0 })
            entwurf.value.id = a.data.id
            istNeu.value = false
            meldung.value = t('strategies.editorSaved', { id: a.data.strategyId })
        } else {
            const a = await axios.put(`/api/strategies/rules/${entwurf.value.id}`, daten)
            meldung.value = a.data.betroffeneInstanzen
                ? t('strategien.editor.gespeichertInstanzen', { n: a.data.betroffeneInstanzen })
                : t('strategies.saved')
        }
        emit('gespeichert', { id: entwurf.value.id, strategyId: entwurf.value.strategyId })
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichert.value = false
    }
}

// ── Test ────────────────────────────────────────────────────────────────
// Der Wert liegt nicht nur in den gehandelten Trades, sondern in den
// VERWORFENEN Setups: sie zeigen, wo die Regel angesprungen ist und warum
// daraus nichts wurde. Derselbe Chart wie im Arbeitsplatz (StrategieChart).
const testDaten = computed(() => (testErgebnis.value ? ausBacktest(testErgebnis.value) : null))

async function testen() {
    testLaeuft.value = true
    fehler.value = ''
    testErgebnis.value = null
    testAus.value = null
    try {
        const toTs = Date.now()
        // Der ENTWURF wird gerechnet, nicht die gespeicherte Fassung — bis
        // 01.11.2026 blieben ungespeicherte Änderungen still ungetestet.
        const a = await axios.post('/api/strategies/backtest', {
            strategyId: entwurf.value.strategyId || 'entwurf',
            rules: { ...entwurf.value.rules, id: entwurf.value.strategyId || 'entwurf', name: entwurf.value.name },
            symbol: test.value.symbol.toUpperCase(),
            timeframe: test.value.timeframe,
            fromTs: toTs - Number(test.value.tage) * 86400000,
            toTs,
            startEquity: 1000,
            label: entwurf.value.name,
            risk: { cooldownMinutes: 0, minRR: 0 },
            save: false,
        })
        if (a.data?.aus) testAus.value = a.data
        else testErgebnis.value = a.data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        testLaeuft.value = false
    }
}

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
const sortiert = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])
</script>

<template>
    <div class="regelEditor">
        <div class="seiteInnen">
            <div class="kopf">
                <Knopf klein art="leise" symbol="pfeilLinks" @click="emit('zurueck')">{{ t('strategien.bibliothek.titel') }}</Knopf>
                <h5 class="seitenTitel">{{ entwurf.name || t(nurGespraech ? 'strategien.bibliothek.neu' : 'strategies.emptyStrategy') }}</h5>
            </div>
            <Hinweis v-if="meldung" art="info" class="abstandUnten">{{ meldung }}</Hinweis>
            <Hinweis v-if="fehler" art="fehler" class="abstandUnten">{{ fehler }}</Hinweis>

            <!-- ══ Editor ══ -->
            <template v-if="entwurf">
                <div class="journalKarte karte">
                    <template v-if="nurGespraech">
                        <p class="fein abstandUnten1">{{ t('strategies.builderIntro') }}</p>
                        <p class="fein at-gedaempft abstandUnten">
                            <Symbol name="schildHaken" class="vorSymbol" />{{ t('strategies.builderSafety') }}
                        </p>
                    </template>
                    <div v-if="!nurGespraech" class="raster abstandUnten3">
                        <div class="b3">
                            <label class="at-label">{{ t('strategies.shortName') }}</label>
                            <input v-model="entwurf.strategyId" class="at-feld klein"
                                :disabled="!istNeu" placeholder="meine_strategie" @change="pruefen" />
                        </div>
                        <div class="b4">
                            <label class="at-label">{{ t('strategies.name') }}</label>
                            <input v-model="entwurf.name" class="at-feld klein" @change="pruefen" />
                        </div>
                        <div class="b5">
                            <label class="at-label">{{ t('strategies.descriptionLabel') }}</label>
                            <input v-model="entwurf.description" class="at-feld klein" />
                        </div>
                        <div class="b6">
                            <label class="at-label">{{ t('strategies.timeframes') }}</label>
                            <div class="chips">
                                <button v-for="tf in ZEITEINHEITEN" :key="tf" type="button"
                                    :class="['tfChip', { an: entwurf.rules.timeframes.includes(tf) }]"
                                    @click="zeiteinheitAn(tf)">{{ tf }}</button>
                            </div>
                        </div>
                        <div class="b3">
                            <label class="at-label">{{ t('strategies.direction') }}</label>
                            <select v-model="entwurf.rules.direction" class="at-feld klein" @change="pruefen">
                                <option value="long">Long</option>
                                <option value="short">Short</option>
                                <!-- Beide: die Erkennung läuft je Richtung einmal.
                                     Kostet doppelte Rechenzeit, spart die
                                     Zwillingsstrategie. -->
                                <option value="both">{{ t('strategies.directionBoth') }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- ══ Was diese Strategie tut ══ -->
                    <div v-if="saetze.length && !nurGespraech" class="saetzeKarte abstandUnten3">
                        <div class="zeileMitSymbol">
                            <Symbol name="buch" />
                            <strong class="fein">{{ t('strategies.rulesInWords') }}</strong>
                        </div>
                        <div v-for="s in saetze" :key="s.titel" class="satzZeile">
                            <span class="satzTitel">{{ s.titel }}</span>
                            <span>{{ s.text }}</span>
                        </div>
                        <p class="fussnote">{{ t('strategies.rulesInWordsHint') }}</p>
                    </div>

                    <!-- ══ Im Gespräch bauen ══
                         Der Chat sitzt bewusst IM Editor: er schreibt in
                         dasselbe Regelwerk, das die Felder darunter zeigen.
                         Vorher lagen Gespräch und Formular auf zwei Seiten —
                         man sah nie, was ein Satz eigentlich verändert hat. -->
                    <div class="chatPanel abstandUnten3">
                        <div class="zeileMitSymbol">
                            <Symbol name="nachricht" class="chatIcon" />
                            <strong>{{ t('strategies.chatTitle') }}</strong>
                            <Pille v-if="chatGeaendert.length" ton="akzent">
                                {{ t('strategies.chatChanged', { n: chatGeaendert.length }) }}
                            </Pille>
                            <Pille v-if="faehigkeiten.provider" ton="neutral" class="rechts">{{ faehigkeiten.provider }}<template v-if="faehigkeiten.model"> · {{ faehigkeiten.model }}</template></Pille>
                            <Knopf v-if="!nurGespraech" klein @click="chatOffen = !chatOffen">
                                {{ chatOffen ? t('strategies.chatHide') : t('strategies.chatShow') }}
                            </Knopf>
                        </div>

                        <template v-if="chatOffen || nurGespraech">
                            <p v-if="!nurGespraech" class="block-hint">{{ t('strategies.chatHint') }}</p>

                            <div v-if="chatVerlauf.length" class="chatVerlauf abstandUnten">
                                <div v-for="(m, i) in chatVerlauf" :key="i"
                                    :class="['chatZeile', m.role === 'user' ? 'chatNutzer' : 'chatModell']"
                                    :data-ki-generiert="m.role === 'user' ? null : 'true'">
                                    {{ m.content }}
                                </div>
                            </div>

                            <!-- Rückfragen: anklickbar, damit man sie direkt beantwortet
                                 statt sie abzutippen. -->
                            <div v-if="chatFragen.length" class="abstandUnten">
                                <div class="fein at-gedaempft abstandUnten1">{{ t('strategies.chatOpenQuestions') }}</div>
                                <div class="fragen">
                                    <Knopf v-for="(f, i) in chatFragen" :key="i" klein class="frageKnopf"
                                        @click="frageUebernehmen(f)">{{ f }}</Knopf>
                                </div>
                            </div>

                            <!-- Was sich mit den Bausteinen nicht ausdrücken lässt.
                                 Muss stehen bleiben: sonst hält man eine Lücke für
                                 umgesetzt. -->
                            <Hinweis v-if="chatNichtUmsetzbar.length" art="warn" class="abstandUnten"
                                :titel="t('strategies.chatNotExpressible')">
                                <ul class="punkte">
                                    <li v-for="(n, i) in chatNichtUmsetzbar" :key="i">{{ n }}</li>
                                </ul>
                            </Hinweis>

                            <Hinweis v-if="chatFehler" art="fehler" class="abstandUnten">{{ chatFehler }}</Hinweis>

                            <!-- Vorschlag des Chats: erst übernehmen, dann gilt er. -->
                            <div v-if="vorschlag" class="vorschlagKasten abstandUnten">
                                <div class="zeileMitSymbol">
                                    <Symbol name="idee" />
                                    <strong class="fein">{{ t('strategien.editor.vorschlag', { n: vorschlag.geaendert.length }) }}</strong>
                                </div>
                                <div class="chips">
                                    <Pille v-for="k in vorschlag.geaendert" :key="k" ton="neutral">{{ t('strategien.editor.abschnitt.' + k, k) }}</Pille>
                                </div>
                                <div class="knopfZeile">
                                    <Knopf art="haupt" klein @click="vorschlagUebernehmen">{{ t('strategien.editor.uebernehmen') }}</Knopf>
                                    <Knopf klein @click="vorschlagVerwerfen">{{ t('strategien.editor.verwerfen') }}</Knopf>
                                </div>
                            </div>

                            <div v-if="anhaenge.length" class="chips abstandUnten1">
                                <Pille v-for="(a, i) in anhaenge" :key="i" ton="neutral" symbol="anhang"
                                    class="klickZiel" @click="anhangWeg(i)">
                                    {{ a.name }} ({{ kb(a.groesse) }}) <Symbol name="schliessen" />
                                </Pille>
                            </div>
                            <div class="chatEingabe">
                                <input ref="anhangFeld" type="file" multiple :accept="erlaubteTypen" class="versteckt"
                                    @change="dateienGewaehlt" />
                                <Knopf klein nurSymbol symbol="anhang" :titel="t('strategies.attach')"
                                    :disabled="chatLaeuft" @click="anhangFeld?.click()" />
                                <textarea v-model="chatEingabe" class="at-feld klein" :rows="nurGespraech ? 4 : 2"
                                    :placeholder="t(nurGespraech ? 'strategies.rulesPlaceholder' : 'strategies.chatPlaceholder')"
                                    :disabled="chatLaeuft"
                                    @keydown.enter.exact.prevent="chatSenden"></textarea>
                                <Knopf art="haupt" klein :disabled="chatLaeuft || (!chatEingabe.trim() && !anhaenge.length)"
                                    @click="chatSenden">
                                    <Kreisel v-if="chatLaeuft" still />
                                    <span v-else>{{ t('strategies.chatSend') }}</span>
                                </Knopf>
                            </div>
                            <small v-if="faehigkeiten.provider" class="at-gedaempft">
                                {{ t('strategies.acceptedFiles') }}:
                                {{ t('strategies.text') }}<template v-if="faehigkeiten.image">, {{ t('strategies.images') }}</template>
                                <template v-if="faehigkeiten.pdf">, PDF</template>
                                <template v-else> — {{ t('strategies.noPdfHere', { provider: faehigkeiten.provider }) }}</template>
                            </small>
                        </template>
                    </div>

                    <template v-if="!nurGespraech">
                    <!-- Prüfung -->
                    <Hinweis v-if="pruefung && !pruefung.ok" art="warn" class="abstandUnten3"
                        :titel="t('strategies.notYetValid')">
                        <ul class="punkte">
                            <li v-for="(f, i) in pruefung.fehler" :key="i">{{ f }}</li>
                        </ul>
                    </Hinweis>
                    <div v-else-if="pruefung?.hinweise?.length" class="kasten abstandUnten3">
                        <ul class="punkte"><li v-for="(h, i) in pruefung.hinweise" :key="i">{{ h }}</li></ul>
                    </div>

                    <!-- ══ Bausteine — in der Reihenfolge der Sätze ══ -->
                    <button type="button" class="bausteinKopf" :aria-expanded="bausteineOffen" @click="bausteineOffen = !bausteineOffen">
                        <Symbol :name="bausteineOffen ? 'runter' : 'pfeilRechts'" />
                        {{ t('strategien.editor.bausteine') }}
                    </button>
                    <div v-if="bausteineOffen" class="bausteine">
                    <!-- ── 2. Indikatoren ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('indicators') }">
                        <div class="block-title">
                            <span class="nr">1</span>{{ t('strategies.blockIndicators') }}
                            <Knopf klein class="rechts" @click="indikatorHinzu">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockIndicatorsHint') }}</p>
                        <div v-for="(ind, i) in entwurf.rules.indicators" :key="i" class="raster eng eintrag">
                            <div class="b4 m3"><input v-model="ind.id" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b3 m3">
                                <select v-model="ind.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="x in bausteine.indikatoren" :key="x" :value="x">{{ t('strategies.ind_' + x) }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <!-- VWAP braucht statt einer Periode einen Anker; das Band
                                     zusätzlich den Faktor der Standardabweichung. -->
                                <template v-if="['vwap','vwapBand'].includes(ind.type)">
                                    <div class="reihe">
                                        <select v-model="ind.anchor" class="at-feld klein" @change="pruefen">
                                            <option v-for="a in (bausteine.vwapAnker || [])" :key="a" :value="a">
                                                {{ ankerLabel(a) }}
                                            </option>
                                        </select>
                                        <input v-if="ind.anchor === 'rolling'" v-model.number="ind.period" type="number" min="2"
                                            class="at-feld klein" style="max-width:5rem" @change="pruefen" />
                                        <!-- Swing-Anker: Pivot-Stärke und welche Fächerlinie gemeint ist.
                                             Ohne diese Felder hinge die Linie stumm auf ihren Vorgaben. -->
                                        <template v-if="['swingHigh','swingLow'].includes(ind.anchor)">
                                            <ZahlOderParam :ziel="ind" feld="pivot" :standard="20"
                                                :titel="t('strategies.vwapPivot')" :params="parameterNamen" @aendern="pruefen" />
                                            <select v-model.number="ind.nth" class="at-feld klein"
                                                style="max-width:5rem" :title="t('strategies.vwapNth')" @change="pruefen">
                                                <option v-for="n in [1,2,3]" :key="n" :value="n">{{ n }}.</option>
                                            </select>
                                        </template>
                                        <select v-if="ind.type === 'vwapBand'" class="at-feld klein"
                                            style="max-width:7rem" :value="refText(ind.mult)"
                                            :title="t('strategies.vwapMultHint')"
                                            @change="refSetzen(ind, 'mult', $event.target.value)">
                                            <option v-for="m in [1,1.5,2,2.5,3,-1,-1.5,-2,-2.5,-3]" :key="m" :value="String(m)">{{ m }}σ</option>
                                            <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                        </select>
                                    </div>
                                </template>
                                <!-- Die Tageseröffnung hat keine Einstellung — ein
                                     Periodenfeld daneben wäre eine Lüge. -->
                                <template v-else-if="ind.type === 'dayOpen'">
                                    <span class="at-gedaempft fein">{{ t('strategies.noSetting') }}</span>
                                </template>
                                <!-- MACD, Bollinger und Stochastik haben eigene
                                     Kennzahlen. Die Engine liest sie längst
                                     (rule-engine.js baueIndikatoren) — ohne
                                     Felder blieben sie stumm auf ihren
                                     Standardwerten stehen, ohne dass man es
                                     sieht. -->
                                <template v-else-if="['macd','macdSignal','macdHist'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="fast" :standard="12"
                                            :titel="t('strategies.macdFast')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="slow" :standard="26"
                                            :titel="t('strategies.macdSlow')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="signal" :standard="9"
                                            :titel="t('strategies.macdSignalP')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <template v-else-if="['bollUpper','bollMiddle','bollLower'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="20"
                                            :titel="t('strategies.bollPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="mult" :standard="2" :schritt="0.1"
                                            :titel="t('strategies.bollMult')" :params="parameterNamen" @aendern="pruefen" />
                                        <select v-model="ind.basis" class="at-feld klein"
                                            style="max-width:5.5rem" :title="t('strategies.bollBasis')" @change="pruefen">
                                            <option value="sma">SMA</option>
                                            <option value="ema">EMA</option>
                                        </select>
                                    </div>
                                </template>
                                <template v-else-if="['stochK','stochD'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="14"
                                            :titel="t('strategies.stochPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothK" :standard="3"
                                            :titel="t('strategies.stochSmoothK')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothD" :standard="3"
                                            :titel="t('strategies.stochSmoothD')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <!-- Alle übrigen: eine Periode, aber frei
                                     wählbar statt sieben fester Stufen. -->
                                <ZahlOderParam v-else :ziel="ind" feld="period" :standard="14"
                                    :titel="t('strategies.periodLabel')" :params="parameterNamen" @aendern="pruefen" />
                            </div>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" :titel="t('common.remove')" @click="indikatorWeg(i)" /></div>
                        </div>
                    </div>

                    <!-- ── 3. Signal ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('signal') }">
                        <div class="block-title"><span class="nr">2</span>{{ t('strategies.blockSignal') }}</div>
                        <p class="block-hint">{{ t('strategies.blockSignalHint') }}</p>
                        <div class="raster eng">
                            <div class="b4">
                                <select v-model="entwurf.rules.signal.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="s in bausteine.signale" :key="s" :value="s">{{ t('strategies.signal_' + s) }}</option>
                                </select>
                            </div>
                            <template v-if="['pivotHigh','pivotLow'].includes(entwurf.rules.signal.type)">
                                <div class="b4 m3">
                                    <input v-model.number="entwurf.rules.signal.left" type="number" min="1" class="at-feld klein"
                                        :placeholder="t('strategies.leftBars')" @change="pruefen" />
                                </div>
                                <div class="b4 m3">
                                    <input v-model.number="entwurf.rules.signal.right" type="number" min="1" class="at-feld klein"
                                        :placeholder="t('strategies.rightBars')" @change="pruefen" />
                                </div>
                            </template>
                            <!-- Berührung einer Linie, die vorher schon gehalten hat:
                                 Linie + wie oft vorher. „2" heisst dritte Berührung. -->
                            <template v-else-if="entwurf.rules.signal.type === 'levelTouch'">
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.line)"
                                        :title="t('strategies.touchLine')"
                                        @change="refSetzen(entwurf.rules.signal, 'line', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="minPrevTouches" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                                <div class="b4 ab5 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <!-- Kerzenmuster als Auslöser: Muster + Gegenkerzen davor.
                                 Die Engine liest beides längst, im Formular fehlten sie. -->
                            <template v-else-if="entwurf.rules.signal.type === 'pattern'">
                                <div class="b4">
                                    <select v-model="entwurf.rules.signal.pattern" class="at-feld klein" @change="pruefen">
                                        <option v-for="m in (bausteine.muster || [])" :key="m" :value="m">
                                            {{ t('strategies.muster_' + m) }}
                                        </option>
                                    </select>
                                </div>
                                <div class="b4 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="prevOpposite" :standard="0"
                                        :titel="t('strategies.prevOpposite')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <template v-else>
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.a)"
                                        @change="refSetzen(entwurf.rules.signal, 'a', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.b)"
                                        @change="refSetzen(entwurf.rules.signal, 'b', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 4. Signalfilter ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('signalFilters') }">
                        <div class="block-title">
                            <span class="nr">3</span>{{ t('strategies.blockFilters') }}
                            <Knopf klein class="rechts" @click="bedingungHinzu('signalFilters')">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockFiltersHint') }}</p>
                        <div v-for="(b, i) in entwurf.rules.signalFilters" :key="i" class="raster eng eintrag">
                            <div class="b3 m3">
                                <select class="at-feld klein" :value="refText(b.left)"
                                    @change="refSetzen(b, 'left', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b3 m3">
                                <select v-model="b.op" class="at-feld klein" @change="pruefen">
                                    <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                </select>
                            </div>
                            <div class="b3">
                                <!-- Der Berührungszähler hat keine rechte Seite — nur die Linie links. -->
                                <select v-if="b.op !== 'priorTouchesGte'" class="at-feld klein" :value="refText(b.right)"
                                    @change="refSetzen(b, 'right', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <div v-else class="reihe">
                                    <ZahlOderParam :ziel="b" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="b" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </div>
                            <div class="b2 reihe">
                                <ZahlOderParam v-if="b.op === 'priorTouchesGte'" :ziel="b" feld="value" :standard="2"
                                    :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                <select v-else-if="['distancePctGt','distancePctLt','isBullish','isBearish'].includes(b.op)"
                                    class="at-feld klein" :value="refText(b.value)"
                                    @change="refSetzen(b, 'value', $event.target.value)">
                                    <option v-for="n in [0,0.5,1,2,2.5,5,10]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                </select>
                            </div>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" :titel="t('common.remove')" @click="bedingungWeg('signalFilters', i)" /></div>
                        </div>
                    </div>

                    <!-- ── Einstiegsfilter ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('entryFilters') }">
                        <div class="block-title">
                            <span class="nr">4</span>{{ t('strategien.editor.einstiegsfilter') }}
                            <Knopf klein class="rechts" @click="bedingungHinzu('entryFilters')">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategien.editor.einstiegsfilterHinweis') }}</p>
                        <div v-for="(b, i) in entwurf.rules.entryFilters" :key="i" class="raster eng eintrag">
                            <div class="b3 m3">
                                <select class="at-feld klein" :value="refText(b.left)"
                                    @change="refSetzen(b, 'left', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b3 m3">
                                <select v-model="b.op" class="at-feld klein" @change="pruefen">
                                    <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                </select>
                            </div>
                            <div class="b3">
                                <!-- Der Berührungszähler hat keine rechte Seite — nur die Linie links. -->
                                <select v-if="b.op !== 'priorTouchesGte'" class="at-feld klein" :value="refText(b.right)"
                                    @change="refSetzen(b, 'right', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <div v-else class="reihe">
                                    <ZahlOderParam :ziel="b" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="b" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </div>
                            <div class="b2 reihe">
                                <ZahlOderParam v-if="b.op === 'priorTouchesGte'" :ziel="b" feld="value" :standard="2"
                                    :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                <select v-else-if="['distancePctGt','distancePctLt','isBullish','isBearish'].includes(b.op)"
                                    class="at-feld klein" :value="refText(b.value)"
                                    @change="refSetzen(b, 'value', $event.target.value)">
                                    <option v-for="n in [0,0.5,1,2,2.5,5,10]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                </select>
                            </div>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" :titel="t('common.remove')" @click="bedingungWeg('entryFilters', i)" /></div>
                        </div>
                    </div>

                    <!-- ── 5. Einstieg ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('entry') }">
                        <div class="block-title"><span class="nr">5</span>{{ t('strategies.blockEntry') }}</div>
                        <p class="block-hint">{{ t('strategies.blockEntryHint') }}</p>
                        <div class="raster eng">
                            <div class="b4">
                                <select v-model="entwurf.rules.entry.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="e in bausteine.einstieg" :key="e" :value="e">{{ t('strategies.entry_' + e) }}</option>
                                </select>
                            </div>
                            <template v-if="entwurf.rules.entry.type === 'touch'">
                                <div class="b4 m3">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.entry.anchor)"
                                        @change="refSetzen(entwurf.rules.entry, 'anchor', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4 m3">
                                    <select v-model="entwurf.rules.entry.from" class="at-feld klein" @change="pruefen">
                                        <option value="above">{{ t('strategies.fromAbove') }}</option>
                                        <option value="below">{{ t('strategies.fromBelow') }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 7. Stop und Ziel ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft(['stopLoss','takeProfit','breakEvenAtR']) }">
                        <div class="block-title"><span class="nr">6</span>{{ t('strategies.blockExit') }}</div>
                        <div class="raster eng abstandUnten">
                            <div class="b2 zeilenTitel">{{ t('strategies.stop') }}</div>
                            <div class="b4">
                                <select class="at-feld klein" :value="refText(entwurf.rules.stopLoss.anchor)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <select class="at-feld klein" :value="refText(entwurf.rules.stopLoss.offsetPct)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'offsetPct', $event.target.value)">
                                    <option v-for="n in [0,0.1,0.2,0.3,0.5,1,2]" :key="n" :value="String(n)">{{ n }} % {{ t('strategies.beyond') }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="raster eng">
                            <div class="b2 zeilenTitel">{{ t('strategies.target') }}</div>
                            <div class="b4">
                                <select v-model="entwurf.rules.takeProfit.mode" class="at-feld klein" @change="pruefen">
                                    <option v-for="z in bausteine.ziele" :key="z" :value="z">{{ t('strategies.tp_' + z) }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <select v-if="entwurf.rules.takeProfit.mode === 'rr'" class="at-feld klein"
                                    :value="refText(entwurf.rules.takeProfit.rr)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'rr', $event.target.value)">
                                    <option v-for="n in [1,1.5,2,2.5,3,4,5]" :key="n" :value="String(n)">{{ n }} R</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <select v-else-if="entwurf.rules.takeProfit.mode === 'anchor'" class="at-feld klein"
                                    :value="refText(entwurf.rules.takeProfit.anchor)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b2">
                                <input v-model.number="entwurf.rules.breakEvenAtR" type="number" step="0.5" min="0"
                                    class="at-feld klein" :title="t('strategies.breakEvenTitle')" @change="pruefen" />
                            </div>
                        </div>
                        <!-- Bis 01.11.2026 konnte nur der Chat diese beiden setzen. -->
                        <div class="raster eng abstandOben">
                            <div class="b2 zeilenTitel">{{ t('strategien.editor.mindestRr') }}</div>
                            <div class="b4">
                                <input v-model.number="entwurf.rules.minRR" type="number" step="0.5" min="0" placeholder="0" class="at-feld klein"
                                    :title="t('strategien.editor.mindestRrHinweis')" @change="pruefen" />
                            </div>
                            <div class="b2 zeilenTitel">{{ t('strategien.editor.zeitausstieg') }}</div>
                            <div class="b4">
                                <input v-model.number="entwurf.rules.maxHoldCandles" type="number" step="1" min="0" placeholder="0" class="at-feld klein"
                                    :title="t('strategien.editor.zeitausstiegHinweis')" @change="pruefen" />
                            </div>
                        </div>
                    </div>

                    <!-- ── 6. Abbruchgründe ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('invalidations') }">
                        <div class="block-title">
                            <span class="nr">7</span>{{ t('strategies.blockInvalidations') }}
                            <span class="titelKnoepfe">
                                <Knopf klein @click="abbruchHinzu('condition')">
                                    + {{ t('strategies.condition') }}
                                </Knopf>
                                <Knopf klein @click="abbruchHinzu('timeout')">
                                    + {{ t('strategies.timeout') }}
                                </Knopf>
                            </span>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockInvalidationsHint') }}</p>
                        <div v-for="(v, i) in entwurf.rules.invalidations" :key="i" class="raster eng eintrag">
                            <div class="b3"><input v-model="v.code" class="at-feld klein" :placeholder="t('strategies.reasonCode')" @change="pruefen" /></div>
                            <template v-if="v.type === 'timeout'">
                                <div class="b8">
                                    <select class="at-feld klein" :value="refText(v.candles)"
                                        @change="refSetzen(v, 'candles', $event.target.value)">
                                        <option v-for="n in [3,5,10,15,20,30,50]" :key="n" :value="String(n)">{{ t('strategies.afterCandles', { n }) }}</option>
                                        <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                    </select>
                                </div>
                            </template>
                            <template v-else>
                                <div class="b3 m3">
                                    <select class="at-feld klein" :value="refText(v.when.left)"
                                        @change="refSetzen(v.when, 'left', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b3 m3">
                                    <select v-model="v.when.op" class="at-feld klein" @change="pruefen">
                                        <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                    </select>
                                </div>
                                <div class="b2 reihe">
                                    <ZahlOderParam v-if="v.when.op === 'priorTouchesGte'" :ziel="v.when" feld="value" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                    <select v-else class="at-feld klein" :value="refText(v.when.right)"
                                        @change="refSetzen(v.when, 'right', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" :titel="t('common.remove')" @click="abbruchWeg(i)" /></div>
                        </div>
                    </div>

                    <!-- ── 1. Parameter ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('params') }">
                        <div class="block-title">
                            <span class="nr">8</span>{{ t('strategies.blockParams') }}
                            <Knopf klein class="rechts" @click="paramHinzu">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockParamsHint') }}</p>
                        <div v-for="(p, i) in entwurf.rules.params" :key="i" class="raster eng eintrag mittig">
                            <div class="b3 m3"><input v-model="p.key" class="at-feld klein" placeholder="name" @change="pruefen" /></div>
                            <div class="b4 m3"><input v-model="p.label" class="at-feld klein" :placeholder="t('strategies.labelPlaceholder')" /></div>
                            <div class="b2">
                                <select v-model="p.type" class="at-feld klein" @change="pruefen">
                                    <option value="number">{{ t('strategies.typeNumber') }}</option>
                                    <option value="integer">{{ t('strategies.typeInteger') }}</option>
                                    <option value="boolean">{{ t('strategies.typeBoolean') }}</option>
                                </select>
                            </div>
                            <div class="b1 m2"><input v-model.number="p.default" type="number" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b1 m2"><input v-model.number="p.min" type="number" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b1 m2 reihe">
                                <input v-model.number="p.max" type="number" class="at-feld klein" @change="pruefen" />
                                <Knopf art="gefahr" klein nurSymbol symbol="schliessen" :titel="t('common.remove')" @click="paramWeg(i)" />
                            </div>
                        </div>
                    </div>

                    </div>

                    <Hinweis v-if="speicherFrage" art="warn" class="abstandOben3">
                        {{ t('strategien.editor.betroffen', { n: betroffene.length, namen: betroffene.map((i) => i.name).join(', ') }) }}
                        <div class="knopfZeile abstandOben">
                            <Knopf art="haupt" klein @click="sichern(true)">{{ t('strategien.editor.trotzdemSpeichern') }}</Knopf>
                            <Knopf klein @click="speicherFrage = false">{{ t('common.cancel') }}</Knopf>
                        </div>
                    </Hinweis>
                    <div class="knopfZeile abstandOben3">
                        <Knopf art="haupt" klein symbol="speichern" :disabled="speichert || (pruefung && !pruefung.ok)" @click="sichern()">
                            {{ t('common.save') }}
                        </Knopf>
                        <Knopf klein @click="emit('zurueck')">{{ t('common.cancel') }}</Knopf>
                    </div>
                    </template>
                </div>

                <!-- ══ Test ══ -->
                <div v-if="!nurGespraech" class="journalKarte karte">
                    <div class="section-title abstandUnten">{{ t('strategies.testNow') }}</div>
                    <div class="raster unten">
                        <div class="b3 m2">
                            <label class="at-label">{{ t('strategies.symbol') }}</label>
                            <input v-model="test.symbol" class="at-feld klein" />
                        </div>
                        <div class="b2 m2">
                            <label class="at-label">{{ t('strategies.timeframe') }}</label>
                            <select v-model="test.timeframe" class="at-feld klein">
                                <option v-for="tf in entwurf.rules.timeframes" :key="tf" :value="tf">{{ tf }}</option>
                            </select>
                        </div>
                        <div class="b2 m2">
                            <label class="at-label">{{ t('strategies.days') }}</label>
                            <input v-model.number="test.tage" type="number" min="30" max="720" class="at-feld klein" />
                        </div>
                        <div class="b2">
                            <Knopf art="haupt" klein class="voll" :disabled="testLaeuft" @click="testen">
                                <Kreisel v-if="testLaeuft" still />
                                <span v-else>{{ t('strategies.run') }}</span>
                            </Knopf>
                        </div>
                    </div>

                    <QuelleAus v-if="testAus" :aus="testAus" class="abstandOben3" />
                    <div v-if="testErgebnis" class="abstandOben3">
                        <!-- Der Chart zum Testlauf. Kräftig = gehandelt, blass
                             gestrichelt = erkannt und verworfen. -->
                        <div class="abstandUnten">
                            <div class="zeileMitSymbol abstandUnten1">
                                <Symbol name="linie" />
                                <strong class="fein">{{ t('strategies.chartTitle') }}</strong>
                                <Pille v-if="testErgebnis.setups?.length" ton="neutral">
                                    {{ t('strategies.chartSetups', { n: testErgebnis.setups.length }) }}
                                </Pille>
                            </div>
                            <StrategieChart :symbol="test.symbol.toUpperCase()" :interval="test.timeframe"
                                :daten="testDaten" :merk-schluessel="entwurf.strategyId || 'entwurf'" :hoehe="380" />
                        </div>

                        <div v-if="!testErgebnis.stats?.trades" class="at-gedaempft fein">
                            {{ testErgebnis.stats?.hinweis || t('strategies.noTradesInPeriod') }}
                        </div>
                        <div v-else class="kpis">
                            <div v-for="k in [
                                { l: t('strategies.kpiTrades'), v: testErgebnis.stats.trades },
                                { l: t('strategies.kpiWinRate'), v: zahl(testErgebnis.stats.winRate, 1) + ' %' },
                                { l: t('strategies.kpiExpectancy'), v: zahl(testErgebnis.stats.expectancyR) + ' R',
                                  farbe: testErgebnis.stats.expectancyR >= 0 },
                                { l: t('strategies.kpiProfitFactor'), v: zahl(testErgebnis.stats.profitFactor) },
                                { l: t('strategies.kpiNetPnl'), v: zahl(testErgebnis.stats.netPnl), farbe: testErgebnis.stats.netPnl >= 0 },
                                { l: t('strategies.kpiMaxDd'), v: zahl(testErgebnis.stats.maxDrawdownPct, 1) + ' %' },
                            ]" :key="k.l" class="kpi">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value" :class="k.farbe === undefined ? '' : (k.farbe ? 'gewinnWert' : 'verlustWert')">{{ k.v }}</div>
                            </div>
                        </div>
                        <div v-if="testErgebnis.funnel" class="zweiSpalten abstandOben">
                            <div>
                                <div class="section-title abstandUnten1">{{ t('strategies.funnel') }}</div>
                                <table class="at-tabelle dicht">
                                    <tbody>
                                        <tr v-for="k in ['setupsDetected','triggered','executed']" :key="k">
                                            <td>{{ t('strategies.bt_' + k) }}</td>
                                            <td class="zahl"><strong>{{ testErgebnis.funnel[k] }}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <div class="section-title abstandUnten1">{{ t('strategies.whyLost') }}</div>
                                <table class="at-tabelle dicht">
                                    <tbody>
                                        <tr v-for="[g, n] in sortiert(testErgebnis.funnel.invalidated)" :key="g">
                                            <td>{{ g }}</td>
                                            <td class="zahl">{{ n }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </template>

        </div>
    </div>
</template>

<style scoped>
.regelEditor { padding: 0; }
.bausteinKopf { background: none; border: 0; color: var(--text); cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 600; padding: 8px 0; margin-top: 8px; }
.bausteine { display: flex; flex-direction: column; gap: 12px; }
.vorschlagKasten { border: 1px solid var(--accent); border-radius: var(--radius-knopf); padding: 10px; display: flex; flex-direction: column; gap: 8px; }

.seiteInnen {
    max-width: 1500px;
}

.karte {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

/* `.journalKarte` setzt global `height: 100%`. Hier stehen die Karten gestapelt
   untereinander — dort zieht die Regel jede einzelne Karte auf die Höhe der
   GESAMTEN Spalte und erzeugt riesige Leerräume. */
.journalKarte {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
}

.fein {
    font-size: 0.85rem;
}

.vorSymbol {
    margin-right: var(--abstand-1);
    vertical-align: -0.125em;
}

.abstandUnten1 { margin-bottom: var(--abstand-1); }
.abstandUnten { margin-bottom: var(--abstand-2); }
.abstandUnten3 { margin-bottom: var(--abstand-4); }
.abstandOben { margin-top: var(--abstand-2); }
.abstandOben3 { margin-top: var(--abstand-4); }

.rechts {
    margin-left: auto;
}

.zeileMitSymbol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.knopfZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

/* Neutraler Kasten (früher alert-secondary): eine Aussage, keine Warnung. */
.kasten {
    padding: var(--abstand-2) var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    font-size: 0.85rem;
}

.punkte {
    margin: 0;
    padding-left: var(--abstand-4);
}

/* ── Raster: 12 Spalten ab Tablet, auf dem Telefon 6 Spalten mit
   Vorgabe „ganze Breite" — wo zwei oder drei Felder nebeneinander
   lesbar bleiben, tragen sie m3 bzw. m2. ── */
.raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.raster.eng {
    gap: var(--abstand-1);
}

.raster.unten {
    align-items: end;
}

.raster.mittig {
    align-items: center;
}

.b1 { grid-column: span 1; }
.b2 { grid-column: span 2; }
.b3 { grid-column: span 3; }
.b4 { grid-column: span 4; }
.b5 { grid-column: span 5; }
.b6 { grid-column: span 6; }
.b8 { grid-column: span 8; }
.ab5 { grid-column: 5 / span 4; }

.reihe {
    display: flex;
    gap: var(--abstand-1);
    min-width: 0;
}

.reihe > .at-feld {
    min-width: 0;
}

.voll {
    width: 100%;
}

.kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.kpi {
    text-align: center;
    padding: var(--abstand-2);
}

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
}

.kpi-value {
    font-size: 1.1rem;
    font-weight: 600;
}

.zweiSpalten {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--abstand-4);
}

@media (max-width: 767.98px) {

    .karte {
        padding: var(--abstand-3);
    }

    .raster {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    .raster > * {
        grid-column: 1 / -1;
    }

    .raster > .m3 { grid-column: span 3; }
    .raster > .m2 { grid-column: span 2; }

    .kpis {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .zweiSpalten {
        grid-template-columns: 1fr;
    }
}

/* ── Strategie-Editor ── */
.kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}

.seitenTitel {
    margin: 0 auto 0 0;
}

.versteckt {
    display: none;
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.tfChip {
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-klein);
    border: 1px solid var(--line);
    background: var(--panel-soft);
    color: var(--muted);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
}

.tfChip:hover {
    color: var(--text);
}

.tfChip.an {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}

.block {
    border-top: 1px solid var(--line);
    padding-top: var(--abstand-3);
    margin-top: var(--abstand-3);
}

/* Vom letzten Chat-Vorschlag angefasst. Bewusst eine Kante statt einer Füllung:
   sie zeigt den Ort, ohne die Werte darin schwerer lesbar zu machen. */
.block.blockGeaendert {
    border-left: 3px solid var(--accent);
    padding-left: 0.6rem;
    margin-left: -0.6rem;
    background: var(--accent-flaeche);
    border-radius: var(--radius-klein);
}

.block-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
}

.block-title .nr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    margin-right: var(--abstand-1);
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.7rem;
}

.titelKnoepfe {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
    margin-left: auto;
}

.block-hint {
    font-size: 0.74rem;
    color: var(--muted);
    margin-bottom: var(--abstand-2);
}

.eintrag + .eintrag {
    margin-top: var(--abstand-1);
}

.wegZelle {
    display: flex;
}

.wegZelle > * {
    flex: 1 1 auto;
}

.zeilenTitel {
    font-size: 0.85rem;
    padding-top: var(--abstand-1);
}

.saetzeKarte {
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
}

.satzZeile {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.15rem 0;
    font-size: 0.88rem;
}

.satzTitel {
    flex: 0 0 6.5rem;
    color: var(--muted);
    font-size: 0.8rem;
}

.fussnote {
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
    color: var(--muted);
}

/* Der Chat ist ein Werkzeug, kein Anhängsel — er bekommt eine eigene Fläche,
   damit er nicht als weitere Formularzeile gelesen wird. */
.chatPanel {
    border: 1px solid var(--accent-rand);
    background: var(--panel-soft);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
    margin-top: var(--abstand-3);
}

.chatIcon {
    color: var(--accent);
    font-size: 1.1rem;
}

.chatVerlauf {
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    padding: var(--abstand-2);
}

.chatZeile {
    font-size: 0.85rem;
    padding: 0.35rem 0.55rem;
    margin-bottom: 0.35rem;
    border-radius: var(--radius-klein);
    white-space: pre-wrap;
}

.chatNutzer {
    background: var(--accent-flaeche);
    margin-left: 2rem;
}

.chatModell {
    background: var(--panel-hoch);
    margin-right: 2rem;
}

.fragen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.frageKnopf {
    text-align: left;
    justify-content: flex-start;
}

.chatEingabe {
    display: flex;
    gap: var(--abstand-2);
    align-items: stretch;
}

.chatEingabe .at-feld {
    flex: 1 1 auto;
    min-width: 0;
}

.chatEingabe > :last-child {
    flex: 0 0 auto;
}

@media (max-width: 767.98px) {

    /* Mehrere Einträge untereinander: eine feine Trennlinie, sonst verschwimmen
       die Felder eines Eintrags mit denen des nächsten. */
    .eintrag + .eintrag {
        margin-top: var(--abstand-2);
        padding-top: var(--abstand-2);
        border-top: 1px dashed var(--line);
    }

    .wegZelle {
        justify-content: flex-end;
    }

    .wegZelle > * {
        flex: 0 0 auto;
    }

    .zeilenTitel {
        padding-top: 0;
    }

    .satzZeile {
        flex-direction: column;
        gap: 0;
    }

    .satzTitel {
        flex-basis: auto;
    }

    .chatNutzer {
        margin-left: var(--abstand-4);
    }

    .chatModell {
        margin-right: var(--abstand-4);
    }
}
</style>
