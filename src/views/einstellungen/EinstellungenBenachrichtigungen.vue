<script setup>
/**
 * Bereich „Benachrichtigungen": Browser-Hauptschalter, Kanalwahl je Ereignis
 * (mit Schwellen und den Märkten des Divergenz-Alarms) und der Mail-Zugang.
 * Register, Kanalwahl und Mail-Zugang lädt Settings.vue beim Öffnen der Seite
 * (useBenachrichtigungen) — KI → Nachrichten liest sie ebenfalls.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SchrittMailKonfiguration from '@/components/onboarding/SchrittMailKonfiguration.vue'
import { loadSymbolMeta } from '@/utils/liveSymbols.js'
import {
    browserNotifications, saveNotificationSetting, meldeTypen, kanalAn, setzeKanal, mail,
} from './gemeinsam/useBenachrichtigungen.js'
import {
    radarPicycleSchwelle, radarFundingDivergenz, radarDivergenzSymbole, useRadarEinstellungen,
} from './gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

/* Ref auf <SchrittMailKonfiguration>. Den Mail-Stand für die übrigen
   Lesestellen lädt inzwischen `ladeMail()` (useBenachrichtigungen). */
const mailKonfigRef = ref(null)

/** Reihenfolge der Gruppen in der Anzeige. */
const MELDE_GRUPPEN = ['markt', 'system']
/*
 * Ereignisse mit `eigeneStelle` stehen NICHT in dieser Tabelle.
 *
 * Der Lagebericht geht oft an mehrere Leser und hat deshalb eine eigene
 * Empfängerliste unter KI → Nachrichten. Zwei Schalter für dieselbe Sache an
 * zwei Orten wären schlimmer als einer am ungewohnten Ort — deshalb hier nur
 * der Hinweis, wo er steht.
 */
const typenNachGruppe = computed(() => MELDE_GRUPPEN
    .map(g => ({ id: g, typen: meldeTypen.value.filter(t => t.gruppe === g && !t.eigeneStelle) }))
    .filter(g => g.typen.length))

/** Welche Ereignisse anderswo eingestellt werden — für den Verweis darunter. */
const meldeAnderswo = computed(() => meldeTypen.value.filter(t => t.eigeneStelle))

/** Schwelle je Ereignis — die beiden, die eine haben, hängen an eigenen Spalten. */
const SCHWELLEN = {
    picycleVorwarnung: {
        ref: () => radarPicycleSchwelle,
        spalte: 'radarPicycleSchwelle',
        optionen: [[0, 'Nur bei der Kreuzung'], [3, 'ab 3 % Abstand'], [5, 'ab 5 % Abstand'],
        [10, 'ab 10 % Abstand'], [20, 'ab 20 % Abstand']],
    },
    fundingDivergenz: {
        ref: () => radarFundingDivergenz,
        spalte: 'radarFundingDivergenz',
        optionen: [[0, 'Aus'], [10, 'ab 10 Punkten p.a.'], [15, 'ab 15 Punkten p.a.'],
        [25, 'ab 25 Punkten p.a.'], [50, 'ab 50 Punkten p.a.']],
    },
}

/* ── Divergenz-Alarm: welche Märkte ──────────────────────────────────────
 *
 * Gespeichert wird eine Symbolliste, ausgewählt wird sie aber aus den Märkten,
 * die Binance wirklich führt: ein getipptes Symbol, das es nicht gibt, meldet
 * sich nie — und niemand käme darauf, dass ein Tippfehler der Grund ist.
 *
 * Leere Auswahl heisst „deine Märkte" und nicht „keine". Der Alarm hatte vor
 * der Auswahl genau dieses Verhalten; wer nichts anfasst, soll nichts merken.
 */
const divergenzOffen = ref(false)
const divergenzSuche = ref('')
const divergenzMaerkte = ref([])
const divergenzLaedt = ref(false)

/** Höchstens so viele Märkte — der Server nimmt ohnehin nicht mehr an. */
const DIVERGENZ_MAX = 40

const divergenzGewaehlt = computed(() => String(radarDivergenzSymbole.value || '')
    .split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean))

/** BTCUSDT → BTC. Das USDT dahinter trägt keine Information, kostet aber Platz. */
const kurzCoin = (s) => String(s).replace(/USDT$/, '')

const divergenzLabel = computed(() => divergenzGewaehlt.value.map(kurzCoin).join(', '))

/**
 * Die Liste unter dem Suchfeld. Gewählte Märkte stehen oben — sonst sucht man
 * nach dem Abwählen quer durch tausend Zeilen nach dem, was man gerade
 * angehakt hatte.
 */
