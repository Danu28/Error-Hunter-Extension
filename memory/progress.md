# Progress

## 2026-08-02 — Feature round: resource-load capture + page context

Plan approved (F1: PerformanceObserver resource capture; F2: page-state chokepoint).

- [x] T1. F1: `PerformanceObserver('resource', buffered)` in injectPageWorldErrorCapture; exclude fetch/xhr initiators; dispatch `eh-network-error`
- [x] T2. F1: TESTING.md §2/§3 — broken image now captured (Resource Timing)
- [x] T3. F2: content.js `reportError` stamps pageTitle + pageRoute (behavioral test added)
- [x] T4. F2: SW `handleNewError` refreshes pageTitle/pageRoute on dedup hit (behavioral test added)
- [x] T5. F2: popup `buildErrorItem` Page section + `generateBugReport` `**Page:**` line (tests added)
- [x] T6. README features list + memory (this file)
- Verify: suite 71 → 75 all green; real-Chrome probe confirmed resource capture (early + live img, CSS bg, favicon → 404; fetch single-captured, no double capture)

## Verifier (2026-08-02) — feature round

- [v] Suite 75/75 re-run green.
- [v] Mutation-verified 3 new behavioral tests: removing reportError pageTitle stamp → content test fails; removing SW dedup pageRoute refresh → SW test fails; removing popup `**Page:**` line → popup test fails.
- Verifier findings (Low): resource-capture automated test is source-presence only (behavior proven by the Chrome probe, not the suite); buildErrorItem Page rendering is presence-tested only. Both acceptable — matches the codebase's deliberate pattern for the MAIN world function.

## 2026-08-02 — Start-monitoring self-heal round

Plan approved (verify-then-repair: fix only tabs with no live content script). Revised to inject instead of reload after the user saw all stale tabs refresh.

- [x] T1. `broadcastToTabs` returns the ids of tabs whose sendMessage threw (no live content script)
- [x] T2. `handleStartMonitoring` injects `src/content.js` into failed tabs via executeScript — no reload (revised from reload); `tabs.reload` now only a fallback when injection throws
- [x] T3. TESTING.md troubleshooting note + memory update (this file)
- Verify: suite 66 → 70, all green (behavioral tests: broadcastToTabs failures + skips non-http; injection into failed tabs without reload; no injection when all heard; reload only on injection failure)

## 2026-08-02 — Commits on main (after bug-consistency round)

- Bug-consistency + verifier-fix rounds committed as `2a6cb43` on `feat/qa-features`, fast-forward merged to `main` (`1abdc24..2a6cb43`) and pushed to `origin/main`. Local `feat/qa-features` deleted. Tree clean, only `main`/`origin/main` remain.

## 2026-08-02 — Manual-test-infra round (test server + test page + guide)

Plan approved (no extension code changes, no deps, fully manual testing). Delivered:

- [x] T1. `serve-test.js` — added `/api/slow-error` (500 after ~2 s), `/api/xhr-error` (POST → 500), `/api/big-response` (200, ~3 KB body)
- [x] T2. `tests/test-page.html` — added Slow Error + XHR POST buttons, console.info/debug buttons, OK Request + Big Response + Broken Image (negative/success cases), form controls (select/checkbox/radio/textarea) + Save for user-action capture
- [x] T3. `TESTING.md` — full manual QA checklist (13 scenarios, incl. negative tests, ignore rules, multi-tab, exports, persistence, 500 cap)
- [x] T4. This file — memory update + first pass handoff
- Verify: automated suite still green (66/66); endpoints curl-verified (slow-error 500 @~2 s, xhr-error 500, big-response 200 len 3025); page IDs + API refs verified via node fetch script

## Verify

- `node tests/run-tests.js` → ALL PASSED, 66 tests.

## Bug-consistency round (earlier, branch feat/qa-features)

Plan approved: fix bugs A–G from audit + init memory. This round ONLY fixes consistency bugs; no new features.

- [x] T1. Init memory/ (4 files, backfill from session)
- [x] T2. Fix README Stop line (code right, docs stale)
- [x] T3. Cap errors at 500 in handleNewError (drop oldest)
- [x] T4. Blocked counter label — drop "session" wording
- [x] T5. ⛔ network ignore rule uses matchOn url + error.url
- [x] T6. Unique tab labels (append "(tab id)" to colliding URLs)
- [x] T7. Tab label in bug report/export header when currentTab set
- [x] T8. Behavioral tests: matchesRule, handleNewError (dedup+cap+ignore), getFilteredErrors
- [x] T9. Update progress.md (this file) on completion

## Bonus fix discovered during T8

- Pre-existing bug: the popup **Warning** filter matched nothing — `getFilteredErrors` type check `e.type !== currentFilter` rejected `type:'console'` entries with `level:'warn'`. Fixed by exempting the 'warning' filter from the type check. Caught by the new behavioral test.

## Verifier follow-up round

- Fixed both Low findings from the verifier: JSON export now always `{tab, errors}` (consistent schema); `getTabLabels()` extracted as single source of truth for tab labels. Added 3 behavioral tests for `getTabLabels`. Test count 63 → 66, all pass.

## Verify

- `node tests/run-tests.js` → ALL PASSED, 63 tests (was 50).
- Verifier round (2026-08-02): full suite re-run green; mutation-tested new behavioral tests (removing cap → cap test fails; reverting warning-filter exemption → warning test fails; removing Tab line → Tab test fails). All 4 suites run standalone via `node tests/test-*.js`.

## Not done / deferred

- Automated browser-level QA (Playwright/Selenium) intentionally not added — user chose fully manual testing for this round.
- Manual first pass through `TESTING.md` still pending with the user (handoff done; results not yet recorded).

## Earlier (before this round)

- Feature work: network payload/timing, ignore rules (block-at-capture), per-tab filtering, user action capture, bug report template, admin-dashboard test page. Commits 11c2d3e + dc0ac73 (now on main via the merge above).
- Verifier fixes: fetch clone isolation, _ehBodyToString binary-safe, copy button origIndex.
