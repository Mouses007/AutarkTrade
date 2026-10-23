<script setup>
/**
 * Übersicht: eine Zahl, ein Band, eine Liste.
 *
 * Oben der Gesamtwert in CHF mit der Veränderung seit gestern (aus dem
 * eigenen Tagesverlauf, keine Schätzung) und der Kurve. Darunter das
 * Verteilungsband — ein Klick auf ein Segment hebt den Coin in der Liste
 * hervor. Die Liste kann man nach Coin oder nach Ort lesen; dieselben Zahlen,
 * zwei Fragen („was habe ich?" / „wo liegt es?").
 *
 * Kleinstbestände (unter der Staubgrenze) und Posten ohne Kurs stehen nicht
 * im Weg, verschwinden aber auch nicht: eine Zeile sagt, wie viele es sind.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { uebersicht, abrufLaeuft, abrufQuelle, starteAbruf, staubZeigen, setzeStaub, verborgen, schalteVerborgen,
    chf, menge, prozent, vorZeit, farbeVon } from '../../stores/portfolio.js'
import { Karte, Knopf, Reiter, Hinweis, Leerzustand, Symbol, Pille } from '../basis/index.js'

const { t } = useI18n()
const router = useRouter()

const u = computed(() => uebersicht.value)
const sicht = ref((() => { try { return localStorage.getItem('at.portfolio.sicht') || 'coin' } catch { return 'coin' } })())
function setzeSicht(v) { sicht.value = v; try { localStorage.setItem('at.portfolio.sicht', v) } catch { /* */ } }
const markiert = ref(null)
const offen = ref(new Set())
function klappe(k) { const s = new Set(offen.value); s.has(k) ? s.delete(k) : s.add(k); offen.value = s }

const letzterAbruf = computed(() => Math.max(0, ...(u.value?.quellen || []).map((q) => q.letzterAbruf || 0)) || null)

// ── Veränderung seit gestern (eigener Tagesverlauf) ──
const verlauf = computed(() => u.value?.verlauf || [])
const gestern = computed(() => {
    const v = verlauf.value
    if (v.length < 2) return null
    const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
    const frueher = v.filter((x) => x.datum < heute)
    return frueher.length ? frueher[frueher.length - 1] : null
})
const delta = computed(() => (gestern.value && u.value ? u.value.gesamt.chf - gestern.value.chf : null))

// ── Kurve ──
const kurve = computed(() => {
    const v = verlauf.value.slice(-90)
    if (v.length < 2) return null
    const w = 600, h = 64
    const min = Math.min(...v.map((x) => x.chf)), max = Math.max(...v.map((x) => x.chf))
    const span = max - min || 1
    const pts = v.map((x, i) => [(i / (v.length - 1)) * w, h - 4 - ((x.chf - min) / span) * (h - 8)])
    const linie = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    return { w, h, linie, flaeche: `${linie} L${w},${h} L0,${h} Z`, steigt: v.at(-1).chf >= v[0].chf, von: v[0].datum }
})

