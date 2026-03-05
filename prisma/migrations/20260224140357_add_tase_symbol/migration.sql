-- CreateTable
CREATE TABLE "TaseSymbol" (
    "symbol" TEXT NOT NULL,
    "securityId" INTEGER NOT NULL,
    "isin" TEXT NOT NULL,
    "securityName" TEXT,
    "companySuperSector" TEXT,
    "companySector" TEXT,
    "companySubSector" TEXT,
    "companyName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaseSymbol_pkey" PRIMARY KEY ("symbol")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaseSymbol_securityId_key" ON "TaseSymbol"("securityId");
