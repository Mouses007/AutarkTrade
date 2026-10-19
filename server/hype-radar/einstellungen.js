/**
 * Einstellungen des Hype-Radars — Lesen, Schreiben, Vorgaben.
 *
 * Sie liegen als Schlüssel-Wert-Paare in `hype_settings`, nicht als Spalten:
 * es sind Listen und Objekte, und sie werden sich noch bewegen, solange das
 * Feature reift. Jede Stellschraube als Spalte hiesse, für jede neue Schraube
 * das Schema zu ändern.
 *
 * Die Schlüssel der Fremdquellen stehen dagegen in `settings` — verschlüsselt,
 * wie alle anderen Zugangsdaten des Hauses auch.
 *
 * Der CoinGecko-Schlüssel (`settings.hypeKeyCoingecko`) wird seit S12 NICHT
 * mehr hier gepflegt: er gilt für Marktradar, Coin-Radar und Hype-Radar
 * zugleich, hat einen Tarif (Demo/Pro) und wird unter Einstellungen ›
 * Datenquellen eingegeben (`server/quellen/coingecko.js`). Ein zweites
 * Eingabefeld im Hype-Panel hätte dieselbe Spalte ohne den Tarif beschrieben
 * — und den Merker in `coingecko.js` nicht geleert. Das Panel zeigt nur, ob
 * einer hinterlegt ist, und verlinkt dorthin.
 */

import { getKnex } from '../database.js'
import { encrypt, decrypt } from '../crypto.js'
import { STANDARD_GEWICHTE, STANDARD_NARRATIVE } from './bewertung.js'
import { STANDARD_SICHERHEIT } from './sicherheit.js'
import { smartWalletListe } from './fruehphase-bewertung.js'

/** Spalten in `settings`, in denen die Schlüssel der Zusatzquellen liegen. */
const SCHLUESSEL_SPALTEN = {
    // Zustellgeheimnisse des Wachhunds. Die Webhook-Adresse gehört dazu:
    // bei Home Assistant IST die Adresse das Geheimnis.
    ntfyToken: 'hypeAlarmNtfyToken',
    telegramToken: 'hypeAlarmTelegramToken',
    webhookUrl: 'hypeAlarmWebhookUrl',
    /*
     * Smart Money: eigene Solana-RPC-Adresse (bei Helius steckt der Schlüssel
     * darin). PFLICHT seit S12: der öffentliche Knoten ist laut Solana „not
     * intended for production applications" (Verkaufs-Prüfung Z. 67).
     */
    solanaRpc: 'hypeKeySolanaRpc',
}

