function summarize(entries) {
  let blocked = 0, gated = 0, degraded = 0, totalCost = 0;
  const byProvider = {};
  for (const e of entries) {
    if (e.blocked) blocked++;
    if (e.gated) gated++;
    if (e.degraded) degraded++;
    totalCost += e.cost || 0;
    if (e.provider) {
      byProvider[e.provider] = byProvider[e.provider] || { calls: 0, cost: 0 };
      byProvider[e.provider].calls += 1;
      byProvider[e.provider].cost += e.cost || 0;
    }
  }
  return { total: entries.length, blocked, gated, degraded, totalCost, byProvider };
}

function printSummary(entries) {
  const s = summarize(entries);
  console.log(`Total: ${s.total}`);
  console.log(`Blocked: ${s.blocked}  Gated: ${s.gated}  Degraded: ${s.degraded}`);
  console.log(`Total cost: $${s.totalCost.toFixed(4)}`);
  for (const [provider, stats] of Object.entries(s.byProvider)) {
    console.log(`  ${provider}: ${stats.calls} calls, $${stats.cost.toFixed(4)}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHtml(entries) {
  const s = summarize(entries);
  const rows = entries.map(e => `<tr><td>${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.tag)}</td><td>${escapeHtml(e.tier)}</td><td>${escapeHtml(e.provider || '-')}</td><td>${e.blocked ? 'blocked' : e.degraded ? 'degraded' : 'ok'}</td><td>${e.gated ? 'yes' : 'no'}</td><td>${e.latencyMs}ms</td><td>$${(e.cost || 0).toFixed(4)}</td></tr>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Model Gateway Dashboard</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:14px}</style>
</head><body>
<h1>Model Gateway Dashboard</h1>
<p>Total: ${s.total} &middot; Blocked: ${s.blocked} &middot; Gated: ${s.gated} &middot; Degraded: ${s.degraded} &middot; Cost: $${s.totalCost.toFixed(4)}</p>
<table><thead><tr><th>Time</th><th>Tag</th><th>Tier</th><th>Provider</th><th>Status</th><th>Gated</th><th>Latency</th><th>Cost</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`;
}

if (require.main === module) {
  const { createTelemetry } = require('./telemetry.js');
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node src/report.js <telemetry.jsonl> [output.html]');
    process.exit(1);
  }
  const entries = createTelemetry(filePath).readAll();
  printSummary(entries);
  if (process.argv[3]) {
    require('node:fs').writeFileSync(process.argv[3], renderHtml(entries));
    console.log(`\nHTML dashboard written to ${process.argv[3]}`);
  }
}

module.exports = { summarize, printSummary, renderHtml };
