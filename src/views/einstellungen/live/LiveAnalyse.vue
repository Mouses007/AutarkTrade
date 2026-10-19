<script setup>
/**
 * Live → Live-Analyse (Heatmap / Bookmap). Die Werte liegen im Live-Store und
 * speichern sich dort selbst in die settings-Tabelle.
 */
import { ref } from 'vue'
import InfoTipp from '@/components/InfoTipp.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import {
    liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp, liveShowProfile,
    livePauseInBackground, liveColorMode, liveColorRef, liveAutoFollow, liveThreshold, liveDotStep,
    liveShowLiquidations, livePrefillMin,
    VIEW_PCT_OPTIONS, FRAME_MS_OPTIONS, HISTORY_MIN_OPTIONS,
} from '@/stores/live.js'

let liveExpanded = ref(false)
</script>

<template>
    <Abschnitt titel="Live-Analyse · Heatmap / Bookmap" symbol="flamme" v-model:offen="liveExpanded">
        <p class="einleitung">Standardwerte für die Live-Ansicht. Änderungen im Seitenmenü der Live-Analyse landen ebenfalls hier — beides schreibt in dieselben Einstellungen. Die Daten kommen live vom öffentlichen Binance-Marktdaten-Stream; es wird nichts aufgezeichnet, die Historie beginnt beim Öffnen der Seite.</p>

        <Feld label="Markt">
            <select class="eingabe" v-model="liveMarket">
                <option value="futures">USDⓈ-M Futures (Perpetual)</option>
                <option value="spot">Spot</option>
            </select>
        </Feld>

        <Feld label="Preisband" hilfe="Sichtbarer Bereich um den Mittelkurs">
            <select class="eingabe" v-model.number="liveViewPct">
                <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
            </select>
        </Feld>

        <Feld label="Spaltentakt" hilfe="Zeit, die eine Pixelspalte abdeckt">
            <select class="eingabe" v-model.number="liveFrameMs">
                <option v-for="f in FRAME_MS_OPTIONS" :key="f" :value="f">{{ f }} ms</option>
            </select>
        </Feld>

        <Feld label="Historie im Speicher" hilfe="Länger = mehr Arbeitsspeicher">
            <select class="eingabe" v-model.number="liveHistoryMin">
                <option v-for="h in HISTORY_MIN_OPTIONS" :key="h" :value="h">{{ h ? h + ' Minuten' : 'Automatisch (doppelte Zeitspanne)' }}</option>
            </select>
        </Feld>

        <Feld>
            <template #label><span class="beschriftung">Farbrampe<InfoTipp schluessel="settings.info.liveRamp" /></span></template>
            <select class="eingabe" v-model="liveRamp">
                <option value="viridis">Viridis (violett → grün → gelb)</option>
                <option value="bookmap">Klassisch (blau → grün → gelb → rot)</option>
                <option value="journal">Journal (Blauton)</option>
            </select>
        </Feld>

        <Feld label="Farbskala" hilfe="Fest = Bilder über Zeit und Symbole vergleichbar">
            <div class="gruppe">
                <select class="eingabe" v-model="liveColorMode">
                    <option value="auto">Automatisch (95. Perzentil)</option>
                    <option value="fixed">Fester Sättigungswert</option>
                </select>
                <input v-if="liveColorMode === 'fixed'" class="eingabe" type="number" min="0"
                    step="0.1" v-model.number="liveColorRef" placeholder="z.B. 50" />
            </div>
        </Feld>

        <Feld label="Vorlauf beim Öffnen" hilfe="Nur aus eigener Aufzeichnung — Binance liefert keine vergangene Orderbuch-Tiefe. Eingeschaltet wird immer die volle Historienlänge geladen: der Server faltet die Antwort ohnehin auf rund 900 Spalten, weniger zu holen spart nichts und lässt die Karte links leer.">
            <select class="eingabe" v-model.number="livePrefillMin">
                <option :value="0">Aus (leer starten)</option>
                <option :value="5">5 Minuten</option>
                <option :value="15">15 Minuten</option>
                <option :value="30">30 Minuten</option>
                <option :value="60">60 Minuten</option>
            </select>
        </Feld>

        <Feld label="Liquiditätsschwelle" hilfe="Blendet schwache Liquidität aus — nur die Wände bleiben">
            <div class="regler">
                <input type="range" min="0" max="0.9" step="0.05" v-model.number="liveThreshold" />
                <span class="wert">{{ Math.round(liveThreshold * 100) }} %</span>
            </div>
        </Feld>

        <Feld label="Punkte zusammenfassen" hilfe="Bündelt Handelspunkte zu Blasen und bestimmt zugleich deren Grösse. Ganz links bleibt jede Spalte einzeln — dann verschmelzen die Punkte zu einem Band.">
            <div class="regler">
                <input type="range" min="1" max="30" step="1" v-model.number="liveDotStep" />
                <span class="wert">{{ liveDotStep === 1 ? 'aus' : liveDotStep + ' px' }}</span>
            </div>
        </Feld>

        <Feld label="Verhalten">
            <Schalter v-model="liveAutoFollow" label="Preisachse folgt dem Mittelkurs"
                hilfe="Aus = feste Achse, im Chart mit Ziehen verschiebbar" />
            <Schalter v-model="liveShowProfile" label="Volumenprofil einblenden" />
            <Schalter v-model="liveShowLiquidations" label="Zwangsliquidationen einzeichnen"
                hilfe="Nur Futures — tatsächlich ausgeführte Liquidationen als Rauten" />
            <Schalter v-model="livePauseInBackground" label="Im Hintergrund pausieren"
                hilfe="Empfohlen: der Browser drosselt versteckte Tabs, sonst verzerrt sich die Zeitachse" />
        </Feld>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.beschriftung { color: var(--text); }
.eingabe {
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.gruppe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
.gruppe .eingabe { flex: 1 1 10rem; width: auto; }
.regler {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
}
.regler input[type="range"] {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
}
.wert {
    min-width: 4rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}
</style>
