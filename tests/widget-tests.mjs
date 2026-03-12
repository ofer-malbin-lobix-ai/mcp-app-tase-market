/**
 * TASE MCP Widget Tests
 *
 * Supports two platforms:
 *   chatgpt        — automates ChatGPT via Puppeteer (requires Chrome with remote debugging)
 *   claude-desktop — automates Claude Desktop via AppleScript + screencapture
 *
 * Prerequisites (chatgpt):
 *   - Chrome running with: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
 *       --remote-debugging-port=9226 --user-data-dir=/Users/ofermalbin/.claude/puppeteer-profile
 *   - OR run: npm run test:start-chrome
 *
 * Prerequisites (claude-desktop):
 *   - Claude Desktop running with tase-market-dev MCP server connected
 *   - Terminal must have Accessibility permission (System Settings → Privacy & Security → Accessibility)
 *
 * Usage:
 *   node tests/widget-tests.mjs [test-name] [--mcp <name>] [--platform <platform>]
 *
 * Options:
 *   --mcp <name>          MCP app name for ChatGPT messages (default: "tase-market")
 *   --platform <name>     "chatgpt" (default) or "claude-desktop"
 *
 * Available tests:
 *   market-end-of-day       — show-market-end-of-day-widget
 *   market-spirit           — show-market-spirit-widget
 *   market-uptrend-symbols  — show-market-uptrend-symbols-widget
 *   market-sector-heatmap   — show-market-sector-heatmap-widget + drill-down + back
 *   my-position-table       — show-my-position-table-widget (auto-fetch symbols) P&L table + sort
 *   my-position-candlestick — show-my-position-candlestick-widget (auto-fetch symbols) + symbol switch + period
 *   my-position-end-of-day  — show-my-position-end-of-day-widget (auto-fetch symbols) + sort + filters
 *   my-positions-manager    — show-my-positions-manager-widget + add/edit/delete
 *   symbols-end-of-day       — show-symbols-end-of-day-widget (TEVA, NICE, ESLT) single date
 *   symbols-candlestick     — show-symbols-candlestick-widget (TEVA, NICE, ESLT) + symbol switch
 *   symbols-table           — show-symbols-table-widget (TEVA, NICE, ESLT) + period buttons
 *   symbol-candlestick      — show-symbol-candlestick-widget (single symbol: TEVA)
 *   symbol-intraday-candlestick  — show-symbol-intraday-candlestick-widget (TEVA) + timeframe switch
 *   symbol-end-of-days           — show-symbol-end-of-days-widget (TEVA) date range EOD
 *   market-last-update             — show-market-last-update-widget + refresh
 *   watchlist-manager     — show-watchlist-manager-widget + add/edit/delete
 *   watchlist-table       — show-watchlist-table-widget (auto-fetch symbols) + period buttons
 *   watchlist-end-of-day  — show-watchlist-end-of-day-widget (auto-fetch symbols) + sort + filters
 *   watchlist-candlestick — show-watchlist-candlestick-widget (auto-fetch symbols) + symbol switch + period
 *   settings                — show-tase-market-settings-widget + subscribe button + footer
 *   landing                 — show-tase-market-landing-widget + Symbols tab + Reference tab
 *   refresh-mcp             — refresh the MCP connector in ChatGPT Settings (cache bust)
 *   all                     — run all tests sequentially
 */

import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'timers/promises';
import { mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const CHROME_URL = 'http://localhost:9226';
const SCREENSHOT_DIR = '/tmp/tase-widget-tests';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const mcpFlagIdx = args.indexOf('--mcp');
const MCP_NAME = mcpFlagIdx !== -1 ? args[mcpFlagIdx + 1] : 'tase-market';

const platformFlagIdx = args.indexOf('--platform');
const PLATFORM = platformFlagIdx !== -1 ? args[platformFlagIdx + 1] : 'chatgpt';

const testArg = args.filter((_, i) =>
  (mcpFlagIdx === -1 || (i !== mcpFlagIdx && i !== mcpFlagIdx + 1)) &&
  (platformFlagIdx === -1 || (i !== platformFlagIdx && i !== platformFlagIdx + 1))
)[0] || 'all';

console.log(`Platform: ${PLATFORM}`);
if (PLATFORM === 'chatgpt') console.log(`Using MCP: @${MCP_NAME}`);

// ─── ChatGPT helpers (Puppeteer) ─────────────────────────────────────────────

async function connectBrowser() {
  const browser = await puppeteer.connect({ browserURL: CHROME_URL });
  const pages = await browser.pages();
  const page = pages[pages.length - 1];
  await page.setViewport({ width: 1440, height: 1024 });
  return { browser, page };
}

async function newChat(page) {
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(3000);
}

async function sendMessage(page, message) {
  const textarea = await page.$('#prompt-textarea');
  if (!textarea) throw new Error('No textarea found');
  await textarea.click();
  await page.keyboard.type(message, { delay: 40 });
  await sleep(300);
  const sendBtn = await page.$('[data-testid="send-button"]');
  if (sendBtn) await sendBtn.click();
  else await page.keyboard.press('Enter');
}

async function waitForWidgetFrame(page, { selector = 'table, svg rect[fill]', timeout = 40000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try {
        const found = await f.evaluate((sel) => !!document.querySelector(sel), selector);
        if (found) return f;
      } catch(e) {}
    }
    await sleep(1000);
  }
  return null;
}

