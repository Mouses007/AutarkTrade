/**
 * Selbsttest: Formatierung der Bot-Seite (src/components/bots/format.js) — Rundung vor
 * Vorzeichen und Farbe, Coin-Beträge mit gültigen Stellen, Dauer (Audit UI-07/UI-12).
 * Aufruf: node src/utils/__selftest-bot-format.mjs
 */
import { betrag, prozent, zahl, menge, mengenEinheit, dauer, laufzeitTage, ton, tonProzent, preis } from '../components/bots/format.js'

let ok = 0, fehl = 0
const p = (name, ist, soll) => {
    if (ist === soll) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name} — «${ist}» statt «${soll}»`) }
}

console.log('Vorzeichen nach dem Runden')
p('−0.04 % → ohne Minus', prozent(-0.0004), '0.0 %')
p('+0.04 % → ohne Plus', prozent(0.0004, { vorzeichen: true }), '0.0 %')
p('+1.26 %', prozent(0.0126, { vorzeichen: true }), '+1.3 %')
p('zahl(−0.4) → 0', zahl(-0.4), '0')
p('−0.004 USDT → 0.00 ohne Minus', betrag(-0.004, 'USDT', { vorzeichen: true }), '0.00 USDT')
p('+0.004 USDT → 0.00 ohne Plus', betrag(0.004, 'USDT', { vorzeichen: true }), '0.00 USDT')
p('+0.005 USDT → +0.01', betrag(0.0051, 'USDT', { vorzeichen: true }), '+0.01 USDT')

console.log('Ton folgt der gezeigten Zahl')
p('0.004 USDT neutral', ton(0.004), 'neutral')
p('−0.004 USDT neutral', ton(-0.004), 'neutral')
p('0.01 USDT gut', ton(0.01), 'gut')
p('0.00004 BTC gut', ton(0.00004, 'BTC'), 'gut')
p('−0.00004 BTC schlecht', ton(-0.00004, 'BTC'), 'schlecht')
p('unbekannt neutral', ton(null), 'neutral')
p('0.04 % neutral', tonProzent(0.0004), 'neutral')
p('−0.4 % schlecht', tonProzent(-0.004), 'schlecht')

console.log('Coin-Beträge')
p('0.00004 BTC nicht «0.0000»', betrag(0.00004, 'BTC'), '0.00004 BTC')
p('0.0123 SOL', betrag(0.0123, 'SOL'), '0.0123 SOL')
p('1.23456 SOL bleibt bei 4', betrag(1.23456, 'SOL'), '1.2346 SOL')
p('0 BTC', betrag(0, 'BTC'), '0.0000 BTC')
p('USDT bleibt bei 2', betrag(12.345, 'USDT'), '12.35 USDT')
p('ohne Münze kein «null»', betrag(1.5, null), '1.5000')
p('unbekannt → Strich', betrag(undefined, 'BTC'), '—')

console.log('Mengen mit Einheit')
p('0.0123 BTC nicht «0»', menge(0.0123, 'BTC'), '0.0123 BTC')
p('3.068 ETH', menge(3.068, 'ETH'), '3.068 ETH')
p('44 XRP', menge(44, 'XRP'), '44 XRP')
p('0.00037 BTC', menge(0.00037, 'BTC'), '0.00037 BTC')
p('unbekannt → Strich ohne Einheit', menge(null, 'BTC'), '—')
p('Einheit USDT-M = Coin', mengenEinheit({ coin: 'XRP', coinM: false }), 'XRP')
p('Einheit Coin-M = USD', mengenEinheit({ coin: 'SOL', coinM: true }), 'USD')

console.log('Dauer')
p('nie negativ', dauer(-1), '0 min')
p('2 Minuten', dauer(2 / 1440), '2 min')
p('59 Minuten', dauer(59 / 1440), '59 min')
p('eine Stunde', dauer(1 / 24), '1 h')
p('12 h', dauer(0.5), '12 h')
p('3.3 d', dauer(3.26), '3.3 d')
p('unbekannt', dauer(null), '—')
const jetzt = 1_800_000_000_000
p('laufender Bot: aus erstellt, nicht die Untergrenze des Servers', dauer(laufzeitTage({ erstellt: jetzt - 120_000, laufend: true }, 1 / 24, jetzt)), '2 min')
p('beendeter Bot: erstellt bis beendet', dauer(laufzeitTage({ erstellt: jetzt - 7_200_000, beendet: jetzt - 3_600_000 }, 5, jetzt)), '1 h')
p('ohne Zeiten: Wert des Servers', laufzeitTage({}, 2.5, jetzt), 2.5)
p('beendet ohne Endzeit: Wert des Servers', laufzeitTage({ erstellt: jetzt - 1000, laufend: false }, 2.5, jetzt), 2.5)

console.log('Preis unverändert')
p('kleiner Preis', preis(0.00000876), '0.00000876')

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
