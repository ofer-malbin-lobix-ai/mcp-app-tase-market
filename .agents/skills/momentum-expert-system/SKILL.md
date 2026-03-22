---
name: momentum-expert-system
description: Technical specification for the Momentum Expert System v4 used in market-momentum-widget and market-anticipation-widget. Covers Stage 0 Anticipation Layer (Stochastic signals), scoring algorithms (DailyScore, TrendQuality, LeaderScore), persistence filters, phase classification, MACD declining disqualifier, BandWidth zones, SMA200 rising gate, leader sub-tiers, 5-regime market classification, and position sizing matrix. Use when modifying momentum logic, debugging scores, or extending momentum/anticipation widgets.
license: MIT
metadata:
  author: lobix-ai
  version: "2.0.0"
  spec_version: "V04 (2026-03-22)"
---

# Momentum Expert System v4 – Technical Model Specification

Architecture and mathematical framework for identifying and ranking uptrend stocks on TASE. v4 adds Stage 0 Anticipation Layer, enhanced momentum rules, and 5-regime market classification.

## System Layers

The system consists of six analytical layers processed in order:

0. **Stage 0: Anticipation** – pre-uptrend setup identification via Stochastic %K/%D (separate tool)
1. **Trend Detection** – filter candidates via DailyScore
2. **Momentum Scoring** – persistence classification over 3 days
3. **Trend Quality Evaluation** – structural strength (TrendQuality 0–10)
4. **Momentum Leader Identification** – leadership ranking (LeaderScore 0–9)
5. **Market Regime Detection** – 5-regime breadth + volatility classification

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
| Stochastic %K(14) | Slow Stochastic %K, 14-period (NEW in v4) |
| Stochastic %D(14) | Stochastic %D signal line (NEW in v4) |

### Derived variables

```
EZ (Distance_SMA20) = (Close - SMA20) / SMA20
BandWidth           = (UpperB20 - LowerB20) / SMA20
```

- **EZ** is stored as percentage points (e.g., 3% → `3`). Code compares raw numeric values: `ez >= 0 && ez <= 3`.
- **BandWidth** is stored as a decimal ratio (e.g., 6% → `0.06`). Code compares: `bandWidth20 < 0.06`.

### Stochastic Computation

```
Raw %K = (Close - LowestLow14) / (HighestHigh14 - LowestLow14) × 100
Slow %K = SMA(rawK, 3)
%D = SMA(slowK, 3)
```

Stored as `stochK14` and `stochD14` in the database.

## Stage 0: Anticipation Layer (NEW in v4)

Pre-uptrend setup identification. Fires 2–5 days before the main momentum pipeline (DailyScore >= 6).

### Signal Types

| Signal | Name | Conditions |
|--------|------|------------|
| **A** | Stoch Crossover <30 | SMA20 > SMA50 + %K crosses above %D below 30 + RSI 35–55 + MACD Hist < 0 |
| **B** | Rising Stoch 40-65 | SMA20 > SMA50 + Close > SMA200 + %K 40–65 rising + %K > %D + RSI 45–60 + MACD Hist rising |
| **C** | Bullish Divergence | Close > SMA200 + Price lower low vs 5–10 days ago + Stochastic higher %K low |

### Stage 0 Scoring (0–13)

| Component | Points |
|-----------|--------|
| Signal A detected | +3 |
| Signal B detected | +3 |
| Signal C detected | +2 |
| SMA20 > SMA50 | +2 |
| Close > SMA200 | +1 |
| MACD Hist rising | +1 |
| BandWidth < 8% | +1 |
| RSI 40–55 | +1 |

### Priority Classification

| Score | Priority |
|-------|----------|
| >= 9 | HIGH |
| 6–8 | WATCH |
| 3–5 | RADAR |
| < 3 | Excluded |

### Exclusion Rule

Symbols already on the momentum uptrend list (DailyScore >= 6 on latest day) are excluded from anticipation results.

## Layer 1: Daily Momentum Score (DailyScore)

Primary uptrend filter. Range: **0–8**.

| Condition | Points |
|-----------|--------|
| Close > SMA20 | +2 |
| SMA20 > SMA50 | +2 |
| MACD Histogram > 0 | +1 |

### RSI scoring (cascading)

| Condition | Points |
|-----------|--------|
| RSI > 70 | +3 |
| else RSI > 60 | +2 |
| else RSI > 50 | +1 |

**Candidate condition:** DailyScore >= 6

## Layer 2: Persistence Filter

Applied over the **last 3 trading days** (from 6-day data window).

| Classification | Rule |
|----------------|------|
| **Strong Uptrend** | DailyScore >= 6 for 3/3 days |
| **Confirmed Uptrend** | DailyScore >= 6 for at least 2/3 days |
| **New Momentum** | DailyScore >= 6 for 1 day only |

## MACD Hist Declining Disqualifier (NEW in v4)

If MACD Histogram has declined for **5+ consecutive days** (from the 6-day window), the symbol is excluded entirely. Checked after persistence but before scoring.

