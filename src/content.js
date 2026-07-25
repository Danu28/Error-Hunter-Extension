// Error Hunter - Content Script
// Captures console errors, uncaught exceptions, unhandled rejections, and failed network requests

let monitoring = false;

let originalConsoleError = null;
let originalConsoleWarn = null;
let originalConsoleLog = null;
let originalConsoleDebug = null;
let originalConsoleInfo = null;

// Ring buffer for console log breadcrumbs (last 5 entries)
let logBreadcrumbs = [];

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

// Send error to service worker (attaches log breadcrumbs)
function reportError(error) {
  if (!monitoring) {
    return;
  }
  error.logs = logBreadcrumbs.slice();
  chrome.runtime.sendMessage({ action: 'new_error', error }).catch((err) => {
    if (err.message.includes('Extension context invalidated')) {
      stopMonitoring();
    }
  });
}

// Push a log entry to the ring buffer (max 5)
function pushLog(message) {
  logBreadcrumbs.push({ message: message, timestamp: Date.now() });
  if (logBreadcrumbs.length > 5) {
    logBreadcrumbs.shift();
  }
}

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
function patchConsole(methodName, prefix, level) {
  const orig = methodName === 'error' ? originalConsoleError : originalConsoleWarn;
  if (orig) return;

  const consoleMethod = console[methodName];
  if (methodName === 'error') {
    originalConsoleError = consoleMethod;
  } else {
    originalConsoleWarn = consoleMethod;
  }

  console[methodName] = function (...args) {
    (methodName === 'error' ? originalConsoleError : originalConsoleWarn).apply(console, args);

    const message = prefix + args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch (e) { return String(a); }
      return String(a);
    }).join(' ');

    const stack = args.find(a => a instanceof Error)?.stack || null;

    reportError({
      type: 'console',
      ...(level ? { level } : {}),
      message,
      stack,
      url: window.location.href,
      timestamp: Date.now()
    });
  };
}

function unpatchConsole(methodName) {
  const orig = methodName === 'error' ? originalConsoleError : originalConsoleWarn;
  if (orig) {
    console[methodName] = orig;
    if (methodName === 'error') originalConsoleError = null;
    else originalConsoleWarn = null;
  }
}

function patchConsoleError() { patchConsole('error', ''); }
function patchConsoleWarn() { patchConsole('warn', '(warning) ', 'warn'); }
function unpatchConsoleError() { unpatchConsole('error'); }
function unpatchConsoleWarn() { unpatchConsole('warn'); }

// ── Console Log Breadcrumb Interception ──
function patchConsoleLog() {
  if (originalConsoleLog) return;
  originalConsoleLog = console.log;
  console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    pushLog(msg);
  };
}

function unpatchConsoleLog() {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
}

function patchConsoleDebug() {
  if (originalConsoleDebug) return;
  originalConsoleDebug = console.debug;
  console.debug = function (...args) {
    originalConsoleDebug.apply(console, args);
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    pushLog('(debug) ' + msg);
  };
}

function unpatchConsoleDebug() {
  if (originalConsoleDebug) {
    console.debug = originalConsoleDebug;
    originalConsoleDebug = null;
  }
}

function patchConsoleInfo() {
  if (originalConsoleInfo) return;
  originalConsoleInfo = console.info;
  console.info = function (...args) {
    originalConsoleInfo.apply(console, args);
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    pushLog('(info) ' + msg);
  };
}

function unpatchConsoleInfo() {
  if (originalConsoleInfo) {
    console.info = originalConsoleInfo;
    originalConsoleInfo = null;
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
    type: 'exception',
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
    type: 'unhandledrejection',
    message,
    stack,
    url: window.location.href,
    timestamp: Date.now()
  });
}

// ── Start / Stop ──
function startMonitoring() {
  if (monitoring) {
    return;
  }
  monitoring = true;
  logBreadcrumbs = [];

  patchConsoleError();
  patchConsoleWarn();
  patchConsoleLog();
  patchConsoleDebug();
  patchConsoleInfo();
  addErrorListeners();
  addPageWorldListeners();

  // Ask service worker to inject page-world error capture via scripting API
  chrome.runtime.sendMessage({ action: 'inject_page_world' }).catch((err) => {
    if (err.message.includes('Extension context invalidated')) {
      stopMonitoring();
    }
  });
}

function stopMonitoring() {
  if (!monitoring) {
    return;
  }
  monitoring = false;

  unpatchConsoleError();
  unpatchConsoleWarn();
  unpatchConsoleLog();
  unpatchConsoleDebug();
  unpatchConsoleInfo();
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