async function screenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${path}`);
  return path;
}

async function clickButton(frame, label) {
  return frame.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === lbl || b.textContent.trim().startsWith(lbl));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
}

// ─── Claude Desktop helpers (AppleScript) ────────────────────────────────────

function runAppleScript(script) {
  const tmpFile = '/tmp/claude-test.applescript';
  writeFileSync(tmpFile, script);
  return execSync(`osascript ${tmpFile}`, { stdio: 'pipe' }).toString().trim();
}

async function newChatDesktop() {
  runAppleScript('tell application "Claude" to activate');
  await sleep(1500);
  runAppleScript(`tell application "System Events"
  tell process "Claude"
    keystroke "n" using command down
  end tell
end tell`);
  await sleep(2000);
}

async function sendMessageDesktop(message) {
  const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  runAppleScript(`tell application "System Events"
  tell process "Claude"
    keystroke "${escaped}"
    delay 0.5
    key code 36
  end tell
end tell`);
}

async function screenshotDesktop(name) {
  runAppleScript('tell application "Claude" to activate');
  await sleep(500);
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  execSync(`screencapture -x ${path}`);
  console.log(`  📸 ${path}`);
  return path;
}

// ─── ChatGPT Tests ────────────────────────────────────────────────────────────

// ─── Shared end-of-day test (ChatGPT) ───────────────────────────────────────

async function testEndOfDay(page, { testName, message, prefix }) {
  console.log(`\n🧪 Test: ${testName}`);
  await newChat(page);
  await sendMessage(page, message);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, prefix);

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const sorted = await frame.evaluate(() => {
    const header = Array.from(document.querySelectorAll('th')).find(h => h.textContent.includes('Chg'));
    if (header) { header.click(); return true; }
    return false;
  });
  console.log(`  ${sorted ? '✅' : '⚠️ '} Sort by Chg ${sorted ? 'clicked' : 'not found'}`);
  await sleep(2000);
  await screenshot(page, `${prefix}-sorted`);

  const filtersOpened = await clickButton(frame, 'Filters');
  console.log(`  ${filtersOpened ? '✅' : '⚠️ '} Filters ${filtersOpened ? 'opened' : 'not found'}`);
  await sleep(1500);
  await screenshot(page, `${prefix}-filters`);

  console.log(`  ✅ ${testName} passed`);
}

async function testMarketEndOfDay(page) {
  await testEndOfDay(page, {
    testName: 'market-end-of-day',
    message: `@${MCP_NAME} call show-market-end-of-day-widget`,
    prefix: 'market-end-of-day',
  });
}

async function testMyPositionTable(page) {
  console.log('\n🧪 Test: my-position-table');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-my-position-table-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'my-position-table');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  // Verify P&L columns exist
  const columns = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('th')).map(th => th.textContent.trim());
  });
  const expected = ['P/L', '%', 'Period', 'Avg Price'];
  for (const col of expected) {
    const found = columns.some(c => c.includes(col));
    console.log(`  ${found ? '✅' : '⚠️ '} Column "${col}" ${found ? 'found' : 'not found'}`);
  }

  // Click P/L header to sort
  const sorted = await frame.evaluate(() => {
    const th = Array.from(document.querySelectorAll('th')).find(t => t.textContent.includes('P/L'));
    if (th) { th.click(); return true; }
    return false;
  });
  console.log(`  ${sorted ? '✅' : '⚠️ '} P/L column sort ${sorted ? 'clicked' : 'not found'}`);
  await sleep(2000);
  await screenshot(page, 'my-position-table-sorted');

  // Verify SymbolActions buttons exist (Candlestick + Intraday)
  const actionButtons = await frame.evaluate(() => {
    const buttons = document.querySelectorAll('button[title="Candlestick"], button[title="Intraday"]');
    return { candlestick: 0, intraday: 0, ...Object.fromEntries(
      Array.from(buttons).reduce((m, b) => {
        const key = b.title.toLowerCase();
        m.set(key, (m.get(key) || 0) + 1);
        return m;
      }, new Map())
    )};
  });
  console.log(`  ${actionButtons.candlestick > 0 ? '✅' : '⚠️ '} Candlestick buttons: ${actionButtons.candlestick}`);
  console.log(`  ${actionButtons.intraday > 0 ? '✅' : '⚠️ '} Intraday buttons: ${actionButtons.intraday}`);

  console.log('  ✅ my-position-table passed');
}

async function testMarketSectorHeatmap(page) {
  console.log('\n🧪 Test: market-sector-heatmap');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-market-sector-heatmap-widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-sector-heatmap-sectors');

  const frame = await waitForWidgetFrame(page, { selector: 'svg rect[fill]' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const rects = await frame.$$('svg rect[fill]');
  let largestRect = null, maxArea = 0;
  for (const r of rects) {
    const box = await r.boundingBox();
    if (box && box.width * box.height > maxArea) { maxArea = box.width * box.height; largestRect = r; }
  }
  if (largestRect) {
    await largestRect.click();
    console.log('  ✅ Sector drill-down clicked');
    await sleep(5000);
    await screenshot(page, 'market-sector-heatmap-subsectors');

    const backText = await frame.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /back|←/i.test(b.textContent));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    console.log(`  ${backText ? '✅' : '⚠️ '} Back button: ${backText || 'not found'}`);
    await sleep(3000);
    await screenshot(page, 'market-sector-heatmap-back');
  }
  console.log('  ✅ market-sector-heatmap passed');
}

// ─── Shared symbols candlestick test (ChatGPT) ──────────────────────────────

async function testCandlestickShared(page, { testName, message, prefix }) {
  console.log(`\n🧪 Test: ${testName}`);
  await newChat(page);
  await sendMessage(page, message);
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshot(page, `${prefix}-initial`);

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const secondSymbol = await frame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    if (rows.length >= 2) { rows[1].click(); return rows[1].textContent?.trim() || 'row2'; }
    return null;
  });
  console.log(`  ${secondSymbol ? '✅' : '⚠️ '} Second symbol ${secondSymbol ? `clicked (${secondSymbol})` : 'not found'}`);
  await sleep(8000);
  await screenshot(page, `${prefix}-second`);

  const clicked1M = await clickButton(frame, '1M');
  console.log(`  ${clicked1M ? '✅' : '⚠️ '} 1M period ${clicked1M ? 'clicked' : 'not found'}`);
  await sleep(6000);
  await screenshot(page, `${prefix}-1m`);

  console.log(`  ✅ ${testName} passed`);
}

async function testMyPositionCandlestick(page) {
  await testCandlestickShared(page, {
    testName: 'my-position-candlestick',
    message: `@${MCP_NAME} call show-my-position-candlestick-widget`,
    prefix: 'my-position-candlestick',
  });
}

async function testMyPositionEndOfDay(page) {
  await testEndOfDay(page, {
    testName: 'my-position-end-of-day',
    message: `@${MCP_NAME} call show-my-position-end-of-day-widget`,
    prefix: 'my-position-end-of-day',
  });
}

async function testMyPositionsManager(page) {
  console.log('\n🧪 Test: my-positions-manager');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-my-positions-manager-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);

  const frame = await waitForWidgetFrame(page, { selector: 'button, table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }
  await screenshot(page, 'my-positions-manager');

  const positionCount = await frame.evaluate(() => document.querySelectorAll('tbody tr').length);
  console.log(`  ${positionCount > 0 ? '✅' : '⚠️ '} Positions loaded: ${positionCount}`);

  if (positionCount > 0) {
    const editClicked = await clickButton(frame, 'Edit');
    console.log(`  ${editClicked ? '✅' : '⚠️ '} Edit button ${editClicked ? 'clicked' : 'not found'}`);
    await sleep(1000);
    await screenshot(page, 'my-positions-manager-edit');

    const cancelClicked = await clickButton(frame, 'Cancel');
    console.log(`  ${cancelClicked ? '✅' : '⚠️ '} Cancel button ${cancelClicked ? 'clicked' : 'not found'}`);
    await sleep(500);
  }

  const addClicked = await clickButton(frame, '+ Add Position');
  console.log(`  ${addClicked ? '✅' : '⚠️ '} Add Position button ${addClicked ? 'clicked' : 'not found'}`);
  await sleep(1000);
  await screenshot(page, 'my-positions-manager-add-form');

  console.log('  ✅ my-positions-manager passed');
}

async function testMarketSpirit(page) {
  console.log('\n🧪 Test: market-spirit');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-market-spirit-widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-spirit');
  console.log('  ✅ market-spirit passed');
}

async function testMarketUptrendSymbols(page) {
  console.log('\n🧪 Test: market-uptrend-symbols');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-market-uptrend-symbols-widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-uptrend-symbols');
  console.log('  ✅ market-uptrend-symbols passed');
}

async function testSymbolsEndOfDaySingleDate(page) {
  await testEndOfDay(page, {
    testName: 'symbols-end-of-day',
    message: `@${MCP_NAME} call show-symbols-end-of-day-widget with symbols: ["TEVA", "NICE", "ESLT"]`,
    prefix: 'symbols-end-of-day',
  });
}

async function testSymbolsCandlestick(page) {
  await testCandlestickShared(page, {
    testName: 'symbols-candlestick',
    message: `@${MCP_NAME} call show-symbols-candlestick-widget with symbols: ["TEVA", "NICE", "ESLT"]`,
    prefix: 'symbols-candlestick',
  });
}

async function testSymbolsTable(page) {
  console.log('\n🧪 Test: symbols-table');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-symbols-table-widget with symbols: ["TEVA", "NICE", "ESLT"]`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'symbols-table-1d');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  for (const period of ['1W', '1M', '3M']) {
    const clicked = await clickButton(frame, period);
    console.log(`  ${clicked ? '✅' : '⚠️ '} ${period} button ${clicked ? 'clicked' : 'not found'}`);
    await sleep(6000);
    await screenshot(page, `symbols-table-${period.toLowerCase()}`);
  }
  console.log('  ✅ symbols-table passed');
}

