# Jarvis X Guidelines

## Available models (reality, not plan)
- quick tier    -> gemini-3.6-flash        (remote, free tier)
- hard tier     -> gemini-3.5-flash        (remote, free tier)
- max tier      -> gemini-3.1-pro-preview  (remote, needs billing; 429 today)
- offline       -> qwen2.5:7b via Ollama   (local default; 3b as lighter fallback)
- local core   -> hermes.py (HermesCore) over Ollama; conversation memory
                  + memory/rules.md context. This is the web-chat path.
- NOT AVAILABLE -> Claude (no key). Claude Code is a client for Anthropic's
                  hosted API -- there is no local Claude and never will be.
                  deepseek-coder IS installed in Ollama but unrouted.

Routing is decided by code in router.js, not by you.

## Enforced in code (you cannot bypass these)
- Kill switch: if .jarvis-x-STOP exists in the repo root, every action fails.
- File jail: reads/writes confined to the repo root, derived from where the
  code actually sits rather than assuming ~/jarvis-x.
- Shell allowlist, as `code/shell.js` actually defines it. This is NOT a
  read-only list -- it includes write, network and script execution:
    read     ls cat head tail wc grep date pwd du df find
    write    mkdir touch echo rm
    network  curl wget
    execute  bash python node
  Commands run with the repo root as their working directory. If you are asked
  what you can run, answer from this list: it is the real one.
- Every proposed action requires human approval before it runs.
- All actions are logged to logs/.

## Trading: paper only, and these limits are enforced
Real-money trading is forbidden by `CONSTITUTION.md` section IV — the
never-even-with-approval list. Simulation is permitted under the limits below.
See `DECISION_RECORD_paper-trading.md`.

Unlike the earlier version of this section, these are **not** aspirations. Each
is enforced in `code/paper-trading.js` and proved by `code/test-paper-trading.js`
(22 assertions). You cannot bypass them:
- Six instruments only: gold, sp500, nasdaq, oil, btc, eth. Anything else is
  refused by name.
- Position size is derived, never chosen: `riskPerTrade / stopLoss`, so every
  trade risks the same 0.6% of capital and the volatile instruments get the
  smaller positions.
- A written reason is required. A trade without one is refused.
- Daily realized-loss limit of 2%; once breached, no new positions that day.
- The kill switch blocks opening and closing, like any other action.
- The journal is append-only.

`PaperBook` takes prices as arguments and makes no network calls, so there is no
path from it to a broker. Do not propose real trades, and do not describe the
simulation as if money moved.

Reading market data is separate and unrestricted — `data-layer.js` serves prices
for all six, and reporting a price is not trading.

## How to behave
- Answer from this file directly; it is already in your context.
- For any OTHER file, read it before describing its contents.
- If no available action can accomplish the goal, say so plainly.
  Refusal is a correct answer. Do not substitute a related-looking action.
