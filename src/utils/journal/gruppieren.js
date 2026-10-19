/**
 * Gruppen der gefilterten Trades für die Dashboard-Diagramme (`groups.*`).
 *
 * Die Schlüsselreihenfolge ist Teil des Ergebnisses: `charts.js` übernimmt sie
 * in die Achsen (Spezifikation journal-kern.md §3.6).
 */
import dayjs from './zeit.js'
import { timeZoneTrade } from '../../stores/app/rahmen.js'
import { groups, timeFrame } from '../../stores/journal/auswertung.js'
import { useGetTagInfo } from './tagebuch.js'
import { gruppiere, sortiertNach } from './hilfen.js'
import { kette } from './kette.js'

const MIO = 1000000

/** Dauer in Minuten → Stufe der Dauer-Gruppe. */
function dauerStufe(sekunden) {
    const d = sekunden / 60
    if (Number.isNaN(d)) return undefined
    for (const stufe of [60, 40, 20, 10, 5, 2, 1]) if (d >= stufe) return stufe
    return 0
}

/** Trades pro Tag → Fünferstufe, gedeckelt bei 30. */
const tradesStufe = (n) => (n > 30 ? 30 : Math.ceil(n / 5) * 5)

function preisStufe(p) {
    if (Number.isNaN(Number(p))) return undefined
    return p < 30 ? Math.floor(p / 5) * 5 : 30
}

function floatStufe(v) {
    if (v === '-') return undefined
    if (v < 20 * MIO) return Math.floor(v / (5 * MIO)) * 5 * MIO
    if (v < 50 * MIO) return Math.floor(v / (10 * MIO)) * 10 * MIO
    return 50 * MIO
}

function kapStufe(m) {
    if (m == null) return undefined
    for (const grenze of [50, 300, 2000, 10000]) if (m <= grenze * MIO) return grenze * MIO
    return 10001 * MIO
}

/** Einstiegszeit auf das Minutenraster abgerundet, als „HH:mm" in der Handelszeitzone. */
function zeitfensterSchluessel(trade) {
    const raster = timeFrame.value * 60 * 1000
    const ms = Math.floor((trade.entryTime * 1000) / raster) * raster
    return dayjs(ms).tz(timeZoneTrade.value).format('HH:mm')
}

/** Wie `gruppiere`, aber Schlüssel lexikographisch aufsteigend eingefügt. */
function gruppiereSortiert(liste, schluesselVon) {
    const roh = gruppiere(liste, schluesselVon)
    const aus = {}
    for (const k of Object.keys(roh).sort()) aus[k] = roh[k]
    return aus
}

/**
 * Tag-Einträge: je Trade und Tag ein Eintrag. Setzt `groupName`/`groupId`
 * DIREKT am Tag-Objekt des Trades — bewusster Altfehler §7.3, die Felder
 * erscheinen dadurch auch in `filteredTrades[].trades[].tags[]`.
 */
function tagEintraege(liste) {
    const eintraege = []
    for (const trade of liste) {
        const tagsDesTrades = trade.tags ? trade.tags : [{ id: 'no_tags', name: 'No Tags' }]
        for (const tag of tagsDesTrades) {
            const info = useGetTagInfo(tag.id)
            tag.groupName = info.tagGroupName
            tag.groupId = info.tagGroupId
            eintraege.push({ tagName: tag.name, tagGroupName: info.tagGroupName, ...trade, tag, _gruppe: info.tagGroupId })
        }
    }
    return eintraege
}

export async function useGroupTrades() {
    const liste = kette.tradeListe
    const dauer = (t) => t.exitTime - t.entryTime

    groups.day = gruppiere(liste, t => dayjs.unix(t.entryTime).day())   // Prozesszeitzone, §7.13
    groups.timeframe = gruppiereSortiert(liste, zeitfensterSchluessel)
    groups.duration = gruppiere(sortiertNach(liste, dauer), t => dauerStufe(dauer(t)))
    groups.trades = gruppiere(Object.values(kette.tagesSummen), s => tradesStufe(s.trades))
    groups.executions = gruppiere(liste, t => t.executionsCount)
    groups.position = gruppiere(liste, t => t.strategy)
    groups.tradeType = gruppiere(liste.filter(t => t.tradeType), t => t.tradeType)

    const eintraege = tagEintraege(liste)
    const ohneGruppe = (e) => { const { _gruppe, ...rest } = e; return rest }
    groups.tags = gruppiere(eintraege.map(ohneGruppe), e => e.tag.id)

    // Tag-Gruppen kommen und gehen mit dem Filter: was der vorige Lauf unter
    // `group_*` abgelegt hat, muss weg, sonst zeigen die Tag-Diagramme nach
    // einem Filterwechsel noch die alten Trades (bis 19.10.2026 der Fall).
    for (const schluessel of Object.keys(groups)) {
        if (schluessel.startsWith('group_')) delete groups[schluessel]
    }
    const jeGruppe = gruppiere(eintraege, e => e._gruppe)
    for (const [gruppenId, inGruppe] of Object.entries(jeGruppe)) {
        groups[gruppenId] = gruppiere(inGruppe.map(ohneGruppe), e => e.tag.id)
    }

    groups.symbols = gruppiere(liste, t => t.symbol)
    const mitFloat = liste.filter(t => t.financials?.publicFloat !== undefined && t.financials?.publicFloat !== null)
    groups.shareFloat = gruppiere(mitFloat, t => floatStufe(t.financials.publicFloat.finviz))
    groups.mktCap = gruppiere(mitFloat, t => kapStufe(t.financials.mktCap))
    groups.entryPrice = gruppiere(liste, t => preisStufe(t.entryPrice))
}
