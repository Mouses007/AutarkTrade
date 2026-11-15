<script setup>
/**
 * Kaufzettel (Aktien, Phase 7): ein Rechenblatt vor dem Kauf.
 *
 * Handelsplatz aus den Listungen des Titels wählen (Future, Spot-Token,
 * Bitpanda), Richtung, Einstieg, Stop, Ziel und den maximalen Verlust
 * eintragen — der Zettel rechnet Stückzahl, Nominalwert, Marge und das
 * Verhältnis Chance zu Risiko (`shared/kaufzettel.js`) und warnt, wenn die
 * Liquidation vor dem Stop läge.
 *
 * Der Zettel SENDET NICHTS und speichert nichts bei einer Börse (die App
 * platziert keine Aufträge). Er führt nur zur Handelsseite und legt die
 * Werte als Text in die Zwischenablage. Gemerkt werden im Browser allein
 * Verlustbetrag, Einheit, Konto und Hebel.
 *
 *   <Kaufzettel v-model="offen" ticker="NVDA" :seite="seite" />
 *
 * Ohne `seite` (Aufruf aus dem Aktien-Radar) lädt der Zettel den Titel selbst.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Dialog from '../basis/Dialog.vue'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import { rechneKaufzettel, zettelHinweise, zettelText, istSpot, GEBUEHR_VORGABE } from '../../../shared/kaufzettel.js'
import { aktienHandelsUrl } from '../../utils/boersenLinks.js'

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    ticker: { type: String, required: true },
    /** Antwort von `/api/aktien/titel/:ticker`, falls die Titel-Seite sie schon hat. */
    seite: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])
const { t, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const DOLLAR = ['USD', 'USDT', 'USDC', 'FDUSD']
const MERK = 'at.kaufzettel'

const offen = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })

/* ── Titel ─────────────────────────────────────────────────────────── */
const geladen = ref(null)
const laedt = ref(false)
const ladeFehler = ref('')
const daten = computed(() => props.seite || geladen.value)
const kurs = computed(() => daten.value?.daten?.kurs?.preis ?? null)
const kursWaehrung = computed(() => daten.value?.daten?.profil?.waehrung || '')
const termin = computed(() => daten.value?.daten?.termin || null)
const listungen = computed(() => [...(daten.value?.titel?.listungen || [])]
    .sort((a, b) => RANG[a.art] - RANG[b.art] || a.handelsplatz.localeCompare(b.handelsplatz)))
const schluessel = (l) => `${l.handelsplatz}|${l.art}|${l.symbol}`

