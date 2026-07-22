// Error Hunter - Content Script
// Captures console errors, uncaught exceptions, unhandled rejections, and failed network requests

let monitoring = false;

let originalConsoleError = null;
let originalConsoleWarn = null;

// Listen for start/stop commands from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startMonitoring();
    sendResponse({ received: true });
  } else if (message.action === 'stop') {
    stopMonitoring();
    sendResponse({ received: true });
  }
  return true; // Keep channel open
});

// Send error to service worker
function reportError(error) {
  if (!monitoring) {
    return;
  }
  chrome.runtime.sendMessage({ action: 'new_error', error }).catch((err) => {
    console.error('[Error Hunter] new_error sendMessage FAILED:', err.message);
  });
}

// ── Page-World Error Capture (via chrome.scripting.executeScript) ──
// MV3 content scripts run in an isolated world. To patch console.error in the
// page's own context, we ask the service worker to inject code via
// chrome.scripting.executeScript with world: "MAIN", which bypasses CSP.
// The injected code dispatches CustomEvents that we listen for here.

let pageWorldHandler = null;

const PAGE_WORLD_EVENTS = ['eh-console-error', 'eh-console-warn', 'eh-window-error', 'eh-unhandled-rejection', 'eh-network-error'];

function addPageWorldListeners() {
  if (pageWorldHandler) return;

  pageWorldHandler = (e) => { if (monitoring) reportError(e.detail); };

  for (const name of PAGE_WORLD_EVENTS) {
    window.addEventListener(name, pageWorldHandler);
  }
}

function removePageWorldListeners() {
  if (!pageWorldHandler) return;

  for (const name of PAGE_WORLD_EVENTS) {
    window.removeEventListener(name, pageWorldHandler);
  }

  pageWorldHandler = null;
}

// ── Console Error Interception ──
function patchConsoleError() {
  if (originalConsoleError) {
    return;
  }
  originalConsoleError = console.error;

  console.error = function (...args) {
    // Call original first
    originalConsoleError.apply(console, args);

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
  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }
}

function patchConsoleWarn() {
  if (originalConsoleWarn) {
    return;
  }
  originalConsoleWarn = console.warn;

  console.warn = function (...args) {
    originalConsoleWarn.apply(console, args);

    const message = '(warning) ' + args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch (e) { return String(a); }
      return String(a);
    }).join(' ');

    const stack = args.find(a => a instanceof Error)?.stack || null;

    reportError({
      type: 'console',
      level: 'warn',
      message,
      stack,
      url: window.location.href,
      timestamp: Date.now()
    });
  };
}

function unpatchConsoleWarn() {
  if (originalConsoleWarn) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
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
    return;
  }
  monitoring = true;

  patchConsoleError();
  patchConsoleWarn();
  addErrorListeners();
  addPageWorldListeners();

  // Ask service worker to inject page-world error capture via scripting API
  chrome.runtime.sendMessage({ action: 'inject_page_world' }).catch(() => {});
}

function stopMonitoring() {
  if (!monitoring) {
    return;
  }
  monitoring = false;

  unpatchConsoleError();
  unpatchConsoleWarn();
  removeErrorListeners();
  removePageWorldListeners();
}

// Auto-start if service worker indicates monitoring is active
(async function init() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_status' });
      if (response && response.isMonitoring) {
        startMonitoring();
      }
      return; // Success or valid response
    } catch (e) {
      console.warn('[Error Hunter] init() attempt', attempt + 1, '- get_status FAILED:', e.message);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.error('[Error Hunter] init() - ALL 3 attempts exhausted, giving up');
      }
    }
  }
})();
