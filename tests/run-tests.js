// Error Hunter - Test Runner
// Orchestrates all automated tests and reports results

const path = require('path');

const TESTS_DIR = __dirname;

const testModules = [
  { name: 'Manifest Validation', file: 'test-manifest.js' },
  { name: 'Content Script Logic', file: 'test-content.js' },
  { name: 'Service Worker Logic', file: 'test-service-worker.js' },
  { name: 'Popup Structure & Utilities', file: 'test-popup.js' }
];

async function runAll() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       Error Hunter — Test Suite Runner       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const overall = {
    total: 0,
    passed: 0,
    failed: 0,
    suites: []
  };

  for (const mod of testModules) {
    const modulePath = path.join(TESTS_DIR, mod.file);
    console.log(`━`.repeat(50));
    console.log(`▶ Running: ${mod.name} (${mod.file})`);
    console.log(`━`.repeat(50));

    try {
      const testModule = require(modulePath);
      const result = testModule.runTests();

      overall.total += result.results.length;
      overall.passed += result.results.filter(r => r.passed).length;
      overall.failed += result.results.filter(r => !r.passed).length;
      overall.suites.push({
        name: mod.name,
        ...result
      });
    } catch (err) {
      console.error(`  ✗ Failed to load test module: ${err.message}`);
      overall.failed++;
      overall.suites.push({
        name: mod.name,
        passed: false,
        error: err.message
      });
    }
  }

  // ── Overall Summary ──
  console.log('═'.repeat(50));
  console.log('                OVERALL RESULTS');
  console.log('═'.repeat(50));
  console.log(`  Total test suites : ${testModules.length}`);
  console.log(`  Total tests       : ${overall.total}`);
  console.log(`  Passed            : ${overall.passed}`);
  console.log(`  Failed            : ${overall.failed}`);
  console.log(`  Pass rate         : ${overall.total > 0 ? ((overall.passed / overall.total) * 100).toFixed(1) : 'N/A'}%`);
  console.log('');

  // ── Suite Breakdown ──
  console.log('Suites:');
  for (const suite of overall.suites) {
    if (suite.error) {
      console.log(`  ✗ ${suite.name} — LOAD ERROR: ${suite.error}`);
    } else {
      const suiteFailed = suite.results.filter(r => !r.passed);
      const icon = suiteFailed.length === 0 ? '✓' : '✗';
      console.log(`  ${icon} ${suite.name} — ${suite.passed ? 'All passed' : `${suiteFailed.length} failed`}`);
    }
  }

  console.log('');

  if (overall.failed > 0) {
    console.log('Failed tests detail:');
    console.log('');
    for (const suite of overall.suites) {
      if (suite.results) {
        const failedTests = suite.results.filter(r => !r.passed);
        for (const t of failedTests) {
          console.log(`  ✗ [${suite.name}] ${t.name}`);
          console.log(`     ${t.error}`);
        }
      }
    }
    console.log('');
  }

  console.log(`Finished: ${new Date().toISOString()}`);
  console.log(`Overall: ${overall.failed === 0 ? 'ALL TESTS PASSED ✓' : `${overall.failed} TEST(S) FAILED ✗`}`);
  console.log('');

  return overall.failed === 0;
}

// Run directly
if (require.main === module) {
  runAll().then(passed => {
    process.exit(passed ? 0 : 1);
  }).catch(err => {
    console.error('Runner error:', err);
    process.exit(1);
  });
}

module.exports = { runAll };
