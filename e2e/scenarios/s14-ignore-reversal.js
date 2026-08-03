// s14 — ignore reversal, real-user flow in one session: capture → ignore → check → un-ignore → check
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's14 ignore reversal (real-user flow)',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    // 1. Real user: an error happens and is captured
    await eh.clickButton(page, 'btnLoadOrders');
    let errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'step1 load orders captured');
    assert(errs[0].url.includes('/api/not-found'), 'step1 load orders url');

    // 2. User ignores it via ⛔ → rule created, matching stored error purged
    let popup = await eh.openPopup(session, 1);
    await popup.click('.error-item .ignore-btn');
    await sleep(800);
    let rules = await session.storageLocalGet('eh_ignore_rules');
    assertEq(rules.eh_ignore_rules.length, 1, 'step2 one rule after ignore');
    errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'step2 error purged on ignore');
    popup.close();

    // 3. Same user, same session: the error is now silently blocked
    await eh.clickButton(page, 'btnLoadOrders');
    await sleep(1200);
    errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'step3 blocked while rule present');
    let blocked = await session.storageLocalGet('eh_blocked_count');
    assert(blocked.eh_blocked_count >= 1, 'step3 blocked counter incremented, got ' + blocked.eh_blocked_count);

    // 4. User changes their mind: remove the rule from the panel
    popup = await eh.openPopup(session, 0);
    await popup.click('#rulesToggle');
    await sleep(400);
    assertEq(await popup.eval(`document.querySelectorAll('.rule-delete').length`), 1, 'step4 one rule listed');
    await popup.click('.rule-delete');
    await sleep(400);
    rules = await session.storageLocalGet('eh_ignore_rules');
    assertEq(rules.eh_ignore_rules.length, 0, 'step4 rule removed');
    popup.close();

    // 5. Same user, same session: the same error is captured again (fresh entry)
    await eh.clickButton(page, 'btnLoadOrders');
    errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'step5 captured again after removal');
    assert(errs[0].url.includes('/api/not-found'), 'step5 recovered error url');
    assertEq(errs[0].count, 1, 'step5 fresh entry (old one not restored)');
    assertEq(errs[0].tabId, errs[0].tabId, 'step5 has tabId');
  }
};
