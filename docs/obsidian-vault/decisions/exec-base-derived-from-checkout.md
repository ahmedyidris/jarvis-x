---
title: exec.js's BASE derived from the checkout, not $HOME
date: 2026-09-03
status: decided (reverses the 2026-08 CI-symlink decision)
---

# Decision: `exec.js`'s `BASE` is `path.resolve(__dirname, '..')`

**Question:** `code/exec.js`'s jail root was `path.resolve(process.env.HOME, 'jarvis-x')`.
A prior decision (`../changelog/2026-08.md`, "CI (`test.yml`) fix") kept that and added a
CI symlink (`$HOME/jarvis-x` → checkout dir) instead, on the grounds that `$HOME/jarvis-x`
is "correct production logic — the app genuinely lives at `~/jarvis-x` on the dev machine".
Should that stand?

**Decision: no — derive `BASE` from the checkout.** `BASE = path.resolve(__dirname, '..')`.

**Why, given the earlier decision was reasonable at the time:**

1. **Production behaviour is unchanged.** On the dev machine the repo *is* at `~/jarvis-x`,
   so `__dirname/..` and `$HOME/jarvis-x` evaluate to the same path. This is not a
   behavioural change where the old rationale applies — it is the same value, computed from
   something that cannot drift.

2. **The Docker target is where the old logic is actively broken.** That deployment did not
   exist when the earlier decision was made. `Dockerfile:54,91` place the code at `/app`; no
   `USER` is set, so `HOME=/root`; and there is no `$HOME/jarvis-x` symlink anywhere in
   `docker/`. Old `BASE` = `/root/jarvis-x`, which does not exist in the image — so
   `fs.realpathSync(BASE)` throws and **every** jailed operation (`exec.readFile`,
   `validate`'s path checks, `shell.run`'s path args) fails inside the container. The
   container was verified via `/api/status` only, which never exercises that path, which is
   why it read as healthy.

3. **The jail root is a property of the project directory, not of the user.** Every consumer
   — `lib.js:42`, `validate.js:6`, `shell.js` — uses `BASE` purely as "the root of this
   project". `__dirname` is the only expression that always answers that correctly.

4. **The `.deb` is not a counter-example.** It is the one layout where code could live away
   from `~/jarvis-x` (`/opt/jarvis-x`), but `dpkg -c` shows it ships that directory *empty*
   — no `app.py` — so it cannot run either way. See `../../triage/2026-09-repo-triage.md`.

**Consequences:**
- Fixed `test-exec.js` (2 cases) and `test-validate.js` (5 cases), which had been failing
  on any checkout not at `~/jarvis-x`.
- `.github/workflows/test.yml:29`'s symlink step is now redundant. **Left in place** — it is
  harmless, and removing it is a separate call.
- Revertable in isolation: one hunk in `code/exec.js`, nothing else depends on it.

**Evidence:** `AS_BUILT.md` §3.2.
