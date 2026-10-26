/**
 * Selbsttest: fremdes HTML und fremde Feeds in linearer Zeit zerlegen
 * (Gesamtaudit 26.10.2026, SEC-SRV-001 und SEC-SRV-011).
 *
 *   node server/__selftest-fremd-html.mjs
 *
 * Zwei Richtungen, beide gleich wichtig:
 *
 *   1. Präparierte Eingaben (2 MB `<`, `<!--`, offene `<item>` …) laufen in
 *      weniger als 300 ms durch. Vorher: 200 kB `<` → 12,6 s Stillstand des
 *      ganzen Servers.
 *   2. GEGENPROBE: Auf gewöhnlichem HTML und gewöhnlichen Feeds liefert der
 *      neue Weg genau dasselbe wie der alte. Die alten Regexe stehen dafür
 *      unten wörtlich — ein schneller Zerleger, der stillschweigend anderen
 *      Text liefert, verschiebt Noten, ohne dass es jemand merkt.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    ohneTags, ersetzeZwischen, ohneBloecke, elementInhalt, bloeckeVon, zeichenAusVerweis, HTML_MAX,
} from './html-zerlegen.js'
import { sichtbarerText, leseWebseite } from './hype-radar/projekt-bewertung.js'
import { leseFeed, leseTelegram } from './feed-parser.js'
import { leseBizKatalog } from './hype-radar/fruehphase-bewertung.js'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + String(zusatz).slice(0, 300) : ''}`)
}

const GRENZE_MS = 300
function schnell(name, fn) {
    const t0 = performance.now()
    let fehlerText = ''
    try { fn() } catch (e) { fehlerText = e.message }
    const ms = performance.now() - t0
    pruefe(`${name}: < ${GRENZE_MS} ms`, ms < GRENZE_MS && !fehlerText, fehlerText || `${ms.toFixed(0)} ms`)
}

// ── Die alten Wege, wörtlich (nur für die Gegenprobe) ────────────────────
const ENT_ALT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const entitaetenAlt = (text) => text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENT_ALT[n.toLowerCase()] ?? m)
const sichtbarerTextAlt = (html) => entitaetenAlt(String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim()
const titelAlt = (roh) => roh.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null
const bloeckeAlt = (roh, tag) => roh.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi')) || []
const textVonAlt = (block, tag) => block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? null
const cdataAlt = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

// ── Gewöhnliches HTML ────────────────────────────────────────────────────
const SEITEN = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Vaulteryx &amp; Friends — Restaking</title>
<meta name="description" content="Restaking for everyone &#8212; audited by CertiK">
<style>body{color:red}</style><script>window.__X = "<div>nicht sichtbar</div>"</script>
<!-- Kommentar mit <b>Tags</b> -->
</head><body><header><nav><a href="/docs">Docs</a> | <a href='https://x.com/vault'>X</a></nav></header>
<section><h1>Our Team</h1><p>Founded 2021.<br>Mainnet is live.<br/>Tokenomics: 1&nbsp;000&nbsp;000 total supply</p>
<ul><li>Roadmap Q1 2026</li><li>Audit by <em>Hacken</em></li></ul>
<svg viewBox="0 0 10 10"><text>SVG-Text</text></svg>
<p>a &lt; b &gt; c, Preis 5 &#x20AC; &#39;Zitat&#39;</p>
<template><p>Vorlage</p></template><noscript>Bitte JS</noscript>
<iframe src="x"></iframe><div title="x>y">Attribut mit spitzer Klammer</div>
<SCRIPT type="module">import x from "y"</SCRIPT>
<footer>© 2025 Vaulteryx</footer></section></body></html>`,
    // Next.js-artige Hülle mit Zustand im Skript
    `<html><head><title>App</title></head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"x":"<b>"}}</script>
<script src="/a.js"></script><script src="/b.js"></script></body></html>`,
    // Kaputtes, aber übliches HTML: offene Tags, Text mit „<"
    `<p>Wenn x < 5 und y > 3<p>zweiter Absatz<div>ohne Ende <b>fett</div> Rest <!-- offen`,
    // Kommentare und Skripte verschachtelt
    `<div>A<!-- <script>x</script> -->B<script>/* <!-- */</script>C<style>p{}</style>D</div>`,
    '',
    'nur Text ohne Tags',
]
for (const datei of ['index.html', 'node_modules/papaparse/player/player.html']) {
    try { SEITEN.push(fs.readFileSync(path.join(wurzel, datei), 'utf8')) } catch { /* fehlt: egal */ }
}

console.log('Gegenprobe: gewöhnliches HTML ergibt denselben sichtbaren Text')
for (const [i, html] of SEITEN.entries()) {
    const neu = sichtbarerText(html)
    const alt = sichtbarerTextAlt(html)
    pruefe(`Seite ${i}: sichtbarer Text unverändert`, neu === alt, JSON.stringify({ neu, alt }))
    pruefe(`Seite ${i}: Titel unverändert`, (elementInhalt(html, 'title')) === titelAlt(html))
    pruefe(`Seite ${i}: Tags wie <[^>]+>`, ohneTags(html, ' ') === html.replace(/<[^>]+>/g, ' '))
    pruefe(`Seite ${i}: Tags wie <[^>]*>`, ohneTags(html, '', { leer: true }) === html.replace(/<[^>]*>/g, ''))
    pruefe(`Seite ${i}: Kommentare wie <!--…-->`,
        ersetzeZwischen(html, '<!--', '-->', () => ' ') === html.replace(/<!--[\s\S]*?-->/g, ' '))
    pruefe(`Seite ${i}: Blöcke wie <(script|…)…</\\1>`,
        ohneBloecke(html, ['script', 'style', 'noscript', 'svg', 'template', 'iframe'])
        === html.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' '))
}
{
    const f = leseWebseite(SEITEN[0], { url: 'https://vaulteryx.io/' })
    pruefe('Webseite: Titel samt Entität', f.titel === 'Vaulteryx & Friends — Restaking', f.titel)
    pruefe('Webseite: Meta-Beschreibung', f.beschreibung === 'Restaking for everyone — audited by CertiK', f.beschreibung)
    pruefe('Webseite: Links gefunden', f.kanaele.x.length === 1 && f.kanaele.docs.length === 1, JSON.stringify(f.kanaele))
    pruefe('Webseite: Abschnitte erkannt', f.abschnitte.team && f.abschnitte.roadmap && f.abschnitte.audit && f.abschnitte.tokenomics)
    pruefe('Webseite: Skript-Inhalt nicht sichtbar', !f.textAuszug.includes('nicht sichtbar') && !f.textAuszug.includes('SVG-Text'))
    pruefe('Webseite: Copyright-Jahr', f.copyrightJahr === 2025)
    const h = leseWebseite(SEITEN[1])
    pruefe('Webseite: Skript-Hülle bleibt Skript-Hülle', h.nurSkript === true)
}

console.log('Numerische Verweise ausserhalb von Unicode werfen nicht')
pruefe('0x110000 → U+FFFD', zeichenAusVerweis(0x110000) === '�')
pruefe('Ersatzhälfte → U+FFFD', zeichenAusVerweis(0xd800) === '�')
pruefe('0 → U+FFFD', zeichenAusVerweis(0) === '�')
pruefe('€ bleibt €', zeichenAusVerweis(0x20ac) === '€')
pruefe('Emoji bleibt Emoji', zeichenAusVerweis(0x1f680) === '🚀')
{
    let ok = true
    try { sichtbarerText('<p>&#x110000; &#99999999999; ok</p>') } catch { ok = false }
    pruefe('sichtbarerText mit &#x110000; wirft nicht', ok)
}

// ── Feeds ────────────────────────────────────────────────────────────────
const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>Kanal</title>
<item><title><![CDATA[Bitcoin & ETF]]></title><link>https://a.example/1</link><guid>g1</guid>
<pubDate>Mon, 26 Oct 2026 08:00:00 GMT</pubDate>
<description><![CDATA[<p>Erster <b>Absatz</b></p><p>Zweiter&nbsp;Absatz &#x20AC; &#x110000;</p>]]></description>
<media:content url="https://img.example/1.jpg" medium="image"/></item>
<item foo="bar"><title>Zweiter &amp; Titel</title><link>https://a.example/2</link>
<description>&lt;p&gt;HTML als Entitäten&lt;/p&gt;</description><enclosure url="http://img.example/2.jpg"/></item>
<item><title>ohne Abschluss</title>
</channel></rss>`
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>Video</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-10-26T08:00:00+00:00</published>
<media:group><media:description>Beschreibung</media:description><media:thumbnail url="https://i.ytimg.com/vi/abc/hq.jpg"/></media:group></entry>
</feed>`

console.log('Gegenprobe: gewöhnliche Feeds')
for (const [name, xml, tag] of [['RSS', RSS, 'item'], ['Atom', ATOM, 'entry']]) {
    const alt = bloeckeAlt(xml, tag)
    const neu = bloeckeVon(xml, tag, 50)
    pruefe(`${name}: dieselben Blöcke`, JSON.stringify(alt) === JSON.stringify(neu), `${alt.length} / ${neu.length}`)
    for (const b of alt) {
        for (const t of ['title', 'link', 'guid', 'id', 'pubDate', 'published', 'description', 'media:description', 'yt:videoId']) {
            pruefe(`${name}: <${t}> wie vorher`, elementInhalt(b, t) === textVonAlt(b, t), t)
        }
        pruefe(`${name}: CDATA wie vorher`, ersetzeZwischen(b, '<![CDATA[', ']]>', (x) => x) === cdataAlt(b))
    }
}
{
    const r = leseFeed(RSS)
    pruefe('RSS: zwei vollständige Einträge, der offene fällt weg', r.length === 2, JSON.stringify(r))
    pruefe('RSS: CDATA-Titel', r[0]?.titel === 'Bitcoin & ETF', r[0]?.titel)
    pruefe('RSS: Text ohne Tags, Zeichenverweise aufgelöst, kaputter als U+FFFD',
        r[0]?.inhalt === 'Erster Absatz\nZweiter Absatz € �', JSON.stringify(r[0]?.inhalt))
    pruefe('RSS: Bild aus media:content', r[0]?.bild === 'https://img.example/1.jpg')
    pruefe('RSS: Item mit Attribut', r[1]?.titel === 'Zweiter & Titel' && r[1]?.id === 'https://a.example/2')
    const a = leseFeed(ATOM)
    pruefe('Atom: Video gelesen', a.length === 1 && a[0].videoId === 'abc' && a[0].link.includes('watch?v=abc')
        && a[0].inhalt === 'Beschreibung' && a[0].bild.includes('ytimg'), JSON.stringify(a))
    let ok = true
    try { leseFeed('<rss><item><title>x &#x110000;</title><guid>1</guid></item></rss>') } catch { ok = false }
    pruefe('Feed mit &#x110000; fällt nicht aus', ok)
}
{
    const tg = `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kanal/12">
