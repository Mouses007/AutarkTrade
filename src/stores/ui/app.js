// UI: allgemeiner App-Zustand.
// Re-Exporte; die Werte leben in stores/app/* und stores/journal/*.
export { appMode, APP_MODES, privacyMode, kopiertesBild, currentUser, timeZones, queryLimit, abfrageGrenzeVorhanden, listeZuEnde, stepper, journalHatDaten, itemToEditId, currentDate, quill, speichernNoetig, windowIsScrolled, countdownTakt, countdownRest, tagesChartZoom, tradeDetailOffen, markierterEintrag, tagesSeite, tagesAbfrageGrenze } from '../app/rahmen.js'
export { bildSeite, bildAbfrageGrenze } from '../journal/screenshots.js'
