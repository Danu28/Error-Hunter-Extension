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

  const getTypeLabel = extractFn(src, 'getTypeLabel');

  test('generateBugReport includes heading and error count', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'console', level: 'error', message: 'test error', timestamp: Date.now(), url: 'https://example.com/script.js' }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('# Error Hunter Bug Report'));
    assert.ok(report.includes('**Total Errors:** 1'));
    assert.ok(report.includes('test error'));
  });

  test('generateBugReport includes network error details', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'network', message: 'POST failed', timestamp: Date.now(), url: 'https://api.example.com/data', status: 500, statusText: 'Internal Server Error', method: 'POST' }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('500'));
    assert.ok(report.includes('Internal Server Error'));
    assert.ok(report.includes('POST'));
  });

  test('generateBugReport includes network payload details', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'network', message: 'POST failed', timestamp: Date.now(), url: 'https://api.example.com/login', status: 401, statusText: 'Unauthorized', method: 'POST', duration: 1200, requestBody: '{"username":"admin"}', responseText: '{"error":"bad creds"}' }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('1200ms'));
    assert.ok(report.includes('{"username":"admin"}'));
    assert.ok(report.includes('{"error":"bad creds"}'));
  });

  test('buildErrorItem renders network duration, request body, and response', () => {
    assert.ok(src.includes('error.duration != null'));
    assert.ok(src.includes('error.requestBody'));
    assert.ok(src.includes('error.responseText'));
  });

  test('generateBugReport includes stack trace', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'exception', message: 'TypeError: x is not a function', timestamp: Date.now(), stack: 'TypeError: x is not a function\n    at Object.<anonymous> (app.js:10:5)' }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('TypeError'));
    assert.ok(report.includes('```'));
    assert.ok(report.includes('app.js:10:5'));
  });

  test('generateBugReport includes occurrence count', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'console', level: 'error', message: 'repeated error', timestamp: Date.now(), count: 5 }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('**Occurrences:** 5'));
  });

  test('generateBugReport includes Page line when page state is present', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => null);
    const errors = [
      { type: 'network', message: 'boom', timestamp: Date.now(), pageTitle: 'Admin Dashboard', pageRoute: '/orders#tab2' }
    ];
    const report = generateBugReport(errors);
    assert.ok(report.includes('**Page:** Admin Dashboard — /orders#tab2'));
    const noState = generateBugReport([{ type: 'console', message: 'x', timestamp: Date.now() }]);
    assert.ok(!noState.includes('**Page:**'));
  });

  test('buildErrorItem renders Page section when page state is present', () => {
    assert.ok(src.includes('error.pageTitle'));
    assert.ok(src.includes('error.pageRoute'));
    assert.ok(src.includes('error-details-label">Page'));
  });

  test('generateBugReport includes Tab line when a tab is selected', () => {
    const _generateBugReport = extractFn(src, 'generateBugReport');
    const generateBugReport = (errors, pageUrl) => _generateBugReport(errors, pageUrl, getTypeLabel, () => 'Login page');
    const errors = [{ type: 'console', level: 'error', message: 'boom', timestamp: Date.now() }];
    const report = generateBugReport(errors);
    assert.ok(report.includes('**Tab:** Login page'));
  });

  test('popup includes ignore rule UI and handlers', () => {
    assert.ok(src.includes('async function loadRules'));
    assert.ok(src.includes('function renderRules'));
    assert.ok(src.includes('async function addRule'));
    assert.ok(src.includes('async function removeRule'));
    assert.ok(src.includes('rulesToggle'));
    assert.ok(src.includes("action: 'add_ignore_rule'"));
    assert.ok(src.includes("action: 'remove_ignore_rule'"));
    assert.ok(src.includes('class="ignore-btn"'));
  });

  test('popup includes per-tab filter UI and logic', () => {
    assert.ok(src.includes('function updateTabFilter'));
    assert.ok(src.includes("e.tabId != null"));
    assert.ok(src.includes("String(e.tabId) !== currentTab"));
    assert.ok(src.includes('tabFilter'));
    assert.ok(src.includes("action: 'get_errors'"));
  });

  test('fileBugReport: bug report tab uses an external script (MV3 CSP blocks inline)', () => {
    const start = src.indexOf('async function fileBugReport');
    const end = src.indexOf('function generateBugReport');
    const body = src.slice(start, end);
    assert.ok(body.includes('id="copyReportBtn"'));
    assert.ok(body.includes("chrome.runtime.getURL('src/bug-report.js')"));
    assert.ok(!body.includes('onclick="copyReport()"'));
    assert.ok(!body.includes('<script>\nfunction copyReport'));
  });

  test('src/bug-report.js exists and wires the copy button via addEventListener (no inline script)', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'bug-report.js'), 'utf-8');
    assert.ok(script.includes("getElementById('copyReportBtn')"));
    assert.ok(script.includes('addEventListener'));
    assert.ok(!script.includes('</script'), 'must be a plain JS file, not an inline <script> block');
    new Function(script); // valid JS
  });

  test('copy and ignore buttons use unfiltered error index', () => {
    const copyLine = src.split('\n').find(l => l.includes('copy-btn"'));
    assert.ok(copyLine.includes('origIndex'), 'copy-btn must use origIndex, not filtered index');
  });

  // ── Behavioral tests: execute extracted logic with injected globals ──
  const getFilteredErrors = extractFn(src, 'getFilteredErrors');

  function runGetFilteredErrors(errors, currentFilter, currentTab, searchText) {
    const f = new Function('errors', 'currentFilter', 'currentTab', 'searchText', 'return ' + getFilteredErrors)
      (errors, currentFilter, currentTab, searchText);
    return f(errors, currentFilter, currentTab, searchText);
  }

  test('getFilteredErrors: applies type filter', () => {
    const errors = [
      { type: 'console', level: 'error', message: 'a', tabId: 1 },
      { type: 'network', message: 'b', tabId: 1 }
    ];
    const out = runGetFilteredErrors(errors, 'network', '', '');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'network');
  });

  test('getFilteredErrors: warning filter only keeps level warn', () => {
    const errors = [
      { type: 'console', level: 'error', message: 'a', tabId: 1 },
      { type: 'console', level: 'warn', message: 'b', tabId: 1 }
    ];
    const out = runGetFilteredErrors(errors, 'warning', '', '');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].level, 'warn');
  });

  test('getFilteredErrors: tab filter narrows to one tab', () => {
    const errors = [
      { type: 'console', level: 'error', message: 'a', tabId: 1 },
      { type: 'console', level: 'error', message: 'b', tabId: 2 }
    ];
    const out = runGetFilteredErrors(errors, 'all', '2', '');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].tabId, 2);
  });

  test('getFilteredErrors: search matches message, url, or status', () => {
    const errors = [
      { type: 'network', message: 'Server error', url: 'https://api.example.com/login', status: 500 },
      { type: 'console', level: 'error', message: 'TypeError: x', url: 'https://site.com/a.js' }
    ];
    assert.strictEqual(runGetFilteredErrors(errors, 'all', '', '500').length, 1);
    assert.strictEqual(runGetFilteredErrors(errors, 'all', '', 'example.com').length, 1);
    assert.strictEqual(runGetFilteredErrors(errors, 'all', '', 'typeerror').length, 1);
    assert.strictEqual(runGetFilteredErrors(errors, 'all', '', 'nothing').length, 0);
  });

  const getTabLabels = extractFn(src, 'getTabLabels');
  const truncateUrl = extractFn(src, 'truncateUrl');

  function runGetTabLabels(errors) {
    const f = new Function('errors', 'truncateUrl', 'return ' + getTabLabels)(errors, truncateUrl);
    return f(errors, truncateUrl);
  }

  test('getTabLabels: unique labels stay plain', () => {
    const labels = runGetTabLabels([
      { type: 'console', tabId: 1, tabUrl: 'https://site.com/a' },
      { type: 'console', tabId: 2, tabUrl: 'https://other.com/b' }
    ]);
    assert.strictEqual(labels.get('1'), 'site.com/a');
    assert.strictEqual(labels.get('2'), 'other.com/b');
  });

  test('getTabLabels: colliding labels get tab id suffix', () => {
    const labels = runGetTabLabels([
      { type: 'console', tabId: 1, tabUrl: 'https://site.com/app' },
      { type: 'console', tabId: 2, tabUrl: 'https://site.com/app' }
    ]);
    assert.ok(labels.get('1').endsWith('(tab 1)'));
    assert.ok(labels.get('2').endsWith('(tab 2)'));
  });

  test('getTabLabels: ignores errors without tabId', () => {
    const labels = runGetTabLabels([{ type: 'console', message: 'no tab' }]);
    assert.strictEqual(labels.size, 0);
  });

  test('renderErrors: changing search re-renders even when aggregate stats match', () => {
    const renderErrorsSrc = extractFn(src, 'renderErrors').toString();
    const makeRenderer = new Function('renderErrorsSrc', `
      return function () {
        let lastRenderKey = '';
        let sortAscending = false;
        let currentTab = '';
        let searchText = '';
        const allErrors = [
          { type: 'console', level: 'error', message: 'aaa boom', url: 'u', timestamp: 100 },
          { type: 'console', level: 'error', message: 'bbb boom', url: 'u', timestamp: 100 }
        ];
        const errorCount = { textContent: '' };
        const errorList = { innerHTML: '', scrollTop: 0, clientHeight: 100, scrollHeight: 100, querySelectorAll: () => [] };
        const expandToggle = { textContent: '' };
        const getFilteredErrors = () => allErrors.filter(e => (e.message || '').toLowerCase().includes(searchText));
        const buildErrorItem = (e) => '<div class="err">' + e.message + '</div>';
        ${renderErrorsSrc}
        return { render: renderErrors, setSearch: (s) => { searchText = s; }, list: errorList, key: () => lastRenderKey };
      }
    `);
    const renderer = makeRenderer(renderErrorsSrc)();
    renderer.setSearch('aaa');
    renderer.render();
    assert.ok(renderer.list.innerHTML.includes('aaa boom'));
    renderer.setSearch('bbb');
    renderer.render();
    assert.ok(renderer.list.innerHTML.includes('bbb boom'), 'search change must rebuild the list');
    assert.ok(!renderer.list.innerHTML.includes('aaa boom'));
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
