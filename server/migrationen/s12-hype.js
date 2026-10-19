/**
 * S12-Migration, Bereich hype: bestehende Einstellungen verträglich überführen.
 * Muss mehrfach laufen dürfen (idempotent) — sie läuft bei jedem Start.
 *
 * Grundsatz (Verkaufs-Prüfung vom 19.10.2026): Vorgaben für NEUE
 * Installationen sicher (rote Quellen weg, ungeklärte gelbe aus); eine
 * bestehende Wahl bleibt, AUSSER die Quelle ist rot.
 *
 *   rot      pump.fun, Reddit, CoinPaprika, Telegram (Frühphase), Upbit, OKX,
 *            MEXC, Binance Alpha — der Code fragt sie nicht mehr; gespeicherte
 *            Schalter sortiert `leseEinstellungen` aus, die Telegram-Kanalliste
 *            bleibt gespeichert (vom Nutzer angelegt), wird aber nicht gelesen.
 *            Die zwischengespeicherten Marktlisten der entfernten Börsen
 *            (`hype_boersen_stand`) werden gelöscht — fremde Daten, nicht vom
 *            Nutzer angelegt, und ohne Quelle nie mehr aktuell.
 *   gelb     RugCheck, Coinbase, Kraken, KuCoin, Gate: ab Werk aus. Eine
 *            BESTEHENDE Installation (Hype-Radar schon benutzt) behält sie an,
 *            einmalig festgeschrieben; danach entscheidet der Nutzer.
 *
 * „Bestehend" heisst: Es gibt schon Hype-Einstellungen, beobachtete Token
 * oder Favoriten. Der Merker `s12Migriert` in `hype_settings` sorgt dafür,
 * dass eine neue Installation, die den Radar später einschaltet, NICHT
 * nachträglich als bestehend gilt.
 */

const MERKER = 's12Migriert'
const ENTFERNTE_BOERSEN = ['binance-alpha', 'upbit', 'okx', 'mexc']
const GELBE_BOERSEN = ['coinbase', 'kraken', 'kucoin', 'gate']

async function hatTabelle(knex, name) {
    try { return await knex.schema.hasTable(name) } catch { return false }
}

async function anzahl(knex, tabelle) {
    if (!(await hatTabelle(knex, tabelle))) return 0
    try { return Number((await knex(tabelle).count({ n: '*' }).first())?.n) || 0 } catch { return 0 }
}

export async function migriere(knex, addColumnIfNotExists) { // eslint-disable-line no-unused-vars
    if (!(await hatTabelle(knex, 'hype_settings'))) return

    // Entfernte Börsen: zwischengespeicherte Fremdlisten weg (bei jedem Start harmlos).
    if (await hatTabelle(knex, 'hype_boersen_stand')) {
        await knex('hype_boersen_stand').whereIn('boerse', ENTFERNTE_BOERSEN).del().catch(() => {})
    }

    const merker = await knex('hype_settings').where('schluessel', MERKER).first().catch(() => null)
    if (merker) return

    const bestehend = (await anzahl(knex, 'hype_settings')) > 0
        || (await anzahl(knex, 'hype_frueh')) > 0
        || (await anzahl(knex, 'hype_favoriten')) > 0
    const jetzt = Date.now()
    const schreibe = (schluessel, wert) => knex('hype_settings')
        .insert({ schluessel, wert: JSON.stringify(wert), aktualisiertAm: jetzt })
        .onConflict('schluessel').merge(['wert', 'aktualisiertAm'])

    if (bestehend) {
        const lies = async (schluessel) => {
            const z = await knex('hype_settings').where('schluessel', schluessel).first().catch(() => null)
            try { return z ? JSON.parse(z.wert) : undefined } catch { return undefined }
        }
        // RugCheck lief bisher immer mit — an lassen, solange der Nutzer nichts anderes sagt.
        if ((await lies('rugcheckAn')) === undefined) await schreibe('rugcheckAn', true)
        // Börsen: bisher liefen alle. Die gelben bleiben an, die übrigen nimmt die Vorgabe.
        const boersen = (await lies('boersenwachtBoersen')) || {}
        let geaendert = false
        for (const id of GELBE_BOERSEN) {
            if (boersen[id] === undefined) { boersen[id] = true; geaendert = true }
        }
        if (geaendert) await schreibe('boersenwachtBoersen', boersen)
    }
    await schreibe(MERKER, { am: jetzt, bestehend })
    console.log(` -> S12 Hype-Radar: ${bestehend ? 'bestehende Wahl (RugCheck, Coinbase/Kraken/KuCoin/Gate) übernommen' : 'neue Installation, ungeklärte Quellen aus'}`)
}
