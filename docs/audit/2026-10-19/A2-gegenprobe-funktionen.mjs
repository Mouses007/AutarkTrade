const w = process.argv[2]
const { istLoopbackHost, istErlaubterHost } = await import(w + '/server/auth.js')
const { isLocalRequest } = await import(w + '/server/update-api.js')
const { istPrivatV6, pruefeOeffentlicheUrl } = await import(w + '/server/net-guard.js')
const { umgebungAn } = await import(w + '/server/umgebung.js')
const z = []
z.push(['A2-01 istLoopbackHost(127.0.0.1.evil.example)', istLoopbackHost('127.0.0.1.evil.example')])
z.push(['A2-01 Host-Guard 127.0.0.1.rebind.example', istErlaubterHost('127.0.0.1.rebind.example:8080')])
z.push(['A2-02 lokal trotz Origin evil', isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' } })])
z.push(['A2-04 istPrivatV6(::ffff:7f00:1) (false = Lücke)', istPrivatV6('::ffff:7f00:1')])
let durch = true; try { await pruefeOeffentlicheUrl('http://[::ffff:127.0.0.1]/') } catch { durch = false }
z.push(['A2-04 [::ffff:127.0.0.1] geht durch', durch])
process.env.CTJ_RESET_AUTH = '1'; process.env.AT_RESET_AUTH = ''
z.push(['A2-30 leeres AT_RESET_AUTH + CTJ_RESET_AUTH=1 wirkt', umgebungAn('RESET_AUTH')])
for (const [n, v] of z) console.log(`${n}: ${v}`)
process.exit(0)
