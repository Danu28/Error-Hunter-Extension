// Error Hunter - Service Worker
// Background script managing badge, error storage, and messaging

console.log('[Error Hunter] Service Worker starting at', new Date().toISOString());

const STORAGE_KEY = 'error_hunter_errors';
const STATUS_KEY = 'error_hunter_active';

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Error Hunter] SW onInstalled fired - initializing state');
  chrome.storage.session.set({ [STATUS_KEY]: false });
  chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderInfo = sender.tab ? `tab:${sender.tab.id}` : (sender.id ? `ext:${sender.id}` : 'unknown');
  console.log('[Error Hunter] SW received message:', message.action, 'from', senderInfo, 'at', new Date().toISOString());
  switch (message.action) {
    case 'new_error':
      console.log('[Error Hunter] SW handling new_error - type:', message.error?.type, 'msg:', message.error?.message?.substring(0, 80));
      handleNewError(message.error, sender).then(() => {
        console.log('[Error Hunter] SW new_error handler completed, sending response');
        sendResponse({});
      });
      return true;

    case 'get_errors':
      console.log('[Error Hunter] SW handling get_errors');
      handleGetErrors(sendResponse);
      return true; // Keep channel open for async response

    case 'get_status':
      console.log('[Error Hunter] SW handling get_status');
      handleGetStatus(sendResponse);
      return true;

    case 'start_monitoring':
      console.log('[Error Hunter] SW handling start_monitoring');
      handleStartMonitoring(sendResponse);
      return true;

    case 'stop_monitoring':
      console.log('[Error Hunter] SW handling stop_monitoring');
      handleStopMonitoring(sendResponse);
      return true;

    case 'inject_page_world':
      console.log('[Error Hunter] SW handling inject_page_world');
      handleInjectPageWorld(sender, sendResponse);
      return true;

    case 'clear_errors':
      console.log('[Error Hunter] SW handling clear_errors');
      handleClearErrors(sendResponse);
      return true;

    default:
      console.warn('[Error Hunter] SW unknown message action:', message.action);
  }
});

// Store a new error and update badge
async function handleNewError(error, sender) {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const errors = result[STORAGE_KEY] || [];
    console.log('[Error Hunter] handleNewError - current count:', errors.length, 'storage key:', STORAGE_KEY);

    // Enrich error with tab info if available
    if (sender && sender.tab) {
      error.tabId = sender.tab.id;
      error.tabUrl = sender.tab.url;
    }

    errors.push(error);
    await chrome.storage.session.set({ [STORAGE_KEY]: errors });
    console.log('[Error Hunter] handleNewError - stored error, new count:', errors.length);
    await updateBadge(errors.length);
  } catch (err) {
    console.error('[Error Hunter] Failed to store error:', err);
  }
}

// Return all stored errors
async function handleGetErrors(sendResponse) {
  try {
    const result = await chrome.storage.session.get([STORAGE_KEY, STATUS_KEY]);
    const errorCount = (result[STORAGE_KEY] || []).length;
    console.log('[Error Hunter] handleGetErrors - returning', errorCount, 'errors, isMonitoring:', result[STATUS_KEY] || false);
    sendResponse({
      errors: result[STORAGE_KEY] || [],
      isMonitoring: result[STATUS_KEY] || false
    });
  } catch (err) {
    console.error('[Error Hunter] handleGetErrors FAILED:', err.message);
    sendResponse({ errors: [], isMonitoring: false });
  }
}

// Return monitoring status
async function handleGetStatus(sendResponse) {
  try {
    const result = await chrome.storage.session.get(STATUS_KEY);
    console.log('[Error Hunter] handleGetStatus - isMonitoring:', result[STATUS_KEY] || false);
    sendResponse({ isMonitoring: result[STATUS_KEY] || false });
  } catch (err) {
    console.error('[Error Hunter] handleGetStatus FAILED:', err.message);
    sendResponse({ isMonitoring: false });
  }
}

// Start monitoring: inject content scripts into all tabs, set flag
async function handleStartMonitoring(sendResponse) {
  try {
    console.log('[Error Hunter] handleStartMonitoring - setting STATUS_KEY to true');
    await chrome.storage.session.set({ [STATUS_KEY]: true });

    // Broadcast start to all tabs with content scripts
    const tabs = await chrome.tabs.query({});
    console.log('[Error Hunter] handleStartMonitoring - found', tabs.length, 'tabs, broadcasting start');
    let sentCount = 0;
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('http')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'start' });
          sentCount++;
          console.log('[Error Hunter] handleStartMonitoring - sent start to tab', tab.id, tab.url?.substring(0, 80));
        } catch (e) {
          console.log('[Error Hunter] handleStartMonitoring - tab', tab.id, 'not ready:', e.message);
        }
      }
    }
    console.log('[Error Hunter] handleStartMonitoring - broadcast to', sentCount, 'tabs successfully');

    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleStartMonitoring FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Stop monitoring: clear badge, clear errors, send stop to tabs
