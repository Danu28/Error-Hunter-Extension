// s07 — per-error actions (TESTING.md §7): copy text, delete, ignore
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's07 per-error actions',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    await eh.clickButton(page, 'btnLoadOrders');
    await eh.clickButton(page, 'btnConsoleError');
    const errs = await eh.waitForErrors(session, (e) => e.length >= 2);

    const networkErr = errs.find((e) => e.type === 'network');
    const consoleErr = errs.find((e) => e.type === 'console');

    // Copy — the popup's clipboard text builder (real clipboard needs focus/permission)
    const popup = await eh.openPopup(session, 2);
    const netText = await popup.eval(`formatErrorForClipboard(${JSON.stringify(networkErr)})`);
    assert(netText.includes('Error Type: HTTP Error (network)'), 'network copy: type');
    assert(netText.includes('Status: 404'), 'network copy: status');
    assert(netText.includes('Message: XHR GET http://127.0.0.1:8080/api/not-found returned 404'), 'network copy: message');
    const conText = await popup.eval(`formatErrorForClipboard(${JSON.stringify(consoleErr)})`);
    assert(conText.includes('Error Type: JS Error (console)'), 'console copy: type');
    assert(conText.includes('Message: Manual console.error triggered from dashboard'), 'console copy: message');

    // Delete exactly one entry (the console one)
    await popup.eval(`(() => {
      const items = [...document.querySelectorAll('.error-item')];
      const it = items.find((el) => el.textContent.includes('Manual console.error'));
      if (!it) throw new Error('console item not found');
      it.querySelector('.delete-btn').click();
      return true;
    })()`);
    await sleep(800);
    let remaining = await eh.readErrors(session);
    assertEq(remaining.length, 1, 'one entry deleted');
    assertEq(remaining[0].type, 'network', 'network entry remains');
    popup.close();

    // Ignore the remaining network entry → rule created + purged
    const popup2 = await eh.openPopup(session, 1);
    await popup2.click('.error-item .ignore-btn');
    await sleep(800);
    const rules = await session.storageLocalGet('eh_ignore_rules');
    assertEq(rules.eh_ignore_rules.length, 1, 'ignore rule created');
    assertEq(rules.eh_ignore_rules[0].matchOn, 'url', 'network ignore matches url');
    const now = await eh.readErrors(session);
    assertEq(now.length, 0, 'ignored error purged');
    popup2.close();
  }
};
