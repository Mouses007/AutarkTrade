/**
 * Text aus einem PDF lesen — genau so viel PDF, wie die ESTV-Kursliste braucht.
 *
 * Die Krypto-Kursliste (ICTax, `token kursliste_JJJJ.pdf`) ist ein kleines
 * Ghostscript-PDF: Flate-Streams, Objekt-Streams (ObjStm), Teilschriften mit
 * eigener Codierung und einer ToUnicode-Tabelle je Schrift. Ohne diese Tabelle
 * ist der Text Kauderwelsch (Code 0x01 heisst in der einen Schrift „V“, in der
 * anderen etwas anderes). Eine PDF-Bibliothek dafür (pdfjs-dist) brächte 70 MB
 * ins Image — für eine Datei mit zwei Seiten im Jahr.
 *
 * Ergebnis: Zeilen (oben nach unten), Zellen innerhalb einer Zeile durch
 * Tabulator getrennt, wo das PDF eine grössere Lücke setzt.
 *
 * Rein bis auf zlib: kein Netz, keine DB. Kann bewusst NICHT: Verschlüsselung,
 * LZW/ASCII85, Type3-Schriften, Querformat. Was es nicht versteht, wirft —
 * der Aufrufer prüft das Ergebnis ohnehin auf Plausibilität.
 */
import zlib from 'zlib'

const latin = (buf) => Buffer.from(buf).toString('latin1')

function inflate(roh) {
    // SYNC_FLUSH: ein Stream, dessen Länge um ein Zeilenende abweicht, liefert
    // trotzdem seinen Inhalt statt „unexpected end of file“.
    const o = { finishFlush: zlib.constants.Z_SYNC_FLUSH }
    try { return zlib.inflateSync(roh, o) } catch { /* evtl. ohne zlib-Kopf */ }
    try { return zlib.inflateRawSync(roh, o) } catch { return null }   // nicht lesbar (z. B. XRef-Stream) → überspringen
}

/** Alle Objekte: Nummer → { dict: string, stream: Buffer|null }. */
function objekte(buf) {
    const text = latin(buf)
    const obj = new Map()
    const re = /(\d+)\s+(\d+)\s+obj\b/g
    let m
    while ((m = re.exec(text))) {
        const nr = Number(m[1])
        const start = m.index + m[0].length
        const ende = text.indexOf('endobj', start)
        if (ende < 0) break
        const koerper = text.slice(start, ende)
        const s = koerper.search(/stream\r?\n/)
        let dict = koerper, stream = null
        if (s >= 0) {
            dict = koerper.slice(0, s)
            const dStart = start + s + koerper.slice(s).match(/stream\r?\n/)[0].length
            const len = Number((dict.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/) || [])[1])
            const dEnde = Number.isFinite(len) && len > 0 ? dStart + len : text.indexOf('endstream', dStart)
            let roh = buf.subarray(dStart, dEnde)
            if (/\/FlateDecode/.test(dict)) roh = inflate(roh)
            else if (/\/Filter/.test(dict)) throw new Error('PDF-Filter nicht unterstützt')
            stream = roh
        }
        obj.set(nr, { dict, stream })
        re.lastIndex = ende
    }
    // Objekte in Objekt-Streams auspacken
    for (const [, o] of [...obj]) {
        if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue
        const n = Number((o.dict.match(/\/N\s+(\d+)/) || [])[1])
        const first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1])
        const s = latin(o.stream)
        const kopf = s.slice(0, first).trim().split(/\s+/).map(Number)
        for (let i = 0; i < n; i++) {
            const nr = kopf[2 * i], ab = first + kopf[2 * i + 1]
            const bis = i + 1 < n ? first + kopf[2 * i + 3] : s.length
            if (!obj.has(nr)) obj.set(nr, { dict: s.slice(ab, bis), stream: null })
        }
    }
    return obj
}

const ref = (s, schluessel) => {
    const m = s.match(new RegExp(`/${schluessel}\\s+(\\d+)\\s+\\d+\\s+R`))
    return m ? Number(m[1]) : null
}

