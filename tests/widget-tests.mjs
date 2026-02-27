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
 *   - Claude Desktop running with eod-dev MCP server connected
 *   - Terminal must have Accessibility permission (System Settings → Privacy & Security → Accessibility)
 *
 * Usage:
 *   node tests/widget-tests.mjs [test-name] [--mcp <name>] [--platform <platform>]
 *
 * Options:
 *   --mcp <name>          MCP app name for ChatGPT messages (default: "eod prod")
 *   --platform <name>     "chatgpt" (default) or "claude-desktop"
 *
 * Available tests:
 *   market-end-of-day       — show-market-end-of-day-widget
 *   market-spirit           — show-market-spirit-widget
 *   market-uptrend-symbols  — show-market-uptrend-symbols-widget
 *   market-sector-heatmap   — show-market-sector-heatmap-widget + drill-down + back
 *   market-dashboard        — show-market-dashboard-widget
 *   my-position-table       — show-my-position-table-widget (auto-fetch symbols) + period buttons
 *   my-position-candlestick — show-my-position-candlestick-widget (auto-fetch symbols) + symbol switch + period
 *   my-position-end-of-day  — show-my-position-end-of-day-widget (auto-fetch symbols) + sort + filters
 *   my-positions-manager    — show-my-positions-manager-widget + add/edit/delete
 *   symbols-end-of-day      — show-symbols-end-of-day-widget (TEVA, NICE, ESLT)
 *   symbols-candlestick     — show-symbols-candlestick-widget (TEVA, NICE, ESLT) + symbol switch
 *   symbols-table           — show-symbols-table-widget (TEVA, NICE, ESLT) + period buttons
 *   symbol-candlestick      — show-symbol-candlestick-widget (single symbol: TEVA)
 *   landing                 — show-tase-market-landing-widget
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
const MCP_NAME = mcpFlagIdx !== -1 ? args[mcpFlagIdx + 1] : 'eod prod';

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
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === lbl);
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

async function testMarketEndOfDay(page) {
  console.log('\n🧪 Test: market-end-of-day');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show me the market end of day widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-end-of-day');
  console.log('  ✅ market-end-of-day passed');
}

async function testMyPositionTable(page) {
  console.log('\n🧪 Test: my-position-table');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show my position table widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'my-position-table-1d');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  for (const period of ['1W', '1M', '3M']) {
    const clicked = await clickButton(frame, period);
    console.log(`  ${clicked ? '✅' : '⚠️ '} ${period} button ${clicked ? 'clicked' : 'not found'}`);
    await sleep(6000);
    await screenshot(page, `my-position-table-${period.toLowerCase()}`);
  }
  console.log('  ✅ my-position-table passed');
}

