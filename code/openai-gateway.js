#!/usr/bin/env node
/**
 * OpenAI-compatible gateway over registry.js -- the endpoint StarNet (and any
 * other OpenAI-shaped client) uses to reach Jarvis's model tiers.
 *
 *   node code/openai-gateway.js          # http://127.0.0.1:8001/v1
 *
 * WHY A SECOND /v1 AND NOT app.py's. app.py already serves /v1 on :8000
 * (added 2026-09-23 for StarNet, Aider and Continue). It cannot carry StarNet,
 * for four reasons read out of StarNet's own adapter
 * (sidecar/providers/openai-compatible.js), not guessed:
 *
 *   1. StarNet always sends stream:true and parses ONLY `data:` lines. app.py
 *      answers with one plain JSON body, which that parser reads as zero
 *      events -- a run that "finishes" with no text in it.
 *   2. StarNet aborts a request whose response headers have not arrived within
 *      30s (SKYNET_PROVIDER_CONNECT_MS). app.py sends headers only once the
 *      whole answer exists, and a CPU-only local answer takes longer than that.
 *   3. app.py keeps only the LAST user message and swaps the caller's system
 *      prompt for Jarvis's persona. A StarNet agent loses its identity and its
 *      whole conversation on every turn.
 *   4. app.py drops `tools`, so no StarNet task can run through it at all.
 *
 * app.py is local-owned (HANDOFF.md), and its /v1 is still right for what it
 * does -- Jarvis's own persona for Aider/Continue -- so this is a separate
 * process on a separate port, not an edit to it.
 *
 * WHAT IT IS. A pass-through, not an agent. The caller's messages and tools go
 * upstream unchanged apart from schema cleanup, over the SAME provider chains
 * registry.js uses, so fallback order and the on-disk daily quota are shared
 * with every other Jarvis call rather than counted twice. Upstream calls are
 * NON-streamed -- the path registry.js already proves works from Crostini --
 * and the finished answer is re-emitted to the client as SSE. The client then
 * streams from 127.0.0.1 only, never from a Cloudflare-fronted API, which is
 * the leading suspect in StarNet Bug A.
 *
 * $0 BY CONSTRUCTION. Cloud routes are only the models registry.js lists, all
 * free-tier. `ollama/<anything>` is allowed because local inference costs
 * nothing. There is no code path to a paid model.
 *
 * WHAT IT DOES NOT DO. It does not execute tools -- the caller does, exactly as
 * it would against any OpenAI endpoint. It does not read or write Jarvis's
 * conversation history (hermes.py's `conversations` table): StarNet keeps its
 * own, and mixing the two would replay agent turns into Jarvis's chat.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8001;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// StarNet's idle watchdog cancels a stream after SKYNET_PROVIDER_IDLE_MS (300s)
// without a byte. An SSE comment every 10s keeps a slow local answer alive; the
// parser skips lines starting with ':'.
const KEEPALIVE_MS = 10000;
const CLOUD_TIMEOUT_MS = 90000;
// Local is CPU-only: a StarNet task prompt can be ~10k tokens before the model
// writes a word. Generous on purpose; the client's own cancel still aborts it.
const LOCAL_TIMEOUT_MS = 600000;

const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/v1/chat/completions';
const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';
// Gemini's OpenAI-compatible surface. registry.js uses the native
// generateContent shape, which has no tool-call format this gateway could pass
// through; this one does. UNVERIFIED ON THE CHROMEBOOK -- if it refuses, the
// quality chain falls through to groq and then local, it does not break.
const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// The same aliases as app.py's tier_map, so a model id means the same thing on
// :8000 and :8001. registry.js has no `frontier` tier; app.py sends it to
// registry:quality, and so does this.
const TIER_ALIASES = {
  local: 'local', ollama: 'local',
  fast: 'fast', groq: 'fast',
  smart: 'smart',
  quality: 'quality', gemini: 'quality',
  frontier: 'quality',
};
// `fast` FIRST, deliberately. When a key is typed into StarNet's custom-provider
// form, /api/providers/validate test-streams "Reply with OK." to models[0] under
// a 15s budget. With `local` first that probe lands on a CPU model and times
// out -- one plausible cause of Bug C. `fast` answers in about a second.
const TIER_ORDER = ['fast', 'smart', 'quality', 'frontier', 'local'];

// The keys the handoff's StarNet fix (#10) keeps, which strict validators such
// as Groq's accept. StarNet also attaches agentId and friends; those 400.
const MESSAGE_KEYS = ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call'];
const PASS_PARAMS = ['temperature', 'top_p', 'stop'];

function errBody(message, code) {
  return { error: { message: String(message), type: code, code } };
}

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Model id -> { kind, id, chain: [{provider, model}] }, or null when the id is
 * unknown. Null is deliberate: an unknown id gets a 404 naming the valid ones,
 * never a silent reroute to some other model.
 */
