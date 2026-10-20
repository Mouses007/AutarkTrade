/**
 * Zustand des Bildpfads (docs/spec/f3-screenshots.md §2.3): geladene Liste,
 * Monatsübersicht der Tagesansicht, Bild in Bearbeitung, Vollbild und
 * Markierungsauftrag. „Liste zu Ende" (`listeZuEnde`) und der vorgemerkte
 * Eintrag (`markierterEintrag`) liegen geteilt in `app/rahmen.js`, die eigene
 * Ladeanzeige ist `bilderWerdenGeholt` in `app/laden.js`.
 */
import { ref, reactive } from 'vue'

/** Geladene Bilder (volle Zeilen ohne die Altspalten `original`/`annotated`). */
export const bilder = reactive([])
/** Monatsübersicht der Tagesansicht: je Bild `{objectId, dateUnix, dateUnixDay, name}`. */
export const bilderDesMonats = reactive([])
/** Das Bild, das gerade markiert bzw. im Trade-Fenster gezeigt wird. */
export const bildInBearbeitung = reactive({})

/** Kopie des Bildes im Vollbild und sein Index in `bilder` (−1 = Einzelbild ohne Blättern). */
export const vollbildBild = reactive({})
export const vollbildIndex = ref(-1)
export const vollbildOffen = ref(false)

/** Läuft der Markierungs-Editor? Sperrt Speichern und das Trade-Fenster. */
export const markierungOffen = ref(false)
/** Auftrag an den Editor `{bild, zustand, objectId}` oder null. */
export const markierAuftrag = ref(null)

/** Blätterstand der Seite Bilder: abgefragte Zeilen und Häppchengrösse. */
export const bildVersatz = ref(0)
export const bildHaeppchen = ref(4)
