// s13 — 500-error cap: oldest dropped beyond 500, newest kept (TESTING.md §13)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's13 500-cap eviction',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);
    await eh.resetIgnoreState(session);

    // Seed exactly 500 synthetic entries via SW, oldest timestamp first.
    const sw = await session.sw();
    await sw.eval(`(async () => {
      const seed = [];
      const base = Date.now() - 100000;
      for (let i = 0; i < 500; i++) {
        seed.push({
          id: 'seed-' + i,
          timestamp: base + i,
          type: 'console', level: 'error',
          message: 'Seed error #' + i,
          url: 'seed://' + i,
          count: 1, tabId: null
        });
      }
      await chrome.storage.session.set({ error_hunter_errors: seed });
      return seed.length;
    })()`);
    await sleep(300);
    assertEq((await eh.readErrors(session)).length, 500, 'seeded 500');

    // One real error over the cap → 501 → oldest (seed-0) evicted
    await eh.clickButton(page, 'btnConsoleError');
    await eh.waitForErrors(session, (e) => e.length === 500);
    const errs = await eh.readErrors(session);
    assertEq(errs.length, 500, 'capped back to 500');
    assert(errs.every((e) => e.id !== 'seed-0'), 'oldest evicted');
    assert(errs.some((e) => e.id === 'seed-1'), 'second-oldest kept');
    assert(errs.some((e) => e.message.includes('Manual console.error')), 'newest real error kept');
    assert(errs.some((e) => e.id === 'seed-499'), 'most recent seed kept');
  }
};
