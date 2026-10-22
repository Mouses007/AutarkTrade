/**
 * Selbsttest der Bewegungsform (Spot-Portfolio).
 *
 *   node server/portfolio/__selftest-normal.mjs
 *
 * Geprüft wird vor allem, was still danebengeht:
 *   - Vorzeichen: ein Verkauf mit positiver Menge verdoppelt den Bestand,
 *     statt ihn zu leeren — und sieht in der Liste trotzdem richtig aus.
 *   - Gebühren genau einmal: Bitunix/Pionex brutto (separat abziehen),
 *     Bitget netto (nicht abziehen), BTC steckt in der Netto-Wirkung.
 *   - Bitget-Tausch kommt als zwei Zeilen und muss EINE Bewegung werden.
 *   - Transfer-Paarung in beide Richtungen: was zusammengehört, wird gepaart;
 *     was nur ähnlich aussieht, bleibt getrennt.
 *   - Eingabefeld: Seeds und private Schlüssel werden abgelehnt.
 * Die Bitget-Zeilen sind die echten Antworten vom 22.10.2026 (gekürzt).
 */
import { ausBitgetSteuer, ausBitunixOrders, ausPionexFills, ausBitpandaOperationen, ausEvm, ausBtc, saldiere, ordneTransfers } from './normal.js'
import { erkenneEingabe } from '../../shared/portfolio-adresse.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))

console.log('\nBitget Steuer-Endpunkt (echte Zeilen)')
{
    const zeilen = [
        { id: '1', coin: 'USDC', spotTaxType: 'Deposit', amount: '158.96268', fee: '0', ts: '1767799000000', bizOrderId: 'a' },
        { id: '2', coin: 'USDC', spotTaxType: 'Consumption', amount: '-158.9626', fee: '0', balance: '0.00008', ts: '1767799658201', bizOrderId: 'x' },
        { id: '3', coin: 'USDT', spotTaxType: 'Gains', amount: '158.9943', fee: '0', balance: '158.9943', ts: '1767799658201', bizOrderId: 'x' },
        { id: '4', coin: 'USDT', spotTaxType: 'Transfer out', amount: '-158.9943', fee: '0', balance: '0', ts: '1767799960049', bizOrderId: 'y' },
        { id: '5', coin: 'USDT', spotTaxType: 'Airdrop Reward-A', amount: '0.29203827', fee: '0', ts: '1790872967564', bizOrderId: 'z' },
        { id: '6', coin: 'CRO', spotTaxType: 'Deposit', amount: '12635.6', fee: '0', ts: '1767793542106', bizOrderId: 'w' },
    ]
    const b = ausBitgetSteuer(zeilen)
    check('Consumption+Gains = eine Bewegung', b.filter((x) => x.externeId === 'x').length === 1 && b.length === 5, String(b.length))
    const t = b.find((x) => x.externeId === 'x')
    check('USDC→USDT ist ein Tausch (Geld → Geld), kein Kauf', t.art === 'tausch' && t.asset === 'USDT' && t.gegenAsset === 'USDC', t.art)
    check('Arten: Einzahlung, Umbuchung, Airdrop', b.find((x) => x.externeId === '1').art === 'einzahlung' && b.find((x) => x.externeId === '4').art === 'umbuchung' && b.find((x) => x.externeId === '5').art === 'airdrop')
    const s = saldiere(b)
    check('Saldo USDC = 0.00008', nah(s.get('USDC'), 0.00008), String(s.get('USDC')))
    check('Saldo USDT = Airdrop', nah(s.get('USDT'), 0.29203827), String(s.get('USDT')))
    check('Saldo CRO', nah(s.get('CRO'), 12635.6))
    check('Unbekannter Typ landet als „sonstiges", nicht im Nichts', ausBitgetSteuer([{ id: '9', coin: 'X', spotTaxType: 'Mystery', amount: '1', ts: '1' }])[0].art === 'sonstiges')
}

