# Model Gateway

A standalone, dependency-light package that owns exactly one job: given an
already-classified "tier" and a caller tag, route a call through an ordered
fallback chain of providers, enforce per-tag rate limits and a shared daily
cost ceiling, trip a circuit breaker on repeated provider failures, and
record every outcome to an append-only audit log.

It does **not** decide what a prompt is about, run agent logic, or execute
side effects — see [the design spec](../../docs/superpowers/specs/2026-08-12-model-gateway-design.md)
for the full scope boundary.

## Install

```bash
npm install
```

## Quick start

```js
const { Gateway } = require('./src/gateway.js');
const { createTierPolicy } = require('./src/tier-policy.js');
const { createBreaker } = require('./src/breaker.js');
const { createBudget } = require('./src/budget.js');
const { createStore } = require('./src/store.js');
const { createTelemetry } = require('./src/telemetry.js');

const gateway = new Gateway({
  tierPolicy: createTierPolicy({ quick: { chain: ['flash'], gate: false } }),
  breaker: createBreaker(),
  budget: createBudget(),
  store: createStore('./gateway-state.db'),
  telemetry: createTelemetry('./gateway-telemetry.jsonl'),
  providers: new Map([['flash', { call: async (input) => ({ text: await myFlashCall(input), cost: 0.0001 }) }]]),
});

const result = await gateway.route('summarize this', 'quick', { tag: 'my-app' });
```

## Demo

```bash
npm run demo
```

Runs 20 calls of synthetic traffic across two mock providers, induces a
mid-run failure, and writes `demo/output/dashboard.html`.

## Tests

```bash
npm test
```

## Design decisions

See [the design spec](../../docs/superpowers/specs/2026-08-12-model-gateway-design.md)
and [the implementation plan](../../docs/superpowers/plans/2026-08-12-model-gateway-plan.md).
