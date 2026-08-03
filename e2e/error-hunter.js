// e2e/error-hunter.js — Error Hunter-specific drivers on top of the generic harness.

const { waitFor, sleep } = require('./harness');

const TEST_PAGE = 'http://127.0.0.1:8080/tests/test-page.html';
const DATA_BUTTONS = ['btnLoadUsers', 'btnLoadOrders', 'btnLoadConfig', 'btnSlowError', 'btnXhrPost'];

async function openTestPage(session) {
  const page = await session.newTab(TEST_PAGE);
  await page.ready();
  return page;
}

// Open a clean test page with monitoring active and startup resource errors
// (e.g. favicon 404) already captured-and-cleared, so scenarios start empty.
async function preparePage(session) {
  await ensureMonitoring(session);
  const page = await openTestPage(session);
  await sleep(2500);
  await resetErrors(session);
  return page;
}

// Open the popup as a tab and click Start Monitoring. Keeps the popup open.
async function startMonitoring(session) {
  const popup = await session.openExtensionPage('src/popup.html');
  await popup.ready();
  await sleep(800);
  await popup.click('#btnStart');
  await sleep(1500);
  const v = await session.storageGet('error_hunter_active');
  if (!v.error_hunter_active) throw new Error('start_monitoring did not activate');
  return popup;
}

async function ensureMonitoring(session) {
  const v = await session.storageGet('error_hunter_active');
  if (v.error_hunter_active) return null;
  return startMonitoring(session);
}

// Direct storage reset (test infra, not under test). Clears errors + badge.
async function resetErrors(session) {
  const sw = await session.sw();
  await sw.eval(`chrome.storage.session.set({ error_hunter_errors: [] }); chrome.action.setBadgeText({ text: '' }); true`);
}

// Clear ignore rules + blocked counter (storage.local) for a deterministic scenario.
async function resetIgnoreState(session) {
  const sw = await session.sw();
  await sw.eval(`chrome.storage.local.set({ eh_ignore_rules: [], eh_blocked_count: 0 }); true`);
}

// Open the popup as a tab and wait until it has rendered `n` error rows.
async function openPopup(session, n) {
  const popup = await session.openExtensionPage('src/popup.html');
  await popup.ready();
  await waitFor(async () => {
    const count = await popup.eval(`document.querySelectorAll('.error-item').length`);
    return count === n;
  }, 10000);
  return popup;
}

async function readErrors(session) {
  const v = await session.storageGet('error_hunter_errors');
  return v.error_hunter_errors || [];
}

async function waitForErrors(session, predicate, timeoutMs = 20000) {
  return waitFor(async () => {
    const errs = await readErrors(session);
    return predicate(errs) ? errs : null;
  }, timeoutMs);
}

async function clickDataButtons(page, waitMs = 3200) {
  for (const id of DATA_BUTTONS) {
    await page.click('#' + id);
    await sleep(waitMs);
  }
}

async function clickButton(page, id, waitMs = 1200) {
  await page.click('#' + id);
  await sleep(waitMs);
}

// Expected messages for the 5 Data Loading buttons + broken image (s02).
const EXPECTED_NETWORK = [
  'Fetch GET http://127.0.0.1:8080/api/server-error returned 500',
  'XHR GET http://127.0.0.1:8080/api/not-found returned 404',
  'Fetch GET https://this-domain-does-not-exist-12345.com/config failed: Failed to fetch',
  'Fetch GET http://127.0.0.1:8080/api/slow-error returned 500',
  'XHR POST http://127.0.0.1:8080/api/xhr-error returned 500',
  'Resource img http://127.0.0.1:8080/api/not-found returned 404'
];

module.exports = {
  TEST_PAGE, DATA_BUTTONS, EXPECTED_NETWORK,
  openTestPage, preparePage, startMonitoring, ensureMonitoring, resetErrors, resetIgnoreState, openPopup,
  readErrors, waitForErrors, clickDataButtons, clickButton, sleep
};