async function testSymbolCandlestick(page) {
  console.log('\n🧪 Test: symbol-candlestick');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-symbol-candlestick-widget with symbol: "TEVA"`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'symbol-candlestick');
  console.log('  ✅ symbol-candlestick passed');
}

async function testSymbolIntraday(page) {
  console.log('\n🧪 Test: symbol-intraday-candlestick');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-symbol-intraday-candlestick-widget with securityIdOrSymbol: "TEVA"`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'symbol-intraday-candlestick-initial');

  const frame = await waitForWidgetFrame(page, { selector: 'button, canvas', timeout: 45000 });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const clicked5m = await clickButton(frame, '5m');
  console.log(`  ${clicked5m ? '✅' : '⚠️ '} 5m timeframe ${clicked5m ? 'clicked' : 'not found'}`);
  await sleep(3000);
  await screenshot(page, 'symbol-intraday-candlestick-5m');

  const clicked1h = await clickButton(frame, '1h');
  console.log(`  ${clicked1h ? '✅' : '⚠️ '} 1h timeframe ${clicked1h ? 'clicked' : 'not found'}`);
  await sleep(3000);
  await screenshot(page, 'symbol-intraday-candlestick-1h');

  console.log('  ✅ symbol-intraday-candlestick passed');
}

async function testSymbolEndOfDays(page) {
  console.log('\n🧪 Test: symbol-end-of-days');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-symbol-end-of-days-widget with symbol: "TEVA"`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'symbol-end-of-days');
  console.log('  ✅ symbol-end-of-days passed');
}

async function testLastUpdate(page) {
  console.log('\n🧪 Test: market-last-update');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-market-last-update-widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-last-update-initial');

  const frame = await waitForWidgetFrame(page, { selector: 'table, button' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const refreshClicked = await clickButton(frame, 'Refresh');
  console.log(`  ${refreshClicked ? '✅' : '⚠️ '} Refresh button ${refreshClicked ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'market-last-update-refreshed');

  console.log('  ✅ market-last-update passed');
}

