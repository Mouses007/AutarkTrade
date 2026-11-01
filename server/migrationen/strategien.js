/**
 * Migrationen des Strategien-Umbaus (ab 01.11.2026).
 *
 * `settings.strategienStand` zählt, welche EINMAL-Schritte gelaufen sind —
 * ein Schritt, der jedes Mal liefe, würde eine bewusste spätere Einstellung
 * des Nutzers wieder überschreiben. Was idempotent ist (Waisen aufräumen),
 * läuft bei jedem Start.
 *
 *   Stand 1: Zeitausstieg „N Kerzen heisst N Kerzen" — Instanzen von Momentum
 *            Swing mit 59 und Liquidations-Kerze mit 47 bekommen 60 bzw. 48.
 *            Der Fill-Simulator schloss bis dahin eine Kerze zu spät, und die
 *            alten Vorgaben glichen das aus; so bleibt das Verhalten gleich.
 *
 *   Stand 2: Spiegeln ins Journal entfällt — gespiegelte Agenten-Trades
 *            (`category: 'agent'`) verlassen die Tageszeilen, `journalTradeId`
 *            geht auf 0. Eine Tageszeile verschwindet nur, wenn danach weder
 *            Trades noch Ausführungen darin stehen; ein echter Trade am selben
 *            Tag wiegt schwerer als eine aufgeräumte Tabelle.
 *   Stand 3: Alle Instanzen einmal neu starten (Entscheidung des Besitzers,
 *            01.11.2026). Ihre bisherigen Trades sind mit dem alten Rechenweg
 *            entstanden (Einstieg auf Kerzen, die beim Erkennen schon vorbei
 *            waren, Limit-Füllungen zu optimistisch …); im Archiv bleiben sie
 *            lesbar, die Kopien zählen ab hier mit dem korrigierten Code.
 *            Eine Kopie übernimmt den Laufzustand ihrer Vorlage.
 *   Stand 4: Tagessummen nach dem Spiegeln nachziehen (Audit FUN-F4-001,
 *            31.10.2026). Stand 2 nahm bis dahin nur die Trades aus der
 *            Tageszeile; ein API-Import am selben Tag hatte `pAndL` und
 *            `blotter` aber über BEIDE gerechnet, und der Kontostand (Summe
 *            der `pAndL.netProceeds`) zählte den Papier-Trade weiter mit.
 *            Stand 2 rechnet die Summen jetzt selbst nach; Stand 4 holt es
 *            auf Installationen nach, auf denen Stand 2 schon gelaufen ist.
 *
 * Jeder Einmal-Schritt wird BEANSPRUCHT, bevor er läuft: Der Stand wird nur
 * dort hochgesetzt, wo er noch darunter liegt (Compare-and-Set auf
 * `settings`), und nur wer die Zeile trifft, führt den Schritt aus. Bis zum
 * 31.10.2026 schrieben Stand 1 und 2 den Stand unbedingt — starteten zwei
 * Prozesse mit dem neuen Code zugleich an einer DB (NAS und Dev-Server teilen
 * eine PostgreSQL), setzte der langsamere den Stand von 3 auf 2 zurück und
 * startete alle Instanzen ein zweites Mal neu (BUG-F1-004). Stand 1, 2 und 4
 * laufen mit ihrem Anspruch in EINER Transaktion: Scheitert der Schritt,
 * rollt auch der Stand zurück und der nächste Start versucht es wieder; der
 * zweite Prozess wartet derweil an der Zeilensperre (PostgreSQL) bzw. an der
 * Schreibsperre (SQLite) und sieht danach den neuen Stand. Stand 3 startet
 * Instanzen über `neustartInstanz` mit eigenen Transaktionen und beansprucht
 * deshalb nur vorab (dort bleibt ein Abbruch einmalig, wie gehabt).
 *
 * Bei jedem Start: Entwürfe des entfallenen Code-Baukastens
 * (`strategy-builder.js`, Feld `slug`/`supportedTimeframes` statt eines
 * Regelwerks) löschen — sie lassen sich weder öffnen noch speichern.
 */

