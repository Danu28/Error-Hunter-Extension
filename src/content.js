// Error Hunter - Content Script
// Captures console errors, uncaught exceptions, unhandled rejections, and failed network requests

console.log('[Error Hunter] Content script loaded at', window.location.href);

let monitoring = false;

// Store original implementations for cleanup
const originals = {
  consoleError: null
};

// Listen for start/stop commands from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Error Hunter] Content script received message:', message.action, 'from:', sender.id ? 'extension' : 'unknown');
  if (message.action === 'start') {
    console.log('[Error Hunter] START message received - calling startMonitoring()');
    startMonitoring();
    sendResponse({ received: true });
  } else if (message.action === 'stop') {
    console.log('[Error Hunter] STOP message received - calling stopMonitoring()');
    stopMonitoring();
    sendResponse({ received: true });
  }
  return true; // Keep channel open
});

// Send error to service worker
function reportError(error) {
  if (!monitoring) {
    console.log('[Error Hunter] reportError SKIPPED - monitoring is false');
    return;
  }
  console.log('[Error Hunter] reportError - type:', error.type, 'message:', error.message?.substring(0, 100), 'url:', error.url?.substring(0, 80));
  chrome.runtime.sendMessage({ action: 'new_error', error }).then(() => {
    console.log('[Error Hunter] new_error message sent successfully');
  }).catch((err) => {
    console.error('[Error Hunter] new_error sendMessage FAILED:', err.message);
  });
}

// ── Page-World Error Capture (via chrome.scripting.executeScript) ──
// MV3 content scripts run in an isolated world. To patch console.error in the
// page's own context, we ask the service worker to inject code via
// chrome.scripting.executeScript with world: "MAIN", which bypasses CSP.
// The injected code dispatches CustomEvents that we listen for here.

const pageWorldHandlers = { consoleError: null, windowError: null, unhandledRejection: null, networkError: null };

function addPageWorldListeners() {
  if (pageWorldHandlers.consoleError) return; // already added

  pageWorldHandlers.consoleError = (e) => { if (monitoring) { console.log('[Error Hunter] Page console.error intercepted via CustomEvent'); reportError(e.detail); } };
  pageWorldHandlers.windowError = (e) => { if (monitoring) { console.log('[Error Hunter] Page window.error intercepted via CustomEvent'); reportError(e.detail); } };
  pageWorldHandlers.unhandledRejection = (e) => { if (monitoring) reportError(e.detail); };
  pageWorldHandlers.networkError = (e) => { if (monitoring) { console.log('[Error Hunter] Page network error intercepted via CustomEvent'); reportError(e.detail); } };

  window.addEventListener('eh-console-error', pageWorldHandlers.consoleError);
  window.addEventListener('eh-window-error', pageWorldHandlers.windowError);
  window.addEventListener('eh-unhandled-rejection', pageWorldHandlers.unhandledRejection);
  window.addEventListener('eh-network-error', pageWorldHandlers.networkError);
}

function removePageWorldListeners() {
  if (!pageWorldHandlers.consoleError) return;

  window.removeEventListener('eh-console-error', pageWorldHandlers.consoleError);
  window.removeEventListener('eh-window-error', pageWorldHandlers.windowError);
  window.removeEventListener('eh-unhandled-rejection', pageWorldHandlers.unhandledRejection);
  window.removeEventListener('eh-network-error', pageWorldHandlers.networkError);

  pageWorldHandlers.consoleError = null;
  pageWorldHandlers.windowError = null;
  pageWorldHandlers.unhandledRejection = null;
  pageWorldHandlers.networkError = null;
}

// ── Console Error Interception ──
function patchConsoleError() {
  if (originals.consoleError) {
    console.log('[Error Hunter] patchConsoleError - already patched, skipping');
    return;
  }
  console.log('[Error Hunter] patchConsoleError - patching console.error');
  originals.consoleError = console.error;

  console.error = function (...args) {
    // Call original first
    originals.consoleError.apply(console, args);

    const message = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch (e) { return String(a); }
      return String(a);
    }).join(' ');

    const stack = args.find(a => a instanceof Error)?.stack || null;

    reportError({
      type: 'console',
      message,
      stack,
      url: window.location.href,
      timestamp: Date.now()
    });
  };
}

function unpatchConsoleError() {
  if (originals.consoleError) {
    console.error = originals.consoleError;
    originals.consoleError = null;
  }
}

// ── Uncaught Exception Interception ──
function addErrorListeners() {
  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}

function removeErrorListeners() {
  window.removeEventListener('error', handleWindowError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
}

function handleWindowError(event) {
  console.log('[Error Hunter] Window error event caught:', event.message?.substring(0, 100), 'at', event.filename, 'line', event.lineno);
  reportError({
    type: 'console',
    message: event.message || 'Unknown error',
    stack: event.error?.stack || null,
    url: event.filename || window.location.href,
    line: event.lineno,
    column: event.colno,
    timestamp: Date.now()
  });
}

function handleUnhandledRejection(event) {
  const reason = event.reason;
  const message = reason?.message || reason?.toString() || 'Unhandled Promise rejection';
  const stack = reason?.stack || null;
  console.log('[Error Hunter] Unhandled rejection caught:', message?.substring(0, 100));

  reportError({
    type: 'console',
    message,
    stack,
    url: window.location.href,
    timestamp: Date.now()
  });
}

// ── Fetch and XHR interception moved to page-world injection ──
// See injectPageWorldErrorCapture() in service-worker.js which patches
// window.fetch and XMLHttpRequest.prototype in the MAIN world via
// chrome.scripting.executeScript({ world: "MAIN" }).

// ── Start / Stop ──
function startMonitoring() {
  if (monitoring) {
    console.log('[Error Hunter] startMonitoring called but already monitoring');
    return;
  }
  monitoring = true;
  console.log('[Error Hunter] Monitoring STARTING...');

  patchConsoleError();
  addErrorListeners();
  addPageWorldListeners();

  // Ask service worker to inject page-world error capture via scripting API
  chrome.runtime.sendMessage({ action: 'inject_page_world' }).catch(() => {});

  console.log('[Error Hunter] Monitoring started successfully - now capturing errors on:', window.location.href);
}

function stopMonitoring() {
  if (!monitoring) {
    console.log('[Error Hunter] stopMonitoring called but not monitoring');
    return;
  }
  monitoring = false;
  console.log('[Error Hunter] Monitoring STOPPING...');

  unpatchConsoleError();
  removeErrorListeners();
  removePageWorldListeners();
  console.log('[Error Hunter] Monitoring stopped on:', window.location.href);
}

// Auto-start if service worker indicates monitoring is active
(async function init() {
  console.log('[Error Hunter] init() - checking monitoring status from SW');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_status' });
      console.log('[Error Hunter] init() attempt', attempt + 1, '- get_status response:', JSON.stringify(response));
      if (response && response.isMonitoring) {
        console.log('[Error Hunter] init() - SW says monitoring is active, starting...');
        startMonitoring();
      } else {
        console.log('[Error Hunter] init() - SW says monitoring is NOT active');
      }
      return; // Success or valid response
    } catch (e) {
      console.warn('[Error Hunter] init() attempt', attempt + 1, '- get_status FAILED:', e.message);
      if (attempt < 2) {
        console.log('[Error Hunter] init() - retrying in 500ms...');
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.error('[Error Hunter] init() - ALL 3 attempts exhausted, giving up');
      }
    }
  }
})();
