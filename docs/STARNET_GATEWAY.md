# StarNet → Jarvis gateway

`code/openai-gateway.js` is a small OpenAI-compatible server on
`http://127.0.0.1:8010/v1`. StarNet uses it as its **Custom OpenAI-Compatible**
provider, so every StarNet agent reaches its model through Jarvis's tiers:
the same free providers, the same fallback order and the same daily quota as
the rest of Jarvis. This is the handoff's Priority 2 ("Route StarNet through
Jarvis"), built 2026-09-25.

> **To run StarNet itself on the Chromebook** (its own interface, wired to this gateway) with one
> command, use `scripts/starnet.sh`. See [STARNET_CHROMEOS.md](STARNET_CHROMEOS.md). The manual
> commands below still work, and the script does the same plus the Crostini install fixes.

## Why not app.py's /v1 on :8000

app.py's `/v1` stays exactly as it is. It is Jarvis's own persona for Aider
and Continue, and it is local-owned. It cannot carry StarNet, for four reasons
checked against StarNet's adapter (`sidecar/providers/openai-compatible.js`):

| StarNet needs | app.py's /v1 does | Result |
|---|---|---|
| a streamed (SSE) reply ending in `data: [DONE]` | one plain JSON body | StarNet reads **zero** text events: the run ends "done, truncated" with nothing in it. This was reproduced with StarNet's own adapter code, not assumed. |
| response headers within 30s (`SKYNET_PROVIDER_CONNECT_MS`) | headers only after the whole answer | a slow local answer is aborted and retried |
| its own system prompt and the whole conversation | last user message only, persona swapped in | the agent loses its identity and its history on every turn |
| `tools` passed through | tools dropped | no StarNet task can run |

The gateway fixes all four:

- It sends headers and a first chunk at once.
- It keeps the connection alive every 10s while the model works.
- It passes the caller's messages and tools upstream (with StarNet's extra fields such as `agentId` removed, the handoff's fix #10).
- It replays the finished answer, text and tool calls alike, as SSE.

Upstream calls are **not** streamed, which is the path `registry.js` already
proves works from Crostini. StarNet itself only streams from 127.0.0.1, never
from a Cloudflare-fronted API. That removes the leading suspect in Bug A,
though Bug A itself is still undiagnosed.

## Models it offers

| id | route |
|---|---|
| `fast`, `smart`, `quality`, `frontier`, `local` | the registry tier chain, with fallback. The same names and meanings as app.py's `tier_map`, pinned by a test. `fast` is listed first on purpose (see Bug C below). |
| `groq/<model>`, `openrouter/<model>`, `gemini/<model>` | exactly that provider and model, with no fallback. Only models `registry.js` lists are accepted, all of them free-tier. A cloud model it does not list gets a 404, never a silent reroute. |
| `ollama/<any pulled model>` | exactly that local model. Anything you `ollama pull` shows up in the list automatically. |

**$0 by construction:** there is no route to a paid model.

## Run it on the Chromebook

The port is **8010**. 8000 is app.py, 8001 is `tts-worker` and 8002 is the
dashboard backend. A test reads those files and fails if the default ever
collides with one of them. Set `JX_GATEWAY_PORT` to move it. A taken port is
reported by number, not as a bare `EADDRINUSE`.

```bash
cd ~/jarvis-x && git pull

# 1. Start the gateway. registry.js reads ~/.jarvis-x/.env itself; nothing to source.
NODE_OPTIONS="--dns-result-order=ipv4first" \
  nohup node code/openai-gateway.js > /tmp/jx-gateway.log 2>&1 &

# 2. Check it
curl -s http://127.0.0.1:8010/health                 # {"ok":true,"stopped":false}
curl -s http://127.0.0.1:8010/v1/models | head -c 400
curl -sN http://127.0.0.1:8010/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"fast","stream":true,"messages":[{"role":"user","content":"Reply with OK."}]}'
# expect: data: {...role...}, data: {...OK...}, data: {...finish_reason...}, data: [DONE]
cat /tmp/jx-gateway.log      # one line per request: route, provider, time. Never message text.

# 3. Restart StarNet pointed at it
pkill -f "node sidecar/index.js"; sleep 2
cd ~/starnet
NODE_OPTIONS="--dns-result-order=ipv4first" \
CUSTOM_OPENAI_BASE_URL="http://127.0.0.1:8010/v1" \
  nohup node sidecar/index.js > /tmp/starnet.log 2>&1 &
```

Then, in StarNet at http://127.0.0.1:8787:

1. Go to **Settings → Providers → CUSTOM** and type the base URL **with the `http://`**: `http://127.0.0.1:8010/v1`. See Bug C for why the scheme matters.
2. **Leave the API key empty.** The gateway needs none, and an empty key skips StarNet's key test entirely.
3. Set Raqib's model to **CUSTOM → `fast`**, send a message, and watch `/tmp/jx-gateway.log`.

