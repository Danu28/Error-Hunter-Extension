// Error Hunter - Service Worker
// Background script managing badge, error storage, and messaging

const STORAGE_KEY = 'error_hunter_errors';
const STATUS_KEY = 'error_hunter_active';
const IGNORE_RULES_KEY = 'eh_ignore_rules';
const BLOCKED_COUNT_KEY = 'eh_blocked_count';

// Max stored errors; oldest are dropped beyond this to stay under storage.session quota
const MAX_ERRORS = 500;

// Serialize storage read-modify-write: concurrent new_error/clear/delete bursts
// would otherwise race on STORAGE_KEY (each reads the same snapshot) and lose
// updates. All mutation handlers run exclusively through this mutex.
let storageMutex = Promise.resolve();
function runExclusive(fn) {
  const run = storageMutex.then(fn, fn);
  storageMutex = run.then(() => {}, () => {});
  return run;
}

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.set({ [STATUS_KEY]: false });
  chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'new_error':
      runExclusive(() => handleNewError(message.error, sender)).then(() => {
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
      runExclusive(() => handleClearErrors(sendResponse));
      return true;

    case 'inject_page_world':
      handleInjectPageWorld(sender, sendResponse);
      return true;

    case 'delete_error':
      runExclusive(() => handleDeleteError(message, sendResponse));
      return true;

    case 'add_ignore_rule':
      handleAddIgnoreRule(message, sendResponse);
      return true;

    case 'remove_ignore_rule':
      handleRemoveIgnoreRule(message, sendResponse);
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

  // Console method patching — unified
  function _patchConsole(method, eventName, extra) {
    var orig = console[method];
    console[method] = function () {
      orig.apply(console, arguments);
      var args = Array.prototype.slice.call(arguments);
      var message = args.map(function (a) {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      }).join(' ');
      if (extra.level === 'warn') message = '(warning) ' + message;
      var detail = { message: message };
      if (extra.level) detail.level = extra.level;
      var stack = null;
      for (var i = 0; i < args.length; i++) {
        if (args[i] instanceof Error) { stack = args[i].stack; break; }
      }
      if (stack) detail.stack = stack;
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: makeDetail('console', detail)
      }));
    };
  }
  _patchConsole('error', 'eh-console-error', {});
  _patchConsole('warn', 'eh-console-warn', { level: 'warn' });
  _patchConsole('log', 'eh-console-log', { level: 'log' });
  _patchConsole('info', 'eh-console-info', { level: 'info' });
  _patchConsole('debug', 'eh-console-debug', { level: 'debug' });

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

  function _ehTruncate(str, max) {
    if (typeof str !== 'string') return '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  function _ehBodyToString(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof Blob) return '';
    if (body instanceof FormData) return '';
    if (body instanceof ArrayBuffer) return '';
    if (typeof body === 'object' && typeof body.byteLength === 'number') return '';
    try { return JSON.stringify(body); } catch (e) { return ''; }
  }

  // Fetch
  var _origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = '';
    var method = 'GET';
    var body = '';
    if (args[0] instanceof Request) { url = args[0].url; method = args[0].method || 'GET'; body = _ehBodyToString(args[0].body); }
    else if (typeof args[0] === 'string') { url = args[0]; method = (args[1] && args[1].method) || 'GET'; body = args[1] ? _ehBodyToString(args[1].body) : ''; }
    var startTime = Date.now();
    return _origFetch.apply(window, args).then(function (response) {
      if (!response.ok && response.status >= 400) {
        var detail = makeDetail('network', {
          message: 'Fetch ' + method + ' ' + url + ' returned ' + response.status,
          url: url, method: method, status: response.status, statusText: response.statusText,
          duration: Date.now() - startTime, requestBody: _ehTruncate(body, 500)
        });
        try {
          response.clone().text().then(function (text) {
            detail.responseText = _ehTruncate(text, 2000);
            window.dispatchEvent(new CustomEvent('eh-network-error', { detail: detail }));
          }).catch(function () {
            window.dispatchEvent(new CustomEvent('eh-network-error', { detail: detail }));
          });
        } catch (e) {
          window.dispatchEvent(new CustomEvent('eh-network-error', { detail: detail }));
        }
      }
      return response;
    }).catch(function (err) {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: makeDetail('network', {
          message: 'Fetch ' + method + ' ' + url + ' failed: ' + err.message,
          url: url, method: method, status: 0, statusText: 'Network Failure',
          duration: Date.now() - startTime, requestBody: _ehTruncate(body, 500)
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
    this._eh_start = Date.now();
    return _origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr._eh_body = _ehBodyToString(arguments[0]);
    xhr.addEventListener('loadend', function () {
      if (xhr.status >= 400) {
        var detail = makeDetail('network', {
          message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' returned ' + xhr.status,
          url: xhr._eh_url, method: xhr._eh_method, status: xhr.status, statusText: xhr.statusText,
          duration: Date.now() - xhr._eh_start, requestBody: _ehTruncate(xhr._eh_body, 500)
        });
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          detail.responseText = _ehTruncate(xhr.responseText, 2000);
        }
        window.dispatchEvent(new CustomEvent('eh-network-error', { detail: detail }));
      }
    });
    xhr.addEventListener('error', function () {
      window.dispatchEvent(new CustomEvent('eh-network-error', {
        detail: makeDetail('network', {
          message: 'XHR ' + xhr._eh_method + ' ' + xhr._eh_url + ' failed: Network error',
          url: xhr._eh_url, method: xhr._eh_method, status: 0, statusText: 'Network Failure',
          duration: Date.now() - xhr._eh_start, requestBody: _ehTruncate(xhr._eh_body, 500)
        })
      }));
    });
    return _origXHRSend.apply(xhr, arguments);
  };

  // Resource-load failures (broken <img>, <script>, CSS, iframe, video, etc.)
  // via Resource Timing — the only reliable way to see them. Excludes fetch/XHR
  // (already instrumented above) to avoid double capture. buffered:true replays
  // assets that failed before the extension started monitoring.
  if ('PerformanceObserver' in window) {
    var _ehResourceObserver = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.responseStatus >= 400 && e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') {
          window.dispatchEvent(new CustomEvent('eh-network-error', {
            detail: makeDetail('network', {
              message: 'Resource ' + e.initiatorType + ' ' + e.name + ' returned ' + e.responseStatus,
              url: e.name, status: e.responseStatus, duration: Math.round(e.duration)
            })
          }));
        }
      }
    });
    _ehResourceObserver.observe({ type: 'resource', buffered: true });
  }

  // User action capture for bug report steps
  document.addEventListener('click', function (e) {
    var t = e.target;
    var tag = t.tagName || '';
    var actionable = tag === 'BUTTON' || tag === 'A' ||
      (tag === 'INPUT' && /submit|button|checkbox|radio|text|email|password|search|number|url|tel/.test(t.type)) ||
      tag === 'SELECT' || tag === 'TEXTAREA' ||
      t.getAttribute('role') === 'button' ||
      t.getAttribute('role') === 'tab' ||
      t.getAttribute('role') === 'menuitem';
    if (!actionable) return;
    var text = (t.textContent || t.value || t.title || t.alt || '').trim().substring(0, 80);
    window.dispatchEvent(new CustomEvent('eh-user-action', {
      detail: { actionType: 'click', tag: tag, text: text, id: t.id || '', name: t.name || '' }
    }));
  }, true);

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT')) return;
    var val = t.value ? t.value.toString().substring(0, 100) : '';
    window.dispatchEvent(new CustomEvent('eh-user-action', {
      detail: { actionType: 'input', tag: t.tagName, name: t.name || t.id || '', value: val, id: t.id || '' }
    }));
  }, true);
}

