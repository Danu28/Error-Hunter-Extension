# Knowledge

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

## Gotcha: Warning filter in popup

`getFilteredErrors` filters 'warning' by `level === 'warn'`, NOT by `type`. The generic type check must exempt `currentFilter === 'warning'`, otherwise console-type warnings never match.

## Gotcha: tab labels — one source of truth

`getTabLabels()` builds the tabId→label map (with `(tab <id>)` suffix for colliding truncated URLs) and is used by BOTH `updateTabFilter()` (dropdown) and `getCurrentTabLabel()` (report/export). Never re-derive labels inline — they'd drift.