import { neustartInstanz } from '../strategie-neustart.js'
import { tagesSummen } from '../../shared/coinM.js'

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

/** Zeilen gelöschter Instanzen — bis 01.11.2026 blieben sie beim Löschen liegen. */
async function waisenAufraeumen(knex) {
    if (!(await knex.schema.hasTable('strategy_instances'))) return
    const vorhanden = knex('strategy_instances').select('id')
    let summe = 0
    for (const tabelle of ['strategy_trades', 'strategy_setups', 'strategy_runs', 'strategy_param_history', 'strategy_suggestions']) {
        if (!(await knex.schema.hasTable(tabelle))) continue
        summe += await knex(tabelle).whereNotIn('instanceId', vorhanden).whereNot('instanceId', 0).delete()
    }
    // Positionen nur, wenn sie geschlossen sind — eine offene ohne Instanz
    // bleibt sichtbar, statt still zu verschwinden.
    if (await knex.schema.hasTable('strategy_positions')) {
        summe += await knex('strategy_positions').whereNotIn('instanceId', vorhanden)
            .where('status', 'closed').delete()
    }
    if (summe) console.log(` -> Strategien: ${summe} Zeile(n) gelöschter Instanzen aufgeräumt`)
}

/** Entwürfe im Format des alten Code-Baukastens: Beschreibung mit `slug` statt Regeln. */
export function istAlterEntwurf(z) {
    if (z.generatedPath) return true
    const spec = parse(z.spec, null)
    return Boolean(spec && typeof spec === 'object' && !Array.isArray(spec)
        && (spec.slug !== undefined || spec.supportedTimeframes !== undefined) && spec.timeframes === undefined)
}

async function alteEntwuerfeLoeschen(knex) {
    if (!(await knex.schema.hasTable('strategy_drafts'))) return
    const zeilen = await knex('strategy_drafts').select('id', 'spec', 'generatedPath')
    const weg = zeilen.filter(istAlterEntwurf).map((z) => z.id)
    if (!weg.length) return
    await knex('strategy_drafts').whereIn('id', weg).delete()
    console.log(` -> Strategien: ${weg.length} Entwurf/Entwürfe des alten Code-Baukastens gelöscht`)
}

/** Leer im Sinn der Tageszeile: kein Element (Array) bzw. kein Schlüssel (Objekt). */
const leer = (v) => (Array.isArray(v) ? v.length === 0 : !v || Object.keys(v).length === 0)

/*
 * Summenfelder, die nicht jeder Schreiber anlegt (die Gebührenkorrektur in
 * `server/bitunix-api.js` ergänzt sie) — stehen sie im gespeicherten P&L,
 * werden sie mit nachgezogen, statt alt neben den neuen Summen zu stehen.
 */
const summe = (trades, feld, passt = () => true) =>
    trades.reduce((s, t) => { const v = Number(t?.[feld]) || 0; return passt(v) ? s + v : s }, 0)
const ZUSATZ_SUMMEN = {
    commission: (trades, p) => p.fees,
    tradingFees: (trades) => summe(trades, 'tradingFee'),
    fundingFees: (trades) => summe(trades, 'fundingFee'),
    grossWins: (trades) => summe(trades, 'grossProceeds', (v) => v > 0),
    grossLoss: (trades) => summe(trades, 'grossProceeds', (v) => v < 0),
    netWins: (trades) => summe(trades, 'netProceeds', (v) => v > 0),
    netLoss: (trades) => summe(trades, 'netProceeds', (v) => v < 0),
    grossSharePL: (trades, p) => p.grossProceeds,
    netSharePL: (trades, p) => p.netProceeds,
}

