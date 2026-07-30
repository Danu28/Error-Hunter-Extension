// Error Hunter - Service Worker
// Background script managing badge, error storage, and messaging

const STORAGE_KEY = 'error_hunter_errors';
const STATUS_KEY = 'error_hunter_active';

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.set({ [STATUS_KEY]: false });
  chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'new_error':
      handleNewError(message.error, sender).then(() => {
        sendResponse({});
      });
      return true;

    case 'get_errors':
      handleGetErrors(sendResponse);
      return true; // Keep channel open for async response

    case 'get_status':
      handleGetStatus(sendResponse);
      return true;

    case 'start_monitoring':
      handleStartMonitoring(sendResponse);
      return true;

    case 'stop_monitoring':
      handleStopMonitoring(sendResponse);
      return true;

    case 'clear_errors':
      handleClearErrors(sendResponse);
      return true;

    case 'inject_page_world':
      handleInjectPageWorld(sender, sendResponse);
      return true;

    case 'delete_error':
      handleDeleteError(message, sendResponse);
      return true;

    default:
      console.warn('[Error Hunter] SW unknown message action:', message.action);
  }
});

async function handleInjectPageWorld(sender, sendResponse) {
  try {
    if (!sender.tab) { sendResponse({ success: false }); return; }
    await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: injectPageWorldErrorCapture,
    });
    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] injectPageWorld FAILED:', err.message);
    sendResponse({ success: false });
  }
}

// Runs in the page's MAIN world via executeScript
function injectPageWorldErrorCapture() {
  if (window.__eh_patched) return;
  window.__eh_patched = true;

  function makeDetail(type, extra) {
    extra.type = type;
    if (extra.url === undefined) extra.url = location.href;
    extra.timestamp = Date.now();
    return extra;
  }

  // Console.error
  var _origConsoleError = console.error;
  console.error = function () {
    _origConsoleError.apply(console, arguments);
    var args = Array.prototype.slice.call(arguments);
    var message = args.map(function (a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    var stack = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) { stack = args[i].stack; break; }
    }
    window.dispatchEvent(new CustomEvent('eh-console-error', {
      detail: makeDetail('console', { message: message, stack: stack })
    }));
  };

  // Console.warn
  var _origConsoleWarn = console.warn;
  console.warn = function () {
    _origConsoleWarn.apply(console, arguments);
    var args = Array.prototype.slice.call(arguments);
    var message = '(warning) ' + args.map(function (a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    var stack = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) { stack = args[i].stack; break; }
    }
    window.dispatchEvent(new CustomEvent('eh-console-warn', {
      detail: makeDetail('console', { level: 'warn', message: message, stack: stack })
    }));
  };

  // Console.log, info, debug capture for log context
  function _patchConsoleLog(method, eventName, level) {
    var orig = console[method];
    console[method] = function () {
      orig.apply(console, arguments);
      var args = Array.prototype.slice.call(arguments);
      var message = args.map(function (a) {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      }).join(' ');
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: makeDetail('console', { level: level, message: message })
      }));
    };
  }
  _patchConsoleLog('log', 'eh-console-log', 'log');
  _patchConsoleLog('info', 'eh-console-info', 'info');
  _patchConsoleLog('debug', 'eh-console-debug', 'debug');

  // Window error and rejection
  window.addEventListener('error', function (e) {
    window.dispatchEvent(new CustomEvent('eh-window-error', {
      detail: makeDetail('exception', {
        message: e.message || 'Unknown error',
        stack: e.error ? e.error.stack : null,
        url: e.filename || location.href,
        line: e.lineno, column: e.colno
      })
    }));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    var message = reason && reason.message ? reason.message : String(reason);
    var stack = reason && reason.stack ? reason.stack : null;
    window.dispatchEvent(new CustomEvent('eh-unhandled-rejection', {
      detail: makeDetail('unhandledrejection', { message: message, stack: stack })
    }));
  });

  // Fetch
  var _origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = '';
    var method = 'GET';
    if (args[0] instanceof Request) { url = args[0].url; method = args[0].method || 'GET'; }
    else if (typeof args[0] === 'string') { url = args[0]; method = (args[1] && args[1].method) || 'GET'; }
    return _origFetch.apply(window, args).then(function (response) {
      if (!response.ok && response.status >= 400) {
        window.dispatchEvent(new CustomEvent('eh-network-error', {
          detail: makeDetail('network', {
            message: 'Fetch ' + method + ' ' + url + ' returned ' + response.status,
            url: url, method: method, status: response.status, statusText: response.statusText
          })
        }));
      }
      return response;
    }).catch(function (err) {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: makeDetail('network', {
          message: 'Fetch ' + method + ' ' + url + ' failed: ' + err.message,
          url: url, method: method, status: 0, statusText: 'Network Failure'
        })
      }));
      throw err;
    });
  };

  // XHR
  var _origXHROpen = XMLHttpRequest.prototype.open;
  var _origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._eh_method = method;
    this._eh_url = (typeof url === 'string') ? url : (url ? String(url) : '');
    return _origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener('loadend', function () {
      if (xhr.status >= 400) {
        window.dispatchEvent(new CustomEvent('eh-network-error', {
          detail: makeDetail('network', {
            message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' returned ' + xhr.status,
            url: xhr._eh_url, method: xhr._eh_method, status: xhr.status, statusText: xhr.statusText
          })
        }));
      }
    });
    xhr.addEventListener('error', function () {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: makeDetail('network', {
          message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' failed: Network error',
          url: xhr._eh_url, method: xhr._eh_method, status: 0, statusText: 'Network Failure'
        })
      }));
    });
    return _origXHRSend.apply(xhr, arguments);
  };
}

