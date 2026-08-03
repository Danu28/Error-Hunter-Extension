const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'src', 'service-worker.js');

function extractFn(src, fnName) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const match = src.match(re);
  if (!match) throw new Error('Function ' + fnName + ' not found in source');
  return new Function('return ' + match[0])();
}

// In-memory chrome.storage mock (local + session, string-key access only)
function createStorageMock() {
  const data = { local: {}, session: {} };
  const storage = {
    local: {
      get: async (key) => ({ [key]: data.local[key] }),
      set: async (obj) => { Object.assign(data.local, obj); }
    },
    session: {
      get: async (key) => ({ [key]: data.session[key] }),
      set: async (obj) => { Object.assign(data.session, obj); }
    }
  };
  return { storage, data };
}

async function runTests() {
  const results = [];
  const pending = [];

  function test(name, fn) {
    pending.push(
      Promise.resolve()
        .then(fn)
        .then(() => results.push({ name, passed: true }))
        .catch(err => results.push({ name, passed: false, error: err.message }))
    );
  }

  const src = fs.readFileSync(SW_PATH, 'utf-8');

  test('service-worker.js file exists', () => {
    assert.ok(fs.existsSync(SW_PATH));
  });

  test('service-worker.js has valid JavaScript syntax', () => {
    new Function(src);
  });

  test('injectPageWorldErrorCapture function is defined', () => {
    assert.ok(src.includes('function injectPageWorldErrorCapture'));
  });

  test('handleInjectPageWorld function is defined', () => {
    assert.ok(src.includes('async function handleInjectPageWorld'));
  });

  test('inject_page_world case in message switch', () => {
    assert.ok(src.includes("case 'inject_page_world'"));
  });

  test('injectPageWorldErrorCapture patches console.error', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes("_patchConsole('error'"));
  });

  test('injectPageWorldErrorCapture patches console.warn', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes("_patchConsole('warn'"));
  });

  test('injectPageWorldErrorCapture truncates console messages at capture', () => {
    const fnStart = src.indexOf('function _patchConsole');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes('_ehTruncate(message, 2000)'));
  });

  test('injectPageWorldErrorCapture dispatches all 5 custom event types', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes("'eh-console-error'"));
    assert.ok(fnBody.includes("'eh-console-warn'"));
    assert.ok(fnBody.includes("'eh-window-error'"));
    assert.ok(fnBody.includes("'eh-unhandled-rejection'"));
    assert.ok(fnBody.includes("'eh-network-error'"));
  });

  test('injectPageWorldErrorCapture patches fetch', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes('_origFetch'));
    assert.ok(fnBody.includes('window.fetch'));
  });

  test('injectPageWorldErrorCapture patches XMLHttpRequest', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes('_origXHROpen'));
    assert.ok(fnBody.includes('_origXHRSend'));
    assert.ok(fnBody.includes('XMLHttpRequest.prototype'));
  });

  test('injectPageWorldErrorCapture captures network duration and payload', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes('duration:'));
    assert.ok(fnBody.includes('requestBody:'));
    assert.ok(fnBody.includes('responseText'));
    assert.ok(fnBody.includes('_ehTruncate'));
    assert.ok(fnBody.includes('_ehBodyToString'));
    assert.ok(fnBody.includes('response.clone()'));
    assert.ok(fnBody.includes('xhr.responseText'));
  });

  test('injectPageWorldErrorCapture captures resource-load failures via PerformanceObserver', () => {
    const fnStart = src.indexOf('function injectPageWorldErrorCapture');
    const fnBody = src.slice(fnStart);
    assert.ok(fnBody.includes('PerformanceObserver'));
    assert.ok(fnBody.includes("type: 'resource'"));
    assert.ok(fnBody.includes('buffered: true'));
    assert.ok(fnBody.includes('responseStatus >= 400'));
    assert.ok(fnBody.includes("initiatorType !== 'fetch'"));
    assert.ok(fnBody.includes("initiatorType !== 'xmlhttprequest'"));
    assert.ok(fnBody.includes("'eh-network-error'"));
    assert.ok(fnBody.includes("'Resource ' + e.initiatorType"));
  });

  test('handleNewError filters errors against ignore rules', () => {
    assert.ok(src.includes('async function isIgnoredError'));
    assert.ok(src.includes('eh_ignore_rules'));
    assert.ok(src.includes('eh_blocked_count'));
    const start = src.indexOf('async function handleNewError');
    const body = src.slice(start);
    assert.ok(body.includes('isIgnoredError'));
    assert.ok(body.includes('BLOCKED_COUNT_KEY'));
  });

  test('handleNewError deduplicates per type, message, url, and tab', () => {
    const start = src.indexOf('async function handleNewError');
    const body = src.slice(start);
    assert.ok(body.includes('e.tabId === error.tabId'));
  });

  test('service worker handles ignore rule add/remove messages', () => {
    assert.ok(src.includes("case 'add_ignore_rule'"));
    assert.ok(src.includes("case 'remove_ignore_rule'"));
    assert.ok(src.includes('async function handleAddIgnoreRule'));
    assert.ok(src.includes('async function handleRemoveIgnoreRule'));
    assert.ok(src.includes('function matchesRule'));
  });

  // ── Behavioral tests: execute extracted logic with mocks ──
  const matchesRule = extractFn(src, 'matchesRule');
  const handleNewError = extractFn(src, 'handleNewError');
  const isIgnoredError = extractFn(src, 'isIgnoredError');
  const ensureRulesCache = extractFn(src, 'ensureRulesCache');
  const invalidateIgnoreRuleCache = extractFn(src, 'invalidateIgnoreRuleCache');

  test('invalidateIgnoreRuleCache clears the cached rules', () => {
    const cache = { rules: 'stale' };
    const fn = new Function('ignoreRulesCache', 'return ' + invalidateIgnoreRuleCache)(cache);
    fn();
    assert.strictEqual(cache.rules, null);
  });

  test('matchesRule: message match, case-insensitive', () => {
    const err = { message: 'TypeError: boom', url: 'https://example.com/a.js' };
    assert.strictEqual(matchesRule(err, { matchOn: 'message', pattern: 'typeerror' }), true);
    assert.strictEqual(matchesRule(err, { matchOn: 'message', pattern: 'missing' }), false);
  });

  test('matchesRule: url match', () => {
    const err = { message: '404', url: 'https://api.example.com/login' };
    assert.strictEqual(matchesRule(err, { matchOn: 'url', pattern: 'api.example.com' }), true);
    assert.strictEqual(matchesRule(err, { matchOn: 'url', pattern: 'login' }), true);
    assert.strictEqual(matchesRule(err, { matchOn: 'url', pattern: 'nope' }), false);
  });

  test('matchesRule: any matches message or url', () => {
    const err = { message: 'boom', url: 'https://example.com/a.js' };
    assert.strictEqual(matchesRule(err, { matchOn: 'any', pattern: 'boom' }), true);
    assert.strictEqual(matchesRule(err, { matchOn: 'any', pattern: 'example.com' }), true);
    assert.strictEqual(matchesRule(err, { matchOn: 'any', pattern: 'nope' }), false);
  });

  test('matchesRule: empty pattern never matches', () => {
    const err = { message: 'boom', url: 'https://example.com/a.js' };
    assert.strictEqual(matchesRule(err, { matchOn: 'any', pattern: '' }), false);
    assert.strictEqual(matchesRule(err, { matchOn: 'message', pattern: undefined }), false);
  });

  test('isIgnoredError: caches rules after first check (single storage read)', async () => {
    const gets = [];
    const chrome = {
      storage: { local: { get: async (key) => { gets.push(key); return { [key]: [{ pattern: 'boom', matchOn: 'message' }] }; } } }
    };
    const cache = { rules: null };
    const ensure = new Function('chrome', 'IGNORE_RULES_KEY', 'ignoreRulesCache', 'return ' + ensureRulesCache)(chrome, 'eh_ignore_rules', cache);
    const check = new Function('chrome', 'IGNORE_RULES_KEY', 'matchesRule', 'ensureRulesCache', 'ignoreRulesCache', 'return ' + isIgnoredError)(chrome, 'eh_ignore_rules', matchesRule, ensure, cache);
    assert.strictEqual(await check({ message: 'boom', url: 'x' }), true);
    assert.strictEqual(await check({ message: 'nope', url: 'x' }), false);
    assert.strictEqual(gets.length, 1, 'second check must reuse the cached rules');
  });

  test('isIgnoredError: cache invalidation reloads rules from storage', async () => {
    let rules = [{ pattern: 'old', matchOn: 'message' }];
    const chrome = { storage: { local: { get: async () => ({ eh_ignore_rules: rules }) } } };
    const cache = { rules: null };
    const ensure = new Function('chrome', 'IGNORE_RULES_KEY', 'ignoreRulesCache', 'return ' + ensureRulesCache)(chrome, 'eh_ignore_rules', cache);
    const check = new Function('chrome', 'IGNORE_RULES_KEY', 'matchesRule', 'ensureRulesCache', 'ignoreRulesCache', 'return ' + isIgnoredError)(chrome, 'eh_ignore_rules', matchesRule, ensure, cache);
    assert.strictEqual(await check({ message: 'old', url: 'x' }), true);
    rules = [{ pattern: 'new', matchOn: 'message' }];
    cache.rules = null; // what handleAddIgnoreRule/handleRemoveIgnoreRule do after set()
    assert.strictEqual(await check({ message: 'old', url: 'x' }), false);
    assert.strictEqual(await check({ message: 'new', url: 'x' }), true);
  });

  test('handleNewError: deduplicates same error+tab, increments count', async () => {
    const { storage, data } = createStorageMock();
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, async () => {});
    const error = { type: 'console', level: 'error', message: 'dup', url: 'https://x/a.js', timestamp: 1 };
    await handler({ ...error }, { tab: { id: 7 } });
    await handler({ ...error, timestamp: 2 }, { tab: { id: 7 } });
    const stored = data.session['error_hunter_errors'];
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].count, 2);
    assert.strictEqual(stored[0].tabId, 7);
  });

  test('handleNewError: dedup hit refreshes pageTitle/pageRoute to latest occurrence', async () => {
    const { storage, data } = createStorageMock();
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, async () => {});
    await handler(
      { type: 'network', message: 'err', url: 'https://x/', timestamp: 1, pageTitle: 'Old', pageRoute: '/a' },
      { tab: { id: 1 } }
    );
    await handler(
      { type: 'network', message: 'err', url: 'https://x/', timestamp: 2, pageTitle: 'New', pageRoute: '/b' },
      { tab: { id: 1 } }
    );
    const stored = data.session['error_hunter_errors'];
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].count, 2);
    assert.strictEqual(stored[0].pageTitle, 'New');
    assert.strictEqual(stored[0].pageRoute, '/b');
  });

  test('handleNewError: same error from different tab stays separate', async () => {
    const { storage, data } = createStorageMock();
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, async () => {});
    const error = { type: 'console', level: 'error', message: 'dup', url: 'https://x/a.js', timestamp: 1 };
    await handler({ ...error }, { tab: { id: 7 } });
    await handler({ ...error }, { tab: { id: 8 } });
    const stored = data.session['error_hunter_errors'];
    assert.strictEqual(stored.length, 2);
  });

  test('handleNewError: ignored error is not stored and increments blocked count', async () => {
    const { storage, data } = createStorageMock();
    const isIgnored = async () => true;
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, isIgnored, async () => {});
    await handler({ type: 'console', message: 'spam', url: 'u', timestamp: 1 }, { tab: { id: 1 } });
    assert.strictEqual(data.session['error_hunter_errors'], undefined);
    assert.strictEqual(data.local['eh_blocked_count'], 1);
  });

  test('handleNewError: caps stored errors at 500, dropping oldest', async () => {
    const { storage, data } = createStorageMock();
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, async () => {});
    for (let i = 0; i < 505; i++) {
      await handler({ type: 'console', message: 'err' + i, url: 'u' + i, timestamp: i }, { tab: { id: 1 } });
    }
    const stored = data.session['error_hunter_errors'];
    assert.strictEqual(stored.length, 500);
    assert.strictEqual(stored[0].message, 'err5');
    assert.ok(!stored.some(e => e.message === 'err0'));
  });

  test('error mutation handlers serialize through runExclusive (no lost updates on bursts)', async () => {
    const dispatch = src.slice(src.indexOf('chrome.runtime.onMessage.addListener'));
    assert.ok(dispatch.includes("runExclusive(() => handleNewError("));
    assert.ok(dispatch.includes("runExclusive(() => handleClearErrors("));
    assert.ok(dispatch.includes("runExclusive(() => handleDeleteError("));
  });

  test('runExclusive: concurrent new_error bursts all persist with copy-semantics storage', async () => {
    // Faithful storage: chrome.storage returns copies on get and stores copies on
    // set (structured clone), unlike the shared-reference mock above.
    const data = { session: {} };
    const faithfulStorage = {
      local: { get: async () => ({}), set: async () => {} },
      session: {
        get: async (key) => ({ [key]: JSON.parse(JSON.stringify(data.session[key] ?? [])) }),
        set: async (obj) => {
          for (const k of Object.keys(obj)) data.session[k] = JSON.parse(JSON.stringify(obj[k]));
        }
      }
    };
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage: faithfulStorage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, async () => {});
    // Same mutex pattern as service-worker.js
    let mutex = Promise.resolve();
    const runExclusive = (fn) => {
      const run = mutex.then(fn, fn);
      mutex = run.then(() => {}, () => {});
      return run;
    };
    const N = 10;
    await Promise.all(Array.from({ length: N }, (_, i) =>
      runExclusive(() => handler(
        { type: 'network', message: 'err-' + i, url: 'https://x/' + i, timestamp: i },
        { tab: { id: 1 } }
      ))
    ));
    const stored = data.session['error_hunter_errors'];
    assert.strictEqual(stored.length, N, 'all burst errors must persist');
    assert.deepStrictEqual(stored.map(e => e.message).sort(), Array.from({ length: N }, (_, i) => 'err-' + i).sort());
  });

  test('handleNewError: passes the full errors array to updateBadge', async () => {
    const { storage, data } = createStorageMock();
    let badgeArg = null;
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'BLOCKED_COUNT_KEY', 'MAX_ERRORS',
      'isIgnoredError', 'updateBadge', 'return ' + handleNewError
    )({ storage }, 'error_hunter_errors', 'eh_blocked_count', 500, async () => false, (errors) => { badgeArg = errors; });
    await handler({ type: 'exception', message: 'boom', url: 'u', timestamp: 1 }, { tab: { id: 1 } });
    assert.ok(Array.isArray(badgeArg));
    assert.strictEqual(badgeArg.length, 1);
    assert.strictEqual(data.session['error_hunter_errors'].length, 1);
  });

  const updateBadge = extractFn(src, 'updateBadge');
  const getBadgeColor = extractFn(src, 'getBadgeColor');

  test('updateBadge: computes color from passed errors without re-reading storage', async () => {
    const calls = { text: null, color: null, storageReads: 0 };
    const chrome = {
      action: {
        setBadgeText: async (o) => { calls.text = o.text; },
        setBadgeBackgroundColor: async (o) => { calls.color = o.color; }
      },
      storage: { session: { get: async () => { calls.storageReads++; return {}; } } }
    };
    const fn = new Function('chrome', 'STORAGE_KEY', 'getBadgeColor', 'return ' + updateBadge)(chrome, 'error_hunter_errors', getBadgeColor);
    await fn([]);
    assert.strictEqual(calls.text, '');
    assert.strictEqual(calls.color, null);
    await fn([{ type: 'exception', message: 'x', timestamp: 1 }]);
    assert.strictEqual(calls.text, '1');
    assert.strictEqual(calls.color, '#dc3545');
    assert.strictEqual(calls.storageReads, 0, 'color must come from the passed array, not storage');
  });

  const broadcastToTabs = extractFn(src, 'broadcastToTabs');

  test('broadcastToTabs: returns tabs where sendMessage failed, skips non-http tabs', async () => {
    const attempted = [];
    const tabs = {
      query: async () => [
        { id: 1, url: 'http://a.test/' },
        { id: 2, url: 'https://b.test/' },
        { id: 3, url: 'chrome://extensions/' },
        { id: 4, url: 'about:blank' }
      ],
      sendMessage: async (tabId) => {
        attempted.push(tabId);
        if (tabId === 2) throw new Error('Receiving end does not exist');
        return {};
      }
    };
    const fn = new Function('chrome', 'return ' + broadcastToTabs)({ tabs });
    assert.deepStrictEqual(await fn('start'), [2]);
    assert.deepStrictEqual(attempted, [1, 2]);
  });

  const handleStartMonitoring = extractFn(src, 'handleStartMonitoring');

  test('handleStartMonitoring: injects content script into tabs without a live content script, no reload', async () => {
    const { storage, data } = createStorageMock();
    const injected = [];
    const reloaded = [];
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'STATUS_KEY', 'broadcastToTabs',
      'return ' + handleStartMonitoring
    )(
      {
        storage,
        scripting: { executeScript: async ({ target }) => { injected.push(target.tabId); } },
        tabs: { reload: async (tabId) => { reloaded.push(tabId); } }
      },
      'error_hunter_errors', 'error_hunter_active',
      async () => [2]
    );
    let response;
    await handler((r) => { response = r; });
    assert.deepStrictEqual(injected, [2]);
    assert.deepStrictEqual(reloaded, []);
    assert.strictEqual(response.success, true);
    assert.strictEqual(data.session['error_hunter_active'], true);
  });

  test('handleStartMonitoring: no injection when every tab heard the broadcast', async () => {
    const { storage } = createStorageMock();
    const injected = [];
    const reloaded = [];
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'STATUS_KEY', 'broadcastToTabs',
      'return ' + handleStartMonitoring
    )(
      {
        storage,
        scripting: { executeScript: async () => { injected.push('x'); } },
        tabs: { reload: async (tabId) => { reloaded.push(tabId); } }
      },
      'error_hunter_errors', 'error_hunter_active',
      async () => []
    );
    let response;
    await handler((r) => { response = r; });
    assert.deepStrictEqual(injected, []);
    assert.deepStrictEqual(reloaded, []);
    assert.strictEqual(response.success, true);
  });

  test('handleStartMonitoring: reloads a tab only when content-script injection fails', async () => {
    const { storage } = createStorageMock();
    const reloaded = [];
    const handler = new Function(
      'chrome', 'STORAGE_KEY', 'STATUS_KEY', 'broadcastToTabs',
      'return ' + handleStartMonitoring
    )(
      {
        storage,
        scripting: { executeScript: async () => { throw new Error('cannot inject'); } },
        tabs: { reload: async (tabId) => { reloaded.push(tabId); } }
      },
      'error_hunter_errors', 'error_hunter_active',
      async () => [2]
    );
    let response;
    await handler((r) => { response = r; });
    assert.deepStrictEqual(reloaded, [2]);
    assert.strictEqual(response.success, true);
  });

  await Promise.all(pending);
  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Service Worker Test Results ===');
  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}\n`);

  for (const r of results) {
    const icon = r.passed ? '\u2713' : '\u2717';
    console.log(`  ${icon} ${r.name}`);
    if (!r.passed) console.log(`     Error: ${r.error}`);
  }

  console.log('');
  return { passed: failed.length === 0, results };
}

if (require.main === module) {
  runTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

module.exports = { runTests };
