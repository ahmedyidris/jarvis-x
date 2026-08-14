const path = require('node:path');
const fs = require('node:fs');
const { Gateway } = require('../src/gateway.js');
const { createTierPolicy } = require('../src/tier-policy.js');
const { createBreaker } = require('../src/breaker.js');
const { createBudget } = require('../src/budget.js');
const { createStore } = require('../src/store.js');
const { createTelemetry } = require('../src/telemetry.js');
const { createMockProvider } = require('./mock-providers.js');
const { printSummary, renderHtml } = require('../src/report.js');

const OUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });
const dbPath = path.join(OUT_DIR, 'demo-state.db');
const telemetryPath = path.join(OUT_DIR, 'demo-telemetry.jsonl');
[dbPath, telemetryPath].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });

const gateway = new Gateway({
  tierPolicy: createTierPolicy({
    'quick-tier': { chain: ['fast-reliable'], gate: false },
    'careful-tier': { chain: ['slow-flaky', 'fast-reliable'], gate: true },
  }),
  breaker: createBreaker({ failureThreshold: 2, cooldownMs: 2000 }),
  budget: createBudget({ rateLimit: { windowMs: 10_000, maxCalls: 100 }, dailyCostCeiling: 100 }),
  store: createStore(dbPath),
  telemetry: createTelemetry(telemetryPath),
  providers: new Map([
    ['fast-reliable', createMockProvider({ name: 'fast-reliable', latencyMs: 20, cost: 0.0005 })],
    ['slow-flaky', createMockProvider({ name: 'slow-flaky', latencyMs: 80, failureRate: 0.3, cost: 0.002 })],
  ]),
});

async function main() {
  console.log('Running synthetic traffic (20 calls, quick + careful tiers mixed)...');
  for (let i = 0; i < 20; i++) {
    const tier = i % 3 === 0 ? 'careful-tier' : 'quick-tier';
    try {
      await gateway.route(`synthetic request #${i}`, tier, { tag: i % 2 === 0 ? 'voice' : 'scheduler' });
    } catch (e) {
      console.log(`  call #${i} exhausted: ${e.message}`);
    }
  }

  console.log('\nInducing a mid-run failure: forcing slow-flaky to always fail for 5 calls...');
  gateway.providers.set('slow-flaky', createMockProvider({ name: 'slow-flaky', forceFailure: true }));
  for (let i = 20; i < 25; i++) {
    try {
      await gateway.route(`synthetic request #${i}`, 'careful-tier', { tag: 'agent' });
    } catch (e) {
      console.log(`  call #${i} exhausted: ${e.message}`);
    }
  }

  const { createTelemetry: reopenTelemetry } = require('../src/telemetry.js');
  const entries = reopenTelemetry(telemetryPath).readAll();
  console.log('\n=== Summary ===');
  printSummary(entries);

  const htmlPath = path.join(OUT_DIR, 'dashboard.html');
  fs.writeFileSync(htmlPath, renderHtml(entries));
  console.log(`\nDashboard written to ${htmlPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