function resolveRoute(model, registry) {
  const want = String(model == null ? '' : model).trim() || 'fast';
  if (Object.prototype.hasOwnProperty.call(TIER_ALIASES, want)) {
    const tier = TIER_ALIASES[want];
    const chain = (registry.TIERS[tier] || [])
      .map(([name, key]) => {
        const p = registry.PROVIDERS[name];
        return p && p.models[key] ? { provider: name, model: p.models[key] } : null;
      })
      .filter(Boolean);
    if (chain.length) return { kind: 'tier', id: want, tier, chain };
  }
  const slash = want.indexOf('/');
  if (slash > 0) {
    const name = want.slice(0, slash);
    const rest = want.slice(slash + 1);
    const p = Object.prototype.hasOwnProperty.call(registry.PROVIDERS, name) ? registry.PROVIDERS[name] : null;
    if (p && rest) {
      // Pinned: exactly this provider and model, no fallback. Local accepts any
      // pulled model; cloud only what registry.js lists (the $0 guarantee).
      if (p.native || Object.values(p.models).includes(rest)) {
        return { kind: 'pinned', id: want, chain: [{ provider: name, model: rest }] };
      }
    }
  }
  return null;
}

function cleanContent(content) {
  if (!Array.isArray(content)) return content;
  // Text-only part arrays become a string: some chat servers accept arrays for
  // user turns only, and none rejects a string. Anything else (images) passes
  // as parts, stripped to the two fields the wire defines.
  if (content.every((p) => p && p.type === 'text' && typeof p.text === 'string')) {
    return content.map((p) => p.text).join('\n');
  }
  return content.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const o = { type: p.type };
    if (p.type === 'text') o.text = p.text;
    if (p.image_url !== undefined) o.image_url = p.image_url;
    return o;
  });
}

function cleanToolCalls(calls) {
  return calls.map((tc) => {
    const fn = (tc && tc.function) || {};
    const args = typeof fn.arguments === 'string'
      ? fn.arguments
      : JSON.stringify(fn.arguments == null ? {} : fn.arguments);
    return { id: String((tc && tc.id) || ''), type: 'function', function: { name: String(fn.name || ''), arguments: args } };
  });
}

/** Caller messages -> OpenAI-schema messages. Throws on a malformed list. */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }
  return messages.map((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.role !== 'string') {
      throw new Error(`messages[${i}] has no role`);
    }
    const o = {};
    for (const k of MESSAGE_KEYS) if (k in m) o[k] = m[k];
    // `developer` is OpenAI's newer name for system; not every server knows it.
    if (o.role === 'developer') o.role = 'system';
    if ('content' in o) o.content = cleanContent(o.content);
    if (Array.isArray(o.tool_calls)) o.tool_calls = cleanToolCalls(o.tool_calls);
    return o;
  });
}

/**
 * The upstream request body. An allowlist, not a denylist: stream and
 * stream_options belong to the client leg only, and reasoning_effort /
 * parallel_tool_calls are exactly the params StarNet's own DROPPABLE_PARAMS
 * list records providers disagreeing on -- one chain spans three vendors.
 */
function buildUpstreamBody(req, messages) {
  const body = { messages, stream: false };
  for (const p of PASS_PARAMS) if (req[p] !== undefined) body[p] = req[p];
  const max = Number(req.max_tokens != null ? req.max_tokens : req.max_completion_tokens);
  if (Number.isFinite(max) && max > 0) body.max_tokens = Math.floor(max);
  if (Array.isArray(req.tools) && req.tools.length) {
    body.tools = req.tools;
    if (req.tool_choice !== undefined) body.tool_choice = req.tool_choice;
  }
  return body;
}

function cleanUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const out = {
    prompt_tokens: n(u.prompt_tokens),
    completion_tokens: n(u.completion_tokens),
    total_tokens: n(u.total_tokens),
  };
  if (out.prompt_tokens === undefined && out.completion_tokens === undefined) return null;
  if (out.total_tokens === undefined) out.total_tokens = (out.prompt_tokens || 0) + (out.completion_tokens || 0);
  return out;
}

