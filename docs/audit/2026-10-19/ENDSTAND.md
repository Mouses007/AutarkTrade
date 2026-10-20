# Endstand nach den Korrekturen F1–F4 (20.10.2026)

Prüfung F4 „Endprüfung + Historien-Skript". Grundlage sind die vier Berichte vom 19.10.2026 in
diesem Ordner und deren Abschnitte „Stand nach F1/F2/F3". Hier steht nur die Bilanz. Was bei
einem Befund im Einzelnen gemacht wurde (Commit, Beleg), steht im jeweiligen Bericht.

## Kurz

- **Befunde:** 108 in den vier Berichten. **101 erledigt** (behoben, kein Handlungsbedarf oder mit
  Grund belassen), **7 offen:** drei Historien-Befunde (A3-27, A3-29, A3-30), für die das Skript
  bereitliegt; zwei Sicherheits-Reste, die Infrastruktur beim Hersteller brauchen (A2-15,
  A2-26); zwei bewusste Oberflächen-Entscheidungen (A4-09, A4-19).
- **Herkunft:** Prüfskript mit Exit 0, nichts ungesichtet.
- **Historie:** Das Update holt jetzt nur noch flach. Das Skript für die neue Wurzel ist bereit
  und auf einer Wegwerf-Kopie getestet. **Auf dem echten Repo ist es noch nicht ausgeführt;
  das entscheidet der Nutzer.** Bis dahin enthält das Repo auf GitHub weiter die Historie
  ab dem Ausgangsstand des Forks (A3-27, A3-29, A3-30 offen).
- **Sicherung:** `/home/maro/Schreibtisch/Trading/V2-historie-bis-2026-10-20.bundle` und ein
  zweites Bündel nach F4 (siehe unten).

## Endprüfung (alle Läufe auf master nach F4)

| Prüfung | Ergebnis |
|---|---|
| `npm ci` (Node 20.20.0) | 241 Pakete, ohne Fehler |
| `npm run test:self` | **148/148 Dateien grün, 6 526/6 526 Prüfungen**, darunter beide Golden Master und neu `server/__selftest-update-flach.mjs` |
| `npm run build` | fehlerfrei; die Hinweis-Warnung zu grossen Chunks (> 500 kB) bleibt wie in A4-24 |
| `node scripts/herkunft-pruefen.mjs` | Exit 0. Code: 1 428 von 131 849 Zeilen wörtlich gleich (1,08 %), alle generisch und gesichtet. Übrige Textdateien: 15 von 20 811 (Lizenztexte Dritter, npm-Skripte). Namen: 189 gemeinsam, 0 ungesichtet. **Token-Fenster (aus F3): 130 strenge und 50 normalisierte Läufe über der Schwelle, 0 ungesichtet.** Ergebnis: 0 ungesichtet. |
| dasselbe Prüfskript auf der umgeschriebenen Wegwerf-Kopie | gleiches Ergebnis, Exit 0 (gleicher Baum) |
| Testcontainer `scripts/v2-container.sh`, Port 8091 | Image neu gebaut, Container läuft. Start-Log: Schema v29 = Code v29, PostgreSQL `autarktrade` (Kopie), alle Routen eingerichtet, Testbetrieb mit 11 + 1 Takten nicht gestartet, Engine aus, „AutarkTrade ready!", `GET /` → 200. Kein Fehler, keine Warnung ausser „Update-Prüfung: keine Zugangsdaten“ (erwartet) |

## A1 Funktionsvergleich (15 Befunde): 14 behoben, 1 ohne Handlungsbedarf, 0 offen

| Stand | Befunde |
|---|---|
| behoben (F1) | A1-01 bis A1-14 |
| kein Handlungsbedarf | A1-15 („(Netto)“ ist richtig) |

## A2 Sicherheit (34 Befunde): 31 behoben, 1 mit Grund belassen, 2 teilweise (Rest offen)

