---
name: momentum-expert-system
description: Technical specification for the Momentum Expert System used in the market-momentum-widget. Covers scoring algorithms (DailyScore, TrendQuality, LeaderScore), persistence filters, phase classification, volatility compression detection, and market breadth metrics. Use when modifying momentum logic, debugging scores, or extending the momentum widget.
license: MIT
metadata:
  author: lobix-ai
  version: "1.0.0"
  spec_version: "V01 (2026-03-18)"
---

# Momentum Expert System – Technical Model Specification

Architecture and mathematical framework for identifying and ranking uptrend stocks on TASE.

## System Layers

The system consists of five analytical layers processed in order:

1. **Trend Detection** – filter candidates via DailyScore
2. **Momentum Scoring** – persistence classification over 3 days
3. **Trend Quality Evaluation** – structural strength (TrendQuality 0–10)
4. **Momentum Leader Identification** – leadership ranking (LeaderScore 0–9)
5. **Market Regime Detection** – breadth-based regime classification

## Data Inputs

### Required daily inputs per symbol

| Field | Description |
|-------|-------------|
| Close Price | Daily closing price |
| Volume | Daily trading volume |
| RSI(14) | Relative Strength Index, 14-period |
| MACD Histogram | MACD histogram value |
| MFI(14) | Money Flow Index, 14-period |
| SMA20 | Simple Moving Average, 20-period |
| SMA50 | Simple Moving Average, 50-period |
| SMA200 | Simple Moving Average, 200-period |
| Bollinger Upper/Lower Bands | 20-period Bollinger Bands |
| Standard Deviation (20) | 20-period standard deviation |

### Derived variables

```
EZ (Distance_SMA20) = (Close - SMA20) / SMA20
BandWidth           = (UpperB20 - LowerB20) / SMA20
```

- **EZ** is the private name for Distance_SMA20 — used throughout the codebase as `EZ`
- **EZ** is stored as percentage points (e.g., 3% → `3`). Code compares raw numeric values: `ez >= 0 && ez <= 3`.
- **BandWidth** is stored as a decimal ratio (e.g., 6% → `0.06`). Code compares: `bandWidth20 < 0.06`.

## Layer 1: Daily Momentum Score (DailyScore)

Primary uptrend filter. Range: **0–8**.

### Score components

| Condition | Points |
|-----------|--------|
| Close > SMA20 | +2 |
| SMA20 > SMA50 | +2 |
| MACD Histogram > 0 | +1 |

### RSI scoring (cascading — pick highest matching tier)

| Condition | Points |
|-----------|--------|
| RSI > 70 | +3 |
| else RSI > 60 | +2 |
| else RSI > 50 | +1 |

```
DailyScore = TrendScore + MomentumScore
```

**Candidate condition:** DailyScore >= 6

## Layer 2: Persistence Filter

Applied over the **last 3 trading days** to reduce noise.

| Classification | Rule |
|----------------|------|
| **Strong Uptrend** | DailyScore >= 6 for 3/3 days |
| **Confirmed Uptrend** | DailyScore >= 6 for at least 2/3 days |
| **New Momentum** | DailyScore >= 6 for 1 day only |

Symbols that never reach DailyScore >= 6 in any of the 3 days are excluded.

## Layer 3: Trend Quality Score (TrendQuality)

Measures structural strength of the trend. Range: **0–10**.

### Structure (0–4)

| Condition | Points |
|-----------|--------|
| SMA20 > SMA50 | +2 |
| SMA50 > SMA200 | +2 |

### Momentum (0–4)

| Condition | Points |
|-----------|--------|
| RSI >= 55 AND < 65 | +1 |
| RSI >= 65 AND <= 75 | +2 |
| MACD Histogram > 0 | +1 |
| MACD Histogram increasing | +1 |

### Distance from SMA20 (EZ) (-1 to +2)

| EZ Range | Points |
|----------|--------|
| >= 0 AND <= 3% | +2 |
| > 3% AND <= 8% | +1 |
| > 8% AND <= 15% | 0 |
| > 15% | -1 |

## Layer 4: Momentum Leader Score (LeaderScore)

Identifies stocks leading the momentum wave. Range: **0–9**.

| Condition | Points |
|-----------|--------|
| RSI >= 60 AND <= 70 | +2 |
| EZ >= 3% AND <= 8% | +2 |
| MACD Histogram rising | +2 |
| MFI > 65 | +2 |
| turnover > turnover10 | +1 |

### Interpretation

| Score | Category |
|-------|----------|
| 7–9 | Momentum Leader |
| 5–6 | Strong Trend |
| 3–4 | Normal Trend |

