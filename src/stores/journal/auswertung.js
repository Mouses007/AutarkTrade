/**
 * Ergebnis der Journal-Kette: gefilterte Tage und Trades, Summen, Gruppen,
 * Gewinnanalyse. Geschrieben von `utils/journal/{laden,summen,gruppieren,
 * gewinnanalyse}.js`, gelesen von Ansichten und `charts.js`.
 *
 * Die `reactive`-Container werden NIE ersetzt, nur in place geleert und
 * gefüllt — Konsumenten halten Referenzen darauf.
 */
import { ref, reactive } from 'vue'

/** Tageskopien, absteigend nach `dateUnix`. */
export const journalTage = reactive([])
/** Dieselben Tageskopien in Ladereihenfolge. */
export const gefilterteTageAlle = reactive([])
/** Flache Liste der gefilterten Trades. */
export const gefilterteTradesFlach = reactive([])
export const totals = reactive({})
export const summenJeTag = reactive({})
export const groups = reactive({})
export const gewinnAnalyse = reactive({})
/** Minuten-Raster der Einstiegszeit-Gruppe. */
export const zeitfensterMinuten = ref(60)
/** Zuletzt geladene Tageszeilen. */
export const imports = ref([])
