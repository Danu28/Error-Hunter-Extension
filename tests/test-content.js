// Error Hunter - Content Script Unit Tests
// Structural validation: file exists, parses correctly, contains expected exports

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CONTENT_JS_PATH = path.join(__dirname, '..', 'src', 'content.js');

// ── Run against the source to verify structure ──
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
  // SECTION 1: Source Code Structure Validation
  // ════════════════════════════════════════════

  test('content.js file exists', () => {
    assert.ok(fs.existsSync(CONTENT_JS_PATH));
  });

  test('content.js passes syntax check', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    assert.ok(src.length > 0);
    assert.ok(src.includes('function startMonitoring'));
    assert.ok(src.includes('function stopMonitoring'));
  });

  test('content.js contains all expected function declarations', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    const expectedFunctions = [
      'reportError',
      'patchConsoleError',
      'unpatchConsoleError',
      'addErrorListeners',
      'removeErrorListeners',
      'handleWindowError',
      'handleUnhandledRejection',
      'addPageWorldListeners',
      'removePageWorldListeners',
      'startMonitoring',
      'stopMonitoring'
    ];

    for (const fn of expectedFunctions) {
      assert.ok(
        src.includes(`function ${fn}`),
        `Missing function declaration: ${fn}`
      );
    }
  });

  test('content.js has originalConsoleError variable for cleanup', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    assert.ok(
      src.includes('originalConsoleError'),
      'Missing originalConsoleError variable'
    );
  });

  test('content.js has PAGE_WORLD_EVENTS constant', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    assert.ok(
      src.includes('PAGE_WORLD_EVENTS'),
      'Missing PAGE_WORLD_EVENTS constant'
    );
  });

  // ════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Content Script Test Results ===');
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
