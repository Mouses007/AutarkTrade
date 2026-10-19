/**
 * Übergangsmodul aus dem früheren `addTrades.js` (S3, 19.10.2026).
 *
 * Hier steht nur noch, was die Oberfläche tatsächlich aufruft: die Vorschau
 * und das Speichern des API-Imports in `AddTrades.vue`, Blotter/P&L für
 * `trades.js` und die MFE-/OHLCV-Pfade von `Daily.vue` und
 * `AddExcursions.vue`. CSV-Import und der alte Ausführungs-Import sind
 * gelöscht. Der Inhalt ist TradeNote-abgeleitet und wird in S7/S8
 * clean-room ersetzt (LIZENZ-PLAN.md) — bis dahin bewusst unverändert,
 * abgesichert durch `__selftest-mfe-pfade.mjs` und `__selftest-journal.mjs`.
 */
import { spinnerLoadingPage, timeZoneTrade, queryLimitExistingTrades } from '../stores/ui.js'
import { selectedBroker } from '../stores/filters.js'
import { filteredTradesTrades, blotter, pAndL, tradeExcursionId, executions, tradeId, trades, gotExistingTradesArray, existingTradesArray, marketCloseTime } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'
import { useDateTimeFormat } from './formatters.js'
import { dbFind, dbCreate } from './db.js'

/* MODULES */
import dayjs from './dayjs-setup.js'
import _ from 'lodash'
import axios from 'axios'
/*
 * PapaParse wird NICHT statisch importiert.
 *
 * Diese Datei haengt ueber `trades.js` <- `utils.js` <- `layouts/Dashboard.vue`
 * am Router und landete damit im Start-Bundle jeder Seite — gemessene 37 kB
 * gzip fuer einen CSV-Parser, den nur die OHLCV-Einlesung (Databento-CSV)
 * braucht. Der dynamische Import laedt ihn beim ersten Gebrauch nach.
 */
let PapaModul = null
async function holePapa() {
    if (!PapaModul) {
        const m = await import('papaparse')
        PapaModul = m.default || m
    }
    return PapaModul
}

let tradedSymbols = []
let tradedStartDate = null
let tradedEndDate = null
let ohlcv = []
let mfePrices = []

/****************************
 * TRADES
 ****************************/
export async function useGetExistingTradesArray(param99, param0) {
    console.log(" -> Getting existing trades for filter")

    existingTradesArray.length = 0 // reinitialize

    return new Promise(async (resolve, reject) => {
        try {
            const results = await dbFind("trades", {
                descending: "dateUnix",
                limit: queryLimitExistingTrades.value
            })
            for (let i = 0; i < results.length; i++) {
                // Store date strings (YYYY-MM-DD) instead of dateUnix to avoid
                // timezone mismatch between CET and UTC imports
                existingTradesArray.push(results[i].date)
            }
            gotExistingTradesArray.value = true
            console.log(" -> Finished getting existing trades for filter")
            resolve()
        } catch (error) {
            throw new Error('Error useGetExistingTradesArray ' + error);
        }
    })
}

export const useCreateOHLCV = (param, param2) => {
    //console.log(" param "+JSON.stringify(param))
    return new Promise(async (resolve, reject) => {
        const Papa = await holePapa()
        let papaParse = Papa.parse(param, { header: true })
        let tempArray = papaParse.data
        //console.log(' tempArray ' + JSON.stringify(tempArray))
        for (let index = 0; index < tempArray.length; index++) {
            const element = tempArray[index];
            if (element.ts_event) {

                //console.log(" ts_event " + element.ts_event)
                let NYTime = dayjs.tz(element.ts_event, "UTC").tz(timeZoneTrade.value).unix() // telling it's UTC time and converting to trade TZ

                let temp2 = {}
                temp2.v = Number(element.volume)
                temp2.o = Number(element.open)
                temp2.c = Number(element.close)
                temp2.h = Number(element.high)
                temp2.l = Number(element.low)
                temp2.t = NYTime * 1000
                param2.ohlcv.push(temp2)

            }

            if ((index + 1) === tempArray.length) {
                ohlcv.push(param2) // this is used for when adding trades
                //console.log(" -> ohlcv " + JSON.stringify(ohlcv))
                resolve(param2) // resolving only param2, used for daily.vue (because I just want to get back the created OHLC, not the full / existing ohlcv array)
            }

        }
    })
}

