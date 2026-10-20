/**
 * Reiner Kern der mDNS-Ansage (server/mdns-name.mjs): DNS-Pakete lesen und bauen.
 * Kein Netz, keine Abhängigkeit — damit der Selbsttest jedes Byte prüfen kann.
 *
 * Wozu: Die App soll unter einem eigenen Namen (Vorgabe `autarktrade.local`)
 * erreichbar sein, ohne die NAS umzubenennen und ohne Router-Eintrag. mDNS
 * (RFC 6762) fragt solche Namen per Multicast im lokalen Netz ab; wer den Namen
 * „besitzt", antwortet mit seiner Adresse. Genau das — und nur das — tut dieser Teil:
 * eine einzige A-Antwort für einen einzigen Namen.
 *
 * Bewusst klein gehalten:
 *   - nur IPv4 (A-Satz); AAAA-Fragen bleiben unbeantwortet, die Geräte fallen auf A zurück;
 *   - keine Konfliktprüfung (Probing): der Name ist eigens für diese App;
 *   - Antwort mit gesetztem Cache-Flush-Bit, TTL 120 s (Vorgabe aus RFC 6762 §10).
 */

export const MDNS_ADRESSE = '224.0.0.251'
export const MDNS_PORT = 5353
export const TYP_A = 1
export const TYP_ANY = 255
export const KLASSE_IN = 1
export const TTL = 120

/** Name normalisieren: Kleinbuchstaben, ohne abschliessenden Punkt. */
export function normName(name) {
    return String(name || '').trim().toLowerCase().replace(/\.$/, '')
}

/** Gültiger .local-Name aus Buchstaben, Ziffern und Bindestrich je Teil? */
export function gueltigerName(name) {
    const n = normName(name)
    if (!n.endsWith('.local')) return false
    const teile = n.split('.')
    return teile.length >= 2 && teile.every((t) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(t))
}

/** IPv4 als Text → 4 Bytes, sonst null. */
export function ipBytes(ip) {
    const t = String(ip || '').split('.')
    if (t.length !== 4) return null
    const z = t.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN))
    return z.every((x) => x >= 0 && x <= 255) ? Buffer.from(z) : null
}

/**
 * Einen (evtl. komprimierten) Namen ab `pos` lesen.
 * @returns {{ name: string, ende: number } | null} ende = Position nach dem Namen im ORIGINAL
 */
export function leseName(buf, pos) {
    const teile = []
    let ende = -1
    let sprung = 0
    while (pos < buf.length) {
        const laenge = buf[pos]
        if (laenge === 0) { if (ende < 0) ende = pos + 1; return { name: teile.join('.').toLowerCase(), ende } }
        if ((laenge & 0xc0) === 0xc0) {
            if (pos + 1 >= buf.length || ++sprung > 16) return null
            if (ende < 0) ende = pos + 2
            pos = ((laenge & 0x3f) << 8) | buf[pos + 1]
            continue
        }
        if ((laenge & 0xc0) !== 0 || pos + 1 + laenge > buf.length) return null
        teile.push(buf.toString('latin1', pos + 1, pos + 1 + laenge))
        pos += 1 + laenge
    }
    return null
}

/**
 * Anfrage lesen. Nur Fragen (QR = 0) zählen; Antworten anderer Geräte werden ignoriert.
 * @returns {{ id: number, fragen: { name: string, typ: number, klasse: number, unicast: boolean }[] } | null}
 */
export function leseAnfrage(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null
    const flags = buf.readUInt16BE(2)
    if (flags & 0x8000) return null
    const anzahl = buf.readUInt16BE(4)
    const fragen = []
    let pos = 12
    for (let i = 0; i < anzahl; i++) {
        const n = leseName(buf, pos)
        if (!n || n.ende + 4 > buf.length) return null
        const typ = buf.readUInt16BE(n.ende)
        const klasseRoh = buf.readUInt16BE(n.ende + 2)
        fragen.push({ name: n.name, typ, klasse: klasseRoh & 0x7fff, unicast: !!(klasseRoh & 0x8000) })
        pos = n.ende + 4
    }
    return { id: buf.readUInt16BE(0), fragen }
}

