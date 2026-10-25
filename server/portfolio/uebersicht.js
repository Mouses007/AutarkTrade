/**
 * Spot-Portfolio: die Übersicht aus dem gespeicherten Stand.
 *
 * Liest nur die DB (plus Kurse) — kein Börsenabruf. Darum darf die Seite sie
 * so oft holen, wie sie will.
 *
 * Zwei Sichten auf dieselben Zahlen:
 *   posten   je Coin, darunter die Orte, an denen er liegt
 *   quellen  je Ort (Börse bzw. Wallet → Kette), darunter die Coins
 *
 * Der Abgleich je Quelle vergleicht den gemeldeten Bestand mit der Summe der
 * Bewegungen. Bei Bitget (Historie ab Kontoeröffnung) ist jede Abweichung ein
 * Befund; bei Bitunix/Pionex fehlen Ein- und Auszahlungen grundsätzlich —
 * dort heisst die Abweichung „Historie unvollständig", nicht „Fehler".
 */

import { totalverluste, TOTALVERLUST } from './totalverlust.js'
import { spamPruefer } from './spam.js'
import { getKnex } from '../database.js'
import { kurseFuer } from './kurse.js'
import { saldiere } from './normal.js'
import { boersenWahl, laufStand, BOERSEN } from './abruf.js'
import { WALLET_TYPEN, EVM_NETZE, KETTEN } from '../../shared/portfolio-adresse.js'
import { uebergaben, ohneUebernommene } from './uebergabe.js'

const BOERSEN_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex', bitpanda: 'Bitpanda' }

function kettenName(kette) {
    if (!kette) return ''
    if (kette.startsWith('evm:')) return EVM_NETZE.find((n) => `evm:${n.id}` === kette)?.name || kette
    return KETTEN[kette]?.name || kette
}

