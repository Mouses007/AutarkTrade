/**
 * Marktradar- und Lagebericht-Felder — Modul-Singleton.
 *
 * Diese Felder hängen alle an EINER Speicherfunktion (`radarSpeichern`, ein
 * Feld je Schreibvorgang) und einem Lader (`loadRadarSettings`), werden aber
 * aus vier Sektionen bedient: Live → Live-Trading-Fenster und Marktradar,
 * KI → Nachrichten, Benachrichtigungen (Schwellen und Märkte des
 * Divergenz-Alarms). Settings.vue lädt sie beim Öffnen der Seite, bevor eine
 * Bereichskomponente gemountet wird.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { dbUpdateSettings } from '@/utils/db.js'
import { currentUser } from '@/stores/settings.js'
import { loadSymbolMeta } from '@/utils/liveSymbols.js'

/* Vorgabe an — die Seite kostet nichts, solange man sie nicht öffnet. Wer nur
   beobachtet und nicht handelt, schaltet sie hier weg; dann verschwinden auch
   der Startknopf auf dem Marktradar und der Menüeintrag. */
export let livetradingAn = ref(true)

/* MARKTRADAR — betrifft nur, was serverseitig gerechnet wird. Sichtbarkeit,
   Reihenfolge und Grösse der Kacheln stehen bewusst NICHT hier: die liegen je
   Gerät im localStorage und werden direkt auf der Seite eingestellt. */
export let radarRsiSymbols = ref('')
export let boersenLinks = ref(['bitunix', 'bitget', 'pionex', 'tradingview'])
export let radarKalenderLaender = ref('')
export let radarKalenderImpact = ref('medium')
export let radarMeldung = ref('')
export let radarNewsAuto = ref(true)
export let radarNewsStunde = ref(10)
export let radarNewsVideos = ref(3)
export let radarNewsModel = ref('')
/* Leer = Vorgabe des Projekts bzw. der allgemein eingestellte Anbieter. So
   steht im Feld nie ein Modellname, der beim nächsten Katalogwechsel veraltet. */
export let radarNewsAufloesung = ref('niedrig')
export let radarNewsBerichtProvider = ref('')
export let radarNewsBerichtModell = ref('')
/* Zuschnitt des Berichts: Rhythmus (täglich/wöchentlich + Wochentag), Themen
   als Kapitel und Länge. Themen als Array — gespeichert wird CSV. */
export let radarNewsRhythmus = ref('taeglich')
export let radarNewsWochentag = ref(1)
/* Aktualisierungen im Tagesverlauf: keine, eine oder zwei. Gespeichert wird
   die Zahl plus die Stunden als CSV; hier stehen sie als zwei getrennte Felder,
   weil man sie einzeln auswählt. */
export let radarNewsUpdates = ref(0)
export let radarNewsUpdateStunde1 = ref(18)
export let radarNewsUpdateStunde2 = ref(21)
/* Wieviel vom Bericht in der Mail steht: 'kurz' | 'mittel' | 'voll'. */
export let radarNewsMailInhalt = ref('kurz')
export let radarNewsMailAktiv = ref(false)
export let radarNewsMailAn = ref('')
/* Wie lange erzeugte Berichte liegen bleiben. 'manuell' löscht nie. */
export let radarNewsBerichtAufbewahrung = ref('manuell')
/* Zeithorizont der Chartanalyse: wie alt die Analysen sein dürfen und wie weit
   sie vorausschauen sollen. */
export let radarNewsChartFrische = ref('woche')
export let radarNewsThemen = ref(['crypto'])
export let radarNewsLaenge = ref('kurz')

export let radarNewsXModell = ref('grok-4.20-0309-non-reasoning')
/* Umfangs- und Darstellungsregler. Überall heisst 0 bzw. leer „Vorgabe der
   gewählten Länge" — wer nichts einstellt, bekommt exakt das bisherige
   Verhalten. Dieselben Werte stehen auch in der Schnellleiste auf
   /nachrichten; beide schreiben in dieselben Spalten. */
