-- CreateTable
CREATE TABLE "TaseSecuritiesEndOfDayTradingData" (
    "id" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "firstTradingDate" DATE,
    "isin" TEXT NOT NULL,
    "change" DOUBLE PRECISION,
    "securityId" INTEGER NOT NULL,
    "turnover" BIGINT,
    "closingPrice" DOUBLE PRECISION,
    "basePrice" DOUBLE PRECISION,
    "openingPrice" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "changeValue" DOUBLE PRECISION,
    "transactionsNumber" INTEGER,
    "volume" BIGINT,
    "marketCap" BIGINT,
    "minContPhaseAmount" INTEGER,
    "listedCapital" BIGINT,
    "adjustedClosingPrice" DOUBLE PRECISION,
    "exCode" TEXT,
    "adjustmentCoefficient" DOUBLE PRECISION,
    "symbol" TEXT NOT NULL,
    "marketType" TEXT,
    "rsi14" DOUBLE PRECISION,
    "macd" DOUBLE PRECISION,
    "macdSignal" DOUBLE PRECISION,
    "macdHist" DOUBLE PRECISION,
    "cci20" DOUBLE PRECISION,
    "mfi14" DOUBLE PRECISION,
    "turnover10" DOUBLE PRECISION,
    "sma20" DOUBLE PRECISION,
    "sma50" DOUBLE PRECISION,
    "sma200" DOUBLE PRECISION,
    "ez" DOUBLE PRECISION,
    "stddev20" DOUBLE PRECISION,
    "upperBollingerBand20" DOUBLE PRECISION,
    "lowerBollingerBand20" DOUBLE PRECISION,

    CONSTRAINT "TaseSecuritiesEndOfDayTradingData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_symbol_tradeDate" ON "TaseSecuritiesEndOfDayTradingData"("symbol", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaseSecuritiesEndOfDayTradingData_symbol_tradeDate_key" ON "TaseSecuritiesEndOfDayTradingData"("symbol", "tradeDate");
