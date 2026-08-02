const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CONTENT_JS_PATH = path.join(__dirname, '..', 'src', 'content.js');

function extractFn(src, fnName) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const match = src.match(re);
  if (!match) throw new Error('Function ' + fnName + ' not found in source');
  return new Function('return ' + match[0])();
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

  const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');

  test('content.js file exists', () => {
    assert.ok(fs.existsSync(CONTENT_JS_PATH));
  });

  test('content.js has valid JavaScript syntax', () => {
    new Function(src);
  });

  test('content.js has startMonitoring and stopMonitoring functions', () => {
    assert.ok(src.includes('function startMonitoring'));
    assert.ok(src.includes('function stopMonitoring'));
  });

  test('content.js patches console.error and console.warn', () => {
    assert.ok(src.includes('function patchConsole'));
    assert.ok(src.includes('function unpatchConsole'));
  });

  test('content.js has page-world event bridge (PAGE_WORLD_EVENTS)', () => {
    assert.ok(src.includes('PAGE_WORLD_EVENTS'));
    assert.ok(src.includes('eh-console-error'));
    assert.ok(src.includes('eh-network-error'));
    assert.ok(src.includes('function addPageWorldListeners'));
    assert.ok(src.includes('function removePageWorldListeners'));
  });

  test('content.js sends inject_page_world message on start', () => {
    assert.ok(src.includes("action: 'inject_page_world'"));
  });

  test('content.js delegates error/rejection to page-world bridge (no redundant listeners)', () => {
    assert.ok(!src.includes('function addErrorListeners'));
    assert.ok(!src.includes('function removeErrorListeners'));
    assert.ok(!src.includes('function handleWindowError'));
    assert.ok(!src.includes('function handleUnhandledRejection'));
  });

  test('reportError stamps pageTitle and pageRoute', () => {
    const sent = [];
    const chrome = { runtime: { sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); } } };
    const doc = { title: 'Admin Dashboard' };
    const loc = { pathname: '/tests/test-page.html', hash: '#orders' };
    const reportError = new Function(
      'monitoring', 'chrome', 'document', 'location', 'stopMonitoring',
      'return ' + extractFn(src, 'reportError')
    )(true, chrome, doc, loc, () => {});
    const error = { message: 'boom', url: 'https://x/a.js' };
    reportError(error);
    assert.strictEqual(error.pageTitle, 'Admin Dashboard');
    assert.strictEqual(error.pageRoute, '/tests/test-page.html#orders');
    assert.strictEqual(sent[0].action, 'new_error');
    assert.strictEqual(sent[0].error, error);
  });

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Content Script Test Results ===');
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
  const result = runTests();
  process.exit(result.passed ? 0 : 1);
}

module.exports = { runTests };
