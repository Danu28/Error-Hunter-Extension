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