/**
 * `pAndL` und `blotter` einer Tageszeile auf die Trades nachziehen, die noch
 * in ihr stehen (FUN-F4-001).
 *
 * Nur wenn der gespeicherte P&L MEHR Trades zählt, als die Zeile trägt — so
 * sieht eine Zeile aus, aus der Trades genommen wurden, ohne die Summen
 * nachzuführen. Weniger gezählte Trades sind dagegen normal: der Datei-Import
 * zählt offene Trades (`tradesCount: 0`) nicht mit, und eine solche Zeile ist
 * nicht verunreinigt. Ein P&L ohne `trades`-Zahl (`{}` aus der alten Brücke)
 * bleibt ebenso, wie er ist. Gerechnet wird wie beim API-Import
 * (`tagesSummen`, shared/coinM.js); den Blotter nur in dessen Form (Liste je
 * Symbol), die Objekt-Form des Datei-Imports wurde nie über Agenten-Trades
 * gerechnet.
 *
 * @param {{pAndL: any, blotter: any}} zeile  gespeicherte Tageszeile
 * @param {Array} trades                       die Trades, die bleiben
 * @returns {object|null} Felder fürs Update, null = nichts zu tun
 */
export function summenNachziehen(zeile, trades) {
    const alt = parse(zeile.pAndL, null)
    if (!alt || typeof alt !== 'object' || Array.isArray(alt) || alt.trades == null) return null
    const gezaehlt = Number(alt.trades)
    if (!Number.isFinite(gezaehlt) || gezaehlt <= trades.length) return null
    const neu = tagesSummen(trades)
    // Ein Trade ohne Zahlenfelder ergäbe NaN — dann lieber nichts anfassen.
    if (!Object.values(neu.pAndL).every(Number.isFinite)) return null
    const pAndL = { ...alt, ...neu.pAndL }
    for (const [feld, rechne] of Object.entries(ZUSATZ_SUMMEN)) {
        if (feld in alt) pAndL[feld] = rechne(trades, neu.pAndL)
    }
    const felder = { pAndL: JSON.stringify(pAndL) }
    if (Array.isArray(parse(zeile.blotter, null))) felder.blotter = JSON.stringify(neu.blotter)
    return felder
}

export async function spiegelungEntfernen(knex) {
    if (!(await knex.schema.hasTable('trades'))) return
    let entfernt = 0
    let tage = 0
    // Nur Zeilen, deren Text überhaupt die Kategorie nennt — die Tabelle ist gross.
    const zeilen = await knex('trades').select('id', 'trades', 'executions', 'blotter', 'pAndL')
        .where('trades', 'like', '%"agent"%')
    for (const z of zeilen) {
        const liste = parse(z.trades, [])
        if (!Array.isArray(liste)) continue
        const bleibt = liste.filter((x) => x?.category !== 'agent')
        if (bleibt.length === liste.length) continue
        entfernt += liste.length - bleibt.length
        if (!bleibt.length && leer(parse(z.executions, []))) {
            await knex('trades').where('id', z.id).delete()
            tage++
        } else {
            // Summen mit nachziehen (FUN-F4-001): ein API-Import am selben Tag
            // hatte sie über den Agenten-Trade mitgerechnet.
            await knex('trades').where('id', z.id)
                .update({ trades: JSON.stringify(bleibt), ...summenNachziehen(z, bleibt) })
        }
    }
    if (await knex.schema.hasColumn('strategy_trades', 'journalTradeId')) {
        await knex('strategy_trades').where('journalTradeId', '>', 0).update({ journalTradeId: 0 })
    }
    if (entfernt) console.log(` -> Strategien: ${entfernt} gespiegelte Agenten-Trades aus dem Journal genommen (${tage} leere Tage)`)
}

/**
 * Stand 4: Tageszeilen, deren `pAndL` mehr Trades zählt, als sie tragen, auf
 * ihre Trades nachrechnen — für Installationen, auf denen Stand 2 lief, bevor
 * er die Summen mitnahm. In Portionen nach id, die Tabelle kann gross sein.
 */
