// s11 — exports: HTML + JSON downloads, JSON schema {tab, errors} (TESTING.md §11)
const { assert, assertEq } = require('../harness');
const eh = require('../error-hunter');

module.exports = {
  name: 's11 exports',
  run: async (ctx) => {
    const { session } = ctx;
    const page = await eh.preparePage(session);

    await eh.clickButton(page, 'btnConsoleError');
    await eh.clickButton(page, 'btnLoadUsers');
    await eh.waitForErrors(session, (e) => e.length >= 2);

    // HTML report download
    const popup = await eh.openPopup(session, 2);
    await popup.click('#btnExport');
    const dl1 = await session.nextDownload(10000);
    assert(dl1, 'HTML export downloaded');
    assert(dl1.endsWith('.html'), 'HTML filename: ' + dl1);
    const html = await session.readDownloaded(dl1);
    assert(html.includes('Error Hunter Report'), 'HTML report header');
    assert(html.includes('Manual console.error'), 'HTML has console entry');
    assert(html.includes('server-error returned 500'), 'HTML has network entry');

    // JSON download — schema {tab, errors}
    await popup.click('#btnExportJson');
    const dl2 = await session.nextDownload(10000);
    assert(dl2, 'JSON export downloaded');
    assert(dl2.endsWith('.json'), 'JSON filename: ' + dl2);
    const json = JSON.parse(await session.readDownloaded(dl2));
    assertEq(json.tab, null, 'JSON tab null (All tabs)');
    assertEq(json.errors.length, 2, 'JSON errors count');
    assert(json.errors[0].message && json.errors[0].type, 'JSON error shape');
    popup.close();
  }
};
