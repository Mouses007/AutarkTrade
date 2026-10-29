// Kerzenfarben: Vorgabe, gespeicherte Werte, Unsinn fällt auf die Vorgabe zurück.
import assert from 'node:assert/strict'
import { KERZEN_STANDARD, kerzenFarben, kerzenOptionen, volumenFarbe, mitDeckkraft, trifftKerze } from './chart/kerzenFarben.js'

let n = 0
const ok = (f, m) => { f(); n++; if (process.env.VERBOSE) console.log('ok', m) }

ok(() => assert.deepEqual(kerzenFarben(null), KERZEN_STANDARD), 'ohne Einstellungen = Vorgabe')
ok(() => assert.deepEqual(kerzenFarben({ chartKerzeSteigend: '#26A69A', chartKerzeFallend: '#ef5350' }),
    { steigend: '#26a69a', fallend: '#ef5350' }), 'gespeicherte Werte, klein geschrieben')
ok(() => assert.deepEqual(kerzenFarben({ chartKerzeSteigend: 'rot', chartKerzeFallend: '' }), KERZEN_STANDARD), 'Unsinn/leer = Vorgabe')
ok(() => assert.equal(mitDeckkraft('#1fd6c4', 0.12), 'rgba(31,214,196,0.12)'), 'Deckkraft')
const o = kerzenOptionen(KERZEN_STANDARD)
ok(() => assert.equal(o.borderUpColor, '#1fd6c4'), 'Rand steigend in der Hausfarbe')
ok(() => assert.equal(o.upColor, 'rgba(31,214,196,0.12)'), 'steigend hohl')
ok(() => assert.equal(o.downColor, '#787b86'), 'fallend grau gefüllt')
ok(() => assert.equal(volumenFarbe(KERZEN_STANDARD, false), 'rgba(120,123,134,0.28)'), 'Volumen fallend')
const k = { mitteX: 100, hochY: 50, tiefY: 90, breite: 10 }
ok(() => assert.equal(trifftKerze(102, 70, k), true), 'Treffer im Körper')
ok(() => assert.equal(trifftKerze(100, 47, k), true), 'Treffer knapp über dem Docht')
ok(() => assert.equal(trifftKerze(100, 30, k), false), 'weit über der Kerze = kein Treffer')
ok(() => assert.equal(trifftKerze(110, 70, k), false), 'neben der Kerze = kein Treffer')
ok(() => assert.equal(trifftKerze(101, 72, { mitteX: 100, hochY: 72, tiefY: 72, breite: 1 }), true), 'flache, schmale Kerze trifft mit Mindestbreite')
ok(() => assert.equal(trifftKerze(100, 70, { mitteX: null, hochY: 50, tiefY: 90 }), false), 'ohne Koordinaten kein Treffer')
console.log(`\n${n} bestanden, 0 fehlgeschlagen`)
