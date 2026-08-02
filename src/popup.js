// Error Hunter - Popup Logic

let errors = [];
let currentFilter = 'all';
let searchText = '';
let prevErrorCount = 0;
let lastRenderKey = '';
let expandedSet = new Set();
let sortAscending = false;
let ignoreRules = [];
let blockedCount = 0;
let currentTab = '';

// ── DOM References ──
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnClear = document.getElementById('btnClear');
const btnExport = document.getElementById('btnExport');
const btnExportJson = document.getElementById('btnExportJson');
const btnBugReport = document.getElementById('btnBugReport');
const statusIndicator = document.getElementById('statusIndicator');
const errorList = document.getElementById('errorList');
const errorCount = document.getElementById('errorCount');
const expandToggle = document.getElementById('expandToggle');
const searchInput = document.getElementById('searchInput');
const sortToggle = document.getElementById('sortToggle');
const btnFileBug = document.getElementById('btnFileBug');
const filterBtns = document.querySelectorAll('.filter-btn');
const rulesToggle = document.getElementById('rulesToggle');
const rulesPanel = document.getElementById('rulesPanel');
const rulesList = document.getElementById('rulesList');
const rulesBlocked = document.getElementById('rulesBlocked');
const rulePattern = document.getElementById('rulePattern');
const ruleMatchOn = document.getElementById('ruleMatchOn');
const btnAddRule = document.getElementById('btnAddRule');
const tabFilter = document.getElementById('tabFilter');

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  setupEventListeners();
  // Refresh errors periodically while popup is open
  setInterval(() => {
    loadState();
  }, 2000);
});

// ── Load state from service worker ──
async function loadState() {
  try {
    loadRules();
    const response = await chrome.runtime.sendMessage({ action: 'get_errors' });
    if (response) {
      errors = response.errors || [];
      // Auto-scroll to bottom if new errors arrived and user is near bottom
      if (errors.length > prevErrorCount && errors.length > 0) {
        const atBottom = errorList.scrollTop + errorList.clientHeight >= errorList.scrollHeight - 50;
        if (atBottom) {
          errorList.scrollTop = errorList.scrollHeight;
        }
      }
      prevErrorCount = errors.length;
      updateTabFilter();
      updateUI(response.isMonitoring);
    } else {
      console.warn('[Error Hunter] loadState - null/undefined response from SW');
    }
  } catch (err) {
    console.error('[Error Hunter] loadState - get_errors FAILED:', err.message);
    errorList.innerHTML = `<div class="empty-state">Cannot connect to service worker.<br>Reload the extension and try again.</div>`;
  }
}

// ── Setup Event Listeners ──
function setupEventListeners() {
  btnStart.addEventListener('click', startMonitoring);
  btnStop.addEventListener('click', stopMonitoring);
  btnClear.addEventListener('click', clearErrors);
  btnExport.addEventListener('click', () => exportReport('html'));
  btnExportJson.addEventListener('click', () => exportReport('json'));
  btnBugReport.addEventListener('click', copyBugReport);
  btnFileBug.addEventListener('click', fileBugReport);

  rulesToggle.addEventListener('click', () => {
    rulesPanel.hidden = !rulesPanel.hidden;
  });

  btnAddRule.addEventListener('click', async () => {
    const pattern = rulePattern.value.trim();
    if (await addRule(pattern, ruleMatchOn.value)) {
      rulePattern.value = '';
    }
  });

  rulesList.addEventListener('click', (e) => {
    const del = e.target.closest('.rule-delete');
    if (del) {
      e.stopPropagation();
      removeRule(del.dataset.ruleId);
    }
  });

  // Event delegation for error list
  errorList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const index = parseInt(deleteBtn.dataset.index);
      deleteError(index);
      return;
    }
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      const index = parseInt(copyBtn.dataset.index);
      copyErrorToClipboard(index, copyBtn);
      return;
    }
    const ignoreBtn = e.target.closest('.ignore-btn');
    if (ignoreBtn) {
      e.stopPropagation();
      const index = parseInt(ignoreBtn.dataset.index);
      const error = errors[index];
      if (error) addRule(error.type === 'network' ? error.url : error.message, error.type === 'network' ? 'url' : 'message');
      return;
    }
    const errorItem = e.target.closest('.error-item');
    if (errorItem) {
      const idx = parseInt(errorItem.dataset.index);
      if (expandedSet.has(idx)) expandedSet.delete(idx);
      else expandedSet.add(idx);
      errorItem.classList.toggle('expanded');
    }
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderErrors();
    });
  });

  expandToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const items = errorList.querySelectorAll('.error-item');
    const hasExpanded = Array.from(items).some(item => item.classList.contains('expanded'));
    items.forEach(item => item.classList.toggle('expanded', !hasExpanded));
    expandToggle.textContent = hasExpanded ? 'Expand all' : 'Collapse all';
  });

  sortToggle.addEventListener('click', () => {
    sortAscending = !sortAscending;
    sortToggle.textContent = sortAscending ? '↑ Oldest' : '↓ Newest';
    renderErrors();
  });

  searchInput.addEventListener('input', () => {
    searchText = searchInput.value.trim().toLowerCase();
    renderErrors();
  });

  tabFilter.addEventListener('change', () => {
    currentTab = tabFilter.value;
    renderErrors();
  });
}

