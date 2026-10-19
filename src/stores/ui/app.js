// UI: allgemeiner App-Zustand.
// Re-Exporte; die Werte leben in stores/app/* und stores/journal/*.
export { appMode, APP_MODES, privacyMode, kopiertesBild, currentUser, timeZones, queryLimit, queryLimitExistingTrades, endOfList, noData, stepper, hasData, itemToEditId, currentDate, quill, saveButton, windowIsScrolled, countdownInterval, countdownSeconds, dailyChartZoom, legacy, modalDailyTradeOpen, selectedItem, dailyPagination, dailyQueryLimit } from '../app/rahmen.js'
export { screenshotsPagination, screenshotsQueryLimit } from '../journal/screenshots.js'