// Store a new error and update badge
async function handleNewError(error, sender) {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const errors = result[STORAGE_KEY] || [];

    // Enrich error with tab info if available
    if (sender && sender.tab) {
      error.tabId = sender.tab.id;
      error.tabUrl = sender.tab.url;
    }

    // Deduplicate: if same type + message + url exists, increment count
    const existing = errors.find(e =>
      e.type === error.type &&
      e.message === error.message &&
      e.url === error.url
    );
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.timestamp = error.timestamp; // update to latest occurrence
    } else {
      error.count = 1;
      errors.push(error);
    }

    await chrome.storage.session.set({ [STORAGE_KEY]: errors });
    await updateBadge(errors.length);
  } catch (err) {
    console.error('[Error Hunter] Failed to store error:', err);
  }
}

// Return all stored errors
async function handleGetErrors(sendResponse) {
  try {
    const result = await chrome.storage.session.get([STORAGE_KEY, STATUS_KEY]);
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
    sendResponse({ isMonitoring: result[STATUS_KEY] || false });
  } catch (err) {
    console.error('[Error Hunter] handleGetStatus FAILED:', err.message);
    sendResponse({ isMonitoring: false });
  }
}

// Start monitoring: inject content scripts into all tabs, set flag
async function handleStartMonitoring(sendResponse) {
  try {
    await chrome.storage.session.set({ [STATUS_KEY]: true });

    await broadcastToTabs('start');

    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleStartMonitoring FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Stop monitoring: stop capturing, keep existing errors
async function handleStopMonitoring(sendResponse) {
  try {
    await chrome.storage.session.set({ [STATUS_KEY]: false });

    await broadcastToTabs('stop');

    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleStopMonitoring FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Clear errors without stopping monitoring
async function handleClearErrors(sendResponse) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: [] });
    await chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
  } catch (err) {
    console.error('[Error Hunter] handleClearErrors FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Delete a single error by index
async function handleDeleteError(message, sendResponse) {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const errors = result[STORAGE_KEY] || [];
    if (message.index >= 0 && message.index < errors.length) {
      errors.splice(message.index, 1);
      await chrome.storage.session.set({ [STORAGE_KEY]: errors });
      await updateBadge(errors.length);
    }
    sendResponse({ success: true, errors });
  } catch (err) {
    console.error('[Error Hunter] handleDeleteError FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Broadcast an action (start/stop) to all http tabs
async function broadcastToTabs(action) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith('http')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action });
      } catch (e) {
        // Tab may not have content script, that's fine
      }
    }
  }
}

// Pick badge color based on most severe error type in storage
function getBadgeColor(errors) {
  let hasWarn = false;
  let hasNetwork = false;
  for (const e of errors) {
    if (e.type === 'exception' || e.type === 'unhandledrejection') {
      return '#dc3545'; // red — highest priority
    }
    if (e.type === 'console' && e.level === 'warn') hasWarn = true;
    if (e.type === 'network') hasNetwork = true;
  }
  if (hasWarn) return '#f0ad4e'; // orange
  if (hasNetwork) return '#3794ff'; // blue
  return '#dc3545'; // default red
}

// Update the badge with current error count and color
async function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  await chrome.action.setBadgeText({ text: text });
  if (count > 0) {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const errors = result[STORAGE_KEY] || [];
    const color = getBadgeColor(errors);
    await chrome.action.setBadgeBackgroundColor({ color: color });
  }
}

// Listen for keyboard shortcut to toggle monitoring
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-monitoring') {
    const result = await chrome.storage.session.get(STATUS_KEY);
    const isActive = result[STATUS_KEY] || false;
    if (isActive) {
      await handleStopMonitoring(() => {});
    } else {
      await handleStartMonitoring(() => {});
    }
  }
});

// Listen for tab updates to re-inject start signal if monitoring is active
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    try {
      const result = await chrome.storage.session.get(STATUS_KEY);
      if (result[STATUS_KEY]) {
        await chrome.tabs.sendMessage(tabId, { action: 'start' });
      }
    } catch (e) {
      // Tab may not be ready, ignore
    }
  }
});
