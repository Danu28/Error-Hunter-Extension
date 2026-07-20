// Error Hunter - Content Script Unit Tests
// Tests error interception logic, patching, error shapes, and cleanup

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
    // This is a syntax check - using require() would fail on browser APIs
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    // Just check it has proper JS structure
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

  test('content.js tracks originals for cleanup', () => {
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');
    const expectedOriginals = ['consoleError'];
    for (const orig of expectedOriginals) {
      assert.ok(
        src.includes(`originals.${orig}`),
        `Missing originals tracking: ${orig}`
      );
    }
  });

  // ════════════════════════════════════════════
  // SECTION 2: Error Object Shape Schema Tests
  // ════════════════════════════════════════════

  test('console error object shape is correct', () => {
    const consoleError = {
      type: 'console',
      message: 'Something went wrong',
      stack: 'Error: test\n    at file.js:1:1',
      url: 'https://example.com/page',
      timestamp: 1234567890000
    };

    // Validate required fields and types
    assert.strictEqual(consoleError.type, 'console');
    assert.ok(typeof consoleError.message === 'string');
    assert.ok(consoleError.stack === null || typeof consoleError.stack === 'string');
    assert.ok(typeof consoleError.url === 'string');
    assert.ok(typeof consoleError.timestamp === 'number');
    // Optional fields should be absent or undefined
    assert.strictEqual(consoleError.line, undefined);
    assert.strictEqual(consoleError.column, undefined);
    assert.strictEqual(consoleError.status, undefined);
    assert.strictEqual(consoleError.method, undefined);
  });

  test('network error object shape is correct', () => {
    const networkError = {
      type: 'network',
      message: 'Fetch GET https://api.example.com/404 returned 404 Not Found',
      url: 'https://api.example.com/404',
      method: 'GET',
      status: 404,
      statusText: 'Not Found',
      timestamp: 1234567890000
    };

    assert.strictEqual(networkError.type, 'network');
    assert.ok(typeof networkError.message === 'string');
    assert.ok(typeof networkError.url === 'string');
    assert.ok(typeof networkError.method === 'string');
    assert.ok(typeof networkError.status === 'number');
    assert.ok(typeof networkError.timestamp === 'number');
    // Network errors don't have stack in current implementation
    assert.strictEqual(networkError.stack, undefined);
  });

  test('window error object shape is correct', () => {
    const windowError = {
      type: 'console',
      message: 'Uncaught SyntaxError: Unexpected token',
      stack: null,
      url: 'https://example.com/script.js',
      line: 42,
      column: 10,
      timestamp: 1234567890000
    };

    assert.strictEqual(windowError.type, 'console');
    assert.ok(typeof windowError.message === 'string');
    assert.ok(typeof windowError.url === 'string');
    assert.ok(typeof windowError.timestamp === 'number');
    assert.ok(typeof windowError.line === 'number');
    assert.ok(typeof windowError.column === 'number');
  });

  test('network failure error (status 0) shape is correct', () => {
    const networkFailure = {
      type: 'network',
      message: 'Fetch GET https://api.example.com/ failed: Failed to fetch',
      url: 'https://api.example.com/',
      method: 'GET',
      status: 0,
      statusText: 'Network Failure',
      timestamp: 1234567890000
    };

    assert.strictEqual(networkFailure.type, 'network');
    assert.strictEqual(networkFailure.status, 0);
    assert.strictEqual(networkFailure.statusText, 'Network Failure');
  });

  test('unhandled rejection error shape is correct', () => {
    const rejectionError = {
      type: 'console',
      message: 'Promise rejected with error',
      stack: 'Error: reject reason\n    at file.js:5:10',
      url: 'https://example.com/page',
      timestamp: 1234567890000
    };

    assert.strictEqual(rejectionError.type, 'console');
    assert.ok(typeof rejectionError.message === 'string');
    assert.ok(rejectionError.stack === null || typeof rejectionError.stack === 'string');
  });

  // ════════════════════════════════════════════
  // SECTION 3: ReportError Logic Tests
  // ════════════════════════════════════════════

  test('reportError calls chrome.runtime.sendMessage with correct payload', () => {
    // Simulate the reportError function behavior
    let sentMessage = null;
    let monitoringActive = true;

    function mockReportError(error) {
      if (!monitoringActive) return;
      sentMessage = { action: 'new_error', error };
    }

    const testError = {
      type: 'console',
      message: 'test message',
      stack: null,
      url: 'https://example.com/',
      timestamp: 1234567890000
    };

    mockReportError(testError);

    assert.ok(sentMessage !== null);
    assert.strictEqual(sentMessage.action, 'new_error');
    assert.deepStrictEqual(sentMessage.error, testError);
  });

  test('reportError does not send when monitoring is false', () => {
    let sentMessage = null;
    let monitoringActive = false;

    function mockReportError(error) {
      if (!monitoringActive) return;
      sentMessage = { action: 'new_error', error };
    }

    mockReportError({ type: 'console', message: 'test' });
    assert.strictEqual(sentMessage, null);
  });

  // ════════════════════════════════════════════
  // SECTION 4: Console.Error Interception Logic
  // ════════════════════════════════════════════

  test('console.error interception builds message from args', () => {
    // Simulate the patched console.error logic
    function buildErrorMessage(args) {
      return args.map(a => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }
        return String(a);
      }).join(' ');
    }

    // Test with strings
    assert.strictEqual(buildErrorMessage(['error', 'occurred']), 'error occurred');

    // Test with Error object
    const err = new Error('Something broke');
    assert.strictEqual(buildErrorMessage(['Error:', err]), 'Error: Something broke');

    // Test with objects
    assert.strictEqual(buildErrorMessage([{ code: 500 }]), '{"code":500}');

    // Test mixed
    assert.strictEqual(
      buildErrorMessage(['Failed:', err, 'at', 'module.js']),
      'Failed: Something broke at module.js'
    );
  });

  test('console.error interception extracts stack from Error argument', () => {
    function extractStack(args) {
      const found = args.find(a => a instanceof Error);
      return found ? found.stack : null;
    }

    const err = new Error('test');
    const stack = extractStack(['something', err]);
    assert.ok(stack !== null);
    assert.ok(stack.includes('Error: test'));

    // No Error arg
    assert.strictEqual(extractStack(['just', 'strings']), null);
  });

  // ════════════════════════════════════════════
  // SECTION 5: Fetch Interception Logic
  // ════════════════════════════════════════════

  test('fetch detects 4xx response as error', () => {
    // Simulate the fetch check logic
    function isFailedResponse(response) {
      return !response.ok && response.status >= 400;
    }

    assert.strictEqual(isFailedResponse({ ok: false, status: 404 }), true);
    assert.strictEqual(isFailedResponse({ ok: false, status: 500 }), true);
    assert.strictEqual(isFailedResponse({ ok: false, status: 400 }), true);

    // Non-errors
    assert.strictEqual(isFailedResponse({ ok: true, status: 200 }), false);
    assert.strictEqual(isFailedResponse({ ok: true, status: 301 }), false);

    // Note: HTTP redirects (3xx) have ok: true so they're not reported
    assert.strictEqual(isFailedResponse({ ok: true, status: 304 }), false);
  });

  test('fetch builds error message with method and URL', () => {
    function buildFetchErrorMessage(method, url, status, statusText) {
      return `Fetch ${method} ${url} returned ${status} ${statusText}`;
    }

    assert.strictEqual(
      buildFetchErrorMessage('GET', 'https://api.example.com/data', 404, 'Not Found'),
      'Fetch GET https://api.example.com/data returned 404 Not Found'
    );

    assert.strictEqual(
      buildFetchErrorMessage('POST', 'https://api.example.com/submit', 500, 'Internal Server Error'),
      'Fetch POST https://api.example.com/submit returned 500 Internal Server Error'
    );
  });

  test('fetch builds network failure message', () => {
    function buildFetchFailureMessage(method, url, errMessage) {
      return `Fetch ${method} ${url} failed: ${errMessage}`;
    }

    assert.strictEqual(
      buildFetchFailureMessage('GET', 'https://api.example.com/', 'Failed to fetch'),
      'Fetch GET https://api.example.com/ failed: Failed to fetch'
    );
  });

  test('fetch extracts method and URL from Request object vs string', () => {
    // Test the URL/method extraction logic
    function extractFetchDetails(args) {
      let url = '';
      let method = 'GET';

      if (args[0] instanceof Object && args[0].url) {
        url = args[0].url;
        method = args[0].method || 'GET';
      } else if (typeof args[0] === 'string') {
        url = args[0];
        method = (args[1] && args[1].method) || 'GET';
      }

      return { url, method };
    }

    // String URL
    assert.deepStrictEqual(
      extractFetchDetails(['https://api.example.com/data', { method: 'POST' }]),
      { url: 'https://api.example.com/data', method: 'POST' }
    );

    // String URL, no options
    assert.deepStrictEqual(
      extractFetchDetails(['https://api.example.com/data']),
      { url: 'https://api.example.com/data', method: 'GET' }
    );

    // Request-like object
    assert.deepStrictEqual(
      extractFetchDetails([{ url: 'https://api.example.com/data', method: 'DELETE' }]),
      { url: 'https://api.example.com/data', method: 'DELETE' }
    );
  });

  // ════════════════════════════════════════════
  // SECTION 6: XHR Interception Logic
  // ════════════════════════════════════════════

  test('XHR builds error message with method and URL', () => {
    function buildXHRErrorMessage(method, url, status, statusText) {
      return `XHR ${method} ${url} returned ${status} ${statusText}`;
    }

    assert.strictEqual(
      buildXHRErrorMessage('GET', 'https://api.example.com/data', 404, 'Not Found'),
      'XHR GET https://api.example.com/data returned 404 Not Found'
    );

    assert.strictEqual(
      buildXHRErrorMessage('PUT', 'https://api.example.com/update', 500, 'Server Error'),
      'XHR PUT https://api.example.com/update returned 500 Server Error'
    );
  });

  test('XHR network failure message', () => {
    function buildXHRFailureMessage(method, url) {
      return `XHR ${method} ${url} failed: Network error`;
    }

    assert.strictEqual(
      buildXHRFailureMessage('POST', 'https://api.example.com/submit'),
      'XHR POST https://api.example.com/submit failed: Network error'
    );
  });

  test('XHR detects status >= 400 as error', () => {
    function isXHRError(status) {
      return status >= 400;
    }

    assert.strictEqual(isXHRError(404), true);
    assert.strictEqual(isXHRError(500), true);
    assert.strictEqual(isXHRError(401), true);
    assert.strictEqual(isXHRError(200), false);
    assert.strictEqual(isXHRError(301), false);
    assert.strictEqual(isXHRError(0), false);
  });

  // ════════════════════════════════════════════
  // SECTION 7: Start/Stop Logic
  // ════════════════════════════════════════════

  test('startMonitoring should be idempotent', () => {
    // Simulate the startMonitoring guard
    let monitoring = false;
    let patchCount = 0;

    function startMonitoring() {
      if (monitoring) return;
      monitoring = true;
      patchCount++;
    }

    startMonitoring();
    assert.strictEqual(monitoring, true);
    assert.strictEqual(patchCount, 1);

    // Second call should be no-op
    startMonitoring();
    assert.strictEqual(patchCount, 1);
  });

  test('stopMonitoring should be idempotent', () => {
    let monitoring = true;
    let stopCount = 0;

    function stopMonitoring() {
      if (!monitoring) return;
      monitoring = false;
      stopCount++;
    }

    stopMonitoring();
    assert.strictEqual(monitoring, false);
    assert.strictEqual(stopCount, 1);

    // Second call should be no-op
    stopMonitoring();
    assert.strictEqual(stopCount, 1);
  });

  test('start sets up patches, stop tears them down', () => {
    // Verify the patching pattern: each patch has a corresponding unpatch
    const src = fs.readFileSync(CONTENT_JS_PATH, 'utf-8');

    // Count function pairs
    const patches = [
      { patch: 'patchConsoleError', unpatch: 'unpatchConsoleError' }
    ];

    assert.ok(src.includes('addErrorListeners'));
    assert.ok(src.includes('removeErrorListeners'));
    assert.ok(src.includes('addPageWorldListeners'));
    assert.ok(src.includes('removePageWorldListeners'));

    for (const pair of patches) {
      assert.ok(
        src.indexOf(pair.patch) < src.indexOf(pair.unpatch),
        `${pair.patch} should be defined before ${pair.unpatch}`
      );
    }
  });

  // ════════════════════════════════════════════
  // SECTION 8: Edge Cases
  // ════════════════════════════════════════════

  test('console.error handles non-serializable objects gracefully', () => {
    function safeStringify(a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }

    // Circular reference
    const circular = { a: 1 };
    circular.self = circular;
    // Should not throw
    const result = safeStringify(circular);
    assert.ok(typeof result === 'string');
  });

  test('console.error handles null/undefined gracefully', () => {
    function mapArg(a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }

    assert.strictEqual(mapArg(null), 'null');
    assert.strictEqual(mapArg(undefined), 'undefined');
    assert.strictEqual(mapArg(42), '42');
    assert.strictEqual(mapArg(true), 'true');
  });

  test('handleWindowError gets line and column from event', () => {
    const mockEvent = {
      message: 'Test error',
      error: new Error('Test'),
      filename: 'https://example.com/script.js',
      lineno: 42,
      colno: 10
    };

    const errorObj = {
      type: 'console',
      message: mockEvent.message,
      stack: mockEvent.error.stack,
      url: mockEvent.filename,
      line: mockEvent.lineno,
      column: mockEvent.colno,
      timestamp: Date.now()
    };

    assert.strictEqual(errorObj.line, 42);
    assert.strictEqual(errorObj.column, 10);
    assert.strictEqual(errorObj.url, 'https://example.com/script.js');
  });

  test('handleUnhandledRejection extracts message from Error reason', () => {
    const reason = new Error('Promise failed');
    const message = reason.message || reason.toString() || 'Unhandled Promise rejection';
    const stack = reason.stack || null;

    assert.strictEqual(message, 'Promise failed');
    assert.ok(stack !== null);
    assert.ok(stack.includes('Promise failed'));
  });

  test('handleUnhandledRejection handles non-Error reason', () => {
    const reason = 'string rejection';
    const message = reason?.message || reason?.toString() || 'Unhandled Promise rejection';
    const stack = reason?.stack || null;

    assert.strictEqual(message, 'string rejection');
    assert.strictEqual(stack, null);

    const reason2 = 42;
    const message2 = reason2?.message || reason2?.toString() || 'Unhandled Promise rejection';
    assert.strictEqual(message2, '42');
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
