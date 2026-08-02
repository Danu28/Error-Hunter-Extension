# Problems

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
