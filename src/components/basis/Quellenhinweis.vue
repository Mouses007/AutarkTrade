<script setup>
/**
 * Quellenhinweis: die kleine Zeile unter einer Anzeige, die sagt, woher die
 * Zahlen kommen — und, wo ein Anbieter es verlangt, die Pflicht-Attribution
 * („Powered by CoinGecko“, „Quelle: Alternative.me“, „Daten: CryptoQuant“).
 *
 * Gebaut in S6, angehängt an jede Anzeige wird er in S12 (Verkaufs-Prüfung
 * Abschn. 3.3 Punkt 2). Darum nimmt er Quellen als Daten, nicht als Text: so
 * kann eine Registry (z. B. `quelle` in `src/config/marktradar.js`) sie
 * zentral pflegen, und der Wortlaut der Pflichtzeile steht an EINER Stelle.
 *
 * Arten je Quelle:
 *   daten   → „Daten: Binance“             (Herkunft, keine Pflicht)
 *   quelle  → „Quelle: Alternative.me“     (Nennungspflicht)
 *   powered → „Powered by CoinGecko“        (Wortlaut vom Anbieter vorgegeben)
 *   ki      → „KI-generiert · Claude“       (Kennzeichnung eines KI-Textes)
 *
 *   <Quellenhinweis :quellen="[{ name: 'Alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/', art: 'quelle' }]" />
 *   <Quellenhinweis :quellen="[{ name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' }, { name: 'Binance' }]" />
 *   <Quellenhinweis>Eigene Aufzeichnung (Binance forceOrder)</Quellenhinweis>
 *
 * Links öffnen in einem neuen Tab ohne Referrer. Der Hinweis ist bewusst leise
 * (gedämpft, klein) — aber nie ausgeblendet: eine Pflicht-Attribution, die man
 * erst aufklappen muss, ist keine „gut sichtbar direkt neben den Daten“.
 */
import { computed } from 'vue'
import Symbol from './Symbol.vue'

const props = defineProps({
    /** [{ name, url?, art?: 'daten'|'quelle'|'powered'|'ki' }] — Reihenfolge bleibt. */
    quellen: { type: Array, default: () => [] },
    /** Rechtsbündig (unter Diagrammen) statt linksbündig. */
    rechts: { type: Boolean, default: false },
    /** Beschriftungen, falls eine Seite übersetzt (Vorgabe Deutsch). */
    worte: { type: Object, default: () => ({}) },
})

const WORTE = { daten: 'Daten:', quelle: 'Quelle:', powered: 'Powered by', ki: 'KI-generiert ·' }
const wort = (art) => props.worte[art] ?? WORTE[art] ?? WORTE.daten

/*
 * Gleichartige Quellen ohne Pflichtwortlaut werden zusammengefasst
 * („Daten: Binance, Bybit“); `powered` und `ki` stehen immer einzeln, weil ihr
 * Wortlaut vorgegeben bzw. eine Kennzeichnung ist.
 */
const gruppen = computed(() => {
    const aus = []
    for (const q of props.quellen || []) {
        if (!q || !q.name) continue
        const art = q.art || 'daten'
        const letzte = aus[aus.length - 1]
        if (letzte && letzte.art === art && (art === 'daten' || art === 'quelle')) letzte.eintraege.push(q)
        else aus.push({ art, eintraege: [q] })
    }
    return aus
})
</script>

<template>
    <p v-if="gruppen.length || $slots.default" :class="['at-quellenhinweis', { rechts }]">
        <template v-for="(g, i) in gruppen" :key="i">
            <span v-if="i" class="trenner" aria-hidden="true">·</span>
            <span :class="['gruppe', g.art]">
                <Symbol v-if="g.art === 'ki'" name="ki" class="zeichen" />
                <span class="wort">{{ wort(g.art) }}</span>
                <template v-for="(q, j) in g.eintraege" :key="q.name">
                    <span v-if="j">, </span>
                    <a v-if="q.url" :href="q.url" target="_blank" rel="noopener noreferrer">{{ q.name }}</a>
                    <span v-else class="name">{{ q.name }}</span>
                </template>
            </span>
        </template>
        <template v-if="$slots.default">
            <span v-if="gruppen.length" class="trenner" aria-hidden="true">·</span>
            <span class="gruppe"><slot /></span>
        </template>
    </p>
</template>

<style scoped>
.at-quellenhinweis {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.15rem 0.4rem;
    margin: 0.4rem 0 0;
    font-size: 0.7rem;
    line-height: 1.4;
    color: var(--leise);
}

.at-quellenhinweis.rechts {
    justify-content: flex-end;
    text-align: right;
}

.gruppe {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.25rem;
}

.wort {
    color: var(--leise);
}

.name,
a {
    color: var(--muted);
}

a {
    text-decoration: none;
    border-bottom: 1px dotted var(--line-stark);
}

a:hover {
    color: var(--accent);
    border-bottom-color: var(--accent-rand);
}

/* Die KI-Kennzeichnung ist eine Aussage über den Text, keine Herkunft: in Akzent. */
.gruppe.ki .wort,
.gruppe.ki .zeichen {
    color: var(--accent);
}

.zeichen {
    align-self: center;
}

.trenner {
    color: var(--line-stark);
}
</style>