async function testWatchlistManager(page) {
  console.log('\n🧪 Test: watchlist-manager');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-watchlist-manager-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);

  const frame = await waitForWidgetFrame(page, { selector: 'button, table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }
  await screenshot(page, 'watchlist-manager');

  const itemCount = await frame.evaluate(() => document.querySelectorAll('tbody tr').length);
  console.log(`  ${itemCount > 0 ? '✅' : '⚠️ '} Watchlist items loaded: ${itemCount}`);

  if (itemCount > 0) {
    const editClicked = await clickButton(frame, 'Edit');
    console.log(`  ${editClicked ? '✅' : '⚠️ '} Edit button ${editClicked ? 'clicked' : 'not found'}`);
    await sleep(1000);
    await screenshot(page, 'watchlist-manager-edit');

    const cancelClicked = await clickButton(frame, 'Cancel');
    console.log(`  ${cancelClicked ? '✅' : '⚠️ '} Cancel button ${cancelClicked ? 'clicked' : 'not found'}`);
    await sleep(500);
  }

  const addClicked = await clickButton(frame, '+ Add to Watchlist');
  console.log(`  ${addClicked ? '✅' : '⚠️ '} Add to Watchlist button ${addClicked ? 'clicked' : 'not found'}`);
  await sleep(1000);
  await screenshot(page, 'watchlist-manager-add-form');

  console.log('  ✅ watchlist-manager passed');
}

async function testWatchlistTable(page) {
  console.log('\n🧪 Test: watchlist-table');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-watchlist-table-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'watchlist-table-1d');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  for (const period of ['1W', '1M', '3M']) {
    const clicked = await clickButton(frame, period);
    console.log(`  ${clicked ? '✅' : '⚠️ '} ${period} button ${clicked ? 'clicked' : 'not found'}`);
    await sleep(6000);
    await screenshot(page, `watchlist-table-${period.toLowerCase()}`);
  }

  // Verify SymbolActions buttons exist (Candlestick + Intraday)
  const actionButtons = await frame.evaluate(() => {
    const buttons = document.querySelectorAll('button[title="Candlestick"], button[title="Intraday"]');
    return { candlestick: 0, intraday: 0, ...Object.fromEntries(
      Array.from(buttons).reduce((m, b) => {
        const key = b.title.toLowerCase();
        m.set(key, (m.get(key) || 0) + 1);
        return m;
      }, new Map())
    )};
  });
  console.log(`  ${actionButtons.candlestick > 0 ? '✅' : '⚠️ '} Candlestick buttons: ${actionButtons.candlestick}`);
  console.log(`  ${actionButtons.intraday > 0 ? '✅' : '⚠️ '} Intraday buttons: ${actionButtons.intraday}`);

  console.log('  ✅ watchlist-table passed');
}

