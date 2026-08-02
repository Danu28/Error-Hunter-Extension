# Problems

## [2026-08-02] Verifier: no open findings (feature round — resource capture + page context)

Reviewed tests, diff, security, performance. Mutation-verified all 3 new behavioral tests. Low-severity notes recorded as acceptable: resource-capture test is source-presence (behavior proven by the Chrome probe, per the codebase's deliberate pattern for the MAIN world function); buildErrorItem Page rendering is presence-tested only. Platform limit noted: the Resource Timing buffer can evict very old entries on long SPA sessions, so buffered replay at Start may miss the earliest failures.

## [2026-08-02] FIXED: Start monitoring on a pre-extension tab captured nothing

User: after clicking Start on an already-loaded page, nothing was captured (not even console) until a manual refresh. Root cause: the tab had no live content script (opened before the extension loaded / stale after an extension reload), so the `start` broadcast was never heard. Fixed by verify-then-repair: `broadcastToTabs` now returns the tab ids whose sendMessage threw, and `handleStartMonitoring` injects `src/content.js` directly into exactly those (the script auto-starts via init(); status already active) — `tabs.reload` only as a fallback when injection throws. The first fix reloaded every stale tab, which the user rejected (saw all tabs refresh after an extension reload); switched to injection. Tests: 3 behavioral; suite 66 → 70, all green. TESTING.md troubleshooting notes the auto-repair.

## [2026-08-02] INFORMATIONAL: broken-image resource errors are NOT capturable (browser behavior)

Manual-test finding "Broken Image not captured" is correct AND expected. Verified in real Chrome (headless + windowed probes): a failing `<img>` fires `error` only on the element — `window`/`document` error listeners (bubble AND capture phases) and `window.onerror` never fire for resource-load failures. So the extension's window-level `error` handler can't see them, no matter what. The capture surface is console + window errors + fetch/XHR + user actions; DOM element load errors are out of scope. TESTING.md §3 updated to state this as expected non-capture (previous note claiming it "may appear as Unknown error" was wrong). (updated 2026-08-02) Gap now closed for CORS-visible resources via Resource Timing (`PerformanceObserver`), so broken assets ARE captured as network errors — the event-model fact above still stands; the gap was closed without touching the error event.

## [2026-08-02] INVESTIGATED-NOT-REPRODUCED: "Load Orders" + "XHR POST" not captured

User reported XHR GET 404 and XHR POST 500 not captured. Investigation in a real Chrome browser (page probe running the extracted MAIN-world capture function): XHR GET 404, XHR POST 500, fetch 404/500, and console.error ALL dispatch `eh-network-error`/`eh-console-error` correctly with full detail (status, duration, requestBody, responseText). The downstream relay (content.js pageWorldHandler → reportError → SW handleNewError) is a single shared path used by fetch (which the user confirmed works), so there is no code path where XHR differs from fetch. Auto-verification of the full extension pipeline via CDP was abandoned (headless extension runs are incomplete; remote-debugging evaluate contexts don't expose `chrome.*`). Verdict: likely session interference (ignore rule / filter / monitoring off). TESTING.md now has a troubleshooting + clean-retest sequence. If the user reproduces after a clean retest, capture browser console (SW errors, `window.__eh_patched`) for the next round.

## [2026-08-02] FIXED: README says Stop clears errors (docs bug)

Code only toggles capture; errors persist until Clear. Fixed in T2 (README, not code).

## [2026-08-02] FIXED: unbounded errors array can hit storage.session quota

`handleNewError` pushed without cap; quota writes silently swallowed in catch → silent data loss. Fixed in T3 (cap 500, drop oldest).

## [2026-08-02] FIXED: export/report silently narrowed to current tab

`getFilteredErrors()` respects `currentTab`, so copy/export/report output depended on the selected tab without saying so. Fixed in T7 (surface tab in output header: markdown `**Tab:**`, HTML meta line, JSON wraps as `{tab, errors}`).

## [2026-08-02] FIXED: blocked counter wording lied across sessions

"blocked this session" but `eh_blocked_count` persists in storage.local. Fixed in T4 (drop "session" wording).

## [2026-08-02] FIXED: tab dropdown labels could collide

Two tabs same host+path → identical labels, indistinguishable. Fixed in T6 (append "(tab id)" to colliding labels).

## [2026-08-02] FIXED: ⛔ network error built over-specific rule

Network errors matched on full message → rule matched only one instance. Fixed in T5 (match url for network type).

## [2026-08-02] FIXED: tests were source-presence, not behavioral

SW/content tests asserted `src.includes(...)`; a broken branch still passed. Added behavioral tests for matchesRule, handleNewError (dedup per tab, ignore+blocked count, cap at 500), getFilteredErrors (type/warning/tab/search), and generateBugReport Tab line. Test count 50 → 63.

## [2026-08-02] FIXED (bonus, found by new tests): popup Warning filter matched nothing

`getFilteredErrors` line `if (currentFilter !== 'all' && e.type !== currentFilter)` rejected `type:'console'` warnings. Exempted 'warning' from the type check.

## [2026-08-02] Process: shared-project-memory skill never loaded in planner/builder/verifier

Early sessions skipped memory entirely; `memory/` did not exist. Now initialized; going forward every phase reads/writes the four files.

## [2026-08-02] Verifier findings — FIXED

- JSON export shape now consistent: always `{tab: <label|null>, errors: [...]}` regardless of tab selection (was `{tab, errors}` with a tab, bare array otherwise).
- `getCurrentTabLabel()` now reuses shared `getTabLabels()`; the colliding-label logic lives in exactly one place (used by both the dropdown and the report/export).
