/**
 * Selbsttest: Routen der Bot-Steuerung (steuerung-routen.js) gegen eine
 * Wegwerf-SQLite und einen nachgebauten Pionex (Lade-Haken __bot-attrappen.mjs).
 * Prüft, was das Audit vom 11.11.2026 verlangte: Einmal-Token, Sperre bei
 * Doppelklick, drei Ausgänge (unklar bei Zeitüberschreitung), Testbetrieb,
 * Haken, Einwilligung, Protokoll.
 *
 * Aufruf: node server/bots/__selftest-bot-steuerung-routen.mjs
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

register('./__bot-attrappen.mjs', import.meta.url)
const datei = path.join(os.tmpdir(), `at-bot-routen-${process.pid}.db`)
process.env.DB_FILE = datei
process.env.AT_DB_FILE = datei
delete process.env.AT_TESTBETRIEB

const express = (await import('express')).default
const { initDb, getKnex } = await import('../database.js')
const { encrypt } = await import('../crypto.js')
const { normalisiereBot } = await import('./pionex-bots.js')
const { FASSUNG, fassungHash, hakenText } = await import('./einwilligung.js')
const { setupBotSteuerungRoutes, _testZeiten, deuteSendung } = await import('./steuerung-routen.js')

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const bot = { ...normalisiereBot(fix.data.results[0]), kurs: 83.035 }

// Nachgebauter Pionex: zählt Sendungen, Verhalten je Test umschaltbar
const pionex = { modus: 'ok', sendungen: 0, verzoegerung: 0 }
globalThis.__botTest = {
    bot,
    async pionex(method, pfad, body) {
        if (method === 'GET') return { result: true, data: { results: [] } }
        if (/checkParams$/.test(pfad) && pionex.minEinsatz) {
            pionex.pruefungen = (pionex.pruefungen || 0) + 1
            if (pionex.bremse > 0) { pionex.bremse--; throw new Error('Pionex API: [TOO_MANY_REQUESTS] rate limit') }
            if (body.base !== 'USDT.PERP' && !/^\d+(\.\d{1,2})?$/.test(String(body.buOrderData.quote_investment))) throw new Error('Pionex API: [BOT_INVALID_ARGUMENT] quote_total_investment not match quote precision: max 2 decimal places')
            if (Number(body.buOrderData.quote_investment) < pionex.minEinsatz) throw new Error('Pionex API: [BOT_INVALID_ARGUMENT] less than min investment')
        }
        if (/reduceCheck$/.test(pfad)) {
            pionex.reduzierPruefungen = (pionex.reduzierPruefungen || 0) + 1
            const max = pionex.maxReduce || 200
            if (body.reduceNum > max) return { result: true, data: { checkResult: false, reason: 'REDUCE_TOO_MUCH', maxReduceNum: max } }
            return { result: true, data: { checkResult: true, maxReduceNum: max, reduceAmount: String(body.reduceNum * 0.01), reducePnl: '1.25', reduceGridprofit: '0.4', reduceInvestment: '3', reduceFee: '0.01', estimateLiquidationPriceDown: '0.6', estimateLiquidationPriceDownAfter: '0.55' } }
        }
        if (/Check$|checkParams$/.test(pfad)) return { result: true, data: { checkResult: true } }
        pionex.sendungen++
        if (pionex.verzoegerung) await warte(pionex.verzoegerung)
        if (pionex.modus === 'zeit') throw new Error('The operation was aborted due to timeout')
        if (pionex.modus === 'abgelehnt') throw new Error('Pionex API: [BOT_INVALID_ARGUMENT] nein')
        if (pionex.modus === 'gateway') throw new Error('Pionex API: 502 Bad Gateway')
        if (pionex.modus === 'gatewayJson') throw Object.assign(new Error('Pionex API: [INTERNAL_ERROR] try again later'), { status: 503 })
        // BUG-R-106: die Datenbank fällt aus, WÄHREND die Sendung bei Pionex ist
        if (pionex.dbWeg) await getKnex().schema.renameTable('bot_aenderungen', 'bot_aenderungen_weg')
        pionex.letzte = { pfad, body }
        return { result: true, data: pionex.neueId ? { buOrderId: pionex.neueId } : {} }
    },
}

let server
try {
    await initDb()
    const knex = getKnex()
    _testZeiten({ sperre: 0, pruefPause: 0, nachlesen: 0, minPause: 0 })
    const app = express()
    app.use(express.json())
    setupBotSteuerungRoutes(app)
    server = app.listen(0)
    const basis = `http://127.0.0.1:${server.address().port}`
    const post = async (pfad, body) => {
        const r = await fetch(basis + pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        return { status: r.status, d: await r.json() }
    }
    const haken = hakenText('de')
    const pruefe = async (eingabe = { betrag: '0.5' }) => (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'margeDazu', eingabe })).d
    const sende = (token, extra = {}) => post(`/api/bots/${bot.id}/aktion/senden`, { aktion: 'margeDazu', eingabe: { betrag: '0.5' }, token, haken: true, hakenText: haken, ...extra })

    console.log('Ohne Einwilligung')
    await knex('bot_steuerung').where('id', 1).update({ apiKey: encrypt('k'), secretKey: encrypt('s') })
    p('Prüfen ohne Einwilligung → 403', (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'margeDazu', eingabe: { betrag: '1' } })).status === 403)
    p('Freischalten mit falschem Hash → 409', (await post('/api/bots/steuerung/freischalten', { fassung: FASSUNG, hash: 'x', bestaetigt: true })).status === 409)
    p('Freischalten richtig → ok, protokolliert', (await post('/api/bots/steuerung/freischalten', { fassung: FASSUNG, hash: fassungHash(), bestaetigt: true })).d.ok
        && (await knex('bot_aenderungen').where({ aktion: 'freischalten' })).length === 1)

    console.log('Normal: prüfen, senden')
    const pr = await pruefe()
    p('Prüfung bestanden, Token da', pr.bestanden && typeof pr.token === 'string')
    const s1 = await sende(pr.token)
    p('Senden ausgeführt, genau eine Sendung', s1.d.ok && s1.d.zustand === 'ausgefuehrt' && pionex.sendungen === 1)
    p('Soll/Ist geliefert', s1.d.soll && s1.d.ist !== undefined)

    console.log('Einmal-Token (Audit SEC-01)')
    const s2 = await sende(pr.token)
    p('derselbe Token ein zweites Mal → 409 verbraucht, keine Sendung', s2.status === 409 && s2.d.code === 'verbraucht' && pionex.sendungen === 1)

    console.log('Doppelklick (Audit SEC-01)')
    const pr2 = await pruefe()
    pionex.verzoegerung = 150
    const [a, b] = await Promise.all([sende(pr2.token), sende(pr2.token)])
    pionex.verzoegerung = 0
    p('zwei gleichzeitige Sendungen → genau eine geht an Pionex', pionex.sendungen === 2 && [a, b].filter((x) => x.d.ok).length === 1)
    p('die zweite wird abgewiesen (laeuft/verbraucht)', [a, b].some((x) => ['laeuft', 'verbraucht'].includes(x.d.code)))

    console.log('Ausgang unklar (Audit SEC-02)')
    pionex.modus = 'zeit'
    const pr3 = await pruefe()
    const s3 = await sende(pr3.token)
    p('Zeitüberschreitung → zustand unklar, ok false', s3.d.zustand === 'unklar' && s3.d.ok === false)
    const zeileUnklar = await knex('bot_aenderungen').where({ zustand: 'unklar' }).first()
    p('im Protokoll als „unklar", nicht als abgelehnt', !!zeileUnklar && !zeileUnklar.ok)
    pionex.modus = 'abgelehnt'
    const s4 = await sende((await pruefe()).token)
    p('Pionex-Fehler → abgelehnt', s4.d.zustand === 'abgelehnt')
    console.log('5xx mit JSON-Körper (Audit SEC-R-103)')
    pionex.modus = 'gatewayJson'
    const vor503 = pionex.sendungen
    const s503 = await sende((await pruefe()).token)
    p('HTTP 503 mit JSON-Körper → unklar, nicht abgelehnt; genau eine Sendung', s503.d.zustand === 'unklar' && s503.d.ok === false && pionex.sendungen === vor503 + 1, JSON.stringify(s503.d))
    const fe = (text, status) => Object.assign(new Error(text), status == null ? {} : { status })
    p('Status 500/503/504 und 408 am Fehler → unklar', [500, 503, 504, 408].every((st) => deuteSendung(null, fe('Pionex API: [X] y', st)).zustand === 'unklar'))
    p('Status 400/401/429 mit Pionex-Text → abgelehnt; 200 mit result false ebenso', [400, 401, 429, 200].every((st) => deuteSendung(null, fe('Pionex API: [BOT_INVALID_ARGUMENT] nein', st)).zustand === 'abgelehnt'))
    p('ohne Status zählt der Text: „408 …" unklar, „[CODE] …" abgelehnt', deuteSendung(null, fe('Pionex API: 408 Request Timeout')).zustand === 'unklar' && deuteSendung(null, fe('Pionex API: [X] y')).zustand === 'abgelehnt')
    p('Netzabbruch und Zeitüberschreitung → unklar', deuteSendung(null, new TypeError('fetch failed')).zustand === 'unklar' && deuteSendung(null, fe('The operation was aborted due to timeout')).zustand === 'unklar')
    pionex.modus = 'ok'
    p('5xx gilt als unklar, leere Antwort ebenso', deuteSendung(null, new Error('Pionex API: 502 Bad Gateway')).zustand === 'unklar' && deuteSendung(null).zustand === 'unklar' && deuteSendung({ result: true }).zustand === 'ausgefuehrt')

    console.log('Haken und Testbetrieb')
    const pr5 = await pruefe()
    const vorher = pionex.sendungen
    const s5 = await sende(pr5.token, { hakenText: 'ok' })
    p('falscher Haken-Text → 400, protokolliert als abgewiesen, keine Sendung', s5.status === 400 && pionex.sendungen === vorher && !!(await knex('bot_aenderungen').where({ zustand: 'abgewiesen', code: 'haken' }).first()))
    const s6 = await sende(pr5.token, { eingabe: { betrag: '0.6' } })
    p('anderer Betrag als geprüft → 409 neuPruefen', s6.status === 409 && s6.d.code === 'neuPruefen' && pionex.sendungen === vorher)
    process.env.AT_TESTBETRIEB = '1'
    const s7 = await sende((await pruefe()).token)
    p('Testbetrieb → 403, keine Sendung', s7.status === 403 && s7.d.code === 'testbetrieb' && pionex.sendungen === vorher)
    delete process.env.AT_TESTBETRIEB

    console.log('Bot-Planer: Start aus einem Plan')
    globalThis.__botTest.kurs = 160
    const plan = { coin: 'SOL', coinM: true, richtung: 'LONG', unten: '120', oben: '200', anzahl: '100', art: 'arithmetic', hebel: '4', einsatz: '1' }
    const falsch = await post('/api/bots/plan/aktion/pruefen', { aktion: 'band', eingabe: plan })
    p('Plan kennt nur „starten"', falsch.status === 400 && falsch.d.code === 'aktion')
    const ausserhalb = await post('/api/bots/plan/aktion/pruefen', { aktion: 'starten', eingabe: { ...plan, unten: '170' } })
    p('Kurs ausserhalb des Bands → 400', ausserhalb.status === 400 && ausserhalb.d.code === 'kursAusserhalb')
    const pp = (await post('/api/bots/plan/aktion/pruefen', { aktion: 'starten', eingabe: plan })).d
    const bd = pp.anfrage?.body?.buOrderData
    p('Prüfung über checkParams, Token da, kein „vorher"', pp.bestanden && !!pp.token && pp.vorher === null)
    p('Coin-M: base USDT.PERP, quote SOL, Long der Coin = trend short, Band invers', pp.anfrage.body.base === 'USDT.PERP' && pp.anfrage.body.quote === 'SOL' && bd.trend === 'short' && Math.abs(Number(bd.top) - 1 / 120) < 1e-6 && Math.abs(Number(bd.bottom) - 1 / 200) < 1e-6 && bd.cateType === 'FUTURE_GRID_COIN_MARGINED' && bd.row === 100 && bd.leverage === 4)
    const vor = pionex.sendungen
    pionex.neueId = bot.id
    const sp = await post('/api/bots/plan/aktion/senden', { aktion: 'starten', eingabe: plan, token: pp.token, haken: true, hakenText: haken })
    pionex.neueId = null
    p('Start gesendet (create), genau eine Sendung', sp.d.zustand === 'ausgefuehrt' && pionex.sendungen === vor + 1 && /\/create$/.test(pionex.letzte.pfad))
    p('Ist = der neue Bot (ID aus der Antwort)', sp.d.ist?.neueId === bot.id)
    const anders = await post('/api/bots/plan/aktion/senden', { aktion: 'starten', eingabe: { ...plan, hebel: '5' }, token: (await post('/api/bots/plan/aktion/pruefen', { aktion: 'starten', eingabe: plan })).d.token, haken: true, hakenText: haken })
    p('anderer Hebel als geprüft → 409 neuPruefen', anders.status === 409 && anders.d.code === 'neuPruefen')

    console.log('Position reduzieren')
    const vorR = pionex.sendungen
    const rp = (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'reduzieren', eingabe: { anteil: '25' } })).d
    p('25 % → reduceNum 50 von Pionex-Höchstmenge 200, Schätzungen von Pionex', rp.bestanden && rp.eingabe?.reduceNum === '50' && rp.reduzieren?.max === 200 && rp.reduzieren?.pnl === 1.25 && rp.anfrage.pfad.endsWith('/reduce') && rp.anfrage.body.reduceNum === 50 && rp.warnungen.includes('teilverkauf'), JSON.stringify(rp))
    p('Prüfen sendet nichts', pionex.sendungen === vorR)
    const rs = await post(`/api/bots/${bot.id}/aktion/senden`, { aktion: 'reduzieren', eingabe: { anteil: '25', ...rp.eingabe }, token: rp.token, haken: true, hakenText: haken })
    p('Senden mit der geprüften Menge: ausgeführt, reduce mit reduceNum 50', rs.d.ok && rs.d.zustand === 'ausgefuehrt' && pionex.letzte.pfad.endsWith('/reduce') && pionex.letzte.body.reduceNum === 50, JSON.stringify(rs.d))
    const r2 = (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'reduzieren', eingabe: { anteil: '25' } })).d
    const rAnders = await post(`/api/bots/${bot.id}/aktion/senden`, { aktion: 'reduzieren', eingabe: { reduceNum: '60' }, token: r2.token, haken: true, hakenText: haken })
    p('andere Menge als geprüft → abgewiesen, nichts gesendet', rAnders.status >= 400 && pionex.sendungen === vorR + 1)
    p('Anteil 0 oder über 100 → 400', (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'reduzieren', eingabe: { anteil: '150' } })).status === 400)
    // Audit FUN-R-105: tatsächlicher Anteil zurück, Rundung auf 0 abgelehnt
    p('25 % von 200: tatsächlicher Anteil 25 %', rp.anteil?.gewuenscht === 25 && rp.anteil?.tatsaechlich === 25, JSON.stringify(rp.anteil))
    pionex.maxReduce = 3
    const vorK = pionex.sendungen
    const k10 = await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'reduzieren', eingabe: { anteil: '10' } })
    p('Höchstmenge 3, 10 % → rundet auf 0: 400 anteilZuKlein, kein Token, kleinster Schritt genannt', k10.status === 400 && k10.d.code === 'anteilZuKlein' && !k10.d.token && k10.d.schritt === 33.3, JSON.stringify(k10.d))
    const k20 = (await post(`/api/bots/${bot.id}/aktion/pruefen`, { aktion: 'reduzieren', eingabe: { anteil: '20' } })).d
    p('Höchstmenge 3, 20 % → 1 Schritt, tatsächlich 33 % statt 20 %', k20.bestanden && k20.eingabe?.reduceNum === '1' && k20.anteil?.gewuenscht === 20 && Math.abs(k20.anteil?.tatsaechlich - 100 / 3) < 1e-9, JSON.stringify(k20.anteil))
    p('beides nur geprüft, nichts gesendet', pionex.sendungen === vorK)
    pionex.maxReduce = 0

    console.log('Datenbankfehler nach dem Senden (Audit BUG-R-106)')
    const prD = await pruefe()
    const vorD = pionex.sendungen
    pionex.dbWeg = true
    const sD = await sende(prD.token)
    pionex.dbWeg = false
    await knex.schema.renameTable('bot_aenderungen_weg', 'bot_aenderungen')
    p('Protokoll scheitert nach dem Senden → kein 502, Ausgang der Sendung + protokollFehler', sD.status === 200 && sD.d.zustand === 'ausgefuehrt' && sD.d.ok === true && sD.d.protokollFehler === true && pionex.sendungen === vorD + 1, JSON.stringify(sD))
    const sD2 = await sende(prD.token)
    p('derselbe Token danach → verbraucht, keine zweite Sendung', sD2.status === 409 && sD2.d.code === 'verbraucht' && pionex.sendungen === vorD + 1, JSON.stringify(sD2.d))
    p('ohne Datenbankfehler kein Vermerk', s1.d.protokollFehler === undefined)

    console.log('Bot-Planer: Mindesteinsatz')
    pionex.minEinsatz = 37.3; pionex.pruefungen = 0
    const zuKlein = (await post('/api/bots/plan/aktion/pruefen', { aktion: 'starten', eingabe: { ...plan, einsatz: '5' } })).d
    p('zu kleiner Einsatz: nicht bestanden, Grund erkannt, kein Token', !zuKlein.bestanden && zuKlein.grund === 'einsatzZuKlein' && !zuKlein.token)
    p('Prüfung nennt den Mindesteinsatz (aufgerundet, nie darunter)', zuKlein.minEinsatz >= 37.3 && zuKlein.minEinsatz <= 40, String(zuKlein.minEinsatz))
    p('Suche bleibt bei wenigen Abfragen', pionex.pruefungen <= 15, String(pionex.pruefungen))
    const vorM = pionex.sendungen
    const m1 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, einsatz: '5' } })).d
    p('Planer: 5 USDT reichen nicht, Minimum genannt', m1.reichtAus === false && m1.min >= 37.3 && m1.min <= 40)
    p('Planer-Suche sendet nichts', pionex.sendungen === vorM)
    pionex.pruefungen = 0
    const m2 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, einsatz: '50' } })).d
    p('gleicher Plan, anderer Einsatz: aus dem Speicher, ohne Abfrage', m2.reichtAus === true && m2.min === m1.min && pionex.pruefungen === 0)
    const m3 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '80', einsatz: '100' } })).d
    p('Einsatz reicht: eine Abfrage, kein Minimum', m3.reichtAus === true && m3.min === null && pionex.pruefungen === 1)
    const m4 = await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, unten: '170' } })
    p('ungültiger Plan → 400', m4.status === 400 && m4.d.code === 'kursAusserhalb')
    // Pionex bremst mitten in der Suche (gesehen 14.11.2026): nochmal fragen statt abbrechen
    pionex.pruefungen = 0
    const erste = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '70', einsatz: '5' } })).d
    pionex.bremse = 1
    const m5 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '71', einsatz: '5' } })).d
    p('Bremse während der Suche: nochmal gefragt, Minimum trotzdem gefunden', erste.min >= 37.3 && m5.reichtAus === false && m5.min >= 37.3 && m5.min <= 40, JSON.stringify(m5))
    pionex.pruefungen = 0
    const m7 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, coinM: false, anzahl: '73', einsatz: '5' }, schaetzung: 19.411764705882354 })).d
    p('Schätzwert mit vielen Nachkommastellen: auf 2 gerundet geprüft, Minimum gefunden', m7.reichtAus === false && m7.min >= 37.3 && m7.min <= 40, JSON.stringify(m7))
    pionex.bremse = 99
    const m6 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '72', einsatz: '5' } })).d
    p('Pionex bremst dauernd: unbekannt statt „zu klein"', m6.ok && m6.reichtAus !== false && m6.min === null, JSON.stringify(m6))
    pionex.bremse = 0
    // Audit FUN-R-102: Coin-M-Minimum 0.02 SOL wurde als 0.1 gemeldet, und aus dem Speicher kam danach «reicht nicht»
    pionex.minEinsatz = 0.02; pionex.pruefungen = 0
    const c1 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '90', einsatz: '0.005' } })).d
    p('Coin-M: Minimum 0.02 wird nicht auf 0.1 aufgerundet', c1.reichtAus === false && c1.min >= 0.02 && c1.min <= 0.024, JSON.stringify(c1))
    pionex.pruefungen = 0
    const c2 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '90', einsatz: '0.05' } })).d
    p('Coin-M: 0.05 reicht (aus dem Speicher, ohne Abfrage)', c2.reichtAus === true && c2.min === c1.min && pionex.pruefungen === 0, JSON.stringify(c2))
    const c3 = (await post('/api/bots/plan/mindesteinsatz', { eingabe: { ...plan, anzahl: '90', einsatz: '0.01' } })).d
    p('Coin-M: 0.01 reicht nicht (aus dem Speicher)', c3.reichtAus === false && pionex.pruefungen === 0, JSON.stringify(c3))
    const c4 = (await post('/api/bots/plan/aktion/pruefen', { aktion: 'starten', eingabe: { ...plan, anzahl: '91', einsatz: '0.005' } })).d
    p('Coin-M: Prüfung im Dialog nennt das kleine Minimum', c4.minEinsatz >= 0.02 && c4.minEinsatz <= 0.024, String(c4.minEinsatz))
    pionex.minEinsatz = 0

    console.log('Protokoll')
    const prot = await (await fetch(`${basis}/api/bots/${bot.id}/aenderungen`)).json()
    p('Protokoll liefert Zustände und Freischalten', prot.aenderungen.some((x) => x.zustand === 'unklar') && prot.aenderungen.some((x) => x.aktion === 'freischalten'))
} catch (e) {
    fehl++
    console.error('  ✗ Ausnahme:', e)
} finally {
    server?.close()
    try { await getKnex().destroy() } catch { }
    for (const f of [datei, `${datei}-wal`, `${datei}-shm`]) { try { fs.unlinkSync(f) } catch { } }
}

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
