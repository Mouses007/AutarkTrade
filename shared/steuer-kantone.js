/**
 * Krypto in der Steuererklärung: was die 26 Kantone verlangen (Steuerperiode 2025).
 *
 * Quelle ist die Recherche vom 26.10.2026 („Krypto Steuerregeln Schweizer
 * Kantone“, ausserhalb des Repos), jede Angabe mit Fundstelle. Was die
 * gelesenen Dokumente nicht sagen, steht als `null` und in `unsicher` — nie
 * geraten. Ändert ein Kanton seine Praxis, ist DIESE Datei nachzuführen.
 *
 * Felder:
 *  - formular/rubrik/code: wo die Position hingehört (`code` nur, wenn der
 *    Kanton einen eigenen Krypto-Code kennt: ZG/AG „KR“, SO Ziff. 740, VD 420/410)
 *  - ersatzkurs: Kurs ohne ESTV-Kurs — 'plattform' (selbst benutzte),
 *    'gaengigste' (gängigste Börse), 'beides', 'verkehrswert', 'fremdwaehrung' (TI), null
 *  - kaufpreis: Kaufpreis als letzte Stufe zulässig? true | false (ausdrücklich
 *    keiner genannt) | null (nicht geregelt) | 'widerspruch'
 *  - mining: 'vermoegensertrag' | 'selbstaendig' | 'erwerb' | 'einzelfall' | 'widerspruch' | null
 *  - haltedauerMonate: Haltedauer im Kriterienkatalog (KS 36: 6; TG zitiert KS 8/2005: 12)
 *
 * Rein: kein Netz, keine DB — geteilt zwischen Server (Bericht, CSV) und Browser (Auswahl).
 */

const Q = (name, url, fassung) => ({ name, url, fassung })

