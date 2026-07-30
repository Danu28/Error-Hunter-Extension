const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'src', 'service-worker.js');

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
  const result = runTests();
  process.exit(result.passed ? 0 : 1);
}

module.exports = { runTests };
