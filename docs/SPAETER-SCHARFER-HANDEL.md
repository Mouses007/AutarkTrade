# Scharfer Handel — für später aufbewahrt

**Stand 19.10.2026 (S13).** AutarkTrade sendet in der ersten Auslieferung **keine Orders** an eine
Börse. Der scharfe Handel ist ausgebaut und vollständig auf dem Branch
**`spaeter/scharfer-handel`** im privaten Repository (`github.com/Mouses007/AutarkTrade`) aufbewahrt.
Der Branch zeigt auf `e7c6709` — den letzten master-Stand **vor** dem Ausbau (S11 fertig, 144/144
Selbsttests grün). Er wird nicht weiterentwickelt; er ist das Archiv.

Grund: Die Haftungs- und Zulassungsfragen eines Programms, das selbst Orders auslöst (Verkaufs-Prüfung
F-7 „automatisierter Handel", F-6 Anlageberatung), sind vor der ersten Weitergabe nicht geklärt. Ohne
Orderfunktion ist AutarkTrade ein Journal- und Analysewerkzeug mit Strategie-**Simulation**.

## Was auf dem Branch liegt (und in master fehlt)

| Teil | Dateien auf `spaeter/scharfer-handel` | Zweck |
|---|---|---|
| Order-Adapter Bitunix | `server/execution/bitunix.js`, `__selftest-bitunix-order.mjs` | `place_order` mit SL/TP an der Börse, `flash_close_position`, Kontostand, Positions-Kennung |
| Order-Adapter Pionex | `server/execution/pionex.js`, `__selftest-pionex-order.mjs` | Marktorder `MARKET_QTY`, `reduceOnly`-Schliessen über die Börsenmenge, Ziel als Limit, Margenmodus/Hebel setzen, Fills per Order, `orderByClientOrderId` |
| Broker-Vertrag | `server/execution/index.js` (alte Fassung) | `PFLICHT`-Funktionen (`baueOrder`, `openLivePosition`, `closeLivePosition`, `getLiveEquity`, `getLivePositionId`), Fähigkeiten (`boersenStop`, `boersenZiel`, `hebelSetzbar` …), `brauchtStopWaechter` |
| Stop-Wächter | `server/execution/stop-waechter.js`, `stop-regeln.js`, `__selftest-stop-regeln.mjs` | 3-s-Takt mit eigener DB-Führung (20 s TTL): Stop, Break-Even, Teilausstieg, Zeitausstieg für Börsen ohne Stop-Order; `AT_NO_GUARD=1` |
| Margen-Netz | `server/execution/margen-netz.js`, `__selftest-margen-netz.mjs`, `shared/liquidation.js:hebelFuerLiqPreis` (bleibt in master) | Hebel so planen, dass die isolierte Marge hinter dem Stop liquidiert; Risiko-Parameter `netzModus`/`netzMaxR` |
| Abgleich | `server/execution/abgleich.js`, `__selftest-abgleich.mjs`, `fill-simulator.js:closePositionMitFills` | Live-Positionen gegen die Börse abgleichen, `unknown` über die clientOrderId auflösen, mit echten Fills buchen |
| Live-Freigabekette | `server/live-gates.js`, `server/strategies/__selftest-gates.mjs`, Routen in `server/strategy-api.js` | `GET …/readiness`, `POST …/approve-live` (Name abtippen), `POST /api/strategies/probeorder` (25 USDT), `GET /api/strategies/waechter`; globale Schalter `strategyLiveEnabled`, `strategyMinPaperTrades` |
| Engine-Live-Pfad | `server/strategy-engine.js` (alte Fassung) | `darfLiveHandeln`, `planeNetz`, `pending`→Order→`open`/`unknown`, echter Fill-Preis, Ziel-Limit, `stale_trigger`, Live-Schliessen und Not-Aus an der Börse |
| Start | `index.mjs` (alte Fassung) | `startStopWaechter()` / `stopStopWaechter()` |
| Oberfläche | `src/views/AgentStrategies.vue` (Freigabe-Dialog mit Nachweisen, Stop-Wächter-Ampel, Broker-Warnung mit Netz-R), `src/views/einstellungen/ki/KiStrategie.vue` (Schalter „Live-Handel global erlauben", „Papier-Trades vor Live") | Scharfschalten |
| Texte | `src/i18n/locales/{de,en}.json` (`strategies.approve*`, `guard*`, `gate*`, `brokerNoStop*`, `liveOffGlobal`, `settings.ki.strat.allowLive*`, `minPaper*`, `liveWarn`, `info.agent.sections[6]`), `server/app-hilfe.js` (Thema `strategien`) | Bedienung und Hilfe |

**In master geblieben:** Papier- und Schattenbetrieb, Backtests, Labor, Robustheit, Erkennung, Coin-Rangliste,
Not-Aus (für die Simulation), `server/execution/paper.js`, `zwischenstand.js`, `pionex-meta.js`
(Rundungsregeln für den Schatten), der Journal-Import über die Börsen-APIs (nur lesend:
`get_history_trades`, `get_pending_orders`, `/trade/fills`, `/mix/order/fills` …). Die DB-Spalten des
scharfen Betriebs (`liveApprovedAt`, `externalTpOrderId`, `liqPrice`, `netzModus`, `netzVerlustR`,
`guardAt`, `strategyLiveEnabled` …) stehen weiter im Schema und werden nicht gelöscht.

**Datenbank (v29, `server/migrationen/s13.js`):** Instanzen mit `mode = 'live'` wurden auf `paper` gestellt
und pausiert (`lastError` sagt warum); Live-Positionen bekamen `ausgelagert = 1`, ihr Status blieb
unverändert — nichts wurde geschlossen, kein Börsenaufruf. Die Oberfläche zeigt sie als „Live
(ausgelagert)" ohne Schliessen-Knopf.

## Zurückholen

Der Branch ist ein Stand **vor** S13; master entwickelt sich weiter. Darum nicht den Branch mergen,
sondern den Ausbau rückgängig machen und nachziehen:

1. In einem eigenen Worktree von master: den/die S13-Commits finden
   (`git log --oneline --grep 'S13'`) und mit `git revert <commit>` zurücknehmen. Konflikte entstehen dort,
   wo master seither dieselben Dateien geändert hat — dann die Dateien aus
   `git show spaeter/scharfer-handel:<pfad>` als Vorlage nehmen und von Hand einpflegen.
   Für einzelne Teile reicht `git checkout spaeter/scharfer-handel -- server/execution/stop-waechter.js …`.
2. Migration: `migriereS13` setzt `live` bei jedem Start wieder auf `paper` — beim Zurückholen entfernen
   (oder auf einen Schalter stellen) und `SCHEMA_VERSION` erhöhen. `ausgelagert`-Zeilen bewusst sichten,
   bevor der Wächter sie wieder anfasst: ihre Börsenlage ist seit dem Ausbau unbekannt.
3. `__selftest-broker-registry.mjs` und `__selftest-testbetrieb.mjs` in master prüfen ausdrücklich, dass
   KEIN Order-Pfad und kein Stop-Wächter existiert — beim Zurückholen bewusst umschreiben, nicht
   abschwächen.
4. Alle Order-Pfade zuerst im Schattenbetrieb und mit der Probeorder (25 USDT) gegen die Live-API
   bestätigen; Fixtures in `server/fixtures/` nachziehen. Rechtlich: LICENSE/NOTICE wieder um den
   automatisierten Handel ergänzen und F-6/F-7 der Verkaufs-Prüfung vorher anwaltlich klären.
5. `CLAUDE.md`, `README.md`, `server/app-hilfe.js` und `docs/VERKAUFS-PRUEFUNG.md` nachziehen.

## Verbesserung für später: getrennte Schlüssel je Börse

Heute liegt pro Börse **ein** API-Schlüssel in `bitunix_config`/`bitget_config`/Pionex-Einstellungen, und
derselbe Schlüssel diente Import, Positionsanzeige **und** Orders. Beim Zurückholen wird das getrennt:

- **Leseschlüssel** (nur Lesen): Journal-Import, offene Positionen („Pendente Trades"), Kontostand,
  Börsenstatus-Wache. Er bleibt, was er heute ist.
- **Handelsschlüssel** (eigener Datensatz, verschlüsselt wie die anderen): Berechtigung **Handel ja,
  Auszahlung nein, IP-gebunden** an die Adresse des Rechners/Containers, der handelt. Nur
  Order-Adapter und Stop-Wächter dürfen ihn laden; Import und Anzeige sehen ihn nie.
- **Ohne Handelsschlüssel kein scharfer Handel**: Die Freigabekette bekommt ein viertes Tor
  („Handelsschlüssel hinterlegt und geprüft"), die Registry meldet `handelbar: false`, die Engine weist
  `live` mit eigenem Grund ab. Ein Leseschlüssel mit Handelsrecht wird beim Hinterlegen erkannt
  (sofern die Börse die Rechte abfragbar macht) und als Warnung angezeigt.
- Prüfung beim Hinterlegen: Rechte abfragen, Auszahlungsrecht → ablehnen; fehlende IP-Bindung → laut
  warnen. `boersen-status.js` führt beide Schlüssel getrennt, damit ein abgelaufener Handelsschlüssel
  nicht wie ein Importfehler aussieht (und umgekehrt).