async function ladeTitel() {
    if (props.seite || laedt.value) return
    laedt.value = true
    ladeFehler.value = ''
    try {
        const { data } = await axios.get(`/api/aktien/titel/${encodeURIComponent(props.ticker)}`, { timeout: 40000 })
        if (data?.ok) geladen.value = data
        else ladeFehler.value = t('kaufzettel.ladeFehler')
    } catch (e) {
        ladeFehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

/* ── Eingaben ──────────────────────────────────────────────────────── */
function gemerkt() {
    try { return JSON.parse(localStorage.getItem(MERK) || '{}') || {} } catch { return {} }
}
const m = gemerkt()
const platz = ref('')
const richtung = ref('long')
const einstieg = ref('')
const stop = ref('')
const ziel = ref('')
const betrag = ref(Number(m.betrag) > 0 ? Number(m.betrag) : 50)
const einheit = ref(m.einheit === 'prozent' ? 'prozent' : 'usdt')
const konto = ref(Number(m.konto) > 0 ? Number(m.konto) : '')
const hebel = ref(Number(m.hebel) >= 1 ? Number(m.hebel) : 3)
const gebuehr = ref(GEBUEHR_VORGABE.perp)
const kopiert = ref(false)

const listung = computed(() => listungen.value.find((l) => schluessel(l) === platz.value) || null)
const spot = computed(() => (listung.value ? istSpot(listung.value.art) : false))
const waehrung = computed(() => listung.value?.quote || 'USD')
/** Passt der letzte Kurs zur Währung des Platzes? Bitpanda handelt in EUR, der Kurs kommt meist in USD. */
const kursPasst = computed(() => kurs.value != null && !!listung.value
    && (kursWaehrung.value === waehrung.value || (DOLLAR.includes(kursWaehrung.value) && DOLLAR.includes(waehrung.value))))

function belegeVor() {
    if (!listung.value) return
    gebuehr.value = GEBUEHR_VORGABE[listung.value.art] ?? GEBUEHR_VORGABE.perp
    if (spot.value) richtung.value = 'long'
    else if (listung.value.maxHebel && hebel.value > listung.value.maxHebel) hebel.value = listung.value.maxHebel
    // Kurs einer anderen Währung wäre eine falsche Vorbelegung — dann lieber leer.
    einstieg.value = kursPasst.value ? Number(kurs.value) : ''
}

watch([offen, listungen], ([auf]) => {
    if (!auf) return
    ladeTitel()
    if (!listung.value && listungen.value.length) {
        platz.value = schluessel(listungen.value[0])
        stop.value = ''
        ziel.value = ''
        belegeVor()
    }
}, { immediate: true })
watch(platz, belegeVor)
watch(() => props.ticker, () => { geladen.value = null; platz.value = ''; stop.value = ''; ziel.value = '' })
watch([betrag, einheit, konto, hebel], () => {
    try { localStorage.setItem(MERK, JSON.stringify({ betrag: betrag.value, einheit: einheit.value, konto: konto.value, hebel: hebel.value })) } catch { /* privater Modus */ }
})

/* ── Rechnung ──────────────────────────────────────────────────────── */
const r = computed(() => rechneKaufzettel({
    art: listung.value?.art, richtung: richtung.value,
    einstieg: einstieg.value, stop: stop.value, ziel: ziel.value,
    betrag: betrag.value, einheit: einheit.value, konto: konto.value,
    hebel: hebel.value, maxHebel: listung.value?.maxHebel, gebuehrPct: gebuehr.value,
}))
// Leere Pflichtfelder sind kein Fehler, den man anschreien muss — nur falsche Eingaben.
const LEISE = ['einstiegFehlt', 'stopFehlt', 'betragFehlt']
const fehler = computed(() => r.value.fehler.filter((f) => !LEISE.includes(f)))
const hinweise = computed(() => zettelHinweise({ art: listung.value?.art, termin: termin.value }))

/* ── Anzeige ───────────────────────────────────────────────────────── */
const zahl = (v, n = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(locale.value, { minimumFractionDigits: n, maximumFractionDigits: n }))
const geld = (v, n = 2) => (v == null ? '—' : `${zahl(v, n)} ${waehrung.value}`)
const stellen = (v) => (v == null ? 2 : Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 3 : 5)
const preis = (v) => (v == null || v === '' ? '—' : geld(v, stellen(Number(v))))
const prozent = (v, n = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${zahl(v, n)} %`)
const tag = (ms) => new Date(ms).toLocaleDateString(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit' })
const platzName = (l) => PLATZ[l.handelsplatz] || l.handelsplatz
const platzText = (l) => `${platzName(l)} · ${t('aktien.art_' + l.art)}${l.maxHebel ? ` · ${t('aktien.hebel', { n: l.maxHebel })}` : ''}`

const link = computed(() => (listung.value ? aktienHandelsUrl(listung.value) : null))
const linkGenau = computed(() => listung.value?.handelsplatz !== 'bitpanda')

const text = computed(() => {
    const l = listung.value
    if (!l || !r.value.ok) return ''
    const x = r.value
    return zettelText(
        `${t('kaufzettel.titel')} ${props.ticker} · ${platzName(l)} · ${t('aktien.art_' + l.art)} (${l.symbol})`,
        [
            [t('kaufzettel.richtung'), t('kaufzettel.' + x.richtung)],
            [t('kaufzettel.einstieg'), preis(einstieg.value)],
            [t('kaufzettel.stop'), `${preis(stop.value)} (${prozent(x.stopPct)})`],
            [t('kaufzettel.ziel'), ziel.value ? `${preis(ziel.value)} (${prozent(x.zielPct)})` : ''],
            [t('kaufzettel.hebel'), x.spot ? '' : `${zahl(x.hebel, 0)}×`],
            [t('kaufzettel.menge'), zahl(x.menge, 4)],
            [t('kaufzettel.nominal'), geld(x.nominal)],
            [t(x.spot ? 'kaufzettel.einsatz' : 'kaufzettel.marge'), geld(x.marge)],
            [t('kaufzettel.verlustStop'), geld(x.verlustStop)],
            [t('kaufzettel.gewinnZiel'), x.gewinnZiel == null ? '' : geld(x.gewinnZiel)],
            [t('kaufzettel.rr'), x.rr == null ? '' : `1 : ${zahl(x.rr, 2)}`],
            [t('kaufzettel.liq'), x.spot ? '' : preis(x.liq)],
        ],
        t('kaufzettel.nichtGesendet'),
    )
})

async function kopiere() {
    if (!text.value) return
    try {
        await navigator.clipboard.writeText(text.value)
    } catch {
        // Ohne sicheren Kontext (http im Heimnetz) gibt es die Zwischenablage-API nicht.
        const feld = document.createElement('textarea')
        feld.value = text.value
        feld.style.position = 'fixed'
        feld.style.opacity = '0'
        // Im modalen <dialog> ist alles ausserhalb gesperrt — das Feld muss hinein.
        const ort = document.querySelector('dialog[open]') || document.body
        ort.appendChild(feld)
        feld.select()
        try { document.execCommand('copy') } catch { /* dann eben nicht */ }
        feld.remove()
    }
    kopiert.value = true
    setTimeout(() => { kopiert.value = false }, 2000)
}
</script>

<template>
    <Dialog v-model="offen" :titel="t('kaufzettel.titelMit', { ticker })" breite="44rem" :aussen-schliesst="false">
        <Kreisel v-if="laedt && !daten" />
        <Hinweis v-else-if="ladeFehler" art="fehler">{{ ladeFehler }}</Hinweis>
        <Hinweis v-else-if="!listungen.length" art="info">{{ t('kaufzettel.keineListung') }}</Hinweis>

        <div v-else class="zettel">
            <p class="nurRechnen">{{ t('kaufzettel.nichtGesendet') }}</p>

            <div class="felder">
                <label class="feld breit">
                    <span>{{ t('kaufzettel.platz') }}</span>
                    <select v-model="platz" class="at-feld">
                        <option v-for="l in listungen" :key="schluessel(l)" :value="schluessel(l)">{{ platzText(l) }}</option>
                    </select>
                </label>

                <div class="feld breit">
                    <span>{{ t('kaufzettel.richtung') }}</span>
                    <div class="richtung" role="group" :aria-label="t('kaufzettel.richtung')">
                        <button type="button" :class="{ aktiv: richtung === 'long', long: true }" :aria-pressed="richtung === 'long'"
                            @click="richtung = 'long'">{{ t('kaufzettel.long') }}</button>
                        <button type="button" :class="{ aktiv: richtung === 'short', short: true }" :aria-pressed="richtung === 'short'"
                            :disabled="spot" :title="spot ? t('kaufzettel.spotOhneShort') : undefined" @click="richtung = 'short'">{{ t('kaufzettel.short') }}</button>
                        <span v-if="spot" class="klein">{{ t('kaufzettel.spotOhneShort') }}</span>
                    </div>
                </div>

                <label class="feld">
                    <span>{{ t('kaufzettel.einstieg') }} <i>{{ waehrung }}</i></span>
                    <input v-model.number="einstieg" type="number" min="0" step="any" class="at-feld">
                </label>
                <label class="feld">
                    <span>{{ t('kaufzettel.stop') }} <i>{{ waehrung }}</i></span>
                    <input v-model.number="stop" type="number" min="0" step="any" class="at-feld">
                </label>
                <label class="feld">
                    <span>{{ t('kaufzettel.ziel') }} <i>{{ t('kaufzettel.optional') }}</i></span>
                    <input v-model.number="ziel" type="number" min="0" step="any" class="at-feld">
                </label>

                <label class="feld">
                    <span>{{ t('kaufzettel.maxVerlust') }}</span>
                    <input v-model.number="betrag" type="number" min="0" step="any" class="at-feld">
                </label>
                <label class="feld">
                    <span>{{ t('kaufzettel.einheit') }}</span>
                    <select v-model="einheit" class="at-feld">
                        <option value="usdt">{{ waehrung }}</option>
                        <option value="prozent">{{ t('kaufzettel.prozentKonto') }}</option>
                    </select>
                </label>
                <label class="feld">
                    <span>{{ t('kaufzettel.konto') }} <i>{{ waehrung }}</i></span>
                    <input v-model.number="konto" type="number" min="0" step="any" class="at-feld" :placeholder="t('kaufzettel.optional')">
                </label>

                <label v-if="!spot" class="feld">
                    <span>{{ t('kaufzettel.hebel') }} <i v-if="listung?.maxHebel">{{ t('kaufzettel.bis', { n: listung.maxHebel }) }}</i></span>
                    <input v-model.number="hebel" type="number" min="1" :max="listung?.maxHebel || 200" step="1" class="at-feld">
                </label>
                <label class="feld">
                    <span>{{ t('kaufzettel.gebuehr') }}</span>
                    <input v-model.number="gebuehr" type="number" min="0" max="1" step="0.01" class="at-feld">
                </label>
            </div>

            <p v-if="einstieg !== '' && kursPasst" class="klein">{{ t('kaufzettel.kursVorbelegt', { kurs: preis(kurs) }) }}</p>
            <p v-else-if="kurs != null && !kursPasst" class="klein">{{ t('kaufzettel.kursAndereWaehrung', { kurs: `${zahl(kurs)} ${kursWaehrung}`, waehrung }) }}</p>

            <Hinweis v-for="f in fehler" :key="f" art="fehler">{{ t('kaufzettel.fehler_' + f) }}</Hinweis>

            <dl v-if="r.ok" class="ergebnis">
                <div><dt>{{ t('kaufzettel.menge') }}</dt><dd>{{ zahl(r.menge, 4) }}</dd></div>
                <div><dt>{{ t('kaufzettel.nominal') }}</dt><dd>{{ geld(r.nominal) }}</dd></div>
                <div><dt>{{ t(r.spot ? 'kaufzettel.einsatz' : 'kaufzettel.marge') }}</dt><dd>{{ geld(r.marge) }}<small v-if="r.margeKontoPct != null">{{ t('kaufzettel.vomKonto', { pct: zahl(r.margeKontoPct, 1) }) }}</small></dd></div>
                <div><dt>{{ t('kaufzettel.verlustStop') }}</dt><dd class="ab">{{ geld(r.verlustStop) }}<small>{{ prozent(r.stopPct) }}<template v-if="r.kontoRisikoPct != null"> · {{ t('kaufzettel.vomKonto', { pct: zahl(r.kontoRisikoPct, 2) }) }}</template></small></dd></div>
                <div><dt>{{ t('kaufzettel.gewinnZiel') }}</dt><dd :class="{ auf: r.gewinnZiel > 0 }">{{ r.gewinnZiel == null ? '—' : geld(r.gewinnZiel) }}<small v-if="r.zielPct != null">{{ prozent(r.zielPct) }}</small></dd></div>
                <div><dt>{{ t('kaufzettel.rr') }}</dt><dd>{{ r.rr == null ? '—' : `1 : ${zahl(r.rr, 2)}` }}</dd></div>
                <div v-if="!r.spot"><dt>{{ t('kaufzettel.liq') }}</dt><dd :class="{ ab: r.liqVorStop }">{{ preis(r.liq) }}<small>{{ t('kaufzettel.liqAnnahme') }}</small></dd></div>
            </dl>
            <p v-else-if="!fehler.length" class="klein">{{ t('kaufzettel.eingabenFehlen') }}</p>

            <template v-if="r.ok">
                <Hinweis v-if="r.warnungen.includes('liqVorStop')" art="fehler" :titel="t('kaufzettel.warnLiqTitel')">{{ t('kaufzettel.warnLiq', { liq: preis(r.liq), stop: preis(stop) }) }}</Hinweis>
                <Hinweis v-if="r.warnungen.includes('hebelUeberGrenze')" art="warn">{{ t('kaufzettel.warnHebel', { n: listung.maxHebel, platz: platzName(listung) }) }}</Hinweis>
                <Hinweis v-if="r.warnungen.includes('margeUeberKonto')" art="warn">{{ t(r.spot ? 'kaufzettel.warnEinsatzKonto' : 'kaufzettel.warnMargeKonto') }}</Hinweis>
            </template>
            <Hinweis v-if="hinweise.zahlen" art="warn">{{ t(hinweise.zahlen.geschaetzt ? 'kaufzettel.zahlenBaldGeschaetzt' : 'kaufzettel.zahlenBald', { tag: tag(hinweise.zahlen.zeit) }) }}</Hinweis>
            <Hinweis v-if="hinweise.duenn && listung" art="info">{{ t('kaufzettel.duenn_' + listung.art, { sitzung: t('kaufzettel.sitzung_' + hinweise.sitzung) }) }}</Hinweis>
            <p class="klein">{{ t('kaufzettel.stueckelung') }}</p>
        </div>

        <template v-if="listung" #fuss>
            <Knopf symbol="dokument" :disabled="!r.ok" @click="kopiere">{{ t(kopiert ? 'kaufzettel.kopiert' : 'kaufzettel.kopieren') }}</Knopf>
            <Knopf v-if="link" art="haupt" symbol="pfeilHochRechts" :href="link" target="_blank" rel="noopener noreferrer">
                {{ t(linkGenau ? 'kaufzettel.oeffnen' : 'kaufzettel.oeffnenSuchen', { platz: platzName(listung) }) }}
            </Knopf>
        </template>
    </Dialog>
</template>

<style scoped>
.zettel {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}

.nurRechnen {
    margin: 0;
    padding: 0.45rem 0.7rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-flaeche);
    font-size: 0.86rem;
}

.felder {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem 0.7rem;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    font-size: 0.8rem;
    color: var(--muted);
}

.feld i {
    font-style: normal;
    opacity: 0.75;
}

.feld.breit {
    grid-column: 1 / -1;
}

.richtung {
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.richtung button {
    padding: 0.4rem 1.1rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}

.richtung button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.richtung button.aktiv.long {
    border-color: var(--good);
    color: var(--good);
}

.richtung button.aktiv.short {
    border-color: var(--bad);
    color: var(--bad);
}

.klein {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
}

.ergebnis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    margin: 0;
}

.ergebnis > div {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
}

.ergebnis dt {
    font-size: 0.74rem;
    color: var(--muted);
}

.ergebnis dd {
    margin: 0.1rem 0 0;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
}

.ergebnis dd small {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
}

.ergebnis dd.ab {
    color: var(--bad);
}

.ergebnis dd.auf {
    color: var(--good);
}

@media (max-width: 560px) {
    .felder,
    .ergebnis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
