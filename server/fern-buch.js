/**
 * Orderbuch-Fernfeld für BTC und ETH (Futures UND Spot): hält das ganze Buch
 * bis ±20 % um den Kurs und schreibt jede Minute ein Abbild in Zonen
 * (`live_recordings`, Art `fern`, eine Zeile je Symbol/Markt/Stunde).
 *
 * Warum ein eigener Recorder neben dem Heatmap-Recorder: der schneidet das Buch
 * auf ±3 % zu (Rechenlast seiner Sekunden-Frames) und läuft nur für die in den
 * Einstellungen gewählten Symbole, nur Futures. Hier geht es um die grossen
 * Wände weit weg — 1000 BTC bei 60 000 —, und die gibt es nur im Fernfeld und
 * zu einem guten Teil im Spot-Buch. Der Wunsch (15.11.2026): nur BTC und ETH,
 * „richtet sich eh alles nach Bitcoin".
 *
 * Wie die Mengen entstehen: REST-Snapshot (Futures 1000 Stufen, Spot 5000)
 * plus Diff-Strom `@depth@100ms`, der jede Änderung an jeder Stufe meldet.
 * Ausserhalb des Snapshots kennt das Buch nur, was sich seit dem Start der
 * Verbindung geändert hat — jedes Abbild trägt deshalb `seit` und die
 * Snapshot-Abdeckung `lo`/`hi`, damit die Anzeige das sagen kann. Alle 30 min
 * ein Re-Anker (Merge, kein Reset) wie im Heatmap-Recorder.
 *
 * Läuft nur im Prozess mit der Recorder-Führung (`live-recorder.js` startet
 * und stoppt ihn) und nur mit Binance als Marktdatenquelle.
 */
import zlib from 'zlib'
import { promisify } from 'util'
import WebSocket from 'ws'
import { getKnex } from './database.js'
import { OrderBook } from '../shared/orderbook.js'
import * as marktdaten from './marktdaten/index.js'
import { logWarn, logError } from './logger.js'
import {
    FERN_PCT, FERN_FRAME_MS, fernSchritt, fernFrame, kodiereStunde, dekodiereStunde, mischeFrames,
} from '../shared/fernBuch.js'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)
const HOUR_MS = 3_600_000
const WS_OPTIONEN = { maxPayload: 4 * 1024 * 1024 }
const BWS = marktdaten.ANBIETER.binance.WS
const WS_BASE = { futures: `${BWS.futures}/public/stream?streams=`, spot: `${BWS.spot}/stream?streams=` }
const REST_PFAD = { futures: '/fapi/v1/depth', spot: '/api/v3/depth' }
// Spot erlaubt 5000 Stufen (Gewicht 250 aus dem eigenen Spot-Budget), Futures höchstens 1000 (Gewicht 20)
const TIEFE = { futures: 1000, spot: 5000 }
const STILLE_MS = 15_000
const ANKER_MS = 30 * 60_000

function hourFloor(t) { return Math.floor(t / HOUR_MS) * HOUR_MS }

export class FernBuchRecorder {
    constructor(symbol, market) {
        this.symbol = symbol
        this.market = market
        this.book = new OrderBook()
        this.ws = null
        this.pending = []
        this.buffering = true
        this.stopped = true
        this.attempt = 0
        this.seit = 0              // seit wann das Buch ohne Neuaufbau gesammelt wird
        this.letzterAnker = 0
        this.lastMsg = 0
        this.stunde = null         // { hourStart, frames, altGeladen }
        this.letzterFrame = null
        this.kette = Promise.resolve()
        this.timer = []
    }

    get schluessel() { return `${this.symbol}|${this.market}` }

    start() {
        this.stopped = false
        this._verbinde()
        this.timer.push(setInterval(() => this._takt(), 5_000))
    }