export async function tagessummenNachziehen(knex) {
    if (!(await knex.schema.hasTable('trades'))) return
    let n = 0
    let letzte = 0
    for (;;) {
        const zeilen = await knex('trades').where('id', '>', letzte).orderBy('id').limit(200)
            .select('id', 'trades', 'blotter', 'pAndL')
        if (!zeilen.length) break
        letzte = zeilen[zeilen.length - 1].id
        for (const z of zeilen) {
            const liste = parse(z.trades, [])
            if (!Array.isArray(liste)) continue
            const felder = summenNachziehen(z, liste)
            if (!felder) continue
            await knex('trades').where('id', z.id).update(felder)
            n++
        }
    }
    if (n) console.log(` -> Strategien: Tagessummen von ${n} Journal-Tag(en) auf ihre Trades nachgerechnet (FUN-F4-001)`)
}

export async function alleNeuStarten(knex, { strategyId = null, quelle = 'Neustart nach dem Strategien-Umbau' } = {}) {
    const zeilen = await knex('strategy_instances').where((q) => q.where('archiviert', 0).orWhereNull('archiviert'))
        .modify((q) => { if (strategyId) q.where('strategyId', strategyId) })
        .select('id').orderBy('id')
    let n = 0
    for (const z of zeilen) {
        // Jede Instanz für sich: scheitert eine, laufen die anderen trotzdem um.
        try {
            const r = await neustartInstanz(knex, z.id, { quelle })
            if (r.ok) n++
        } catch (e) {
            console.warn(` -> Strategien: Neustart von #${z.id} fehlgeschlagen: ${e.message}`)
        }
    }
    if (n) console.log(` -> Strategien: ${n} Instanz(en) neu gestartet — die alten stehen im Archiv`)
}

const ZEITAUSSTIEG = { momentum_swing: [59, 60], liq_kerze: [47, 48] }

async function zeitausstiegNachziehen(knex) {
    const zeilen = await knex('strategy_instances').whereIn('strategyId', Object.keys(ZEITAUSSTIEG))
    let n = 0
    for (const z of zeilen) {
        const [alt, neu] = ZEITAUSSTIEG[z.strategyId]
        const params = parse(z.params, {})
        if (Number(params.maxHoldCandles) !== alt) continue
        params.maxHoldCandles = neu
        const version = (Number(z.paramsVersion) || 1) + 1
        await knex('strategy_instances').where('id', z.id)
            .update({ params: JSON.stringify(params), paramsVersion: version })
        if (await knex.schema.hasTable('strategy_param_history')) {
            // Eigener Sicherungspunkt: der Schritt läuft in einer Transaktion,
            // und unter PostgreSQL bräche eine gescheiterte Anweisung (etwa
            // eine schon vorhandene Version) sonst die ganze Transaktion ab.
            await knex.transaction((sp) => sp('strategy_param_history').insert({
                instanceId: z.id, paramsVersion: version,
                params: JSON.stringify(params), risk: z.risk,
                source: `Zeitausstieg: ${alt} → ${neu} Kerzen (gleiches Verhalten)`,
            })).catch(() => {})
        }
        n++
    }
    if (n) console.log(` -> Strategien: Zeitausstieg bei ${n} Instanz(en) nachgezogen`)
}

