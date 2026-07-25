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

  test('service-worker.js file exists', () => {
    assert.ok(fs.existsSync(SW_PATH));
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
