/**
 * Was hat jemand in das Wallet-Feld eingefügt? (Spot-Portfolio, Testzweig)
 *
 * Ein Eingabefeld für alles: die Kette ergibt sich aus der Form der Adresse.
 * Geteilt zwischen Browser (sofortige Rückmeldung beim Tippen) und Server
 * (der prüft noch einmal, bevor er speichert — der Browser ist keine Grenze).
 *
 * Die wichtigste Aufgabe ist die Ablehnung: Ein Seed (12–24 Wörter), ein
 * privater Schlüssel (64 Hex-Zeichen, WIF) oder ein erweiterter PRIVATER
 * Schlüssel (xprv/yprv/zprv) gibt die Coins aus der Hand. Die App liest nur;
 * wer so etwas einfügt, hat sich vertan, und das Feld sagt es, statt es zu
 * speichern.
 *
 * Rein: kein Netz, keine Abhängigkeit.
 */

const B58 = '[1-9A-HJ-NP-Za-km-z]'
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Base58 → Anzahl Bytes (oder -1 bei fremdem Zeichen). Rein, ohne BigInt-Abhängigkeit. */
function base58Laenge(s) {
    const bytes = [0]
    for (const c of s) {
        let wert = B58_ALPHABET.indexOf(c)
        if (wert < 0) return -1
        for (let i = 0; i < bytes.length; i++) {
            wert += bytes[i] * 58
            bytes[i] = wert & 0xff
            wert >>= 8
        }
        while (wert > 0) { bytes.push(wert & 0xff); wert >>= 8 }
    }
    let nullen = 0
    while (s[nullen] === '1') nullen++
    // Führende Nullbytes stehen als „1“; die Schleife oben zählt ein leeres Byte mit.
    const ohneLeer = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length
    return nullen + ohneLeer
}

/**
 * Wörter einer möglichen Wiederherstellungsphrase — vor der Prüfung
 * vereinheitlicht: Kommas, Semikolons, eine Zeile je Wort, Nummerierung
 * („1. abandon“, „1) abandon“, „01 abandon“, „1:abandon“).
 */
function seedWoerter(s) {
    return s.replace(/[,;|]/g, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/^\d{1,2}[.):-]?/, ''))     // „1.abandon“ → „abandon“, „12)“ → „“
        .filter(Boolean)
}

/** EVM-Netze, die der Abruf kennt. `id` = chainid (Etherscan V2). */
export const EVM_NETZE = [
    { id: 1, name: 'Ethereum', kurz: 'ETH', nativ: 'ETH' },
    { id: 42161, name: 'Arbitrum', kurz: 'ARB', nativ: 'ETH' },
    { id: 8453, name: 'Base', kurz: 'BASE', nativ: 'ETH' },
    { id: 10, name: 'Optimism', kurz: 'OP', nativ: 'ETH' },
    { id: 56, name: 'BNB Chain', kurz: 'BSC', nativ: 'BNB' },
    { id: 137, name: 'Polygon', kurz: 'POL', nativ: 'POL' },
    { id: 43114, name: 'Avalanche', kurz: 'AVAX', nativ: 'AVAX' },
    // VeChain hat dasselbe Adressformat (0x…), ist aber keine EVM-Kette mit
    // Etherscan: gelesen wird nur der Bestand (VET + VTHO) über mainnet.vechain.org.
    { id: 100009, name: 'VeChain', kurz: 'VET', nativ: 'VET', nurBestand: true },
]

/** Vorgabe für ein neues EVM-Konto: die Netze, auf denen die meisten etwas liegen haben. */
export const EVM_VORGABE = [1, 42161, 8453, 56]

export const KETTEN = {
    btc: { name: 'Bitcoin', asset: 'BTC' },
    evm: { name: 'EVM', asset: 'ETH' },
    sol: { name: 'Solana', asset: 'SOL' },
    xrp: { name: 'XRP Ledger', asset: 'XRP' },
}

/** Wallet-Typen mit Vorschlag, welche Ketten man dort typischerweise einträgt. */
export const WALLET_TYPEN = {
    ledger: { name: 'Ledger', ketten: ['btc', 'evm', 'xrp', 'sol'] },
    safepal: { name: 'SafePal', ketten: ['evm', 'btc', 'sol'] },
    metamask: { name: 'MetaMask', ketten: ['evm'] },
    andere: { name: 'Andere', ketten: ['btc', 'evm', 'xrp', 'sol'] },
}

const XPUB_ART = {
    // Ledger & Co. zeigen für JEDES Konto einen xpub; die Adressart erkennt der Abruf.
    xpub: { ableitung: 'p2pkh', bip: 44, text: 'Adressart wird beim Lesen erkannt (bc1q / 3… / 1…)' },
    ypub: { ableitung: 'p2sh-p2wpkh', bip: 49, text: 'Nested SegWit (3…)' },
    zpub: { ableitung: 'p2wpkh', bip: 84, text: 'Native SegWit (bc1q…)' },
}

/**
 * @param {string} roh
 * @returns {{ ok: true, kette: 'btc'|'evm'|'sol', art: string, wert: string, ableitung?: string, text: string }
 *         | { ok: false, grund: 'leer'|'geheim'|'unbekannt'|'nichtUnterstuetzt', text: string }}
 */
