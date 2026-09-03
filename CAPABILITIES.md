# Jarvis X — Capability Integration Plan

**Date:** 2026-09-03 · **Companion to:** `MASTER_PLAN_v3.md`, `QUANTUM_FEASIBILITY.md`
**Goal as given:** merge everything buildable into one Jarvis, running on ChromeOS,
reachable cross-platform, with the quantum track included.

Same method as the rest of this repo: measured where measurable, and labelled
unverified where not.

---

## 1. The principle: capabilities, not apps

"One Jarvis" and "install seven repos" pull in opposite directions. Four of the
seven tools in the MARKUP guide are **whole applications** with their own UI,
database and auth. Running them beside Jarvis gives you seven dashboards, not
one assistant.

So the rule applied below: **take the capability, not the container.** Where a
tool's job is small and well-defined, implement it against this repo's existing
conventions (`guard.js` kill switch, `logs/*.jsonl` audit, config reread per
tick). Where the tool *is* the product, keep it separate or skip it.

That is a judgment, not a measurement, and it is reversible — §3 records the
upgrade path for each.

---

## 2. The seven, triaged for Jarvis (not for resale)

The MARKUP guide rates these as services to sell clients. That is a different
question from what belongs inside Jarvis. Verified licences and star counts are
in §6.

| Tool | Verdict for Jarvis | Why |
|---|---|---|
| `dgtlmoon/changedetection.io` | **Capability adopted** — built, §3.1 | Its job (watch a page, report the diff) is ~200 lines against the data-layer patterns already here. Its *app* is a full Flask UI with its own scheduler — redundant beside `scheduler.js`. |
| `PaddlePaddle/PaddleOCR` | **Deferred, measured** — §3.2 | Genuinely useful (documents → structured data) and the least legally exposed. But 1.4 GB installed, and runtime cost is unmeasured here. Needs a decision on his disk. |
| `D4Vinci/Scrapling` | **Rejected for the request path** | Adaptive scraping would fix brittle providers, but it advertises bypassing anti-bot protections (Cloudflare Turnstile). BSD-3 governs the *code*; it says nothing about a target's terms of service, and nothing about GDPR/CCPA once a lead list contains named people. Not a dependency to put behind an assistant that acts unattended. |
| `hugohe3/ppt-master` | **Rejected** | Jarvis has no deck-generation need. A capability with no caller is the `packages/model-gateway` mistake again — 47/47 tests, zero callers. |
| `every-app/open-seo` | **Rejected** | Requires the operator's own **DataForSEO API keys**: it is a front end to a paid API, not a replacement for one. Adds a metered external cost to a system whose whole design goal is $0 running cost. |
| `trycompai/crm` | **Rejected** | An entire CRM application (Bun + Next.js + NestJS + Prisma + Postgres). Not a capability; a second product. |
| `JCodesMore/ai-website-cloner-template` | **Rejected** | Website scaffolding. No relationship to a voice assistant. |

**One adopted, one deferred pending a disk decision, five rejected.** Rejecting
five is the point: the guide's list was assembled for resale value, and most of
it has no business inside this codebase.

---

## 3. What is built, and what it cost

### 3.1 Watcher — built, 17 tests passing

`code/watcher.js` + `code/test-watcher.js` + `watchers.json`.

Watches URLs and reports what changed. Design decisions worth knowing:

- **No new dependencies.** Uses `fetch` and `crypto` from the platform.
- **Script and style bodies are stripped before hashing.** A page with an
  analytics blob that changes per load would otherwise report a change on
  every single check. There is a test that asserts exactly this.
- **`include` is a regex** narrowing the watch to the region that matters, so a
  rotating sidebar does not read as a price change.
- **A failed fetch is an `error`, not a `change`,** and the prior fingerprint
  survives it. Reporting a rate-limit as a change would cry wolf until the
  digest became unreadable.
- **It calls `isStopped()` itself.** Callers are not trusted to — the same
  reasoning `shell.js` documents for its own kill-switch check.
- **The fetcher is injectable, so all 17 tests are offline.**
  `test-agent-data-integration.js` fails in CI because it reaches CoinGecko for
  real; adding a second test with that flaw would be a step backwards.

```bash
node code/watcher.js          # check every enabled watcher, print a digest
```

State in `logs/watch-state.json`, changes appended to `logs/watch-events.jsonl`.