console.log('\nBitunix Spot-Orders (echte GRASS-Order)')
{
    const b = ausBitunixOrders([
        { orderId: 'o1', side: 1, dealVolume: '202.8', dealAmount: '323.324037', fee: '0.2263268259', feeCoin: 'USDT', base: 'GRASS', quote: 'USDT', utime: '2025-05-11T18:24:16.689006Z' },
        { orderId: 'o2', side: 1, dealVolume: '0', dealAmount: '0', fee: '0', feeCoin: 'USDT', base: 'GRASS', quote: 'USDT', utime: '2025-05-11T18:23:59Z' },
    ])
    check('Storno ohne Ausführung fällt weg', b.length === 1)
    check('side 1 = Verkauf, Menge negativ', b[0].art === 'verkauf' && b[0].menge === -202.8)
    const s = saldiere(b)
    check('Erlös netto = 323.324037 − Gebühr', nah(s.get('USDT'), 323.324037 - 0.2263268259))
    const k = ausBitunixOrders([{ orderId: 'k', side: 2, dealVolume: '1', dealAmount: '50', fee: '0.001', feeCoin: 'GRASS', base: 'GRASS', quote: 'USDT', utime: '2025-01-01T00:00:00Z' }])
    check('side 2 = Kauf, Gebühr in Basis abgezogen', k[0].art === 'kauf' && nah(saldiere(k).get('GRASS'), 0.999) && saldiere(k).get('USDT') === -50)
}

console.log('\nPionex Fills (echter BTC-Kauf)')
{
    const b = ausPionexFills([{ id: 110000059430, symbol: 'BTC_USDT', side: 'BUY', price: '88107.6', size: '0.00107118', fee: '0.00000053559', feeCoin: 'BTC', timestamp: 1766681599775 }])
    const s = saldiere(b)
    check('Kauf: BTC netto nach Gebühr', nah(s.get('BTC'), 0.00107118 - 0.00000053559))
    check('Kauf: USDT = −size×Preis', nah(s.get('USDT'), -0.00107118 * 88107.6))
}