export async function migriereStrategien(knex, addColumnIfNotExists) {
    await addColumnIfNotExists('settings', 'strategienStand', (t) => t.integer('strategienStand').defaultTo(0))
    // Archiv (Neustart einer Instanz, server/strategie-neustart.js): die alte
    // Instanz bleibt mit ihren Trades lesbar, `nachfolger` zeigt auf die Kopie.
    if (await knex.schema.hasTable('strategy_instances')) {
        await addColumnIfNotExists('strategy_instances', 'archiviert', (t) => t.integer('archiviert').defaultTo(0))
        await addColumnIfNotExists('strategy_instances', 'archiviertAm', (t) => t.bigInteger('archiviertAm').defaultTo(0))
        await addColumnIfNotExists('strategy_instances', 'nachfolger', (t) => t.integer('nachfolger').defaultTo(0))
    }
    // Kerze, mit der ein Setup ohne Einstieg endete (ungültig, abgelaufen).
    // Ohne sie zeichnete der Chart solche Boxen pauschal 20 Kerzen breit —
    // eine abgelaufene Box hörte dann vor ihrem letzten Antippen auf.
    if (await knex.schema.hasTable('strategy_setups')) {
        await addColumnIfNotExists('strategy_setups', 'endeT', (t) => t.bigInteger('endeT').defaultTo(0))
    }
    if (await knex.schema.hasTable('strategy_drafts')) {
        await addColumnIfNotExists('strategy_drafts', 'strategyId', (t) => t.text('strategyId').defaultTo(''))
    }
    await waisenAufraeumen(knex)
    await alteEntwuerfeLoeschen(knex)

    const zeile = await knex('settings').where('id', 1).select('strategienStand').first()
    if (!zeile) return
    // Nur eine Vorauswahl: ob ein Schritt wirklich läuft, entscheidet sein
    // Anspruch (`einmalSchritt`) — dieser Wert kann schon veraltet sein.
    const stand = Number(zeile.strategienStand) || 0

    if (stand < 1 && await knex.schema.hasTable('strategy_instances')) {
        await einmalSchritt(knex, 1, zeitausstiegNachziehen)
    }
    if (stand < 2 && await knex.schema.hasTable('strategy_trades')) {
        await einmalSchritt(knex, 2, spiegelungEntfernen)
    }
    if (stand < 3 && await knex.schema.hasTable('strategy_instances')) {
        // Erst den Stand umschalten, mit Bedingung: starten zwei Prozesse mit dem
        // neuen Code zugleich (NAS und Dev-Server teilen eine PostgreSQL), startet
        // nur der neu, der umgeschaltet hat.
        const gewonnen = await beanspruche(knex, 3)
        if (gewonnen) await alleNeuStarten(knex)
    }
    if (stand < 4 && await knex.schema.hasTable('trades')) {
        await einmalSchritt(knex, 4, tagessummenNachziehen)
    }
    if (stand < 5 && await knex.schema.hasTable('strategy_instances')) {
        // LSOB-Detektor 3 (01.11.2026): die Box-Regeln gelten ab dem Sweep. Die
        // bisherigen Trades der LSOB-Instanzen stammen aus den alten Regeln;
        // neu gestartet zählt ab hier nur, was die neuen erzeugen. Wie Schritt
        // 3 erst beanspruchen, dann starten. Lief Schritt 3 in diesem Start
        // (Stand vorher unter 3), sind die Instanzen schon frisch.
        const gewonnen = await beanspruche(knex, 5)
        if (gewonnen && stand >= 3) {
            await alleNeuStarten(knex, { strategyId: 'lsob', quelle: 'Neustart nach den LSOB-Box-Regeln (Detektor 3)' })
        }
    }
}

/** Stand auf `n` setzen, wo er noch darunter liegt. Ergebnis: 1 = gewonnen, 0 = schon da. */
function beanspruche(knex, n) {
    return knex('settings').where('id', 1)
        .where((q) => q.where('strategienStand', '<', n).orWhereNull('strategienStand'))
        .update({ strategienStand: n })
}

/**
 * Einmal-Schritt `n`: beanspruchen und ausführen in EINER Transaktion. Wer den
 * Anspruch nicht gewinnt, lässt den Schritt aus; scheitert der Schritt, rollt
 * der Stand mit zurück. `schritt` bekommt die Transaktion und darf nur über
 * sie arbeiten.
 */
async function einmalSchritt(knex, n, schritt) {
    await knex.transaction(async (trx) => {
        if (await beanspruche(trx, n)) await schritt(trx)
    })
}