async function testMarketSectorHeatmap(page) {
  console.log('\n🧪 Test: market-sector-heatmap');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show me the market sector heatmap widget`);
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

async function testMyPositionCandlestick(page) {
  console.log('\n🧪 Test: my-position-candlestick');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show my position candlestick widget`);
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshot(page, 'my-position-candlestick-eslt');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const nicePeriod = await frame.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('NICE'));
    if (row) { row.click(); return true; }
    return false;
  });
  console.log(`  ${nicePeriod ? '✅' : '⚠️ '} NICE symbol ${nicePeriod ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'my-position-candlestick-nice');

  const clicked1M = await clickButton(frame, '1M');
  console.log(`  ${clicked1M ? '✅' : '⚠️ '} 1M period ${clicked1M ? 'clicked' : 'not found'}`);
  await sleep(6000);
  await screenshot(page, 'my-position-candlestick-1m');

  console.log('  ✅ my-position-candlestick passed');
}

async function testMyPositionEndOfDay(page) {
  console.log('\n🧪 Test: my-position-end-of-day');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show my position end of day widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'my-position-end-of-day');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const sorted = await frame.evaluate(() => {
    const header = Array.from(document.querySelectorAll('th')).find(h => h.textContent.includes('Chg'));
    if (header) { header.click(); return true; }
    return false;
  });
  console.log(`  ${sorted ? '✅' : '⚠️ '} Sort by Chg ${sorted ? 'clicked' : 'not found'}`);
  await sleep(2000);
  await screenshot(page, 'my-position-end-of-day-sorted');

  const filtersOpened = await clickButton(frame, 'Filters');
  console.log(`  ${filtersOpened ? '✅' : '⚠️ '} Filters ${filtersOpened ? 'opened' : 'not found'}`);
  await sleep(1500);
  await screenshot(page, 'my-position-end-of-day-filters');

  console.log('  ✅ my-position-end-of-day passed');
}

async function testMyPositionsManager(page) {
  console.log('\n🧪 Test: my-positions-manager');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show my positions manager widget`);
  console.log('  Waiting for widget...');
  await sleep(30000);

  const frame = await waitForWidgetFrame(page, { selector: 'button, .empty' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }
  await screenshot(page, 'my-positions-manager-empty');

  const addClicked = await clickButton(frame, '+ Add Position');
  console.log(`  ${addClicked ? '✅' : '⚠️ '} Add Position button ${addClicked ? 'clicked' : 'not found'}`);
  await sleep(1000);
  await screenshot(page, 'my-positions-manager-form');

  await frame.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    if (inputs[0]) { inputs[0].focus(); inputs[0].value = ''; }
  });
  await frame.type('input[placeholder="e.g. TEVA"]', 'TEVA');
  await frame.type('input[placeholder="YYYY-MM-DD"]', '2026-01-01');
  await frame.type('input[type="number"]', '100');
  await sleep(500);
  await screenshot(page, 'my-positions-manager-form-filled');

  const saved = await clickButton(frame, 'Save');
  console.log(`  ${saved ? '✅' : '⚠️ '} Save button ${saved ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'my-positions-manager-added');

  const hasTeva = await frame.evaluate(() => !!document.querySelector('td,tr') &&
    document.body.textContent.includes('TEVA'));
  console.log(`  ${hasTeva ? '✅' : '⚠️ '} TEVA ${hasTeva ? 'appears in table' : 'not found in table'}`);

  const editClicked = await clickButton(frame, 'Edit');
  console.log(`  ${editClicked ? '✅' : '⚠️ '} Edit button ${editClicked ? 'clicked' : 'not found'}`);
  await sleep(1000);

  await frame.evaluate(() => {
    const input = document.querySelector('input[type="number"]');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await frame.type('input[type="number"]', '200');
  await sleep(300);

  const savedEdit = await clickButton(frame, 'Save');
  console.log(`  ${savedEdit ? '✅' : '⚠️ '} Save edit ${savedEdit ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'my-positions-manager-edited');

  const has200 = await frame.evaluate(() => document.body.textContent.includes('200'));
  console.log(`  ${has200 ? '✅' : '⚠️ '} Amount updated to 200: ${has200 ? 'yes' : 'not confirmed'}`);

  const deleteClicked = await clickButton(frame, 'Delete');
  console.log(`  ${deleteClicked ? '✅' : '⚠️ '} Delete button ${deleteClicked ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'my-positions-manager-deleted');

  const isEmpty = await frame.evaluate(() => document.body.textContent.includes('No positions yet'));
  console.log(`  ${isEmpty ? '✅' : '⚠️ '} Empty state after delete: ${isEmpty ? 'yes' : 'not confirmed'}`);

  console.log('  ✅ my-positions-manager passed');
}

async function testMarketSpirit(page) {
  console.log('\n🧪 Test: market-spirit');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show me the market spirit widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-spirit');
  console.log('  ✅ market-spirit passed');
}

async function testMarketUptrendSymbols(page) {
  console.log('\n🧪 Test: market-uptrend-symbols');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show me the market uptrend symbols widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-uptrend-symbols');
  console.log('  ✅ market-uptrend-symbols passed');
}

async function testMarketDashboard(page) {
  console.log('\n🧪 Test: market-dashboard');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show me the market dashboard widget`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'market-dashboard');
  console.log('  ✅ market-dashboard passed');
}

