---
title: model-gateway not wired in
date: 2026-08-16
status: decided (NO-GO)
---

# Decision: leave `packages/model-gateway` unwired

Full writeup: `../../../DECISION_RECORD_model-gateway.md` (repo root). This page is the short version.

**Question:** should `packages/model-gateway` + `code/gateway-adapter.js` replace `code/agent.js`/`scheduler.js`/`query.js`/`market-brief.js`'s direct calls to `router.js`/`local.js`/`gemini.js`?

**Decision: NO-GO.**

**Why:** the caller-migration work was built against a stale snapshot of `code/guard.js` and was already deliberately excluded from `master` once (commit `fdc6d98`'s merge), confirmed with Ahmed at the time. Re-verified 2026-08-16: `guard.js`'s real contract still matches what that exclusion assumed, and the actual bugs this architecture would have prevented (gate bypass, kill-switch not checked) were found and fixed directly and more simply instead — see [[api-ask-kill-switch-gating]] for one of them.

**Status:** the package stays fully built and tested (47/47), genuinely useful if this project later needs multi-provider cost budgeting/circuit-breaking at scale — just not wired in now. See [[system-overview]].
