// s03 — success/negative tests (TESTING.md §3): 200s must NOT be captured
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's03 negatives (200s not captured)',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickButton(page, 'btnOkData');
    await eh.clickButton(page, 'btnBigResponse');
    await sleep(3000);

    const errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'OK Request + Big Response must not be captured');

    // Positive control: a real error still captures (proves the harness isn't false-negative)
    await eh.clickButton(page, 'btnLoadUsers');
    const errs2 = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs2.length, 1, 'positive control captures exactly one');
    assert(errs2[0].message.includes('server-error returned 500'), 'positive control message');
  }
};