| Stand | Befunde |
|---|---|
| behoben (F2) | A2-01 bis A2-14, A2-16 bis A2-25, A2-27 bis A2-31, A2-33, A2-34 |
| offen (Info), bewusst | A2-32: Bilder gehen nur über `<img>` hinaus, keine Route liefert sie mit eigenem Content-Type. Eine MIME-Prüfung hätte gespeicherte Daten-URLs gefährdet und keine Lücke geschlossen. |
| **teilweise, Rest offen** | **A2-15:** Der Zugangs-Token ist jetzt fine-grained und läuft spätestens mit dem Update-Ende ab, steht aber lesbar im Lizenzschlüssel. Ganz weg ist er erst mit einem Download-Proxy mit Lizenzprüfung beim Hersteller. Das ist eine Geschäfts- und Infrastrukturentscheidung. |
| **teilweise, Rest offen** | **A2-26:** Das Update läuft jetzt mit `npm ci`. Es fehlt eine Signatur- bzw. Prüfsummenprüfung des Releases und das Image per Digest. Dafür braucht es einen Signierschritt im Release-Ablauf des Herstellers. F4 ändert daran nichts: Der flache Fetch prüft nur, dass der Commit von der Paketquelle kommt. |

`quill` 2.0.3 (A2-14, „low“, kein Fix-Release) bleibt. Die betroffene Funktion `getSemanticHTML` wird nicht benutzt.

## A3 Fork-Reste (34 Befunde): 18 behoben (davon A3-28 in F4), 13 generisch/ok mit Grund, 3 offen

| Stand | Befunde |
|---|---|
| behoben (F3) | A3-02, A3-03, A3-05, A3-07 bis A3-17, A3-20, A3-21, A3-32 (A3-15 schon in F1) |
| generisch/ok, bleibt mit Grund | A3-01, A3-04, A3-06 (entfällt), A3-18, A3-19, A3-22 bis A3-26, A3-31, A3-33, A3-34 |
| **behoben (F4)** | **A3-28** Auslieferung: Jedes `git fetch`/`git clone` in `server/update-api.js`, `install.sh`, `install-mac.command`, `install.bat`, `update.sh`, `update-mac.command`, `update.bat`, `setup-remote.sh` und im README läuft mit `--depth 1 --no-tags`. Ein bestehender voller Klon wird nach dem Reset abgeschnitten (`server/update-flach.js`, `paketquelle_flach`, `scripts/paketquelle-flach.bat`); der Rollback-Commit bleibt erhalten. Siehe unten. |
| **vorbereitet, offen bis der Nutzer das Skript startet** | **A3-27** Wurzel `6ab0e6d` · **A3-29** `spaeter/scharfer-handel` · **A3-30** übrige Zweige, `origin`, Worktrees. Werkzeug: `scripts/historie-neu-wurzeln.sh`. |

Der Bericht A3 empfiehlt unter „Saubere Lösung“, Punkt 3, statt `push --force` ein neues
privates Repo, weil GitHub alte Objekte über PR-Referenzen und Caches noch eine Weile
erreichbar hält. Das Skript schiebt wie beauftragt mit `--force-with-lease` und weist vor der
Frage darauf hin. Wer ganz sicher gehen will, schiebt die neue Wurzel danach zusätzlich in ein
neues Repo oder bittet den GitHub-Support, die alten Objekte zu entfernen.

## A4 Laufprüfung (25 Befunde): 22 behoben, 1 ohne Handlungsbedarf, 2 offen (bewusst)

| Stand | Befunde |
|---|---|
| behoben (F1) | A4-01 bis A4-08, A4-10 bis A4-18, A4-20 bis A4-24 |
| kein Handlungsbedarf | A4-25 |
| offen (bewusst) | **A4-09:** Die Kachel-Vorgabe im Live-Trading ist die eigene Aufstellung des Nutzers. Sie füllt 4 Spalten genau, bei 1500 px gibt es nur 3. Vorschlag: Spaltenzahl gerade halten oder eine Vorgabe je Breite. **A4-19:** „LSOB“, „Guss“ und „Breakout“ sind die eingebauten Strategien, und die Einstiegsbewertung erkennt Trades an diesen Tags. |

## Historie

**Stand: Das Skript ist bereit, aber noch nicht ausgeführt.** master auf GitHub hat weiter
die Wurzel `6ab0e6d` (Ausgangsstand des Forks). `spaeter/scharfer-handel` und die
`claude/*`-Zweige bestehen weiter, Tags gibt es keine.