export const useGetOHLCV = (param, param2, param3, param4, param5) => { //param=databento/polygon, param2=api or other, param3+ is used for AddExcursions: param3=tradedSymbols, param4=tradedStartDate, param5=tradedEndDate
    return new Promise(async (resolve, reject) => {
        console.log("\nGETTING OHLCV from " + param)
        
        if (param3) tradedSymbols = param3
        if (param4) tradedStartDate = param4
        if (param5) tradedEndDate = param5
        
        //spinnerLoadingPageText.value = "Getting OHLCV"
        console.log(" Traded Symbols " + JSON.stringify(tradedSymbols))
        ohlcv.length = 0 // reinitialize, for API

        

        const asyncLoop = async () => {
            for (let i = 0; i < tradedSymbols.length; i++) { // I think that async needs to be for instead of foreach
                let temp = {}
                temp.symbol = tradedSymbols[i].symbol
                let databentoSymbol = temp.symbol
                let stype_in = "raw_symbol"

                console.log(" -> From date " + tradedStartDate)
                console.log(" -> To " + tradedEndDate)
                //let currentDateYesterday = dayjs().tz(timeZoneTrade.value).subtract(1, 'day').unix()
                //console.log(" currentDateYesterday "+currentDateYesterday)
                let toDate = dayjs(tradedEndDate * 1000).endOf('day').unix()
                //if (toDate > currentDateYesterday) toDate = dayjs(currentDateYesterday * 1000).subtract(7, 'hour').unix()
                console.log(" -> To date " + toDate)

                if (param === "databento") {
                    let dataset
                    temp.ohlcv = []

                    if (tradedSymbols[i].secType === "future") {
                        dataset = "GLBX.MDP3"
                        databentoSymbol = temp.symbol + ".c.0"
                        stype_in = "continuous"

                    } else if (tradedSymbols[i].secType === "stock") {
                        dataset = "XNAS.ITCH"

                    } else if (tradedSymbols[i].secType === "call" || tradedSymbols[i].secType === "put") {

                    } else if (tradedSymbols[i].secType === "forex") {

                    }
                    let index = currentUser.value.apis.findIndex(obj => obj.provider === 'databento')

                    let data =
                    {
                        'dataset': dataset,
                        'stype_in': stype_in,
                        'symbols': databentoSymbol,
                        'schema': 'ohlcv-1m',
                        'start': tradedStartDate * 1000000000,
                        'end': toDate * 1000000000,
                        'encoding': 'csv',
                        'pretty_px': 'true',
                        'pretty_ts': 'true',
                        'map_symbols': 'true',
                        'username': currentUser.value.apis[index].key
                    }

                    //console.log(" data "+JSON.stringify(data))
                    if (param2 === "api") {
                        try {
                            const username = currentUser.value.apis[index].key
                            const password = '';


                            let config = {
                                method: 'post',
                                maxBodyLength: Infinity,
                                url: "https://hist.databento.com/v0/timeseries.get_range",
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    'Authorization': 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
                                },
                                data: data
                            };

                            axios.request(config)
                                .then(async (response) => {
                                    await useCreateOHLCV(response.data, temp)
                                    resolve()
                                })
                                .catch((error) => {
                                    console.log(" -> Error in databento response " + error)
                                    reject(error)
                                });

                        } catch (error) {
                            console.log(" -> Error getting databento " + error)
                            reject(error)
                        }
                    } else {
                        axios.post('/api/databento', data)
                            .then(async (response) => {
                                await useCreateOHLCV(response.data, temp)
                                resolve(ohlcv)
                            })
                            .catch((error) => {
                                console.log(" -> Error in databento response " + error)
                                reject(error)
                            });
                    }


                } else if (param === "polygon") {
                    // Vorherigen Interceptor entfernen (Memory-Leak verhindern)
                    if (window._polygonInterceptorId !== undefined) {
                        axios.interceptors.response.eject(window._polygonInterceptorId)
                    }
                    window._polygonInterceptorId = axios.interceptors.response.use(undefined, (err) => {
                        const { config, message } = err;
                        if (err) {
                            console.log(" -> Interceptors status " + err.response.status)
                            console.log(" -> Interceptors data " + JSON.stringify(err.response.data))
                            console.log(" -> Interceptors message " + message)
                            //spinnerLoadingPageText.value = "Getting OHLCV - API limit reached - Retrying 60 seconds"
                        }
                        if (!config || !config.retry) {
                            return Promise.reject(err);
                        }

                        // If there is an error and the status is not 429, we just alert (return rejection). Else we continue and retry
                        if (err.response.status != 429) {
                            alert("Error getting OHLCV with message: " + message)
                            return Promise.reject(err);
                        }

                        config.retry -= 1;

                        const delayRetryRequest = new Promise((resolve) => {
                            setTimeout(() => {
                                console.log(" -> Retrying the request ", config.url);
                                resolve();
                            }, config.retryDelay || 1000);
                        });

                        return delayRetryRequest.then(() => axios(config));
                    });

                    // when request, can set retry times and retry delay time
                    let index = currentUser.value.apis.findIndex(obj => obj.provider === 'polygon')
                    await axios.get('/api/polygon/aggs', {
                        params: {
                            ticker: temp.symbol,
                            from: tradedStartDate * 1000,
                            to: toDate * 1000,
                            interval: 1,
                            span: 'minute',
                            adjusted: true,
                            sort: 'asc',
                            limit: 50000
                        },
                        headers: {
                            'x-polygon-api-key': currentUser.value.apis[index].key
                        },
                        retry: 5,
                        retryDelay: 60000
                    })
                        .then((response) => {
                            //console.log(" -> data " + JSON.stringify(response))
                            //console.log(" -> ohlcvData " + JSON.stringify(ohlcvData))
                            temp.ohlcv = response.data.results
                            ohlcv.push(temp)
                            //console.log(" -> ohlcv " + JSON.stringify(ohlcv))
                            resolve(ohlcv)
                        })
                        .catch((error) => {

                            console.log(" -> Polygon api get error " + error.status);
                            reject(error)
                        })
                        .finally(function () {
                            // always executed
                        })
                }

            }

        }
        await asyncLoop()
    })
}