export const KANTONE = [
    {
        kz: 'ZH', name: 'Zürich', formular: 'Wertschriften- und Guthabenverzeichnis (StA Form. 340)', rubrik: 'übrige Guthaben, mit Bezeichnung der Kryptowährung', code: null,
        software: 'ZHprivateTax (eSteuerauszug-Import)', ersatzkurs: 'gaengigste', kaufpreis: false,
        ertraege: null, ertragZeitpunkt: null, mining: 'selbstaendig', haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Kontoauszug der Wallet per Ende Steuerperiode'],
        hinweise: ['Fremdwährung zu ESTV-Devisenkursen'],
        quellen: [Q('Zürcher Steuerbuch Nr. 16.5', 'https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender/steuerbuch/steuerbuch-definition/zstb-16-5.html', '20.12.2017'), Q('Wegleitung 2025', 'https://www.volketswil.ch/public/upload/assets/13755/Wegleitung_2025.pdf?fp=1', 'PDF 16.01.2026 (Gemeindekopie)')],
        unsicher: ['Kolonne B / Gruppe 2 aus der Formularlogik abgeleitet', 'Steuerbuch 16.5 seit 2017 nicht nachgeführt'],
    },
    {
        kz: 'BE', name: 'Bern', formular: 'Wertschriftenverzeichnis (TaxMe)', rubrik: 'Sonstige noch nicht deklarierte Kapitalanlagen', code: null,
        software: 'TaxMe; bei vielen Coins eigene Liste hochladen', ersatzkurs: 'plattform', kaufpreis: false,
        ertraege: 'Staking, Lending, Liquidity Mining: Vermögensertrag (sofern nicht selbständig)', ertragZeitpunkt: 'Zufluss', mining: 'vermoegensertrag', haltedauerMonate: 6,
        gewerbs: 'eigene Umschreibung (planmässig, erheblicher Zeitaufwand, Fachkenntnis), ohne KS-36-Verweis',
        belege: ['separate Liste möglich'], hinweise: ['Wert in CHF zum Kurs des letzten Handelstags'],
        quellen: [Q('TaxInfo Kryptowährungen', 'https://www.taxinfo.sv.fin.be.ch/taxinfo/8d643a65-c059-4d5e-9933-86e1cd87559c?lang=de', '08.02.2024'), Q('Online-Wegleitung 2025', 'https://www.wegleitung.sv.fin.be.ch/de/start/np2025/wertschriften/diverse.html', '2025')],
        unsicher: ['«Formular 3» laut TaxInfo, am Formular nicht geprüft', 'TaxInfo nennt nur BTC/ETH/LTC als ESTV-Kurse (veraltet)'],
    },
    {
        kz: 'LU', name: 'Luzern', formular: 'Wertschriftenverzeichnis', rubrik: 'übriges Guthaben', code: null,
        software: null, ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'sämtliche Erträge: Vermögensertrag', ertragZeitpunkt: null, mining: 'selbstaendig', haltedauerMonate: 6, gewerbs: 'KS 36 für die Vorprüfung',
        belege: ['Wallet-Auszug', 'Bestände UND Veränderungen samt Herkunft', 'Börsen-/Bankauszüge, Tool-Berichte (Blockpit, Koinly, CoinTracking), Public Keys, Screenshots'],
        hinweise: ['Mining und Nodes «im Grundsatz» selbständig', 'Tool-Berichte werden als Beleg akzeptiert'],
        quellen: [Q('Steuerbuch Bd. 1 § 43 Nr. 2', 'https://steuerbuch.lu.ch/band1/vermoegenssteuer/kryptowaehrungen_und_digitale_vermoegenswerte_mit_besonderen_merkmalen', 'Stand 01.01.2025'), Q('SteuerPraxis 4/2024 Krypto', 'https://steuern.lu.ch/-/media/Steuern/Dokumente/SteuerBulletin/2024/SteuerPraxis202404Krypto.pdf?rev=b121707b41e44c81997ec13beef29e60', '22.02.2024')],
        unsicher: ['Code im Formular nicht bestätigt', 'Reihenfolge ESTV/Plattform im Steuerbuch nicht eindeutig'],
    },
    {
        kz: 'UR', name: 'Uri', formular: 'Formular 2 (Wertschriftenverzeichnis)', rubrik: 'Werte ohne Verrechnungssteuer: «Bestände an Kryptowährungen»', code: null,
        software: 'eTax.UR', ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: ['nur ESTV-Kursliste genannt, keine Ersatzregel'],
        quellen: [Q('Wegleitung 2025', 'https://www.ur.ch/_docn/437558/np_wegltgsteuern2025.pdf', 'PDF 29.12.2025')],
        unsicher: ['keine krypto-spezifischen Regeln zu Ersatzkurs, Belegen, Erträgen'],
    },
    {
        kz: 'SZ', name: 'Schwyz', formular: 'Formular 2 «Wertschriften- und Guthabenverzeichnis»', rubrik: null, code: null,
        software: 'eTax.SZ (ESTV-Kursliste integriert)', ersatzkurs: 'verkehrswert', kaufpreis: null,
        ertraege: 'Staking Rewards, Mining-Erträge und sonstige Gutschriften sind steuerbar', ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: ['Steuerauszüge; bei ausländischen Depots detaillierte Jahresend- und Ertragsaufstellung'], hinweise: [],
        quellen: [Q('Wegleitung 2025, S. 10', 'https://www.sz.ch/public/upload/assets/84900/Wegleitung_zur_Steuererklaerung_2025.pdf?fp=1', 'PDF 18.02.2026')],
        unsicher: ['keine Rubrik, kein Code genannt', 'Mining: Einordnung (Vermögen/Erwerb) offen'],
    },
    {
        kz: 'OW', name: 'Obwalden', formular: 'Wertschriftenverzeichnis (eTax)', rubrik: 'Übrige Guthaben, Vermögensart «Kryptowährungen»; andere Token: «Übriges Guthaben»', code: null,
        software: 'eTax Web OW (eSteuerauszug per Barcode-PDF)', ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'sämtliche Erträge: Vermögensertrag', ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: 'KS 36',
        belege: ['Wallet-Auszug mit sichtbarem Datum 31.12.'], hinweise: ['Ersatzkurs: Plattform, sonst coinmarketcap.com, sonst Kaufpreis CHF', 'Checkbox «Ohne Verrechnungssteuer»'],
        quellen: [Q('Wegleitung 2025, S. 26–27', 'https://www.ow.ch/_docn/447067/OW-#1819049-v2-Wegleitung_2025.PDF', '22.04.2026')],
        unsicher: [],
    },
    {
        kz: 'NW', name: 'Nidwalden', formular: 'Formular WV (Wertschriftenverzeichnis)', rubrik: null, code: null,
        software: 'eTax Nidwalden', ersatzkurs: 'verkehrswert', kaufpreis: null,
        ertraege: 'Staking aus Investoren-Pools, Airdrops, Zahlungen aus Anlage-Token: Ertrag aus beweglichem Vermögen', ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: ['detaillierte Steuerauszüge'], hinweise: ['nicht kotiert: Verkehrswert, ersatzweise letzter bekannter Steuerwert'],
        quellen: [Q('Wegleitung 2025', 'https://www.steuern-nw.ch/app/uploads/2025/03/a_NW_2025_Wegleitung_natuerliche-Personen.pdf', 'PDF 11.03.2025')],
        unsicher: ['zum Krypto-Bestand keine ausdrückliche Regel'],
    },
    {
        kz: 'GL', name: 'Glarus', formular: 'Formular 2 (Wertschriftenverzeichnis)', rubrik: 'Kolonne B: andere Guthaben ohne VSt (u.a. virtuelle Zahlungsmittel / Kryptowährungen)', code: null,
        software: 'eTax.GL', ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: 'gewerbsmässiger Wertpapierhandel allgemein',
        belege: ['Auszug der digitalen Wallet (Jahresendkurs)'], hinweise: [],
        quellen: [Q('Wegleitung 2025', 'https://www.gl.ch/public/upload/assets/59619/01%20Wegleitung%202025.pdf?fp=1', 'PDF 29.12.2025')],
        unsicher: ['Ersatzkurs ohne ESTV nicht geregelt'],
    },
    {
        kz: 'ZG', name: 'Zug', formular: 'Formular WV (Wertschriften- und Guthabenverzeichnis)', rubrik: 'Spalte «Art/Bezeichnung»', code: 'KR',
        software: 'eTax.zug', ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'Staking (Validator, Nominator): Vermögensertrag, Rubrik B, pro Währung kumuliert', ertragZeitpunkt: 'Tag des rechtlichen Anspruchs', mining: 'widerspruch', haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Ausdruck der Jahresendbestände im Wallet'], hinweise: ['Steuern in BTC/ETH zahlbar (bis CHF 1.5 Mio.)', 'Webseite nennt CoinMarketCap als Ersatzkurs, Merkblatt die eigene Plattform', 'Umrechnung mit Oanda'],
        quellen: [Q('Merkblatt Kryptowährungen', 'https://cdn.zg.ch/dam/jcr:41a38088-f743-4802-ac01-4d90c742f47f/Merkblatt-Kryptow%C3%A4hrungen%20def.%2022.07.2022.pdf', '22.07.2022'), Q('Formular WV 2025', 'https://cdn.zg.ch/dam/jcr:f137a2ab-b924-490c-bb1d-967d55659e0e/Formular_WV_25_A4.pdf', '2025')],
        unsicher: ['Mining: Merkblatt = Erwerb, Webseite = Vermögensertrag'],
    },
    {
        kz: 'FR', name: 'Freiburg', formular: 'Beilage 01 «Verzeichnis der Wertschriften»', rubrik: 'lit. c (Codes 3.210–3.220), nicht Code 3.230', code: null,
        software: 'FriTax', ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: ['allgemein ESTV-Kursliste per 31.12.'],
        quellen: [Q('Allgemeine Wegleitung 2025', 'https://www.fr.ch/sites/default/files/2026-05/allgemeine-wegleitung-zur-steuererklarung.pdf?v=1778497822', '2025')],
        unsicher: ['keine krypto-spezifische Bewertungs- oder Ertragsregel'],
    },
    {
        kz: 'SO', name: 'Solothurn', formular: 'Steuererklärung', rubrik: 'ertragslose Krypto: Ziffer 740 «übrige Vermögenswerte»', code: '740',
        software: 'eTax SO (Kursliste integriert)', ersatzkurs: 'gaengigste', kaufpreis: null,
        ertraege: null, ertragZeitpunkt: null, mining: 'selbstaendig', haltedauerMonate: 6, gewerbs: 'KS 36 (Stand 2018)',
        belege: ['Wallet-Ausdruck per Ende Steuerperiode'], hinweise: ['Fremdwährung zu ESTV-Devisenkursen'],
        quellen: [Q('Wegleitung 2025, S. 36', 'https://so.ch/fileadmin/internet/fd/fd-ksta/pdf/np/ste/2025_ordentlich/120_Wegl_NP_SO_2025_HA_DEF_bf.pdf', 'PDF 10.02.2026')],
        unsicher: ['ertragbringende Krypto vermutlich im Wertschriftenverzeichnis (unbestätigt)', 'Kaufpreis und Mining nur aus RRB 2018'],
    },
    {
        kz: 'BS', name: 'Basel-Stadt', formular: 'Formular W (Wertschriftenverzeichnis)', rubrik: 'Rubrik B «Kryptowährungen»', code: null,
        software: 'BalTax 2025 mit eigenem Krypto-Dialog', ersatzkurs: 'beides', kaufpreis: true,
        ertraege: 'Staking, Airdrops, Lending/Yield Farming, Mining: Vermögensertrag, Rubrik B', ertragZeitpunkt: 'Tag des rechtlichen Anspruchs', mining: 'vermoegensertrag', haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Wallet-Ausdruck', 'detaillierte Aufstellung mit Bezeichnung der Kryptowährungen', 'Kaufquittung, wenn der Kaufpreis gilt'], hinweise: ['Geschäftsvermögen in Ziff. 840–865'],
        quellen: [Q('Merkblatt Kryptowährungen', 'https://media.bs.ch/original_file/8c06838fade72c9930ac1c73967eca9ad0e70707/18023-mb-np-kryptowaehrungen-cd-bf.pdf', '07.01.2026, gültig ab 2025')],
        unsicher: [],
    },
    {
        kz: 'BL', name: 'Basel-Landschaft', formular: 'Wertschriften- und Guthabenverzeichnis', rubrik: 'übrige Guthaben, Bezeichnung «Kryptowährungen»', code: null,
        software: 'E-Tax BL', ersatzkurs: 'plattform', kaufpreis: 'widerspruch',
        ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: 'Kriterien des Wertschriftenhandels sinngemäss',
        belege: ['Wallet-Ausdruck', 'Kaufquittung'], hinweise: [],
        quellen: [Q('FAQ Kryptowährungen', 'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/steuerverwaltung/faq/kryptowaehrungen-bitcoins-1', 'undatiert'), Q('Wegleitung 2025', 'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/steuerverwaltung', '31.07.2025')],
        unsicher: ['FAQ: ESTV → Plattform → Einstand; Wegleitung: ESTV → direkt Kaufpreis'],
    },
    {
        kz: 'SH', name: 'Schaffhausen', formular: 'Wertschriftenverzeichnis', rubrik: 'übrige Guthaben, Bezeichnung und Steuerwert', code: null,
        software: null, ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'Mining, Staking, Lending, Masternodes: einkommenssteuerpflichtig', ertragZeitpunkt: 'Tageskurs des Eingangs', mining: null, haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Wallet-Ausdruck (u.U. Screenshot)', 'Gutschriftsbelege für Erträge'], hinweise: [],
        quellen: [Q('Praxistipp Kryptowährungen / Token', 'https://sh.ch/CMS/get/file/487a47be-b23d-4573-9a04-db5b7c133453', '12/2021')],
        unsicher: ['keine Wegleitung 2025 mit Krypto-Hinweis gefunden'],
    },
    {
        kz: 'AR', name: 'Appenzell Ausserrhoden', formular: 'Formular 2 (Wertschriftenverzeichnis)', rubrik: '«inkl. Kryptowährungen wie Bitcoin, Ether» (Stand 2023)', code: null,
        software: null, ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: [],
        quellen: [Q('Wegleitung 2023', 'https://ar.ch/fileadmin/user_upload/Departement_Finanzen/Steuerverwaltung/Bibliothek/2023/Formulare/AR_NP_Wegleitung_2023_DEF.pdf', '2023')],
        unsicher: ['Wegleitung 2025 nicht gefunden — Stand 2025 unbekannt'],
    },
    {
        kz: 'AI', name: 'Appenzell Innerrhoden', formular: 'Formular 2 (Wertschriftenverzeichnis)', rubrik: 'sonstige Kapitalanlagen, Spalte B', code: null,
        software: 'eTax.AI (Kursliste integriert)', ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: ['Wegleitung 2025 erwähnt Krypto nicht'],
        quellen: [Q('Wegleitung 2025', 'https://publisher-ai.webcloud7.ch/themen/steuern/steuerformulare/steuererklaerung-fuer-natuerliche-personen-2025/wegleitung-steuererklaerung-2025/@@download/file/Wegleitung_2025.pdf', 'PDF 17.10.2025')],
        unsicher: ['Rubrik aus der Formularlogik abgeleitet'],
    },
    {
        kz: 'SG', name: 'St. Gallen', formular: 'Wertschriften- und Guthabenverzeichnis', rubrik: 'eTaxes: Art «Kassenobligationen, Termingeldkonti, übriges Guthaben»', code: null,
        software: 'eTaxes SG', ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'Staking (Validator, Nominator): Vermögensertrag, Rubrik B, pro Währung kumuliert', ertragZeitpunkt: 'Tag des Rechtsanspruchs', mining: 'einzelfall', haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Ausdruck der Jahresendbestände'], hinweise: ['CoinMarketCap als Anhaltspunkt'],
        quellen: [Q('Kryptowährungen', 'https://www.sg.ch/steuern-finanzen/steuern/kryptowaehrungen.html', 'Stand 03.03.2026')],
        unsicher: [],
    },
    {
        kz: 'GR', name: 'Graubünden', formular: 'Formular 2 (Wertschriftenverzeichnis)', rubrik: 'Kryptowährungen ausdrücklich genannt; Ertrag Spalte B', code: null,
        software: 'SofTax GR', ersatzkurs: 'gaengigste', kaufpreis: true,
        ertraege: 'Mining, Staking, Liquidity Mining, Lending: Vermögensertrag (sofern nicht selbständig); Gewinnungskosten abziehbar', ertragZeitpunkt: 'Zufluss', mining: 'vermoegensertrag', haltedauerMonate: 6, gewerbs: 'KS 36 per analogia',
        belege: ['Ausdruck der Jahresendbestände'], hinweise: ['CoinMarketCap als Anhaltspunkt'],
        quellen: [Q('Praxis 054-01', 'https://www.gr.ch/IT/istituzioni/amministrazione/dfg/stv/dokumentation/praxis/EinkommenVermgen/054-01-i.pdf', '01.12.2024'), Q('Wegleitung 2025', 'https://www.gr.ch/DE/institutionen/verwaltung/dfg/stv/steuererklaerung/einkommens_und_vermoegenssteuer/WegleitungenMerkbltter/Wegleitung%202025%20Prim%c3%a4rsteuerpflichtige.pdf', '2025')],
        unsicher: ['Praxis nur auf Italienisch gefunden', 'Ertrag in Spalte B abgeleitet'],
    },
    {
        kz: 'AG', name: 'Aargau', formular: 'Form. 101.05 (Wertschriftenverzeichnis), Beiblatt 101.05a', rubrik: 'erste Spalte', code: 'KR',
        software: 'eTAX AARGAU: ESTV-Coins hinterlegt (nur Anzahl), sonst Art «Andere»', ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: null, ertragZeitpunkt: 'Zufluss', mining: 'erwerb', haltedauerMonate: 6, gewerbs: 'KS 36 sinngemäss',
        belege: ['Wallet-Ausdruck der Jahresendbestände'], hinweise: ['CoinMarketCap als Anhaltspunkt'],
        quellen: [Q('Kryptowährungen', 'https://www.ag.ch/de/verwaltung/dfr/steuern/natuerliche-personen/steuererklaerung-easytax/kryptowaehrungen', 'undatiert'), Q('Wegleitung 2025', 'https://www.ag.ch/media/kanton-aargau/dfr/dokumente/steuern/natuerliche-personen/steuererklaerung/wegleitung-zur-steuererkl-rung-2025-kanton-aargau.pdf', 'PDF 16.01.2026')],
        unsicher: ['Staking, Lending, Airdrops nicht genannt'],
    },
    {
        kz: 'TG', name: 'Thurgau', formular: 'Wertschriften- und Guthabenverzeichnis', rubrik: 'übrige Guthaben', code: null,
        software: null, ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: null, ertragZeitpunkt: null, mining: 'selbstaendig', haltedauerMonate: 12, gewerbs: '6 Kriterien, Haltedauer mindestens 1 Jahr (Wortlaut KS 8/2005)',
        belege: ['Wallet-Ausdruck der Jahresendbestände'], hinweise: ['CoinMarketCap «nicht verbindlich»', 'für die direkte Bundessteuer gilt KS 36 (6 Monate)'],
        quellen: [Q('StP 43 Nr. 1 (Bewertung Vermögen)', 'https://steuerpraxis.tg.ch/steuerpraxis/2025-10/stp-43-nr-1-bewertung-vermogen', 'Ausgabe 2025-10'), Q('StP 20 Nr. 2 (Gewerbsmässiger Handel)', 'https://steuerpraxis.tg.ch/steuerpraxis/2026-09/stp-20-nr-2-gewerbsmassiger-handel-mit-wertschriften-gold-devisen-oder-kryptowahrungen', 'Ausgabe 2026-09')],
        unsicher: ['Weisung beruft sich zugleich auf KS 36 — ob 1 Jahr bewusst gilt, ist offen'],
    },
    {
        kz: 'TI', name: 'Tessin', formular: 'Modulo 2 «Elenco dei titoli» (bevorzugt), subsidiär Modulo 1 Numerario (Ziff. 29.2)', rubrik: null, code: null,
        software: 'eTax PF', ersatzkurs: 'fremdwaehrung', kaufpreis: false,
        ertraege: 'Krypto-Entgelte als Einkommen in Fremdwährung', ertragZeitpunkt: 'Tageskurs oder Durchschnittskurs', mining: 'einzelfall', haltedauerMonate: 6, gewerbs: 'KS 36',
        belege: ['«autocertificazione», z. B. Bildschirmausdruck der Plattform'], hinweise: ['Kurs in USD/EUR per Ende Steuerperiode, umgerechnet in CHF', 'Mining: Rückfrage bei der Verwaltung'],
        quellen: [Q('Prassi «Trattamento fiscale delle criptovalute»', 'https://www4.ti.ch/fileadmin/DFE/DC/DOC-PRASSI/2018_Trattamento_fiscale_delle_criptovalute.pdf', '28.02.2018')],
        unsicher: ['Praxis von 2018; Istruzioni 2025 erwähnen Krypto nicht'],
    },
    {
        kz: 'VD', name: 'Waadt', formular: 'Papier: Hauptformular; VaudTax: État des titres', rubrik: 'Papier: Numéraire … crypto-monnaies; VaudTax: comptes … crypto-monnaies', code: '420 (Papier) / 410 (VaudTax)',
        software: 'VaudTax mit Krypto-Pfad', ersatzkurs: null, kaufpreis: false,
        ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: ['Krypto steht NICHT in Annexe 01 (Papier)'],
        quellen: [Q('Instructions générales 2025 (21001)', 'https://www.vd.ch/fileadmin/user_upload/organisation/dfin/aci/fichiers_pdf/21001_2025.pdf', 'Version 03.26')],
        unsicher: ['in welchen Code VaudTax überträgt, ist offen', 'kein Ersatzkurs geregelt'],
    },
    {
        kz: 'VS', name: 'Wallis', formular: 'Beilage 3 «Wertschriftenverzeichnis»', rubrik: 'eigene Zeile «Kryptowährungen» in der Steuerwerttabelle', code: null,
        software: 'VSTax', ersatzkurs: 'plattform', kaufpreis: false,
        ertraege: 'Mining, Staking, Liquidity Mining, Lending, alle passiven Einkünfte: Vermögensertrag', ertragZeitpunkt: null, mining: 'vermoegensertrag', haltedauerMonate: 6, gewerbs: null,
        belege: [], hinweise: [],
        quellen: [Q('Wegleitung 2025', 'https://www.vs.ch/documents/d/scc/guide_2025_d_final', '2025')],
        unsicher: [],
    },
    {
        kz: 'NE', name: 'Neuenburg', formular: null, rubrik: 'fortune mobilière diverse (nur Sekundärquelle)', code: null,
        software: null, ersatzkurs: null, kaufpreis: null, ertraege: null, ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: null,
        belege: ['Vermögensbestätigung per 31.12. (Sekundärquelle)'], hinweise: [],
        quellen: [Q('rift.fr (Sekundärquelle)', 'https://rift.fr/blog/fiscalite-crypto-suisse-2026-guide-romands', '2026')],
        unsicher: ['keine amtliche Quelle gefunden', 'Softwarename widersprüchlich'],
    },
    {
        kz: 'GE', name: 'Genf', formular: 'État des titres', rubrik: 'bei vielen Coins separate Liste', code: null,
        software: null, ersatzkurs: 'plattform', kaufpreis: true,
        ertraege: 'Mining, Staking, Liquidity Mining, Lending, Airdrops: Vermögensertrag', ertragZeitpunkt: null, mining: 'vermoegensertrag', haltedauerMonate: 6, gewerbs: 'Folgen beschrieben, keine eigenen Kriterien',
        belege: ['separate Liste möglich'], hinweise: ['Kaufpreis = «valeur d\'acquisition»'],
        quellen: [Q('Imposition des particuliers détenant des crypto-monnaies', 'https://www.ge.ch/imposition-crypto-monnaies-monnaies-virtuelles/imposition-particuliers-detenant-crypto-monnaies', '11.11.2025')],
        unsicher: ['Formularnummer und GeTax-Pfad nicht genannt'],
    },
    {
        kz: 'JU', name: 'Jura', formular: 'Formule fiscale n°5 (état des titres)', rubrik: 'Hinweis im Guide «sous code 740»', code: '740',
        software: 'JuraTax', ersatzkurs: 'gaengigste', kaufpreis: true,
        ertraege: 'Verweis auf das ESTV-Arbeitspapier', ertragZeitpunkt: null, mining: null, haltedauerMonate: 6, gewerbs: 'KS 36 (6 Monate, keine Fremdfinanzierung)',
        belege: ['Positionsauszüge zu verschiedenen Zeitpunkten im Jahr'], hinweise: ['Ersatzkurs: anerkannter Exchange, «au minimum au prix d\'acquisition»'],
        quellen: [Q('Question écrite n° 3429', 'https://www.jura.ch//Htdocs/Files/v/860e4a13206e62099a1293200f5f8ef8760383d60c0781f1bd09d0927ef0a4cf.pdf/QE-no-3429.pdf', '11.01.2022')],
        unsicher: ['nur Regierungsantwort 2022, Instructions 2025 nicht gelesen'],
    },
]