export async function berechneUebersicht({ ohneVerlauf = false } = {}) {
    const k = getKnex()
    const [alleBestaende, quellenStand, wallets, adressen, settings] = await Promise.all([
        k('portfolio_bestaende').select('*'),
        k('portfolio_quellen').select('*'),
        k('portfolio_wallets').select('*').orderBy([{ column: 'sortierung' }, { column: 'id' }]),
        k('portfolio_adressen').select('id', 'walletId', 'kette', 'art', 'anzeige', 'netze', 'label', 'importOrte', 'liveAb').orderBy('id'),
        k('settings').select('portfolioStaubChf').where('id', 1).first(),
    ])
    // Übergabe Import → Live: was eine Adresse live meldet, ersetzt den Import.
    const { ersetzt } = uebergaben(alleBestaende, adressen, new Map(quellenStand.map((q) => [q.quelle, q])))
    const bestaende = ohneUebernommene(alleBestaende, ersetzt)
    const staubChf = Number(settings?.portfolioStaubChf ?? 1)
    const tot = await totalverluste()
    const istSpam = await spamPruefer()
    const wahl = await boersenWahl()

    // Kurse für alles, was im Bestand liegt
    const posten = bestaende.map((b) => ({ asset: b.asset, kontrakt: b.kontrakt, kette: b.kontrakt ? (b.ort === 'sol' ? 'sol' : b.ort) : null, menge: b.menge }))
    const { kurse, fx, marktFehler } = await kurseFuer(posten)

    const keyVon = (b) => (b.kontrakt ? `${b.asset}|${b.kontrakt}` : b.asset)
    const quellKurs = new Map()
    for (const b of bestaende) {
        if (Number(b.kursUsd) > 0 && !quellKurs.has(keyVon(b))) {
            quellKurs.set(keyVon(b), { usd: Number(b.kursUsd), quelle: `Bewertung ${b.quelle === 'bitpanda' ? 'Bitpanda' : b.quelle}` })
        }
    }
    const jeAsset = new Map()
    const jeQuelle = new Map()
    let gesamtUsd = 0, ohneKurs = 0
    for (const b of bestaende) {
        const key = keyVon(b)
        const spam = istSpam(b.asset, b.kontrakt)
        // Spam hat keinen Wert, auch wenn ein Fantasie-Pool einen Preis nennt.
        let kurs = spam ? { usd: null, quelle: 'Spam' } : (kurse.get(key) || { usd: null, quelle: 'kein Kurs' })
        // Rechenreste aus Importen (CHSB 6e-12, OCC 4e-6) sind kein Bestand: ohne
        // Kurs würden sie als „0 · kein Kurs" in der Liste stehen.
        if (kurs.usd == null && !quellKurs.has(key) && Math.abs(b.menge) < 1e-5) continue
        // Ohne Börsenkurs: den Kurs, den eine Quelle selbst nennt (Bitpanda) —
        // für ALLE Orte dieses Coins, denn derselbe Coin hat überall denselben
        // Wert (CSPR bei Bitget ohne Kurs, bei Bitpanda bewertet).
        if (kurs.usd == null && quellKurs.has(key)) kurs = quellKurs.get(key)
        if (kurs.usd == null && tot.has(String(b.asset).toUpperCase())) kurs = { usd: 0, quelle: TOTALVERLUST, totalverlust: true }
        const usd = kurs.usd != null ? b.menge * kurs.usd : null
        const chf = usd != null ? usd * fx.chf : null
        if (usd != null) gesamtUsd += usd; else ohneKurs++
        const anzeigeName = b.name === 'ohneSymbol' ? (kurs.symbol || `${b.asset}…`) : b.asset
        const p = jeAsset.get(key) || {
            schluessel: key, asset: anzeigeName, kontrakt: b.kontrakt, kette: b.kontrakt ? b.ort : null,
            menge: 0, usdKurs: kurs.usd, kursQuelle: kurs.quelle, usd: 0, chf: 0, ohneKurs: kurs.usd == null, totalverlust: !!kurs.totalverlust, spam, orte: [],
        }
        p.menge += b.menge
        if (usd != null) { p.usd += usd; p.chf += chf }
        p.orte.push({ quelle: b.quelle, ort: b.ort, ortName: b.name && b.name !== 'ohneSymbol' ? b.name : kettenName(b.ort), menge: b.menge, chf })
        jeAsset.set(key, p)

        const q = jeQuelle.get(b.quelle) || { chf: 0, usd: 0, posten: [] }
        if (usd != null) { q.chf += chf; q.usd += usd }
        q.posten.push({ schluessel: key, asset: anzeigeName, ort: b.ort, ortName: kettenName(b.ort) || b.name, menge: b.menge, chf, ohneKurs: usd == null, spam })
        jeQuelle.set(b.quelle, q)
    }
    const gesamtChf = gesamtUsd * fx.chf
    const postenListe = [...jeAsset.values()]
        .map((p) => ({ ...p, anteil: gesamtChf > 0 ? p.chf / gesamtChf : 0, staub: !p.ohneKurs && p.chf < staubChf }))
        .sort((a, b) => (b.chf || 0) - (a.chf || 0) || a.asset.localeCompare(b.asset))

    // Abgleich: Bewegungen saldiert gegen den gemeldeten Bestand
    const bewegungen = await k('portfolio_bewegungen').select('quelle', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'gebuehrAsset', 'gebuehrMenge', 'kontrakt')
    const bewJeQuelle = new Map()
    for (const b of bewegungen) {
        const l = bewJeQuelle.get(b.quelle) || []
        l.push(b)
        bewJeQuelle.set(b.quelle, l)
    }
    const standVon = new Map(quellenStand.map((q) => [q.quelle, q]))
    function abgleich(quelle) {
        const bew = bewJeQuelle.get(quelle) || []
        const st = standVon.get(quelle)
        let vollstaendig = false
        try { vollstaendig = !!JSON.parse(st?.stand || '{}').vollstaendig } catch { /* */ }
        const soll = saldiere(bew)
        const ist = new Map()
        for (const b of bestaende) if (b.quelle === quelle && b.ort !== 'bots') ist.set(keyVon(b), (ist.get(keyVon(b)) || 0) + b.menge)
        const abw = []
        for (const key of new Set([...soll.keys(), ...ist.keys()])) {
            const s = soll.get(key) || 0, i = ist.get(key) || 0
            const diff = i - s
            if (Math.abs(diff) <= Math.max(1e-8, Math.abs(i) * 1e-6)) continue
            const kurs = kurse.get(key)?.usd
            const chf = kurs != null ? Math.abs(diff) * kurs * fx.chf : null
            if (chf != null && chf < Math.max(staubChf, 0.5)) continue
            abw.push({ asset: key.split('|')[0], bestand: i, ausBewegungen: s, differenz: diff, chf })
        }
        abw.sort((a, b) => (b.chf || 0) - (a.chf || 0))
        return { bewegungen: bew.length, vollstaendig, abweichungen: abw.slice(0, 12), stimmt: abw.length === 0 }
    }

    const quellen = []
    for (const b of BOERSEN) {
        if (!wahl[b].spot) continue
        const st = standVon.get(b)
        quellen.push({
            quelle: b, gruppe: 'boerse', name: BOERSEN_NAME[b], chf: jeQuelle.get(b)?.chf || 0,
            posten: jeQuelle.get(b)?.posten || [], status: st?.status || 'neu', meldung: st?.meldung || null,
            letzterAbruf: Number(st?.letzterAbruf) || null, abgleich: abgleich(b),
        })
    }
    const walletListe = wallets.map((w) => ({ id: w.id, typ: w.typ, typName: WALLET_TYPEN[w.typ]?.name || w.typ, name: w.name, chf: 0, adressen: [] }))
    for (const a of adressen) {
        const w = walletListe.find((x) => x.id === a.walletId)
        if (!w) continue
        const quelle = `a${a.id}`
        const st = standVon.get(quelle)
        let netze = []
        try { netze = JSON.parse(a.netze || '[]') } catch { netze = [] }
        const q = {
            quelle, gruppe: 'wallet', walletId: w.id, adressId: a.id, kette: a.kette, art: a.art, anzeige: a.anzeige, label: a.label,
            netze, name: a.label || KETTEN[a.kette]?.name || a.kette, chf: jeQuelle.get(quelle)?.chf || 0,
            posten: jeQuelle.get(quelle)?.posten || [], status: st?.status || 'neu', meldung: st?.meldung || null,
            letzterAbruf: Number(st?.letzterAbruf) || null, abgleich: a.kette === 'btc' ? abgleich(quelle) : null,
        }
        w.adressen.push(q)
        w.chf += q.chf
        quellen.push(q)
    }

    // Importierte Orte (Datei): Bestand aus den Bewegungen, keine API.
    for (const st of quellenStand.filter((q) => q.quelle.startsWith('i:'))) {
        const ue = ersetzt.get(st.quelle)
        const adr = ue ? adressen.find((a) => a.id === ue.adressId) : null
        const w = adr ? wallets.find((x) => x.id === adr.walletId) : null
        quellen.push({
            quelle: st.quelle, gruppe: 'import', name: st.quelle.slice(2), chf: jeQuelle.get(st.quelle)?.chf || 0,
            posten: jeQuelle.get(st.quelle)?.posten || [], status: st.status || 'ok', meldung: st.meldung || null,
            letzterAbruf: Number(st.letzterAbruf) || null, abgleich: null,
            uebergeben: ue ? { an: `${w?.name || 'Wallet'} · ${adr.label || KETTEN[adr.kette]?.name || adr.kette}`, ab: ue.liveAb, alle: ue.alle } : null,
        })
    }

    let verlauf = []
    if (!ohneVerlauf) {
        verlauf = (await k('portfolio_verlauf').select('datum', 'wertChf').orderBy('datum', 'desc').limit(400)).reverse()
            .map((v) => ({ datum: v.datum, chf: v.wertChf }))
    }
    return {
        gesamt: { chf: gesamtChf, usd: gesamtUsd, ohneKurs },
        fx: { chf: fx.chf, quelle: fx.quelle, datum: fx.datum },
        marktFehler: marktFehler || null,
        staubChf,
        posten: postenListe,
        quellen,
        wallets: walletListe,
        verlauf,
        boersen: wahl,
        lauf: laufStand(),
    }
}
