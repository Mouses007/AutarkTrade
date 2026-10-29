/**
 * Voller Name eines Coins zum Kürzel — für den Steuerbericht, damit das
 * Steueramt nicht raten muss, was „VXV“ oder „CSPR“ ist.
 *
 * Vorrang hat der Name aus der ESTV-Kursliste (`portfolio_steuerkurse.name`).
 * Diese Liste deckt Coins ab, die die ESTV nicht führt. Aufgenommen ist nur,
 * was eindeutig ist: ein Kürzel, das mehrere Projekte tragen, bleibt ohne
 * Namen (lieber leer als falsch). Token mit fremdem Vertrag bekommen nie einen
 * Namen von hier — sie heissen nur so wie der Coin.
 */
export const COIN_NAMEN = {
    AAVE: 'Aave', ADA: 'Cardano', AGIX: 'SingularityNET', ALGO: 'Algorand', ATOM: 'Cosmos', AVAX: 'Avalanche',
    AXS: 'Axie Infinity', BCH: 'Bitcoin Cash', BEAM: 'Beam', BERA: 'Berachain', BEST: 'Bitpanda Ecosystem Token',
    BNB: 'BNB', BNT: 'Bancor', BORG: 'SwissBorg', BRETT: 'Brett', BSV: 'Bitcoin SV', BTC: 'Bitcoin', BTT: 'BitTorrent',
    BUSD: 'Binance USD', CAKE: 'PancakeSwap', CGPT: 'ChainGPT', CHF: 'Schweizer Franken', CHSB: 'SwissBorg (CHSB)',
    CHZ: 'Chiliz', CRO: 'Cronos', CSPR: 'Casper Network', DASH: 'Dash', DOGE: 'Dogecoin', DOT: 'Polkadot', EOS: 'EOS',
    EPIK: 'Epik Prime', ETC: 'Ethereum Classic', ETH: 'Ethereum', ETHW: 'Ethereum PoW', EUR: 'Euro',
    FET: 'Fetch.ai (Artificial Superintelligence Alliance)', FIL: 'Filecoin', FITFI: 'Step App', FTM: 'Fantom',
    FTT: 'FTX Token', GMT: 'STEPN', GRASS: 'Grass', GRT: 'The Graph', HT: 'Huobi Token', ICP: 'Internet Computer',
    ILV: 'Illuvium', IMX: 'Immutable', IOST: 'IOST', IOTA: 'IOTA', IOTX: 'IoTeX', KAS: 'Kaspa', KDA: 'Kadena',
    KMD: 'Komodo', LINK: 'Chainlink', LTC: 'Litecoin', LUNA: 'Terra', LUNC: 'Terra Classic', LYX: 'LUKSO',
    MATIC: 'Polygon (MATIC)', MIOTA: 'IOTA', NEO: 'NEO', OCEAN: 'Ocean Protocol', PAN: 'Pantos', POL: 'Polygon (POL)',
    RENDER: 'Render', SAND: 'The Sandbox', SHIB: 'Shiba Inu', SMR: 'Shimmer', SOL: 'Solana', STETH: 'Lido Staked Ether',
    THETA: 'Theta Network', TRX: 'TRON', UNI: 'Uniswap', USD: 'US-Dollar', USDC: 'USD Coin', USDT: 'Tether',
    VET: 'VeChain', VIRTUAL: 'Virtuals Protocol', VRA: 'Verasity', VTHO: 'VeThor Token', VXV: 'Vectorspace AI',
    WAVES: 'Waves', WIF: 'dogwifhat', WSI: 'WeSendit', XAG: 'Silber', XAU: 'Gold', XEM: 'NEM', XLM: 'Stellar',
    XMR: 'Monero', XRP: 'XRP', XTZ: 'Tezos', YFI: 'yearn.finance', YGG: 'Yield Guild Games', ZEC: 'Zcash', ZIL: 'Zilliqa',
}

/**
 * @param {string} asset
 * @param {Map<string, string>} [estv]  Kürzel → Name aus der ESTV-Kursliste
 * @param {boolean} [token]  fremder Vertrag: kein Name
 */
export function coinName(asset, estv = new Map(), token = false) {
    if (token) return null
    const a = String(asset || '').toUpperCase()
    return estv.get(a) || COIN_NAMEN[a] || null
}
