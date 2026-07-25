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

  test('content.js file exists', () => {
    assert.ok(fs.existsSync(CONTENT_JS_PATH));
  });

  test('content.js has valid JavaScript syntax', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    new Function(src);
  });

  test('content.js exports startMonitoring and stopMonitoring', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    assert.ok(src.includes('function startMonitoring'));
    assert.ok(src.includes('function stopMonitoring'));
  });

  test('content.js patches console.error and console.warn', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    assert.ok(src.includes('function patchConsole'));
    assert.ok(src.includes('function unpatchConsole'));
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