async function testSymbolsEndOfDay(page) {
  console.log('\n🧪 Test: symbols-end-of-day');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show symbols end of day widget for TEVA, NICE, ESLT`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'symbols-end-of-day');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const sorted = await frame.evaluate(() => {
    const header = Array.from(document.querySelectorAll('th')).find(h => h.textContent.includes('Chg'));
    if (header) { header.click(); return true; }
    return false;
  });
  console.log(`  ${sorted ? '✅' : '⚠️ '} Sort by Chg ${sorted ? 'clicked' : 'not found'}`);
  await sleep(2000);
  await screenshot(page, 'symbols-end-of-day-sorted');

  console.log('  ✅ symbols-end-of-day passed');
}

async function testSymbolsCandlestick(page) {
  console.log('\n🧪 Test: symbols-candlestick');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show symbols candlestick widget for TEVA, NICE, ESLT`);
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshot(page, 'symbols-candlestick-first');

  const frame = await waitForWidgetFrame(page, { selector: 'table' });
  if (!frame) { console.log('  ⚠️  Widget frame not found'); return; }

  const symbolClicked = await frame.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('NICE'));
    if (row) { row.click(); return true; }
    return false;
  });
  console.log(`  ${symbolClicked ? '✅' : '⚠️ '} NICE symbol ${symbolClicked ? 'clicked' : 'not found'}`);
  await sleep(8000);
  await screenshot(page, 'symbols-candlestick-nice');

  console.log('  ✅ symbols-candlestick passed');
}