export const useGetMFEPrices = (tempExec, initEntryTime, initEntryPrice, trde, ohlcvParam) => {
    return new Promise(async (resolve, reject) => {
        console.log("  --> Getting MFE Price")

        if (ohlcvParam) {
            ohlcv = ohlcvParam //case when we add MFE from daily
        }

        let ohlcvSymbol = ohlcv[ohlcv.findIndex(f => f.symbol == tempExec.symbol)].ohlcv
        //todo exclude if trade in same minute timeframe

        //console.log(" ohlcvSymbol " + JSON.stringify(ohlcvSymbol))

        if (ohlcvSymbol != undefined) {
            /*
             * findIndex liefert die ERSTE Kerze ab dem Zeitpunkt. Gewollt ist:
             * liegt der Einstieg exakt auf einer Kerzengrenze, gehört diese
             * Kerze noch zum Einstieg und wird übersprungen; liegt der Ausstieg
             * exakt auf einer Grenze, zählt diese Kerze mit.
             *
             * Genau das tat der Code NICHT. Verglichen wurde das Kerzenobjekt
             * (`ohlcvSymbol[i]`) mit einer Sekundenzahl — nie gleich, also lief
             * immer der else-Zweig: die Einstiegskerze floss trotz Absicht mit
             * ein, die Ausstiegskerze fiel trotz Absicht heraus. Beide Grenzen
             * waren um eine Kerze verschoben, und da MFE das MAXIMUM über das
             * Fenster ist, verschob das die Kennzahl systematisch.
             *
             * `endTime` bekam im nie erreichten Zweig zudem das Objekt statt
             * `.t` zugewiesen — repariert man nur den Vergleich, landet ein
             * Objekt in `dayjs()`. Deshalb hier beides.
             */
            const entryMs = initEntryTime * 1000
            const exitMs = trde.exitTime * 1000
            let tempStartIndex = ohlcvSymbol.findIndex(n => n.t >= entryMs)
            let tempEndIndex = ohlcvSymbol.findIndex(n => n.t >= exitMs)

            // Liegt der Trade ganz ausserhalb der geladenen Historie, gibt es
            // nichts zu messen. Vorher lief das in `ohlcvSymbol[-1].t`.
            if (tempStartIndex < 0 || tempEndIndex < 0) {
                return resolve(mfePrices)
            }

            let startIndex
            let endIndex
            let startTime
            let endTime

            if (ohlcvSymbol[tempStartIndex].t === entryMs) {
                startIndex = tempStartIndex + 1
            } else {
                startIndex = tempStartIndex
            }

            if (ohlcvSymbol[tempEndIndex].t === exitMs) {
                endIndex = tempEndIndex
            } else {
                endIndex = tempEndIndex - 1
            }

            // Nach dem Verschieben können die Grenzen aus dem Array laufen oder
            // sich kreuzen (Ein- und Ausstieg in derselben Kerze). Der Aufrufer
            // unten fängt `endTime < startTime` als Sonderfall ab — dafür
            // müssen beide Werte aber existieren.
            if (!ohlcvSymbol[startIndex] || !ohlcvSymbol[endIndex]) {
                return resolve(mfePrices)
            }
            startTime = ohlcvSymbol[startIndex].t
            endTime = ohlcvSymbol[endIndex].t

            //console.log("   ----> Temp Start index " + tempStartIndex + ", temp end index " + tempEndIndex)
            //console.log("   ----> EntryTime " + initEntryTime + " and start time " + startTime)
            //console.log("   ----> ExitTime " + trde.exitTime + " and end time " + endTime)

            //Get market close index
            //iterate from exit time and check if same day and <= 4 hour
            let endTimeDay = dayjs(endTime).tz(timeZoneTrade.value).get("date")
            let endTimeMonth = dayjs(endTime).tz(timeZoneTrade.value).get("month") + 1
            let endTimeYear = dayjs(endTime).tz(timeZoneTrade.value).get("year")
            let endTimeDate = endTimeYear + "-" + endTimeMonth + "-" + endTimeDay + " "+ marketCloseTime.value //VERY IMPORTANT : if i want to apply US time, it needs to be in US format, that is YYYY-MM-DD
            //console.log(" -> End time date "+endTimeDate)
            //    
            let marketCloseDateTime = dayjs.tz(endTimeDate, timeZoneTrade.value)

            //console.log(" marketCloseDateTime "+marketCloseDateTime)

            let tempEndOfDayTimeIndex = ohlcvSymbol.findIndex(f => f.t >= marketCloseDateTime)
            let endOfDayTimeIndex = tempEndOfDayTimeIndex - 1
            //console.log(" -> End of day time index "+endOfDayTimeIndex+" and values are "+JSON.stringify(ohlcvSymbol[endOfDayTimeIndex]))

            /*let timeDayOfWeek = dayjs(endTime * 1000).tz(timeZoneTrade.value).day()
            console.log(" timeDayOfWeek "+timeDayOfWeek)
            let timeHour = dayjs(endTime * 1000).tz(timeZoneTrade.value).get('hour')
            let time
            let i = tempEndIndex - 1;
            while (i < ohlcvSymbol.length && endTimeOfWeek == timeDayOfWeek && timeHour < 17) {
                time = ohlcvSymbol[i].t
                timeDayOfWeek = dayjs(time * 1000).tz(timeZoneTrade.value).day()
                timeHour = dayjs(time * 1000).tz(timeZoneTrade.value).get('hour')
                    //console.log("time: "+time+", timeDayOfWeek "+timeDayOfWeek+" and hour "+timeHour)
                i++;
            }
            console.log(" -> Time "+time)
            //let tempEndOfDayTimeIndex = ohlcvSymbol.findIndex(f => f.t >= time)
            let endOfDayTimeIndex = tempEndOfDayTimeIndex - 1

            //console.log(" -> End of day time " + endOfDayTime)
            console.log(" -> end of day time index temp "+tempEndOfDayTimeIndex)
            console.log(" -> end of day time index "+endOfDayTimeIndex+"+ and values are "+JSON.stringify(ohlcvSymbol[endOfDayTimeIndex]))*/

            let tempMfe = {}
            //check is same timeframe
            if (endTime < startTime) { //entry and exit are in the same 1mn timeframe
                console.log("   ---> Trade is in same 1mn timeframe")

                tempMfe.tradeId = trde.id
                tempMfe.dateUnix = tempExec.td
                tempMfe.mfePrice = initEntryPrice
                mfePrices.push(tempMfe)

            } else {
                //we get the MFE price by iterating between entry and exit and then between exit up until price hits / equals entryprice, and at the latest the endOfDayTime
                let priceDifference
                let mfePrice = initEntryPrice

                if (trde.strategy == "long") {
                    priceDifference = trde.exitPrice - initEntryPrice
                }
                if (trde.strategy == "short") {
                    priceDifference = initEntryPrice - trde.exitPrice
                }

                console.log("   ---> Iterating between entry price and exit price")
                //console.log(" mfePrice 1 "+mfePrice)
                //console.log("priceDifference "+priceDifference)
                //console.log("initEntryPrice "+initEntryPrice)
                //console.log("trde.exitPrice "+trde.exitPrice)

                //console.log("    ----> Start index "+startIndex+ " and end index "+endIndex)
                for (let i = startIndex; i <= endIndex; i++) {
                    //console.log(" Symbole price "+ohlcvSymbol.h[i]+" at time "+ohlcvSymbol.t[i]+" and MFE "+mfePrice)
                    if (trde.strategy == "long" && ohlcvSymbol[i].h > trde.exitPrice && ohlcvSymbol[i].h > mfePrice) mfePrice = ohlcvSymbol[i].h
                    if (trde.strategy == "short" && ohlcvSymbol[i].l < trde.exitPrice && ohlcvSymbol[i].l < mfePrice) mfePrice = ohlcvSymbol[i].l

                }
                //console.log(" -> Price difference "+priceDifference)
                if (initEntryPrice != trde.exitPrice && priceDifference > 0) { //case where stop or exit price loss above entryprice
                    console.log("   ---> Iterating between exit price and up until price hits / equals entry price, and at the latest until market close")
                    let i = endIndex
                    let ohlcvSymbolPrice
                    trde.strategy == "long" ? ohlcvSymbolPrice = ohlcvSymbol[endIndex].h : ohlcvSymbolPrice = ohlcvSymbol[endIndex].l

                    //console.log(" -> endOfDayTimeIndex "+endOfDayTimeIndex)

                    //we iterate until the end of trading day OR until is equal to the exitTrade time (endTime) or when the price move above or below the initEntryPrice
                    /*console.log(" i "+i)
                    console.log(" endOfDayTimeIndex "+endOfDayTimeIndex)
                    console.log(" ohlcvSymbol[i] "+ JSON.stringify(ohlcvSymbol[i]))
                    console.log(" ohlcvSymbol[endOfDayTimeIndex] "+ JSON.stringify(ohlcvSymbol[endOfDayTimeIndex]))
                    console.log(" ohlcvSymbol[i].t / 1000 "+ohlcvSymbol[i].t / 1000)
                    console.log(" endTime / 1000 "+endTime / 1000)
                    console.log(' ohlcvSymbolPrice '+ohlcvSymbolPrice)
                    console.log(" initEntryPrice "+initEntryPrice)*/

                    while ((trde.strategy == "long" ? ohlcvSymbolPrice > initEntryPrice : ohlcvSymbolPrice < initEntryPrice) && i <= endOfDayTimeIndex /*&& ((ohlcvSymbol[i].t / 1000) <= ((endTime / 1000)))*/) {
                        trde.strategy == "long" ? ohlcvSymbolPrice = ohlcvSymbol[i].h : ohlcvSymbolPrice = ohlcvSymbol[i].l
                        //console.log("  -> Symbol Price " + ohlcvSymbolPrice + " @ "+useDateTimeFormat(ohlcvSymbol[i].t/1000)+", init price " + initEntryPrice + " and mfe price " + mfePrice)
                        if (trde.strategy == "long" && ohlcvSymbolPrice > initEntryPrice && ohlcvSymbolPrice > mfePrice) mfePrice = ohlcvSymbolPrice
                        if (trde.strategy == "short" && ohlcvSymbolPrice < initEntryPrice && ohlcvSymbolPrice < mfePrice) mfePrice = ohlcvSymbolPrice
                        i++

                    }
                }

                if (trde.strategy == "long" && mfePrice < initEntryPrice) mfePrice = initEntryPrice
                if (trde.strategy == "short" && mfePrice > initEntryPrice) mfePrice = initEntryPrice

                console.log("    ----> " + trde.strategy + " stratgy with entry at " + useDateTimeFormat(initEntryTime) + " @ " + initEntryPrice + " -> exit at " + useDateTimeFormat(trde.exitTime) + " @ " + trde.exitPrice + " and MFE price " + mfePrice)
                //if short, MFE price = if price is lower than MFE
                //if long, MFE = if price is higher than MFE




                //add excursion to temp2
                trde.excursions = {}
                trde.excursions.stopLoss = null
                trde.excursions.maePrice = null
                trde.excursions.mfePrice = mfePrice

                tempMfe.tradeId = trde.id
                tempMfe.dateUnix = tempExec.td
                tempMfe.mfePrice = mfePrice
                mfePrices.push(tempMfe)
            }
        } else {
            console.log("   ---> Cannot find symbol in market data provider")
        }
        resolve(mfePrices)
    })
}

