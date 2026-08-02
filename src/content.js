// Error Hunter - Content Script
// Captures console errors, uncaught exceptions, unhandled rejections, and failed network requests

let monitoring = false;

let originalConsoleError = null;
let originalConsoleWarn = null;

let pageWorldHandler = null;
const PAGE_WORLD_EVENTS = ['eh-console-error', 'eh-console-warn', 'eh-console-log', 'eh-console-info', 'eh-console-debug', 'eh-window-error', 'eh-unhandled-rejection', 'eh-network-error', 'eh-user-action'];
const logBuffer = [];
const MAX_LOG_ENTRIES = 200;
const userActionBuffer = [];
const MAX_USER_ACTIONS = 50;

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
  // Repro context: where the user was when the error happened
  error.pageTitle = document.title;
  error.pageRoute = location.pathname + location.hash;
  chrome.runtime.sendMessage({ action: 'new_error', error }).catch((err) => {
    if (err.message.includes('Extension context invalidated')) {
      stopMonitoring();
    }
  });
}

// ── Page-World Event Bridge ──
function addPageWorldListeners() {
  if (pageWorldHandler) return;
  pageWorldHandler = (e) => {
    if (!monitoring) return;
    const d = e.detail;
    if (d.level === 'log' || d.level === 'info' || d.level === 'debug') {
      logBuffer.push({ message: d.message, level: d.level, timestamp: d.timestamp });
      if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
    } else if (d.actionType === 'click' || d.actionType === 'input') {
      userActionBuffer.push({ actionType: d.actionType, tag: d.tag, text: d.text, name: d.name, value: d.value, id: d.id, timestamp: d.timestamp || Date.now() });
      if (userActionBuffer.length > MAX_USER_ACTIONS) userActionBuffer.shift();
    } else {
      d.logContext = logBuffer.slice(-20);
      d.userActions = userActionBuffer.slice(-10);
      reportError(d);
    }
  };
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

// ── Start / Stop ──
function startMonitoring() {
  if (monitoring) {
    return;
  }
  monitoring = true;

  patchConsole('error', '');
  patchConsole('warn', '(warning) ', 'warn');
  addPageWorldListeners();

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

  unpatchConsole('error');
  unpatchConsole('warn');
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