const divergenzTreffer = computed(() => {
    const q = divergenzSuche.value.trim().toUpperCase()
    const gewaehlt = divergenzGewaehlt.value
    const passt = (s) => !q || s.includes(q)
    const rest = divergenzMaerkte.value.filter(s => passt(s) && !gewaehlt.includes(s))
    return [...gewaehlt.filter(passt), ...rest].slice(0, 60)
})

async function divergenzOeffnen() {
    divergenzOffen.value = !divergenzOffen.value
    if (!divergenzOffen.value || divergenzMaerkte.value.length) return
    divergenzLaedt.value = true
    try {
        const meta = await loadSymbolMeta('futures')
        divergenzMaerkte.value = meta
            .map(m => String(m.symbol || '').toUpperCase())
            .filter(s => s.endsWith('USDT'))
            .sort()
    } catch (e) {
        console.error(' -> Marktliste nicht ladbar:', e)
    } finally {
        divergenzLaedt.value = false
    }
}

async function divergenzUmschalten(symbol) {
    const gewaehlt = divergenzGewaehlt.value
    const neu = gewaehlt.includes(symbol)
        ? gewaehlt.filter(s => s !== symbol)
        : [...gewaehlt, symbol].slice(0, DIVERGENZ_MAX)
    radarDivergenzSymbole.value = neu.join(',')
    await radarSpeichern('radarDivergenzSymbole')
}

async function divergenzLeeren() {
    radarDivergenzSymbole.value = ''
    await radarSpeichern('radarDivergenzSymbole')
}
</script>