export const VORGABEN = {
    aktiv: false,                    // Aus. Wer es will, schaltet es ein.
    intervallStunden: 6,
    ketten: ['solana', 'eth', 'base', 'bsc'],
    /*
     * Drei Quellen (S12, Verkaufs-Prüfung vom 19.10.2026): CoinGecko-Trend und
     * die On-Chain-Pools (`geckoterminal`, jetzt über CoinGecko `/onchain`)
     * nur mit dem Schlüssel des Kunden — ohne ihn stehen sie im Lauf als
     * „aus". DexScreener läuft ohne Schlüssel.
     *
     * pump.fun, CoinPaprika und Reddit sind aus Lizenzgründen entfernt; ihre
     * gespeicherten Schalter sortiert `leseEinstellungen` aus.
     */
    quellen: {
        coingecko: true, dexscreener: true, geckoterminal: true,
    },
    gewichte: STANDARD_GEWICHTE,
    narrative: STANDARD_NARRATIVE,
    sicherheit: STANDARD_SICHERHEIT,
    /*
     * Schwelle für die Sicherheitsprüfung.
     *
     * Das Konzept schlug 55 vor; im ersten Lauf gegen echte Quellen kam damit
     * genau EIN Fund von 129 durch. Grund: ohne erkanntes Thema deckelt die
     * Rechnung bei rund 40, ein Einzelquellen-Fund liegt typisch bei 35–45.
     * Bei 55 entschied faktisch das Stichwortverzeichnis darüber, was geprüft
     * wird — nicht die Aufmerksamkeit. 35 lässt das obere Drittel durch.
     */
    minHypeScore: 35,
    /*
     * Nur Funde behalten, die Bitunix, Bitget oder Pionex führen.
     *
     * Aus als Vorgabe: der Radar soll zuerst zeigen, was draussen passiert —
     * gerade das noch nirgends Gelistete ist oft das Früheste. Wer nur
     * handeln will, was das eigene Konto hergibt, schaltet den Filter ein.
     */
    nurBoersen: false,
    /*
     * Der Wachhund. Regeln und Kanäle für die Alarme auf Favoriten; die
     * Zustellgeheimnisse (Tokens, Webhook-Adresse) liegen verschlüsselt in
     * `settings` und NICHT hier.
     */
    wachhundIntervallMin: 15,
    /*
     * Bewusst LEER, nicht mit Zahlen gefüllt.
     *
     * Die Schwellen stehen in `STANDARD_ALARM_REGELN` neben den Regeln, die
     * sie benutzen. Sie hier ein zweites Mal aufzuschreiben hiesse, zwei
     * Wahrheiten zu pflegen — und beim Hinzufügen der Börsenschwellen wäre
     * genau das passiert: der Server hätte sie gekannt, die Oberfläche nicht.
     * Direkt importieren geht nicht, weil `wachhund.js` diese Datei braucht;
     * deshalb füllt die Route die Vorgaben auf, bevor sie antwortet.
     */
    alarmRegeln: {},
    alarmKanaele: {
        ntfy: { an: false, url: '', topic: 'hype-radar', minSchwere: 'info' },
        telegram: { an: false, chatId: '', minSchwere: 'warnung' },
        webhook: { an: false, minSchwere: 'info' },
    },
    berichtTopN: 7,
    /*
     * Projektprüfung der bestandenen Funde: Webseite, Domain-Alter, GitHub,
     * Ersteller-Vorgeschichte. Kostet keinen Schlüssel, aber bis zu fünf
     * Abrufe je Fund — deshalb gedeckelt.
     */
    projektPruefung: true,
    projektMax: 15,
    /*
     * RugCheck (Solana: Vertrag, Halter, Insider-Netze, LP-Sperre). Die
     * Bedingungen sind ungeklärt — die Seite war bei der Prüfung nicht
     * erreichbar, laut Drittquellen gibt es Schlüssel und Bezahltarife
     * (Verkaufs-Prüfung Z. 66). Darum ab Werk AUS; bestehende Installationen
     * behalten es an (`server/migrationen/s12-hype.js`). Ohne RugCheck prüft
     * GoPlus allein; Insider-Netze und die Solana-LP-Sperre sind dann
     * unbekannt.
     */
    rugcheckAn: false,
    /*
     * Die Frühphase: eine eigene Spur VOR der Hauptprüfung, für Token, die
     * noch keine zwölf Stunden alt sind oder noch keine 50 000 USD Liquidität
     * haben. Aus als Vorgabe wie der Radar selbst — sie fragt alle fünfzehn
     * Minuten mehrere Quellen ab.
     *
     * `fruehAlarmAb` 0 heisst: beobachten, nicht melden.
     */
    fruehAktiv: false,
    fruehIntervallMin: 15,
    /*
     * pump.fun (neueste, Kurve), Reddit und die Telegram-Kanäle sind seit S12
     * entfernt (Verkaufs-Prüfung Z. 60, 61, 63). Die Frühphase verliert damit
     * die Spur VOR dem ersten Pool: Ein Token auf der pump.fun-Kurve erscheint
     * nur noch, wenn DexScreener oder die CoinGecko-On-Chain-Liste ihn führen
     * oder jemand seinen Vertrag auf /biz/ oder X nennt.
     */
    fruehQuellen: {
        dexscreenerProfile: true,
        // Neue Pools und Käuferzahlen — CoinGecko `/onchain`, nur mit Kundenschlüssel.
        geckoterminalNeu: true,
        biz: true,
        // Bezahlt (xAI, Grok `x_search`) — deshalb aus, bis jemand es will.
        x: false,
        // Braucht eine Wallet-Liste UND eine eigene Solana-RPC-Adresse.
        smartmoney: false,
    },
    // Beobachtete Wallets [{adresse, name}] und wie oft ihre Käufe gelesen werden.
    smartWallets: [],
    smartIntervallMin: 30,
    /*
     * Börsen-Beobachter: neue Listungen auf grossen und mittleren Börsen.
     * Ohne Schlüssel; aus als Vorgabe wie alles, was im Hintergrund abruft.
     * `boersenAlleMelden` meldet auch Listungen, die der Radar nicht kannte
     * (nur grosse Börsen) — sonst nur Radar-Token.
     */
    boersenwachtAn: false,
    /*
     * Welche Börsenlisten gelesen werden (S12). Coinbase, Kraken, KuCoin und
     * Gate ab Werk AUS: ihre Bedingungen erlauben die Nutzung in einem
     * verkauften Programm nicht erkennbar (Verkaufs-Prüfung Z. 77, 79–81);
     * bestehende Installationen behalten ihre Wahl (Migration). Binance folgt
     * zusätzlich der Marktdatenquelle. Upbit, OKX, MEXC und Binance Alpha sind
     * entfernt (Z. 76, 78, 82, 83).
     */
    boersenwachtBoersen: {
        'binance-spot': true, 'binance-futures': true, bybit: true, bitget: true,
        coinbase: false, kraken: false, kucoin: false, gate: false,
    },
    boersenwachtIntervallMin: 30,
    boersenAlleMelden: false,
    // Takt der X-Abfrage in Minuten; jede Abfrage kostet Suchpauschale plus Tokens.
    fruehXIntervallMin: 120,
    fruehAlarmAb: 70,
    /*
     * Ab dieser Note steht ein meldefähiger Token in der Kandidatenliste
     * (Vertrag und Projekt geprüft, belastbare Note, Handel läuft). Bewusst
     * unter der Meldeschwelle: die Liste zeigt, was man ansehen sollte, die
     * Meldung, was man nicht verpassen darf.
     */
    fruehKandidatAb: 50,
    llmStufe: 'gruendlich-mittel',
    llmModus: 'gruendlich',
    llmRollen: {},                   // leer = die Stufe entscheidet
    sprache: 'de',
}