// ── Start Monitoring ──
async function startMonitoring() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'start_monitoring' });
    if (response && response.success) {
      updateUI(true);
    } else {
      console.error('[Error Hunter] startMonitoring - SW returned failure:', response?.error);
    }
  } catch (err) {
    console.error('[Error Hunter] Failed to start monitoring:', err);
  }
}

// ── Stop Monitoring ──
async function stopMonitoring() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stop_monitoring' });
    if (response && response.success) {
      updateUI(false);
    }
  } catch (err) {
    console.error('[Error Hunter] Failed to stop monitoring:', err);
  }
}

// ── Clear Errors ──
async function clearErrors() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'clear_errors' });
    if (response && response.success) {
      errors = [];
      expandedSet.clear();
      renderErrors();
    }
  } catch (err) {
    console.error('[Error Hunter] Failed to clear errors:', err);
  }
}

// ── Delete Single Error ──
async function deleteError(index) {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'delete_error', index });
    if (response && response.success) {
      errors = response.errors;
      expandedSet.clear();
      renderErrors();
    }
  } catch (err) {
    console.error('[Error Hunter] Failed to delete error:', err);
  }
}

// ── Ignore Rules ──
async function loadRules() {
  try {
    const result = await chrome.storage.local.get(['eh_ignore_rules', 'eh_blocked_count']);
    ignoreRules = result.eh_ignore_rules || [];
    blockedCount = result.eh_blocked_count || 0;
    renderRules();
  } catch (err) {
    console.error('[Error Hunter] loadRules FAILED:', err.message);
  }
}

function renderRules() {
  rulesToggle.textContent = ignoreRules.length > 0
    ? `Ignore rules (${ignoreRules.length})`
    : 'Ignore rules';
  rulesBlocked.textContent = blockedCount > 0
    ? `${blockedCount} error${blockedCount !== 1 ? 's' : ''} blocked`
    : '';
  if (ignoreRules.length === 0) {
    rulesList.innerHTML = `<div class="rules-empty">No rules. Click ⛔ on an error to ignore it.</div>`;
    return;
  }
  rulesList.innerHTML = ignoreRules.map(rule => `
    <div class="rule-item">
      <span class="rule-field">[${escapeHtml(rule.matchOn)}]</span>
      <span class="rule-pattern">${escapeHtml(rule.pattern)}</span>
      <button class="rule-delete" data-rule-id="${rule.id}" title="Remove rule">✕</button>
    </div>
  `).join('');
}

async function addRule(pattern, matchOn) {
  const trimmed = (pattern || '').trim();
  if (!trimmed) {
    flashBtn(btnAddRule, 'Empty');
    return false;
  }
  try {
    const response = await chrome.runtime.sendMessage({ action: 'add_ignore_rule', pattern: trimmed, matchOn: matchOn || 'any' });
    if (response && response.success) {
      ignoreRules = response.rules;
      errors = response.errors || errors;
      expandedSet.clear();
      renderRules();
      renderErrors();
      return true;
    }
  } catch (err) {
    console.error('[Error Hunter] addRule FAILED:', err.message);
  }
  return false;
}

async function removeRule(id) {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'remove_ignore_rule', id });
    if (response && response.success) {
      ignoreRules = response.rules;
      renderRules();
    }
  } catch (err) {
    console.error('[Error Hunter] removeRule FAILED:', err.message);
  }
}

