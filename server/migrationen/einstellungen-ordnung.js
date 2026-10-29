/**
 * Neuordnung der Einstellungen (29.10.2026). Läuft bei JEDEM Start und ist
 * idempotent — auch ein zurückgespieltes Backup zieht so nach. Additiv, ohne
 * SCHEMA_VERSION; keine Spalte verschwindet.
 *
 * KI-Modelle je Aufgabe: Die Tabelle „Modell je Aufgabe" schlug still die
 * Felder auf den Seiten der Funktionen (Agent, Lagebericht, Video, X-Suche,
 * Recherche, Strategie). Jetzt gilt für diese Aufgaben nur das Feld der Seite;
 * bestehende Tabellen-Zeilen wandern hinein, damit das wirksame Modell bei
 * niemandem wechselt. Die reine Logik ist `seitenFeldUmzug` in
 * `ai-task-config.js` (Selbsttest `__selftest-einstellungen-ordnung.mjs`).
 *
 * Gespeicherte News-Profile ziehen mit (`profilUmzug`): Ihre Modellfelder
 * standen unter denselben Zeilen und hätten beim Anwenden sonst das früher
 * wirkungslose Modell zurückgebracht.
 *
 * Profil: Die Share-Karte liest Name und Bild aus dem Profil; einmalig
 * (`migriereProfil`) zieht ein Kartenname/-bild in ein leeres Profil um.
 */

/**
 * Felder der Live-Ansicht (Bookmap), die der Browser seit Langem speichern
 * wollte (`FIELDS` in src/stores/live.js), für die es aber weder Spalte noch
 * Whitelist-Eintrag gab: Zeitspanne, Preisfaltung, Sättigung, Buch-Leiter,
 * fremde Bücher, Delta, Absorption gingen bei jedem Neuladen verloren.
 * Additiv, Vorgaben wie im Store. `liveFremdBuch` bewusst OHNE Vorgabe: leer
 * heisst dort „nichts gewählt" (dann entscheidet der Schalter
 * `quellenOhneFreigabe`, siehe `pruefeFreigabe`).
 */
export async function migriereLiveFelder(addColumnIfNotExists) {
    await addColumnIfNotExists('settings', 'liveSpanneMin', (t) => t.integer('liveSpanneMin').defaultTo(15))
    await addColumnIfNotExists('settings', 'livePreisFaltung', (t) => t.integer('livePreisFaltung').defaultTo(2))
    await addColumnIfNotExists('settings', 'liveSaettigung', (t) => t.double('liveSaettigung').defaultTo(3))
    await addColumnIfNotExists('settings', 'liveShowBuch', (t) => t.integer('liveShowBuch').defaultTo(1))
    await addColumnIfNotExists('settings', 'liveBuchW', (t) => t.integer('liveBuchW').defaultTo(96))
    await addColumnIfNotExists('settings', 'liveFremdBuch', (t) => t.integer('liveFremdBuch').nullable())
    await addColumnIfNotExists('settings', 'liveShowDelta', (t) => t.integer('liveShowDelta').defaultTo(0))
    await addColumnIfNotExists('settings', 'liveShowAbsorption', (t) => t.integer('liveShowAbsorption').defaultTo(0))
}

/** Spalten, die `seitenFeldUmzug` liest. */
function umzugSpalten(AI_TASKS) {
    const felder = new Set(['aiTaskProviders', 'aiProvider', 'aiModel'])
    for (const a of Object.values(AI_TASKS)) {
        if (a.seite?.provider) felder.add(a.seite.provider)
        if (a.seite?.modell) felder.add(a.seite.modell)
        if (a.seite?.deepseek) felder.add(a.seite.deepseek)
    }
    return [...felder]
}

/**
 * Seitenfelder der Aufgaben, die bis 29.10.2026 nur in der Tabelle standen
 * (Zwischenmeldung, Anweisungsprüfung, Trade-Analyse, Sentiment-Veto) und der
 * Recherche-Weg. Additiv; leer = Verhalten wie ohne Tabellen-Zeile.
 */
const NEUE_SPALTEN = [
    'radarNewsUpdateProvider', 'radarNewsUpdateModell', 'radarNewsPruefProvider', 'radarNewsPruefModell',
    'aiTradeAnalyseProvider', 'aiTradeAnalyseModell', 'aiStrategieVetoProvider', 'aiStrategieVetoModell',
]

/**
 * Zeilen der Aufgaben-Tabelle in die Seitenfelder — in den Einstellungen UND
 * in jedem gespeicherten News-Profil, in einem Zug: Das Profil braucht die
 * Zeilen, die der Umzug in den Einstellungen gleich löscht.
 *
 * `addColumnIfNotExists` nur beim Start; der Backup-Import ruft ohne (die
 * Spalten stehen dann schon) und zieht das eingespielte Backup sofort um.
 */