/** Alle Einstellungen, mit Vorgaben aufgefüllt. */
export async function leseEinstellungen() {
    const knex = getKnex()
    let zeilen = []
    try {
        zeilen = await knex('hype_settings').select('schluessel', 'wert')
    } catch {
        // Tabelle fehlt noch (älterer Codestand hat die DB angelegt).
        return { ...VORGABEN, schluessel: {} }
    }

    const gespeichert = {}
    for (const z of zeilen) {
        try {
            gespeichert[z.schluessel] = JSON.parse(z.wert)
        } catch {
            // Eine kaputte Zeile darf nicht alle übrigen mitnehmen.
            gespeichert[z.schluessel] = null
        }
    }

    const e = { ...VORGABEN }
    for (const [k, v] of Object.entries(gespeichert)) {
        if (v === null || v === undefined) continue
        // Verschachtelte Objekte auffüllen statt ersetzen: sonst fehlt nach
        // dem Hinzufügen einer neuen Schraube genau diese in alten Ständen.
        e[k] = (typeof v === 'object' && !Array.isArray(v) && typeof VORGABEN[k] === 'object' && !Array.isArray(VORGABEN[k]))
            ? { ...VORGABEN[k], ...v }
            : v
    }

    /*
     * Quellen, die es nicht mehr gibt, aus dem Gespeicherten werfen.
     *
     * Das Auffüllen oben behält jeden gespeicherten Schlüssel — auch die drei
     * am 21.08.2026 entfernten. Die Oberfläche zeichnet ihre Schalter aus
     * genau diesem Objekt und zeigte sonst weiter `reddit`, `cryptopanic` und
     * `lunarcrush` an, für die es im Lauf gar keine Aufgabe mehr gibt. Statt
     * einer Datenwanderung: beim Lesen aussortieren, dann heilt sich der
     * Altbestand beim nächsten Speichern von selbst.
     */
    for (const feld of ['quellen', 'fruehQuellen', 'boersenwachtBoersen']) {
        if (e[feld] && typeof e[feld] === 'object') {
            e[feld] = Object.fromEntries(
                Object.entries(e[feld]).filter(([name]) => name in VORGABEN[feld]))
        }
    }
    // Die Telegram-Kanäle der Frühphase (bis S12) bleiben gespeichert, gelesen werden sie nicht mehr.
    delete e.fruehTelegram

    e.schluessel = await leseSchluessel()
    return e
}

/** Entschlüsselte Schlüssel der Zusatzquellen. */
export async function leseSchluessel() {
    try {
        const s = await getKnex()('settings')
            .select(Object.values(SCHLUESSEL_SPALTEN)).where('id', 1).first()
        const raus = {}
        for (const [name, spalte] of Object.entries(SCHLUESSEL_SPALTEN)) {
            raus[name] = s?.[spalte] ? decrypt(s[spalte]) : ''
        }
        return raus
    } catch {
        return {}
    }
}

/**
 * Einstellungen schreiben. Nur bekannte Schlüssel, damit nichts einsickert.
 *
 * In EINER Anweisung statt in einer Schleife: der erste Entwurf fragte je
 * Schlüssel erst nach, ob die Zeile existiert, und schrieb dann — bei den
 * gut siebzehn Einstellungen also rund vierunddreissig Rundreisen zur
 * Datenbank. Über das Netz zur NAS-Postgres dauerte ein einziges Speichern
 * damit mehrere Sekunden, und wer zwei Schalter kurz nacheinander umlegte,
 * sah den zweiten scheinbar nicht wirken. `onConflict().merge()` macht daraus
 * einen Aufruf.
 */