// ── Posten ──
const alle = computed(() => u.value?.posten || [])
// Ohne Kurs: ein Coin an einer Börse ist echter Bestand (CSPR bei Bitget,
// dort nicht mehr gehandelt) und bleibt sichtbar; ein Token auf der Kette
// ohne verlässlichen Kurs ist fast immer ungefragt zugeschickter Spam.
const verbergen = (p) => p.staub || (p.ohneKurs && p.kontrakt)
const sichtbar = computed(() => alle.value.filter((p) => staubZeigen.value || !verbergen(p)))
const versteckt = computed(() => alle.value.length - sichtbar.value.length)
const band = computed(() => {
    const mitWert = alle.value.filter((p) => p.chf > 0)
    const top = mitWert.slice(0, 7)
    const rest = mitWert.slice(7).reduce((s, p) => s + p.anteil, 0)
    const teile = top.map((p) => ({ key: p.schluessel, asset: p.asset, anteil: p.anteil, farbe: farbeVon(p.asset) }))
    if (rest > 0.001) teile.push({ key: '_rest', asset: t('portfolio.rest'), anteil: rest, farbe: 'var(--line-stark)' })
    return teile
})
function markiere(key) {
    markiert.value = markiert.value === key ? null : key
    if (key !== '_rest' && markiert.value) {
        setzeSicht('coin')
        offen.value = new Set([key])
        requestAnimationFrame(() => document.getElementById('pf-p-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
}

// ── Orte ──
const boersen = computed(() => (u.value?.quellen || []).filter((q) => q.gruppe === 'boerse'))
const importe = computed(() => (u.value?.quellen || []).filter((q) => q.gruppe === 'import'))
const wallets = computed(() => (u.value?.wallets || []))
const fehlerQuellen = computed(() => (u.value?.quellen || []).filter((q) => q.status === 'fehler'))
const ortName = (quelle) => {
    const q = (u.value?.quellen || []).find((x) => x.quelle === quelle)
    if (!q) return quelle
    if (q.gruppe === 'boerse' || q.gruppe === 'import') return q.name
    const w = wallets.value.find((x) => x.id === q.walletId)
    return w ? `${w.name} · ${q.name}` : q.name
}
const postenSichtbar = (liste) => liste.filter((p) => staubZeigen.value || (p.ohneKurs ? !p.schluessel.includes('|') : (p.chf ?? 0) >= (u.value?.staubChf ?? 1)))
const sortiert = (liste) => [...liste].sort((a, b) => (b.chf || 0) - (a.chf || 0))

function abgleichText(a) {
    if (!a) return null
    if (a.stimmt) return { ton: 'gut', text: t('portfolio.abgleichStimmt'), titel: t('portfolio.abgleichStimmtInfo', { n: a.bewegungen }) }
    if (!a.vollstaendig) return { ton: 'neutral', text: t('portfolio.abgleichTeilweise'), titel: t('portfolio.abgleichTeilweiseInfo') }
    return { ton: 'warn', text: t('portfolio.abgleichAbweichung', { n: a.abweichungen.length }), titel: a.abweichungen.map((x) => `${x.asset}: ${menge(x.differenz)}`).join('\n') }
}
const statusTon = (s) => (s === 'ok' ? 'gut' : s === 'fehler' ? 'schlecht' : s === 'nichtEingerichtet' ? 'warn' : 'neutral')
</script>

<template>
    <div v-if="u">
        <!-- ── Kopf: Gesamtwert ── -->
        <Karte class="pf-held">
            <div class="pf-held-oben">
                <span class="pf-etikett">{{ t('portfolio.gesamtwert') }}</span>
                <div class="pf-held-knoepfe">
                    <Knopf art="leise" klein nur-symbol :symbol="verborgen ? 'augeAus' : 'auge'" :titel="t('portfolio.verbergen')" @click="schalteVerborgen" />
                    <Knopf klein symbol="aktualisieren" :laedt="abrufLaeuft" @click="starteAbruf()">
                        <template v-if="abrufLaeuft">{{ abrufQuelle ? t('portfolio.holtQuelle', { q: ortName(abrufQuelle) }) : t('portfolio.holt') }}</template>
                        <template v-else>{{ t('portfolio.aktualisieren') }}</template>
                    </Knopf>
                </div>
            </div>
            <div class="pf-wert">{{ chf(u.gesamt.chf) }}</div>
            <div class="pf-unterzeile">
                <span v-if="delta != null" :class="delta >= 0 ? 'at-gut' : 'at-schlecht'">
                    {{ chf(delta, { vorzeichen: true }) }}
                    <template v-if="gestern?.chf">({{ ((delta / gestern.chf) * 100).toFixed(1) }} %)</template>
                    <span class="at-gedaempft"> {{ t('portfolio.seitGestern') }}</span>
                </span>
                <span class="at-gedaempft">{{ t('portfolio.stand', { zeit: vorZeit(letzterAbruf) }) }}</span>
                <span class="at-gedaempft" :title="t('portfolio.fxInfo')">1 USD = {{ u.fx.chf.toFixed(4) }} CHF · {{ u.fx.quelle }}</span>
            </div>
            <svg v-if="kurve" class="pf-kurve" :viewBox="`0 0 ${kurve.w} ${kurve.h}`" preserveAspectRatio="none" aria-hidden="true">
                <path :d="kurve.flaeche" :class="kurve.steigt ? 'auf' : 'ab'" class="flaeche" />
                <path :d="kurve.linie" :class="kurve.steigt ? 'auf' : 'ab'" class="linie" vector-effect="non-scaling-stroke" />
            </svg>
            <!-- Verteilungsband -->
            <div v-if="band.length" class="pf-band" role="list">
                <button v-for="b in band" :key="b.key" type="button" role="listitem" class="pf-band-teil"
                    :class="{ aus: markiert && markiert !== b.key }"
                    :style="{ flexGrow: b.anteil, background: b.farbe }" :title="`${b.asset} ${prozent(b.anteil)}`"
                    @click="markiere(b.key)" />
            </div>
            <div v-if="band.length" class="pf-legende">
                <button v-for="b in band" :key="b.key" type="button" class="pf-legende-teil" :class="{ aus: markiert && markiert !== b.key }" @click="markiere(b.key)">
                    <span class="punkt" :style="{ background: b.farbe }" />{{ b.asset }} <span class="at-gedaempft">{{ prozent(b.anteil) }}</span>
                </button>
            </div>
        </Karte>

        <Hinweis v-for="q in fehlerQuellen" :key="q.quelle" art="fehler" class="at-mo-3" :titel="t('portfolio.quelleFehler', { q: ortName(q.quelle) })">
            {{ q.meldung }} <span class="at-gedaempft">· {{ t('portfolio.zeigtLetzten') }}</span>
        </Hinweis>
        <Hinweis v-if="u.marktFehler" art="warn" class="at-mo-3">{{ t('portfolio.marktFehler') }}</Hinweis>

        <Leerzustand v-if="!u.quellen.length" class="at-mo-4" symbol="muenzen" :titel="t('portfolio.leerTitel')" :text="t('portfolio.leerText')">
            <div class="at-flex at-luecke-2 at-zentriert at-umbruch">
                <Knopf art="haupt" symbol="plus" @click="router.push('/portfolio/quellen')">{{ t('portfolio.quellenEinrichten') }}</Knopf>
            </div>
        </Leerzustand>

        <Leerzustand v-else-if="!alle.length && abrufLaeuft" class="at-mo-4" symbol="aktualisieren" :titel="t('portfolio.ersterAbrufTitel')" :text="t('portfolio.ersterAbrufText')" />

        <template v-else>
            <!-- ── Sicht-Umschalter ── -->
            <div class="pf-leiste at-mo-4">
                <Reiter :model-value="sicht" :reiter="[{ id: 'coin', titel: t('portfolio.nachCoin'), symbol: 'muenzen' }, { id: 'ort', titel: t('portfolio.nachOrt'), symbol: 'gebaeude' }]" @update:model-value="setzeSicht" />
                <button v-if="versteckt || staubZeigen" type="button" class="pf-staub" @click="setzeStaub(!staubZeigen)">
                    <Symbol :name="staubZeigen ? 'augeAus' : 'auge'" :groesse="14" />
                    {{ staubZeigen ? t('portfolio.staubVerbergen') : t('portfolio.staubZeigen', { n: versteckt, grenze: chf(u.staubChf) }) }}
                </button>
            </div>

            <!-- ── Nach Coin ── -->
            <div v-if="sicht === 'coin'" class="pf-liste">
                <div v-for="p in sichtbar" :id="'pf-p-' + p.schluessel" :key="p.schluessel" class="pf-zeile" :class="{ markiert: markiert === p.schluessel, offen: offen.has(p.schluessel) }">
                    <button type="button" class="pf-zeile-kopf" @click="klappe(p.schluessel)">
                        <span class="pf-coin" :style="{ '--f': farbeVon(p.asset) }">{{ p.asset.slice(0, 1) }}</span>
                        <span class="pf-name">
                            <b>{{ p.asset }}</b>
                            <small class="at-gedaempft">{{ menge(p.menge) }}<template v-if="p.orte.length > 1"> · {{ t('portfolio.anOrten', { n: p.orte.length }) }}</template></small>
                        </span>
                        <span class="pf-anteil" :title="prozent(p.anteil)"><span :style="{ width: Math.max(2, p.anteil * 100) + '%', background: farbeVon(p.asset) }" /></span>
                        <span class="pf-betrag">
                            <b v-if="!p.ohneKurs">{{ chf(p.chf) }}</b>
                            <span v-else class="at-gedaempft" :title="p.kursQuelle">{{ t('portfolio.keinKurs') }}</span>
                            <small class="at-gedaempft">{{ p.ohneKurs ? '' : prozent(p.anteil) }}</small>
                        </span>
                        <Symbol name="runter" :groesse="16" class="pf-pfeil" />
                    </button>
                    <div v-if="offen.has(p.schluessel)" class="pf-orte">
                        <div v-for="o in p.orte" :key="o.quelle + o.ort" class="pf-ort">
                            <span>{{ ortName(o.quelle) }}<span v-if="o.ortName && !['spot', 'konto', 'btc', 'sol'].includes(o.ort)" class="at-gedaempft"> · {{ o.ortName }}</span></span>
                            <span class="at-gedaempft">{{ menge(o.menge) }}</span>
                            <span>{{ chf(o.chf) }}</span>
                        </div>
                        <div class="pf-ort-fuss at-gedaempft">
                            <span v-if="p.usdKurs != null">1 {{ p.asset }} = {{ p.usdKurs.toLocaleString('de-CH', { maximumSignificantDigits: 6 }) }} USD · {{ p.kursQuelle }}</span>
                            <span v-else>{{ p.kursQuelle }}</span>
                            <span v-if="p.kontrakt" class="pf-kontrakt" :title="p.kontrakt">{{ p.kontrakt.slice(0, 8) }}…</span>
                            <router-link :to="{ path: '/portfolio/bewegungen', query: { asset: p.asset } }">{{ t('portfolio.bewegungenZu', { a: p.asset }) }} →</router-link>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ── Nach Ort ── -->
            <div v-else class="pf-orte-raster">
                <section v-if="boersen.length">
                    <h3 class="pf-gruppe">{{ t('portfolio.boersen') }}</h3>
                    <Karte v-for="q in boersen" :key="q.quelle" dicht class="pf-ort-karte">
                        <div class="pf-ort-kopf">
                            <span class="pf-ort-titel">{{ q.name }}</span>
                            <Pille :ton="statusTon(q.status)" :title="q.meldung || ''">{{ q.status === 'ok' ? vorZeit(q.letzterAbruf) : (abrufLaeuft && q.status === 'neu' ? t('portfolio.wirdGelesen') : t('portfolio.status_' + q.status)) }}</Pille>
                            <Pille v-if="abgleichText(q.abgleich)" :ton="abgleichText(q.abgleich).ton" :title="abgleichText(q.abgleich).titel">{{ abgleichText(q.abgleich).text }}</Pille>
                            <b class="at-ml-auto">{{ chf(q.chf) }}</b>
                        </div>
                        <div v-for="p in postenSichtbar(sortiert(q.posten))" :key="p.schluessel + p.ort" class="pf-ort">
                            <span><span class="punkt" :style="{ background: farbeVon(p.asset) }" />{{ p.asset }}<span v-if="p.ort === 'bots'" class="at-gedaempft"> · Bots</span></span>
                            <span class="at-gedaempft">{{ menge(p.menge) }}</span>
                            <span>{{ p.ohneKurs ? t('portfolio.keinKurs') : chf(p.chf) }}</span>
                        </div>
                        <p v-if="q.meldung && q.status !== 'fehler'" class="pf-meldung">{{ q.meldung }}</p>
                    </Karte>
                </section>
                <section v-if="importe.length">
                    <h3 class="pf-gruppe">{{ t('portfolio.importiert') }}</h3>
                    <Karte v-for="q in importe" :key="q.quelle" dicht class="pf-ort-karte">
                        <div class="pf-ort-kopf">
                            <span class="pf-ort-titel">{{ q.name }}</span>
                            <Pille ton="neutral" :title="q.meldung || ''">{{ t('portfolio.ausDatei') }}</Pille>
                            <Pille v-if="q.uebergeben" ton="akzent" :title="t('portfolio.ueInfo')">{{ t('portfolio.ueAn', { an: q.uebergeben.an }) }}</Pille>
                            <b class="at-ml-auto">{{ chf(q.chf) }}</b>
                        </div>
                        <div v-for="p in postenSichtbar(sortiert(q.posten))" :key="p.schluessel + p.ort" class="pf-ort">
                            <span><span class="punkt" :style="{ background: farbeVon(p.asset) }" />{{ p.asset }}</span>
                            <span class="at-gedaempft">{{ menge(p.menge) }}</span>
                            <span>{{ p.ohneKurs ? t('portfolio.keinKurs') : chf(p.chf) }}</span>
                        </div>
                        <p v-if="!q.posten.length" class="pf-meldung">{{ q.uebergeben ? t('portfolio.ueAlles') : t('portfolio.leerGeraeumt') }}</p>
                    </Karte>
                </section>
                <section v-if="wallets.length">
                    <h3 class="pf-gruppe">{{ t('portfolio.wallets') }}</h3>
                    <Karte v-for="w in wallets" :key="w.id" dicht class="pf-ort-karte">
                        <div class="pf-ort-kopf">
                            <span class="pf-wallet-typ" :class="w.typ">{{ w.typName }}</span>
                            <span class="pf-ort-titel">{{ w.name }}</span>
                            <b class="at-ml-auto">{{ chf(w.chf) }}</b>
                        </div>
                        <div v-for="a in w.adressen" :key="a.quelle" class="pf-kette">
                            <div class="pf-kette-kopf">
                                <span>{{ a.name }} <code class="at-gedaempft">{{ a.anzeige }}</code></span>
                                <Pille :ton="statusTon(a.status)" :title="a.meldung || ''">{{ a.status === 'ok' ? vorZeit(a.letzterAbruf) : (abrufLaeuft && a.status === 'neu' ? t('portfolio.wirdGelesen') : t('portfolio.status_' + a.status)) }}</Pille>
                                <span class="at-ml-auto">{{ chf(a.chf) }}</span>
                            </div>
                            <div v-for="p in postenSichtbar(sortiert(a.posten))" :key="p.schluessel + p.ort" class="pf-ort">
                                <span><span class="punkt" :style="{ background: farbeVon(p.asset) }" />{{ p.asset }}<span v-if="p.ortName && a.kette === 'evm'" class="at-gedaempft"> · {{ p.ortName }}</span></span>
                                <span class="at-gedaempft">{{ menge(p.menge) }}</span>
                                <span>{{ p.ohneKurs ? t('portfolio.keinKurs') : chf(p.chf) }}</span>
                            </div>
                            <p v-if="a.meldung && a.status !== 'fehler'" class="pf-meldung">{{ a.meldung }}</p>
                        </div>
                        <p v-if="!w.adressen.length" class="pf-meldung">{{ t('portfolio.walletLeer') }}</p>
                    </Karte>
                </section>
            </div>
        </template>
    </div>
</template>

<style scoped>
.pf-held { border-left: 3px solid var(--accent); }
.pf-held-oben { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.pf-held-knoepfe { display: flex; gap: 0.4rem; align-items: center; }
.pf-etikett { font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.pf-wert { font-size: clamp(1.9rem, 5vw, 2.6rem); font-weight: 750; letter-spacing: -0.02em; margin-top: 0.15rem; font-variant-numeric: tabular-nums; }
.pf-unterzeile { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; font-size: 0.85rem; margin-top: 0.2rem; }
.pf-kurve { width: 100%; height: 64px; margin-top: 0.75rem; display: block; }
.pf-kurve .linie { fill: none; stroke-width: 2; }
.pf-kurve .linie.auf { stroke: var(--accent); }
.pf-kurve .linie.ab { stroke: var(--bad); }
.pf-kurve .flaeche.auf { fill: var(--accent-flaeche); }
.pf-kurve .flaeche.ab { fill: var(--bad-flaeche); }

.pf-band { display: flex; gap: 2px; height: 12px; border-radius: var(--radius-pille); overflow: hidden; margin-top: 1rem; }
.pf-band-teil { border: 0; padding: 0; min-width: 3px; cursor: pointer; transition: opacity 0.2s, transform 0.2s; }
.pf-band-teil:hover { transform: scaleY(1.3); }
.pf-band-teil.aus, .pf-legende-teil.aus { opacity: 0.3; }
.pf-legende { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin-top: 0.5rem; }
.pf-legende-teil { background: none; border: 0; color: var(--text); font: inherit; font-size: 0.8rem; cursor: pointer; padding: 0.1rem 0; display: inline-flex; align-items: center; gap: 0.35rem; }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.4rem; flex-shrink: 0; }
.pf-legende-teil .punkt { margin-right: 0; }

.pf-leiste { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.pf-staub { background: none; border: 0; color: var(--muted); font: inherit; font-size: 0.8rem; cursor: pointer; display: inline-flex; gap: 0.35rem; align-items: center; padding: 0.4rem 0; }
.pf-staub:hover { color: var(--accent); }

.pf-liste { margin-top: 0.5rem; }
.pf-zeile { border-bottom: 1px solid var(--line); transition: background 0.2s; }
.pf-zeile.markiert { background: var(--accent-flaeche); border-radius: var(--radius-klein); }
.pf-zeile-kopf {
    width: 100%; display: grid; grid-template-columns: 2.2rem minmax(0, 1fr) minmax(3rem, 9rem) auto 1.2rem;
    gap: 0.75rem; align-items: center; padding: 0.7rem 0.25rem; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.pf-zeile-kopf:hover .pf-pfeil { color: var(--accent); }
.pf-coin {
    width: 2.2rem; height: 2.2rem; border-radius: 50%; display: grid; place-items: center; font-weight: 700;
    background: color-mix(in srgb, var(--f) 20%, transparent); color: var(--f); border: 1px solid color-mix(in srgb, var(--f) 45%, transparent);
}
.pf-name { display: flex; flex-direction: column; min-width: 0; }
.pf-name b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-anteil { height: 6px; background: var(--panel-soft); border-radius: var(--radius-pille); overflow: hidden; }
.pf-anteil span { display: block; height: 100%; border-radius: var(--radius-pille); }
.pf-betrag { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
.pf-pfeil { color: var(--leise); transition: transform 0.2s; }
.pf-zeile.offen .pf-pfeil { transform: rotate(180deg); }
.pf-orte { padding: 0 0.25rem 0.8rem 3.2rem; }
.pf-ort { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(6.5rem, auto); gap: 0.75rem; font-size: 0.85rem; padding: 0.25rem 0; align-items: center; font-variant-numeric: tabular-nums; }
.pf-ort > span:last-child { text-align: right; }
.pf-ort-fuss { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; font-size: 0.75rem; margin-top: 0.35rem; }
.pf-ort-fuss a { color: var(--accent); text-decoration: none; margin-left: auto; }
.pf-kontrakt { font-family: var(--schrift-mono); }
@media (max-width: 560px) {
    .pf-zeile-kopf { grid-template-columns: 2rem minmax(0, 1fr) auto 1rem; }
    .pf-anteil { display: none; }
    .pf-orte { padding-left: 0.25rem; }
}

.pf-orte-raster { display: grid; gap: 1.25rem; margin-top: 1rem; }
@media (min-width: 1100px) { .pf-orte-raster { grid-template-columns: 1fr 1fr; align-items: start; } }
.pf-gruppe { font-size: 0.75rem; letter-spacing: 0.08em; color: var(--leise); margin: 0 0 0.5rem; font-weight: 600; text-transform: uppercase; }
.pf-ort-karte { margin-bottom: 0.75rem; }
.pf-ort-kopf { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding-bottom: 0.4rem; border-bottom: 1px solid var(--line); margin-bottom: 0.3rem; }
.pf-ort-titel { font-weight: 700; }
.pf-wallet-typ { font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.45rem; border-radius: var(--radius-klein); background: var(--panel-hoch); color: var(--muted); }
.pf-wallet-typ.ledger { color: #e8f4f6; background: #2a3238; }
.pf-wallet-typ.safepal { color: #7c8cf8; background: rgba(124, 140, 248, 0.15); }
.pf-wallet-typ.metamask { color: #f0a04b; background: rgba(240, 160, 75, 0.15); }
.pf-kette { padding: 0.35rem 0 0.2rem; border-bottom: 1px dashed var(--line); }
.pf-kette:last-of-type { border-bottom: 0; }
.pf-kette-kopf { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 600; flex-wrap: wrap; }
.pf-kette-kopf code { font-weight: 400; font-size: 0.75rem; }
.pf-kette .pf-ort { padding-left: 0.75rem; }
.pf-meldung { font-size: 0.75rem; color: var(--leise); margin: 0.35rem 0 0; }
</style>