// tabId (string) -> display label, with collision disambiguation
function getTabLabels() {
  const tabs = new Map();
  for (const e of errors) {
    if (e.tabId != null && !tabs.has(String(e.tabId))) {
      tabs.set(String(e.tabId), truncateUrl(e.tabUrl || 'Tab ' + e.tabId));
    }
  }
  // Append the tab id to colliding labels so tabs stay distinguishable
  const counts = new Map();
  for (const label of tabs.values()) counts.set(label, (counts.get(label) || 0) + 1);
  for (const [id, label] of tabs) {
    if (counts.get(label) > 1) tabs.set(id, `${label} (tab ${id})`);
  }
  return tabs;
}

// Populate the per-tab filter dropdown from captured errors
function updateTabFilter() {
  const tabs = getTabLabels();
  // Preserve the current selection if that tab still has errors
  if (currentTab !== '' && !tabs.has(currentTab)) currentTab = '';
  let html = '<option value="">All tabs</option>';
  for (const [id, label] of tabs) {
    html += `<option value="${id}" ${id === currentTab ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }
  tabFilter.innerHTML = html;
  tabFilter.hidden = tabs.size < 2;
}

// Label of the currently selected tab filter, or null when "All tabs"
function getCurrentTabLabel() {
  if (currentTab === '') return null;
  return getTabLabels().get(currentTab) || null;
}

// ── Update UI State ──
function updateUI(isMonitoring) {
  if (isMonitoring) {
    btnStart.hidden = true;
    btnStop.hidden = false;
    statusIndicator.classList.add('active');
  } else {
    btnStart.hidden = false;
    btnStop.hidden = true;
    statusIndicator.classList.remove('active');
  }

  renderErrors();
}

// ── Render Error List ──
function renderErrors() {
  const filtered = getFilteredErrors();

  // Sort locally (does not affect getFilteredErrors used by exports)
  if (sortAscending) filtered.sort((a, b) => a.timestamp - b.timestamp);
  else filtered.sort((a, b) => b.timestamp - a.timestamp);

  // Build summary with breakdown
  const consoleCount = filtered.filter(e => (e.type === 'console' || e.type === 'exception' || e.type === 'unhandledrejection') && e.level !== 'warn').length;
  const warnCount = filtered.filter(e => e.level === 'warn').length;
  const networkCount = filtered.filter(e => e.type === 'network').length;
  const parts = [];
  if (consoleCount > 0) parts.push(`${consoleCount} console`);
  if (warnCount > 0) parts.push(`${warnCount} warning`);
  if (networkCount > 0) parts.push(`${networkCount} network`);
  let summaryText = `${filtered.length} error${filtered.length !== 1 ? 's' : ''}`;
  if (parts.length > 0) summaryText += ` (${parts.join(', ')})`;
  errorCount.textContent = summaryText;

  // Skip DOM rebuild if filtered list hasn't changed
  const lastTimestamp = filtered.length > 0 ? filtered[filtered.length - 1].timestamp : '';
  const key = filtered.length + ':' + consoleCount + ':' + warnCount + ':' + networkCount + ':' + lastTimestamp + ':' + sortAscending + ':' + currentTab;
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  if (filtered.length === 0) {
    errorList.innerHTML = `<div class="empty-state">No errors captured.</div>`;
    return;
  }

  // Build HTML string for performance
  let html = '';
  filtered.forEach((error) => {
    html += buildErrorItem(error);
  });

  errorList.innerHTML = html;
  const expandedItems = errorList.querySelectorAll('.error-item.expanded');
  expandToggle.textContent = expandedItems.length > 0 ? 'Collapse all' : 'Expand all';
}

// ── Filter errors based on current filter and search text ──
function getFilteredErrors() {
  return errors.filter(e => {
    // Type filter — single pass
    if (currentFilter === 'warning' && e.level !== 'warn') return false;
    if (currentFilter === 'console' && e.type !== 'console' && e.type !== 'exception' && e.type !== 'unhandledrejection') return false;
    if (currentFilter !== 'all' && currentFilter !== 'warning' && e.type !== currentFilter) return false;

    // Tab filter
    if (currentTab !== '' && String(e.tabId) !== currentTab) return false;

    // Search filter
    if (!searchText) return true;
    return (e.message && e.message.toLowerCase().includes(searchText)) ||
           (e.url && e.url.toLowerCase().includes(searchText)) ||
           (e.status != null && String(e.status).includes(searchText));
  });
}

// ── Build HTML for a single error item ──
function buildErrorItem(error) {
  const time = formatTime(error.timestamp);
  const typeClass = getTypeClass(error.type, error.level);
  const typeLabel = getTypeLabel(error.type, error.level);

  let metaHtml = '';
  let detailsHtml = '';

  // Common meta: time and URL
  metaHtml += `
    <span class="error-meta-item">
      <span class="label">at</span> ${escapeHtml(time)}
    </span>
  `;

  if (error.url) {
    const shortUrl = truncateUrl(error.url);
    metaHtml += `
      <span class="error-meta-item">
        <span class="label">source</span> ${escapeHtml(shortUrl)}
      </span>
    `;
  }

  // Network-specific meta
  if (error.type === 'network' && error.status) {
    const statusClass = getStatusClass(error.status);
    metaHtml += `
      <span class="error-meta-item">
        <span class="label">status</span>
        <span class="error-status-code ${statusClass}">${error.status}${error.statusText ? ' ' + escapeHtml(error.statusText) : ''}</span>
      </span>
    `;

    if (error.method) {
      metaHtml += `
        <span class="error-meta-item">
          <span class="label">method</span> ${escapeHtml(error.method)}
        </span>
      `;
    }

    if (error.duration != null) {
      metaHtml += `
        <span class="error-meta-item">
          <span class="label">took</span> ${error.duration}ms
        </span>
      `;
    }
  }

  // Details section (shown on expand)
  // Timestamp
  detailsHtml += `
    <div class="error-details-section">
      <div class="error-details-label">Timestamp</div>
      <div class="error-details-content">${escapeHtml(new Date(error.timestamp).toLocaleString())}</div>
    </div>
  `;

  // Page state (repro context)
  if (error.pageTitle || error.pageRoute) {
    const page = [error.pageTitle, error.pageRoute].filter(Boolean).join(' — ');
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Page</div>
        <div class="error-details-content">${escapeHtml(page)}</div>
      </div>
    `;
  }

  // Full URL
  if (error.url) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Source URL</div>
        <div class="error-details-content">${escapeHtml(error.url)}</div>
      </div>
    `;
  }

  // Stack trace for JS errors
  if ((error.type === 'console' || error.type === 'exception' || error.type === 'unhandledrejection') && error.stack) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Stack Trace</div>
        <div class="error-details-content"><pre class="error-stack">${escapeHtml(error.stack)}</pre></div>
      </div>
    `;
  }

  // User actions (before error)
  if (error.userActions && error.userActions.length > 0) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">User Actions (before error)</div>
        <div class="error-details-content">${error.userActions.map(entry => {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          const desc = entry.actionType === 'click'
            ? 'Clicked "' + (entry.text || entry.tag) + '"'
            : 'Entered "' + (entry.value || '') + '" in ' + (entry.name || entry.tag || 'input');
          return `<div class="log-entry log-entry-${entry.actionType}"><span class="log-time">${time}</span> ${escapeHtml(desc)}</div>`;
        }).join('')}</div>
      </div>
    `;
  }

  // Log context (from ring buffer)
  if (error.logContext && error.logContext.length > 0) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Log Context (last ${error.logContext.length} entries)</div>
        <div class="error-details-content">${error.logContext.map(entry => {
          const levelClass = 'log-' + entry.level;
          const time = new Date(entry.timestamp).toLocaleTimeString();
          return `<div class="log-entry log-entry-${levelClass}"><span class="log-level">[${entry.level.toUpperCase()}]</span> <span class="log-time">${time}</span> ${escapeHtml(entry.message)}</div>`;
        }).join('')}</div>
      </div>
    `;
  }

  // Network details
  if (error.type === 'network') {
    if (error.method) {
      detailsHtml += `
        <div class="error-details-section">
          <div class="error-details-label">HTTP Method</div>
          <div class="error-details-content">${escapeHtml(error.method)}</div>
        </div>
      `;
    }
    if (error.status) {
      detailsHtml += `
        <div class="error-details-section">
          <div class="error-details-label">HTTP Status</div>
          <div class="error-details-content">${error.status} ${escapeHtml(error.statusText || '')}</div>
        </div>
      `;
    }
    if (error.duration != null) {
      detailsHtml += `
        <div class="error-details-section">
          <div class="error-details-label">Duration</div>
          <div class="error-details-content">${error.duration}ms</div>
        </div>
      `;
    }
    if (error.requestBody) {
      detailsHtml += `
        <div class="error-details-section">
          <div class="error-details-label">Request Body</div>
          <div class="error-details-content"><pre class="error-stack">${escapeHtml(error.requestBody)}</pre></div>
        </div>
      `;
    }
    if (error.responseText) {
      detailsHtml += `
        <div class="error-details-section">
          <div class="error-details-label">Response</div>
          <div class="error-details-content"><pre class="error-stack">${escapeHtml(error.responseText)}</pre></div>
        </div>
      `;
    }
  }

  // Count badge for deduplicated errors
  let countBadge = '';
  if (error.count && error.count > 1) {
    countBadge = ` <span class="count-badge" title="${error.count} occurrences">[×${error.count}]</span>`;
  }

  // Occurrences in details
  if (error.count && error.count > 1) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Occurrences</div>
        <div class="error-details-content">${error.count}</div>
      </div>
    `;
  }

  const origIndex = errors.indexOf(error);
  const expanded = expandedSet.has(origIndex) ? ' expanded' : '';

  return `
    <div class="error-item${expanded}" data-index="${origIndex}">
      <div class="error-header">
        <span class="error-type-badge ${typeClass}">${typeLabel}</span>
        <div class="error-main">
          <div class="error-message">${escapeHtml(error.message)}${countBadge}</div>
          <div class="error-meta">${metaHtml}</div>
        </div>
        <button class="delete-btn" data-index="${errors.indexOf(error)}" title="Delete error">✕</button>
        <button class="ignore-btn" data-index="${origIndex}" title="Ignore errors like this">⛔</button>
        <button class="copy-btn" data-index="${origIndex}" title="Copy error details">📋</button>
      </div>
      <div class="error-details">${detailsHtml}</div>
    </div>
  `;
}

// ── Copy Error to Clipboard ──
async function copyErrorToClipboard(index, btn) {
  const error = errors[index];
  if (!error) return;

  const text = formatErrorForClipboard(error);
  try {
    await navigator.clipboard.writeText(text);
    flashBtn(btn, '✓', 1500);
  } catch {
    flashBtn(btn, '✗', 1500);
  }
}

function formatErrorForClipboard(error) {
  const typeLabel = getTypeLabel(error.type, error.level, true);
  const lines = [
    `Error Type: ${typeLabel}`,
    `Message: ${error.message}`,
    `Time: ${new Date(error.timestamp).toLocaleString()}`,
  ];
  if (error.count && error.count > 1) lines.push(`Occurrences: ${error.count}`);
  if (error.url) lines.push(`URL: ${error.url}`);
  if ((error.type === 'console' || error.type === 'exception' || error.type === 'unhandledrejection') && error.stack) lines.push(`Stack Trace:\n${error.stack}`);
  if (error.type === 'network') {
    if (error.method) lines.push(`Method: ${error.method}`);
    if (error.status) lines.push(`Status: ${error.status} ${error.statusText || ''}`);
    if (error.duration != null) lines.push(`Duration: ${error.duration}ms`);
    if (error.requestBody) lines.push(`Request Body:\n${error.requestBody}`);
    if (error.responseText) lines.push(`Response:\n${error.responseText}`);
  }
  return lines.join('\n');
}

// ── Export Report (html or json) ──
function exportReport(format) {
  const filtered = getFilteredErrors();
  if (filtered.length === 0) {
    const btn = format === 'json' ? btnExportJson : btnExport;
    flashBtn(btn, 'No errors');
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 19).replace(/[:-]/g, '');
  const tabLabel = getCurrentTabLabel();

  let content, filename, mimeType;

  if (format === 'json') {
    content = JSON.stringify({ tab: tabLabel || null, errors: filtered }, null, 2);
    filename = `error-hunter-report-${dateStr}.json`;
    mimeType = 'application/json';
  } else {
    const timestamp = now.toLocaleString();
    const consoleCount = filtered.filter(e => e.type === 'console' || e.type === 'exception' || e.type === 'unhandledrejection').length;
    const networkCount = filtered.filter(e => e.type === 'network').length;

    let rowsHtml = '';
    filtered.forEach((error, i) => {
      const typeLabel = getTypeLabel(error.type, error.level);
      const time = new Date(error.timestamp).toLocaleString();
      rowsHtml += `<tr>
        <td>${i + 1}</td>
        <td><span class="tag tag-${error.type}">${typeLabel}</span></td>
        <td>${escapeHtml(error.message)}</td>
        <td>${escapeHtml(error.url || '-')}</td>
        <td>${error.type === 'network' && error.status ? error.status : '-'}</td>
        <td>${time}</td>
      </tr>`;
    });

    content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Error Hunter Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1e1e1e; color: #cccccc; padding: 24px; }
  h1 { color: #ffffff; font-size: 22px; margin-bottom: 4px; }
  .meta { color: #999; font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; }
  .summary-card { background: #252526; border: 1px solid #3c3c3c; border-radius: 6px; padding: 12px 20px; }
  .summary-card .num { font-size: 28px; font-weight: 700; }
  .summary-card .label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-card.total .num { color: #3794ff; }
  .summary-card.console .num { color: #3794ff; }
  .summary-card.network .num { color: #f0ad4e; }
  table { width: 100%; border-collapse: collapse; background: #252526; border: 1px solid #3c3c3c; border-radius: 6px; overflow: hidden; }
  th { background: #2d2d2d; color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; }
  td { padding: 10px 12px; border-bottom: 1px solid #3c3c3c; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .tag-console { background: rgba(55,148,255,0.15); color: #3794ff; }
  .tag-network { background: rgba(240,173,78,0.15); color: #f0ad4e; }
</style>
</head>
<body>
  <h1>Error Hunter Report</h1>
  <p class="meta">Generated: ${escapeHtml(timestamp)}${tabLabel ? `<br>Tab: ${escapeHtml(tabLabel)}` : ''}</p>
  <div class="summary">
    <div class="summary-card total"><div class="num">${filtered.length}</div><div class="label">Total Errors</div></div>
    <div class="summary-card console"><div class="num">${consoleCount}</div><div class="label">Console Errors</div></div>
    <div class="summary-card network"><div class="num">${networkCount}</div><div class="label">Network Errors</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Type</th><th>Message</th><th>URL</th><th>Status</th><th>Time</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
    filename = `error-hunter-report-${dateStr}.html`;
    mimeType = 'text/html';
  }

  downloadBlob(content, filename, mimeType);
}

// ── Bug Report ──
async function copyBugReport() {
  const filtered = getFilteredErrors();
  if (filtered.length === 0) {
    flashBtn(btnBugReport, 'No errors');
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tabs[0]?.url || '';
  const text = generateBugReport(filtered, pageUrl);
  try {
    await navigator.clipboard.writeText(text);
    flashBtn(btnBugReport, 'Copied!');
  } catch {
    flashBtn(btnBugReport, 'Failed');
  }
}

async function fileBugReport() {
  const filtered = getFilteredErrors();
  if (filtered.length === 0) {
    flashBtn(btnFileBug, 'No errors');
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tabs[0]?.url || '';

  // Auto-generate summary from the most severe error
  const primary = filtered.find(e => e.type === 'exception' || e.type === 'unhandledrejection') ||
                  filtered.find(e => e.type === 'network') ||
                  filtered[0];
  let summary = primary.message;
  if (summary.length > 80) summary = summary.substring(0, 77) + '...';

  const now = new Date().toLocaleString();
  const lines = [];
  lines.push('# Bug Report: ' + summary);
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('- **Page URL:** ' + (pageUrl || filtered[0]?.url || 'N/A'));
  lines.push('- **Reported:** ' + now);
  lines.push('- **Total Errors:** ' + filtered.length);
  lines.push('');
  lines.push('## Steps to Reproduce');
  lines.push('1. Go to ' + truncateUrl(pageUrl || filtered[0]?.url || ''));
  lines.push('2. ');
  lines.push('3. ');
  lines.push('');
  lines.push('## Expected Behavior');
  lines.push('');
  lines.push('');
  lines.push('## Actual Behavior');
  lines.push('');
  lines.push('While performing the steps above, the following error' + (filtered.length > 1 ? 's were' : ' was') + ' captured:');
  filtered.forEach(function (e) {
    var label = getTypeLabel(e.type, e.level, true);
    var msg = e.message || '(empty)';
    lines.push('- **' + label + ':** ' + msg);
  });
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  filtered.forEach(function (e, i) {
    var label = getTypeLabel(e.type, e.level, true);
    lines.push('### ' + (i + 1) + '. ' + label);
    lines.push('');
    lines.push('- **Message:** ' + (e.message || '(empty)'));
    if (e.count && e.count > 1) lines.push('- **Occurrences:** ' + e.count);
    if (e.url) lines.push('- **Source:** ' + e.url);
    lines.push('- **Time:** ' + new Date(e.timestamp).toLocaleString());
    if (e.type === 'network') {
      if (e.method) lines.push('- **Method:** ' + e.method);
      if (e.status) lines.push('- **Status:** ' + e.status + ' ' + (e.statusText || ''));
      if (e.duration != null) lines.push('- **Duration:** ' + e.duration + 'ms');
      if (e.requestBody) lines.push('- **Request body:**');
      if (e.requestBody) lines.push('  ```');
      if (e.requestBody) lines.push('  ' + e.requestBody);
      if (e.requestBody) lines.push('  ```');
      if (e.responseText) lines.push('- **Response:**');
      if (e.responseText) lines.push('  ```');
      if (e.responseText) lines.push('  ' + e.responseText);
      if (e.responseText) lines.push('  ```');
    }
    if (e.stack) {
      lines.push('- **Stack:**');
      lines.push('  ```');
      lines.push('  ' + e.stack.split('\n').join('\n  '));
      lines.push('  ```');
    }
    if (e.userActions && e.userActions.length > 0) {
      lines.push('- **User actions before error:**');
      e.userActions.forEach(function (entry) {
        var time = new Date(entry.timestamp).toLocaleTimeString();
        var desc = entry.actionType === 'click'
          ? 'Clicked "' + (entry.text || entry.tag) + '"'
          : 'Entered "' + (entry.value || '') + '" in "' + (entry.name || entry.tag || 'input') + '"';
        lines.push('  - ' + time + ' - ' + desc);
      });
    }
    if (e.logContext && e.logContext.length > 0) {
      lines.push('- **Log context (before error):**');
      e.logContext.forEach(function (entry) {
        var time = new Date(entry.timestamp).toLocaleTimeString();
        lines.push('  - `[' + entry.level.toUpperCase() + '][' + time + ']` ' + entry.message);
      });
    }
    lines.push('');
  });

  if (filtered.some(function (e) { return e.logContext && e.logContext.length > 0; })) {
    lines.push('> **Note:** The "Log context" entries above show what the application logged in the console just before each error. Use these as hints to reconstruct the steps.');
    lines.push('');
  }

  var markdown = lines.join('\n');

  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>Bug Report</title>\n<style>\n'
    + '  *{margin:0;padding:0;box-sizing:border-box}'
    + '  body{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;background:#1e1e1e;color:#ccc;padding:24px}'
    + '  h1{color:#fff;margin-bottom:16px;font-size:20px}'
    + '  .bar{display:flex;gap:8px;margin-bottom:12px}'
    + '  .btn{padding:8px 20px;border:1px solid #3c3c3c;border-radius:4px;font-size:13px;cursor:pointer;background:#2d2d2d;color:#ccc;font-family:inherit}'
    + '  .btn:hover{background:#333}'
    + '  .btn-copy{border-color:#3794ff;color:#3794ff}'
    + '  .btn-copy:hover{background:rgba(55,148,255,0.15)}'
    + '  textarea{width:100%;height:calc(100vh - 100px);background:#252526;color:#ccc;border:1px solid #3c3c3c;border-radius:6px;padding:16px;font-family:\'Consolas\',monospace;font-size:13px;line-height:1.5;resize:vertical;outline:none}'
    + '  textarea:focus{border-color:#3794ff}'
    + '</style>\n</head>\n<body>\n<h1>Bug Report</h1>\n<div class="bar">\n'
    + '<button class="btn btn-copy" onclick="copyReport()">Copy to Clipboard</button>\n</div>\n'
    + '<textarea id="r" spellcheck="false">' + escapeHtml(markdown) + '</textarea>\n'
    + '<script>\nfunction copyReport(){\n'
    + '  var t=document.getElementById(\'r\');\n'
    + '  t.select();\n'
    + '  navigator.clipboard.writeText(t.value).then(function(){\n'
    + '    var b=document.querySelector(\'.btn-copy\');\n'
    + '    b.textContent=\'Copied!\';\n'
    + '    setTimeout(function(){b.textContent=\'Copy to Clipboard\';},2000);\n'
    + '  });\n'
    + '}\n<\/script>\n</body>\n</html>';

  const blob = new Blob([html], { type: 'text/html' });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

