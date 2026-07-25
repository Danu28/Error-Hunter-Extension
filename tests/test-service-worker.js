// Error Hunter - Service Worker Unit Tests
// Structural validation: file exists, handlers present, storage keys, chrome API usage

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
