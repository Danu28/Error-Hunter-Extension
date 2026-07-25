const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CONTENT_JS_PATH = path.join(__dirname, '..', 'src', 'content.js');

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

  test('content.js has error and rejection listeners', () => {
    assert.ok(src.includes('function addErrorListeners'));
    assert.ok(src.includes('function removeErrorListeners'));
    assert.ok(src.includes('function handleWindowError'));
    assert.ok(src.includes('function handleUnhandledRejection'));
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