function generateBugReport(errors, pageUrl, typeLabelFn, getTabLabel) {
  const now = new Date();
  const lines = [];
  lines.push('# Error Hunter Bug Report');
  lines.push('');
  lines.push('**Page URL:** ' + (pageUrl || errors[0]?.url || 'N/A') + '  ');
  const tabLabel = (getTabLabel || getCurrentTabLabel)();
  if (tabLabel) lines.push('**Tab:** ' + tabLabel + '  ');
  lines.push('**Reported:** ' + now.toLocaleString() + '  ');
  lines.push('**Total Errors:** ' + errors.length);
  lines.push('');

  lines.push('## Errors');
  lines.push('');

  const labelFn = typeLabelFn || getTypeLabel;
  errors.forEach((error, i) => {
    const typeLabel = labelFn(error.type, error.level, true);
    lines.push('### ' + (i + 1) + '. ' + typeLabel);
    lines.push('');
    lines.push('- **Message:** ' + (error.message || '(empty)'));
    if (error.url) lines.push('- **Source:** ' + error.url);
    lines.push('- **Time:** ' + new Date(error.timestamp).toLocaleString());
    if (error.pageTitle || error.pageRoute) lines.push('- **Page:** ' + [error.pageTitle, error.pageRoute].filter(Boolean).join(' — '));
    if (error.count && error.count > 1) lines.push('- **Occurrences:** ' + error.count);

    if (error.type === 'network') {
      if (error.status) lines.push('- **Status:** ' + error.status + ' ' + (error.statusText || ''));
      if (error.method) lines.push('- **Method:** ' + error.method);
      if (error.duration != null) lines.push('- **Duration:** ' + error.duration + 'ms');
      if (error.requestBody) lines.push('- **Request body:**\n  ```\n  ' + error.requestBody + '\n  ```');
      if (error.responseText) lines.push('- **Response:**\n  ```\n  ' + error.responseText + '\n  ```');
    }

    if (error.stack) {
      lines.push('- **Stack:**');
      lines.push('  ```');
      lines.push('  ' + error.stack.split('\n').join('\n  '));
      lines.push('  ```');
    }

    lines.push('');
  });

  return lines.join('\n');
}

