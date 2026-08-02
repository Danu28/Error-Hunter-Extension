# Progress

## 2026-08-02 — Bug-consistency round (branch feat/qa-features, HEAD dc0ac73)

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

- Nothing pushed; commits pending user decision (repo was also unpushed at baseline).

## Earlier (before this round)

- Feature work: network payload/timing, ignore rules (block-at-capture), per-tab filtering, user action capture, bug report template, admin-dashboard test page. Commits 11c2d3e + dc0ac73 (unpushed on feat/qa-features).
- Verifier fixes: fetch clone isolation, _ehBodyToString binary-safe, copy button origIndex.
