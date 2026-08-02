# Knowledge

## Gotcha: "nothing captured" on Start = stale/missing content script

If a tab was opened before the extension loaded (or before it was reloaded in `chrome://extensions`), its content script is absent/invalidated, so the SW broadcast of `start` fails with "Receiving end does not exist" (`chrome.tabs.sendMessage` rejects). Because console patching lives in the content script, NOTHING is captured — not even console errors; that symptom pins this cause. Fix (service-worker.js): `broadcastToTabs` returns the ids of tabs whose sendMessage threw, and `handleStartMonitoring` runs `chrome.scripting.executeScript({target:{tabId}, files:['src/content.js']})` on exactly those — the injected script auto-starts via content.js `init()` because status is already active. No page reload; `tabs.reload` is only a fallback when injection throws. A manual refresh is the same self-heal, just manual. (Reload was the original fix but the user saw every stale tab refresh after an extension reload — injection avoids that; also the main reason an un-gated inject-all approach is wrong: it double-patches healthy tabs, and cross-instance idempotency markers are unreliable across extension reloads.)

## Architecture

MV3 extension, vanilla JS, no deps. Three worlds: ISOLATED content script (`src/content.js`), MAIN world injection (`src/service-worker.js` `injectPageWorldErrorCapture` via `chrome.scripting.executeScript`), and SW storage layer. Popup (`src/popup.js`) renders from SW via messages.

## Error flow

Page errors captured in MAIN world dispatch CustomEvents (`eh-*`) → ISOLATED content script relays via `chrome.runtime.sendMessage({action:'new_error'})` → SW `handleNewError` stores in `chrome.storage.session`. Console log/info/debug go to a 200-entry ring buffer (logContext); click/input go to a 50-entry user-action buffer. Errors get `logContext` (last 20) + `userActions` (last 10) attached before report.

## Ignore rules

Rules stored in `chrome.storage.local` key `eh_ignore_rules`: `{id, pattern, matchOn: 'message'|'url'|'any'}`. Matching is case-insensitive substring (no regex → no ReDoS). SW checks in `isIgnoredError` before storing; matched errors dropped + `eh_blocked_count` incremented. Popup reads rules directly from storage.local; mutations go through SW messages (`add_ignore_rule` also purges matching stored errors).

## Gotcha: copy/delete/ignore button index

Error buttons must use the UNFILTERED index (`errors.indexOf(error)` / `origIndex`), not the filtered loop index, or they act on the wrong error when a filter/search is active. `copyErrorToClipboard` reads `errors[index]`.

## Gotcha: fetch clone must not leak into outer promise

`response.clone().text()` is async; if clone/text throws and it's not isolated, the throw propagates to the outer `.catch`, which dispatches a spurious error AND rethrows — turning a successful HTTP error response into a rejected promise for the app. Wrap the clone block in its own try/catch so instrumentation never alters app-visible behavior.

## Gotcha: session storage quota

`chrome.storage.session` (~10MB) rejects writes when full; SW catches swallow errors. Errors capped at 500 to stay under quota. Log/user-action buffers are capped in content.js (200/50).

## Tests

`node tests/run-tests.js` — no framework, plain assert. SW/content tests are largely source-presence checks; popup tests extract functions via regex (`extractFn`) and run them. Behavioral tests: `matchesRule`, `handleNewError`, and `getFilteredErrors` are extracted and executed with an in-memory `chrome.storage` mock or injected params. Note: `extractFn` must keep the `async` keyword (`(?:async\s+)?function`) or extracted async fns are invalid. Extracted functions referencing module globals (e.g. `getFilteredErrors` uses `errors`/`currentFilter`/`currentTab`/`searchText`) need those injected as `new Function` params. SW suite is async (`runTests` returns a Promise); the runner must `await` it. Verified: mutating each new behavior (removing the cap, reverting the warning-filter exemption) makes the matching test fail.

## Manual test infra

- `node serve-test.js` → static file server + API routes on port 8080. API: `/api/data` (200), `/api/not-found` (404), `/api/server-error` (500), `/api/submit` (201), `/api/timeout` (200 after 5 s), `/api/slow-error` (500 after ~2 s), `/api/xhr-error` (POST 500), `/api/big-response` (200 ~3 KB), `/api/login` (401), `/api/search` (200). `GET /` serves `tests/test-page.html`.
- `tests/test-page.html` = admin-dashboard QA page. Every scenario in `TESTING.md` maps to a button. Success/negative cases (OK Request, Big Response) verify 200s are never captured.
- Ring buffer gotcha for QA: console.log/info/debug never appear in the popup list by themselves — they only show under **Log context** of a later real error. Test that with the console.error-after-logs sequence in TESTING.md §4.
- Port 8080 can hold a stale server (`node serve-test.js` from an earlier session) → new server fails to bind silently (EADDRINUSE) and curl hits the old code. Before re-testing after a code change, kill listeners on 8080 (`Get-NetTCPConnection -LocalPort 8080 | Stop-Process`) or test the endpoints return the NEW routes.

## Browser behavior: resource-load errors never reach window/document

Verified empirically in real Chrome: a failing `<img>` fires `error` ONLY on the element (`img.onerror`). `window.addEventListener('error')` (bubble AND capture), `document` listeners, and `window.onerror` do NOT fire for resource-load failures. Consequence: broken-image/script/css errors cannot be caught by a window-level handler — the extension's `injectPageWorldErrorCapture` `window error` listener only sees uncaught JS exceptions. Do not "fix" this by adding more error listeners; it cannot be done at window level.

## Test-verification technique: extract + run capture code in a page probe

To verify the MAIN-world capture logic (`injectPageWorldErrorCapture`) in a REAL browser (native event delivery, XHR loadend, img error, fetch), extract the function from `service-worker.js` and inline it into a throwaway HTML page, then run Chrome headless `--dump-dom` with `--virtual-time-budget`. The page registers `eh-*` listeners and writes what it saw into a `<pre>`. This proved XHR/fetch/console dispatch correctly and revealed the img non-capture. (CDP full-extension automation is unreliable: headless extension content scripts don't inject, and remote-debugging `Runtime.evaluate` contexts expose only a stub `chrome` object without `storage`/`runtime`.)

## Gotcha: Warning filter in popup

`getFilteredErrors` filters 'warning' by `level === 'warn'`, NOT by `type`. The generic type check must exempt `currentFilter === 'warning'`, otherwise console-type warnings never match.

## Gotcha: tab labels — one source of truth

`getTabLabels()` builds the tabId→label map (with `(tab <id>)` suffix for colliding truncated URLs) and is used by BOTH `updateTabFilter()` (dropdown) and `getCurrentTabLabel()` (report/export). Never re-derive labels inline — they'd drift.