// Check if an error matches a single ignore rule
function matchesRule(error, rule) {
  const msg = (error.message || '').toLowerCase();
  const url = (error.url || '').toLowerCase();
  const pattern = (rule.pattern || '').toLowerCase();
  if (!pattern) return false;
  if (rule.matchOn === 'url') return url.includes(pattern);
  if (rule.matchOn === 'message') return msg.includes(pattern);
  return msg.includes(pattern) || url.includes(pattern);
}

// Check if an error matches any user-configured ignore rule
async function isIgnoredError(error) {
  try {
    const result = await chrome.storage.local.get(IGNORE_RULES_KEY);
    const rules = result[IGNORE_RULES_KEY] || [];
    return rules.some(rule => matchesRule(error, rule));
  } catch (err) {
    console.error('[Error Hunter] isIgnoredError FAILED:', err.message);
    return false;
  }
}

// Store a new error and update badge
async function handleNewError(error, sender) {
  try {
    if (await isIgnoredError(error)) {
      const result = await chrome.storage.local.get(BLOCKED_COUNT_KEY);
      await chrome.storage.local.set({ [BLOCKED_COUNT_KEY]: (result[BLOCKED_COUNT_KEY] || 0) + 1 });
      return;
    }

    const result = await chrome.storage.session.get(STORAGE_KEY);
    const errors = result[STORAGE_KEY] || [];

    // Enrich error with tab info if available
    if (sender && sender.tab) {
      error.tabId = sender.tab.id;
      error.tabUrl = sender.tab.url;
    }

    // Deduplicate: if same type + message + url + tab exists, increment count
    const existing = errors.find(e =>
      e.type === error.type &&
      e.message === error.message &&
      e.url === error.url &&
      e.tabId === error.tabId
    );
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.timestamp = error.timestamp; // update to latest occurrence
      if (error.pageTitle !== undefined) existing.pageTitle = error.pageTitle;
      if (error.pageRoute !== undefined) existing.pageRoute = error.pageRoute;
    } else {
      error.count = 1;
      errors.push(error);
    }

    // Cap: drop oldest beyond MAX_ERRORS
    if (errors.length > MAX_ERRORS) {
      errors.splice(0, errors.length - MAX_ERRORS);
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

    // Tabs without a live content script (opened before extension load/reload)
    // didn't receive 'start'; inject the content script directly so it auto-starts
    // via init() without reloading the page. Reload only if injection fails.
    const failed = await broadcastToTabs('start');
    for (const tabId of failed) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['src/content.js']
        });
      } catch (err) {
        console.error('[Error Hunter] inject content script into tab', tabId, 'FAILED:', err.message);
        try {
          await chrome.tabs.reload(tabId);
        } catch (reloadErr) {
          console.error('[Error Hunter] reload tab', tabId, 'FAILED:', reloadErr.message);
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

// Add an ignore rule and purge any existing errors it now blocks
async function handleAddIgnoreRule(message, sendResponse) {
  try {
    const pattern = (message.pattern || '').trim();
    if (!pattern) { sendResponse({ success: false }); return; }
    const rule = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      pattern,
      matchOn: message.matchOn || 'any'
    };
    const result = await chrome.storage.local.get(IGNORE_RULES_KEY);
    const rules = result[IGNORE_RULES_KEY] || [];
    rules.push(rule);
    await chrome.storage.local.set({ [IGNORE_RULES_KEY]: rules });

    const sResult = await chrome.storage.session.get(STORAGE_KEY);
    const errors = (sResult[STORAGE_KEY] || []).filter(e => !matchesRule(e, rule));
    await chrome.storage.session.set({ [STORAGE_KEY]: errors });
    await updateBadge(errors.length);

    sendResponse({ success: true, rules, errors });
  } catch (err) {
    console.error('[Error Hunter] handleAddIgnoreRule FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Remove an ignore rule (existing errors stay; future captures unblocked)
async function handleRemoveIgnoreRule(message, sendResponse) {
  try {
    const result = await chrome.storage.local.get(IGNORE_RULES_KEY);
    const rules = (result[IGNORE_RULES_KEY] || []).filter(r => r.id !== message.id);
    await chrome.storage.local.set({ [IGNORE_RULES_KEY]: rules });
    sendResponse({ success: true, rules });
  } catch (err) {
    console.error('[Error Hunter] handleRemoveIgnoreRule FAILED:', err.message);
    sendResponse({ success: false, error: err.message });
  }
}

// Broadcast an action (start/stop) to all http tabs.
// Returns the ids of tabs that have no live content script (sendMessage failed).
async function broadcastToTabs(action) {
  const failed = [];
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith('http')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action });
      } catch (e) {
        failed.push(tab.id);
      }
    }
  }
  return failed;
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