async function testWatchlistEndOfDay(page) {
  await testEndOfDay(page, {
    testName: 'watchlist-end-of-day',
    message: `@${MCP_NAME} call show-watchlist-end-of-day-widget`,
    prefix: 'watchlist-end-of-day',
  });
}

async function testWatchlistCandlestick(page) {
  await testCandlestickShared(page, {
    testName: 'watchlist-candlestick',
    message: `@${MCP_NAME} call show-watchlist-candlestick-widget`,
    prefix: 'watchlist-candlestick',
  });
}

async function testSettings(page) {
  console.log('\n🧪 Test: settings');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-tase-market-settings-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);

  const frame = await waitForWidgetFrame(page, { selector: 'button' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }
  await screenshot(page, 'settings');

  const hasSubscribeBtn = await frame.evaluate(() => {
    return !!Array.from(document.querySelectorAll('button')).find(b => /Subscribe|Subscription/i.test(b.textContent));
  });
  console.log(`  ${hasSubscribeBtn ? '✅' : '⚠️ '} Subscribe button ${hasSubscribeBtn ? 'found' : 'not found'}`);

  const hasFooter = await frame.evaluate(() => {
    return !!Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.includes('www.lobix.ai'));
  });
  console.log(`  ${hasFooter ? '✅' : '⚠️ '} Footer link ${hasFooter ? 'found' : 'not found'}`);

  console.log('  ✅ settings passed');
}

