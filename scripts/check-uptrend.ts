import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const date = new Date("2026-02-20");
const mt = "STOCK";

const knownSymbols = ['KSM.F122','SAE','PAZ','HRL.F16','TCH.F118','TCH.F136','KSM.F57','NWMD','KMDA','MGDL','ELCRE','KEN','IBI','ENRG','TATT','MTF.F65','CLIS','KSM.F34','IBI.F183','TCH.F172','ESLT','AZRG','HARL','MLSR','FIBIH','PRSK','BSEN','DIMRI','RMON','KSTN','MMHD','ENLT'];

// Get the 79 symbols with their TaseSymbol metadata
type Row = { symbol: string; ez: number; securityname: string | null; companysector: string | null; companysubsector: string | null; companyname: string | null; companysupersector: string | null };

const rows79 = await prisma.$queryRaw<Row[]>`
  SELECT e.symbol, e.ez,
    s."securityName" as securityname,
    s."companySuperSector" as companysupersector,
    s."companySector" as companysector,
    s."companySubSector" as companysubsector,
    s."companyName" as companyname
  FROM "TaseSecuritiesEndOfDayTradingData" e
  LEFT JOIN "TaseSymbol" s ON e.symbol = s.symbol
  WHERE e."tradeDate" = ${date} AND e."marketType" = ${mt}
    AND e.ez > 0 AND e.rsi14 > 50 AND e.macd > 0 AND e."macdHist" > 0 AND e.cci20 > 0
    AND e.sma20 > e.sma50 AND e.sma50 > e.sma200 AND e."closingPrice" > e.sma200
    AND e.turnover10 >= 1000000
  ORDER BY e.symbol
`;

const prof = rows79.filter(r => knownSymbols.includes(r.symbol));
const extras = rows79.filter(r => !knownSymbols.includes(r.symbol));

// Show sector distribution
const sectorCount = (rows: Row[]) => {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const k = r.companysupersector ?? r.companysector ?? 'NULL';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${k}:${v}`).join(', ');
};

console.log(`\nProfessorai(${prof.length}) sectors: ${sectorCount(prof)}`);
console.log(`Extras(${extras.length}) sectors: ${sectorCount(extras)}`);

console.log("\nExtras symbols + securityName:");
for (const r of extras) {
  console.log(`  ${r.symbol}: name="${r.securityname}" sector="${r.companysector}" subSector="${r.companysubsector}"`);
}

await prisma.$disconnect();
