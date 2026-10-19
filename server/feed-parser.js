/**
 * Schlanker Leser für RSS und Atom.
 *
 * Warum keine Bibliothek: Es sind wenige, enge Formate — YouTube liefert Atom,
 * die meisten Verlage und Spiegel RSS 2.0 — und gebraucht werden sechs
 * Felder. Ein allgemeiner XML-Leser brächte dafür mehr Angriffsfläche als
 * Nutzen — Entity-Expansion („Billion Laughs") und externe Entities (XXE) sind
 * genau die Sorte Loch, die man sich mit einer Abhängigkeit einkauft, die viel
 * mehr kann als man braucht. Hier werden ausschliesslich die fünf
 * Standard-Entities und numerische Verweise aufgelöst; DTDs werden ignoriert.
 *
 * Der Preis: bei einem exotischen Feed bricht er. Deshalb wird der Fehler je
 * Quelle festgehalten und angezeigt, statt den ganzen Lauf scheitern zu lassen.
 */

const MAX_EINTRAEGE = 50
const MAX_TEXT = 4000

/** Nur die fünf Standard-Entities und numerische Verweise — keine DTD. */
function entschluessle(text) {
    return String(text || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        // Benannte Entities jenseits der fünf Standardfälle: Telegram und
        // manche Redaktionssysteme streuen sie ein, und stehen bleiben sie
        // sonst als sichtbarer Müll mitten im Text
        .replace(/&nbsp;/g, ' ')
        .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
        .replace(/&hellip;/g, '…').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        // &amp; zuletzt, sonst würde „&amp;lt;" zu „<" statt zu „&lt;"
        .replace(/&amp;/g, '&')
}

const cdataWeg = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

function textVon(block, tag) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? entschluessle(cdataWeg(m[1])).trim() : ''
}

function attributVon(block, tag, attr) {
    const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'))
    return m ? entschluessle(m[1]) : ''
}

/** HTML aus Beschreibungen entfernen — wir wollen Text, keine Auszeichnung. */
function nurText(html) {
    return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_TEXT)
}

/*
 * Hier stand bis S12 ein Leser für öffentliche Telegram-Kanalseiten
 * (`https://t.me/s/<kanal>`). Entfernt: Telegram verbietet das Scrapen und
 * Aggregieren öffentlicher Kanäle, ausdrücklich auch zum Einsatz mit KI
 * (Content-Licensing, Verkaufs-Prüfung Z. 31/52/63).
 */

/**
 * @returns {{titel:string, link:string, id:string, zeit:number|null,
 *            inhalt:string, videoId:string}[]}
 */
export function leseFeed(xml) {
    const roh = String(xml || '')
    if (!roh.trim()) return []

    // Atom nutzt <entry>, RSS <item> — sonst ist der Aufbau nah genug beieinander
    const istAtom = /<feed[\s>]/i.test(roh)
    const tag = istAtom ? 'entry' : 'item'
    const bloecke = roh.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi')) || []

    return bloecke.slice(0, MAX_EINTRAEGE).map((b) => {
        const titel = textVon(b, 'title')
        // Atom hat den Verweis im Attribut, RSS im Elementtext
        const link = textVon(b, 'link') || attributVon(b, 'link', 'href')
        const videoId = textVon(b, 'yt:videoId')
        const zeitText = textVon(b, 'pubDate') || textVon(b, 'published') || textVon(b, 'updated')
        const zeit = zeitText ? Date.parse(zeitText) : null
        /*
         * Bild: drei Schreibweisen sind üblich, und keine ist verbindlich —
         * YouTube nutzt media:thumbnail, Cointelegraph media:content,
         * ältere Feeds enclosure. Der erste Treffer gewinnt.
         */
        const bild = attributVon(b, 'media:thumbnail', 'url')
            || attributVon(b, 'media:content', 'url')
            || attributVon(b, 'enclosure', 'url')
            || ''

        const inhalt = nurText(
            textVon(b, 'media:description') || textVon(b, 'content:encoded')
            || textVon(b, 'description') || textVon(b, 'content') || textVon(b, 'summary'))

        return {
            titel,
            link,
            // Ohne stabile Kennung nehmen wir den Verweis — er ist bei allen
            // drei Formaten eindeutig genug für die Doppelerkennung
            id: textVon(b, 'guid') || textVon(b, 'id') || videoId || link,
            zeit: Number.isFinite(zeit) ? zeit : null,
            inhalt,
            bild,
            videoId,
        }
    }).filter(e => e.titel && e.id)
}