export async function schreibeEinstellungen(neu = {}, zusatzVorgaben = {}) {
    const jetzt = Date.now()
    const zeilen = Object.entries(bereinigeEinstellungen(neu, zusatzVorgaben))
        .map(([schluessel, v]) => ({ schluessel, wert: JSON.stringify(v), aktualisiertAm: jetzt }))
    if (!zeilen.length) return

    await getKnex()('hype_settings')
        .insert(zeilen)
        .onConflict('schluessel')
        .merge(['wert', 'aktualisiertAm'])
}

/*
 * Diese verschachtelten Einstellungen werden nur mit ihren ABWEICHUNGEN von der
 * Vorgabe gespeichert.
 *
 * Die Oberfläche bekommt beim Lesen die aufgefüllten Werte und schickt beim
 * Speichern das ganze Objekt zurück. Bis zum 07.10.2026 lag danach jede
 * Vorgabe als „eigene Einstellung" in der Datenbank — beim ersten Umlegen
 * irgendeines Schalters. Eine spätere Änderung an `STANDARD_ALARM_REGELN`
 * oder `STANDARD_SICHERHEIT` erreichte diese Installation nie mehr: genau die
 * zweite Wahrheit, die der leere `alarmRegeln`-Eintrag oben verhindern sollte.
 */
const NUR_ABWEICHUNGEN = new Set(['alarmRegeln', 'sicherheit', 'gewichte'])

/**
 * `''` und Unzahlen sind keine Einstellung.
 *
 * Ein geleertes Zahlenfeld kommt über `v-model.number` als `''` an. Gespeichert
 * wirkte es wie 0: Alarmregeln schlugen bei 0,1 % an, und `liq < ''` ist
 * `liq < 0` — die Mindestliquidität der Sicherheitsprüfung war damit still
 * abgeschaltet. Jetzt fällt so ein Feld auf die Vorgabe zurück.
 */
function alsZahl(w) {
    if (w === '' || w === null || w === undefined || typeof w === 'boolean') return undefined
    const z = Number(w)
    return Number.isFinite(z) ? z : undefined
}

/**
 * Was gespeichert wird — rein, ohne Datenbank.
 *
 * @param {object} neu             was die Oberfläche schickt
 * @param {object} zusatzVorgaben  Vorgaben, die hier nicht stehen dürfen
 *                                 (`alarmRegeln` kommt aus `wachhund.js`)
 */
export function bereinigeEinstellungen(neu = {}, zusatzVorgaben = {}) {
    const vorgaben = { ...VORGABEN, ...zusatzVorgaben }
    const raus = {}
    for (const [k, v] of Object.entries(neu || {})) {
        if (!(k in VORGABEN)) continue
        const vorgabe = vorgaben[k]
        if (typeof vorgabe === 'number') {
            const z = alsZahl(v)
            if (z !== undefined) raus[k] = z
            continue
        }
        if (NUR_ABWEICHUNGEN.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
            const abweichung = {}
            for (const [feld, wert] of Object.entries(v)) {
                const d = vorgabe?.[feld]
                if (typeof d === 'number') {
                    const z = alsZahl(wert)
                    if (z === undefined || z === d) continue
                    abweichung[feld] = z
                } else if (wert !== d) {
                    abweichung[feld] = wert
                }
            }
            raus[k] = abweichung
            continue
        }
        if (k === 'smartWallets') {
            raus[k] = smartWalletListe(v)
            continue
        }
        raus[k] = v
    }
    return raus
}

/**
 * Schlüssel der Zusatzquellen speichern.
 *
 * Ein maskierter Wert (enthält „•") bedeutet „unverändert lassen" — sonst
 * überschriebe die Oberfläche beim Speichern jedes Formulars die echten
 * Schlüssel mit ihren eigenen Platzhaltern.
 */
export async function schreibeSchluessel(schluessel = {}) {
    const aenderung = {}
    for (const [name, spalte] of Object.entries(SCHLUESSEL_SPALTEN)) {
        const wert = schluessel[name]
        if (wert === undefined || String(wert).includes('•')) continue
        aenderung[spalte] = wert ? encrypt(String(wert)) : ''
    }
    if (Object.keys(aenderung).length) {
        await getKnex()('settings').where('id', 1).update(aenderung)
    }
}

/** Für die Oberfläche: vorhanden ja/nein, aber nie der Schlüssel selbst. */
export function maskiere(schluessel = {}) {
    const raus = {}
    for (const name of Object.keys(SCHLUESSEL_SPALTEN)) {
        const w = schluessel[name]
        raus[name] = w ? `${String(w).slice(0, 3)}••••${String(w).slice(-3)}` : ''
    }
    return raus
}
