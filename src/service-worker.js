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