/** ToUnicode-CMap → Map(code → Text). */
export function leseCMap(text) {
    const karte = new Map()
    const hex = (h) => parseInt(h, 16)
    const uni = (h) => String.fromCodePoint(...(h.match(/.{4}/g) || [h]).map(hex))
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const [, a, b] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) karte.set(hex(a), uni(b))
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const [, a, b, c] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
            const von = hex(a), bis = hex(b), ziel = hex(c)
            for (let k = von; k <= bis; k++) karte.set(k, String.fromCodePoint(ziel + (k - von)))
        }
    }
    return karte
}

/** PDF-String-Literal ( … ) → Bytes. */
function literal(s) {
    const out = []
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c !== '\\') { out.push(c.charCodeAt(0) & 0xff); continue }
        const n = s[++i]
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }
        if (n in esc) out.push(esc[n])
        else if (/[0-7]/.test(n)) {
            let o = n
            while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]
            out.push(parseInt(o, 8) & 0xff)
        } else if (n === '\r' || n === '\n') { if (n === '\r' && s[i + 1] === '\n') i++ }
        else out.push(n.charCodeAt(0) & 0xff)
    }
    return out
}

/** Zerlegt einen Content-Stream in Token (Zahlen, Namen, Strings, Arrays, Operatoren). */
function* token(s) {
    let i = 0
    while (i < s.length) {
        const c = s[i]
        if (/\s/.test(c)) { i++; continue }
        if (c === '%') { while (i < s.length && s[i] !== '\n') i++; continue }
        if (c === '(') {
            let tiefe = 1, j = i + 1, inhalt = ''
            while (j < s.length && tiefe) {
                if (s[j] === '\\') { inhalt += s[j] + s[j + 1]; j += 2; continue }
                if (s[j] === '(') tiefe++
                else if (s[j] === ')' && --tiefe === 0) break
                inhalt += s[j++]
            }
            yield { t: 'str', v: literal(inhalt) }; i = j + 1; continue
        }
        if (c === '<' && s[i + 1] !== '<') {
            const j = s.indexOf('>', i)
            const h = s.slice(i + 1, j).replace(/\s/g, '')
            yield { t: 'str', v: (h.match(/.{1,2}/g) || []).map((x) => parseInt(x.padEnd(2, '0'), 16)) }
            i = j + 1; continue
        }
        if (c === '[') { yield { t: '[' }; i++; continue }
        if (c === ']') { yield { t: ']' }; i++; continue }
        if (c === '<' || c === '>') { i += 2; continue }   // << >> Dict im Inhalt (Inline-Bild o. Ä.)
        if (c === '/') { const m = s.slice(i).match(/^\/[^\s/[\]()<>{}%]*/); yield { t: 'name', v: m[0].slice(1) }; i += m[0].length; continue }
        const m = s.slice(i).match(/^[^\s/[\]()<>{}%]+/)
        if (!m) { i++; continue }
        const w = m[0]
        yield Number.isFinite(Number(w)) ? { t: 'num', v: Number(w) } : { t: 'op', v: w }
        i += w.length
    }
}

/**
 * @param {Buffer} buf  PDF-Datei
 * @returns {string[]}  Textzeilen aller Seiten, Zellen mit \t getrennt
 */
