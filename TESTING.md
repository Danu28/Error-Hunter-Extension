# Error Hunter — Manual Test Guide

End-to-end manual test checklist for the Error Hunter Chrome extension using the bundled test server and dashboard page.

## Prerequisites

- Google Chrome (or Chromium)
- Node.js (for the test server)
- The extension repo (this directory)

## Setup

1. **Start the test server** (leave it running):
   ```
   node serve-test.js
   ```
   Serves the dashboard at `http://127.0.0.1:8080/tests/test-page.html` and the API endpoints below.

2. **Load the extension unpacked**:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** → select this repo's folder
   - Pin the **Error Hunter** icon to the toolbar.

3. **Open the dashboard**: `http://127.0.0.1:8080/tests/test-page.html`

4. **Click Start Monitoring** in the popup (or press `Ctrl+Shift+E`). The status indicator turns active.

> Run each scenario, then inspect the popup. Reset between groups with **Clear** if a clean list helps.

## Test page buttons

| Button | What it does |
|---|---|
| Load Users / Load Orders | `fetch` a 404 / 500 |
| Load Config | `fetch` a non-existent domain (network failure) |
| Slow Error | `fetch /api/slow-error` → 500 after ~2 s |
| XHR POST | `XMLHttpRequest` POST → 500 with a JSON body |
| console.error / warn / log / info / debug | Log a message with a payload |
| Throw | Uncaught exception |
| Reject | Unhandled promise rejection |
| OK Request | `fetch /api/data` → 200 (must NOT be captured) |
| Big Response | `fetch /api/big-response` → 200, ~3 KB body (must NOT be captured) |
| Broken Image | `<img>` that 404s (resource error) |
| Save | Records form values (select/checkbox/radio/textarea) as user actions |

## Scenarios

### 1. Console capture
1. Click **console.error**, **console.warn**, **Throw**, **Reject**.
2. Open the popup.
- **Expect:** each click adds one entry. `console.error` shows the red **Console** badge, warnings show the **Warning** badge, Throw/Reject appear as Console entries. Payload objects are readable in the expanded error.

### 2. Network capture (fetch + XHR)
1. Click **Load Users** (404), **Load Orders** (500), **Load Config** (network fail), **Slow Error** (500, ~2 s), **XHR POST** (500).
2. Open the popup → **Network** filter.
- **Expect:** five entries. Each shows status (404/500/-), and the URL. The **Slow Error** entry shows a ~2000 ms duration. **Load Config** shows `Network error`/`-` status with the failed URL. The **XHR POST** entry shows the JSON request body and response snippet when expanded.

### 3. Success / negative tests (must NOT capture)
1. Click **OK Request** and **Big Response**.
2. Open the popup.
- **Expect:** NO new entries, NO badge increase. 200 responses are never errors.
- **Broken Image** is also NOT captured — by design. Resource-load failures (broken `<img>`, `<script>`, `<link>`) fire an `error` event only on the element itself; they never reach `window`/`document` listeners, so Error Hunter's window-level error handler cannot see them. This is expected, not a defect.

### 4. Log ring buffer
1. Click **console.log**, **console.info**, **console.debug** several times.
2. Open the popup.
- **Expect:** none appear in the **Console** or **All** filters on their own. They are captured only as the `logContext` of a *subsequent real error*: click **console.error** after the logs, expand that entry, and the last 20 log lines (including the info/debug messages) appear under **Log context**.

### 5. User action capture
1. Change the **select**, tick **Notify me**, switch the radio to **Pro**, type in the **textarea**, then click **Save**.
2. Click **console.error**.
3. Expand the new entry.
- **Expect:** the entry's **User actions** section lists the change events (select change, checkbox, radio, textarea typing) and the Save click, last ~10.

### 6. Ignore rules + blocked counter
1. Open the popup → **Ignore rules**.
2. Click **Load Users** (404, URL `.../api/not-found`).
3. In the error list, click ⛔ on that entry → a rule `not-found` matching **url** is added.
4. Click **Load Users** again.
- **Expect:** the second capture is dropped (no new entry, no badge increase) and the "N errors blocked" counter increments. The rule pattern is visible in the rules panel.
5. Click **console.error**, then ⛔ on it → a rule matching **message**.
6. Click **console.error** with the same message.
- **Expect:** dropped + blocked counter increments. Remove both rules → captures work again (previously-blocked errors are NOT recovered).