    async stop() {
        this.stopped = true
        for (const t of this.timer) clearInterval(t)
        this.timer = []
        clearTimeout(this.neuTimer)
        clearTimeout(this.snapTimer)
        this._loese()
        await this._schreibe()
    }

    _loese() {
        if (!this.ws) return
        this.ws.removeAllListeners()
        try { this.ws.terminate() } catch { /* zu */ }
        this.ws = null
    }

    _verbinde() {
        if (this.stopped) return
        this._loese()
        const ws = new WebSocket(WS_BASE[this.market] + `${this.symbol.toLowerCase()}@depth@100ms`, WS_OPTIONEN)
        this.ws = ws
        ws.on('open', () => { if (this.ws === ws) { this.attempt = 0; this.lastMsg = Date.now(); this._neuSync() } })
        ws.on('message', (raw) => {
            if (this.ws !== ws) return
            this.lastMsg = Date.now()
            let msg
            try { msg = JSON.parse(raw) } catch { return }
            const d = msg.data || msg
            if (d.e !== 'depthUpdate') return
            if (this.buffering) {
                this.pending.push(d)
                if (this.pending.length > 5000) this.pending.splice(0, this.pending.length - 5000)
                return
            }
            if (this.book.applyDiff(d, this.market === 'futures') === 'resync') this._neuSync()
        })
        ws.on('close', () => {
            if (this.stopped || this.ws !== ws) return
            this.buffering = true
            const warte = Math.min(60_000, 2000 * 2 ** this.attempt++) * (0.5 + Math.random())
            this.neuTimer = setTimeout(() => this._verbinde(), warte)
        })
        ws.on('error', () => { try { ws.close() } catch { /* zu */ } })
    }

    _neuSync() {
        this.book.reset()
        this.pending.length = 0
        this.buffering = true
        this.seit = 0
        clearTimeout(this.snapTimer)
        this.snapTimer = setTimeout(() => this._snapshot(0), 300)
    }

    async _holeTiefe() {
        return marktdaten.binanceHole('streams', this.market, REST_PFAD[this.market], { symbol: this.symbol, limit: TIEFE[this.market] }, { timeout: 20_000 })
    }

    async _snapshot(versuch) {
        if (this.stopped) return
        try {
            const data = await this._holeTiefe()
            if (this.stopped) return
            this.book.applySnapshot(data)
            for (const ev of this.pending) {
                if (this.book.applyDiff(ev, this.market === 'futures') === 'resync') { this._neuSync(); return }
            }
            this.pending.length = 0
            this.buffering = false
            this.seit = Date.now()
            this.letzterAnker = Date.now()
        } catch (e) {
            if (this.stopped) return
            const warte = Math.min(3000 * 2 ** versuch, 120_000)
            if (versuch === 0 || versuch % 10 === 0) logWarn('fern-buch', `Snapshot ${this.schluessel} fehlgeschlagen (nächster in ${Math.round(warte / 1000)} s)`, e.message)
            this.snapTimer = setTimeout(() => this._snapshot(versuch + 1), warte)
        }
    }

    async _anker() {
        if (this._ankerLaeuft) return
        this._ankerLaeuft = true
        try {
            const data = await this._holeTiefe()
            if (this.stopped || this.buffering || !this.book.synced) return
            // Top-of-Book-Kontrolle wie im Heatmap-Recorder: > 10 bp daneben = Buch kaputt → neu aufbauen
            const eigen = this.book.bestPrices()
            const bid = Number(data.bids?.[0]?.[0]), ask = Number(data.asks?.[0]?.[0])
            if (eigen.mid && Number.isFinite(bid) && Number.isFinite(ask)
                && Math.max(Math.abs(eigen.bestBid - bid), Math.abs(eigen.bestAsk - ask)) / eigen.mid > 0.001) {
                this._kontrolle = (this._kontrolle || 0) + 1
                if (this._kontrolle >= 2) { this._kontrolle = 0; logWarn('fern-buch', `${this.schluessel}: Top-of-Book weicht ab, Buch wird neu aufgebaut`); this._neuSync() }
                return
            }
            this._kontrolle = 0
            this.book.mergeSnapshot(data)
        } catch { /* nächster Takt */ } finally {
            this.letzterAnker = Date.now()
            this._ankerLaeuft = false
        }
    }