export function pdfZeilen(buf) {
    if (!latin(buf.subarray(0, 5)).startsWith('%PDF')) throw new Error('keine PDF-Datei')
    if (/\/Encrypt\b/.test(latin(buf))) throw new Error('verschlüsselte PDF nicht unterstützt')
    const obj = objekte(buf)
    const dictVon = (s) => {
        const r = s.match(/^\s*(\d+)\s+\d+\s+R/)
        return r ? (obj.get(Number(r[1]))?.dict || '') : s
    }
    const cmapCache = new Map()
    const zeilen = []
    const seiten = [...obj.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a[0] - b[0])
    for (const [, seite] of seiten) {
        // Schriften der Seite → CMap
        const ressourcen = (() => {
            const r = ref(seite.dict, 'Resources')
            if (r != null) return obj.get(r)?.dict || ''
            const m = seite.dict.match(/\/Resources\s*<<([\s\S]*)>>/)
            return m ? m[1] : ''
        })()
        let fontDict = ''
        const fr = ref(ressourcen, 'Font')
        if (fr != null) fontDict = obj.get(fr)?.dict || ''
        else { const m = ressourcen.match(/\/Font\s*<<([\s\S]*?)>>/); fontDict = m ? m[1] : '' }
        const schriften = new Map()
        for (const [, name, nr] of fontDict.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
            const f = dictVon(`${nr} 0 R`)
            const tu = ref(f, 'ToUnicode')
            if (tu == null) continue
            if (!cmapCache.has(tu)) cmapCache.set(tu, leseCMap(latin(obj.get(tu)?.stream || Buffer.alloc(0))))
            schriften.set(name, cmapCache.get(tu))
        }
        // Inhalt
        const inhaltRefs = (() => {
            const a = seite.dict.match(/\/Contents\s*\[([^\]]*)\]/)
            if (a) return [...a[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]))
            const r = ref(seite.dict, 'Contents')
            return r != null ? [r] : []
        })()
        const inhalt = inhaltRefs.map((r) => latin(obj.get(r)?.stream || Buffer.alloc(0))).join('\n')

        // Text-Operatoren abspielen: y je Zeile, Lücken als Tabulator
        const stueck = []   // { y, x, text }
        let karte = null, fontGr = 10, y = 0, x = 0, lz = 0, zeileY = 0
        const stapel = []
        let arr = null
        const neueZeile = (dy) => { y = zeileY + dy; zeileY = y; x = 0 }
        const decode = (bytes) => bytes.map((b) => (karte?.get(b) ?? '')).join('')
        for (const tk of token(inhalt)) {
            if (tk.t === '[') { arr = []; continue }
            if (tk.t === ']') { stapel.push({ t: 'arr', v: arr }); arr = null; continue }
            if (arr) { arr.push(tk); continue }
            if (tk.t !== 'op') { stapel.push(tk); continue }
            const z = (i) => stapel[stapel.length - i]?.v
            switch (tk.v) {
                case 'BT': y = 0; zeileY = 0; x = 0; break
                case 'Tf': karte = schriften.get(z(2)) || null; fontGr = Number(z(1)) || fontGr; break
                case 'TL': lz = Number(z(1)) || 0; break
                case 'Tm': zeileY = y = Number(z(1)) || 0; x = Number(z(2)) || 0; break
                case 'Td': neueZeile(Number(z(1)) || 0); x += Number(z(2)) || 0; break
                case 'TD': lz = -(Number(z(1)) || 0); neueZeile(Number(z(1)) || 0); x += Number(z(2)) || 0; break
                case 'T*': neueZeile(-lz); break
                case "'": neueZeile(-lz); stueck.push({ y, x, text: decode(z(1) || []) }); break
                case 'Tj': stueck.push({ y, x, text: decode(z(1) || []) }); x += 1; break
                case 'TJ': {
                    let text = ''
                    for (const e of z(1) || []) {
                        if (e.t === 'str') text += decode(e.v)
                        else if (e.t === 'num' && e.v < -250) text += '\t'   // grössere Lücke = neue Zelle
                    }
                    stueck.push({ y, x, text }); x += 1; break
                }
            }
            stapel.length = 0
        }
        const jeY = new Map()
        for (const s of stueck) {
            const k = Math.round(s.y * 10) / 10
            jeY.set(k, (jeY.get(k) || []).concat(s))
        }
        for (const [, teile] of [...jeY].sort((a, b) => b[0] - a[0])) {
            const zeile = teile.sort((a, b) => a.x - b.x).map((s) => s.text).join('\t')
                .split('\t').map((c) => c.trim()).filter(Boolean).join('\t')
            if (zeile) zeilen.push(zeile)
        }
    }
    return zeilen
}