async function handleStopMonitoring(sendResponse) {
  try {
    console.log('[Error Hunter] handleStopMonitoring - stopping monitoring');
    await chrome.storage.session.set({ [STATUS_KEY]: false });
    await chrome.storage.session.set({ [STORAGE_KEY]: [] });
    await chrome.action.setBadgeText({ text: '' });

    // Broadcast stop to all tabs
    const tabs = await chrome.tabs.query({});
    console.log('[Error Hunter] handleStopMonitoring - broadcasting stop to', tabs.length, 'tabs');
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('http')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'stop' });
        } catch (e) {
          // Tab may not have content script, that's fine
        }
      }
    }

    sendResponse({ success: true });
    console.log('[Error Hunter] handleStopMonitoring - completed');
  } catch (err) {
    console.error('[Error Hunter] handleStopMonitoring FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Clear errors without stopping monitoring
async function handleClearErrors(sendResponse) {
  try {
    console.log('[Error Hunter] handleClearErrors - clearing errors');
    await chrome.storage.session.set({ [STORAGE_KEY]: [] });
    await chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleClearErrors FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// ── Inject page-world error capture via scripting API ──
// This bypasses CSP because the injection happens at the extension level,
// not through DOM <script> element insertion.
async function handleInjectPageWorld(sender, sendResponse) {
  try {
    if (!sender.tab) {
      console.log('[Error Hunter] handleInjectPageWorld - no sender tab, skipping');
      sendResponse({ success: false, error: 'no tab' });
      return;
    }
    console.log('[Error Hunter] handleInjectPageWorld - injecting into tab', sender.tab.id);
    await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: injectPageWorldErrorCapture,
    });
    console.log('[Error Hunter] handleInjectPageWorld - injected successfully');
    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleInjectPageWorld FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Self-contained function that runs in the page's MAIN world.
// This is serialized via toString() by executeScript, so it MUST NOT
// reference any outer scope variables or imports.
function injectPageWorldErrorCapture() {
  if (window.__eh_patched) return;
  window.__eh_patched = true;

  var _origConsoleError = console.error;

  console.error = function() {
    _origConsoleError.apply(console, arguments);

    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function(a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch(e) { return String(a); }
      }
      return String(a);
    }).join(' ');

    var stack = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) {
        stack = args[i].stack;
        break;
      }
    }

    window.dispatchEvent(new CustomEvent('eh-console-error', {
      detail: { type: 'console', message: message, stack: stack, url: location.href, timestamp: Date.now() }
    }));
  };

  window.addEventListener('error', function(e) {
    window.dispatchEvent(new CustomEvent('eh-window-error', {
      detail: {
        type: 'console',
        message: e.message || 'Unknown error',
        stack: e.error ? e.error.stack : null,
        url: e.filename || location.href,
        line: e.lineno,
        column: e.colno,
        timestamp: Date.now()
      }
    }));
  });

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var message = reason && reason.message ? reason.message : String(reason);
    var stack = reason && reason.stack ? reason.stack : null;
    window.dispatchEvent(new CustomEvent('eh-unhandled-rejection', {
      detail: { type: 'console', message: message, stack: stack, url: location.href, timestamp: Date.now() }
    }));
  });

  // ── Fetch interception ──
  var _origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    var url = '';
    var method = 'GET';

    if (args[0] instanceof Request) {
      url = args[0].url;
      method = args[0].method || 'GET';
    } else if (typeof args[0] === 'string') {
      url = args[0];
      method = (args[1] && args[1].method) || 'GET';
    }

    return _origFetch.apply(window, args).then(function(response) {
      if (!response.ok && response.status >= 400) {
        window.dispatchEvent(new CustomEvent('eh-network-error', {
          detail: {
            type: 'network',
            message: 'Fetch ' + method + ' ' + url + ' returned ' + response.status + ' ' + response.statusText,
            url: url, method: method, status: response.status, statusText: response.statusText,
            timestamp: Date.now()
          }
        }));
      }
      return response;
    }).catch(function(err) {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: {
          type: 'network',
          message: 'Fetch ' + method + ' ' + url + ' failed: ' + err.message,
          url: url, method: method, status: 0, statusText: 'Network Failure',
          timestamp: Date.now()
        }
      }));
      throw err;
    });
  };

  // ── XHR interception ──
  var _origXHROpen = XMLHttpRequest.prototype.open;
  var _origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._eh_method = method;
    this._eh_url = (typeof url === 'string') ? url : (url ? String(url) : '');
    return _origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('loadend', function() {
      if (xhr.status >= 400) {
        window.dispatchEvent(new CustomEvent('eh-network-error', {
          detail: {
            type: 'network',
            message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' returned ' + xhr.status + ' ' + xhr.statusText,
            url: xhr._eh_url, method: xhr._eh_method,
            status: xhr.status, statusText: xhr.statusText,
            timestamp: Date.now()
          }
        }));
      }
    });
    xhr.addEventListener('error', function() {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: {
          type: 'network',
          message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' failed: Network error',
          url: xhr._eh_url, method: xhr._eh_method,
          status: 0, statusText: 'Network Failure',
          timestamp: Date.now()
        }
      }));
    });
    return _origXHRSend.apply(xhr, arguments);
  };
}

// Update the badge with current error count
async function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  console.log('[Error Hunter] updateBadge - setting badge to:', text || '(empty)');
  await chrome.action.setBadgeText({ text: text });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  }
}

// Listen for tab updates to re-inject start signal if monitoring is active
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    try {
      const result = await chrome.storage.session.get(STATUS_KEY);
      if (result[STATUS_KEY]) {
        console.log('[Error Hunter] tabs.onUpdated - tab', tabId, 'completed, sending start (monitoring active)');
        await chrome.tabs.sendMessage(tabId, { action: 'start' });
      }
    } catch (e) {
      // Tab may not be ready, ignore
    }
  }
});
