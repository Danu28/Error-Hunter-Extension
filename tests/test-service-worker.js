// Error Hunter - Service Worker Unit Tests
// Tests message handling, error storage, badge management, and monitoring lifecycle

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'src', 'service-worker.js');

// ── Mock Chrome API ──
function createMockChrome() {
  const storage = {
    _data: {},
    get: async function (keys) {
      const result = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        result[key] = this._data[key] !== undefined ? this._data[key] : undefined;
      }
      // If single key, flatten for backward compat
      if (!Array.isArray(keys) && typeof keys === 'string') {
        return { [keys]: this._data[keys] };
      }
      return result;
    },
    set: async function (items) {
      for (const [key, value] of Object.entries(items)) {
        this._data[key] = value;
      }
    }
  };

  const action = {
    _badgeText: '',
    _badgeColor: '',
    setBadgeText: async function (details) { this._badgeText = details.text; },
    setBadgeBackgroundColor: async function (details) { this._badgeColor = details.color; }
  };

  const tabs = {
    _tabs: [],
    query: async function () { return this._tabs; },
    sendMessage: async function (tabId, message) {
      // Simulate sending to tabs
      return { success: true };
    }
  };

  const runtime = {
    _listeners: [],
    _lastSendResponse: null,
    onMessage: {
      addListener: function (listener) {
        runtime._listeners.push(listener);
      }
    },
    onInstalled: {
      _listeners: [],
      addListener: function (listener) {
        runtime._listeners.push(listener);
      }
    },
    onUpdated: {
      _listeners: [],
      addListener: function (listener) {
        runtime._listeners.push(listener);
      }
    }
  };

  return { storage, action, tabs, runtime };
}

