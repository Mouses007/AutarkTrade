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
import { Karte, Symbol } from '@/components/basis/index.js'
import Schalter from './gemeinsam/Schalter.vue'
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
        optionen: [[0, 'schwelleKreuzung'], [3, 'schwelleAbstand'], [5, 'schwelleAbstand'],
        [10, 'schwelleAbstand'], [20, 'schwelleAbstand']],
    },
    fundingDivergenz: {
        ref: () => radarFundingDivergenz,
        spalte: 'radarFundingDivergenz',
        optionen: [[0, 'schwelleAus'], [10, 'schwellePunkte'], [15, 'schwellePunkte'],
        [25, 'schwellePunkte'], [50, 'schwellePunkte']],
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
    <div class="benachrichtigungen">
        <Karte :titel="t('settings.benachrichtigungen.titel')" :unter="t('settings.benachrichtigungen.einleitung')">
            <!-- Hauptschalter: ohne ihn ist der ganze Browser-Kanal stumm -->
            <Schalter v-model="browserNotifications" :label="t('settings.browserNotifications')"
                :hilfe="t('settings.browserNotificationsHint')" @change="saveNotificationSetting" />

            <!-- Matrix: je Ereignis eine Zeile, je Kanal ein Häkchen -->
            <div class="matrix-rahmen">
                <table class="matrix">
                    <thead>
                        <tr>
                            <th class="sp-ereignis">{{ t('settings.benachrichtigungen.ereignis') }}</th>
                            <th class="sp-kanal">{{ t('settings.benachrichtigungen.browser') }}</th>
                            <th class="sp-kanal">{{ t('settings.benachrichtigungen.email') }}</th>
                            <th class="sp-wahl">{{ t('settings.benachrichtigungen.schwelle') }}</th>
                            <th class="sp-wahl">{{ t('settings.benachrichtigungen.maerkte') }}</th>
                        </tr>
                    </thead>
                    <tbody v-for="g in typenNachGruppe" :key="g.id">
                        <tr>
                            <td colspan="5" class="gruppe">{{ t('settings.benachrichtigungen.gruppe_' + g.id) }}</td>
                        </tr>
                        <tr v-for="typ in g.typen" :key="typ.id">
                            <td>
                                {{ t('settings.benachrichtigungen.typ_' + typ.id) }}
                                <span class="unterzeile">{{ t('settings.benachrichtigungen.hinweis_' + typ.id) }}</span>
                            </td>
                            <td class="mitte">
                                <input class="haken" type="checkbox" :aria-label="t('settings.benachrichtigungen.browser')"
                                    :checked="kanalAn(typ.id, 'browser')" :disabled="!browserNotifications"
                                    @change="setzeKanal(typ.id, 'browser', $event.target.checked)">
                            </td>
                            <td class="mitte">
                                <input v-if="typ.email" class="haken" type="checkbox" :aria-label="t('settings.benachrichtigungen.email')"
                                    :checked="kanalAn(typ.id, 'email')" :disabled="!mail.mailAktiv"
                                    @change="setzeKanal(typ.id, 'email', $event.target.checked)">
                                <span v-else class="gedaempft" :title="t('settings.benachrichtigungen.nurBrowser')">—</span>
                            </td>
                            <td>
                                <select v-if="SCHWELLEN[typ.id]" class="wahl"
                                    v-model.number="SCHWELLEN[typ.id].ref().value"
                                    @change="radarSpeichern(SCHWELLEN[typ.id].spalte)">
                                    <option v-for="[wert, schluessel] in SCHWELLEN[typ.id].optionen"
                                        :key="wert" :value="wert">{{ t('settings.' + schluessel, { n: wert }) }}</option>
                                </select>
                            </td>
                            <!-- Märkte: bisher nur die Divergenz beobachtet
                                 einzelne Coins. Leer = die eigenen Märkte. -->
                            <td>
                                <div v-if="typ.id === 'fundingDivergenz'" class="div-wahl">
                                    <button type="button" class="wahl div-knopf"
                                        :disabled="!radarFundingDivergenz" @click="divergenzOeffnen">
                                        <span v-if="divergenzGewaehlt.length">{{ divergenzLabel }}</span>
                                        <span v-else class="gedaempft">{{ t('settings.benachrichtigungen.divergenzEigene') }}</span>
                                        <Symbol name="runter" :groesse="14" class="pfeil" />
                                    </button>
                                    <template v-if="divergenzOffen">
                                        <div class="div-hinter" @click="divergenzOffen = false"></div>
                                        <div class="div-liste">
                                            <input type="text" class="suche"
                                                v-model="divergenzSuche" :placeholder="t('settings.benachrichtigungen.divergenzSuche')" />
                                            <div class="div-zeile" @click="divergenzLeeren">
                                                <span class="kasten" :class="{ an: !divergenzGewaehlt.length }">
                                                    <Symbol v-if="!divergenzGewaehlt.length" name="haken" :groesse="12" />
                                                </span>
                                                {{ t('settings.benachrichtigungen.divergenzEigene') }}
                                            </div>
                                            <div v-if="divergenzLaedt" class="div-info">
                                                {{ t('settings.benachrichtigungen.divergenzLaedt') }}
                                            </div>
                                            <div v-for="s in divergenzTreffer" :key="s" class="div-zeile"
                                                @click="divergenzUmschalten(s)">
                                                <span class="kasten" :class="{ an: divergenzGewaehlt.includes(s) }">
                                                    <Symbol v-if="divergenzGewaehlt.includes(s)" name="haken" :groesse="12" />
                                                </span>
                                                {{ kurzCoin(s) }}
                                            </div>
                                            <div class="div-info">
                                                {{ t('settings.benachrichtigungen.divergenzAnzahl', { n: divergenzGewaehlt.length, max: DIVERGENZ_MAX }) }}
                                            </div>
                                        </div>
                                    </template>
                                    <span class="unterzeile">{{ t('settings.benachrichtigungen.divergenzHinweis') }}</span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="fusszeile">{{ t('settings.benachrichtigungen.kanalHinweis') }}</p>

            <!-- Wo die Ereignisse stehen, die hier fehlen. Ohne diese Zeile
                 sucht man den Lagebericht in der Tabelle und hält sein
                 Fehlen für einen Fehler. -->
            <p v-if="meldeAnderswo.length" class="fusszeile mit-symbol">
                <Symbol name="info" :groesse="14" />
                <span>{{ t('settings.benachrichtigungen.anderswo', {
                    was: meldeAnderswo.map(typ => t('settings.benachrichtigungen.typ_' + typ.id)).join(', ')
                }) }}</span>
            </p>
        </Karte>

        <!--=============== E-MAIL ===============-->
        <Karte :titel="t('settings.benachrichtigungen.mailTitel')" :unter="t('settings.benachrichtigungen.mailEinleitung')">
            <SchrittMailKonfiguration v-model:mail="mail" ref="mailKonfigRef" />
        </Karte>
    </div>
</template>

<style scoped>
.benachrichtigungen {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
}

/* Matrix: scrollt am Telefon in sich, nie die Seite. */
.matrix-rahmen {
    margin-top: var(--abstand-3);
    overflow-x: auto;
}
.matrix {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
}
.matrix th {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--line-stark);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
}
.matrix td {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
}
.sp-ereignis { min-width: 15rem; }
.sp-kanal { width: 7rem; text-align: center !important; }
.sp-wahl { min-width: 13rem; }
.mitte { text-align: center; }
.gruppe {
    padding-top: var(--abstand-3) !important;
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.unterzeile {
    display: block;
    margin-top: 0.15rem;
    color: var(--muted);
    font-size: 0.76rem;
}
.gedaempft { color: var(--muted); }
.haken {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--accent);
    cursor: pointer;
}
.haken:disabled { cursor: not-allowed; opacity: 0.45; }
.wahl {
    width: 100%;
    padding: 0.35rem 0.6rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    font: inherit;
    font-size: 0.85rem;
}
.wahl:focus { outline: none; border-color: var(--accent); }
.wahl:disabled { opacity: 0.55; cursor: not-allowed; }
.fusszeile {
    margin: var(--abstand-2) 0 0;
    color: var(--muted);
    font-size: 0.8rem;
}
.mit-symbol {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
}