## Layer 5: Volatility Compression Detection

Compression signals potential breakouts.

```
BandWidth = (UpperB20 - LowerB20) / SMA20
```

| Zone | Condition |
|------|-----------|
| Compression | BandWidth < 6% |
| Strong Compression | BandWidth < 4% |

**Early breakout signal:** Compression + rising RSI + rising MFI.

## Market Breadth Metrics

> **Implementation note:** Market breadth metrics are implemented in `fetchMarketSpirit()` (market-spirit tool), not in `fetchMomentumSymbols()`. The momentum widget does not currently display breadth data.

Measures overall market regime using the liquid universe (~250 stocks passing liquidity test).

### Breadth indicators

| Metric | Formula |
|--------|---------|
| Momentum Breadth | Stocks with DailyScore >= 6 / Total Universe |
| MoneyFlow Breadth | Stocks with MFI > 60 / Total Universe |
| Compression Breadth | Stocks with BandWidth < 6% / Total Universe |

### Market Regime Classification

| Breadth Range | Regime |
|---------------|--------|
| < 15% | Weak Market |
| 15–30% | Early Trend |
| 30–50% | Healthy Momentum |
| > 50% | Overextended Market |

## Momentum Phase Classification

Each qualifying stock is classified into one phase:

| Phase | Condition | Priority |
|-------|-----------|----------|
| **Compression** | BandWidth < 6% | 1st (checked first) |
| **Extended** | 3+ days at DailyScore >= 6 AND EZ > 8% | 2nd |
| **Expansion** | 2+ days at DailyScore >= 6 AND LeaderScore >= 5 | 3rd |
| **Early** | Default (none of the above) | 4th |

## Processing Pipeline

```
1. Load daily data (last 3 trading days)
2. Filter by liquidity (turnover10 >= 1,500,000)
3. Calculate DailyScore for each day
4. Apply Persistence filter (strong/confirmed/new)
5. Compute TrendQuality (latest day)
6. Compute LeaderScore (latest day)
7. Detect Compression (latest day BandWidth)
8. Classify Phase
9. Sort by LeaderScore DESC, TrendQuality DESC
```

## Codebase Reference

| Concern | File | Location |
|---------|------|----------|
| Score computation & data fetching | `src/db/db-api.ts` | `fetchMomentumSymbols()` |
| TypeScript types | `src/types.ts` | `MomentumSymbolItem`, `MomentumResponse` |
| MCP tool definitions | `server.ts` | `get-market-momentum-data`, `show-market-momentum-widget` |
| Widget UI | `src/widgets/market-momentum-widget.tsx` | React component |
| Widget styles | `src/widgets/market-momentum-widget.module.css` | CSS modules |
| Translations | `src/components/translations.ts` | `momentum.*` keys |
| Input schema | `server.ts` | `getMomentumSchema` (marketType, tradeDate) |

## MCP Tools

| Tool | Purpose | Inputs |
|------|---------|--------|
| `get-market-momentum-data` | Data-only (JSON) | `marketType?`, `tradeDate?` |
| `show-market-momentum-widget` | Interactive UI widget | `marketType?`, `tradeDate?` |

`marketType` enum: `"STOCK" | "BOND" | "TASE UP STOCK" | "LOAN"` (default: `"STOCK"`)

## Widget UI Features

- **Statistics badges:** Strong, Confirmed, New, Leaders (LS >= 7), Compression counts
- **Filter tabs:** All, Strong, Confirmed, New, Compression
- **Symbol cards:** Show scores (DailyScore, TrendQuality, LeaderScore) and key indicators (EZ, RSI, MFI, BW)
- **Phase badge:** Color-coded (compression=purple, early=blue, expansion=green, extended=red)
- **Controls:** Date picker, refresh, language toggle (EN/Hebrew), theme toggle
- **Sorting:** LeaderScore DESC, then TrendQuality DESC

## Implementation Details

Code-specific behaviors in `fetchMomentumSymbols()` not covered by the spec:

- **Null handling:** `rsi14`, `ez`, `mfi14`, `turnover` default to `0` when null via nullish coalescing (`?? 0`)
- **isLeader:** computed as `leaderScore >= 7`
- **Clamping:** TrendQuality → `Math.max(0, Math.min(10, val))`, LeaderScore → `Math.min(9, val)`
- **MACD Rising:** `latest.macdHist > previous.macdHist` (requires both days to have non-null values)
- **Scoring window:** All scores (TrendQuality, LeaderScore) computed on latest day's data; persistence uses 3-day window
