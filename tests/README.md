# TASE Widget Tests

Automated widget tests for the TASE End of Day MCP app.
Tests run against the **production deployment** by default — no server setup or repo access needed.

## Prerequisites

- **Node.js 18+**
- **Google Chrome** (for ChatGPT platform tests)
- **ChatGPT account** with the `eod prod` MCP connector configured
  - Go to ChatGPT → Settings → Connected apps → add the TASE End of Day connector
- **macOS + Claude Desktop** (optional, for `--platform claude-desktop` tests only)
  - Claude Desktop must have the `tase-end-of-day` MCP server connected
  - Terminal must have Accessibility permission: System Settings → Privacy & Security → Accessibility

## Setup

```bash
# 1. Get the test file (clone the repo or download just the tests/ folder)
git clone https://github.com/ofer-malbin-lobix-ai/mcp-app-tase-end-of-day.git
cd mcp-app-tase-end-of-day/tests

# 2. Install the single dependency
npm install

# 3. Launch Chrome with remote debugging (leave this terminal open)
npm run start-chrome
# or manually:
# /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
#   --remote-debugging-port=9226 \
#   --user-data-dir=$HOME/.tase-test-profile \
#   --no-first-run about:blank
```

In the Chrome window that opens, **log in to ChatGPT** (only needed once — the profile is persisted).

## Running Tests

```bash
# Run a single test
npm run test:market-end-of-day
npm run test:my-position-table
npm run test:market-sector-heatmap
npm run test:my-position-candlestick
npm run test:my-position-end-of-day
npm run test:my-positions-manager

# Run all tests
npm run test:all

# Target a different MCP connector name (default: "eod prod")
node widget-tests.mjs market-end-of-day --mcp "eod prod"

# Claude Desktop platform (macOS only)
node widget-tests.mjs market-end-of-day --platform claude-desktop
node widget-tests.mjs all --platform claude-desktop
```

## Screenshots

Test screenshots are saved to `/tmp/tase-widget-tests/` after each run.

## Available Tests

| Test name | What it tests |
|---|---|
| `market-end-of-day` | Market end-of-day data table |
| `my-position-table` | Position table for TEVA, NICE, ESLT + period buttons (1W, 1M, 3M) |
| `market-sector-heatmap` | Sector heatmap + drill-down into sub-sectors + back |
| `my-position-candlestick` | Candlestick chart + symbol switch + period change |
| `my-position-end-of-day` | Multi-symbol EOD table + sort + filters |
| `my-positions-manager` | Positions manager CRUD: add, edit, delete |