    _takt() {
        if (this.stopped) return
        const jetzt = Date.now()
        // Halbtoter Socket: depth@100ms schweigt nie lange
        if (this.ws?.readyState === WebSocket.OPEN && jetzt - this.lastMsg > STILLE_MS) {
            logWarn('fern-buch', `${this.schluessel}: ${Math.round((jetzt - this.lastMsg) / 1000)} s Stille — neu verbinden`)
            try { this.ws.terminate() } catch { /* zu */ }
            return
        }
        if (this.buffering || !this.book.synced) return
        if (jetzt - this.letzterAnker >= ANKER_MS) this._anker()
        const slot = Math.floor(jetzt / FERN_FRAME_MS) * FERN_FRAME_MS
        if (this.letzterFrame?.t === slot) return
        const { mid } = this.book.bestPrices()
        if (!(mid > 0)) return
        this.book.prune(mid, FERN_PCT + 0.02)
        const stundeT = hourFloor(slot)
        if (this.stunde && this.stunde.hourStart !== stundeT) {
            this._schreibe()   // fertige Stunde (synchron eingefangen)
            this.stunde = null
        }
        if (!this.stunde) this.stunde = { hourStart: stundeT, frames: [], altGeladen: false }
        // Zonenbreite einmal je Stunde: innerhalb einer Zeile bleibt sie gleich
        const s = this.stunde.frames[0]?.s || fernSchritt(mid)
        const { b, a } = fernFrame(this.book, { mid, schritt: s })
        const frame = { t: slot, mid: +mid.toPrecision(10), s, seit: this.seit, lo: this.book.coverLo, hi: this.book.coverHi, b, a }
        this.stunde.frames.push(frame)
        this.letzterFrame = frame
        this._schreibe()
    }

    /** Laufende Stunde komplett neu schreiben (ein Schreiber, ≤ 60 Frames). Seriell über eine Kette. */
    _schreibe() {
        const st = this.stunde
        if (!st?.frames.length) return this.kette
        const frames = st.frames.slice()
        this.kette = this.kette.then(async () => {
            const knex = getKnex()
            const wo = { symbol: this.symbol, market: this.market, kind: 'fern', hourStart: st.hourStart }
            let alle = frames
            // Neustart mitten in der Stunde: den Altbestand der Zeile einmal übernehmen, sonst überschriebe der erste Rewrite ihn
            if (!st.altGeladen) {
                const z = await knex('live_recordings').where(wo).first('payload')
                if (z?.payload) {
                    st.alt = dekodiereStunde((await gunzip(z.payload)).toString('utf8'))
                        .filter((f) => f.t < frames[0].t)
                }
                st.altGeladen = true
            }
            if (st.alt?.length) alle = mischeFrames(st.alt, frames)
            const payload = await gzip(Buffer.from(kodiereStunde(alle), 'utf8'))
            await knex('live_recordings').insert({
                ...wo, frameMs: FERN_FRAME_MS, rows: 0, cols: alle.length,
                bucketSize: alle[alle.length - 1].s, quantRef: 0,
                bytes: payload.length, payload, createdAt: Date.now(),
            }).onConflict(['symbol', 'market', 'kind', 'hourStart']).merge()
        }).catch((e) => logError('fern-buch', `Speichern ${this.schluessel} fehlgeschlagen`, e))
        return this.kette
    }

    /** Frames der laufenden Stunde aus dem Speicher (für die Route, ohne DB-Umweg). */
    framesAb(von) {
        return (this.stunde?.frames || []).filter((f) => f.t >= von)
    }
}
