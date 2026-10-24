/**
 * Selbsttest Agenten-Veto: Budgetdeckel und Verkleinerungsfaktor
 * (strategy-agents-regeln.js, rein). Audit BETA-PORTFOLIO-AUDIT F1/F2.
 */
import { budgetDeckel, vetoFaktor } from './strategy-agents-regeln.js'

let ok = 0, fail = 0
const pruefe = (name, bed) => { if (bed) ok++; else { fail++; console.error('✗', name) } }

// F1 — Faktor 0 ist Grösse null, nicht volle Grösse
pruefe('0 bleibt 0', vetoFaktor(0) === 0)
pruefe('"0" bleibt 0', vetoFaktor('0') === 0)
pruefe('negativ → 0', vetoFaktor(-0.5) === 0)
pruefe('0,5 bleibt', vetoFaktor(0.5) === 0.5)
pruefe('1 bleibt', vetoFaktor(1) === 1)
pruefe('2 → 1 (nie vergrössern)', vetoFaktor(2) === 1)
pruefe('fehlend → 1', vetoFaktor(undefined) === 1 && vetoFaktor(null) === 1 && vetoFaktor('') === 1)
pruefe('unlesbar → 1', vetoFaktor('viel') === 1 && vetoFaktor(NaN) === 1)

// F2 — der Regler gilt
pruefe('Regler 0,20 schlägt Instanz-Default 1', budgetDeckel(0.2, 1) === 0.2)
pruefe('Regler 5 schlägt Instanz-Default 1', budgetDeckel(5, 1) === 5)
pruefe('Regler 0 → kein Budget', budgetDeckel(0, 1) === 0)
pruefe('Regler als Text', budgetDeckel('0.5', 1) === 0.5)
pruefe('ohne Einstellung: Instanzwert', budgetDeckel(null, 3) === 3)
pruefe('ohne Einstellung, negativer Instanzwert öffnet nichts', budgetDeckel(undefined, -1) === 1)
pruefe('ohne alles: 1 USD', budgetDeckel(null, undefined) === 1)
pruefe('negativer Regler → 0, nicht offen', budgetDeckel(-3, 1) === 0)

console.log(`Agenten-Regeln: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
