<script setup>
/**
 * Live → Live-Analyse (Heatmap / Bookmap). Die Werte liegen im Live-Store und
 * speichern sich dort selbst in die settings-Tabelle.
 */
import { ref } from 'vue'
import InfoTipp from '@/components/InfoTipp.vue'
import {
    liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp, liveShowProfile,
    livePauseInBackground, liveColorMode, liveColorRef, liveAutoFollow, liveThreshold, liveDotStep,
    liveShowLiquidations, livePrefillMin,
    VIEW_PCT_OPTIONS, FRAME_MS_OPTIONS, HISTORY_MIN_OPTIONS,
} from '@/stores/live.js'

let liveExpanded = ref(false)
</script>

<template>
    <div>
        <hr />

        <!--=============== LIVE-ANALYSE ===============-->
        <div class="d-flex align-items-center pointerClass" @click="liveExpanded = !liveExpanded">
            <i class="uil me-2" :class="liveExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">Live-Analyse · Heatmap / Bookmap</p>
        </div>
        <div v-show="liveExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">Standardwerte für die Live-Ansicht. Änderungen im Seitenmenü der Live-Analyse landen ebenfalls hier — beides schreibt in dieselben Einstellungen. Die Daten kommen live vom öffentlichen Binance-Marktdaten-Stream; es wird nichts aufgezeichnet, die Historie beginnt beim Öffnen der Seite.</p>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">Markt</div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model="liveMarket">
                        <option value="futures">USDⓈ-M Futures (Perpetual)</option>
                        <option value="spot">Spot</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Preisband
                    <small class="d-block text-muted" style="font-size:0.78rem;">Sichtbarer Bereich um den Mittelkurs</small>
                </div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model.number="liveViewPct">
                        <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Spaltentakt
                    <small class="d-block text-muted" style="font-size:0.78rem;">Zeit, die eine Pixelspalte abdeckt</small>
                </div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model.number="liveFrameMs">
                        <option v-for="f in FRAME_MS_OPTIONS" :key="f" :value="f">{{ f }} ms</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Historie im Speicher
                    <small class="d-block text-muted" style="font-size:0.78rem;">Länger = mehr Arbeitsspeicher</small>
                </div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model.number="liveHistoryMin">
                        <option v-for="h in HISTORY_MIN_OPTIONS" :key="h" :value="h">{{ h ? h + ' Minuten' : 'Automatisch (doppelte Zeitspanne)' }}</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">Farbrampe<InfoTipp schluessel="settings.info.liveRamp" /></div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model="liveRamp">
                        <option value="viridis">Viridis (violett → grün → gelb)</option>
                        <option value="bookmap">Klassisch (blau → grün → gelb → rot)</option>
                        <option value="journal">Journal (Blauton)</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Farbskala
                    <small class="d-block text-muted" style="font-size:0.78rem;">Fest = Bilder über Zeit und Symbole vergleichbar</small>
                </div>
                <div class="col-12 col-md-8">
                    <div class="input-group">
                        <select class="form-select" v-model="liveColorMode">
                            <option value="auto">Automatisch (95. Perzentil)</option>
                            <option value="fixed">Fester Sättigungswert</option>
                        </select>
                        <input v-if="liveColorMode === 'fixed'" class="form-control" type="number" min="0"
                            step="0.1" v-model.number="liveColorRef" placeholder="z.B. 50" />
                    </div>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Vorlauf beim Öffnen
                    <small class="d-block text-muted" style="font-size:0.78rem;">Nur aus eigener Aufzeichnung — Binance liefert keine vergangene Orderbuch-Tiefe. Eingeschaltet wird immer die volle Historienlänge geladen: der Server faltet die Antwort ohnehin auf rund 900 Spalten, weniger zu holen spart nichts und lässt die Karte links leer.</small>
                </div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model.number="livePrefillMin">
                        <option :value="0">Aus (leer starten)</option>
                        <option :value="5">5 Minuten</option>
                        <option :value="15">15 Minuten</option>
                        <option :value="30">30 Minuten</option>
                        <option :value="60">60 Minuten</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Liquiditätsschwelle
                    <small class="d-block text-muted" style="font-size:0.78rem;">Blendet schwache Liquidität aus — nur die Wände bleiben</small>
                </div>
                <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                    <input type="range" class="form-range" min="0" max="0.9" step="0.05"
                        v-model.number="liveThreshold" />
                    <span style="min-width:3rem;">{{ Math.round(liveThreshold * 100) }} %</span>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Punkte zusammenfassen
                    <small class="d-block text-muted" style="font-size:0.78rem;">Bündelt Handelspunkte zu Blasen und bestimmt zugleich deren Grösse. Ganz links bleibt jede Spalte einzeln — dann verschmelzen die Punkte zu einem Band.</small>
                </div>
                <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                    <input type="range" class="form-range" min="1" max="30" step="1"
                        v-model.number="liveDotStep" />
                    <span style="min-width:4rem;">{{ liveDotStep === 1 ? 'aus' : liveDotStep + ' px' }}</span>
                </div>
            </div>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">Verhalten</div>
                <div class="col-12 col-md-8">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="liveAutoFollowChk"
                            v-model="liveAutoFollow" />
                        <label class="form-check-label" for="liveAutoFollowChk">
                            Preisachse folgt dem Mittelkurs
                            <small class="d-block text-muted" style="font-size:0.78rem;">Aus = feste Achse, im Chart mit Ziehen verschiebbar</small>
                        </label>
                    </div>
                    <div class="form-check mt-2">
                        <input class="form-check-input" type="checkbox" id="liveProfileChk"
                            v-model="liveShowProfile" />
                        <label class="form-check-label" for="liveProfileChk">Volumenprofil einblenden</label>
                    </div>
                    <div class="form-check mt-2">
                        <input class="form-check-input" type="checkbox" id="liveLiqChk"
                            v-model="liveShowLiquidations" />
                        <label class="form-check-label" for="liveLiqChk">
                            Zwangsliquidationen einzeichnen
                            <small class="d-block text-muted" style="font-size:0.78rem;">Nur Futures — tatsächlich ausgeführte Liquidationen als Rauten</small>
                        </label>
                    </div>
                    <div class="form-check mt-2">
                        <input class="form-check-input" type="checkbox" id="livePauseBgChk"
                            v-model="livePauseInBackground" />
                        <label class="form-check-label" for="livePauseBgChk">
                            Im Hintergrund pausieren
                            <small class="d-block text-muted" style="font-size:0.78rem;">Empfohlen: der Browser drosselt versteckte Tabs, sonst verzerrt sich die Zeitachse</small>
                        </label>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>
