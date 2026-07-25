const assert = require('assert');
const fs = require('fs');
const path = require('path');

const POPUP_HTML_PATH = path.join(__dirname, '..', 'src', 'popup.html');
const POPUP_CSS_PATH = path.join(__dirname, '..', 'src', 'popup.css');
const POPUP_JS_PATH = path.join(__dirname, '..', 'src', 'popup.js');

function extractFn(src, fnName) {
  const re = new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
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

  // ── Pure utility function tests ──
  const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');

  test('escapeHtml escapes HTML special characters', () => {
    const escapeHtml = extractFn(src, 'escapeHtml');
    assert.strictEqual(escapeHtml('hello'), 'hello');
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
    assert.strictEqual(escapeHtml('"quoted"'), '&quot;quoted&quot;');
    assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
    assert.strictEqual(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  });

  test('escapeHtml handles non-string input', () => {
    const escapeHtml = extractFn(src, 'escapeHtml');
    assert.strictEqual(escapeHtml(42), '42');
    assert.strictEqual(escapeHtml(null), 'null');
    assert.strictEqual(escapeHtml(undefined), 'undefined');
  });

  test('getTypeLabel returns correct labels', () => {
    const getTypeLabel = extractFn(src, 'getTypeLabel');
    assert.strictEqual(getTypeLabel('console'), 'JS Error');
    assert.strictEqual(getTypeLabel('console', undefined, true), 'JS Error (console)');
    assert.strictEqual(getTypeLabel('exception'), 'Exception');
    assert.strictEqual(getTypeLabel('unhandledrejection'), 'Rejection');
    assert.strictEqual(getTypeLabel('network'), 'HTTP Error');
    assert.strictEqual(getTypeLabel('network', undefined, true), 'HTTP Error (network)');
    assert.strictEqual(getTypeLabel('console', 'warn'), 'Warning');
  });

  test('getTypeClass returns correct CSS classes', () => {
    const getTypeClass = extractFn(src, 'getTypeClass');
    assert.strictEqual(getTypeClass('console'), 'console');
    assert.strictEqual(getTypeClass('exception'), 'console');
    assert.strictEqual(getTypeClass('unhandledrejection'), 'console');
    assert.strictEqual(getTypeClass('network'), 'network');
    assert.strictEqual(getTypeClass('console', 'warn'), 'warning');
  });

  test('getStatusClass returns correct CSS for HTTP status codes', () => {
    const getStatusClass = extractFn(src, 'getStatusClass');
    assert.strictEqual(getStatusClass(0), 'error-0');
    assert.strictEqual(getStatusClass(400), 'error-4xx');
    assert.strictEqual(getStatusClass(404), 'error-4xx');
    assert.strictEqual(getStatusClass(418), 'error-4xx');
    assert.strictEqual(getStatusClass(500), 'error-5xx');
    assert.strictEqual(getStatusClass(503), 'error-5xx');
    assert.strictEqual(getStatusClass(200), '');
    assert.strictEqual(getStatusClass(301), '');
  });

  test('truncateUrl shortens long URLs', () => {
    const truncateUrl = extractFn(src, 'truncateUrl');
    assert.strictEqual(truncateUrl('http://example.com/short'), 'example.com/short');
    assert.ok(truncateUrl('http://example.com/' + 'a'.repeat(100)).length < 70);
  });

  test('formatTime returns relative time for recent timestamps', () => {
    const formatTime = extractFn(src, 'formatTime');
    const now = Date.now();
    assert.strictEqual(formatTime(now - 5000), 'just now');
    assert.strictEqual(formatTime(now - 55000), 'just now');
    assert.strictEqual(formatTime(now - 120000), '2m ago');
    assert.strictEqual(formatTime(now - 3590000), '59m ago');
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
