// Error Hunter - Popup Logic

let errors = [];
let currentFilter = 'all';
let searchText = '';
let prevErrorCount = 0;

// ── DOM References ──
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnClear = document.getElementById('btnClear');
const btnExport = document.getElementById('btnExport');
const btnExportJson = document.getElementById('btnExportJson');
const btnCopySelected = document.getElementById('btnCopySelected');
const statusIndicator = document.getElementById('statusIndicator');
const errorList = document.getElementById('errorList');
const errorCount = document.getElementById('errorCount');
const expandToggle = document.getElementById('expandToggle');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');

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
  btnExport.addEventListener('click', exportReport);
  btnExportJson.addEventListener('click', exportReportJson);

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
    // Don't toggle expand when clicking checkbox
    if (e.target.closest('.error-checkbox')) {
      updateCopySelectedButton();
      return;
    }
    const errorItem = e.target.closest('.error-item');
    if (errorItem) {
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

  searchInput.addEventListener('input', () => {
    searchText = searchInput.value.trim().toLowerCase();
    renderErrors();
  });

  btnCopySelected.addEventListener('click', copySelectedErrors);
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
      errors = [];
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
      renderErrors();
    }
  } catch (err) {
    console.error('[Error Hunter] Failed to delete error:', err);
  }
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

  // Build summary with breakdown
  const consoleCount = filtered.filter(e => e.type === 'console' && e.level !== 'warn').length;
  const warnCount = filtered.filter(e => e.level === 'warn').length;
  const networkCount = filtered.filter(e => e.type === 'network').length;
  const parts = [];
  if (consoleCount > 0) parts.push(`${consoleCount} console`);
  if (warnCount > 0) parts.push(`${warnCount} warning`);
  if (networkCount > 0) parts.push(`${networkCount} network`);
  let summaryText = `${filtered.length} error${filtered.length !== 1 ? 's' : ''}`;
  if (parts.length > 0) summaryText += ` (${parts.join(', ')})`;
  errorCount.textContent = summaryText;

  if (filtered.length === 0) {
    errorList.innerHTML = `<div class="empty-state">No errors captured.</div>`;
    return;
  }

  // Build HTML string for performance
  let html = '';
  filtered.forEach((error, index) => {
    html += buildErrorItem(error, index);
  });

  errorList.innerHTML = html;
  // Reset expand toggle — all items start collapsed after re-render
  expandToggle.textContent = 'Expand all';
}

// ── Filter errors based on current filter and search text ──
function getFilteredErrors() {
  let filtered = errors;
  if (currentFilter === 'warning') filtered = filtered.filter(e => e.level === 'warn');
  else if (currentFilter === 'console') filtered = filtered.filter(e => e.type === 'console' && e.level !== 'warn');
  else if (currentFilter !== 'all') filtered = filtered.filter(e => e.type === currentFilter);

  if (searchText) {
    filtered = filtered.filter(e =>
      (e.message && e.message.toLowerCase().includes(searchText)) ||
      (e.url && e.url.toLowerCase().includes(searchText)) ||
      (e.status != null && String(e.status).includes(searchText))
    );
  }

  return filtered;
}