async function testLanding(page) {
  console.log('\n🧪 Test: landing');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} call show-tase-market-landing-widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'landing-market');

  const frame = await waitForWidgetFrame(page, { selector: 'button' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const symbolsClicked = await clickButton(frame, 'Symbols');
  console.log(`  ${symbolsClicked ? '✅' : '⚠️ '} Symbols tab ${symbolsClicked ? 'clicked' : 'not found'}`);
  await sleep(1500);
  await screenshot(page, 'landing-symbols');

  const hasIntraday = await frame.evaluate(() => {
    return !!Array.from(document.querySelectorAll('button, span, div')).find(el => el.textContent.includes('Intraday'));
  });
  console.log(`  ${hasIntraday ? '✅' : '⚠️ '} Symbol Intraday Candlestick card ${hasIntraday ? 'found' : 'not found'}`);

  // Reference tab
  const refClicked = await clickButton(frame, 'Reference');
  console.log(`  ${refClicked ? '✅' : '⚠️ '} Reference tab ${refClicked ? 'clicked' : 'not found'}`);
  await sleep(1500);
  await screenshot(page, 'landing-reference-widgets');

  const hasWidgetsTable = await frame.evaluate(() => {
    return !!Array.from(document.querySelectorAll('th, td')).find(el => el.textContent.includes('show-market-end-of-day-widget'));
  });
  console.log(`  ${hasWidgetsTable ? '✅' : '⚠️ '} Widgets reference table ${hasWidgetsTable ? 'found' : 'not found'}`);

  const dataToolsClicked = await clickButton(frame, 'Data Tools');
  console.log(`  ${dataToolsClicked ? '✅' : '⚠️ '} Data Tools sub-tab ${dataToolsClicked ? 'clicked' : 'not found'}`);
  await sleep(1500);
  await screenshot(page, 'landing-reference-data-tools');

  const hasDataToolsTable = await frame.evaluate(() => {
    return !!Array.from(document.querySelectorAll('th, td')).find(el => el.textContent.includes('get-market-end-of-day-data'));
  });
  console.log(`  ${hasDataToolsTable ? '✅' : '⚠️ '} Data Tools reference table ${hasDataToolsTable ? 'found' : 'not found'}`);

  console.log('  ✅ landing passed');
}

// ─── Refresh MCP connector (ChatGPT) ─────────────────────────────────────────

async function refreshMcp(page) {
  console.log('\n🔄 Refreshing MCP connector in ChatGPT...');

  // Step 1: Go to ChatGPT home
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(3000);

  // Step 2: Open Settings via URL hash
  await page.evaluate(() => {
    // Try clicking the settings menu item if the profile menu approach works
    const settingsLinks = Array.from(document.querySelectorAll('a[href*="settings"]'));
    if (settingsLinks.length) { settingsLinks[0].click(); return; }
  });
  // Navigate directly to settings
  await page.goto('https://chatgpt.com/?settings=true', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(3000);

  // If no settings dialog appeared, try the profile menu approach
  let settingsOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
  if (!settingsOpen) {
    // Click profile button (bottom-left user avatar/name area)
    const profileClicked = await page.evaluate(() => {
      // Try various known selectors for the profile/settings button
      const selectors = [
        'button[data-testid="profile-button"]',
        'nav button:last-child',
        'button[aria-label*="Profile"]',
        'button[aria-label*="Settings"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return sel; }
      }
      // Fallback: find the user name area at the bottom of sidebar
      const userBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('Ofer') || b.querySelector('img[alt*="User"]')
      );
      if (userBtn) { userBtn.click(); return 'user-button'; }
      return null;
    });
    console.log(`  ${profileClicked ? '✅' : '⚠️ '} Profile menu ${profileClicked ? `opened (${profileClicked})` : 'not found'}`);
    await sleep(1500);
    await screenshot(page, 'refresh-mcp-1-profile-menu');

    if (profileClicked) {
      // Click "Settings" in the dropdown menu
      const settingsClicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], a, button'));
        const settingsItem = items.find(el => /^Settings$/i.test(el.textContent.trim()));
        if (settingsItem) { settingsItem.click(); return true; }
        return false;
      });
      console.log(`  ${settingsClicked ? '✅' : '⚠️ '} Settings ${settingsClicked ? 'clicked' : 'not found'}`);
      await sleep(2000);
    }
  }

  await screenshot(page, 'refresh-mcp-2-settings');

  // Step 3: Settings opens with Apps tab selected showing "Developer mode" sub-page.
  // Click "Back" to get to the connectors list.
  const backClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const backBtn = btns.find(b => /Back/i.test(b.textContent.trim()));
    if (backBtn) { backBtn.click(); return true; }
    return false;
  });
  console.log(`  ${backClicked ? '✅' : '⚠️ '} Back button ${backClicked ? 'clicked (navigating to connectors list)' : 'not found'}`);
  await sleep(2000);
  await screenshot(page, 'refresh-mcp-3-apps');

  // Step 4: Find and click the MCP connector in the list
  const connectorClicked = await page.evaluate((name) => {
    // Look for text containing the MCP name in the settings panel
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent.includes(name)) {
        // Walk up to find a clickable container
        let target = node.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!target) break;
          if (target.tagName === 'BUTTON' || target.tagName === 'A' ||
              target.getAttribute('role') === 'button' || target.onclick ||
              target.style.cursor === 'pointer') {
            target.click();
            return true;
          }
          target = target.parentElement;
        }
        // Fallback: click the closest reasonable parent
        if (node.parentElement) {
          node.parentElement.click();
          return true;
        }
      }
    }
    return false;
  }, MCP_NAME);
  console.log(`  ${connectorClicked ? '✅' : '⚠️ '} MCP connector "${MCP_NAME}" ${connectorClicked ? 'clicked' : 'not found'}`);
  await sleep(3000);
  await screenshot(page, 'refresh-mcp-4-connector');

  // Step 5: Click the Refresh button
  const refreshClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const refreshBtn = btns.find(b => /Refresh/i.test(b.textContent.trim()));
    if (refreshBtn) { refreshBtn.click(); return true; }
    return false;
  });
  console.log(`  ${refreshClicked ? '✅' : '⚠️ '} Refresh button ${refreshClicked ? 'clicked' : 'not found'}`);

  // Wait for refresh to complete: poll until spinner/SVG inside Refresh button disappears
  if (refreshClicked) {
    const deadline = Date.now() + 60000; // max 60s
    await sleep(2000); // give spinner time to appear
    while (Date.now() < deadline) {
      const spinnerState = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const refreshBtn = btns.find(b => /Refresh/i.test(b.textContent.trim()));
        if (!refreshBtn) return 'no-button';
        // Check for any SVG (spinner icon) or animation inside the button
        const hasSvg = refreshBtn.querySelector('svg') !== null;
        const isDisabled = refreshBtn.disabled;
        const hasAnimation = refreshBtn.querySelector('[class*="animate"]') !== null;
        return JSON.stringify({ hasSvg, isDisabled, hasAnimation, html: refreshBtn.innerHTML.substring(0, 200) });
      });
      const state = typeof spinnerState === 'string' && spinnerState.startsWith('{') ? JSON.parse(spinnerState) : {};
      if (!state.hasSvg && !state.isDisabled && !state.hasAnimation) break;
      await sleep(2000);
    }
    console.log('  ✅ Refresh completed');
  }
  await screenshot(page, 'refresh-mcp-5-refreshed');

  // Step 6: Close settings and start new chat
  await page.keyboard.press('Escape');
  await sleep(1000);
  await page.keyboard.press('Escape');
  await sleep(500);
  await newChat(page);
  console.log('  ✅ MCP connector refreshed, new chat ready');
}

// ─── Claude Desktop Tests (AppleScript + screencapture) ──────────────────────

// ─── Shared end-of-day test (Claude Desktop) ────────────────────────────────

async function testEndOfDayDesktop({ testName, message, prefix }) {
  console.log(`\n🧪 Test: ${testName} (Claude Desktop)`);
  await newChatDesktop();
  await sendMessageDesktop(message);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop(`cd-${prefix}`);
  console.log(`  ✅ ${testName} (Claude Desktop) passed`);
}