This launch drops the `GROQ_API_KEY` and `GEMINI_API_KEY` exports on purpose. StarNet no longer needs them, and without them nothing can route around Jarvis into Bug A. Ollama stays available in StarNet directly.

### Optional: a bearer token

If `JX_GATEWAY_KEY` is set in the gateway's environment, every request must
send `Authorization: Bearer <that value>`. In StarNet, set the same value as
`CUSTOM_OPENAI_KEY` at launch. Without it the gateway is loopback-only and:

- rejects any `Host` that isn't 127.0.0.1 or localhost (this stops DNS rebinding);
- rejects any body that isn't `application/json` (this forces a CORS preflight, which it never answers).

So no web page you visit can spend your quota through it.

### Optional: run it under supervisord

This is not added to `config/supervisord.conf`, because that changes what your
machine starts, and that is your call. If you want it, add the block below.
Check `which node` first, since supervisord's PATH may not include it.

```ini
[program:openai-gateway]
command=/bin/bash -c "mkdir -p /home/ahmedyidris/jarvis-x/logs/supervisord && exec node code/openai-gateway.js"
directory=/home/ahmedyidris/jarvis-x
environment=HOME="/home/ahmedyidris",NODE_OPTIONS="--dns-result-order=ipv4first"
autostart=true
autorestart=true
startretries=3
startsecs=3
stdout_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/openai-gateway.out.log
stderr_logfile=/home/ahmedyidris/jarvis-x/logs/supervisord/openai-gateway.err.log
```

## Kill switch

`touch ~/jarvis-x/.jarvis-x-STOP` makes every chat request return 503 "kill
switch is engaged" before any provider is called, and `/health` says
`stopped: true`. StarNet shows that as a failed run. `rm` the file to resume.
It is the same file `guard.js` reads.

## Bug C: what the code says

In StarNet's code, the custom provider's checks look like this:

- The probe lists `/models`.
- The key test runs only when a key is typed. It then streams "Reply with OK." to the selected model, or `models[0]`, with a hard **15s** budget.
- The URL field adds `https://` to anything typed without a scheme.

The likely causes, ranked. None is confirmed on the Chromebook yet:

1. **The 15s key test hit a slow model.** app.py's `/v1/models` lists `local` first, so the test ran a CPU model through the reply engine with the full persona prompt. It also got no headers until the answer existed. Past 15s, StarNet aborts and reports "the endpoint accepted the request but did not answer". The fix here: `fast` is listed first and headers go out at once. Better still, leave the key empty and the test never runs.
2. **The URL was typed without `http://`.** StarNet then stores `https://127.0.0.1:8000/v1`, and TLS fails against a plain-HTTP server, so the probe reports "unreachable".
3. **Your local `feat/harness-backend` branch differs from upstream.** This analysis read upstream StarNet (`androoAGI/starnet`), not that branch.

One non-cause, checked: against app.py's JSON shape, StarNet's key test would actually **pass** if it finished in time. Its answered check accepts a bare "done". The runs afterwards would be empty (row 1 of the table above). So a passing key test would not have meant it worked.

## Known limits

- **Answers arrive all at once**, not word by word, because upstream is non-streamed on purpose.
- **Jarvis does not run tools.** StarNet runs them, as with any OpenAI endpoint. The gateway only carries the calls.
- **Large task requests may hit Groq's free token-per-minute cap.** StarNet's tool list alone is tens of KB per request. When Groq refuses, the chain falls through to OpenRouter, then local, and the log line shows which provider answered.
- **Ollama's default context window may be smaller than a StarNet prompt.** If local answers ignore the start of the conversation, raise `OLLAMA_CONTEXT_LENGTH` on the ollama service. Not checked on this machine.
- **The Gemini route is untested on the Chromebook.** It uses Gemini's OpenAI-compatible URL, which carries tool calls; the native API `registry.js` uses does not. If it fails, the `quality` chain falls through to Groq, then local.
- **Quota is shared with Jarvis.** A StarNet task makes one call per turn, so it can use up Gemini's 20/day quickly. That is the point of sharing one count: Jarvis sees it too.

## Tests

`node code/test-openai-gateway.js` runs 56 assertions, fully offline, in CI.

- Mutation-tested: 33 hand-made mutations, and 32 caught.
- The one escape aborts a request's controller after the reply has already ended, which changes nothing.

The contract was also checked by running **StarNet's real adapter** against the
gateway with a fake upstream. It read the text, two parallel tool calls with
the right indices, `finish_reason`, and usage. A reply slower than StarNet's
connect ceiling still came through. What no test here proves is a live
upstream. That takes the three curl commands above.
