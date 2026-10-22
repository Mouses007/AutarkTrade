/**
 * Die KI-Analyse des Charts und was mit ihren Vorschlägen geschieht.
 *
 * Bis 22.10.2026 lag das im Reiter (`KiReiter.vue`): übernehmen ging nur dort,
 * und der Reiter wusste nichts davon, wenn man im Chart arbeitete. Jetzt sind
 * die gestrichelten Linien im Chart selbst anklickbar (Übernehmen/Verwerfen),
 * und Reiter und Chart lesen denselben Stand.
 *
 * `kiAnzeige` liest der Reiter, `kiVorschauDaten` zeichnet der Chart
 * gestrichelt. Die reine Logik steht in `utils/chart/kiZeichnungen.js`.
 */
import { ref, computed } from 'vue'
import {
    linieAlsZeichnung, zoneAlsZeichnung, profileAlsZeichnungen, istProfilLinie, istProfilZone,
    leereMarken, markenSchluessel, anzeigeAnalyse, vorschauAnalyse,
} from '../utils/chart/kiZeichnungen.js'
import { legeAn } from './chartZeichnungen.js'
import { letzterStil } from './zeichenStil.js'

const SPEICHER = 'chartKiMarken'
const MAX_GEMERKT = 30

export const kiAnalyse = ref(null)
export const kiMarken = ref(leereMarken())
export const kiAlle = ref((() => { try { return localStorage.getItem('chartKiAlle') === '1' } catch { return false } })())
const laeuftUebernahme = ref(false)
export const kiUebernimmtAlle = computed(() => laeuftUebernahme.value)

function leseAlle() { try { return JSON.parse(localStorage.getItem(SPEICHER) || '{}') || {} } catch { return {} } }
function schreibe() {
    const k = markenSchluessel(kiAnalyse.value)
    if (!k) return
    try {
        const alle = leseAlle()
        delete alle[k]
        alle[k] = kiMarken.value
        const schluessel = Object.keys(alle)
        for (const alt of schluessel.slice(0, Math.max(0, schluessel.length - MAX_GEMERKT))) delete alle[alt]
        localStorage.setItem(SPEICHER, JSON.stringify(alle))
    } catch { /* kein Speicher: gilt dann nur bis zum Neuladen */ }
}
const setzeMarken = (patch) => { kiMarken.value = { ...kiMarken.value, ...patch }; schreibe() }

/** Neue oder geladene Analyse; ihr gemerkter Zustand kommt mit. */
export function setzeKiAnalyse(a) {
    kiAnalyse.value = a || null
    kiMarken.value = a ? { ...leereMarken(), ...(leseAlle()[markenSchluessel(a)] || {}) } : leereMarken()
}

export const kiAnzeige = computed(() => anzeigeAnalyse(kiAnalyse.value, kiMarken.value))
export const kiVorschauDaten = computed(() => {
    const v = vorschauAnalyse(kiAnalyse.value, kiMarken.value)
    return v ? { ...v, _alle: kiAlle.value } : null
})

export function schalteKiAlle() {
    kiAlle.value = !kiAlle.value
    try { localStorage.setItem('chartKiAlle', kiAlle.value ? '1' : '0') } catch { /* kein Speicher */ }
}

/** Schlüssel (`linie3`, `zone1`, `profil`) → { art, i, eintrag }. */
export function kiVorschlag(schluessel) {
    const a = kiAnalyse.value
    if (!a || !schluessel) return null
    if (schluessel === 'profil') {
        const i = (a.linien || []).findIndex(istProfilLinie)
        if (i >= 0) return { art: 'linie', i, eintrag: a.linien[i], profil: true }
        const j = (a.zonen || []).findIndex(istProfilZone)
        return j >= 0 ? { art: 'zone', i: j, eintrag: a.zonen[j], profil: true } : null
    }
    const m = /^(linie|zone)(\d+)$/.exec(schluessel)
    if (!m) return null
    const eintrag = (m[1] === 'linie' ? a.linien : a.zonen)?.[Number(m[2])]
    return eintrag ? { art: m[1], i: Number(m[2]), eintrag, profil: m[1] === 'linie' ? istProfilLinie(eintrag) : istProfilZone(eintrag) } : null
}

