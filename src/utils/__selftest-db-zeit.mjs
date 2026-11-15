/**
 * Selbsttest: Zeitstempel aus der Datenbank als Ortszeit (`dbZeit` in `journal/zeit.js`).
 *
 *   node src/utils/__selftest-db-zeit.mjs
 *
 * Anlass (Audit 15.11.2026, BUG-R-208): die Gesprächsliste des KI-Coachs zeigte auf
 * SQLite jede Zeit um den UTC-Versatz zu früh — SQLite liefert "2026-11-15 14:14:14"
 * (UTC, ohne Zonenangabe), `dayjs()` las es als Ortszeit.
 */
process.env.TZ = 'Europe/Zurich'

let bestanden = 0
let fehler = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const { default: dayjs, dbZeit } = await import('./journal/zeit.js')
const F = 'DD.MM.YYYY HH:mm'

p('SQLite im Winter: 14:14 UTC → 15:14 in Zürich', dbZeit('2026-11-15 14:14:14').format(F) === '15.11.2026 15:14', dbZeit('2026-11-15 14:14:14').format(F))
p('SQLite im Sommer: 14:14 UTC → 16:14 in Zürich', dbZeit('2026-07-15 14:14:14').format(F) === '15.07.2026 16:14', dbZeit('2026-07-15 14:14:14').format(F))
p('über Mitternacht: 23:30 UTC → Folgetag 00:30', dbZeit('2026-11-15 23:30:00').format(F) === '16.11.2026 00:30')
p('mit Bruchteilen und T, weiter ohne Zone → UTC', dbZeit('2026-11-15T14:14:14.123').format(F) === '15.11.2026 15:14')
p('PostgreSQL (ISO mit Z) unverändert', dbZeit('2026-11-15T14:14:14.000Z').format(F) === '15.11.2026 15:14')
p('ISO mit Versatz unverändert', dbZeit('2026-11-15T14:14:14+01:00').format(F) === '15.11.2026 14:14')
p('Zahl (Millisekunden) unverändert', dbZeit(Date.UTC(2026, 10, 15, 14, 14)).format(F) === '15.11.2026 15:14')
p('Gegenprobe: so stand es vorher falsch in der Liste', dayjs('2026-11-15 14:14:14').format(F) === '15.11.2026 14:14')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
