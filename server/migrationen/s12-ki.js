/**
 * S12-Migration, Bereich ki: bestehende Einstellungen verträglich überführen.
 * Muss mehrfach laufen dürfen (idempotent) — sie läuft bei jedem Start.
 *
 * Ein Schritt: der frühere Anbieter „DeepSeek" ist seit S12 ein neutraler
 * „OpenAI-kompatibler Endpunkt 2" (interne ID bleibt `deepseek`, siehe
 * `server/ai-models.js`). Er hat keine feste Adresse und keine vorbelegte
 * Modell-Liste mehr — der Kunde trägt beides selbst ein (Verkaufs-Prüfung
 * 89d: DeepSeek verbietet die Nennung seines Namens ohne Erlaubnis).
 *
 * Bestandskunden, die schon einen Schlüssel hinterlegt hatten, sollen davon
 * nichts merken: sie bekommen die bisherige Adresse und die bisherige
 * Modell-Liste als IHRE eigene Konfiguration eingetragen. Neue Installationen
 * bekommen nichts vorbelegt.
 *
 * `kiEmpfehlungenAn` bleibt als Spalte stehen (Bestand), wird aber von keinem
 * Modul mehr gelesen; eine Migration braucht es dafür nicht.
 */
const BISHERIGE_ADRESSE = 'https://api.deepseek.com/v1'
const BISHERIGE_MODELLE = ['deepseek-flash', 'deepseek-v4-pro']

export async function migriere(knex, addColumnIfNotExists) {
    await addColumnIfNotExists('settings', 'aiDeepseekUrl', (t) => t.text('aiDeepseekUrl').defaultTo(''))

    const s = await knex('settings').select('aiKeyDeepseek', 'aiDeepseekUrl', 'aiModels').where('id', 1).first()
    if (!s || !s.aiKeyDeepseek) return

    const aenderung = {}
    if (!String(s.aiDeepseekUrl || '').trim()) aenderung.aiDeepseekUrl = BISHERIGE_ADRESSE

    let listen = {}
    try { listen = typeof s.aiModels === 'object' && s.aiModels ? s.aiModels : JSON.parse(s.aiModels || '{}') || {} } catch { listen = {} }
    if (!Array.isArray(listen.deepseek) || !listen.deepseek.length) {
        aenderung.aiModels = JSON.stringify({ ...listen, deepseek: [...BISHERIGE_MODELLE] })
    }

    if (Object.keys(aenderung).length) {
        await knex('settings').where('id', 1).update(aenderung)
        console.log(' -> S12/ki: Bestandskonfiguration des Endpunkts 2 (früher „DeepSeek") übernommen')
    }
}
