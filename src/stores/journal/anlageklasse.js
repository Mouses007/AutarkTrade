/**
 * Filter «Anlageklasse» des Journals und der Nachschlag dazu.
 *
 * `gewaehlteAnlageklasse`: '' (alle) | 'krypto' | 'aktien', gemerkt in
 * localStorage. Der Filter wirkt nur mit eingeschaltetem Aktien-Teil
 * (`settings.modusAktienAn`) — sonst gilt «alle», auch wenn noch ein Wert
 * gespeichert ist.
 *
 * `holeAktienSymbole` holt vom Titel-Stamm, welche Symbole der Journal-Börsen
 * Aktien sind (`server/aktien/journal-klasse.js`). `null` = unbekannt (Stamm
 * leer oder nicht erreichbar) — dann zählt nur, was am Trade selbst steht.
 */
import { ref } from 'vue'
import axios from 'axios'
import { lokal } from '../app/ablage.js'
import { appEinstellungen } from '../settings.js'
import { istAktienAn } from '../../config/markt.js'
import { ANLAGEKLASSEN, baueKlassenNachschlag } from '../../../shared/anlageklasse.js'

const gemerkt = lokal('at.journal.anlageklasse')
export const gewaehlteAnlageklasse = ref(ANLAGEKLASSEN.includes(gemerkt) ? gemerkt : '')

/** Der Filterwert, der wirklich gilt. */
export function wirksameAnlageklasse() {
    if (!istAktienAn(appEinstellungen.value)) return ''
    return ANLAGEKLASSEN.includes(gewaehlteAnlageklasse.value) ? gewaehlteAnlageklasse.value : ''
}

const FRISCH_MS = 10 * 60_000
let stand = { zeit: 0, nachschlag: null }

/** @returns {Promise<Map<string, Set<string>>|null>} */
export async function holeAktienSymbole({ neu = false } = {}) {
    if (!neu && stand.nachschlag && Date.now() - stand.zeit < FRISCH_MS) return stand.nachschlag
    try {
        const { data } = await axios.get('/api/aktien/journal-symbole')
        const nachschlag = data?.ok ? baueKlassenNachschlag(data.symbole) : null
        stand = { zeit: Date.now(), nachschlag }
        return nachschlag
    } catch {
        // Ein gemerkter Stand bleibt gültig — die Titel-Liste ändert sich nicht in Minuten.
        return stand.nachschlag
    }
}

/** Nur für Selbsttests: gemerkten Nachschlag verwerfen. */
export function vergissAktienSymbole() { stand = { zeit: 0, nachschlag: null } }
