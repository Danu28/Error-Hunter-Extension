// Error Hunter - Manifest Validation Tests
// Validates manifest.json structure and MV3 compliance

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

  // ── Setup ──
  let manifest;
  test('manifest.json exists and is valid JSON', () => {
    const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    manifest = JSON.parse(content);
    assert.ok(manifest, 'manifest should parse to an object');
  });

  // ── Required top-level keys ──
  test('has manifest_version set to 3', () => {
    assert.strictEqual(manifest.manifest_version, 3);
  });

  test('has required "name" field', () => {
    assert.ok(typeof manifest.name === 'string' && manifest.name.length > 0);
  });

  test('has required "version" field', () => {
    assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0);
  });

  test('has required "description" field', () => {
    assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0);
  });

  // ── Permissions ──
  test('has "permissions" array', () => {
    assert.ok(Array.isArray(manifest.permissions));
  });

  test('permissions include "storage"', () => {
    assert.ok(manifest.permissions.includes('storage'));
  });

  test('permissions include "tabs"', () => {
    assert.ok(manifest.permissions.includes('tabs'));
  });

  test('permissions include "scripting"', () => {
    assert.ok(manifest.permissions.includes('scripting'));
  });

  // ── Host permissions ──
  test('has "host_permissions" array', () => {
    assert.ok(Array.isArray(manifest.host_permissions));
  });

  test('host_permissions includes "<all_urls>"', () => {
    assert.ok(manifest.host_permissions.includes('<all_urls>'));
  });

  // ── Background / Service Worker ──
  test('has "background" section', () => {
    assert.ok(manifest.background && typeof manifest.background === 'object');
  });

  test('background.service_worker points to existing file', () => {
    assert.ok(typeof manifest.background.service_worker === 'string');
    const swPath = path.join(__dirname, '..', manifest.background.service_worker);
    assert.ok(fs.existsSync(swPath), `service worker file not found: ${manifest.background.service_worker}`);
  });

  test('background.type is "module"', () => {
    assert.strictEqual(manifest.background.type, 'module');
  });

  // ── Content Scripts ──
  test('has "content_scripts" array', () => {
    assert.ok(Array.isArray(manifest.content_scripts));
  });

  test('content_scripts[0] matches "<all_urls>"', () => {
    const cs = manifest.content_scripts[0];
    assert.ok(cs && Array.isArray(cs.matches));
    assert.ok(cs.matches.includes('<all_urls>'));
  });

  test('content_scripts[0].js points to existing file', () => {
    const cs = manifest.content_scripts[0];
    assert.ok(cs && Array.isArray(cs.js));
    const jsPath = path.join(__dirname, '..', cs.js[0]);
    assert.ok(fs.existsSync(jsPath), `content script file not found: ${cs.js[0]}`);
  });

  test('content_scripts[0].run_at is "document_start"', () => {
    const cs = manifest.content_scripts[0];
    assert.strictEqual(cs.run_at, 'document_start');
  });

  // ── Action / Popup ──
  test('has "action" section', () => {
    assert.ok(manifest.action && typeof manifest.action === 'object');
  });

  test('action.default_popup points to existing file', () => {
    assert.ok(typeof manifest.action.default_popup === 'string');
    const popupPath = path.join(__dirname, '..', manifest.action.default_popup);
    assert.ok(fs.existsSync(popupPath), `popup file not found: ${manifest.action.default_popup}`);
  });

  test('action.default_title is set', () => {
    assert.ok(typeof manifest.action.default_title === 'string');
  });

  // ── Icons ──
  test('has "icons" section', () => {
    assert.ok(manifest.icons && typeof manifest.icons === 'object');
  });

  test('icons include 16, 48, and 128 sizes', () => {
    assert.ok(manifest.icons['16'], 'missing icon 16');
    assert.ok(manifest.icons['48'], 'missing icon 48');
    assert.ok(manifest.icons['128'], 'missing icon 128');
  });

  test('icon files exist on disk', () => {
    for (const size of ['16', '48', '128']) {
      const iconPath = path.join(__dirname, '..', manifest.icons[size]);
      assert.ok(fs.existsSync(iconPath), `icon not found: ${manifest.icons[size]}`);
    }
  });

  // ── No MV2 or MV1 specific keys ──
  test('does not contain MV2-specific "browser_action"', () => {
    assert.strictEqual(manifest.browser_action, undefined);
  });

  test('does not contain MV2-specific "page_action"', () => {
    assert.strictEqual(manifest.page_action, undefined);
  });

  test('does not contain MV2-specific "background_page"', () => {
    assert.strictEqual(manifest.background_page, undefined);
  });

  // ── Summary ──
  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Manifest Validation Results ===');
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

// Run directly or via runner
if (require.main === module) {
  const result = runTests();
  process.exit(result.passed ? 0 : 1);
}

module.exports = { runTests };