function chatUrl(p) {
  if (p.native) return OLLAMA_CHAT_URL;
  if (p.gemini) return GEMINI_CHAT_URL;
  return p.url;
}

/** One provider, one non-streamed call. Resolves to the answer or throws. */
async function callUpstream(h, payload, deps, signal) {
  const reg = deps.registry;
  const p = reg.PROVIDERS[h.provider];
  const key = p.key ? reg.loadKey(p.key) : null;
  if (p.key && !key) throw new Error('no API key');
  if (reg.quotaLeft(h.provider) <= 0) throw new Error(`daily quota exhausted (${p.dailyLimit})`);

  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const ms = p.native ? deps.localTimeoutMs : deps.cloudTimeoutMs;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  try {
    let res;
    try {
      res = await deps.fetch(chatUrl(p), {
        method: 'POST', headers, body: JSON.stringify({ ...payload, model: h.model }), signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) throw new Error(`timed out after ${Math.round(ms / 1000)}s`);
      throw e;
    }
    // Counted once the provider answered at all, whatever the status -- the
    // same point registry.js counts at, so the two share one honest number.
    reg.bumpQuota(h.provider);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${oneLine(text).slice(0, 160)}`);
    let d;
    try { d = JSON.parse(text); } catch { throw new Error('unparseable response'); }
    const choice = d && Array.isArray(d.choices) ? d.choices[0] : null;
    const msg = (choice && choice.message) || {};
    const content = typeof msg.content === 'string' ? msg.content : '';
    const toolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? cleanToolCalls(msg.tool_calls) : null;
    if (!content.trim() && !toolCalls) throw new Error('empty response');
    // `length` survives: a cut-off answer must reach the client as cut off.
    // Otherwise tool calls mean tool_calls, whatever the server labelled it
    // (some Ollama builds say `stop`).
    const finishReason = choice.finish_reason === 'length'
      ? 'length'
      : (toolCalls ? 'tool_calls' : (choice.finish_reason || 'stop'));
    return { content, toolCalls, finishReason, usage: cleanUsage(d.usage), provider: h.provider, model: h.model };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Walk the route's chain in order; the first provider that answers wins. */
async function runChain(route, payload, deps, signal) {
  const tried = [];
  for (const h of route.chain) {
    if (signal && signal.aborted) throw new Error('client closed the request');
    if (!deps.registry.available(h.provider)) { tried.push(`${h.provider}(no key)`); continue; }
    try {
      const r = await callUpstream(h, payload, deps, signal);
      r.tried = tried.slice();
      return r;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      tried.push(`${h.provider}(${oneLine(e && e.message).slice(0, 80)})`);
    }
  }
  const err = new Error(`All providers failed for ${route.kind} "${route.id}": ${tried.join(' | ')}`);
  err.tried = tried;
  throw err;
}

// Capability is asserted only where it is documented. `undefined` is omitted
// from the JSON, which StarNet reads as "unknown" -- it refuses a task only on
// an explicit false, so unknown never blocks and never overclaims.
function toolCapable(provider, model) {
  if (provider === 'groq' || provider === 'gemini') return true;
  if (provider === 'ollama' && model.startsWith('qwen2.5')) return true;
  return undefined;
}

async function listModels(deps) {
  const reg = deps.registry;
  const data = [];
  const seen = new Set();
  const add = (id, route, tools) => {
    if (seen.has(id)) return;
    seen.add(id);
    const m = { id, object: 'model', created: 0, owned_by: 'jarvis', jarvis_route: route };
    if (tools !== undefined) m.supportsTools = tools;
    data.push(m);
  };
  for (const t of TIER_ORDER) {
    const route = resolveRoute(t, reg);
    if (route) add(t, 'tier', true);
  }
  for (const [name, p] of Object.entries(reg.PROVIDERS)) {
    if (p.native || !reg.available(name)) continue;
    for (const m of new Set(Object.values(p.models))) add(`${name}/${m}`, 'pinned', toolCapable(name, m));
  }
  const ollama = Object.entries(reg.PROVIDERS).find(([, p]) => p.native);
  if (ollama) {
    const [name, p] = ollama;
    const local = new Set(Object.values(p.models));
    // Whatever is pulled shows up too -- that is how a model Ahmed pulls later
    // (qwen3, deepseek-r1, ...) becomes pickable in StarNet without a code
    // change. A dead daemon just leaves the registry's two.
    try {
      const r = await deps.fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(1500) });
      const j = r && r.ok ? await r.json() : null;
      for (const m of (j && Array.isArray(j.models) ? j.models : [])) if (m && m.name) local.add(String(m.name));
    } catch { /* daemon down: registry models only */ }
    for (const m of local) add(`${name}/${m}`, 'pinned', toolCapable(name, m));
  }
  return { object: 'list', data };
}

function hostAllowed(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

function bearerMatches(header, key) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; return; }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
      if (tooBig) { const e = new Error(`request body over ${limit} bytes`); e.status = 413; reject(e); return; }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extra) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function createGateway(opts = {}) {
  const deps = {
    registry: opts.registry || require('./providers/registry.js'),
    fetch: opts.fetch || globalThis.fetch,
    isStopped: opts.isStopped || (() => require('./guard.js').isStopped()),
    apiKey: opts.apiKey != null ? String(opts.apiKey) : String(process.env.JX_GATEWAY_KEY || ''),
    now: opts.now || (() => Date.now()),
    newId: opts.newId || (() => `chatcmpl-${crypto.randomBytes(6).toString('hex')}`),
    keepaliveMs: opts.keepaliveMs != null ? opts.keepaliveMs : KEEPALIVE_MS,
    cloudTimeoutMs: opts.cloudTimeoutMs || CLOUD_TIMEOUT_MS,
    localTimeoutMs: opts.localTimeoutMs || LOCAL_TIMEOUT_MS,
    log: opts.log || ((line) => process.stderr.write(`${line}\n`)),
  };

  function logRequest(route, body, started, outcome) {
    const tools = Array.isArray(body.tools) ? body.tools.length : 0;
    const msgs = Array.isArray(body.messages) ? body.messages.length : 0;
    // Counts and routes only -- never message content.
    deps.log(`[openai-gateway] ${new Date(deps.now()).toISOString()} ${route.id} ${outcome} `
      + `${deps.now() - started}ms stream=${body.stream === true} msgs=${msgs} tools=${tools}`);
  }

  async function chat(req, res) {
    // Checked before the body is read: a pulled kill switch refuses the call
    // itself, and StarNet's autonomous loops are exactly what it exists for.
    if (deps.isStopped()) {
      return sendJson(res, 503, errBody('Jarvis kill switch is engaged (.jarvis-x-STOP). Remove the file to resume.', 'kill_switch'));
    }
    // JSON only. A browser page can POST text/plain to 127.0.0.1 without a
    // CORS preflight; requiring application/json forces one, which this server
    // never answers -- so no website can spend Ahmed's quota through it.
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
      return sendJson(res, 415, errBody('Content-Type must be application/json', 'unsupported_media_type'));
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      return sendJson(res, e.status || 400, errBody(e.status ? e.message : 'body is not valid JSON', 'invalid_request_error'));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, errBody('body must be a JSON object', 'invalid_request_error'));
    }
    const route = resolveRoute(body.model, deps.registry);
    if (!route) {
      const known = (await listModels(deps)).data.map((m) => m.id).join(', ');
      return sendJson(res, 404, errBody(`unknown model "${body.model}". Known: ${known}`, 'model_not_found'));
    }
    let payload;
    try {
      payload = buildUpstreamBody(body, sanitizeMessages(body.messages));
    } catch (e) {
      return sendJson(res, 400, errBody(e.message, 'invalid_request_error'));
    }

    const started = deps.now();
    const id = deps.newId();
    const created = Math.floor(started / 1000);
    const ctrl = new AbortController();
    // The client hanging up (StarNet's cancel button, a closed tab) aborts the
    // upstream call too, instead of burning a quota slot on an answer nobody reads.
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

    if (body.stream !== true) {
      let r;
      try {
        r = await runChain(route, payload, deps, ctrl.signal);
      } catch (e) {
        logRequest(route, body, started, ctrl.signal.aborted ? 'client-closed' : 'failed');
        if (ctrl.signal.aborted) return undefined;
        return sendJson(res, 503, errBody(e.message, 'upstream_unavailable'));
      }
      const message = { role: 'assistant', content: r.content || (r.toolCalls ? null : '') };
      if (r.toolCalls) message.tool_calls = r.toolCalls;
      const out = {
        id, object: 'chat.completion', created, model: route.id,
        choices: [{ index: 0, message, finish_reason: r.finishReason }],
        x_jarvis: { provider: r.provider, model: r.model, tried: r.tried },
      };
      if (r.usage) out.usage = r.usage;
      logRequest(route, body, started, `-> ${r.provider}/${r.model}`);
      return sendJson(res, 200, out, { 'X-Jarvis-Provider': r.provider, 'X-Jarvis-Model': r.model });
    }

    // STREAMING. Headers and the role chunk go out NOW, before any upstream
    // call: this is what beats StarNet's 30s connect ceiling on a slow answer.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const chunk = (delta, finish, extra) => ({
      id, object: 'chat.completion.chunk', created, model: route.id,
      choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
    });
    sse(res, chunk({ role: 'assistant', content: '' }, null));
    const keepalive = deps.keepaliveMs > 0
      ? setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, deps.keepaliveMs)
      : null;
    try {
      const r = await runChain(route, payload, deps, ctrl.signal);
      if (r.content) sse(res, chunk({ content: r.content }, null));
      if (r.toolCalls) {
        sse(res, chunk({ tool_calls: r.toolCalls.map((tc, index) => ({ index, ...tc })) }, null));
      }
      sse(res, chunk({}, r.finishReason, { x_jarvis: { provider: r.provider, model: r.model, tried: r.tried } }));
      const wantsUsage = !!(body.stream_options && body.stream_options.include_usage);
      if (wantsUsage && r.usage) {
        sse(res, { id, object: 'chat.completion.chunk', created, model: route.id, choices: [], usage: r.usage });
      }
      res.end('data: [DONE]\n\n');
      logRequest(route, body, started, `-> ${r.provider}/${r.model}`);
    } catch (e) {
      logRequest(route, body, started, ctrl.signal.aborted ? 'client-closed' : 'failed');
      if (ctrl.signal.aborted) return undefined;
      // An in-stream error object is what StarNet's parser turns into a failed
      // run with this message -- never an empty "successful" one.
      sse(res, errBody(e.message, 'upstream_unavailable'));
      res.end('data: [DONE]\n\n');
    } finally {
      if (keepalive) clearInterval(keepalive);
    }
    return undefined;
  }

  async function handle(req, res) {
    const url = String(req.url || '').split('?')[0];
    // DNS rebinding: a hostile page can resolve its own name to 127.0.0.1, but
    // it cannot make the browser send Host: 127.0.0.1.
    if (!hostAllowed(req.headers.host)) {
      return sendJson(res, 403, errBody('Host must be 127.0.0.1 or localhost', 'forbidden'));
    }
    if (deps.apiKey && !bearerMatches(req.headers.authorization, deps.apiKey)) {
      return sendJson(res, 401, errBody('missing or wrong bearer token (JX_GATEWAY_KEY is set)', 'invalid_api_key'));
    }
    if (req.method === 'GET' && url === '/health') {
      const stopped = deps.isStopped();
      return sendJson(res, stopped ? 503 : 200, { ok: !stopped, stopped });
    }
    if (req.method === 'GET' && url === '/v1/models') return sendJson(res, 200, await listModels(deps));
    if (req.method === 'POST' && url === '/v1/chat/completions') return chat(req, res);
    return sendJson(res, 404, errBody(`no route for ${req.method} ${url}`, 'not_found'));
  }

  return { handle, deps };
}

function serve({ port = Number(process.env.JX_GATEWAY_PORT) || DEFAULT_PORT, ...opts } = {}) {
  const gw = createGateway(opts);
  const server = http.createServer((req, res) => {
    gw.handle(req, res).catch((e) => {
      gw.deps.log(`[openai-gateway] handler error: ${oneLine(e && e.message)}`);
      try {
        if (!res.headersSent) sendJson(res, 500, errBody('gateway error', 'internal_error'));
        else res.end();
      } catch { /* socket already gone */ }
    });
  });
  // Loopback only, never 0.0.0.0: this hands out free-tier quota to any caller.
  server.listen(port, HOST, () => {
    gw.deps.log(`[openai-gateway] listening on http://${HOST}:${port}/v1`
      + (gw.deps.apiKey ? ' (bearer token required)' : ''));
  });
  return server;
}

module.exports = {
  createGateway, serve, resolveRoute, sanitizeMessages, buildUpstreamBody, listModels,
  hostAllowed, bearerMatches, cleanUsage, TIER_ALIASES, TIER_ORDER, DEFAULT_PORT, HOST,
  OLLAMA_CHAT_URL, GEMINI_CHAT_URL,
};

if (require.main === module) serve();