### 7. Per-error actions
- On any entry: **copy** puts the error details on the clipboard; **delete** removes just that entry; **⛔** creates an ignore rule. Verify each on a Console entry and a Network entry (⛔ on network matches by URL, on console matches by message).

### 8. Popup filters & search
1. Capture console + warning + network errors.
2. Click **All / Console / Warning / Network**.
- **Expect:** each filter shows only its group. **Warning** shows console warnings.
3. Type a word from one error's message in **Search**.
- **Expect:** only matching errors remain. Clear the search to restore.

### 9. Sort, expand, count
1. Capture several errors. Toggle **↓ Newest / ↑ Oldest** — order flips.
2. Click **Expand all** — every entry expands. Click again to collapse.
3. Check the header count and the toolbar icon badge.
- **Expect:** count and badge match the number of stored errors. Same error repeated in one tab shows `[×N]`, not N rows.

### 10. Tabs
1. Open the dashboard in **two tabs** (same URL).
2. Click **Load Orders** in tab A, then in tab B.
3. Open the popup → **All tabs** dropdown.
- **Expect:** dropdown lists both tabs. Selecting one shows only that tab's error (per-tab dedup). Two tabs with the same URL are labelled `...` and `... (tab <id>)`. The badge counts both entries.
4. Click **Copy Report** with a tab selected.
- **Expect:** the report's `**Tab:**` line names the selected tab. Exporting JSON always produces `{ "tab": <label or null>, "errors": [...] }`.

### 11. Exports
1. Capture errors, then try each:
   - **Export HTML** — downloads an `.html` file; open it and confirm all errors (with tab header when a tab is selected) render.
   - **JSON** — downloads JSON; valid, and `tab` is `null` when "All tabs" is selected.
   - **Copy Report** — clipboard contains the markdown bug report (URL, browser, tab, actions, log context, errors).
   - **Edit Report** — opens a pre-filled report you can edit and copy.

### 12. Persistence
1. With errors captured, click **Stop Monitoring** (or `Ctrl+Shift+E`).
- **Expect:** monitoring stops (status indicator off), new errors are NOT captured, but existing errors stay in the list and badge.
2. Click **Start Monitoring**, reload the page, trigger a new error.
- **Expect:** old errors still present alongside the new one.
3. Click **Clear**.
- **Expect:** list empties and badge resets. Closing the browser also wipes errors (session storage).

### 13. Hard cap (500)
Optionally stress-test: with monitoring on, loop a throw across unique messages past 500 captures (e.g. in the console: `for (let i=0;i<600;i++) setTimeout(()=>{ throw new Error('cap'+i) })`).
- **Expect:** the list never exceeds 500 entries; the oldest entries are evicted first.

## Troubleshooting: "X wasn't captured"

Before reporting a finding, rule out session state:

1. **Ignore rules** — open **Ignore rules** in the popup. If a rule's pattern matches the error's URL or message, the error is blocked by design. Remove the rule and retest.
2. **Tab filter / search** — confirm the popup shows **All tabs** and the search box is empty.
3. **Monitoring on?** — the status indicator must be active. Press `Ctrl+Shift+E` if unsure (it toggles).
4. **Fresh reload** — reload the dashboard, Start monitoring, and trigger the error once more.

> **Stale content script:** if the extension was loaded or reloaded in `chrome://extensions` *after* the dashboard tab was opened, that tab has no live content script and won't hear the `start` broadcast (nothing is captured — not even console). Clicking **Start Monitoring** now injects the content script directly into such tabs — no reload, page state preserved — and the fresh script auto-starts. No manual refresh needed.

Clean-sequence retest: reload page → Start → Load Users → Load Orders → XHR POST → check **Network** filter. All three should be there (fetch 404, XHR 404, XHR 500).

## Done

When all scenarios above behave as described, the extension passes the manual QA round. Log any deviations as findings — the extension code itself should not change during testing.