/* Coin-Auswahl des Divergenz-Alarms. Eigenes Aufklappfeld statt eines
   <select multiple>: aus über 500 Perps sucht man ohne Suchfeld nicht, und
   ein mehrzeiliges Auswahlfeld sprengt die Tabellenzeile. */
.div-wahl { position: relative; }
.div-knopf {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-align: left;
    cursor: pointer;
}
.div-knopf > span:first-child {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.div-knopf .pfeil { flex: none; color: var(--muted); }

/* Fängt den Klick daneben ab — sonst bliebe die Liste offen stehen. */
.div-hinter {
    position: fixed;
    inset: 0;
    z-index: 1040;
}
.div-liste {
    position: absolute;
    z-index: 1050;
    top: calc(100% + 0.25rem);
    right: 0;
    width: 15rem;
    max-height: 18rem;
    overflow-y: auto;
    padding: 0.25rem;
    background: var(--panel-soft);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    box-shadow: var(--schatten);
}
.suche {
    width: 100%;
    margin-bottom: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    font: inherit;
    font-size: 0.85rem;
}
.suche:focus { outline: none; border-color: var(--accent); }
.div-zeile {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-klein);
    white-space: nowrap;
    cursor: pointer;
}
.div-zeile:hover { background: var(--accent-flaeche); }
.kasten {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1rem;
    height: 1rem;
    border: 1px solid var(--line-stark);
    border-radius: 4px;
    color: var(--on-accent);
}
.kasten.an {
    background: var(--accent);
    border-color: var(--accent);
}
.div-info {
    padding: 0.4rem 0.3rem 0.2rem;
    color: var(--muted);
    font-size: 0.75rem;
}
</style>
