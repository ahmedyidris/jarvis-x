// packages/model-gateway/src/budget.js
function dayKeyOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function createBudget({ rateLimit = { windowMs: 60_000, maxCalls: 30 }, dailyCostCeiling = 5.0, now = () => Date.now() } = {}) {
  const windows = new Map();
  let dayKey = null;
  let dailySpend = 0;

  function rollDay() {
    const key = dayKeyOf(now());
    if (key !== dayKey) {
      dayKey = key;
      dailySpend = 0;
    }
  }

  function pruneAndGetWindow(tag) {
    const ts = now();
    const arr = (windows.get(tag) || []).filter(t => ts - t < rateLimit.windowMs);
    windows.set(tag, arr);
    return arr;
  }

  function checkAndReserve(tag) {
    rollDay();
    if (pruneAndGetWindow(tag).length >= rateLimit.maxCalls) return { ok: false, reason: 'rate' };
    if (dailySpend >= dailyCostCeiling) return { ok: false, reason: 'cost' };
    return { ok: true };
  }

  function recordCall(tag, cost = 0) {
    rollDay();
    const arr = pruneAndGetWindow(tag);
    arr.push(now());
    windows.set(tag, arr);
    dailySpend += cost;
  }

  function snapshot() {
    rollDay();
    const outWindows = {};
    for (const [tag, arr] of windows.entries()) outWindows[tag] = arr.slice();
    return { dayKey, dailySpend, windows: outWindows };
  }

  function load(snap) {
    if (!snap) return;
    dayKey = snap.dayKey ?? null;
    dailySpend = snap.dailySpend ?? 0;
    for (const [tag, arr] of Object.entries(snap.windows || {})) windows.set(tag, arr.slice());
  }

  return { checkAndReserve, recordCall, snapshot, load };
}

module.exports = { createBudget, dayKeyOf };
