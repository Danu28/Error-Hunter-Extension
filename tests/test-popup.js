const assert = require('assert');
const fs = require('fs');
const path = require('path');

const POPUP_HTML_PATH = path.join(__dirname, '..', 'src', 'popup.html');
const POPUP_CSS_PATH = path.join(__dirname, '..', 'src', 'popup.css');
const POPUP_JS_PATH = path.join(__dirname, '..', 'src', 'popup.js');

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

  test('popup.html exists', () => {
    assert.ok(fs.existsSync(POPUP_HTML_PATH));
  });

  test('popup.css exists', () => {
    assert.ok(fs.existsSync(POPUP_CSS_PATH));
  });

  test('popup.js exists', () => {
    assert.ok(fs.existsSync(POPUP_JS_PATH));
  });

  test('popup.js has valid JavaScript syntax', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    new Function(src);
  });

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Popup Test Results ===');
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
