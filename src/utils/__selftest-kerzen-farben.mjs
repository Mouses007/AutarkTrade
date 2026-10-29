// Kerzenfarben: Vorgabe, gespeicherte Werte, Unsinn fällt auf die Vorgabe zurück.
import assert from 'node:assert/strict'
import { KERZEN_STANDARD, kerzenFarben, kerzenOptionen, volumenFarbe, mitDeckkraft } from './chart/kerzenFarben.js'

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
console.log(`\n${n} bestanden, 0 fehlgeschlagen`)
