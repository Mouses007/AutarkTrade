/**
 * Selbsttest Spam-Erkennung (spamGrund, rein) gegen die Token-Namen eines
 * echten Bestands (25.10.2026). Beide Richtungen zählen: ein Filter, der einen
 * echten Coin frisst, versteckt Vermögen — das ist schlimmer als Spam zu zeigen.
 */
import { spamGrund, assetsMitHerkunft } from './spam.js'

let ok = 0, fail = 0
const pruefe = (name, bed) => { if (bed) ok++; else { fail++; console.error('✗', name) } }
const V = '0x' + 'a'.repeat(40)

const SPAM = ['VISIT HTTPS://AMUSD.XYZ TO CLAIM REWARDS.', 'CLAIM: HTTPS://AERODROME.SUPPLY', 'TBBT.ORG', 'CLAIM ON: SWAP-BASED.COM',
    'HTTPS://KEUSD.TECH TO CLAIM REWARD', 'NC-ELIGIBLE (VERIFY: HTTPS://NODEPAY.DEV/VERIFY)', 'CLAIM REWARDS AT HTTPS://MODE.GIFT',
    '$ CHECK: BLASTCODE.IO YOUR AIRDROP CODE', 'CLAIM BY LINK: ZIRCULT.XYZ', 'CHECK/CLAIM: PEPEVIP.ART', 'USE JUST OFFICIAL LINK: TRUSTBOX.SITE',
    'VISIT WEBSITE NANOETHER .ORG TO CLAIM REWARDS', '$ CLAIMLIDO.COM', 'VISIT [5000USDC.ORG] TO CLAIM AIRDROP', 'VISIT TO GET REWARDS: GET-LIDO.XYZ',
    'GGBOXS.COM', 'ENA-W [ETHENADROP.NET]', 'ACX   [VIA WWW.ACROSS.EVENTS]', '$ ', 'AVAXVOUCHER.COM SWAP NOW', 'BALANCERV2.COM',
    'WWW.UNISWAP.CAB', '[LIDOSR.XYZ] CLAIM YOUR SPECIAL REWARDS.', 'AAVE [ACCESS AAVE.ASIA]', 'SOUTH REWARD TICKET (WEBSITE: DEEPSOUTHAI.ORG)',
    '$ GRAPHPOOL.XYZ', 'ODOS-LP - ODOSLOYALTY.COM', 'SWAPQ.ORG', '$PHA ', 'DRAF.IO', 'AIRDROP(S) TO BE CLAIMED AT HTTPS://GETDROPS.IO',
    '$ ACCESS ETHENA-E.COM TO CLAIM', 'KURO  [WWW.KURORO.GG]', 'GRT VOUCHER TOKEN ', 'PAWS ', '$USDT &GT; LOOT-USDT.COM',
    'GET $MVP REWARD AT HTTPS://MAGAVPTOKEN.COM', 'VISIT LIDO-EVENT.SITE TO JOIN LIDO GIVEAWAY!', 'RIFTDAO.NET', 'ACCESS [ETHNA.CC] TO CLAIM YOUR TOKENS']
const ECHT = ['BNT', 'KIMO', 'CSS', 'CMAI', 'PIG', 'BATRI', 'BLOK', 'MORPHAI', 'SFM', 'AURK', 'MVP', 'USDT', 'KEB', 'BERRY', 'WETH', 'FIRE',
    'YIELDX', 'SOUTH', 'POSI', 'CHF24', 'VXV', 'ILV', 'MD+', 'PORT', 'MB', 'KEKIUS', 'AI', 'VERTAI', 'MEMAG', 'STETH', 'EPIK', 'BONE', 'GRT',
    'FISH', 'USDC', 'HEX', 'MAGA', 'OCC', 'LBLOCK', 'FAM', 'D2T', 'SEN', 'RBLZ', 'COFFEE', 'HERO', 'USDC.e', 'BTC.b', 'WBTC']

for (const n of SPAM) pruefe(`Spam: ${n}`, spamGrund(n, V) != null)
for (const n of ECHT) pruefe(`echt: ${n}`, spamGrund(n, V) == null)
pruefe('ohne Vertrag nie Spam (Börsen-Coin)', spamGrund('VISIT X.COM TO CLAIM', null) == null)
pruefe('Vertragsfeld ohne Adresse → Spam', spamGrund('PAWS', ' T.ME/S/BD_PAWS ') === 'vertrag')
pruefe('Solana-Vertrag gilt als Adresse', spamGrund('BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263') == null)


// Zweite Regel: Herkunft (Fälle aus dem echten Bestand, 26.10.2026)
const h = assetsMitHerkunft([
    { asset: 'SOUTH', art: 'tausch', menge: 50, gegenAsset: 'ETH', gegenMenge: -0.01 },            // gekauft
    { asset: 'SFM', art: 'bestand', menge: 242899 },                                                // erfasster Anfangsbestand
    { asset: 'AI', art: 'einzahlung', menge: 4000011, chfWert: null },                              // nur ungefragter Eingang
    { asset: 'D2T', art: 'einzahlung', menge: 4093 },
    { asset: 'ETH', art: 'einzahlung', menge: 0.5, transferMit: 77 },                               // eigene Umbuchung
    { asset: 'ADA', art: 'staking', menge: 2, chfWert: 1.2 },                                       // Ertrag mit Wert
    { asset: 'XYZ', art: 'airdrop', menge: 1000, chfWert: 0 },                                      // Airdrop ohne Wert
    { asset: 'BATRI', art: 'einzahlung', menge: 50, einordnung: 'transfer' },                       // als Transfer eingeordnet
    { asset: 'SPAM', art: 'einzahlung', menge: 5, einordnung: 'ignorieren' },
    { asset: 'OUT', art: 'auszahlung', menge: -3 },                                                 // selbst weggeschickt
])
pruefe('Herkunft: Tausch', h.has('SOUTH'))
pruefe('Herkunft: Anfangsbestand', h.has('SFM'))
pruefe('Herkunft: Gegenseite eines Tauschs', h.has('ETH'))
pruefe('Herkunft: Umbuchung mit Gegenstück', h.has('ETH'))
pruefe('Herkunft: Ertrag mit Wert', h.has('ADA'))
pruefe('Herkunft: als Transfer eingeordnet', h.has('BATRI'))
pruefe('Herkunft: Abgang', h.has('OUT'))
pruefe('keine Herkunft: Eingang ohne Wert (AI, D2T)', !h.has('AI') && !h.has('D2T'))
pruefe('keine Herkunft: Airdrop ohne Wert', !h.has('XYZ'))
pruefe('keine Herkunft: ignoriert', !h.has('SPAM'))
pruefe('keine Herkunft: gar keine Bewegung (FIRE)', !h.has('FIRE'))
pruefe('Kleinschreibung egal', assetsMitHerkunft([{ asset: 'abc', art: 'kauf', menge: 1 }]).has('ABC'))

console.log(`Spam-Erkennung: ${ok} ok, ${fail} Fehler`)
if (fail) process.exit(1)
