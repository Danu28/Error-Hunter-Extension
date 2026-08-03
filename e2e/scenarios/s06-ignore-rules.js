// s06 — ignore rules + blocked counter (TESTING.md §6)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's06 ignore rules + blocked counter',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    // Network rule via ⛔ on Load Orders (URL .../api/not-found)
    await eh.clickButton(page, 'btnLoadOrders');
    let errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'load orders captured');
    assert(errs[0].url.includes('/api/not-found'), 'load orders url');

    let popup = await eh.openPopup(session, 1);
    await popup.click('.error-item .ignore-btn'); // ⛔ creates url rule + purges
    await sleep(800);
    let rules = await session.storageLocalGet('eh_ignore_rules');
    assertEq(rules.eh_ignore_rules.length, 1, 'one ignore rule added');
    assertEq(rules.eh_ignore_rules[0].matchOn, 'url', 'network rule matches url');
    popup.close();

    await eh.clickButton(page, 'btnLoadOrders');
    await sleep(1200);
    errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'second load orders dropped');
    let blocked = await session.storageLocalGet('eh_blocked_count');
    assert(blocked.eh_blocked_count >= 1, 'blocked counter incremented, got ' + blocked.eh_blocked_count);

    // Console rule via ⛔ on console.error (message rule)
    await eh.clickButton(page, 'btnConsoleError');
    errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'console error captured');
    popup = await eh.openPopup(session, 1);
    await popup.click('.error-item .ignore-btn');
    await sleep(800);
    rules = await session.storageLocalGet('eh_ignore_rules');
    assertEq(rules.eh_ignore_rules.length, 2, 'two ignore rules');
    assert(rules.eh_ignore_rules.some((r) => r.matchOn === 'message'), 'console rule matches message');
    popup.close();

    await eh.clickButton(page, 'btnConsoleError');
    await sleep(1200);
    errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'second console error dropped');
    blocked = await session.storageLocalGet('eh_blocked_count');
    assert(blocked.eh_blocked_count >= 2, 'blocked counter incremented again, got ' + blocked.eh_blocked_count);

    // Remove both rules → captures work again
    popup = await eh.openPopup(session, 0);
    await popup.click('#rulesToggle');
    await sleep(400);
    const delCount = await popup.eval(`document.querySelectorAll('.rule-delete').length`);
    assertEq(delCount, 2, 'two rules listed in panel');
    while ((await popup.eval(`document.querySelectorAll('.rule-delete').length`)) > 0) {
      await popup.click('.rule-delete');
      await sleep(400);
    }
    popup.close();

    await eh.clickButton(page, 'btnLoadOrders');
    errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'captures work again after removing rules');
    assert(errs[0].message.includes('/api/not-found returned 404'), 'recovered capture message');
  }
};
