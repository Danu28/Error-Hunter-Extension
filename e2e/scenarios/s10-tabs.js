// s10 — tabs: multi-tab dedup, dropdown labels, report Tab line (TESTING.md §10)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's10 tabs',
  run: async (ctx) => {
    const { session } = ctx;
    const pageA = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    // Second tab, same URL. Favicon 404 from this tab lands after load — settle then reset.
    const pageB = await eh.openTestPage(session);
    await sleep(2500);
    await eh.resetErrors(session);

    await eh.clickButton(pageA, 'btnLoadOrders');
    await eh.clickButton(pageB, 'btnLoadOrders');
    const errs = await eh.waitForErrors(session, (e) => e.length >= 2);
    assertEq(errs.length, 2, 'one entry per tab');
    assert(errs[0].tabId !== errs[1].tabId, 'distinct tabIds');
    const tabIds = [...new Set(errs.map((e) => String(e.tabId)))];

    // Dropdown lists both tabs (same URL → colliding labels disambiguated)
    const popup = await eh.openPopup(session, 2);
    const optTexts = await popup.eval(`[...document.getElementById('tabFilter').options].map((o) => o.text)`);
    assertEq(optTexts.length, 3, 'All tabs + 2 tabs');
    assertEq(optTexts[0], 'All tabs', 'first option is All tabs');
    assert(optTexts[1] !== optTexts[2] && /\(tab \d+\)/.test(optTexts[1]), 'colliding labels disambiguated: ' + optTexts.join(' | '));

    // Select one tab → only its error shows
    await popup.eval(`(() => {
      const sel = document.getElementById('tabFilter');
      sel.value = ${JSON.stringify(tabIds[0])};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    assertEq(await popup.eval(`document.querySelectorAll('.error-item').length`), 1, 'selected tab shows one error');

    // Report Tab line reflects the selection
    const report = await popup.eval(`(() => {
      const label = getCurrentTabLabel();
      const txt = generateBugReport([], 'http://127.0.0.1:8080/tests/test-page.html', undefined, () => label);
      return JSON.stringify({ label, txt });
    })()`);
    const rep = JSON.parse(report);
    assert(rep.label, 'current tab label resolved');
    assert(rep.txt.includes('**Tab:** ' + rep.label), 'report has **Tab:** line');

    // All tabs → tab null, both errors again
    await popup.eval(`(() => {
      const sel = document.getElementById('tabFilter');
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    assertEq(await popup.eval(`document.querySelectorAll('.error-item').length`), 2, 'All tabs shows both');
    const tabNull = await popup.eval(`getCurrentTabLabel() === null`);
    assert(tabNull, 'All tabs → tab label null');
    popup.close();
  }
};