export const useUpdateMfePrices = async(param99, param0, param2) => {
    return new Promise(async (resolve, reject) => {
        console.log("  --> Updating excursion DB with MFE price")
        for (let index = 0; index < mfePrices.length; index++) {
            const element = mfePrices[index];
            try {
                const result = await dbCreate("excursions", {
                    mfePrice: element.mfePrice,
                    dateUnix: element.dateUnix,
                    tradeId: element.tradeId
                })
                console.log(' -> Added new excursion with id ' + result.objectId)
                tradeId.value = tradeExcursionId.value

                if (index == (mfePrices.length - 1)) {
                    resolve()
                }
            } catch (error) {
                console.log('Failed to create new object: ' + error.message);
                reject()
            }
        }
    })
}

export async function useCreateBlotter(param) {
    return new Promise(async (resolve, reject) => {
        console.log("\nCREATING BLOTTER BY SYMBOL")
        //spinnerLoadingPageText.value = "Creating blotter"
        //based on trades
        let objectZ
        if (param) { // case when creating blotter for filteredTrades
            //console.log("param " + param)
            let temp = _
                .chain(filteredTradesTrades)
                .orderBy(["entryTime"], ["asc"])
                .groupBy("td")
            objectZ = JSON.parse(JSON.stringify(temp))
            //console.log(" temp "+JSON.stringify(temp))
        } else {
            objectZ = trades
            //console.log(" this trades "+JSON.stringify(trades))
        }

        const keys9 = Object.keys(objectZ);
        var temp10 = {}
        for (const key9 of keys9) {
            //console.log(" Key9 "+key9)
            temp10[key9] = {}
            var tempExecs = objectZ[key9]
            //console.log("tempExecs9 " + JSON.stringify(tempExecs));
            var z = _
                .chain(tempExecs)
                .orderBy(["entryTime"], ["asc"])
                .groupBy("symbol")
            let objectY = JSON.parse(JSON.stringify(z))
            //console.log("objectY "+JSON.stringify(objectY))
            const keys10 = Object.keys(objectY);
            for (const key10 of keys10) {
                //console.log("key 10 " + key10)
                //console.log("z "+JSON.stringify(z))
                var tempExecs = objectY[key10]
                //console.log("tempExecs " + JSON.stringify(tempExecs));
                temp10[key9][key10] = {};

                /*******************
                 * Info
                 *******************/
                var sumBuyQuantity = 0
                var sumSellQuantity = 0

                /*******************
                 * Commissions and fees
                 *******************/
                var sumCommission = 0
                var sumSec = 0
                var sumTaf = 0
                var sumNscc = 0
                var sumNasdaq = 0
                var sumOtherCommission = 0
                var sumFees = 0

                /*******************
                 * Gross proceeds and P&L
                 *******************/
                var sumGrossProceeds = 0
                var sumGrossWins = 0
                var sumGrossLoss = 0
                var sumGrossSharePL = 0 //On a trade level, it's Proceeds per share traded. But as we blotter and create global P&L, it is a cumulative number (like proceeds). This way.value we can calculate estimations. If we need and average per share, it's a different calculation
                var sumGrossSharePLWins = 0
                var sumGrossSharePLLoss = 0
                var highGrossSharePLWin = 0
                var highGrossSharePLLoss = 0


                /*******************
                 * Net proceeds and P&L
                 *******************/
                var sumNetProceeds = 0
                var sumNetWins = 0
                var sumNetLoss = 0
                var sumNetSharePL = 0
                var sumNetSharePLWins = 0
                var sumNetSharePLLoss = 0
                var highNetSharePLWin = 0
                var highNetSharePLLoss = 0

                /*******************
                 * Counts
                 *******************/
                var sumExecutions = 0
                var sumTrades = 0
                var sumGrossWinsQuantity = 0
                var sumGrossLossQuantity = 0
                var sumGrossWinsCount = 0
                var sumGrossLossCount = 0
                var sumNetWinsQuantity = 0
                var sumNetLossQuantity = 0
                var sumNetWinsCount = 0
                var sumNetLossCount = 0



                tempExecs.forEach(element => {
                    sumBuyQuantity += element.buyQuantity
                    sumSellQuantity += element.sellQuantity
                    sumCommission += element.commission
                    sumSec += element.sec
                    sumTaf += element.taf
                    sumNscc += element.nscc
                    sumNasdaq += element.nasdaq
                    sumOtherCommission += element.sec + element.taf + element.nscc + element.nasdaq
                    sumFees += element.commission + element.sec + element.taf + element.nscc + element.nasdaq

                    sumGrossProceeds += element.grossProceeds
                    sumGrossWins += element.grossWins
                    sumGrossLoss += element.grossLoss
                    sumGrossSharePL += element.grossSharePL
                    sumGrossSharePLWins += element.grossSharePLWins
                    sumGrossSharePLLoss += element.grossSharePLLoss
                    if (element.grossSharePL >= 0) {
                        if (element.grossSharePL > highGrossSharePLWin) {
                            highGrossSharePLWin = element.grossSharePL
                        }
                    }
                    if (element.grossSharePL < 0) {
                        if (element.grossSharePL < highGrossSharePLLoss) {
                            highGrossSharePLLoss = element.grossSharePL
                        }

                    }

                    sumNetProceeds += element.netProceeds
                    sumNetWins += element.netWins
                    sumNetLoss += element.netLoss
                    sumNetSharePL += element.netSharePL
                    sumNetSharePLWins += element.netSharePLWins
                    sumNetSharePLLoss += element.netSharePLLoss
                    if (element.netSharePL >= 0) {
                        if (element.netSharePL > highNetSharePLWin) {
                            highNetSharePLWin = element.netSharePL
                        }

                    }
                    if (element.netSharePL < 0) {
                        if (element.netSharePL < highNetSharePLLoss) {
                            highNetSharePLLoss = element.netSharePL
                        }

                    }

                    sumExecutions += element.executionsCount
                    sumGrossWinsQuantity += element.grossWinsQuantity
                    sumGrossLossQuantity += element.grossLossQuantity
                    sumGrossWinsCount += element.grossWinsCount

                    sumNetWinsQuantity += element.netWinsQuantity
                    sumNetLossQuantity += element.netLossQuantity
                    sumNetWinsCount += element.netWinsCount
                    sumGrossLossCount += element.grossLossCount
                    sumNetLossCount += element.netLossCount
                    sumTrades += element.tradesCount

                })

                /*******************
                 * Info
                 *******************/
                temp10[key9][key10].symbol = key10;
                temp10[key9][key10].type = tempExecs[0].type;
                temp10[key9][key10].buyQuantity = sumBuyQuantity
                temp10[key9][key10].sellQuantity = sumSellQuantity

                /*******************
                 * Commissions and fees
                 *******************/
                temp10[key9][key10].commission = sumCommission;
                temp10[key9][key10].sec = sumSec
                temp10[key9][key10].taf = sumTaf
                temp10[key9][key10].nscc = sumNscc
                temp10[key9][key10].nasdaq = sumNasdaq
                temp10[key9][key10].otherCommission = sumOtherCommission;
                temp10[key9][key10].fees = sumFees;

                /*******************
                 * Gross proceeds and P&L
                 *******************/
                temp10[key9][key10].grossProceeds = sumGrossProceeds;
                temp10[key9][key10].grossWins = sumGrossWins;
                temp10[key9][key10].grossLoss = sumGrossLoss;
                temp10[key9][key10].grossSharePL = sumGrossSharePL
                //temp10[key9][key10].grossSharePL = sumGrossProceeds / sumBuyQuantity

                /*sumGrossWinsQuantity == 0 ? temp10[key9][key10].grossSharePLWins = 0 : temp10[key9][key10].grossSharePLWins = sumGrossWins / sumGrossWinsQuantity
                sumGrossLossQuantity == 0 ? temp10[key9][key10].grossSharePLLoss = 0 : temp10[key9][key10].grossSharePLLoss = sumGrossLoss / sumGrossLossQuantity*/
                temp10[key9][key10].grossSharePLWins = sumGrossSharePLWins
                temp10[key9][key10].grossSharePLLoss = sumGrossSharePLLoss
                temp10[key9][key10].highGrossSharePLWin = highGrossSharePLWin;
                temp10[key9][key10].highGrossSharePLLoss = highGrossSharePLLoss;

                /*******************
                 * Net proceeds and P&L
                 *******************/
                temp10[key9][key10].netProceeds = sumNetProceeds;
                temp10[key9][key10].netWins = sumNetWins;
                temp10[key9][key10].netLoss = sumNetLoss;
                temp10[key9][key10].netSharePL = sumNetSharePL
                //temp10[key9][key10].netSharePL = sumNetProceeds / sumBuyQuantity

                /*sumNetWinsQuantity == 0 ? temp10[key9][key10].netSharePLWins = 0 : temp10[key9][key10].netSharePLWins = sumNetWins / sumNetWinsQuantity
                sumNetLossQuantity == 0 ? temp10[key9][key10].netSharePLLoss = 0 : temp10[key9][key10].netSharePLLoss = sumNetLoss / sumNetLossQuantity*/
                temp10[key9][key10].netSharePLWins = sumNetSharePLWins
                temp10[key9][key10].netSharePLLoss = sumNetSharePLLoss
                temp10[key9][key10].highNetSharePLWin = highNetSharePLWin;
                temp10[key9][key10].highNetSharePLLoss = highNetSharePLLoss;

                /*******************
                 * Counts
                 *******************/
                temp10[key9][key10].executions = sumExecutions;
                temp10[key9][key10].trades = sumTrades;

                temp10[key9][key10].grossWinsQuantity = sumGrossWinsQuantity;
                temp10[key9][key10].grossLossQuantity = sumGrossLossQuantity;
                temp10[key9][key10].grossWinsCount = sumGrossWinsCount;
                temp10[key9][key10].grossLossCount = sumGrossLossCount;

                temp10[key9][key10].netWinsQuantity = sumNetWinsQuantity;
                temp10[key9][key10].netLossQuantity = sumNetLossQuantity;
                temp10[key9][key10].netWinsCount = sumNetWinsCount;
                temp10[key9][key10].netLossCount = sumNetLossCount;

            }

        }
        for (let key in blotter) delete blotter[key]
        Object.assign(blotter, temp10)
        //console.log(" -> BLOTTER " + JSON.stringify(blotter))
        resolve()
    })
}