<template>
    <div>
        <hr />
        <p class="fs-5 fw-bold mb-1">{{ t('settings.benachrichtigungen.titel') }}</p>
        <p class="fw-lighter" style="font-size:0.85rem;">
            {{ t('settings.benachrichtigungen.einleitung') }}
        </p>

        <!-- Hauptschalter: ohne ihn ist der ganze Browser-Kanal stumm -->
        <div class="form-check form-switch mt-3">
            <input class="form-check-input" type="checkbox" id="notificationToggle"
                v-model="browserNotifications" @change="saveNotificationSetting">
            <label class="form-check-label" for="notificationToggle">
                {{ t('settings.browserNotifications') }}
            </label>
        </div>
        <small class="text-muted">{{ t('settings.browserNotificationsHint') }}</small>

        <!-- Matrix: je Ereignis eine Zeile, je Kanal ein Häkchen -->
        <div class="table-responsive mt-4">
            <table class="table table-sm align-middle mb-0">
                <thead>
                    <tr>
                        <th style="min-width:15rem;">{{ t('settings.benachrichtigungen.ereignis') }}</th>
                        <th class="text-center" style="width:7rem;">{{ t('settings.benachrichtigungen.browser') }}</th>
                        <th class="text-center" style="width:7rem;">{{ t('settings.benachrichtigungen.email') }}</th>
                        <th style="min-width:13rem;">{{ t('settings.benachrichtigungen.schwelle') }}</th>
                        <th style="min-width:13rem;">{{ t('settings.benachrichtigungen.maerkte') }}</th>
                    </tr>
                </thead>
                <tbody v-for="g in typenNachGruppe" :key="g.id">
                    <tr>
                        <td colspan="5" class="fw-bold text-muted pt-3" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em;">
                            {{ t('settings.benachrichtigungen.gruppe_' + g.id) }}
                        </td>
                    </tr>
                    <tr v-for="typ in g.typen" :key="typ.id">
                        <td>
                            {{ t('settings.benachrichtigungen.typ_' + typ.id) }}
                            <small class="d-block text-muted" style="font-size:0.76rem;">
                                {{ t('settings.benachrichtigungen.hinweis_' + typ.id) }}
                            </small>
                        </td>
                        <td class="text-center">
                            <input class="form-check-input" type="checkbox"
                                :checked="kanalAn(typ.id, 'browser')" :disabled="!browserNotifications"
                                @change="setzeKanal(typ.id, 'browser', $event.target.checked)">
                        </td>
                        <td class="text-center">
                            <input v-if="typ.email" class="form-check-input" type="checkbox"
                                :checked="kanalAn(typ.id, 'email')" :disabled="!mail.mailAktiv"
                                @change="setzeKanal(typ.id, 'email', $event.target.checked)">
                            <span v-else class="text-muted" :title="t('settings.benachrichtigungen.nurBrowser')">—</span>
                        </td>
                        <td>
                            <select v-if="SCHWELLEN[typ.id]" class="form-select form-select-sm"
                                v-model.number="SCHWELLEN[typ.id].ref().value"
                                @change="radarSpeichern(SCHWELLEN[typ.id].spalte)">
                                <option v-for="[wert, text] in SCHWELLEN[typ.id].optionen"
                                    :key="wert" :value="wert">{{ text }}</option>
                            </select>
                        </td>
                        <!-- Märkte: bisher nur die Divergenz beobachtet
                             einzelne Coins. Leer = die eigenen Märkte. -->
                        <td>
                            <div v-if="typ.id === 'fundingDivergenz'" class="position-relative">
                                <button type="button" class="form-select form-select-sm text-start divWahlKnopf"
                                    :disabled="!radarFundingDivergenz" @click="divergenzOeffnen">
                                    <span v-if="divergenzGewaehlt.length">{{ divergenzLabel }}</span>
                                    <span v-else class="text-muted">{{ t('settings.benachrichtigungen.divergenzEigene') }}</span>
                                </button>
                                <template v-if="divergenzOffen">
                                    <div class="divWahlHinter" @click="divergenzOffen = false"></div>
                                    <div class="divWahl floatDropdown">
                                        <input type="text" class="form-control form-control-sm mb-2"
                                            v-model="divergenzSuche" :placeholder="t('settings.benachrichtigungen.divergenzSuche')" />
                                        <div class="divWahlZeile floatDropdownZeile" @click="divergenzLeeren">
                                            <i class="uil me-2" :class="divergenzGewaehlt.length ? 'uil-square-full text-muted' : 'uil-check-square text-success'"></i>
                                            {{ t('settings.benachrichtigungen.divergenzEigene') }}
                                        </div>
                                        <div v-if="divergenzLaedt" class="text-muted px-1 py-2" style="font-size:0.8rem;">
                                            {{ t('settings.benachrichtigungen.divergenzLaedt') }}
                                        </div>
                                        <div v-for="s in divergenzTreffer" :key="s" class="divWahlZeile floatDropdownZeile"
                                            @click="divergenzUmschalten(s)">
                                            <i class="uil me-2" :class="divergenzGewaehlt.includes(s) ? 'uil-check-square text-success' : 'uil-square-full text-muted'"></i>
                                            {{ kurzCoin(s) }}
                                        </div>
                                        <div class="text-muted px-1 pt-2" style="font-size:0.75rem;">
                                            {{ t('settings.benachrichtigungen.divergenzAnzahl', { n: divergenzGewaehlt.length, max: DIVERGENZ_MAX }) }}
                                        </div>
                                    </div>
                                </template>
                                <small class="d-block text-muted mt-1" style="font-size:0.72rem;">
                                    {{ t('settings.benachrichtigungen.divergenzHinweis') }}
                                </small>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="fw-lighter mt-2" style="font-size:0.8rem;">
            {{ t('settings.benachrichtigungen.kanalHinweis') }}
        </p>

        <!-- Wo die Ereignisse stehen, die hier fehlen. Ohne diese Zeile
             sucht man den Lagebericht in der Tabelle und hält sein
             Fehlen für einen Fehler. -->
        <p v-if="meldeAnderswo.length" class="fw-lighter" style="font-size:0.8rem;">
            <i class="uil uil-info-circle me-1"></i>
            {{ t('settings.benachrichtigungen.anderswo', {
                was: meldeAnderswo.map(typ => t('settings.benachrichtigungen.typ_' + typ.id)).join(', ')
            }) }}
        </p>

        <!--=============== E-MAIL ===============-->
        <hr class="mt-4" />
        <p class="fs-5 fw-bold mb-1">{{ t('settings.benachrichtigungen.mailTitel') }}</p>
        <p class="fw-lighter" style="font-size:0.85rem;">
            {{ t('settings.benachrichtigungen.mailEinleitung') }}
        </p>

        <SchrittMailKonfiguration v-model:mail="mail" ref="mailKonfigRef" />
    </div>
</template>

<style scoped>
/* Coin-Auswahl des Divergenz-Alarms. Eigenes Aufklappfeld statt eines
   <select multiple>: aus über 500 Perps sucht man ohne Suchfeld nicht, und
   ein mehrzeiliges Auswahlfeld sprengt die Tabellenzeile. */
.divWahlKnopf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Fängt den Klick daneben ab — sonst bliebe die Liste offen stehen. */
.divWahlHinter {
    position: fixed;
    inset: 0;
    z-index: 1040;
}

/* Kasten- und Zeilen-Optik kommen aus den geteilten `.floatDropdown*`-Klassen
   in style-dark.css — hier nur Position/Grösse, die vom umgebenden Layout
   abhängen (Tabellenzelle statt Modal), nicht vom Dropdown-Inhalt. */
.divWahl {
    position: absolute;
    z-index: 1050;
    top: calc(100% + 0.25rem);
    right: 0;
    width: 15rem;
}

.divWahlZeile {
    white-space: nowrap;
}
</style>
