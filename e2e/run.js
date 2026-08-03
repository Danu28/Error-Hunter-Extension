// e2e/run.js — E2E runner for Error Hunter.
// Usage:
//   node e2e/run.js                    # headless, all scenarios
//   node e2e/run.js --windowed         # visible browser
//   node e2e/run.js --only s02         # run one scenario
//   node e2e/run.js --chrome <path>    # explicit Chrome for Testing binary

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { launch, run } = require('./harness');
const { resolveChromePath } = require('./download-cfth');

const ROOT = path.join(__dirname, '..');
const PORT = 9355;

const args = process.argv.slice(2);
const opts = {
  windowed: args.includes('--windowed'),
  only: args.includes('--only') ? args[args.indexOf('--only') + 1] : null,
  chrome: args.includes('--chrome') ? args[args.indexOf('--chrome') + 1] : null,
  keep: args.includes('--keep')
};

(async () => {
  const chrome = await resolveChromePath(opts.chrome);
  const server = spawn('node', ['serve-test.js'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));

  const session = await launch({
    chrome,
    extension: ROOT,
    port: PORT,
    headless: !opts.windowed
  });
  console.log('Chrome:', chrome);
  console.log('Mode  :', opts.windowed ? 'windowed' : 'headless');
  console.log('');

  const scenarios = fs.readdirSync(path.join(__dirname, 'scenarios'))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => require(path.join(__dirname, 'scenarios', f)));

  const ctx = { session };
  const passed = await run(scenarios, ctx, {
    only: opts.only,
    onDone: (results) => {
      const failed = results.filter((r) => !r.passed);
      if (failed.length && !opts.windowed && !opts.keep) {
        console.log('\nTo debug the failures run:  node e2e/run.js --windowed --only <name>');
      }
      if (failed.length) {
        console.log('\nSession logs (last 40):');
        session.logs.slice(-40).forEach((l) => console.log('  ' + l));
      }
    }
  });

  server.kill();
  if (!opts.keep) await session.close();
  else console.log('(--keep) browser left open on port', PORT);
  process.exit(passed ? 0 : 1);
})().catch((e) => {
  console.error('RUNNER FAILED:', e.stack || e.message);
  process.exit(1);
});