export async function useCreatePnL() {
    return new Promise(async (resolve, reject) => {
        console.log("\nCREATING P&L")
        //spinnerLoadingPageText.value = "Creating P&L"
        //based on blotter
        let objectQ = blotter
        const keys7 = Object.keys(objectQ);
        var temp9 = {}

        for (const key7 of keys7) {
            //console.log(" key 7 "+key7)
            temp9[key7] = {};
            var tempExecs = objectQ[key7]
            //console.log("temp p&l " + JSON.stringify(tempExecs));
            var sumBuyQuantity = 0
            var sumSellQuantity = 0

            var sumCommission = 0
            var sumSec = 0
            var sumTaf = 0
            var sumNscc = 0
            var sumNasdaq = 0
            var sumOtherCommission = 0
            var sumFees = 0

            var sumGrossProceeds = 0
            var sumGrossWins = 0
            var sumGrossLoss = 0
            var sumGrossSharePL = 0
            var sumGrossSharePLWins = 0
            var sumGrossSharePLLoss = 0
            var highGrossSharePLWin = 0
            var highGrossSharePLLoss = 0

            var sumNetProceeds = 0
            var sumNetWins = 0
            var sumNetLoss = 0
            var sumNetSharePL = 0
            var sumNetSharePLWins = 0
            var sumNetSharePLLoss = 0
            var highNetSharePLWin = 0
            var highNetSharePLLoss = 0

            var sumExecutions = 0
            var sumTrades = 0

            var sumGrossWinsQuantity = 0
            var sumGrossLossQuantity = 0
            var sumGrossWinsCount = 0
            var sumGrossLossCount = 0

            var sumNetWinsQuantity = 0
            var sumNetLossQuantity = 0
            var sumNetWinsCount = 0
            var sumNetLossCount = 0


            const keys8 = Object.keys(tempExecs);
            for (const key8 of keys8) {
                //console.log("key 8 "+key8)
                sumBuyQuantity += tempExecs[key8].buyQuantity
                sumSellQuantity += tempExecs[key8].sellQuantity

                sumCommission += tempExecs[key8].commission
                sumSec += tempExecs[key8].sec
                sumTaf += tempExecs[key8].taf
                sumNscc += tempExecs[key8].nscc
                sumNasdaq += tempExecs[key8].nasdaq
                sumOtherCommission += tempExecs[key8].otherCommission
                sumFees += tempExecs[key8].fees

                sumGrossProceeds += tempExecs[key8].grossProceeds
                sumGrossWins += tempExecs[key8].grossWins
                sumGrossLoss += tempExecs[key8].grossLoss
                sumGrossSharePL += tempExecs[key8].grossSharePL
                sumGrossSharePLWins += tempExecs[key8].grossSharePLWins
                sumGrossSharePLLoss += tempExecs[key8].grossSharePLLoss
                if (tempExecs[key8].highGrossSharePLWin >= highGrossSharePLWin) {
                    highGrossSharePLWin = tempExecs[key8].highGrossSharePLWin
                }
                if (tempExecs[key8].highGrossSharePLLoss < highGrossSharePLLoss) {
                    highGrossSharePLLoss = tempExecs[key8].highGrossSharePLLoss
                }

                sumNetProceeds += tempExecs[key8].netProceeds
                sumNetWins += tempExecs[key8].netWins
                sumNetLoss += tempExecs[key8].netLoss
                sumNetSharePL += tempExecs[key8].netSharePL
                sumNetSharePLWins += tempExecs[key8].netSharePLWins
                sumNetSharePLLoss += tempExecs[key8].netSharePLLoss
                if (tempExecs[key8].highNetSharePLWin >= highNetSharePLWin) {
                    highNetSharePLWin = tempExecs[key8].highNetSharePLWin
                }

                if (tempExecs[key8].highNetSharePLLoss < highNetSharePLLoss) {
                    highNetSharePLLoss = tempExecs[key8].highNetSharePLLoss
                }

                sumExecutions += tempExecs[key8].executions
                sumTrades += tempExecs[key8].trades

                sumGrossWinsQuantity += tempExecs[key8].grossWinsQuantity
                sumGrossLossQuantity += tempExecs[key8].grossLossQuantity
                sumGrossWinsCount += tempExecs[key8].grossWinsCount
                sumGrossLossCount += tempExecs[key8].grossLossCount

                sumNetWinsQuantity += tempExecs[key8].netWinsQuantity
                sumNetLossQuantity += tempExecs[key8].netLossQuantity
                sumNetWinsCount += tempExecs[key8].netWinsCount
                sumNetLossCount += tempExecs[key8].netLossCount


            }
            /*******************
             * Info
             *******************/
            temp9[key7].buyQuantity = sumBuyQuantity;
            temp9[key7].sellQuantity = sumSellQuantity;

            /*******************
             * Commissions and fees
             *******************/
            temp9[key7].commission = sumCommission;
            temp9[key7].sec = sumSec
            temp9[key7].taf = sumTaf
            temp9[key7].nscc = sumNscc
            temp9[key7].nasdaq = sumNasdaq
            temp9[key7].otherCommission = sumOtherCommission;
            temp9[key7].fees = sumFees;

            /*******************
             * Gross proceeds and P&L
             *******************/
            temp9[key7].grossProceeds = sumGrossProceeds;
            temp9[key7].grossWins = sumGrossWins;
            temp9[key7].grossLoss = sumGrossLoss;
            temp9[key7].grossSharePL = sumGrossSharePL
            //temp9[key7].grossSharePL = sumGrossProceeds / sumBuyQuantity

            /*sumGrossWinsQuantity == 0 ? temp9[key7].grossSharePLWins = 0 : temp9[key7].grossSharePLWins = sumGrossWins / sumGrossWinsQuantity
            sumGrossLossQuantity == 0 ? temp9[key7].grossSharePLLoss = 0 : temp9[key7].grossSharePLLoss = sumGrossLoss / sumGrossLossQuantity*/
            temp9[key7].grossSharePLWins = sumGrossSharePLWins
            temp9[key7].grossSharePLLoss = sumGrossSharePLLoss
            temp9[key7].highGrossSharePLWin = highGrossSharePLWin;
            temp9[key7].highGrossSharePLLoss = highGrossSharePLLoss;

            /*******************
             * Net proceeds and P&L
             *******************/
            temp9[key7].netProceeds = sumNetProceeds;
            temp9[key7].netWins = sumNetWins;
            temp9[key7].netLoss = sumNetLoss;
            temp9[key7].netSharePL = sumNetSharePL
            //temp9[key7].netSharePL = sumNetProceeds / sumBuyQuantity

            /*sumNetWinsQuantity == 0 ? temp9[key7].netSharePLWins = 0 : temp9[key7].netSharePLWins = sumNetWins / sumNetWinsQuantity
            sumNetLossQuantity == 0 ? temp9[key7].netSharePLLoss = 0 : temp9[key7].netSharePLLoss = sumNetLoss / sumNetLossQuantity*/
            temp9[key7].netSharePLWins = sumNetSharePLWins
            temp9[key7].netSharePLLoss = sumNetSharePLLoss
            temp9[key7].highNetSharePLWin = highNetSharePLWin;
            temp9[key7].highNetSharePLLoss = highNetSharePLLoss;

            /*******************
             * Counts
             *******************/
            temp9[key7].executions = sumExecutions
            temp9[key7].trades = sumTrades

            temp9[key7].grossWinsQuantity = sumGrossWinsQuantity
            temp9[key7].grossLossQuantity = sumGrossLossQuantity
            temp9[key7].grossWinsCount = sumGrossWinsCount
            temp9[key7].grossLossCount = sumGrossLossCount

            temp9[key7].netWinsQuantity = sumNetWinsQuantity
            temp9[key7].netLossQuantity = sumNetLossQuantity
            temp9[key7].netWinsCount = sumNetWinsCount
            temp9[key7].netLossCount = sumNetLossCount


        }
        for (let key in pAndL) delete pAndL[key]
        Object.assign(pAndL, temp9)
        //console.log(" -> P&L: " + JSON.stringify(pAndL))


        //console.log(" -> Created trades table successfully");
        resolve()
    })
}