export let radarNewsLayout = ref('dossier')
/** Eigene Anweisungen an die Berichts-KI. Leer = Bericht wie gehabt. */
export let radarNewsPromptZusatz = ref('')
export let radarNewsPunkte = ref(0)
/* Wie ausführlich eine einzelne Meldung wird — die Länge sagt nur, wie viele. */
export let radarNewsMeldungsTiefe = ref('knapp')
/* Eigene Markteinordnung im Bericht: Gesamtlage (Zyklus) + Handelslage
   (Tagesspanne, Bedingungen). Die Handelslage misst EINEN Markt, deshalb
   das Symbol daneben. */
export let radarNewsLagenAn = ref(true)
/* Duerfen die KI-Ausgaben Handelsempfehlungen, Kursziele und Prognosen geben?
   Gilt fuer Lagebericht, Gesamtlage- und Handelslage-Kachel. Vorgabe aus. */
export let kiEmpfehlungenAn = ref(false)
export let radarNewsLagenSymbol = ref('BTCUSDT')
/*
 * Prüft das eingetippte Symbol gegen die echte Binance-Liste.
 *
 * Der Server prüft nur die GESTALT (`/^[A-Z0-9]{2,20}$/`) — „SOLUSD" und
 * „FOOBAR" bestehen das beide. Danach wirft `erzeugeHandelslage`, es landet in
 * einem `logWarn`, und die Handelslage fehlt im Bericht, ohne dass irgendwo
 * steht warum. Ein Tippfehler darf nicht erst am nächsten Morgen auffallen,
 * indem etwas NICHT da ist.
 *
 * `loadSymbolMeta` hält die Liste modulweit; Picker und Datenfeed benutzen
 * dieselbe, der Abruf kostet hier also im Regelfall nichts.
 */
export const lagenSymbolWarnung = ref('')
export let radarNewsTokenBudget = ref(0)
export let radarNewsVideoTiefe = ref('normal')
export let radarNewsVideoTokens = ref(0)
// radarPicycleAlarm gibt es nicht mehr als eigenen Schalter — ob gemeldet wird,
// steht in der Kanalwahl unter „Meldungen". Die Spalte bleibt in der Datenbank
// stehen, wird aber nicht mehr gelesen oder geschrieben.
export let radarPicycleSchwelle = ref(0)
export let radarFundingDivergenz = ref(15)
/* Welche Märkte der Divergenz-Alarm beobachtet. Leer = die eigenen Märkte,
   wie vor der Auswahl — die Vorgabe darf nicht stillschweigend auf „keine"
   kippen, sonst schweigt ein bestehender Alarm nach dem Update. */
export let radarDivergenzSymbole = ref('')

export let radarNewsQuellenAusschluss = ref(true)
/* Der NEUE Ruhe-Filter: Truth Social automatisch + Stichwörter (eine je
   Zeile). Der alte Sammelschalter oben drüber heisst jetzt „Temporär
   ausschliessen" — gleiche Technik, ehrlicherer Name. */
export let radarNewsRuheAn = ref(true)
export let radarNewsRuheWoerter = ref('')

/* Fokus-Filter: das Gegenstück zum Ruhe-Filter. Der schliesst aus, der
   hier lässt nur durch, was mindestens eines der Stichwörter trifft. */
export let radarNewsFokusAn = ref(false)
export let radarNewsFokusWoerter = ref('')

/* News-Profile: benannte Sammlungen aller Nachrichten-Einstellungen inkl.
   Quellen-Auswahl. Eigene, schlanke Endpunkte statt der generischen
   Tabellen-Route — anlegen/anwenden schnappen bzw. schreiben ~30 Felder auf
   einmal, das soll nicht über die Feld-für-Feld-Logik von `dbUpdateSettings`
   laufen. */
export let newsProfile = ref([])