export const kiIstUebernommen = (schluessel) => kiMarken.value.uebernommen.includes(schluessel)

/** Einen Vorschlag als eigene Zeichnung anlegen (durchgezogen, ohne ID im Text). */
export async function uebernimmKi(schluessel, panelSymbol = null) {
    const a = kiAnalyse.value
    const v = kiVorschlag(schluessel)
    if (!a || !v || kiIstUebernommen(schluessel)) return false
    const symbol = a.symbol || panelSymbol     // unter dem Symbol der ANALYSE, nicht des Panels
    if (v.profil) {
        // V-Marken: EIN Profil über den Bereich — einmal anlegen, alle V-Einträge gelten dann als übernommen
        if (!kiIstUebernommen('profil')) {
            for (const roh of profileAlsZeichnungen(a, letzterStil('volprofil'))) {
                if (!await legeAn({ symbol, ...roh, sichtbarAuf: null, gesperrt: false, versteckt: false })) return false
            }
        }
        const alleV = [...(a.linien || []).map((l, j) => (istProfilLinie(l) ? `linie${j}` : null)), ...(a.zonen || []).map((z, j) => (istProfilZone(z) ? `zone${j}` : null))].filter(Boolean)
        setzeMarken({ uebernommen: [...new Set([...kiMarken.value.uebernommen, 'profil', ...alleV])], geloescht: kiMarken.value.geloescht.filter((k) => !alleV.includes(k)) })
        return true
    }
    const roh = v.art === 'linie' ? linieAlsZeichnung({ ...v.eintrag, id: null }) : zoneAlsZeichnung({ ...v.eintrag, ids: [] }, a.kerzenVon, a.kerzenBis)
    // Übernommen heisst: eigene Linie — durchgezogen statt gestrichelt, Beschriftung wie bei eigenen Linien.
    const stil = { ...roh.stil, strich: 'voll' }
    delete stil.textPos
    const z = await legeAn({ symbol, ...roh, stil, sichtbarAuf: null, gesperrt: false, versteckt: false })
    if (!z) return false
    setzeMarken({ uebernommen: [...kiMarken.value.uebernommen, schluessel], geloescht: kiMarken.value.geloescht.filter((k) => k !== schluessel) })
    return true
}

/** Vorschlag verwerfen: weg aus Chart und Reiter (V-Marken alle zusammen, sie sind ein Profil). */
export function verwirfKi(schluessel) {
    const a = kiAnalyse.value
    const v = kiVorschlag(schluessel)
    if (!a || !v) return
    const weg = v.profil
        ? [...(a.linien || []).map((l, j) => (istProfilLinie(l) ? `linie${j}` : null)), ...(a.zonen || []).map((z, j) => (istProfilZone(z) ? `zone${j}` : null))].filter(Boolean)
        : [`${v.art}${v.i}`]
    setzeMarken({ geloescht: [...new Set([...kiMarken.value.geloescht, ...weg])] })
}

export async function alleKiUebernehmen(panelSymbol = null) {
    if (laeuftUebernahme.value) return     // zweiter Klick während des ersten legte alles doppelt an
    laeuftUebernahme.value = true
    try {
        const offen = vorschauAnalyse(kiAnalyse.value, kiMarken.value)
        for (const x of [...(offen?.linien || []), ...(offen?.zonen || [])]) await uebernimmKi(x._key, panelSymbol)
    } finally { laeuftUebernahme.value = false }
}

/** „Vorschau erledigt": gestrichelte Linien weg, im Reiter bleibt das Übernommene. */
export const kiErledigt = () => setzeMarken({ erledigt: true })
/** „Analyse zurücksetzen": der Reiter ist leer. Übernommene Linien bleiben als eigene Zeichnungen. */
export const kiZuruecksetzen = () => setzeMarken({ zurueck: true, erledigt: true })
