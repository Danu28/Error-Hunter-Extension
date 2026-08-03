// s09 — sort, expand, count, dedup badge (TESTING.md §9)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's09 sort/expand/count/dedup',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickButton(page, 'btnConsoleError');
    await eh.clickButton(page, 'btnConsoleWarn');
    await eh.clickButton(page, 'btnLoadUsers');
    await eh.waitForErrors(session, (e) => e.length >= 3);

    // Header count + toolbar badge
    const popup = await eh.openPopup(session, 3);
    const countText = await popup.eval(`document.getElementById('errorCount').textContent`);
    assert(countText.startsWith('3 errors'), 'header count: ' + countText);
    const sw = await session.sw();
    const badge = await sw.eval(`chrome.action.getBadgeText({}).then(t => t)`);
    assertEq(badge, '3', 'toolbar badge = 3');

    // Default newest-first
    const first = await popup.eval(`document.querySelector('.error-item .error-message').textContent`);
    assert(first.includes('server-error returned 500'), 'newest first: ' + first);

    // Toggle sort → oldest-first
    await popup.click('#sortToggle');
    await sleep(300);
    const firstOldest = await popup.eval(`document.querySelector('.error-item .error-message').textContent`);
    assert(firstOldest.includes('Manual console.error'), 'oldest first: ' + firstOldest);
    const sortLabel = await popup.eval(`document.getElementById('sortToggle').textContent`);
    assertEq(sortLabel, '↑ Oldest', 'sort toggle label');

    // Expand all → collapse all
    await popup.click('#expandToggle');
    await sleep(300);
    const allExpanded = await popup.eval(`[...document.querySelectorAll('.error-item')].every((el) => el.classList.contains('expanded'))`);
    assert(allExpanded, 'all expanded');
    const expandLabel = await popup.eval(`document.getElementById('expandToggle').textContent`);
    assertEq(expandLabel, 'Collapse all', 'expand toggle label');
    await popup.click('#expandToggle');
    await sleep(300);
    const anyExpanded = await popup.eval(`[...document.querySelectorAll('.error-item')].some((el) => el.classList.contains('expanded'))`);
    assert(!anyExpanded, 'all collapsed');
    popup.close();

    // Dedup: repeat Load Users → count badge [×2], still 3 rows, badge still 3
    await eh.clickButton(page, 'btnLoadUsers');
    await eh.waitForErrors(session, (e) => e.some((x) => x.count >= 2));
    const errs = await eh.readErrors(session);
    assertEq(errs.length, 3, 'still 3 rows after dedup');
    const popup2 = await eh.openPopup(session, 3);
    const netItem = await popup2.eval(`(() => {
      const items = [...document.querySelectorAll('.error-item')];
      const it = items.find((el) => el.textContent.includes('server-error returned 500'));
      return it ? it.textContent : '';
    })()`);
    assert(netItem.includes('[×2]'), 'dedup count badge [×2]');
    const badge2 = await session.sw().then((s) => s.eval(`chrome.action.getBadgeText({}).then(t => t)`));
    assertEq(badge2, '3', 'badge unchanged after dedup');
    popup2.close();
  }
};