**Upgrade path:** if the full web UI, browser-rendered JS pages, or visual diffs
are ever wanted, run real changedetection.io in Docker (Apache 2.0) and point
Jarvis at its API. Nothing here forecloses that.

### 3.2 OCR — measured, not adopted

| Measurement | Result |
|---|---|
| `pip install paddleocr` | **Does not work alone** |
| Footprint, `paddleocr` only | 607 MB |
| Footprint with `paddlepaddle` | **1.4 GB** |
| Runtime RAM | **UNMEASURED** |
| Latency per page | **UNMEASURED** |
| Accuracy | **UNMEASURED** |

Two findings:

**The MARKUP guide's install line is incomplete.** `pip install paddleocr`
installs the wrapper but not `paddlepaddle`, the actual inference engine, so it
raises `ModuleNotFoundError: No module named 'paddle'` on first use. The guide
does warn that "every one of these has an install that fights you the first
time" — this is that fight, and it costs another ~800 MB.

**Runtime cost could not be measured here, and is not estimated.** PaddleOCR
downloads model weights on first use, and this build environment's network
policy denies all four hosts it tries (`huggingface.co`,
`aistudio.baidu.com`, `modelscope.cn`,
`paddle-model-ecology.bj.bcebos.com` — confirmed in the proxy's own failure
log). So RAM, latency and accuracy are genuinely unknown.

**The decision this needs:** 1.4 GB of dependencies plus model weights, on a
14 GB machine already holding ~8.1 GB of Ollama models. That is a disk call
only Ahmed can make. If the answer is yes, the next step is `pip install
paddleocr paddlepaddle` on the Chromebook and a real benchmark there.

**Cheaper alternative if the answer is no:** `tesseract-ocr` is ~30 MB via apt
and adequate for clean typed documents — worse on handwriting and layout, which
is where PaddleOCR earns its size.

---

## 4. Cross-platform access, without opening a port

The requirement is reaching Jarvis from a phone, Mac or Windows machine. The
rejected answer is still rejected: `uvicorn --host 0.0.0.0` exposes an
unauthenticated assistant — with shell and file-write actions — to every device
on the network, collides with the port the live deployment already holds, and
contradicts `app.py:839`'s deliberate `host="127.0.0.1"`.

**The design principle that solves it:** the app keeps binding `127.0.0.1`
forever. A tunnel daemon makes an **outbound** connection and proxies inward.
No inbound port ever opens on the Chromebook. Two ways to do that:

| | Tailscale | Cloudflare Tunnel + Access |
|---|---|---|
| Public surface | **None.** Private mesh only | An authenticated HTTPS endpoint |
| Client needed | Yes, on every device | **No — any browser** |
| Cost | Free (personal) | Free tier |
| Auth | Device identity | Google/email SSO via Access |
| Mechanism | `tailscale serve` → `127.0.0.1:8000` | `cloudflared --url http://127.0.0.1:8000` |

**Recommended: Tailscale**, because it puts nothing on the public internet at
all. Cloudflare Access is the better answer only if browsing from a device you
cannot install software on.

### The Crostini warning — read this before installing Tailscale