export async function migriereKiAufgaben(knex, addColumnIfNotExists = null) {
    try {
        if (addColumnIfNotExists) {
            for (const sp of NEUE_SPALTEN) {
                await addColumnIfNotExists('settings', sp, (t) => t.text(sp).defaultTo(''))
            }
            await addColumnIfNotExists('settings', 'radarNewsRechercheDeepseek',
                (t) => t.integer('radarNewsRechercheDeepseek').defaultTo(0))
        }
        // Erst hier laden: `ai-task-config.js` zieht `ai-models.js` und damit database.js nach.
        const { seitenFeldUmzug, profilUmzug, AI_TASKS } = await import('../ai-task-config.js')
        const spalten = []
        for (const sp of umzugSpalten(AI_TASKS)) {
            if (await knex.schema.hasColumn('settings', sp)) spalten.push(sp)
        }
        if (!spalten.includes('aiTaskProviders')) return
        const zeile = await knex('settings').select(spalten).where('id', 1).first()
        if (!zeile) return
        const { patch, meldungen } = seitenFeldUmzug(zeile)
        if (!Object.keys(patch).length) return
        const profile = (await knex.schema.hasTable('news_profile'))
            ? await knex('news_profile').select('id', 'name', 'einstellungen') : []
        await knex.transaction(async (trx) => {
            for (const p of profile) {
                let einst
                try { einst = JSON.parse(p.einstellungen || '{}') } catch { continue }
                const neu = profilUmzug(einst, zeile)
                if (!neu) continue
                await trx('news_profile').where('id', p.id).update({ einstellungen: JSON.stringify(neu) })
                meldungen.push(`Profil „${p.name}" angeglichen`)
            }
            await trx('settings').where('id', 1).update(patch)
        })
        console.log(` -> KI-Modell je Aufgabe: ${meldungen.join('; ')}`)
    } catch (e) {
        console.warn(' -> KI-Modell je Aufgabe: Umzug übersprungen:', e.message)
    }
}

/**
 * Share-Karte: Name und Bild kamen aus eigenen Feldern (`fluxDisplayName`,
 * `fluxAvatar`), das Profil (`username`, `avatar`) stand daneben. Jetzt liest
 * die Karte das Profil. Ist das Profil leer und die Karte hatte etwas, zieht
 * es einmal ins Profil um — sonst verlöre die Karte ihren Namen. Das Bild nur,
 * wenn es auf der Karte auch gewählt war (`fluxUseCustomAvatar`). Rein.
 *
 * @returns {object} patch für `settings` (leer = nichts zu tun)
 */
export function profilAusShareKarte(z) {
    const patch = {}
    const leer = (w) => !String(w ?? '').trim()
    if (leer(z?.username) && !leer(z?.fluxDisplayName)) patch.username = String(z.fluxDisplayName).trim()
    const gewaehlt = z?.fluxUseCustomAvatar === true || Number(z?.fluxUseCustomAvatar) === 1
    if (gewaehlt && leer(z?.avatar) && !leer(z?.fluxAvatar)) patch.avatar = z.fluxAvatar
    return patch
}

/**
 * Name auf der Share-Karte (rein): Bis 10/2026 stand ein Name nur auf dem
 * Bild, wenn der eigene Kartenname gesetzt war. Seit die Karte den Profilnamen
 * liest, schaltet `fluxNameZeigen` ihn; der Umzug setzt den Schalter so, dass
 * eine Karte ohne Namen ohne Namen bleibt (Datenschutz).
 *
 * @returns {0|1}
 */
export function nameAufKarte(z) {
    return String(z?.fluxDisplayName ?? '').trim() ? 1 : 0
}

/**
 * Einmalig (Merker `fluxNameZeigenGesetzt`) — danach gilt, was der Nutzer
 * schaltet. Greift auch auf einer Installation, deren Karte schon den
 * Profilnamen druckte: `fluxDisplayName` ist dort unverändert stehen geblieben.
 */
export async function migriereKartenName(knex, addColumnIfNotExists) {
    try {
        await addColumnIfNotExists('settings', 'fluxNameZeigen', (t) => t.integer('fluxNameZeigen').defaultTo(0))
        await addColumnIfNotExists('settings', 'fluxNameZeigenGesetzt', (t) => t.integer('fluxNameZeigenGesetzt').defaultTo(0))
        const z = await knex('settings').where('id', 1).first()
        if (!z || Number(z.fluxNameZeigenGesetzt) === 1) return
        const an = nameAufKarte(z)
        await knex('settings').where('id', 1).update({ fluxNameZeigen: an, fluxNameZeigenGesetzt: 1 })
        console.log(` -> Share-Karte: Name auf der Karte ${an ? 'an' : 'aus'} (wie bisher)`)
    } catch (e) {
        console.warn(' -> Share-Karte: Name auf der Karte übersprungen:', e.message)
    }
}

/** Einmalig (Merker `profilAusShareKarte`), damit ein später geleertes Profil leer bleibt. */
export async function migriereProfil(knex, addColumnIfNotExists) {
    try {
        await addColumnIfNotExists('settings', 'profilAusShareKarte', (t) => t.integer('profilAusShareKarte').defaultTo(0))
        const z = await knex('settings').where('id', 1).first()
        if (!z || Number(z.profilAusShareKarte) === 1) return
        const patch = profilAusShareKarte(z)
        await knex('settings').where('id', 1).update({ ...patch, profilAusShareKarte: 1 })
        if (patch.username) console.log(' -> Profil: Name der Share-Karte übernommen')
        if (patch.avatar) console.log(' -> Profil: Bild der Share-Karte übernommen')
    } catch (e) {
        console.warn(' -> Profil aus der Share-Karte: übersprungen:', e.message)
    }
}
