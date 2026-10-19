<script setup>
/**
 * Platzhalter statt Coin- oder Token-Logo: die Anfangsbuchstaben des Kürzels
 * auf einer Fläche, deren Ton aus dem Kürzel (oder dem Vertrag) abgeleitet ist.
 *
 * Warum kein Logo: Token-Bilder liegen bei DexScreener (von Herausgebern
 * hochgeladen) und bei CoinGecko (Site-Inhalte nur persönlich und nicht-
 * kommerziell, Terms 4(A)) — Verkaufs-Prüfung Z. 58, S12. Ein Bild nachzuladen
 * hiesse, fremde Inhalte in einem verkauften Programm anzuzeigen. Die
 * Initialen tragen dieselbe Funktion (Wiedererkennen in einer Liste) ohne das.
 *
 * Nur Design-Tokens: der Ton ist eine Mischung aus Akzent, Text und Warnfarbe
 * mit der Fläche — Grün und Rot bleiben Gewinn und Verlust vorbehalten.
 *
 *   <TickerZeichen symbol="PEPE" />
 *   <TickerZeichen :symbol="k.symbol" :schluessel="k.contract" klein />
 */
import { computed } from 'vue'

const props = defineProps({
    symbol: { type: String, default: '' },
    /** Woraus der Ton abgeleitet wird (Vertrag); ohne ihn das Kürzel. */
    schluessel: { type: String, default: '' },
    klein: { type: Boolean, default: false },
})

const initialen = computed(() => {
    const s = String(props.symbol || '').replace(/^\$/, '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase()
    return s.slice(0, 2) || '?'
})

/** Sechs Töne aus den Tokens — welcher, entscheidet ein kleiner Hash. */
const TOENE = [
    ['--accent', 22], ['--accent', 40], ['--text', 14], ['--text', 26], ['--warn', 22], ['--muted', 30],
]
const ton = computed(() => {
    const quelle = String(props.schluessel || props.symbol || '?')
    let h = 0
    for (const z of quelle) h = (h * 31 + z.codePointAt(0)) >>> 0
    const [farbe, anteil] = TOENE[h % TOENE.length]
    return {
        background: `color-mix(in srgb, var(${farbe}) ${anteil}%, var(--panel-soft))`,
        color: `var(${farbe === '--muted' ? '--text' : farbe})`,
    }
})
</script>

<template>
    <span :class="['at-tickerzeichen', { klein }]" :style="ton" aria-hidden="true">{{ initialen }}</span>
</template>

<style scoped>
.at-tickerzeichen {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-pille);
    border: 1px solid var(--line);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    user-select: none;
}
.at-tickerzeichen.klein {
    width: 1.35rem;
    height: 1.35rem;
    font-size: 0.6rem;
}
</style>
