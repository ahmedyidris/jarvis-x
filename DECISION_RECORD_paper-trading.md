# Decision: paper trading, re-opened under enforced limits

**Date:** 2026-09-04 · **Status:** decided (GO, simulation only)
**Reverses:** the delete ruling made earlier the same day

---

## The flip, stated plainly

Trading was ruled out and deleted at roughly 17:00 on 2026-09-04.
`code/paper-trading.js` and `config/trading.json` were removed and
`CONSTITUTION.md` §IV was amended to forbid "trading of any kind, real or
simulated". Roughly an hour later Ahmed asked for a paper-trading plan over six
named instruments, and chose to re-open §IV rather than leave it closed.

This record exists because a constitution that changes twice in an evening
looks like drift unless the reasoning is written down. It is not drift: the
first ruling answered "should the dormant, unwired, untested module stay?" and
the second answers "should a tested one be built on purpose?". Different
questions, and the second is not obviously wrong just because the first was
right — the old module had no test file, no enforced limits, and no caller.

## What changed in the constitution

| | Before the delete | After the delete | Now |
|---|---|---|---|
| §III gated | "Proposing trades (even paper trades)" | *(removed)* | "Proposing a paper trade" |
| §IV forbidden | "Real money trading (testnet only)" | "Trading of any kind, real or simulated" | "Real-money trading of any kind" + instruments outside the six |

The net position is stricter than the original. The original permitted a
"testnet" carve-out with no enforcement anywhere; this one names six permitted
instruments, forbids everything else at the constitutional level, and every
limit is executed rather than described.

## The rule that shapes the module

Ahmed asked for "safe assets: gold, sp500, nasdaq, btc, eth, oil". Half that
list is the volatile end of the market — BTC and ETH routinely move 10–20% in a
day, and WTI settled **negative** in April 2020. Rather than argue the framing,
the sizing math carries it:

**Risk per trade ≤ 0.6% of capital.** Position size is *derived*, never chosen:

```
maxPosition = riskPerTrade / stopLoss
```

| Instrument | Stop | Max position | Risk if stopped |
|---|---|---|---|
| gold | 8% | 7.5% | 0.60% |
| S&P 500 | 8% | 7.5% | 0.60% |
| Nasdaq | 10% | 6.0% | 0.60% |
| oil | 15% | 4.0% | 0.60% |
| BTC | 20% | 3.0% | 0.60% |
| ETH | 20% | 3.0% | 0.60% |

The volatile instruments get *smaller* positions and *wider* stops, because a
tight stop on BTC is hit by noise rather than by being wrong. A 20% stop on a 3%
position loses exactly what an 8% stop on a 7.5% position loses. One constant
produces the whole table; there are no hand-picked caps to argue about.

## Why this module is not the one that was deleted

The deleted module's rules lived in `knowledge/Guidelines.md` under the heading
**"Intended but NOT yet enforced"**, beside the honest warning *"do not treat
them as active protections"*. Stop-loss, position caps and daily-loss limits
were prose. The module had no test file and no caller.

Every one of those limits is now enforced in code and proved by
`code/test-paper-trading.js` — **22 assertions**, fully offline:

- instruments outside the six are refused, and the refusal names what is allowed
- position size derives from the risk budget; every instrument risks the same
- a trade with no written reason is refused
- the daily loss limit blocks new positions, and resets on the next UTC day
- the kill switch blocks both opening and closing
- a proposal built before the book changed is re-validated at open, so a stale
  one cannot slip past a limit that has since been hit
- the journal is append-only, per §IV's prohibition on overwriting audit logs
- `mode` must be `"paper"`; any other value is refused at load

## The structural guarantee

`PaperBook` **takes prices as arguments**. It imports no HTTP client and opens
no sockets. There is no code path from this module to a broker or an exchange —
not one that is disabled or configured off, one that does not exist. That is
also why the test suite is offline, and why it can stay in the default `npm test`
run rather than behind `JX_NET`.

Prices come from the caller, which is expected to use the existing data layer:
all six instruments are already served by `code/providers/` and already routed
by `resolveQuery` (`crypto:btc`, `crypto:eth`, `market:sp500`,
`market:nasdaq100`, `energy:gold`, `energy:crude-oil-wti`).

## What was deliberately not built

No execution, no broker adapter, no backtester, no strategy engine, no
optimizer, no scheduled or unattended trading. `scheduler.js` remains read-only
by design, and nothing here changes that: a paper trade is opened by a human
through a gate, or not at all.

## What would reverse this again

Any of: a limit found to be describable but not enforced; a code path to a
broker appearing in review; or the journal showing trades opened without a
written reason. Any one of those returns this to the deleted state, because the
only thing distinguishing this module from the one that was removed is that its
constraints execute.