> **Installing Tailscale on Crostini in the default mode can break your Linux
> container permanently.** Tailscale creates a `tun` device; when
> `tailscale0` is present during Crostini's `garcon` netlink enumeration,
> garcon null-dereferences and **takes the `penguin` container down with it —
> on every subsequent startup**, not just once. This is
> [tailscale/tailscale#12090](https://github.com/tailscale/tailscale/issues/12090),
> with a standing request to default Crostini to userspace mode
> ([#19488](https://github.com/tailscale/tailscale/issues/19488)).
>
> **The fix, applied before starting the daemon:** put
> `FLAGS="--tun=userspace-networking"` in `/etc/default/tailscaled`. That keeps
> `tailscale0` out of the kernel entirely.
>
> Also expect **relayed (DERP) rather than direct** connections between
> ChromeOS and Crostini, due to a known STUN issue
> ([#432](https://github.com/tailscale/tailscale/issues/432)) — it works, it is
> just slower than a direct path.

`sentinel/`, `automation/` and the Ollama port stay off the tunnel regardless.
Ollama has no auth; it should never be reachable from anything but loopback.

**Status: designed, not installed.** Every step above runs on the Chromebook,
which this session cannot reach. The flag syntax should be checked against
current Tailscale docs before use — it is quoted from the issue threads, not
from a run.

---

## 5. Quantum's actual role — and one thing it cannot do

Already built and committed in `quantum/`; see `QUANTUM_FEASIBILITY.md`.
Settled: local no-API simulation works (8 qubits, 9 ms, offline, free); the
request-path ceiling is 16 qubits; the `LLM → circuit → tone` pattern is
`cos(θ)` to 1.45e-16; and a properly trainable VQC still loses to the keyword
matcher because the binding constraint is 64 training queries.

**On "use quantum to build":** quantum computing cannot generate software.
There is no quantum compiler, code model, or build tool — a quantum circuit
computes a numerical function over amplitudes; it does not write, refactor or
reason about programs. Nothing on any roadmap changes that, and no amount of
configuration here would produce it. What the module *does* do is honest and
narrow: classify, score and route, measurably.

Jarvis is built with Claude Code, Node and Python. Quantum is one experimental
capability inside it, gated on the four promotion tests in
`QUANTUM_FEASIBILITY.md` §7.

---

## 6. Verified claims from the MARKUP guide

Checked because the guide's own instruction is to check before quoting, and
because its licence claims are what make the business model legal. **All seven
are accurate.**

| Repo | Guide (31 Aug) | Verified 3 Sep | Licence |
|---|---|---|---|
| `trycompai/crm` | 9,172 · MIT | 9.6k | MIT — read in LICENSE |
| `every-app/open-seo` | 15,981 · MIT | 16.6k | MIT (badge) |
| `dgtlmoon/changedetection.io` | 33,434 · Apache 2.0 | 33.5k | Apache-2.0 (badge) |
| `JCodesMore/ai-website-cloner-template` | 33,541 · MIT | 33.7k | MIT (badge) |
| `hugohe3/ppt-master` | 51,002 · MIT | 51.8k | MIT (badge) |
| `D4Vinci/Scrapling` | 77,674 · BSD 3-Clause | 78.2k | BSD-3-Clause — read in LICENSE |
| `PaddlePaddle/PaddleOCR` | 88,586 · Apache 2.0 | 88.8k | Apache 2.0 — read in LICENSE |

For the three highest-priced builds the actual LICENSE file was opened rather
than the auto-detected badge trusted, which is what the guide advises.

**Two gaps the guide leaves**, both of which cost money rather than being
wrong:

1. **`open-seo` needs the operator's own DataForSEO API keys.** It is pitched
   as doing "the same job the big subscription tools do" at $2,500/month, with
   no mention of the metered cost passed through. That is the number that turns
   a retainer unprofitable.
2. **A software licence is not permission to operate.** The guide is thorough on
   licence risk and silent on operating risk. For Scrapling — its second-priciest
   build — terms of service and data-protection law, not BSD-3, are the binding
   constraints.

---

## 7. Where this stands

| Item | Status |
|---|---|
| Watcher capability | **Built.** 17 offline tests passing |
| `watchers.json` config | **Built.** Reread per run, honours `enabled` |
| Quantum track | **Built.** 31 checks, gated out of the request path |
| Repo/licence verification | **Done.** All 7 accurate |
| OCR footprint | **Measured.** 1.4 GB; engine omitted from the guide's install |
| OCR runtime cost | **Blocked.** Network policy denies the model hosts |
| Cross-platform access | **Designed, not installed.** Needs the Chromebook |
| Scrapling / SEO / CRM / PPT / cloner | **Rejected,** reasons in §2 |

### Next, in order

1. **Rule on OCR** — 1.4 GB plus weights on a 14 GB box, yes or no? If yes,
   `pip install paddleocr paddlepaddle` on the Chromebook and benchmark there.
2. **Install Tailscale in userspace mode** (§4) — and read the Crostini warning
   first, because the default mode can cost you the container.
3. **Point the watcher at something you care about** — edit `watchers.json`,
   run `node code/watcher.js`, then add it to `schedules.json` for a digest.
4. The two rulings still open from `MASTER_PLAN_v3.md` §3: paper trading, and
   `JX_NET`.

---

*Rejections here are reversible and each records its upgrade path. Nothing was
deleted; nothing on the serving path gained a dependency.*