## Layer 3: Trend Quality Score (TrendQuality 0–10)

Same as v3.

## Layer 4: Momentum Leader Score (LeaderScore 0–9)

Same as v3.

### Leader Sub-tiers (NEW in v4)

For LeaderScore 5–6, classified by EZ zone:

| Sub-tier | EZ Condition |
|----------|-------------|
| A | EZ < 8% |
| B | 8% <= EZ <= 12% |
| C | EZ > 12% |

## Expanded BandWidth Zones (NEW in v4)

| Zone | BandWidth Range |
|------|----------------|
| `strong_compression` | < 4% |
| `compression` | 4–6% |
| `normal` | 6–12% |
| `elevated` | 12–20% |
| `high` | 20–30% |
| `extreme` | > 30% |

## SMA200 Rising Gate (NEW in v4)

Compares current SMA200 vs SMA200 from ~365 days ago.

- If current SMA200 > historical SMA200 → `sma200Rising = true`
- If no historical data → passes by default
- Not a hard gate (symbol not excluded), but shown as a warning indicator

## Layer 5: Volatility Compression Detection

Same as v3.

## Layer 6: 5-Regime Market Classification (ENHANCED in v4)

Uses **momentum breadth** AND **average BandWidth** across the liquid universe.

### Regime Rules (checked in order)

| Regime | Condition |
|--------|-----------|
| `avoid` | avgBW > 30% |
| `attack` | breadth >= 30% AND avgBW < 20% |
| `selective` | breadth 15–30% AND avgBW < 30% |
| `neutral` | breadth 10–15% AND avgBW 20–30% |
| `defense` | breadth < 15% |

### Position Sizing Matrix

| Regime | BW<8% | BW 8-15% | BW 15-25% | BW>25% |
|--------|-------|----------|-----------|--------|
| attack | 100% | 75% | 50% | 25% |
| selective | 75% | 50% | 25% | 0% |
| neutral | 50% | 25% | 0% | 0% |
| defense | 25% | 0% | 0% | 0% |
| avoid | 0% | 0% | 0% | 0% |

## Processing Pipeline

### Momentum Pipeline

```
1. Load daily data (last 6 trading days)
2. Filter by liquidity (turnover10 >= 1,500,000)
3. Calculate DailyScore for each day
4. Apply Persistence filter (strong/confirmed/new) on last 3 days
5. MACD Declining Disqualifier (5+ consecutive declines → skip)
6. Compute TrendQuality (latest day)
7. Compute LeaderScore (latest day) + Sub-tiers
8. Detect Compression + BandWidth Zone
9. SMA200 Rising Gate
10. Classify Phase
11. Sort by LeaderScore DESC, TrendQuality DESC
```

### Anticipation Pipeline

```
1. Load daily data (last 20 trading days)
2. Filter by liquidity (turnover10 >= 1,500,000)
3. Exclude symbols with DailyScore >= 6 (already on momentum list)
4. Detect Signal A (Stoch crossover <30)
5. Detect Signal B (Rising Stoch 40-65)
6. Detect Signal C (Bullish divergence)
7. Compute Stage 0 Score (signal + structural bonuses)
8. Filter: score >= 3
9. Classify priority (HIGH/WATCH/RADAR)
10. Sort by stage0Score DESC
```

## Codebase Reference

| Concern | File | Location |
|---------|------|----------|
| Stochastic computation | `src/db/indicators.ts` | `stochastic()` |
| Momentum data fetching | `src/db/db-api.ts` | `fetchMomentumSymbols()` |
| Anticipation data fetching | `src/db/db-api.ts` | `fetchAnticipationSymbols()` |
| Market regime | `src/db/db-api.ts` | `fetchMarketSpirit()` |
| TypeScript types | `src/types.ts` | `MomentumSymbolItem`, `AnticipationSymbolItem`, `MarketSpiritResponse` |
| MCP tool definitions | `server.ts` | Momentum + Anticipation tools |
| Momentum Widget UI | `src/widgets/market-momentum-widget.tsx` | React component |
| Anticipation Widget UI | `src/widgets/market-anticipation-widget.tsx` | React component |
| Spirit Widget UI | `src/widgets/market-spirit-widget.tsx` | React component |
| Translations | `src/components/translations.ts` | `momentum.*`, `landing.tool.marketAnticipation` |

## MCP Tools

| Tool | Purpose | Inputs |
|------|---------|--------|
| `get-market-momentum-data` | Momentum scanner (JSON) | `marketType?`, `tradeDate?` |
| `show-market-momentum-widget` | Momentum scanner UI | `marketType?`, `tradeDate?` |
| `get-market-anticipation-data` | Stage 0 anticipation (JSON) | `marketType?`, `tradeDate?` |
| `show-market-anticipation-widget` | Stage 0 anticipation UI | `marketType?`, `tradeDate?` |
| `get-market-spirit-data` | Market regime + breadth (JSON) | `marketType?`, `tradeDate?` |
| `show-market-spirit-widget` | Market regime UI | `marketType?`, `tradeDate?` |