console.log('\nBitpanda Operationen (Form der echten Antwort vom 23.10.2026)')
{
    const sym = new Map([['btc', 'BTC'], ['algo', 'ALGO'], ['chf', 'CHF'], ['eth', 'ETH'], ['fet', 'FET'], ['iota', 'IOTA'], ['miota', 'MIOTA']])
    const tx = (asset, flow, value, extra = {}) => ({ transaction_id: Math.random().toString(36), asset_id: asset === 'chf' ? undefined : asset, currency_id: asset === 'chf' ? 'chf' : undefined, flow, asset_amount: { value: String(value) }, credited_at: '2026-10-20T18:27:11Z', ...extra })
    const b = ausBitpandaOperationen([
        // Staking: Betrag brutto, 20 % Gebühr ZUSÄTZLICH abgezogen (belegt über asset_balance_after)
        { operation_id: 'r1', operation_type: 'reward', transactions: [tx('algo', 'INCOMING', '1.10803044', { fee_amount: { value: '0.22160609', asset_id: 'algo' }, wallet_owner: 'staking-service' })] },
        // Sparplan: CHF raus, BTC rein (Fiat über currency_id)
        { operation_id: 's1', operation_type: 'savings_plan', transactions: [tx('chf', 'OUTGOING', '50', { transaction_type: 'buy' }), tx('btc', 'INCOMING', '0.0007', { transaction_type: 'buy' })] },
        // Swap mit 4 Transaktionen: ETH → CHF → FET (Zwischenschritt hebt sich auf)
        { operation_id: 'w1', operation_type: 'swap', transactions: [tx('eth', 'OUTGOING', '0.1'), tx('chf', 'INCOMING', '300'), tx('chf', 'OUTGOING', '300'), tx('fet', 'INCOMING', '500')] },
        // Auszahlung mit Netzgebühr obendrauf
        { operation_id: 'a1', operation_type: 'withdrawal', transactions: [tx('btc', 'OUTGOING', '0.0005', { fee_amount: { value: '0.00001', asset_id: 'btc' } })] },
        // Fusion MIOTA → IOTA
        { operation_id: 'm1', operation_type: 'merger_crypto', transactions: [tx('miota', 'OUTGOING', '100'), tx('iota', 'INCOMING', '100')] },
        // Index-Kauf: CHF raus, drei Coins rein
        { operation_id: 'i1', operation_type: 'index_buy', transactions: [tx('chf', 'OUTGOING', '100'), tx('btc', 'INCOMING', '0.0005', { wallet_owner: 'bci-service' }), tx('eth', 'INCOMING', '0.01', { wallet_owner: 'bci-service' }), tx('fet', 'INCOMING', '10', { wallet_owner: 'bci-service' })] },
        // Gebühr (trading_premium) und Unbekanntes
        { operation_id: 'g1', operation_type: 'trading_premium', transactions: [tx('algo', 'OUTGOING', '0', { fee_amount: { value: '0.5', asset_id: 'algo' } })] },
        { operation_id: 'x1', operation_type: 'irgendwas_neues', transactions: [tx('algo', 'INCOMING', '2')] },
        // Sparplan-Lastschrift: nur die Transaktion sagt „deposit"
        { operation_id: 'l1', operation_type: 'savings_plan', transactions: [tx('chf', 'INCOMING', '50', { transaction_type: 'deposit' })] },
    ], sym)
    const s = saldiere(b)
    const r = b.find((x) => x.externeId === 'r1')
    check('Staking: Art staking, Menge = brutto − Gebühr', r.art === 'staking' && nah(r.menge, 1.10803044 - 0.22160609), String(r.menge))
    const k = b.find((x) => x.externeId === 's1')
    check('Sparplan: Kauf BTC gegen CHF', k.art === 'kauf' && k.asset === 'BTC' && k.gegenAsset === 'CHF' && k.gegenMenge === -50)
    const w = b.find((x) => x.externeId === 'w1')
    check('Swap über CHF: ein Tausch ETH → FET, Zwischenschritt weg', w.art === 'tausch' && w.asset === 'FET' && w.gegenAsset === 'ETH', JSON.stringify(w))
    check('Auszahlung: Gebühr zusätzlich', nah(b.find((x) => x.externeId === 'a1').menge, -0.00051))
    check('Fusion MIOTA → IOTA als Tausch', b.find((x) => x.externeId === 'm1').art === 'tausch')
    check('Index-Kauf: je Asset eine Zeile', b.filter((x) => x.externeId.startsWith('i1:')).length === 4)
    check('trading_premium = Gebühr', b.find((x) => x.externeId === 'g1').art === 'gebuehr')
    check('Unbekannter Typ → sonstiges', b.find((x) => x.externeId === 'x1').art === 'sonstiges')
    check('Sparplan-Lastschrift = Einzahlung', b.find((x) => x.externeId === 'l1').art === 'einzahlung')
    check('Saldo CHF = +50 − 50 − 100', nah(s.get('CHF'), -100))
    check('Saldo ALGO = Staking netto − Prämie + 2', nah(s.get('ALGO'), 1.10803044 - 0.22160609 - 0.5 + 2))
}

console.log('\nEVM')
{
    const ich = '0xAbC0000000000000000000000000000000000001'
    const b = ausEvm({
        adresse: ich, chainId: 1, nativ: 'ETH',
        txlist: [
            { hash: 'h1', timeStamp: '1700000000', from: '0xfeed', to: ich.toLowerCase(), value: '1000000000000000000', gasUsed: '21000', gasPrice: '1', isError: '0' },
            { hash: 'h2', timeStamp: '1700000100', from: ich.toLowerCase(), to: '0xrouter', value: '0', gasUsed: '100000', gasPrice: '10000000000', isError: '0' },
            { hash: 'h3', timeStamp: '1700000200', from: ich.toLowerCase(), to: '0xx', value: '500000000000000000', gasUsed: '21000', gasPrice: '10000000000', isError: '1' },
        ],
        tokentx: [
            { hash: 'h2', timeStamp: '1700000100', from: ich.toLowerCase(), to: '0xpool', value: '100000000', tokenDecimal: '6', tokenSymbol: 'USDC', contractAddress: '0xA0b8' },
            { hash: 'h2', timeStamp: '1700000100', from: '0xpool', to: ich.toLowerCase(), value: '2000000000000000000000', tokenDecimal: '18', tokenSymbol: 'UNI', contractAddress: '0x1f98' },
        ],
    })
    check('Eingang ETH ohne Gebühr für uns', b[0].art === 'einzahlung' && b[0].menge === 1 && !b[0].gebuehrMenge)
    const swap = b.find((x) => x.txHash === 'h2')
    check('Token raus + Token rein in einer Tx = Tausch', swap.art === 'tausch' && swap.asset === 'UNI' && swap.gegenAsset === 'USDC' && swap.gegenMenge === -100)
    check('Gas des Tauschs als Gebühr', nah(swap.gebuehrMenge, 0.001))
    const fehl = b.find((x) => x.txHash === 'h3')
    check('Fehlgeschlagene Tx: kein Wert, aber Gas', fehl.art === 'gebuehr' && fehl.menge === 0 && nah(fehl.gebuehrMenge, 0.00021))
    const s = saldiere(b)
    check('ETH-Saldo = 1 − Gas', nah(s.get('ETH'), 1 - 0.001 - 0.00021))
    check('Token je Kontrakt geführt', nah(s.get('UNI|0x1f98'), 2000))
}

