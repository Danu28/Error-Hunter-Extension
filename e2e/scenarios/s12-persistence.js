// s12 — persistence: session storage, dedup counts, SW-restart survival, local storage (TESTING.md §12)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's12 persistence',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    await eh.clickButton(page, 'btnConsoleError');
    await eh.clickButton(page, 'btnLoadUsers');
    await eh.clickButton(page, 'btnConsoleError'); // dedup → count 2
    const errs = await eh.waitForErrors(session, (e) => e.length >= 2);
    assertEq(errs.length, 2, 'two unique rows');
    assertEq(errs.find((e) => e.message.includes('Manual console.error')).count, 2, 'dedup count 2');

    // Session storage holds errors + active flag
    const stored = await session.storageGet(['error_hunter_errors', 'error_hunter_active']);
    assertEq(stored.error_hunter_errors.length, 2, 'session storage has 2 errors');
    assertEq(stored.error_hunter_active, true, 'active flag set');

    // Ignore the console entry via the popup → it is purged (1 remains) and a rule is added
    const popup = await eh.openPopup(session, 2);
    await popup.eval(`(() => {
      const items = [...document.querySelectorAll('.error-item')];
      const it = items.find((el) => el.textContent.includes('Manual console.error'));
      if (!it) return false;
      const btn = it.querySelector('.ignore-btn');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await sleep(300);
    const afterIgnore = await eh.readErrors(session);
    assertEq(afterIgnore.length, 1, 'ignored entry purged, one remains');

    // Kill the SW → errors (session storage) + rules (local storage) survive
    const swConn = await session.sw();
    await session.browser.send('Target.closeTarget', { targetId: swConn.targetId }).catch(() => {});
    await sleep(1500);
    const after = await eh.readErrors(session);
    assertEq(after.length, 1, 'one error survives SW restart');
    assertEq(after[0].message, afterIgnore[0].message, 'same error after restart');

    const local = await session.storageLocalGet(['eh_ignore_rules', 'eh_blocked_count']);
    assert(Array.isArray(local.eh_ignore_rules), 'eh_ignore_rules present');
    assert(typeof local.eh_blocked_count === 'number', 'eh_blocked_count present');
    assertEq(local.eh_ignore_rules.length, 1, 'one ignore rule persisted');
    popup.close();
  }
};