// ── Build HTML for a single error item ──
function buildErrorItem(error, index) {
  const time = formatTime(error.timestamp);
  let typeClass, typeLabel;
  if (error.level === 'warn') {
    typeClass = 'warning';
    typeLabel = 'Warning';
  } else {
    typeClass = error.type === 'console' ? 'console' : 'network';
    typeLabel = error.type === 'console' ? 'JS Error' : 'HTTP Error';
  }

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
  }

  // Details section (shown on expand)
  // Timestamp
  detailsHtml += `
    <div class="error-details-section">
      <div class="error-details-label">Timestamp</div>
      <div class="error-details-content">${escapeHtml(new Date(error.timestamp).toLocaleString())}</div>
    </div>
  `;

  // Full URL
  if (error.url) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Source URL</div>
        <div class="error-details-content">${escapeHtml(error.url)}</div>
      </div>
    `;
  }

  // Stack trace for console errors
  if (error.type === 'console' && error.stack) {
    detailsHtml += `
      <div class="error-details-section">
        <div class="error-details-label">Stack Trace</div>
        <div class="error-details-content"><pre class="error-stack">${escapeHtml(error.stack)}</pre></div>
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
  }

  return `
    <div class="error-item">
      <div class="error-header">
        <input type="checkbox" class="error-checkbox" data-index="${errors.indexOf(error)}">
        <span class="error-type-badge ${typeClass}">${typeLabel}</span>
        <div class="error-main">
          <div class="error-message">${escapeHtml(error.message)}</div>
          <div class="error-meta">${metaHtml}</div>
        </div>
        <button class="delete-btn" data-index="${errors.indexOf(error)}" title="Delete error">✕</button>
        <button class="copy-btn" data-index="${index}" title="Copy error details">📋</button>
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
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  } catch {
    btn.textContent = '✗';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  }
}

function formatErrorForClipboard(error) {
  const typeLabel = error.type === 'console' ? 'JS Error (console)' : 'HTTP Error (network)';
  const lines = [
    `Error Type: ${typeLabel}`,
    `Message: ${error.message}`,
    `Time: ${new Date(error.timestamp).toLocaleString()}`,
  ];
  if (error.url) lines.push(`URL: ${error.url}`);
  if (error.type === 'console' && error.stack) lines.push(`Stack Trace:\n${error.stack}`);
  if (error.type === 'network') {
    if (error.method) lines.push(`Method: ${error.method}`);
    if (error.status) lines.push(`Status: ${error.status} ${error.statusText || ''}`);
  }
  return lines.join('\n');
}

// ── Export HTML Report ──
function exportReport() {
  const filtered = getFilteredErrors();
  if (filtered.length === 0) {
    const orig = btnExport.textContent;
    btnExport.textContent = 'No errors to export';
    setTimeout(() => { btnExport.textContent = orig; }, 2000);
    return;
  }

  const now = new Date();
  const timestamp = now.toLocaleString();
  const consoleCount = filtered.filter(e => e.type === 'console').length;
  const networkCount = filtered.filter(e => e.type === 'network').length;

  let rowsHtml = '';
  filtered.forEach((error, i) => {
    const typeLabel = error.type === 'console' ? 'JS Error' : 'HTTP Error';
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

  const html = `<!DOCTYPE html>
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
  <p class="meta">Generated: ${escapeHtml(timestamp)}</p>
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

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = now.toISOString().slice(0, 19).replace(/[:-]/g, '');
  a.href = url;
  a.download = `error-hunter-report-${dateStr}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Export JSON Report ──
function exportReportJson() {
  const filtered = getFilteredErrors();
  if (filtered.length === 0) {
    const orig = btnExportJson.textContent;
    btnExportJson.textContent = 'No errors';
    setTimeout(() => { btnExportJson.textContent = orig; }, 2000);
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 19).replace(/[:-]/g, '');
  const json = JSON.stringify(filtered, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `error-hunter-report-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Copy Selected Errors ──
function updateCopySelectedButton() {
  const checked = errorList.querySelectorAll('.error-checkbox:checked');
  btnCopySelected.hidden = checked.length === 0;
}

async function copySelectedErrors() {
  const checked = errorList.querySelectorAll('.error-checkbox:checked');
  if (checked.length === 0) return;

  const parts = [];
  checked.forEach(cb => {
    const idx = parseInt(cb.dataset.index);
    if (idx >= 0 && idx < errors.length) {
      parts.push(formatErrorForClipboard(errors[idx]));
    }
  });

  const text = parts.join('\n---\n');
  try {
    await navigator.clipboard.writeText(text);
    btnCopySelected.textContent = `Copied ${checked.length}`;
    setTimeout(() => { btnCopySelected.textContent = 'Copy selected'; }, 1500);
  } catch {
    btnCopySelected.textContent = 'Copy failed';
    setTimeout(() => { btnCopySelected.textContent = 'Copy selected'; }, 1500);
  }

  // Uncheck all
  checked.forEach(cb => { cb.checked = false; });
  updateCopySelectedButton();
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

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