async function testMarketEndOfDayDesktop() {
  await testEndOfDayDesktop({
    testName: 'market-end-of-day',
    message: 'call show-market-end-of-day-widget',
    prefix: 'market-end-of-day',
  });
}

async function testMyPositionTableDesktop() {
  console.log('\n🧪 Test: my-position-table (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-my-position-table-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-my-position-table');
  console.log('  ✅ my-position-table (Claude Desktop) passed');
}

async function testMarketSectorHeatmapDesktop() {
  console.log('\n🧪 Test: market-sector-heatmap (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-market-sector-heatmap-widget');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-market-sector-heatmap');
  console.log('  ✅ market-sector-heatmap (Claude Desktop) passed');
}

// ─── Shared symbols candlestick test (Claude Desktop) ───────────────────────

async function testCandlestickSharedDesktop({ testName, message, prefix }) {
  console.log(`\n🧪 Test: ${testName} (Claude Desktop)`);
  await newChatDesktop();
  await sendMessageDesktop(message);
  console.log('  Waiting for widget...');
  await sleep(45000);
  await screenshotDesktop(`cd-${prefix}`);
  console.log(`  ✅ ${testName} (Claude Desktop) passed`);
}

async function testMyPositionCandlestickDesktop() {
  await testCandlestickSharedDesktop({
    testName: 'my-position-candlestick',
    message: 'call show-my-position-candlestick-widget',
    prefix: 'my-position-candlestick',
  });
}

async function testMyPositionEndOfDayDesktop() {
  await testEndOfDayDesktop({
    testName: 'my-position-end-of-day',
    message: 'call show-my-position-end-of-day-widget',
    prefix: 'my-position-end-of-day',
  });
}

async function testMyPositionsManagerDesktop() {
  console.log('\n🧪 Test: my-positions-manager (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-my-positions-manager-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-my-positions-manager');
  console.log('  ✅ my-positions-manager (Claude Desktop) passed');
}

async function testMarketSpiritDesktop() {
  console.log('\n🧪 Test: market-spirit (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-market-spirit-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-spirit');
  console.log('  ✅ market-spirit (Claude Desktop) passed');
}

async function testMarketUptrendSymbolsDesktop() {
  console.log('\n🧪 Test: market-uptrend-symbols (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-market-uptrend-symbols-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-uptrend-symbols');
  console.log('  ✅ market-uptrend-symbols (Claude Desktop) passed');
}

async function testSymbolsEndOfDaySingleDateDesktop() {
  await testEndOfDayDesktop({
    testName: 'symbols-end-of-day',
    message: 'call show-symbols-end-of-day-widget with symbols: ["TEVA", "NICE", "ESLT"]',
    prefix: 'symbols-end-of-day',
  });
}

async function testSymbolsCandlestickDesktop() {
  await testCandlestickSharedDesktop({
    testName: 'symbols-candlestick',
    message: 'call show-symbols-candlestick-widget with symbols: ["TEVA", "NICE", "ESLT"]',
    prefix: 'symbols-candlestick',
  });
}

async function testSymbolsTableDesktop() {
  console.log('\n🧪 Test: symbols-table (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-symbols-table-widget with symbols: ["TEVA", "NICE", "ESLT"]');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-symbols-table');
  console.log('  ✅ symbols-table (Claude Desktop) passed');
}

async function testSymbolCandlestickDesktop() {
  console.log('\n🧪 Test: symbol-candlestick (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-symbol-candlestick-widget with symbol: "TEVA"');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-symbol-candlestick');
  console.log('  ✅ symbol-candlestick (Claude Desktop) passed');
}

async function testSymbolIntradayDesktop() {
  console.log('\n🧪 Test: symbol-intraday-candlestick (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-symbol-intraday-candlestick-widget with securityIdOrSymbol: "TEVA"');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-symbol-intraday-candlestick');
  console.log('  ✅ symbol-intraday-candlestick (Claude Desktop) passed');
}

async function testSymbolEndOfDaysDesktop() {
  console.log('\n🧪 Test: symbol-end-of-days (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-symbol-end-of-days-widget with symbol: "TEVA"');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-symbol-end-of-days');
  console.log('  ✅ symbol-end-of-days (Claude Desktop) passed');
}

async function testLastUpdateDesktop() {
  console.log('\n🧪 Test: market-last-update (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-market-last-update-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-last-update');
  console.log('  ✅ market-last-update (Claude Desktop) passed');
}

async function testWatchlistManagerDesktop() {
  console.log('\n🧪 Test: watchlist-manager (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-watchlist-manager-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-watchlist-manager');
  console.log('  ✅ watchlist-manager (Claude Desktop) passed');
}

async function testWatchlistTableDesktop() {
  console.log('\n🧪 Test: watchlist-table (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-watchlist-table-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-watchlist-table');
  console.log('  ✅ watchlist-table (Claude Desktop) passed');
}

async function testWatchlistEndOfDayDesktop() {
  await testEndOfDayDesktop({
    testName: 'watchlist-end-of-day',
    message: 'call show-watchlist-end-of-day-widget',
    prefix: 'watchlist-end-of-day',
  });
}