<div class="tgme_widget_message_text js-message_text" dir="auto">Hallo <b>Welt</b>.<br/>Zweite Zeile</div>
<time datetime="2026-10-26T08:00:00+00:00">8:00</time></div></div>`
    const r = leseTelegram(tg)
    pruefe('Telegram: Beitrag gelesen', r.length === 1 && r[0].inhalt === 'Hallo Welt.\nZweite Zeile' && r[0].zeit > 0, JSON.stringify(r))
}
{
    const b = leseBizKatalog([{ threads: [{ sub: 'Betreff', com: 'a<br>b <a href="#">link</a> &amp; c' }] }])
    pruefe('/biz/: Text ohne Tags (wie vorher: je Tag ein Leerzeichen)', b[0]?.text === 'Betreff a b  link  & c', b[0]?.text)
}

// ── Präparierte Eingaben, 2 MB ───────────────────────────────────────────
console.log('Präparierte Eingaben (2 MB)')
const MB2 = 2 * 1024 * 1024
const boese = {
    '<': '<'.repeat(2e6),
    '<!--': '<!--'.repeat(5e5),
    '<script': '<script>'.repeat(2.5e5),
    '<svg ohne Ende nach Script': '<script></script>' + '<svg'.repeat(5e5),
    '<meta': '<meta'.repeat(4e5),
    '<title': '<title>'.repeat(3e5),
    '<a href': '<a href="x'.repeat(2e5),
    '<div id': '<div '.repeat(4e5),
    '&#x': '&#x110000;'.repeat(2e5),
    '<![CDATA[': '<![CDATA['.repeat(2.2e5),
    '<item>': '<rss>' + '<item>'.repeat(3.3e5),
    '<item><title>': '<rss><item>' + '<title>'.repeat(2.8e5) + '</item>',
    '<entry>': '<feed>' + '<entry>'.repeat(2.8e5),
    '<item> mit <enclosure': '<rss><item>' + '<enclosure '.repeat(1.8e5) + '</item>',
    'tgme message_text': 'tgme_widget_message_wrap data-post="a/1" ' + 'message_text'.repeat(1.6e5),
}
for (const [name, s] of Object.entries(boese)) {
    pruefe(`${name}: Eingabe ist ≥ 1,9 MB`, s.length >= 1.9e6, s.length)
    schnell(`sichtbarerText(${name})`, () => sichtbarerText(s))
    schnell(`leseWebseite(${name})`, () => leseWebseite(s, { contract: 'x', url: 'https://a.example/' }))
    schnell(`leseFeed(${name})`, () => leseFeed(s))
    schnell(`leseTelegram(${name})`, () => leseTelegram(s))
    schnell(`ohneTags(${name})`, () => ohneTags(s))
}
schnell('Biz-Katalog mit 2 MB <', () => leseBizKatalog([{ threads: [{ com: '<'.repeat(2e6) }] }]))
pruefe('über 2 MB wird nicht angefasst', MB2 > HTML_MAX)

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