### Sicherung (Schritt 1)

| Bündel | Inhalt | Grösse | SHA-256 |
|---|---|---|---|
| `/home/maro/Schreibtisch/Trading/V2-historie-bis-2026-10-20.bundle` | `--all` vor den F4-Commits: 38 Referenzen, master `390a0e6`, `spaeter/scharfer-handel` `e7c6709`, alle `claude/*`, `origin/*`, Worktree-HEADs. `git bundle verify`: gültig, „komplette Historie“ | 16 725 948 Byte (16 MB) | `349acc84ee95eb8d3b122b37166766888832a3005304735bd560f06ee4ef758e` |
| `/home/maro/Schreibtisch/Trading/V2-historie-bis-2026-10-20T*.bundle` | dasselbe nach dem letzten F4-Commit, mit dem master, auf dem das Skript laufen soll | siehe Hinweis | steht im Abschlussbericht von F4 (ein Commit kann die Prüfsumme eines Bündels nicht enthalten, in dem er selbst steckt) |

Beide liegen **ausserhalb** des Repos, neben dem Ordner `V2`. Zum Beleg gehören auch die
Spezifikationen S4–S9 in `/home/maro/Schreibtisch/Trading/AutarkTrade-Beleg/clean-room-spezifikationen-2026-10/`
(aus F3). Die Bündel und diesen Ordner offline und doppelt ablegen, optional mit einem
Zeitstempel eines Dritten (Bericht A3, „Saubere Lösung“, Punkt 1).

Das Skript nimmt ohne `--buendel` das zuletzt sortierte `V2-historie-bis-*.bundle`. Es bricht ab,
wenn dieses Bündel den aktuellen master nicht enthält. Kommt nach F4 noch ein Commit dazu,
muss man deshalb vorher ein neues Bündel anlegen; das Skript zeigt den Befehl dafür an.

### Update ohne Historie (Schritt 2, A3-28): erledigt

- `server/update-api.js`: `git fetch --depth 1 --no-tags <url> master`, dann `reset --hard FETCH_HEAD`, dann
  `macheFlach(PROJECT_ROOT, { rollback: preUpdateCommit })`. Ein Fehler beim Abschneiden bricht das
  Update nicht ab.
- `macheFlach`: löscht alle Referenzen ausser dem aktuellen Zweig und `refs/autarktrade/rollback`
  (symbolische mit `--no-deref`; sonst zeigte `origin/HEAD` ins Leere und `git fsck` meldete
  einen Fehler, Befund aus dem Selbsttest), trägt HEAD und den Rollback-Commit in `.git/shallow`
  ein, leert das Reflog und führt `gc --prune=now` aus.
- Shell (`paketquelle_holen`/`paketquelle_flach` in `scripts/paketquelle.sh`) und Windows
  (`scripts/paketquelle-flach.bat`) machen dasselbe.
- **Befund aus dem Probelauf:** Nach der neuen Wurzel ist der neue master kein Vorspulen des
  alten. Weist git das Nachführen von `origin/master` ab (Refspec ohne `+`), wäre
  `reset --hard origin/master` still auf dem alten Stand stehen geblieben. Alle Update-Skripte
  setzen deshalb wie der Server auf `FETCH_HEAD`.
- **Belege:** Der Selbsttest `server/__selftest-update-flach.mjs` (38 Prüfungen) läuft an
  Wegwerf-Repos über `file://` und deckt ab: Neuinstallation (1 Commit, kein Altstand, keine
  Tags), alter voller Klon (flacher Fetch allein lässt den Altstand stehen, `macheFlach` entfernt
  ihn, Rollback geht, `fsck` sauber), neue Wurzel, den Ablauf von `update.sh` an einem alten Klon
  mit Refspec ohne `+`, `paketquelle_flach` und einen Grep, dass kein Liefer-Skript ohne
  `--depth 1` holt. Dazu ein Probelauf in echter Grösse: Ein Kundenklon des heutigen Repos
  (97 Commits, 52 MB `.git`) ging gegen die umgeschriebene Wegwerf-Kopie und hatte danach
  1 Commit und 12 MB, ohne `6ab0e6d`.
