# Stores

Kein Pinia: Zustand sind direkt exportierte `ref()`/`reactive()`/`computed()`.
Seit S7 (Neubau des Journal-Kerns) leben die Werte nach Zuständigkeit in zwei
Ordnern; die exportierten Namen sind unverändert (Spezifikation
`docs/spec/journal-kern.md` §3).

## Wo die Werte leben

| Datei | Inhalt |
|-------|--------|
| `app/rahmen.js` | Seite (`seitenId`), Einstellungszeile (`appEinstellungen`), Zeitzone, Modus, Menü, Reiterzustand, Abfrage-Limits |
| `app/laden.js` | Spinner, Mounted-Flags, `zeichenZaehler`, `negativeTagGruppen` |
| `app/einstellungen.js` | `profilZaehler`, `apis`, `layoutStyle`, KI-Report-Status |
| `app/ablage.js` | Hilfen zum Lesen aus localStorage/sessionStorage beim Laden (kein Zustand) |
| `journal/filter.js` | Auswahl der Seitenleiste (`selected*`, `betragArt` …) und Optionslisten |
| `journal/auswertung.js` | Ergebnis der Kette: `journalTage*`, `totals`, `summenJeTag`, `groups`, `gewinnAnalyse` |
| `journal/import.js` | Import-Vorschau: `executions`, `trades`, `blotter`, `pAndL`, vorhandene Tage |
| `journal/tagebuch.js` | Zufriedenheit, Tags, Tag-Katalog, Notizen, Exkursionen, Zustand des Trade-Fensters (`exkursionEntwurf`, `tagsDesTrades`) |
| `journal/kalender.js` | `kalenderDaten`, `miniKalenderDaten`, `kalenderKonten` |
| `journal/bilder.js` | Bildpfad: geladene Liste, Monatsübersicht, Bild in Bearbeitung, Vollbild, Markierungsauftrag, Blätterstand |
| `journal/offenePositionen.js` | Incoming-Positionen, aufgeklappte Position und Bewertungs-Hinweise |

## Einstiegspunkte (Re-Exporte)

| Datei | Inhalt |
|-------|--------|
| `ui.js` | `ui/loading.js`, `ui/navigation.js`, `ui/screenshots-ui.js`, `ui/app.js` |
| `filters.js` | `filters/selection.js`, `filters/options.js` |
| `trades.js` | `trades/dashboard.js`, `add-trades.js`, `daily-detail.js`, `incoming.js`, `screenshots.js` (Bilder), `calendar.js` |
| `settings.js` | `settings/app.js`, `settings/reporting.js` |

Die Unterordner re-exportieren nur aus `app/*` und `journal/*`. Neuer Code
importiert am besten direkt aus `app/*` bzw. `journal/*`:

```js
import { seitenId, tradeZeitzone } from '@/stores/app/rahmen.js'
import { tagAuswahl, gewaehlterBereich } from '@/stores/journal/filter.js'
```

`globals.js` ist nur noch eine Weiterleitung für parallele Sitzungen und
entfällt in S9.

## Regeln

- `reactive([])`/`reactive({})` werden in place geleert und gefüllt, nie
  ersetzt — Konsumenten halten Referenzen darauf.
- Ohne `localStorage` (Node ohne Attrappe) liefern einige Filter-Exporte ''
  statt einer Ref (Altverhalten, `app/ablage.js`: `refOderLeer`).
