<script setup>
/**
 * Coin-Ansicht, Karte «Radar-Messung»: was die Einzelprüfung des Coin-Radars
 * gemessen hat (`server/coin-radar/einzel.js`) — Note, Teilnoten, Kennzahlen
 * je Zeiteinheit, Ausführung je Börse, Bezug zu Bitcoin.
 *
 * Dieselben Zahlen und dieselben Vermerke wie in der früheren Einzelprüfungs-
 * Karte; nichts davon ist weggefallen, nichts wird hier gerechnet. Die Note
 * misst einen Zustand (wie viel gerade los ist und was das Handeln kostet),
 * keine Richtung.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Karte from '../basis/Karte.vue'
import Pille from '../basis/Pille.vue'
import Hinweis from '../basis/Hinweis.vue'
import InfoTipp from '../InfoTipp.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { kopplungsDeutung, boersenNachRundlauf } from '../../utils/coinAnsicht.js'
import { BOERSE_KURZ, BOERSE_NAME } from '../../utils/boersenLinks.js'

const props = defineProps({
    bericht: { type: Object, required: true },
    /** Schwellen des Servers (`kopplungFest`, `kopplungLose`, `btcZeiteinheit`). */
    konstanten: { type: Object, default: () => ({}) },
})
const { t, te } = useI18n()
const { zahl, gross, uhr } = useCoinFormat()

const b = computed(() => props.bericht)
const bewertet = computed(() => b.value.status === 'bewertet')
const haupt = computed(() => b.value.jeZeiteinheit?.[b.value.haupt] || {})
const noteTon = computed(() => (b.value.note >= 60 ? 'akzent' : b.value.note >= 40 ? 'neutral' : 'warn'))
const grundText = (g) => (te('coinradar.grund_' + g) ? t('coinradar.grund_' + g) : g)

/** Nur die Zeiteinheiten — `jeZeiteinheit` trägt daneben `hinweise` und `bestaetigt`. */
const zeilen = computed(() => (b.value.zeiteinheiten || [])
    .filter((ze) => b.value.jeZeiteinheit?.[ze] && typeof b.value.jeZeiteinheit[ze] === 'object')
    .map((ze) => ({ ze, ...b.value.jeZeiteinheit[ze] })))
const boersen = computed(() => boersenNachRundlauf(b.value.ausfuehrung?.jeBoerse))
const passtNicht = computed(() => boersen.value.filter(([, v]) => !v.passt5k).map(([name]) => name))
const kopplung = computed(() => kopplungsDeutung(b.value.btc?.korrelation, props.konstanten))
const fundingTon = computed(() => {
    const z = Math.abs(Number(b.value.fundingJahresRate))
    return !Number.isFinite(z) || z < 25 ? '' : z >= 50 ? 'ca-schlecht' : 'ca-warn'
})
const kennzahlen = computed(() => [
    { id: 'atr', name: `ATR % ${b.value.haupt}`, wert: zahl(haupt.value.atrPct, 2), info: 'coinradar.spalteAtrHilfe' },
    { id: 'rvol', name: 'RVOL', wert: zahl(haupt.value.rvol, 2), info: 'coinradar.spalteRvolHilfe' },
    { id: 'adx', name: 'ADX', wert: zahl(haupt.value.adx, 0), info: 'coinradar.spalteAdxHilfe' },
    { id: 'umsatz', name: t('coinradar.epUmsatz'), wert: gross(b.value.umsatz24h, 1), info: 'coinradar.spalteUmsatzHilfe' },
    { id: 'spread', name: t('coinradar.spalteSpread'), wert: zahl(b.value.spreadBp, 2) },
    { id: 'funding', name: t('coinradar.spalteFunding'), wert: zahl(b.value.fundingJahresRate, 1), klasse: fundingTon.value, info: 'coinradar.spalteFundingHilfe' },
])
</script>

