# Decisions

## [2026-08-02] Decision: Start self-heals stale content scripts by injecting, not reloading (updated 2026-08-02)

Context: User reported "nothing is captured" after clicking Start Monitoring on an already-loaded page; a manual refresh made it work. Root cause: tabs opened before the extension loaded (or before it was reloaded in chrome://extensions) have no live content script, so the SW→content.js `start` broadcast is never heard (sendMessage rejects). Console patching lives in the content script, so not even console errors appear — the decisive symptom.

Options:
- A: Reload all http tabs on Start — guaranteed, but disrupts healthy tabs and loses their state.
- B: SW directly re-inject content.js + MAIN world into all tabs — no reload, but cross-instance idempotency is fragile after an extension reload (a stale marker from a dead instance makes fresh injection bail, or risks double capture).
- C: Verify-then-repair (reload) — `broadcastToTabs` returns the tab ids whose sendMessage threw; Start reloads exactly those.
- D: Verify-then-repair (inject) — same failed-tab gate, but `chrome.scripting.executeScript({target:{tabId}, files:['src/content.js']})` injects the content script directly into failed tabs; reload only if injection throws.

Chosen: D. First shipped C (reload), but the user saw ALL tabs refresh after an extension reload — every stale tab had entered the failed list. D keeps the gate and drops the reload: the injected content script auto-starts via content.js `init()` (status already active), so capture works with zero reloads and no page-state loss. B rejected: cross-instance markers are fragile and un-gated injection double-patches healthy tabs.

Consequences: Start never reloads a tab unless content-script injection itself fails (rare). `handleStopMonitoring` ignores `broadcastToTabs`' return value. Injecting into a tab mid-check can in theory double-inject (symptom: inflated dedup counts, not breakage) — acceptable.

## [2026-08-02] Decision: Manual QA round — extend test server, no automation

Context: User wants to test all features end to end. Two approaches: extend the existing serve-test.js + tests/test-page.html with edge-case triggers and write a guided manual checklist (TESTING.md), vs Playwright/Selenium automation.

Options:
- A: Extend existing server/page + TESTING.md manual guide.
- B: Browser automation (Playwright/Selenium).

Chosen: A — user picked fully manual testing; no new dependencies; extension code untouched during testing.

Consequences: TESTING.md is the source of truth for the QA pass; server/page additions live in repo and stay versioned.

## [2026-08-02] Decision: Block ignore rules at capture

Context: QA's popup flooded with third-party noise (ads, analytics, sentry). Two ways to filter: display-only (hide in list) vs block-at-capture (never store).

Options:
- A: Display-only filter — errors still stored/counted in badge; just hidden. Safer, no data loss.
- B: Block at capture — matched errors never stored, never counted. Cleaner list + badge, but silently drops.

Chosen: B — user chose block-at-capture; mitigated by a visible "N errors blocked" counter so drops aren't silent.

Consequences: Ignored errors are gone forever (not recoverable by removing the rule). Removing a rule only unblocks future captures.

## [2026-08-02] Decision: Dedup errors per tab

Context: Per-tab filtering (Feature 4) requires same-type+message+url errors from two tabs to stay separate. Old dedup key was type+message+url, collapsing cross-tab duplicates.

Options:
- A: Keep old dedup key — per-tab filter silently misbehaves for same error in two tabs.
- B: Add tabId to dedup key — identical errors in two tabs show as two entries.

Chosen: B — required for per-tab correctness. Accepted tradeoff: badge count inflates with tab count.

Consequences: Same error across N tabs = N entries, N in badge count. Intended.

## [2026-08-02] Decision: Network errors capture duration + request body + response snippet

Context: Bug reports lacked API evidence. Old `duration` field was dead code (removed in refactor).

Options:
- A: Duration only — no payload capture, privacy-lightest.
- B: Duration + request body (500 chars) + response snippet (2000 chars).

Chosen: B — user requested full payload. Stored in session storage (cleared on browser close). Noted risk: login bodies may contain passwords.

Consequences: requestBody/responseText appear in popup, clipboard, bug reports. Potential credential exposure is session-scoped.

## [2026-08-02] Decision: Stop monitoring keeps errors (does not clear)

Context: README claimed Stop clears errors; code only stops capture. Popup footer and Clear button imply errors persist until explicitly cleared.

Options:
- A: Stop clears errors (match README).
- B: Stop keeps errors; user clears manually (match code + footer).

Chosen: B — code/footer/UX agree; README was stale. Fixed README, not code.

Consequences: Errors survive Stop until user clicks Clear.

## [2026-08-02] Decision: Cap stored errors at 500

Context: handleNewError pushes unbounded; storage.session has ~10MB quota. Long QA session with many unique errors would silently hit quota (catch swallows the error).

Options:
- A: No cap — risk silent data loss at quota.
- B: Cap at 500, drop oldest.

Chosen: B — drop oldest beyond 500. Safe with popup since delete/copy/ignore recompute index via errors.indexOf each render.

Consequences: Oldest errors evicted first; badge reflects stored count.
