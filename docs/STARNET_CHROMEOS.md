# StarNet on the Chromebook

This runs **StarNet itself**, with its own interface exactly as upstream ships it, on the ChromeOS
Linux container (Crostini). Jarvis is its model provider. Nothing is copied into Jarvis and
nothing in StarNet is changed, so StarNet's own updates keep working.

```
Chrome tab (or app window)  -->  StarNet :8787  -->  Jarvis gateway :8010  -->  Groq / OpenRouter / Gemini / Ollama
      StarNet's own UI           upstream, unmodified     code/openai-gateway.js        registry.js's free tiers
```

## Why this works

StarNet (`androoAGI/starnet`, MIT) is a Node web app. `node sidecar/index.js` serves the whole product,
UI and agent engine, on `127.0.0.1:8787`. Its public installers are Windows and macOS only, but this
web mode is plain Node and already ran on this Chromebook (2026-09-24 handoff). What broke was its
providers:

- **Bug A:** StarNet's own Groq path killed the sidecar.
- **Bug C:** the custom-provider form would not accept Jarvis.

With Jarvis as the provider, StarNet never calls Groq directly. The gateway answers in the format
StarNet's adapter needs; see [STARNET_GATEWAY.md](STARNET_GATEWAY.md).

Verified 2026-09-26 on Debian in a cloud container, not yet on the Chromebook:

- StarNet installed and started from this script.
- Its full UI rendered: title screen, then "Create your Overseer".
- Its provider probe reported Jarvis reachable and verified, and listed Jarvis's models.
- An agent chat run and a task run (87 tools) both finished **done** through the gateway, at $0.
- With `.jarvis-x-STOP` present, StarNet's run failed with Jarvis's kill-switch message.

## One-time setup

```bash
sudo apt-get install -y build-essential python3 git   # node-pty compiles from source on Linux
cd ~/jarvis-x && git pull
scripts/starnet.sh doctor                             # checks node, tools, disk, RAM, ollama
scripts/starnet.sh install
```

`install` **reuses your existing `~/starnet`** as it is: same branch, same fixes, nothing reset. It
only installs StarNet's packages, with three Chromebook fixes found by installing it:

| Problem found | Fix |
|---|---|
| `onnxruntime-node` downloads NVIDIA CUDA libraries during install. There is no GPU here, and the download also failed mid-way. | `ONNXRUNTIME_NODE_INSTALL=skip`, the package's own switch |
| `kokoro-js` bundles a 343 MB CUDA library plus Mac and Windows binaries | pruned after install: packages go from 1.2 GB to 592 MB (`scripts/starnet.sh prune` re-trims after any `npm ci`) |
| `node-pty` has no Linux prebuild | compiled from source, which is why the apt line above is needed |

Without an existing `~/starnet`, `install` clones the latest StarNet without its history and without
`website/`, `docs/`, `output/` and `qa/`. The app never reads those, and they are about 3.6 GB. A
fresh install is about 2.8 GB in total, and the script refuses if less than 4 GB is free.

## Every day

```bash
cd ~/jarvis-x
scripts/starnet.sh start     # starts the Jarvis gateway if needed, then StarNet
scripts/starnet.sh status
scripts/starnet.sh logs
scripts/starnet.sh stop      # add --all to also stop the gateway
```

Open **http://127.0.0.1:8787** in Chrome.

**To get a StarNet window of its own** in the shelf: in Chrome, open ⋮ → **Cast, save and share** →
**Install page as app**. That gives the desktop-app feel without the Tauri build, which the handoff
says not to use daily on this machine.

### First run inside StarNet

1. **Create your Overseer.** Name him Raqib if you like.
2. For **Working style**, choose **ASK FOR APPROVAL**, not FULL POWER. StarNet's agents can run tools on
   this machine, and the handoff's rule is "Do not run YOLO-mode agents on this machine".
3. **Connect a brain** → **CUSTOM**. Type `http://127.0.0.1:8010/v1` with the `http://`, leave the key
   **empty**, and pick model `fast`.
   - `smart` and `quality` are the other Jarvis tiers.
   - `ollama/<model>` pins a local model.

## What start does, and why

- **Provider keys are removed from StarNet's environment** (`GROQ_API_KEY`, `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`), so no call can take StarNet's own Groq path (Bug A). The gateway reads the
  keys itself from `~/.jarvis-x/.env`. `start --direct-keys` passes them through anyway.
- It sets `NODE_OPTIONS=--dns-result-order=ipv4first` for both processes. That is the Crostini IPv6
  workaround from the handoff.
- It sets `CUSTOM_OPENAI_BASE_URL=http://127.0.0.1:8010/v1`, so StarNet's backend knows where Jarvis is.
- **A stale workspace lock** (the handoff's `WORKSPACE_BUSY`) is removed only when its process is
  really gone. Current StarNet reclaims a dead lock by itself; this covers older checkouts.
  `scripts/starnet.sh clear-lock` does it on demand.
- **Processes are matched by their exact command line.** An early version matched any process that
  merely mentioned StarNet, and `stop` killed the terminal that ran it. That is pinned by a test now.

## Kill switch

`touch ~/jarvis-x/.jarvis-x-STOP` makes the gateway refuse every model call. StarNet's agents stop,
and StarNet shows "Jarvis kill switch is engaged". `rm` the file to resume. It is the same switch
as the ACTIVE/HALTED button in Jarvis.

## Resources

- **Processes:** StarNet about 110 MB and the gateway about 50 MB of RAM (measured). The StarNet tab
  in Chrome uses more, because its station view is graphical.
- **Before starting:** the handoff's rule still applies: close Chrome tabs until `free -h` shows a
  few GB available.

## Tests

- `node code/test-starnet-launcher.js`: 17 assertions, offline, in CI.
- Mutation pass: 12 of 12 hand-made breaks caught.
- The first break, reverting to loose process matching, killed the test runner's own shell on the
  first try: the same bug the test pins.