/* ---- 4: UPLOAD TO PARSE TRADES  ---- */
export async function useUploadTrades(param99, param0) {

    console.log("\nUPLOADING TRADES")
    spinnerLoadingPage.value = true
    //spinnerLoadingPageText.value = "Uploading and storing trades(s) ..."

    //Function uplaod trades to parse
    /*
     * Fehlgeschlagene Tage werden gesammelt, nicht verschluckt. Der Aufrufer
     * zeigt sie am Ende an — vorher sah ein halber Import aus wie ein ganzer.
     */
    const fehlgeschlageneTage = []

    const uploadToParse = async (param1, param2, param3) => {
        let data = {
            date: dayjs.unix(param1).format("YYYY-MM-DD"),
            dateUnix: Number(param1),
            openPositions: param3,
            /*
             * Die Tageszeile MUSS den Broker tragen. Ohne ihn greift die
             * Vorgabe der Spalte, und ein Bitget-CSV landete als
             * Bitunix-Tag. Gefiltert wird auf Zeilenebene — Kontostand je
             * Börse, Winrate-Kachel, ESP32-Anzeige und vor allem die
             * Duplikatsprüfung des Schnellimports lesen dieses Feld. Der
             * falsch beschriftete Tag war für den Bitget-Schnellimport
             * unsichtbar und wurde ein zweites Mal angelegt.
             */
            broker: selectedBroker.value || 'bitunix',
        }
        if (param2 == "trades") {
            data.executions = executions[param1]
            data.trades = trades[param1]
            data.blotter = blotter[param1]
            data.pAndL = pAndL[param1]
        }

        try {
            const result = await dbCreate(param2, data)
            console.log(" -> Added new " + param2 + " with id " + result.objectId)
            return { ok: true }
        } catch (error) {
            /*
             * Hier stand ein `new Promise(async …)`, dessen catch-Zweig WEDER
             * auflöste noch ablehnte. Das await darauf kehrte nie zurück: die
             * Schleife blieb stehen, der Import brach still mitten drin ab, und
             * weil der Spinner vorher schon abgeschaltet wurde, sah die Seite
             * fertig aus. MFE-Preise, Positionsabgleich und Weiterleitung
             * passierten nie.
             *
             * Ein async-Executor kann seinen Fehler ohnehin nicht nach aussen
             * werfen — der Promise-Konstruktor verschluckt ihn. Der Wrapper ist
             * deshalb ersatzlos entfallen; die Funktion war bereits `async`.
             */
            console.log('Failed to create new trade: ' + error.message)
            fehlgeschlageneTage.push({ tag: data.date, grund: error?.message || String(error) })
            return { ok: false }
        }
    }


    /*
     * Auch hier ist der Promise-Wrapper weg. Er löste NUR auf, wenn der Zähler
     * am Ende die Zahl der Tage traf — ein einziger Fehlschlag verhinderte das
     * dauerhaft, und der Aufrufer wartete für immer.
     */
    const uploadFunction = async (param) => {
        let keys = []
        if (param == "trades") keys = Object.keys(executions)
        console.log("num of dates " + keys.length)

        let geschrieben = 0
        for (const key of keys) {
            let checkIfOpenPositions = trades[key]?.findIndex(x => x.openPosition == true)
            checkIfOpenPositions != -1 ? checkIfOpenPositions = true : checkIfOpenPositions = false
            const r = await uploadToParse(key, param, checkIfOpenPositions)
            if (r.ok) geschrieben++
        }
        return { geschrieben, fehler: fehlgeschlageneTage }
    }

    if (Object.keys(executions).length > 0) {
        const bilanz = await uploadFunction("trades")
        // Der Nutzer erfährt, was NICHT ankam. Vorher blieb der Import beim
        // ersten Fehler stumm stehen und die Seite sah fertig aus.
        if (bilanz.fehler.length > 0) {
            alert(`${bilanz.geschrieben} Handelstag(e) importiert, ${bilanz.fehler.length} fehlgeschlagen:\n`
                + bilanz.fehler.map(f => `${f.tag}: ${f.grund}`).join('\n'))
        }
    }
    if (Object.keys(executions).length > 0 && mfePrices.length > 0) await useUpdateMfePrices(param99, param0)
    window.location.href = "/dashboard"
}
