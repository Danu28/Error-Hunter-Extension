// s05 — user action capture (TESTING.md §5)
const { assert, assertEq, sleep } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's05 user action capture',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    // Drive the form: change select, tick checkbox, pick Pro radio, type notes, Save
    await page.eval(`(() => {
      const s = document.getElementById('roleSelect'); s.value = 'editor'; s.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('notifyCheck').click();
      document.getElementById('planPro').click();
      const n = document.getElementById('notesText'); n.value = 'typed notes here'; n.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('btnSaveForm').click();
      return true;
    })()`);
    await sleep(800);

    await eh.clickButton(page, 'btnConsoleError');
    const errs = await eh.waitForErrors(session, (e) => e.length >= 1);
    assertEq(errs.length, 1, 'one console.error entry');
    const actions = errs[0].userActions || [];
    assert(actions.length > 0, 'error has userActions');

    const desc = actions.map((a) => a.actionType + ':' + (a.value || a.text || a.name || a.id || a.tag)).join(' | ');
    assert(actions.some((a) => a.value === 'editor'), 'select change captured (editor)');
    assert(actions.some((a) => a.value === 'typed notes here'), 'textarea change captured');
    assert(actions.some((a) => a.actionType === 'click' && a.id === 'btnSaveForm'), 'Save click captured');
    assert(actions.some((a) => a.id === 'planPro') || actions.some((a) => a.id === 'notifyCheck'), 'checkbox/radio captured');
  }
};