function flashBtn(btn, msg, restoreMs) {
  var orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(function () { btn.textContent = orig; }, restoreMs || 2000);
}

// ── Utilities ──
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;

  // If within the last minute, show relative
  if (diffMs < 60000) {
    return 'just now';
  }

  // If within the last hour, show minutes ago
  if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000);
    return `${mins}m ago`;
  }

  // Otherwise show time
  return date.toLocaleTimeString();
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 50) {
      path = path.substring(0, 47) + '...';
    }
    return u.hostname + path;
  } catch {
    return url.length > 50 ? url.substring(0, 47) + '...' : url;
  }
}

function getStatusClass(status) {
  if (status === 0) return 'error-0';
  if (status >= 500) return 'error-5xx';
  if (status >= 400) return 'error-4xx';
  return '';
}

function getTypeLabel(type, level, verbose) {
  if (!verbose && level === 'warn') return 'Warning';
  if (verbose) {
    switch (type) {
      case 'console': return 'JS Error (console)';
      case 'exception': return 'Exception';
      case 'unhandledrejection': return 'Unhandled Rejection';
      default: return 'HTTP Error (network)';
    }
  }
  switch (type) {
    case 'exception': return 'Exception';
    case 'unhandledrejection': return 'Rejection';
    case 'network': return 'HTTP Error';
    default: return 'JS Error';
  }
}

function getTypeClass(type, level) {
  if (level === 'warn') return 'warning';
  switch (type) {
    case 'exception':
    case 'unhandledrejection':
    case 'console':
      return 'console';
    case 'network': return 'network';
    default: return 'console';
  }
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
