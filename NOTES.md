# Jarvis X — Build Notes (as of 2026-08-11)

Written so this project explains itself without needing any chat history.
Run `./scripts/status.sh` for live state; this file is the *why*.

---

## Where things stand

- **Milestones:** 22/24 (91%) per `scripts/status.sh`
- **Agent accuracy:** 31 graded proposals, 77% correct (`./scripts/score.sh`)
- **Checks:** 49/49 passing, including `--net` (live Gemini + local model)
- **Models installed:** `qwen2.5:7b` (local default), `qwen2.5:3b` (lighter fallback)
- **Backups:** `cd ~ && tar czf jarvis-x-$(date +%F).tar.gz jarvis-x/` then
  `cp ~/jarvis-x-$(date +%F).tar.gz /mnt/chromeos/MyFiles/Downloads/`

Deliberately **not** built: `paper.js`, `selfdebug.js`. See "Deferred" below.

---

## Durable rules (do not violate without deciding to)

1. Everything touching filesystem / network / money goes through `guard()`.
2. `guard.js`, `validate.js`, `Guidelines.md`, `memory/rules.md` are OFF-LIMITS
   to self-modification and to Claude Code (deny rules in `~/.claude/settings.json`).
3. Paper trading only. No component places real trades.
4. **Unattended means read-only.** `scheduler.js` may only execute
   list/read/git_log/git_status/answer. write/shell go to `logs/queue.jsonl`
   and wait for human review. Verified empirically, not just described.
5. A degraded backend must never skip the gate. `router.js` decides gating by
   *level*, never by which model actually answered.
6. Memory is split: `memory/rules.md` is human-written and authoritative;
   `memory/observed.jsonl` is agent-written and injected as UNTRUSTED evidence.
   The agent must not be able to author its own future instructions.

---

## Architecture

| file | role |
|---|---|
| `guard.js` | kill switch (`~/.jarvis-x/STOP`) + action logging. All actions route here. |
| `exec.js` | jailed file ops, confined to `~/jarvis-x/` via `safePath()` |
| `shell.js` | allowlisted shell (`spawnSync`, `shell:false`), fixed-form git helpers |
| `validate.js` | structural rejection of bad proposals BEFORE the human gate |
| `lib.js` | shared helpers: `reEscape`, `parseJSONLoose`, `execute`, `confirm`, `yes` |
| `local.js` | Ollama inference |
| `gemini.js` | remote tiers + `askFallback` |
| `router.js` | quick/hard/consequential → tier chains, gating by level |
| `memory.js` | two-tier memory (rules vs observations) |
| `agent.js` | single-action proposal loop, every action gated |
| `planner.js` | multi-step plans as hypotheses; each step re-proposed and re-gated |
| `scheduler.js` | unattended timer runner, read-only only, rest queued |
| `scripts/status.sh` | system/AI/safety checks + milestone % (`--net`, `--fix`) |
| `scripts/score.sh` | honest accuracy from `logs/proposals.jsonl` |

`JX_BACKEND=local` switches action selection to the local model — used to
separate "did the prompt improve" from "did the model improve."

---

## Findings worth not relearning

**Prompt quality beat model size.** The first agent tests scored ~2/5 on
qwen2.5:1.5b. Most of that was not model capacity — `Guidelines.md` listed
Hermes, DeepSeek and Claude as available when none were installed, so the model
was being handed a false map of its own capabilities and then graded on
judgment. Rewriting Guidelines to describe *reality*, and splitting "enforced in
code" from "intended but not enforced," moved local from ~0/4 to 3/4 on the same
goals.

**Same four goals, four backends:**

| model | score |
|---|---|
| qwen2.5:1.5b | ~0/4 |
| qwen2.5:3b | 3/4 |
| qwen2.5:7b | 4/4 |
| gemini (hard tier) | 4/4 |
| hermes3:3b | 4/4 actions, but 3/4 malformed JSON — removed |

**Prompt rules are advisory; validators are not.** The model was told four
separate times, in writing, to answer "I can't do that" when no action fits. It
complied once — on the exact example given verbatim — and otherwise reached for
the nearest related-looking action. Once it proposed a `write` with the schema's
placeholder content on an impossible goal. `validate.js` exists because of this.

**A metric you're generous with is worse than no metric.** The original
`proposals.jsonl` logged `approved`, which meant "it ran," not "it was right" —
grep on it suggested 4/5 when honest scoring was ~2/5. After adding the
correctness prompt, three obviously-wrong proposals were still graded `y` in one
sitting. Regrade honestly; the number governs whether the gate ever opens.

**Read the bytes before theorising.** Repeated failure mode on both sides:
- Python in-place patches silently no-op when the anchor string doesn't match,
  while still printing a success message. Four patches "succeeded" and changed
  nothing. **Always `assert anchor in s`.**
- `require('./local.js')` vs `require('./local')` — one character meant the
  router patch never applied, so a whole evening of "Gemini" measurements were
  actually the local model.
- Two rounds of confident diagnosis about "double-wrapped JSON" were wrong; one
  `RAW:` dump showed the real cause in ten seconds (models emit *real newlines*
  inside JSON strings, which is invalid, so the outer parse threw and the
  fallback stuffed everything into `text`). Fix lives in `lib.js:reEscape`.
- Guidelines.md was accused of not containing text it *did* contain, because
  nobody ran `cat` on it. Ground truth was one command away the whole time.

**Fluent failure is the dangerous kind.** The weak model failed loudly (wrong
action, ENOENT, obvious). Stronger models fail plausibly — accurate-sounding
output that a tired human approves by reflex at 2am. Bigger models don't remove
the failure, they make it harder to spot. This is the argument for the gate.

**A deny rule protects a path through one tool, not the path itself.** Claude
Code's `Read` deny on `.env` did not stop `Bash(cat:*)`. Same shape as
`guard.js`: a convention that holds because the caller cooperates, not a sandbox.

**Plugins can add hooks that run without asking.** Three installed plugins had
SessionStart/Stop/UserPromptSubmit hooks, including one whose stated purpose was
restarting the session automatically. Audit before installing, and remember
hooks load at session start — removing them mid-session doesn't unload them.

---

## Deferred, on purpose

- **`paper.js`** — simulated trading. Build with the same discipline: propose,
  validate, gate. Open design questions: where prices come from, what a
  "position" means when nothing is real.
- **`selfdebug.js`** — agent reads its own errors and proposes fixes. Do not
  build while accuracy is 77%. A self-modifying loop plus a model that picks the
  right action three times in four is how a repo ends up editing its own
  constraints. Revisit when the accuracy number is boring.
- `status.sh` checks `[ -f code/paper.js ]` — file *existence*, not
  correctness. `touch code/paper.js` would show 100%. Don't. 91% honest beats
  100% hollow.

---

## Open threads

- **GitHub remote is configured but never pushed.** Needs a personal access
  token (github.com/settings/tokens, classic, `repo` scope), then
  `git push -u origin master` with username + token as password.
  **Check the repo is private first** — history still contains the old
  `logs/*.jsonl` from before they were gitignored.
- Gemini `max` tier (`gemini-3.1-pro-preview`) 429s on the free tier. The chain
  degrades to Flash and keeps the gate. Needs billing to actually use.
- Local model latency is CPU-only — Crostini passes no GPU through
  (`renderer: llvmpipe`). 7b is noticeably slow; 3b is the fast fallback.
- No swap configured. Fine at 14GB RAM and ~165MB idle, but a memory spike
  gets killed rather than slowed.
