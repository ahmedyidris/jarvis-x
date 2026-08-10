const { loadSchedules, READ_ONLY } = require('./scheduler.js');

const schedules = loadSchedules();
const parsed = Array.isArray(schedules);
console.log(parsed
  ? `ok   schedules.json parsed -> ${schedules.length} entry(ies)`
  : 'FAIL schedules.json did not parse to an array');

// The unattended/gated split is the whole point of this file -- if this
// drifts, a scheduled run could execute a write or shell proposal.
const mustRun = ['list', 'read', 'git_log', 'git_status', 'answer'];
const mustQueue = ['write', 'shell'];

let pass = parsed ? 1 : 0;
const total = 1 + mustRun.length + mustQueue.length;

for (const a of mustRun) {
  const ok = READ_ONLY.has(a);
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} READ_ONLY has "${a}"`);
}
for (const a of mustQueue) {
  const ok = !READ_ONLY.has(a);
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} READ_ONLY excludes "${a}" (must be queued, not run)`);
}

console.log(`\n${pass}/${total} passed`);
process.exitCode = pass === total ? 0 : 1;
