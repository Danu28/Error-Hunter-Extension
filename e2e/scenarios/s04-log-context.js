// s04 — log ring buffer (TESTING.md §4): log/info/debug captured only as context of a later error
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's04 log ring buffer',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    // log/info/debug do NOT create entries on their own
    await eh.clickButton(page, 'btnConsoleLog');
    await eh.clickButton(page, 'btnConsoleInfo');
    await eh.clickButton(page, 'btnConsoleDebug');
    await sleep(1500);
    let errs = await eh.readErrors(session);
    assertEq(errs.length, 0, 'log/info/debug produce no entries alone');

    // A subsequent real error carries them in logContext
    await eh.clickButton(page, 'btnConsoleError');
    errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'one console.error entry');
    const logCtx = (errs[0].logContext || []).map((l) => l.message).join('\n');
    assert(logCtx.includes('Dashboard state:'), 'console.log in logContext');
    assert(logCtx.includes('Dashboard info:'), 'console.info in logContext');
    assert(logCtx.includes('Dashboard debug:'), 'console.debug in logContext');
  }
};