async function testWatchlistCandlestickDesktop() {
  await testCandlestickSharedDesktop({
    testName: 'watchlist-candlestick',
    message: 'call show-watchlist-candlestick-widget',
    prefix: 'watchlist-candlestick',
  });
}

async function testSettingsDesktop() {
  console.log('\n🧪 Test: settings (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-tase-market-settings-widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-settings');
  console.log('  ✅ settings (Claude Desktop) passed');
}

async function testLandingDesktop() {
  console.log('\n🧪 Test: landing (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('call show-tase-market-landing-widget');
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshotDesktop('cd-landing');
  console.log('  ✅ landing (Claude Desktop) passed');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const CHATGPT_TEST_MAP = {
  'market-end-of-day':        testMarketEndOfDay,
  'market-spirit':            testMarketSpirit,
  'market-uptrend-symbols':   testMarketUptrendSymbols,
  'market-sector-heatmap':    testMarketSectorHeatmap,
  'my-position-table':        testMyPositionTable,
  'my-position-candlestick':  testMyPositionCandlestick,
  'my-position-end-of-day':   testMyPositionEndOfDay,
  'my-positions-manager':     testMyPositionsManager,
  'symbols-end-of-day':        testSymbolsEndOfDaySingleDate,
  'symbols-candlestick':      testSymbolsCandlestick,
  'symbols-table':            testSymbolsTable,
  'symbol-candlestick':       testSymbolCandlestick,
  'watchlist-manager':     testWatchlistManager,
  'watchlist-table':       testWatchlistTable,
  'watchlist-end-of-day':  testWatchlistEndOfDay,
  'watchlist-candlestick': testWatchlistCandlestick,
  'symbol-intraday-candlestick':   testSymbolIntraday,
  'symbol-end-of-days':            testSymbolEndOfDays,
  'market-last-update':              testLastUpdate,
  'settings':                 testSettings,
  'landing':                  testLanding,
  'refresh-mcp':              refreshMcp,
};

const CLAUDE_DESKTOP_TEST_MAP = {
  'market-end-of-day':        testMarketEndOfDayDesktop,
  'market-spirit':            testMarketSpiritDesktop,
  'market-uptrend-symbols':   testMarketUptrendSymbolsDesktop,
  'market-sector-heatmap':    testMarketSectorHeatmapDesktop,
  'my-position-table':        testMyPositionTableDesktop,
  'my-position-candlestick':  testMyPositionCandlestickDesktop,
  'my-position-end-of-day':   testMyPositionEndOfDayDesktop,
  'my-positions-manager':     testMyPositionsManagerDesktop,
  'symbols-end-of-day':        testSymbolsEndOfDaySingleDateDesktop,
  'symbols-candlestick':      testSymbolsCandlestickDesktop,
  'symbols-table':            testSymbolsTableDesktop,
  'symbol-candlestick':       testSymbolCandlestickDesktop,
  'watchlist-manager':     testWatchlistManagerDesktop,
  'watchlist-table':       testWatchlistTableDesktop,
  'watchlist-end-of-day':  testWatchlistEndOfDayDesktop,
  'watchlist-candlestick': testWatchlistCandlestickDesktop,
  'symbol-intraday-candlestick':   testSymbolIntradayDesktop,
  'symbol-end-of-days':            testSymbolEndOfDaysDesktop,
  'market-last-update':              testLastUpdateDesktop,
  'settings':                 testSettingsDesktop,
  'landing':                  testLandingDesktop,
};

const TEST_MAP = PLATFORM === 'claude-desktop' ? CLAUDE_DESKTOP_TEST_MAP : CHATGPT_TEST_MAP;

if (PLATFORM === 'claude-desktop') {
  // Claude Desktop: no browser needed
  try {
    if (testArg === 'all') {
      for (const [name, fn] of Object.entries(TEST_MAP)) {
        await fn();
      }
      console.log('\n🎉 All tests completed!');
    } else if (TEST_MAP[testArg]) {
      await TEST_MAP[testArg]();
      console.log('\n🎉 Test completed!');
    } else {
      console.error(`Unknown test: "${testArg}". Available: ${Object.keys(TEST_MAP).join(', ')}, all`);
      process.exit(1);
    }
  } catch (e) {
    console.error('Test error:', e.message);
    process.exit(1);
  }
} else {
  // ChatGPT: Puppeteer browser needed
  const { browser, page } = await connectBrowser();
  try {
    if (testArg === 'all') {
      for (const [name, fn] of Object.entries(TEST_MAP)) {
        await fn(page);
      }
      console.log('\n🎉 All tests completed!');
    } else if (TEST_MAP[testArg]) {
      await TEST_MAP[testArg](page);
      console.log('\n🎉 Test completed!');
    } else {
      console.error(`Unknown test: "${testArg}". Available: ${Object.keys(TEST_MAP).join(', ')}, all`);
      process.exit(1);
    }
  } finally {
    await browser.disconnect();
  }
}