/** Name als Folge von Längen-Labels (ohne Kompression). */
export function schreibeName(name) {
    const teile = normName(name).split('.')
    return Buffer.concat([...teile.map((t) => Buffer.concat([Buffer.from([t.length]), Buffer.from(t, 'latin1')])), Buffer.from([0])])
}

/** Fragt diese Anfrage nach unserem Namen (A oder ANY, Klasse IN)? */
export function fragtNach(anfrage, name) {
    const ziel = normName(name)
    return !!anfrage?.fragen?.some((f) => f.name === ziel && (f.typ === TYP_A || f.typ === TYP_ANY) && (f.klasse === KLASSE_IN || f.klasse === TYP_ANY))
}

/**
 * Antwort bauen.
 * @param {string} name
 * @param {string} ip
 * @param {{ id?: number, mitFrage?: boolean }} [o] Für Altanfragen (Quellport ≠ 5353, RFC 6762 §6.7):
 *   ID der Anfrage zurückgeben und die Frage wiederholen, ohne Cache-Flush-Bit.
 */
export function baueAntwort(name, ip, o = {}) {
    const adr = ipBytes(ip)
    if (!adr) throw new Error('ungültige IPv4: ' + ip)
    const nameBytes = schreibeName(name)
    const kopf = Buffer.alloc(12)
    kopf.writeUInt16BE(o.id || 0, 0)
    kopf.writeUInt16BE(0x8400, 2)          // Antwort, autoritativ
    kopf.writeUInt16BE(o.mitFrage ? 1 : 0, 4)
    kopf.writeUInt16BE(1, 6)
    const teile = [kopf]
    if (o.mitFrage) {
        const q = Buffer.alloc(4)
        q.writeUInt16BE(TYP_A, 0); q.writeUInt16BE(KLASSE_IN, 2)
        teile.push(nameBytes, q)
    }
    const rr = Buffer.alloc(10)
    rr.writeUInt16BE(TYP_A, 0)
    rr.writeUInt16BE(o.mitFrage ? KLASSE_IN : (0x8000 | KLASSE_IN), 2)   // Cache-Flush nur bei Multicast
    rr.writeUInt32BE(TTL, 4)
    rr.writeUInt16BE(4, 8)
    teile.push(nameBytes, rr, adr)
    return Buffer.concat(teile)
}

/** Eine Frage bauen (für Selbsttest und Probe). */
export function baueFrage(name, { typ = TYP_A, id = 0, unicast = false } = {}) {
    const kopf = Buffer.alloc(12)
    kopf.writeUInt16BE(id, 0)
    kopf.writeUInt16BE(1, 4)
    const q = Buffer.alloc(4)
    q.writeUInt16BE(typ, 0); q.writeUInt16BE((unicast ? 0x8000 : 0) | KLASSE_IN, 2)
    return Buffer.concat([kopf, schreibeName(name), q])
}

/**
 * Passende IPv4 dieses Rechners wählen: private Adresse, keine Docker-/virtuellen
 * Schnittstellen, 192.168.* vor 10.* vor 172.16–31.*.
 * @param {Record<string, {address:string,family:string|number,internal:boolean}[]>} schnittstellen os.networkInterfaces()
 */
export function waehleIp(schnittstellen) {
    const kandidaten = []
    for (const [name, liste] of Object.entries(schnittstellen || {})) {
        if (/^(docker|br-|veth|virbr|lo|tun|tap|wg|zt|cali|flannel|cni)/i.test(name)) continue
        for (const a of liste || []) {
            if (a.internal || !(a.family === 'IPv4' || a.family === 4)) continue
            const ip = a.address
            const rang = /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : -1
            if (rang >= 0) kandidaten.push({ ip, rang })
        }
    }
    kandidaten.sort((a, b) => a.rang - b.rang)
    return kandidaten[0]?.ip || null
}
