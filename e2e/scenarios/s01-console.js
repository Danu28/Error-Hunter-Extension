// s01 — console capture (TESTING.md §1)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's01 console capture',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickButton(page, 'btnConsoleError');
    await eh.clickButton(page, 'btnConsoleWarn');
    await eh.clickButton(page, 'btnThrow');
    await eh.clickButton(page, 'btnReject');

    const errs = await eh.waitForErrors(session, (e) => e.length >= 4);
    assertEq(errs.length, 4, 'one entry per trigger');

    const byMsg = {};
    for (const e of errs) byMsg[e.message] = e;

    assert(byMsg['Manual console.error triggered from dashboard'], 'console.error captured');
    assertEq(byMsg['Manual console.error triggered from dashboard'].type, 'console', 'console.error type');
    assert(byMsg['(warning) Manual console.warn — this is a warning'], 'console.warn captured');
    assertEq(byMsg['(warning) Manual console.warn — this is a warning'].level, 'warn', 'warn level');
    const thrown = errs.find((e) => e.message === 'Uncaught Error: Manual exception from dashboard button click');
    assert(thrown, 'throw captured');
    assertEq(thrown.type, 'exception', 'throw type');
    const rejected = errs.find((e) => e.message === 'Manual promise rejection from dashboard');
    assert(rejected, 'rejection captured');
    assertEq(rejected.type, 'unhandledrejection', 'rejection type');
  }
};