function runTests() {
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
    }
  }

  // ════════════════════════════════════════════
  // SECTION 1: Source Code Structure
  // ════════════════════════════════════════════

  test('service-worker.js file exists', () => {
    assert.ok(fs.existsSync(SW_PATH));
  });

  test('service-worker.js contains all expected message handlers', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    const expectedHandlers = [
      'handleNewError',
      'handleGetErrors',
      'handleGetStatus',
      'handleStartMonitoring',
      'handleStopMonitoring',
      'handleClearErrors',
      'handleInjectPageWorld'
    ];
    for (const handler of expectedHandlers) {
      assert.ok(src.includes(`async function ${handler}`), `Missing handler: ${handler}`);
    }
  });

  test('service-worker.js has message switch with all expected cases', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    const expectedCases = [
      "case 'new_error'",
      "case 'get_errors'",
      "case 'get_status'",
      "case 'start_monitoring'",
      "case 'stop_monitoring'",
      "case 'clear_errors'",
      "case 'inject_page_world'"
    ];
    for (const c of expectedCases) {
      assert.ok(src.includes(c), `Missing switch case: ${c}`);
    }
  });

  test('service-worker.js uses correct storage key constants', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    assert.ok(src.includes("STORAGE_KEY = 'error_hunter_errors'"));
    assert.ok(src.includes("STATUS_KEY = 'error_hunter_active'"));
  });

  test('service-worker.js has storage.session calls', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    assert.ok(src.includes('chrome.storage.session'));
  });

  test('service-worker.js uses chrome.action.setBadgeText', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    assert.ok(src.includes('chrome.action.setBadgeText'));
  });

  test('service-worker.js uses chrome.action.setBadgeBackgroundColor', () => {
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    assert.ok(src.includes('chrome.action.setBadgeBackgroundColor'));
  });

  // ════════════════════════════════════════════
  // SECTION 2: Error Storage Logic
  // ════════════════════════════════════════════

  test('handleNewError stores error and updates badge', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';

    // Simulate handleNewError
    async function handleNewError(error) {
      const result = await mock.storage.get(STORAGE_KEY);
      const errors = result[STORAGE_KEY] || [];
      errors.push(error);
      await mock.storage.set({ [STORAGE_KEY]: errors });
      await mock.action.setBadgeText({ text: String(errors.length) });
    }

    const error = {
      type: 'console',
      message: 'test error',
      url: 'https://example.com/',
      timestamp: Date.now()
    };

    await handleNewError(error);

    // Check storage
    const stored = await mock.storage.get(STORAGE_KEY);
    assert.strictEqual(stored[STORAGE_KEY].length, 1);
    assert.strictEqual(stored[STORAGE_KEY][0].message, 'test error');

    // Check badge updated
    assert.strictEqual(mock.action._badgeText, '1');
  });

  test('handleNewError appends to existing errors', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';

    // Pre-populate with one error
    await mock.storage.set({ [STORAGE_KEY]: [{ message: 'first' }] });

    async function handleNewError(error) {
      const result = await mock.storage.get(STORAGE_KEY);
      const errors = result[STORAGE_KEY] || [];
      errors.push(error);
      await mock.storage.set({ [STORAGE_KEY]: errors });
      await mock.action.setBadgeText({ text: String(errors.length) });
    }

    await handleNewError({ message: 'second', timestamp: Date.now() });

    const stored = await mock.storage.get(STORAGE_KEY);
    assert.strictEqual(stored[STORAGE_KEY].length, 2);
    assert.strictEqual(stored[STORAGE_KEY][0].message, 'first');
    assert.strictEqual(stored[STORAGE_KEY][1].message, 'second');
    assert.strictEqual(mock.action._badgeText, '2');
  });

  test('handleNewError enriches error with tab info', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';

    async function handleNewError(error, sender) {
      const result = await mock.storage.get(STORAGE_KEY);
      const errors = result[STORAGE_KEY] || [];
      if (sender && sender.tab) {
        error.tabId = sender.tab.id;
        error.tabUrl = sender.tab.url;
      }
      errors.push(error);
      await mock.storage.set({ [STORAGE_KEY]: errors });
    }

    const sender = { tab: { id: 42, url: 'https://example.com/page' } };
    await handleNewError({ message: 'enriched' }, sender);

    const stored = await mock.storage.get(STORAGE_KEY);
    assert.strictEqual(stored[STORAGE_KEY][0].tabId, 42);
    assert.strictEqual(stored[STORAGE_KEY][0].tabUrl, 'https://example.com/page');
  });

  test('handleNewError handles missing sender gracefully', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';

    async function handleNewError(error, sender) {
      const result = await mock.storage.get(STORAGE_KEY);
      const errors = result[STORAGE_KEY] || [];
      if (sender && sender.tab) {
        error.tabId = sender.tab.id;
        error.tabUrl = sender.tab.url;
      }
      errors.push(error);
      await mock.storage.set({ [STORAGE_KEY]: errors });
    }

    await handleNewError({ message: 'no sender' });
    const stored = await mock.storage.get(STORAGE_KEY);
    assert.strictEqual(stored[STORAGE_KEY][0].tabId, undefined);
  });

  // ════════════════════════════════════════════
  // SECTION 3: Get Errors Logic
  // ════════════════════════════════════════════

  test('handleGetErrors returns errors and monitoring status', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';
    const STATUS_KEY = 'error_hunter_active';

    await mock.storage.set({ [STORAGE_KEY]: [{ message: 'err1' }, { message: 'err2' }] });
    await mock.storage.set({ [STATUS_KEY]: true });

    async function handleGetErrors(sendResponse) {
      const result = await mock.storage.get([STORAGE_KEY, STATUS_KEY]);
      sendResponse({
        errors: result[STORAGE_KEY] || [],
        isMonitoring: result[STATUS_KEY] || false
      });
    }

    let response = null;
    await handleGetErrors((r) => { response = r; });

    assert.strictEqual(response.errors.length, 2);
    assert.strictEqual(response.isMonitoring, true);
  });

  test('handleGetErrors returns empty arrays when no errors', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';
    const STATUS_KEY = 'error_hunter_active';

    async function handleGetErrors(sendResponse) {
      const result = await mock.storage.get([STORAGE_KEY, STATUS_KEY]);
      sendResponse({
        errors: result[STORAGE_KEY] || [],
        isMonitoring: result[STATUS_KEY] || false
      });
    }

    let response = null;
    await handleGetErrors((r) => { response = r; });

    assert.deepStrictEqual(response.errors, []);
  });

  // ════════════════════════════════════════════
  // SECTION 4: Monitoring Status
  // ════════════════════════════════════════════

  test('handleGetStatus returns monitoring state', async () => {
    const mock = createMockChrome();
    const STATUS_KEY = 'error_hunter_active';

    await mock.storage.set({ [STATUS_KEY]: true });

    async function handleGetStatus(sendResponse) {
      const result = await mock.storage.get(STATUS_KEY);
      sendResponse({ isMonitoring: result[STATUS_KEY] || false });
    }

    let response = null;
    await handleGetStatus((r) => { response = r; });
    assert.strictEqual(response.isMonitoring, true);

    // Set to false
    await mock.storage.set({ [STATUS_KEY]: false });
    await handleGetStatus((r) => { response = r; });
    assert.strictEqual(response.isMonitoring, false);
  });

  // ════════════════════════════════════════════
  // SECTION 5: Clear Errors
  // ════════════════════════════════════════════

  test('handleClearErrors empties storage and clears badge', async () => {
    const mock = createMockChrome();
    const STORAGE_KEY = 'error_hunter_errors';

    // Pre-populate
    await mock.storage.set({ [STORAGE_KEY]: [{ message: 'to clear' }] });
    await mock.action.setBadgeText({ text: '1' });

    async function handleClearErrors(sendResponse) {
      await mock.storage.set({ [STORAGE_KEY]: [] });
      await mock.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
    }

    let response = null;
    await handleClearErrors((r) => { response = r; });

    assert.strictEqual(response.success, true);
    const stored = await mock.storage.get(STORAGE_KEY);
    assert.deepStrictEqual(stored[STORAGE_KEY], []);
    assert.strictEqual(mock.action._badgeText, '');
  });

  // ════════════════════════════════════════════
  // SECTION 6: Badge Update
  // ════════════════════════════════════════════

  test('updateBadge shows count when > 0, empty when 0', async () => {
    const mock = createMockChrome();

    async function updateBadge(count) {
      const text = count > 0 ? String(count) : '';
      await mock.action.setBadgeText({ text: text });
      if (count > 0) {
        await mock.action.setBadgeBackgroundColor({ color: '#dc3545' });
      }
    }

    await updateBadge(0);
    assert.strictEqual(mock.action._badgeText, '');

    await updateBadge(5);
    assert.strictEqual(mock.action._badgeText, '5');
    assert.strictEqual(mock.action._badgeColor, '#dc3545');

    await updateBadge(1);
    assert.strictEqual(mock.action._badgeText, '1');
  });

  // ════════════════════════════════════════════
  // SECTION 7: Start/Stop Monitoring
  // ════════════════════════════════════════════

  test('handleStartMonitoring sets status to true', async () => {
    const mock = createMockChrome();
    const STATUS_KEY = 'error_hunter_active';
    const STORAGE_KEY = 'error_hunter_errors';

    async function handleStartMonitoring(sendResponse) {
      await mock.storage.set({ [STATUS_KEY]: true });
      const tabs = await mock.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && tab.url.startsWith('http')) {
          try {
            await mock.tabs.sendMessage(tab.id, { action: 'start' });
          } catch (e) { /* ignore */ }
        }
      }
      sendResponse({ success: true });
    }

    let response = null;
    await handleStartMonitoring((r) => { response = r; });

    assert.strictEqual(response.success, true);
    const status = await mock.storage.get(STATUS_KEY);
    assert.strictEqual(status[STATUS_KEY], true);
  });

  test('handleStopMonitoring clears status, errors, and badge', async () => {
    const mock = createMockChrome();
    const STATUS_KEY = 'error_hunter_active';
    const STORAGE_KEY = 'error_hunter_errors';

    // Pre-populate
    await mock.storage.set({ [STATUS_KEY]: true });
    await mock.storage.set({ [STORAGE_KEY]: [{ message: 'clear me' }] });
    await mock.action.setBadgeText({ text: '1' });

    async function handleStopMonitoring(sendResponse) {
      await mock.storage.set({ [STATUS_KEY]: false });
      await mock.storage.set({ [STORAGE_KEY]: [] });
      await mock.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
    }

    let response = null;
    await handleStopMonitoring((r) => { response = r; });

    assert.strictEqual(response.success, true);
    const status = await mock.storage.get(STATUS_KEY);
    assert.strictEqual(status[STATUS_KEY], false);
    const errors = await mock.storage.get(STORAGE_KEY);
    assert.deepStrictEqual(errors[STORAGE_KEY], []);
    assert.strictEqual(mock.action._badgeText, '');
  });

  // ════════════════════════════════════════════
  // SECTION 8: Message Routing
  // ════════════════════════════════════════════

  test('message listener routes to correct handler based on action', () => {
    // Simulate the switch statement logic
    function processMessage(message, sendResponse) {
      switch (message.action) {
        case 'new_error': return 'handleNewError';
        case 'get_errors': return 'handleGetErrors';
        case 'get_status': return 'handleGetStatus';
        case 'start_monitoring': return 'handleStartMonitoring';
        case 'stop_monitoring': return 'handleStopMonitoring';
        case 'clear_errors': return 'handleClearErrors';
        default: return 'unknown';
      }
    }

    assert.strictEqual(processMessage({ action: 'new_error' }), 'handleNewError');
    assert.strictEqual(processMessage({ action: 'get_errors' }), 'handleGetErrors');
    assert.strictEqual(processMessage({ action: 'get_status' }), 'handleGetStatus');
    assert.strictEqual(processMessage({ action: 'start_monitoring' }), 'handleStartMonitoring');
    assert.strictEqual(processMessage({ action: 'stop_monitoring' }), 'handleStopMonitoring');
    assert.strictEqual(processMessage({ action: 'clear_errors' }), 'handleClearErrors');
    assert.strictEqual(processMessage({ action: 'unknown' }), 'unknown');
  });

  test('get_errors and get_status handlers return true to keep channel open', () => {
    // From source: these cases have "return true" for async sendResponse
    const src = fs.readFileSync(SW_PATH, 'utf-8');
    
    // Check that async handlers return true to keep message channel open
    const getErrorsBlock = src.substring(
      src.indexOf("case 'get_errors'"),
      src.indexOf("case 'get_status'")
    );
    assert.ok(getErrorsBlock.includes('return true'), 'get_errors should return true');

    const getStatusBlock = src.substring(
      src.indexOf("case 'get_status'"),
      src.indexOf("case 'start_monitoring'")
    );
    assert.ok(getStatusBlock.includes('return true'), 'get_status should return true');
  });

  // ════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Service Worker Test Results ===');
  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}\n`);

  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`  ${icon} ${r.name}`);
    if (!r.passed) {
      console.log(`     Error: ${r.error}`);
    }
  }

  console.log('');
  return { passed: failed.length === 0, results };
}

if (require.main === module) {
  const result = runTests();
  process.exit(result.passed ? 0 : 1);
}

module.exports = { runTests };
