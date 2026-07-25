// Error Hunter - Popup Tests
// Validates popup HTML structure, CSS existence, and popup.js structural integrity

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const POPUP_HTML_PATH = path.join(__dirname, '..', 'src', 'popup.html');
const POPUP_CSS_PATH = path.join(__dirname, '..', 'src', 'popup.css');
const POPUP_JS_PATH = path.join(__dirname, '..', 'src', 'popup.js');

// ── Helper: parse HTML with basic regex (safe for structure checking) ──
function extractElementIds(html) {
  const ids = [];
  const regex = /id="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function extractElementClasses(html) {
  const classes = new Set();
  const regex = /class="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    match[1].split(/\s+/).forEach(c => classes.add(c));
  }
  return classes;
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

  // ════════════════════════════════════════════
  // SECTION 1: File Existence & Structure
  // ════════════════════════════════════════════

  test('popup.html exists', () => {
    assert.ok(fs.existsSync(POPUP_HTML_PATH));
  });

  test('popup.css exists', () => {
    assert.ok(fs.existsSync(POPUP_CSS_PATH));
  });

  test('popup.js exists', () => {
    assert.ok(fs.existsSync(POPUP_JS_PATH));
  });

  test('popup.html is valid HTML5', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<html'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.includes('<head>'));
    assert.ok(html.includes('</head>'));
    assert.ok(html.includes('<body>'));
    assert.ok(html.includes('</body>'));
    assert.ok(html.includes('meta charset="UTF-8"'));
  });

  test('popup.html has viewport meta tag', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes('content="width=device-width, initial-scale=1.0"'));
  });

  test('popup.js passes syntax check', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    // Use Function constructor as a syntax check without executing
    new Function(src);
    assert.ok(true, 'popup.js has valid syntax');
  });

  // ════════════════════════════════════════════
  // SECTION 2: HTML Element Structure
  // ════════════════════════════════════════════

  test('popup.html has all required elements by ID', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    const ids = extractElementIds(html);

    const requiredIds = [
      'app',
      'statusIndicator',
      'btnStart',
      'btnStop',
      'btnClear',
      'filters',
      'summary',
      'errorCount',
      'errorList'
    ];

    for (const id of requiredIds) {
      assert.ok(ids.includes(id), `Missing element with id="${id}"`);
    }
  });

  test('popup.html has filter buttons with correct data attributes', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('data-filter="all"'));
    assert.ok(html.includes('data-filter="console"'));
    assert.ok(html.includes('data-filter="network"'));
  });

  test('popup.html links popup.css stylesheet', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('href="popup.css"'));
  });

  test('popup.html loads popup.js script', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('src="popup.js"'));
  });

  test('popup.html has empty-state fallback', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('empty-state'));
  });

  test('popup.html has footer with message', () => {
    const html = fs.readFileSync(POPUP_HTML_PATH, 'utf-8');
    assert.ok(html.includes('<footer'));
    assert.ok(html.includes('</footer>'));
  });

  // ════════════════════════════════════════════
  // SECTION 3: CSS Structure
  // ════════════════════════════════════════════

  test('popup.css has dark theme variables', () => {
    const css = fs.readFileSync(POPUP_CSS_PATH, 'utf-8');
    assert.ok(css.includes('--bg-primary'));
    assert.ok(css.includes('--bg-secondary'));
    assert.ok(css.includes('--text-primary'));
    assert.ok(css.includes('--text-secondary'));
    assert.ok(css.includes('--accent-red'));
    assert.ok(css.includes('--accent-green'));
    assert.ok(css.includes('--accent-blue'));
  });

  test('popup.css has classes for all major UI states', () => {
    const css = fs.readFileSync(POPUP_CSS_PATH, 'utf-8');
    const expectedClasses = [
      '.status-indicator',
      '.status-indicator.active',
      '.btn-start',
      '.btn-stop',
      '.btn-clear',
      '.filter-btn',
      '.filter-btn.active',
      '.empty-state',
      '.error-item',
      '.error-item.expanded',
      '.error-type-badge.console',
      '.error-type-badge.network'
    ];
    for (const cls of expectedClasses) {
      assert.ok(css.includes(cls), `Missing CSS class: ${cls}`);
    }
  });

  test('popup.css has scrollbar styling', () => {
    const css = fs.readFileSync(POPUP_CSS_PATH, 'utf-8');
    assert.ok(css.includes('::-webkit-scrollbar'));
  });

  // ════════════════════════════════════════════
  // SECTION 4: popup.js DOM references & structure
  // ════════════════════════════════════════════

  test('popup.js has correct getElementById references', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    const expectedRefs = [
      "getElementById('btnStart')",
      "getElementById('btnStop')",
      "getElementById('btnClear')",
      "getElementById('statusIndicator')",
      "getElementById('errorList')",
      "getElementById('errorCount')"
    ];
    for (const ref of expectedRefs) {
      assert.ok(src.includes(ref), `Missing DOM reference: ${ref}`);
    }
  });

  test('popup.js has querySelectorAll for filter buttons', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    assert.ok(src.includes("querySelectorAll('.filter-btn'"));
  });

  test('popup.js functions for monitoring lifecycle exist', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    assert.ok(src.includes('async function startMonitoring'));
    assert.ok(src.includes('async function stopMonitoring'));
    assert.ok(src.includes('async function clearErrors'));
    assert.ok(src.includes('function updateUI'));
    assert.ok(src.includes('function renderErrors'));
    assert.ok(src.includes('function buildErrorItem'));
  });

  test('popup.js DOMContentLoaded listener exists', () => {
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    assert.ok(src.includes("DOMContentLoaded"));
  });

  // ════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════

  const failed = results.filter(r => !r.passed);
  const passed = results.filter(r => r.passed);

  console.log('\n=== Popup Test Results ===');
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
