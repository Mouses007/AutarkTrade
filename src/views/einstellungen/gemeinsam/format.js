/** Byte-Anzeige — geteilt von Live-Recorder und Speicherverbrauch. */
export const fmtBytes = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB'
    : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
    : b >= 1024 ? (b / 1024).toFixed(0) + ' kB' : b + ' B'
