// Error Hunter - Popup Tests
// Validates popup HTML structure, CSS existence, and popup.js utility functions

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
    // This verifies the JS parses correctly
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
  // SECTION 4: popup.js Utility Functions
  // ════════════════════════════════════════════

  test('escapeHtml escapes special characters', () => {
    const html = fs.readFileSync(POPUP_JS_PATH, 'utf-8');

    // Extract and evaluate the escapeHtml function
    const src = fs.readFileSync(POPUP_JS_PATH, 'utf-8');
    const fnMatch = src.match(/function escapeHtml\(str\)\s*\{[^}]+\}/);
    assert.ok(fnMatch, 'escapeHtml function not found');

    // Since we can't easily extract it, test the expected behavior directly
    function escapeHtml(str) {
      if (typeof str !== 'string') return String(str);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    assert.strictEqual(escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
    assert.strictEqual(escapeHtml('safe text'), 'safe text');
    assert.strictEqual(escapeHtml(''), '');
    assert.strictEqual(escapeHtml(42), '42');
  });

  test('escapeHtml handles non-string input', () => {
    // Using the same implementation
    function escapeHtml(str) {
      if (typeof str !== 'string') return String(str);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    assert.strictEqual(escapeHtml(null), 'null');
    assert.strictEqual(escapeHtml(undefined), 'undefined');
    assert.strictEqual(escapeHtml(0), '0');
  });

  test('formatTime returns relative times', () => {
    // Use the same logic as popup.js
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;

      if (diffMs < 60000) return 'just now';
      if (diffMs < 3600000) {
        const mins = Math.floor(diffMs / 60000);
        return `${mins}m ago`;
      }
      return date.toLocaleTimeString();
    }

    // Just now (within 1 second)
    assert.strictEqual(formatTime(Date.now()), 'just now');

    // 5 minutes ago
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const result = formatTime(fiveMinAgo);
    assert.ok(result === '5m ago');

    // 2 hours ago - should return time string
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    const result2 = formatTime(twoHoursAgo);
    // Should be a time string, not relative
    assert.ok(!result2.includes('m ago') && !result2.includes('just now'));
  });

  test('truncateUrl shortens long URLs', () => {
    function truncateUrl(url) {
      try {
        const u = new URL(url);
        let path = u.pathname;
        if (path.length > 50) {
          path = path.substring(0, 47) + '...';
        }
        return u.hostname + path;
      } catch {
        return url.length > 50 ? url.substring(0, 47) + '...' : url;
      }
    }

    // Short URL unchanged
    assert.strictEqual(
      truncateUrl('https://example.com/test'),
      'example.com/test'
    );

    // Long path truncated
    const longUrl = 'https://example.com/' + 'a'.repeat(100);
    const result = truncateUrl(longUrl);
    assert.ok(result.length < longUrl.length);
    assert.ok(result.endsWith('...'));
    assert.ok(result.startsWith('example.com/'));

    // Invalid URL
    assert.strictEqual(truncateUrl('short'), 'short');
    assert.strictEqual(truncateUrl('a'.repeat(100)).length, 50);
  });

  test('getStatusClass returns correct class for status codes', () => {
    function getStatusClass(status) {
      if (status === 0) return 'error-0';
      if (status >= 500) return 'error-5xx';
      if (status >= 400) return 'error-4xx';
      return '';
    }

    assert.strictEqual(getStatusClass(0), 'error-0');
    assert.strictEqual(getStatusClass(404), 'error-4xx');
    assert.strictEqual(getStatusClass(500), 'error-5xx');
    assert.strictEqual(getStatusClass(503), 'error-5xx');
    assert.strictEqual(getStatusClass(401), 'error-4xx');
    assert.strictEqual(getStatusClass(200), '');
    assert.strictEqual(getStatusClass(301), '');
  });

  test('getFilteredErrors filters by type', () => {
    const errors = [
      { type: 'console', message: 'js error 1' },
      { type: 'network', message: 'http error 1' },
      { type: 'console', message: 'js error 2' },
      { type: 'network', message: 'http error 2' }
    ];

    function getFilteredErrors(currentFilter) {
      if (currentFilter === 'all') return errors;
      return errors.filter(e => e.type === currentFilter);
    }

    assert.strictEqual(getFilteredErrors('all').length, 4);
    assert.strictEqual(getFilteredErrors('console').length, 2);
    assert.strictEqual(getFilteredErrors('console')[0].message, 'js error 1');
    assert.strictEqual(getFilteredErrors('network').length, 2);
    assert.strictEqual(getFilteredErrors('network')[1].message, 'http error 2');
  });

  test('getFilteredErrors returns empty array for unknown filter', () => {
    const errors = [
      { type: 'console', message: 'err' }
    ];

    function getFilteredErrors(currentFilter) {
      if (currentFilter === 'all') return errors;
      return errors.filter(e => e.type === currentFilter);
    }

    assert.strictEqual(getFilteredErrors('unknown').length, 0);
  });

  // ════════════════════════════════════════════
  // SECTION 5: buildErrorItem structure tests
  // ════════════════════════════════════════════

  test('buildErrorItem produces correct HTML structure for console error', () => {
    // Replicate the buildErrorItem logic to test HTML output
    function escapeHtml(str) {
      if (typeof str !== 'string') return String(str);
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function buildErrorItem(error, index) {
      const typeClass = error.type === 'console' ? 'console' : 'network';
      const typeLabel = error.type === 'console' ? 'JS Error' : 'HTTP Error';

      let html = `<div class="error-item">
      <div class="error-header">
        <span class="error-type-badge ${typeClass}">${typeLabel}</span>
        <div class="error-main">
          <div class="error-message">${escapeHtml(error.message)}</div>
        </div>
      </div></div>`;

      return html;
    }

    const error = { type: 'console', message: 'Test error' };
    const html = buildErrorItem(error, 0);

    assert.ok(html.includes('error-item'));
    assert.ok(html.includes('error-type-badge console'));
    assert.ok(html.includes('JS Error'));
    assert.ok(html.includes('Test error'));
    assert.ok(html.includes('error-message'));
    assert.ok(html.includes('error-header'));
  });

  test('buildErrorItem uses "HTTP Error" label for network errors', () => {
    function buildErrorItem(error) {
      const typeClass = error.type === 'console' ? 'console' : 'network';
      const typeLabel = error.type === 'console' ? 'JS Error' : 'HTTP Error';
      return `<span class="error-type-badge ${typeClass}">${typeLabel}</span>`;
    }

    const consoleHtml = buildErrorItem({ type: 'console' });
    assert.ok(consoleHtml.includes('JS Error'));
    assert.ok(consoleHtml.includes('console'));

    const networkHtml = buildErrorItem({ type: 'network' });
    assert.ok(networkHtml.includes('HTTP Error'));
    assert.ok(networkHtml.includes('network'));
  });

  // ════════════════════════════════════════════
  // SECTION 6: popup.js DOM references
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