const JE_KZ = new Map(KANTONE.map((k) => [k.kz, k]))

/** @returns {object|null} Kanton nach Kürzel (gross/klein egal). */
export function kanton(kz) {
    return JE_KZ.get(String(kz ?? '').toUpperCase()) || null
}

/** Darf der Kanton den Kaufpreis als Steuerwert nehmen, wenn kein Kurs vorliegt? */
export function kaufpreisErlaubt(kz) {
    return kanton(kz)?.kaufpreis === true
}

/** Haltedauer-Grenze (Monate) des Kriterienkatalogs; ohne Kanton KS 36. */
export function haltedauerMonate(kz) {
    return kanton(kz)?.haltedauerMonate ?? 6
}

export const ERSATZKURS_TEXT = {
    plattform: 'Jahresendkurs der Plattform, auf der gehandelt wurde',
    gaengigste: 'Jahresendkurs der gängigsten Börse',
    beides: 'gängigste Börse oder eigene Plattform',
    verkehrswert: 'Verkehrswert',
    fremdwaehrung: 'Kurs in USD/EUR per Ende Steuerperiode, in CHF umgerechnet',
}

export const MINING_TEXT = {
    vermoegensertrag: 'Vermögensertrag',
    selbstaendig: 'selbständige Erwerbstätigkeit',
    erwerb: 'Erwerbseinkommen (selbständig oder unselbständig)',
    einzelfall: 'je nach Umständen / Rückfrage',
    widerspruch: 'widersprüchlich (Merkblatt ≠ Webseite)',
}