export function erkenneEingabe(roh) {
    const s = String(roh ?? '').trim()
    if (!s) return { ok: false, grund: 'leer', text: '' }

    // ── zuerst: was nie gespeichert werden darf ──
    // Seed (Audit FUN-PRT-004): auch mit Kommas, nummeriert, eine Zeile je Wort,
    // mit Akzenten (spanische/französische Wortlisten) und grob ab 11 bis 25
    // Wörtern — 11, 13 oder 25 Wörter sind ein vertippter oder ein Seed mit
    // Passphrase-Wort. Lieber eine Adresse zu viel ablehnen als einen Seed speichern.
    const woerter = seedWoerter(s)
    if (woerter.length >= 11 && woerter.length <= 25 && woerter.every((w) => /^\p{L}{3,8}$/u.test(w))) {
        return { ok: false, grund: 'geheim', text: 'Das sieht aus wie eine Wiederherstellungsphrase (Seed). Sie gehört NIE in eine App — bitte nur die öffentliche Adresse einfügen.' }
    }
    if (/^[xyztuv]prv/i.test(s)) {
        return { ok: false, grund: 'geheim', text: 'Das ist ein erweiterter PRIVATER Schlüssel. Bitte den öffentlichen (xpub/ypub/zpub) einfügen.' }
    }
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) {
        return { ok: false, grund: 'geheim', text: 'Das sieht aus wie ein privater Schlüssel (64 Hex-Zeichen). Bitte nur die öffentliche Adresse einfügen.' }
    }
    // WIF: Hauptnetz 5…/K…/L…, Testnetz 9… (51) bzw. c… (52).
    if (new RegExp(`^[5KL9c]${B58}{50,51}$`).test(s)) {
        return { ok: false, grund: 'geheim', text: 'Das sieht aus wie ein privater Bitcoin-Schlüssel (WIF). Bitte nur die öffentliche Adresse oder den xpub einfügen.' }
    }
    // XRP-Secret („Family Seed“): s + 28 Zeichen, Ed25519 sEd… mit 31 — kürzer als jede Solana-Adresse.
    if (new RegExp(`^s${B58}{27,30}$`).test(s)) {
        return { ok: false, grund: 'geheim', text: 'Das sieht aus wie ein XRP-Geheimschlüssel (s…). Bitte nur die öffentliche r…-Adresse einfügen.' }
    }
    // Solana-Geheimschlüssel: 87–88 Zeichen Base58 oder ein JSON-Zahlenfeld
    if (new RegExp(`^${B58}{86,90}$`).test(s) || /^\[\s*\d+(\s*,\s*\d+){30,}\s*\]$/.test(s)) {
        return { ok: false, grund: 'geheim', text: 'Das sieht aus wie ein privater Solana-Schlüssel. Bitte nur die öffentliche Adresse einfügen.' }
    }

    // ── öffentliche Formen ──
    const xp = s.match(new RegExp(`^(xpub|ypub|zpub)${B58}{100,112}$`))
    if (xp) {
        const a = XPUB_ART[xp[1]]
        return { ok: true, kette: 'btc', art: xp[1], wert: s, ableitung: a.ableitung, text: `Bitcoin-Konto, ${a.text}` }
    }
    if (/^bc1[qp][02-9ac-hj-np-z]{38,58}$/.test(s)) {
        return { ok: true, kette: 'btc', art: 'adresse', wert: s, text: s.startsWith('bc1p') ? 'Bitcoin-Adresse (Taproot)' : 'Bitcoin-Adresse (SegWit)' }
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
        return { ok: true, kette: 'evm', art: 'adresse', wert: s, text: 'EVM-Adresse (Ethereum & Co.)' }
    }
    if (new RegExp(`^T${B58}{33}$`).test(s)) {
        return { ok: false, grund: 'nichtUnterstuetzt', text: 'Tron-Adresse — Tron wird noch nicht abgefragt.' }
    }
    // XRP: klassische Adresse r… (Alphabet des XRPL ist ein anderes Base58,
    // die Form genügt hier); vor Solana prüfen, die Längen überschneiden sich.
    if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s)) {
        return { ok: true, kette: 'xrp', art: 'adresse', wert: s, text: 'XRP-Adresse' }
    }
    if (new RegExp(`^[13]${B58}{25,34}$`).test(s) && s.length <= 35) {
        return { ok: true, kette: 'btc', art: 'adresse', wert: s, text: s.startsWith('3') ? 'Bitcoin-Adresse (P2SH)' : 'Bitcoin-Adresse (Legacy)' }
    }
    // Solana: ein öffentlicher Schlüssel sind genau 32 Bytes. LTC-, DOGE- und
    // Testnetz-Adressen (25 Bytes Base58Check) haben dieselbe Zeichenform und
    // galten bis zum Audit FUN-PRT-004 als Solana (Bestand 0 ohne Fehler).
    if (new RegExp(`^${B58}{32,44}$`).test(s)) {
        if (base58Laenge(s) === 32) return { ok: true, kette: 'sol', art: 'adresse', wert: s, text: 'Solana-Adresse' }
        return { ok: false, grund: 'nichtUnterstuetzt', text: 'Diese Adresse gehört zu keiner abgefragten Kette (z. B. Litecoin, Dogecoin oder ein Testnetz).' }
    }
    return { ok: false, grund: 'unbekannt', text: 'Unbekanntes Format. Erkannt werden xpub/ypub/zpub, bc1…/1…/3…, 0x… (EVM, VeChain), r… (XRP) und Solana-Adressen.' }
}

/** Kurzform für die Anzeige: Anfang…Ende. */
export function kurzAdresse(s, vorn = 6, hinten = 4) {
    const t = String(s || '')
    return t.length <= vorn + hinten + 1 ? t : `${t.slice(0, vorn)}…${t.slice(-hinten)}`
}
