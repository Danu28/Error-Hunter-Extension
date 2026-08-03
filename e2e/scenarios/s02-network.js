// s02 — network capture (TESTING.md §2): all 5 data buttons + broken image
const { assert, assertEq } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's02 network capture',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickDataButtons(page);
    await eh.clickButton(page, 'btnImage404');

    const errs = await eh.waitForErrors(session, (e) => e.length >= 6);

    const byMsg = {};
    for (const e of errs) byMsg[e.message] = e;

    for (const expected of eh.EXPECTED_NETWORK) {
      assert(byMsg[expected], 'missing capture: ' + expected);
    }
    assertEq(errs.length, 6, 'exactly 6 network entries');

    const slow = byMsg['Fetch GET http://127.0.0.1:8080/api/slow-error returned 500'];
    assert(slow.duration >= 1500, 'slow error duration captured (~2000ms), got ' + slow.duration);
    assertEq(slow.status, 500, 'slow error status');

    const xhrPost = byMsg['XHR POST http://127.0.0.1:8080/api/xhr-error returned 500'];
    assert(xhrPost.requestBody && xhrPost.requestBody.includes('test body'), 'xhr post request body captured');

    const config = byMsg['Fetch GET https://this-domain-does-not-exist-12345.com/config failed: Failed to fetch'];
    assertEq(config.status, 0, 'network failure status 0');

    const resource = byMsg['Resource img http://127.0.0.1:8080/api/not-found returned 404'];
    assertEq(resource.status, 404, 'resource 404');
  }
};
