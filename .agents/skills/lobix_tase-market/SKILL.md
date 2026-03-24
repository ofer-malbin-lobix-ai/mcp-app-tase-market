---
name: lobix_tase-market
description: Guide for analyzing Tel Aviv Stock Exchange (TASE) market data using MCP tools. Covers market overview, symbol analysis, portfolio tracking, watchlists, and interactive widgets. Triggers on TASE, Tel Aviv Stock Exchange, Israeli stocks, market analysis, portfolio positions, watchlist, candlestick, end-of-day, sector heatmap, market spirit.
license: MIT
metadata:
  author: lobix-ai
  version: "1.0.0"
---

# TASE Market Analyst

Skill for analyzing Tel Aviv Stock Exchange (TASE) market data using the `tase-market` MCP server. Provides guidance on which tools to use for different analysis scenarios.

## When to Apply

Use this skill when the user wants to:
- Analyze Israeli stock market data (TASE)
- View market overviews, trends, or sector performance
- Track portfolio positions or watchlists
- View candlestick charts or end-of-day trading data
- Compare multiple symbols or analyze a single stock

## Available Tools (24 data + 22 widgets)

### Market Overview
| Goal | Data Tool | Widget Tool |
|------|-----------|-------------|
| Dashboard (spirit + EOD combined) | — | `show-market-dashboard-widget` |
| Market breadth & sentiment | `get-market-spirit-data` | `show-market-spirit-widget` |
| End-of-day for all symbols | `get-market-end-of-day-data` | `show-market-end-of-day-widget` |
| Sector heatmap | `get-market-sector-heatmap-data` | `show-market-sector-heatmap-widget` |
| Live last-update prices | `get-market-last-update-data` | `show-market-last-update-widget` |
| Momentum expert system | `get-market-momentum-data` | `show-market-momentum-widget` |
| Anticipation scanner (Stage 0) | `get-market-anticipation-data` | `show-market-anticipation-widget` |

### Symbol Analysis
| Goal | Data Tool | Widget Tool |
|------|-----------|-------------|
| Multiple symbols EOD (single date) | `get-symbols-end-of-day-data` | `show-symbols-end-of-day-widget` |
| Single symbol EOD (date range) | `get-symbol-end-of-days-data` | `show-symbol-end-of-days-widget` |
| Single symbol candlestick chart | `get-symbol-candlestick-data` | `show-symbol-candlestick-widget` |
| Multiple symbols candlestick | `get-symbols-period-data` | `show-symbols-candlestick-widget` |
| Symbols table | `get-symbols-table-data` | `show-symbols-table-widget` |
| Intraday candlestick (live) | `get-symbol-intraday-candlestick-data` | `show-symbol-intraday-candlestick-widget` |

### Portfolio (My Positions)
| Goal | Data Tool | Widget Tool |
|------|-----------|-------------|
| Manage positions (CRUD) | `get-my-positions`, `set-my-position`, `delete-my-position` | `show-my-positions-manager-widget` |
| P&L table | `get-my-position-table-data` | `show-my-position-table-widget` |
| Position EOD data | `get-my-position-end-of-day-data` | `show-my-position-end-of-day-widget` |
| Position candlestick | `get-my-position-period-data` | `show-my-position-candlestick-widget` |

### Watchlist
| Goal | Data Tool | Widget Tool |
|------|-----------|-------------|
| Manage watchlist (CRUD) | `get-watchlist`, `set-watchlist-item`, `delete-watchlist-item` | `show-watchlist-manager-widget` |
| Watchlist table | `get-watchlist-table-data` | `show-watchlist-table-widget` |
| Watchlist EOD data | `get-watchlist-end-of-day-data` | `show-watchlist-end-of-day-widget` |
| Watchlist candlestick | `get-watchlist-period-data` | `show-watchlist-candlestick-widget` |

### Settings & Home
| Goal | Widget Tool |
|------|-------------|
| All tools overview | `show-tase-market-home-widget` |
| Subscription & settings | `show-tase-market-settings-widget` |

## Decision Guide

### "Show me the market" → Start with the dashboard
```
show-market-dashboard-widget
```
Combines market spirit and end-of-day summary in one view.

### "How is sector X doing?" → Sector heatmap
```
show-market-sector-heatmap-widget
```
Visual heatmap of all sectors with color-coded performance.

### "Analyze TEVA" → Single symbol deep dive
1. **Quick look:** `show-symbol-end-of-days-widget` with date range
2. **Chart:** `show-symbol-candlestick-widget` with symbol: "TEVA"
3. **Live intraday:** `show-symbol-intraday-candlestick-widget` with securityIdOrSymbol: "TEVA" (during trading hours only: Sun-Thu ~09:45-17:30 Israel time)

### "Compare TEVA, NICE, ESLT" → Multi-symbol analysis
1. **Table:** `show-symbols-end-of-day-widget` with symbols: ["TEVA", "NICE", "ESLT"]
2. **Charts:** `show-symbols-candlestick-widget` with symbols: ["TEVA", "NICE", "ESLT"]

### "How's my portfolio?" → Position tracking
1. **Overview:** `show-my-position-table-widget` (P&L tracker)
2. **Manage:** `show-my-positions-manager-widget` (add/edit/remove)
3. **Chart:** `show-my-position-candlestick-widget`

### "What's trending up?" → Anticipation scanner
```
show-market-anticipation-widget
```
Stage 0 anticipation scanner identifying symbols with early momentum signals.

### "Show momentum leaders" / "Which stocks have strong momentum?" → Momentum expert system
```
show-market-momentum-widget
```
Expert system scoring: DailyScore, TrendQuality, LeaderScore with persistence filters and phase classification. See `momentum-expert-system` skill for full algorithm spec.

## Key Parameters

- **symbol** (string): Single symbol name, e.g. `"TEVA"`
- **symbols** (string[]): Multiple symbols, e.g. `["TEVA", "NICE", "ESLT"]`
- **securityIdOrSymbol** (string|number): Symbol name or TASE security ID (for intraday)
- **tradeDate** (string): Date in `YYYY-MM-DD` format (defaults to latest trading day)
- **dateFrom / dateTo** (string): Date range in `YYYY-MM-DD` format
- **marketType** (string): `"stocks"` or `"bonds"` (for market-wide views)

## Tips

- **Market data is available after trading hours.** TASE trades Sun-Thu ~09:45-17:30 Israel time. EOD data populates after market close.
- **Intraday and last-update data are live** — only available during trading hours, returns empty outside hours.
- **Portfolio and watchlist require authentication.** Users must be logged in via Auth0.
- **Widget tools (`show-*`) return interactive UI.** Data tools (`get-*`) return JSON for programmatic use.
- **Default to widgets** when the user wants to see data visually. Use data tools when they need raw numbers for calculations or comparisons in text.
- **Symbol names are case-insensitive.** `"teva"`, `"TEVA"`, and `"Teva"` all work.
