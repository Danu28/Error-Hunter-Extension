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

    case 'inject_page_world':
      handleInjectPageWorld(sender, sendResponse);
      return true;

    case 'clear_errors':
      handleClearErrors(sendResponse);
      return true;

    case 'delete_error':
      handleDeleteError(message, sendResponse);
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

    // Enrich error with tab info if available
    if (sender && sender.tab) {
      error.tabId = sender.tab.id;
      error.tabUrl = sender.tab.url;
    }

    errors.push(error);
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

    // Broadcast start to all tabs with content scripts
    const tabs = await chrome.tabs.query({});
    let sentCount = 0;
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('http')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'start' });
          sentCount++;
        } catch (e) {
          // Tab not ready, skip
        }
      }
    }

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

    // Broadcast stop to all tabs
    const tabs = await chrome.tabs.query({});
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

// ── Inject page-world error capture via scripting API ──
// This bypasses CSP because the injection happens at the extension level,
// not through DOM <script> element insertion.
async function handleInjectPageWorld(sender, sendResponse) {
  try {
    if (!sender.tab) {
      sendResponse({ success: false, error: 'no tab' });
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: injectPageWorldErrorCapture,
    });
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

  var _origConsoleWarn = console.warn;

  console.warn = function() {
    _origConsoleWarn.apply(console, arguments);

    var args = Array.prototype.slice.call(arguments);
    var message = '(warning) ' + args.map(function(a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch(e) { return String(a); } }
      return String(a);
    }).join(' ');

    var stack = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) { stack = args[i].stack; break; }
    }

    window.dispatchEvent(new CustomEvent('eh-console-warn', {
      detail: { type: 'console', level: 'warn', message: message, stack: stack, url: location.href, timestamp: Date.now() }
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

    var startTime = Date.now();
    var requestBody = (args[1] && args[1].body) || '';

    return _origFetch.apply(window, args).then(function(response) {
      if (!response.ok && response.status >= 400) {
        var respBodyPromise;
        try {
          respBodyPromise = response.clone().text();
        } catch (e) {
          respBodyPromise = Promise.resolve('');
        }
        respBodyPromise.then(function(text) {
          var preview = text ? text.substring(0, 500) : '';
          window.dispatchEvent(new CustomEvent('eh-network-error', {
            detail: {
              type: 'network',
              message: 'Fetch ' + method + ' ' + url + ' returned ' + response.status + ' ' + response.statusText,
              url: url, method: method, status: response.status, statusText: response.statusText,
              timestamp: Date.now(),
              requestBody: requestBody,
              responseBody: preview,
              duration: Date.now() - startTime
            }
          }));
        });
      }
      return response;
    }).catch(function(err) {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: {
          type: 'network',
          message: 'Fetch ' + method + ' ' + url + ' failed: ' + err.message,
          url: url, method: method, status: 0, statusText: 'Network Failure',
          timestamp: Date.now(),
          requestBody: requestBody,
          responseBody: err.message,
          duration: Date.now() - startTime
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
    var startTime = Date.now();
    var requestBody = arguments.length > 0 ? String(arguments[0]) : '';
    xhr.addEventListener('loadend', function() {
      if (xhr.status >= 400) {
        var bodyText = xhr.responseText || '';
        var preview = bodyText.substring(0, 500);
        window.dispatchEvent(new CustomEvent('eh-network-error', {
          detail: {
            type: 'network',
            message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' returned ' + xhr.status + ' ' + xhr.statusText,
            url: xhr._eh_url, method: xhr._eh_method,
            status: xhr.status, statusText: xhr.statusText,
            timestamp: Date.now(),
            requestBody: requestBody,
            responseBody: preview,
            duration: Date.now() - startTime
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
          timestamp: Date.now(),
          requestBody: requestBody,
          responseBody: '',
          duration: Date.now() - startTime
        }
      }));
    });
    return _origXHRSend.apply(xhr, arguments);
  };
}

// Update the badge with current error count
async function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
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
        await chrome.tabs.sendMessage(tabId, { action: 'start' });
      }
    } catch (e) {
      // Tab may not be ready, ignore
    }
  }
});
