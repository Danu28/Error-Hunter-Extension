// s08 — popup filters & search (TESTING.md §8)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's08 popup filters & search',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickButton(page, 'btnConsoleError'); // console
    await eh.clickButton(page, 'btnConsoleWarn');  // warn
    await eh.clickButton(page, 'btnLoadUsers');    // network
    await eh.waitForErrors(session, (e) => e.length >= 3);

    const popup = await eh.openPopup(session, 3);
    const count = (f) => popup.eval(`(() => {
      document.querySelector('.filter-btn[data-filter="${f}"]').click();
      return document.querySelectorAll('.error-item').length;
    })()`);

    assertEq(await count('all'), 3, 'All filter: 3');
    assertEq(await count('console'), 2, 'Console filter: 2 (error + warn)');
    assertEq(await count('warning'), 1, 'Warning filter: 1');
    assertEq(await count('network'), 1, 'Network filter: 1');

    // Search narrows the visible list
    await popup.eval(`(() => {
      const inp = document.getElementById('searchInput');
      inp.value = 'server-error';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    assertEq(await popup.eval(`document.querySelectorAll('.error-item').length`), 1, 'search narrows to network');

    // Clear search → restore under the current filter (still Network)
    await popup.eval(`(() => {
      const inp = document.getElementById('searchInput');
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    assertEq(await count('all'), 3, 'clear search + All restores 3');
    popup.close();
  }
};
