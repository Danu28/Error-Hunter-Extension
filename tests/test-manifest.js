const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

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

  let manifest;
  test('manifest.json exists and is valid JSON', () => {
    const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    manifest = JSON.parse(content);
  });

  test('manifest_version is 3', () => {
    assert.strictEqual(manifest.manifest_version, 3);
  });

  test('required string fields present', () => {
    assert.ok(typeof manifest.name === 'string' && manifest.name.length > 0);
    assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0);
    assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0);
  });

  test('permissions are least-privilege: storage + scripting, no redundant tabs', () => {
    assert.ok(Array.isArray(manifest.permissions));
    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(manifest.permissions.includes('scripting'));
    // `tabs` was removed as redundant: tab.url is already readable through the
    // <all_urls> host permission. Keep it gone to avoid the browsing-history warning.
    assert.ok(!manifest.permissions.includes('tabs'));
  });

  test('host_permissions includes <all_urls>', () => {
    assert.ok(Array.isArray(manifest.host_permissions));
    assert.ok(manifest.host_permissions.includes('<all_urls>'));
  });

  test('background service_worker exists and is type module', () => {
    assert.ok(manifest.background && manifest.background.service_worker);
    const swPath = path.join(__dirname, '..', manifest.background.service_worker);
    assert.ok(fs.existsSync(swPath));
    assert.strictEqual(manifest.background.type, 'module');
  });

  test('content_scripts configured correctly', () => {
    const cs = manifest.content_scripts[0];
    assert.ok(cs && cs.matches.includes('<all_urls>'));
    const jsPath = path.join(__dirname, '..', cs.js[0]);
    assert.ok(fs.existsSync(jsPath));
    assert.strictEqual(cs.run_at, 'document_start');
  });

  test('action default_popup exists', () => {
    const popupPath = path.join(__dirname, '..', manifest.action.default_popup);
    assert.ok(fs.existsSync(popupPath));
  });

  test('icons exist on disk', () => {
    for (const size of ['16', '48', '128']) {
      const iconPath = path.join(__dirname, '..', manifest.icons[size]);
      assert.ok(fs.existsSync(iconPath), `missing icon ${size}`);
    }
  });

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Manifest Validation Results ===');
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