export function useRadarEinstellungen() {
    const { t } = useI18n()

    async function pruefeLagenSymbol() {
        const wert = String(radarNewsLagenSymbol.value || '').trim().toUpperCase()
        lagenSymbolWarnung.value = ''
        if (!wert) return
        try {
            const liste = await loadSymbolMeta('futures')
            // Leere Liste heisst „Binance war nicht erreichbar", nicht „Symbol
            // falsch" — dann lieber nichts behaupten.
            if (liste.length && !liste.some(x => x.symbol === wert)) {
                lagenSymbolWarnung.value = t('settings.ki.news.lagenSymbolUnbekannt', { symbol: wert })
            }
        } catch { /* siehe oben: keine Liste, keine Aussage */ }
    }

    function loadRadarSettings() {
        const s = currentUser.value || {}
        radarRsiSymbols.value = s.radarRsiSymbols || ''
        boersenLinks.value = String(s.boersenLinks || 'bitunix,bitget,pionex,tradingview').split(',')
            .map(b => b.trim()).filter(b => ['bitunix', 'bitget', 'pionex', 'tradingview'].includes(b))
        if (!boersenLinks.value.length) boersenLinks.value = ['bitunix', 'bitget', 'pionex', 'tradingview']
        radarKalenderLaender.value = s.radarKalenderLaender || 'USD,JPY'
        radarKalenderImpact.value = s.radarKalenderImpact || 'medium'
        radarNewsQuellenAusschluss.value = Number(s.radarNewsQuellenAusschluss ?? 1) === 1
        livetradingAn.value = Number(s.livetradingAn ?? 1) === 1
        radarNewsAuto.value = Number(s.radarNewsAuto ?? 1) === 1
        radarNewsStunde.value = Number(s.radarNewsStunde ?? 10)
        radarNewsVideos.value = Number(s.radarNewsVideos ?? 3)
        radarNewsModel.value = s.radarNewsModel || ''
        radarNewsAufloesung.value = s.radarNewsAufloesung || 'niedrig'
        radarNewsBerichtProvider.value = s.radarNewsBerichtProvider || ''
        radarNewsBerichtModell.value = s.radarNewsBerichtModell || ''
        radarNewsRhythmus.value = ['woechentlich', 'manuell'].includes(s.radarNewsRhythmus)
            ? s.radarNewsRhythmus : 'taeglich'
        radarNewsWochentag.value = Math.max(1, Math.min(7, Number(s.radarNewsWochentag ?? 1)))
        radarNewsUpdates.value = Math.max(0, Math.min(2, Number(s.radarNewsUpdates) || 0))
        radarNewsMailInhalt.value = ['kurz', 'mittel', 'voll'].includes(s.radarNewsMailInhalt) ? s.radarNewsMailInhalt : 'kurz'
        radarNewsMailAktiv.value = Number(s.radarNewsMailAktiv ?? 0) === 1
        radarNewsMailAn.value = s.radarNewsMailAn || ''
        radarNewsBerichtAufbewahrung.value = ['manuell', 'tag', 'woche', 'monat']
            .includes(s.radarNewsBerichtAufbewahrung) ? s.radarNewsBerichtAufbewahrung : 'manuell'
        radarNewsChartFrische.value = ['tag', 'woche', 'monat'].includes(s.radarNewsChartFrische)
            ? s.radarNewsChartFrische : 'woche'
        {
            // Wie `leseUpdateStunden` auf dem Server: sortiert und geklemmt. Fehlt
            // eine Stunde, bleibt die Vorgabe stehen — ein leeres Auswahlfeld wäre
            // ein Wert, den niemand gewählt hat.
            const st = String(s.radarNewsUpdateStunden || '18,21').split(',')
                .map(x => x.trim()).filter(x => x !== '')
                .map(x => Math.max(0, Math.min(23, Number(x) || 0)))
                .sort((a, b) => a - b)
            radarNewsUpdateStunde1.value = Number.isFinite(st[0]) ? st[0] : 18
            radarNewsUpdateStunde2.value = Number.isFinite(st[1]) ? st[1] : 21
        }
        radarNewsThemen.value = String(s.radarNewsThemen || 'crypto').split(',')
            .map(t => t.trim()).filter(t => ['crypto', 'finanzen', 'tech', 'chartanalyse'].includes(t))
        if (!radarNewsThemen.value.length) radarNewsThemen.value = ['crypto']
        radarNewsLaenge.value = ['kurz', 'mittel', 'lang'].includes(s.radarNewsLaenge) ? s.radarNewsLaenge : 'kurz'
        radarNewsXModell.value = s.radarNewsXModell || 'grok-4.20-0309-non-reasoning'
        // Grenzen wie auf dem Server (budgetsAus/punkteVorgabe/videoTiefeAus in
        // server/marktradar-news.js) — die Oberfläche soll ihm keinen Unsinn schicken.
        // Unbekannt (auch das kurzzeitig gespeicherte „zeitung") → dossier, die Vorgabe.
        radarNewsLayout.value = ['dossier', 'kombiniert', 'artikel', 'kacheln'].includes(s.radarNewsLayout)
            ? s.radarNewsLayout : 'dossier'
        radarNewsPromptZusatz.value = s.radarNewsPromptZusatz || ''
        radarNewsPunkte.value = Math.max(0, Math.min(12, Number(s.radarNewsPunkte) || 0))
        radarNewsMeldungsTiefe.value = ['knapp', 'normal', 'ausfuehrlich'].includes(s.radarNewsMeldungsTiefe)
            ? s.radarNewsMeldungsTiefe : 'knapp'
        radarNewsLagenAn.value = Number(s.radarNewsLagenAn ?? 1) === 1
        radarNewsLagenSymbol.value = s.radarNewsLagenSymbol || 'BTCUSDT'
        pruefeLagenSymbol()
        radarNewsTokenBudget.value = Math.max(0, Math.min(60000, Number(s.radarNewsTokenBudget) || 0))
        radarNewsVideoTiefe.value = ['knapp', 'normal', 'ausfuehrlich'].includes(s.radarNewsVideoTiefe)
            ? s.radarNewsVideoTiefe : 'normal'
        radarNewsVideoTokens.value = Math.max(0, Math.min(4000, Number(s.radarNewsVideoTokens) || 0))
        radarNewsRuheAn.value = Number(s.radarNewsRuheAn ?? 1) === 1
        radarNewsRuheWoerter.value = s.radarNewsRuheWoerter ?? 'Donald Trump'
        radarNewsFokusAn.value = Number(s.radarNewsFokusAn ?? 0) === 1
        radarNewsFokusWoerter.value = s.radarNewsFokusWoerter || ''
        radarPicycleSchwelle.value = Number(s.radarPicycleSchwelle ?? 0)
        radarFundingDivergenz.value = Number(s.radarFundingDivergenz ?? 15)
        radarDivergenzSymbole.value = s.radarDivergenzSymbole || ''
        ladeNewsProfile()
    }

    async function ladeNewsProfile() {
        try {
            const { data } = await axios.get('/api/marktradar/news-profile')
            newsProfile.value = data || []
        } catch (e) {
            newsProfile.value = []
        }
    }

    /**
     * Speichert GENAU EIN Feld.
     *
     * Vorher schrieb diese Funktion die ganze Gruppe auf einmal — mit der Folge,
     * dass eine Änderung an der Länderliste den Ruhe-Filter mit dem Stand
     * überschrieb, den die Seite beim Laden gesehen hatte. Stand die Seite länger
     * offen oder wurde der Wert anderswo geändert, kippte er stillschweigend
     * zurück. Ein Feld, ein Schreibvorgang.
     */
    async function radarSpeichern(feld) {
        const alle = {
            radarRsiSymbols: radarRsiSymbols.value.toUpperCase().replace(/\s+/g, ''),
            radarKalenderLaender: radarKalenderLaender.value.toUpperCase().replace(/\s+/g, ''),
            radarKalenderImpact: radarKalenderImpact.value,
            radarNewsQuellenAusschluss: radarNewsQuellenAusschluss.value ? 1 : 0,
            livetradingAn: livetradingAn.value ? 1 : 0,
            radarNewsAuto: radarNewsAuto.value ? 1 : 0,
            radarNewsStunde: radarNewsStunde.value,
            radarNewsModel: radarNewsModel.value.trim(),
            radarNewsAufloesung: radarNewsAufloesung.value,
            radarNewsBerichtProvider: radarNewsBerichtProvider.value,
            radarNewsBerichtModell: radarNewsBerichtModell.value.trim(),
            radarNewsRhythmus: radarNewsRhythmus.value,
            radarNewsWochentag: Math.max(1, Math.min(7, Number(radarNewsWochentag.value) || 1)),
            radarNewsUpdates: Math.max(0, Math.min(2, Number(radarNewsUpdates.value) || 0)),
            radarNewsMailInhalt: radarNewsMailInhalt.value,
            radarNewsMailAktiv: radarNewsMailAktiv.value ? 1 : 0,
            radarNewsMailAn: radarNewsMailAn.value,
            radarNewsBerichtAufbewahrung: radarNewsBerichtAufbewahrung.value,
            radarNewsChartFrische: radarNewsChartFrische.value,
            // Immer beide Stunden schreiben, auch bei nur einer Aktualisierung:
            // Die Anzahl entscheidet, wie viele davon gelten — so bleibt die zweite
            // Wahl erhalten, wenn jemand kurz auf „eine" stellt und zurück.
            radarNewsUpdateStunden: [radarNewsUpdateStunde1.value, radarNewsUpdateStunde2.value]
                .map(h => Math.max(0, Math.min(23, Number(h) || 0))).join(','),
            // Reihenfolge festnageln, damit die Kapitel immer gleich sortiert sind
            radarNewsThemen: ['crypto', 'finanzen', 'tech', 'chartanalyse'].filter(t => radarNewsThemen.value.includes(t)).join(','),
            boersenLinks: ['bitunix', 'bitget', 'pionex', 'tradingview'].filter(b => boersenLinks.value.includes(b)).join(','),
            radarNewsLaenge: radarNewsLaenge.value,
            radarNewsXModell: radarNewsXModell.value.trim() || 'grok-4.20-0309-non-reasoning',
            radarNewsRuheAn: radarNewsRuheAn.value ? 1 : 0,
            radarNewsRuheWoerter: radarNewsRuheWoerter.value,
            radarNewsFokusAn: radarNewsFokusAn.value ? 1 : 0,
            radarNewsFokusWoerter: radarNewsFokusWoerter.value,
            radarPicycleSchwelle: Math.max(0, Math.min(50, Number(radarPicycleSchwelle.value) || 0)),
            radarFundingDivergenz: Math.max(0, Math.min(100, Number(radarFundingDivergenz.value) || 0)),
            radarDivergenzSymbole: radarDivergenzSymbole.value,
            // Hart begrenzen, nicht bloss im Eingabefeld: der Server deckelt
            // ohnehin bei zehn, und eine Zahl anzuzeigen, die nie gilt, wäre gelogen
            radarNewsVideos: Math.max(0, Math.min(10, Number(radarNewsVideos.value) || 0)),
            radarNewsLayout: radarNewsLayout.value,
            // Gleicher Deckel wie der Server (ZUSATZ_MAX in marktradar-news.js) —
            // ein Feld, das mehr annimmt als gilt, belügt den Schreibenden
            radarNewsPromptZusatz: radarNewsPromptZusatz.value.trim().slice(0, 2000),
            radarNewsPunkte: Math.max(0, Math.min(12, Number(radarNewsPunkte.value) || 0)),
            radarNewsMeldungsTiefe: radarNewsMeldungsTiefe.value,
            radarNewsTokenBudget: Math.max(0, Math.min(60000, Number(radarNewsTokenBudget.value) || 0)),
            radarNewsVideoTiefe: radarNewsVideoTiefe.value,
            radarNewsVideoTokens: Math.max(0, Math.min(4000, Number(radarNewsVideoTokens.value) || 0)),
        }
        const daten = feld ? { [feld]: alle[feld] } : alle
        await dbUpdateSettings(daten)
        // Den lokalen Stand nachziehen, sonst schreibt der nächste Speichervorgang
        // wieder gegen einen veralteten currentUser
        if (currentUser.value) Object.assign(currentUser.value, daten)
        radarMeldung.value = 'Gespeichert.'
        setTimeout(() => { radarMeldung.value = '' }, 2500)
    }

    return { pruefeLagenSymbol, loadRadarSettings, ladeNewsProfile, radarSpeichern }
}