- **Nicht geprüft:** Die Windows-Skripte (`update.bat`, `paketquelle-flach.bat`) liefen hier
  nicht (kein Windows). Geprüft ist nur der Text, per Selbsttest-Grep.
- **Bestehende Installationen:** Wer noch eine Fassung vor F4 hat, führt das erste Update mit
  dem alten Code aus. Der holt die neue Fassung voll, schneidet aber nicht ab. Ab dem zweiten
  Update (oder einem Lauf von `update.sh`) ist der Klon flach. Docker-Installationen haben kein
  `.git` (A3-31).

### Skript `scripts/historie-neu-wurzeln.sh` (Schritt 3): bereit, NICHT ausgeführt

```bash
scripts/historie-neu-wurzeln.sh --trocken   # zeigt alles, ändert nichts
scripts/historie-neu-wurzeln.sh             # fragt vor d), e) und f) und läuft nur nach „ja“
```

Ablauf: (a) Bündel vorhanden, `git bundle verify` gültig, **ganz ausgepackt und `fsck --full`
sauber** (ein abgeschnittenes Bündel besteht `bundle verify`, Befund aus dem Probelauf), enthält
den heutigen master. Ausserdem muss `origin/master` gleich master stehen und eine git-Identität
gesetzt sein. (b) `git commit-tree master^{tree}` mit „AutarkTrade – Ausgangsstand“ und Verweis
auf HERKUNFT.md und das Bündel. (c) Baum vorher = nachher, kein Vorgänger, `git diff` leer, sonst
Abbruch. (d) `update-ref` master mit dem alten Wert als Bedingung. (e) `push
--force-with-lease=refs/heads/master:<alter Wert>`, danach alle übrigen Remote-Zweige und Tags
löschen. (f) saubere Worktrees entfernen (solche mit Änderungen und den eigenen nicht), übrige
Zweige, Tags und Sonder-Referenzen löschen, `reflog expire --expire=now --all`, `gc --prune=now`.
Ein zweiter Lauf, z. B. nachdem ein Worktree mit Änderungen gesichert ist, macht nur noch (f).
Am Ende meldet das Skript, welche Referenz die alte Wurzel noch hält.

Probelauf auf einer Wegwerf-Kopie im Scratchpad: ein nacktes „Remote“ aus dem heutigen Repo
plus Tag, ein Klon mit Zweigen, einem sauberen und einem geänderten Worktree.

| Fall | Ergebnis |
|---|---|
| `--trocken` | Refs, Objektzahl und Remote unverändert. Neuer Commit und Baumvergleich trotzdem angezeigt. |
| kein / abgeschnittenes / veraltetes Bündel, Remote weicht ab, keine Identität | jeweils Abbruch mit Grund, nichts geändert |
| Antwort „nein“ | nichts geändert |
| „ja ja ja“ | Baum vorher = lokal = remote `90ea175da07bb451f1c363c792dda8c0dd2762d7`. Remote hat nur `refs/heads/master` mit einer Wurzel. 23 Zweige und 1 Tag gelöscht. Lokal hielt nur der geänderte Worktree die alte Wurzel und wurde gemeldet. |
| zweiter Lauf nach Sichern des Worktrees | 1 Commit, alte Wurzel weg, `fsck` sauber, `.git` 12 MB |

`spaeter/scharfer-handel` liegt nach dem Lauf nur noch im Bündel. Wie man ihn holt, ohne die
alte Historie zurückzuziehen, steht in `docs/SPAETER-SCHARFER-HANDEL.md`.

### Danach (vom Nutzer)

1. Neues Bündel anlegen, falls master seit dem letzten weitergegangen ist, dann zuerst
   `scripts/historie-neu-wurzeln.sh --trocken`, danach ohne `--trocken`.
2. `git rev-list --max-parents=0 --all` muss genau eine Wurzel zeigen.
   `node scripts/herkunft-pruefen.mjs` erneut laufen lassen.
3. Andere Klone (NAS, Rechner mit git-Installation, Worktrees anderer Sitzungen) frisch klonen
   oder einmal updaten. Die Daten (DB, `db-config.json`) liegen ausserhalb von git.
4. Optional ein neues privates Repo oder den GitHub-Support (siehe oben).