console.log('\nBitcoin')
{
    const b = ausBtc([{ txid: 'a', zeit: 1, netto: 100000, gebuehr: 0 }, { txid: 'b', zeit: 2, netto: -50300, gebuehr: 300 }])
    check('Ausgang: Menge ohne Gebühr, Gebühr separat', b[1].menge === -0.0005 && b[1].gebuehrMenge === 0.000003)
    check('Saldo = Summe der Netto-Wirkungen', nah(saldiere(b).get('BTC'), 0.000497))
}

console.log('\nTransfers')
{
    const z = [
        { id: 1, ort: 'bitget', art: 'auszahlung', asset: 'BTC', menge: -0.5, zeit: 1000e3 },
        { id: 2, ort: 'ledger', art: 'einzahlung', asset: 'BTC', menge: 0.4998, zeit: 1000e3 + 1800e3 },
        { id: 3, ort: 'ledger', art: 'einzahlung', asset: 'BTC', menge: 0.4998, zeit: 1000e3 + 30 * 3600e3 },
        { id: 4, ort: 'bitget', art: 'auszahlung', asset: 'ETH', menge: -1, zeit: 5000e3, txHash: 'T' },
        { id: 5, ort: 'mm', art: 'einzahlung', asset: 'ETH', menge: 0.9, zeit: 9e12, txHash: 'T' },
        { id: 6, ort: 'bitget', art: 'auszahlung', asset: 'SOL', menge: -10, zeit: 1e6 },
        { id: 7, ort: 'bitget', art: 'einzahlung', asset: 'SOL', menge: 10, zeit: 1e6 + 60e3 },
        { id: 8, ort: 'pionex', art: 'auszahlung', asset: 'USDT', menge: -100, zeit: 1e6 },
        { id: 9, ort: 'mm', art: 'einzahlung', asset: 'USDT', menge: 150, zeit: 1e6 + 60e3 },
    ]
    const p = ordneTransfers(z)
    check('BTC: Abgang ↔ Eingang 30 min später gepaart', p.some((x) => x.raus === 1 && x.rein === 2 && !x.sicher))
    check('Zweiter Eingang 30 h später bleibt offen', !p.some((x) => x.rein === 3))
    check('Gleiche txHash = sicher, auch ausserhalb des Zeitfensters', p.some((x) => x.raus === 4 && x.rein === 5 && x.sicher))
    check('Gleicher Ort wird nicht mit sich selbst gepaart', !p.some((x) => x.raus === 6))
    check('Eingang grösser als Abgang wird nicht gepaart', !p.some((x) => x.raus === 8))
}

console.log('\nEingabefeld')
{
    check('zpub erkannt', erkenneEingabe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs').kette === 'btc')
    check('bc1q erkannt', erkenneEingabe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu').kette === 'btc')
    check('Legacy 1… erkannt', erkenneEingabe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA').kette === 'btc')
    check('0x… erkannt', erkenneEingabe('0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe').kette === 'evm')
    check('Solana erkannt', erkenneEingabe('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU').kette === 'sol')
    check('Seed abgelehnt', erkenneEingabe('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').grund === 'geheim')
    check('Privater Schlüssel (64 Hex) abgelehnt', erkenneEingabe('0x' + 'ab'.repeat(32)).grund === 'geheim')
    check('xprv abgelehnt', erkenneEingabe('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi').grund === 'geheim')
    check('WIF abgelehnt', erkenneEingabe('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ').grund === 'geheim')
    check('Tron: noch nicht unterstützt', erkenneEingabe('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW').grund === 'nichtUnterstuetzt')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