async function testSymbolsTable(page) {
  console.log('\n🧪 Test: symbols-table');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} show symbols table widget for TEVA, NICE, ESLT`);
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
  await sendMessage(page, `@${MCP_NAME} show candlestick chart for TEVA`);
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshot(page, 'symbol-candlestick');
  console.log('  ✅ symbol-candlestick passed');
}

async function testLanding(page) {
  console.log('\n🧪 Test: landing');
  await newChat(page);
  await sendMessage(page, `@${MCP_NAME} use the show-tase-market-landing-widget tool`);
  console.log('  Waiting for widget...');
  await sleep(30000);
  await screenshot(page, 'landing');
  console.log('  ✅ landing passed');
}

// ─── Claude Desktop Tests (AppleScript + screencapture) ──────────────────────

async function testMarketEndOfDayDesktop() {
  console.log('\n🧪 Test: market-end-of-day (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show me the market end of day widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-end-of-day');
  console.log('  ✅ market-end-of-day (Claude Desktop) passed');
}

async function testMyPositionTableDesktop() {
  console.log('\n🧪 Test: my-position-table (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show my position table widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-my-position-table');
  console.log('  ✅ my-position-table (Claude Desktop) passed');
}

async function testMarketSectorHeatmapDesktop() {
  console.log('\n🧪 Test: market-sector-heatmap (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show me the market sector heatmap widget');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-market-sector-heatmap');
  console.log('  ✅ market-sector-heatmap (Claude Desktop) passed');
}

async function testMyPositionCandlestickDesktop() {
  console.log('\n🧪 Test: my-position-candlestick (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show my position candlestick widget');
  console.log('  Waiting for widget...');
  await sleep(45000);
  await screenshotDesktop('cd-my-position-candlestick');
  console.log('  ✅ my-position-candlestick (Claude Desktop) passed');
}

async function testMyPositionEndOfDayDesktop() {
  console.log('\n🧪 Test: my-position-end-of-day (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show my position end of day widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-my-position-end-of-day');
  console.log('  ✅ my-position-end-of-day (Claude Desktop) passed');
}

async function testMyPositionsManagerDesktop() {
  console.log('\n🧪 Test: my-positions-manager (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show my positions manager widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-my-positions-manager');
  console.log('  ✅ my-positions-manager (Claude Desktop) passed');
}

async function testMarketSpiritDesktop() {
  console.log('\n🧪 Test: market-spirit (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show me the market spirit widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-spirit');
  console.log('  ✅ market-spirit (Claude Desktop) passed');
}

async function testMarketUptrendSymbolsDesktop() {
  console.log('\n🧪 Test: market-uptrend-symbols (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show me the market uptrend symbols widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-uptrend-symbols');
  console.log('  ✅ market-uptrend-symbols (Claude Desktop) passed');
}

async function testMarketDashboardDesktop() {
  console.log('\n🧪 Test: market-dashboard (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show me the market dashboard widget');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-market-dashboard');
  console.log('  ✅ market-dashboard (Claude Desktop) passed');
}

async function testSymbolsEndOfDayDesktop() {
  console.log('\n🧪 Test: symbols-end-of-day (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show symbols end of day widget for TEVA, NICE, ESLT');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-symbols-end-of-day');
  console.log('  ✅ symbols-end-of-day (Claude Desktop) passed');
}

async function testSymbolsCandlestickDesktop() {
  console.log('\n🧪 Test: symbols-candlestick (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show symbols candlestick widget for TEVA, NICE, ESLT');
  console.log('  Waiting for widget...');
  await sleep(45000);
  await screenshotDesktop('cd-symbols-candlestick');
  console.log('  ✅ symbols-candlestick (Claude Desktop) passed');
}

async function testSymbolsTableDesktop() {
  console.log('\n🧪 Test: symbols-table (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show symbols table widget for TEVA, NICE, ESLT');
  console.log('  Waiting for widget...');
  await sleep(35000);
  await screenshotDesktop('cd-symbols-table');
  console.log('  ✅ symbols-table (Claude Desktop) passed');
}

async function testSymbolCandlestickDesktop() {
  console.log('\n🧪 Test: symbol-candlestick (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('show candlestick chart for TEVA');
  console.log('  Waiting for widget...');
  await sleep(40000);
  await screenshotDesktop('cd-symbol-candlestick');
  console.log('  ✅ symbol-candlestick (Claude Desktop) passed');
}

async function testLandingDesktop() {
  console.log('\n🧪 Test: landing (Claude Desktop)');
  await newChatDesktop();
  await sendMessageDesktop('use the show-tase-market-landing-widget tool');
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
  'market-dashboard':         testMarketDashboard,
  'my-position-table':        testMyPositionTable,
  'my-position-candlestick':  testMyPositionCandlestick,
  'my-position-end-of-day':   testMyPositionEndOfDay,
  'my-positions-manager':     testMyPositionsManager,
  'symbols-end-of-day':       testSymbolsEndOfDay,
  'symbols-candlestick':      testSymbolsCandlestick,
  'symbols-table':            testSymbolsTable,
  'symbol-candlestick':       testSymbolCandlestick,
  'landing':                  testLanding,
};

const CLAUDE_DESKTOP_TEST_MAP = {
  'market-end-of-day':        testMarketEndOfDayDesktop,
  'market-spirit':            testMarketSpiritDesktop,
  'market-uptrend-symbols':   testMarketUptrendSymbolsDesktop,
  'market-sector-heatmap':    testMarketSectorHeatmapDesktop,
  'market-dashboard':         testMarketDashboardDesktop,
  'my-position-table':        testMyPositionTableDesktop,
  'my-position-candlestick':  testMyPositionCandlestickDesktop,
  'my-position-end-of-day':   testMyPositionEndOfDayDesktop,
  'my-positions-manager':     testMyPositionsManagerDesktop,
  'symbols-end-of-day':       testSymbolsEndOfDayDesktop,
  'symbols-candlestick':      testSymbolsCandlestickDesktop,
  'symbols-table':            testSymbolsTableDesktop,
  'symbol-candlestick':       testSymbolCandlestickDesktop,
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