<template>
    <Karte :titel="t('coinAnsicht.messung')" :unter="t('coinAnsicht.messungUnter', { zeit: uhr(b.gemessenAm), ze: b.haupt })">
        <template #aktionen>
            <Pille v-if="bewertet" :ton="noteTon" gross :title="t('coinradar.spalteNoteHilfe')">{{ t('coinAnsicht.note', { n: b.note }) }}</Pille>
            <Pille :ton="b.vergleichbar ? 'neutral' : 'warn'"
                :title="b.vergleichbar ? t('coinradar.epQuelleBinanceHilfe') : t('coinradar.epQuelleBitunixHilfe')">
                {{ b.vergleichbar ? t('coinradar.epQuelleBinance') : t('coinradar.epQuelleBitunix') }}
            </Pille>
        </template>

        <!-- Was an dieser Messung anders ist als in der Rangliste — oben, nicht im Kleingedruckten. -->
        <div v-if="!b.vergleichbar || !b.aufBitunix || (b.huerde && !b.huerde.ok)" class="vermerke">
            <Hinweis v-if="!b.vergleichbar" art="info">{{ t('coinradar.epNichtVergleichbar') }}</Hinweis>
            <Hinweis v-if="!b.aufBitunix" art="warn">{{ t('coinradar.epNichtAufBitunix') }}</Hinweis>
            <!-- Die Hürden gelten, aber sie brechen hier nichts ab. -->
            <Hinweis v-if="b.huerde && !b.huerde.ok" art="warn">{{ t('coinradar.epHuerdeGerissen', { g: grundText(b.huerde.grund) }) }}</Hinweis>
        </div>

        <!-- Zu jung für eine Bewertung: Klartext statt einer Note aus zu wenigen Kerzen. -->
        <Hinweis v-if="!bewertet" art="info" :titel="t('coinradar.epZuJung', { n: b.kerzenAnzahl, ze: b.haupt, min: b.mindestKerzen })">
            {{ t('coinradar.epZuJungHinweis') }}
        </Hinweis>

        <template v-else>
            <div class="ca-fakten sechs">
                <div v-for="k in kennzahlen" :key="k.id" class="ca-fakt">
                    <span class="name">{{ k.name }}<InfoTipp v-if="k.info" :schluessel="k.info" /></span>
                    <span :class="['wert', k.klasse]">{{ k.wert }}</span>
                </div>
            </div>

            <div class="teile">
                <div>
                    <h4 class="ca-h4">{{ t('coinradar.teilnoten') }}</h4>
                    <ul class="ca-balken">
                        <li v-for="(wert, feld) in b.teilnoten" :key="feld">
                            <span class="name">{{ t('coinradar.note_' + feld) }}</span>
                            <span class="spur"><i :style="{ width: Math.round(wert) + '%' }"></i></span>
                            <b>{{ Math.round(wert) }}</b>
                        </li>
                    </ul>
                    <p v-if="b.hinweise?.length" class="ca-klein ca-fuss">{{ b.hinweise.join(' · ') }}</p>
                </div>

                <div>
                    <h4 class="ca-h4">{{ t('coinradar.jeZeiteinheit') }}</h4>
                    <table class="ca-tabelle">
                        <thead>
                            <tr><th scope="col"><span class="ca-nur-sr">{{ t('coinAnsicht.zeiteinheit') }}</span></th><th scope="col">ATR %</th><th scope="col">RVOL</th><th scope="col">ADX</th><th scope="col">{{ t('coinradar.kerzen') }}</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="m in zeilen" :key="m.ze">
                                <th scope="row">{{ m.ze }}</th>
                                <td>{{ zahl(m.atrPct, 2) }}</td><td>{{ zahl(m.rvol, 2) }}</td><td>{{ zahl(m.adx, 0) }}</td><td>{{ m.kerzen }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div v-if="boersen.length">
                    <h4 class="ca-h4">{{ t('coinradar.ausfuehrung5k') }}</h4>
                    <table class="ca-tabelle">
                        <thead>
                            <tr>
                                <th scope="col"><span class="ca-nur-sr">{{ t('coinAnsicht.boerse') }}</span></th>
                                <th scope="col">{{ t('coinradar.spKauf') }}</th><th scope="col">{{ t('coinradar.spVerkauf') }}</th>
                                <th scope="col">{{ t('coinradar.spRund') }}</th><th scope="col">{{ t('coinradar.spTiefe25') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="[name, v] in boersen" :key="name" :class="{ beste: name === b.ausfuehrung?.beste?.boerse }">
                                <th scope="row" :title="BOERSE_NAME[name] || name">{{ BOERSE_KURZ[name] || name }}</th>
                                <td>{{ zahl(v.slippageKaufBp, 1) }}</td><td>{{ zahl(v.slippageVerkaufBp, 1) }}</td>
                                <td>{{ zahl(v.rundlaufBp, 1) }}</td><td>{{ gross(v.tiefe25Bp, 1) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <p v-for="name in passtNicht" :key="name" class="ca-klein ca-fuss">{{ t('coinradar.passtNicht', { b: BOERSE_NAME[name] || name }) }}</p>
                </div>

                <div>
                    <h4 class="ca-h4">
                        {{ t('coinradar.btcTitel', { ze: b.btc?.zeiteinheit || konstanten.btcZeiteinheit || '4h' }) }}<InfoTipp schluessel="coinradar.btcNichtInNote" />
                    </h4>
                    <dl v-if="b.btc" class="ca-profil">
                        <div>
                            <dt>{{ t('coinradar.btcKopplung') }}</dt>
                            <dd><b>{{ Math.round(b.btc.korrelation * 100) }} %</b> <span class="ca-klein">{{ t('coinradar.kopplung_' + kopplung) }}</span></dd>
                        </div>
                        <div><dt>{{ t('coinradar.spalteBeta') }}</dt><dd>{{ zahl(b.btc.beta, 2) }}</dd></div>
                        <div><dt>{{ t('coinradar.btcPunkte') }}</dt><dd>{{ b.btc.punkte }}</dd></div>
                    </dl>
                    <p v-else class="ca-klein">{{ t('coinradar.epBtc_' + (b.btcGrund || 'nicht_messbar'), { n: b.btcKerzen ?? 0 }) }}</p>
                </div>
            </div>
        </template>
    </Karte>
</template>

<style scoped>
.vermerke {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
}

.teile {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.2rem 1.6rem;
}

.beste th,
.beste td {
    color: var(--accent);
}

@media (max-width: 639.98px) {
    .teile {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
