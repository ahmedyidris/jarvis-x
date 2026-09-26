// code/openai-gateway.js is the endpoint StarNet uses to reach Jarvis's tiers.
// The assertions that matter most pin the four ways app.py's /v1 fails StarNet
// (see the module header), because each is invisible from Jarvis's own side --
// app.py's /v1 returns 200 on every one of them:
//
//   streamed answer    -> app.py: one JSON body, StarNet reads ZERO events.
//   headers up front   -> app.py: headers after the answer, StarNet's 30s
//                         connect ceiling aborts a slow one.
//   caller's messages  -> app.py: last user turn only, persona replaced.
//   tools              -> app.py: dropped.
//
// EVERYTHING HERE IS OFFLINE. The handler takes its registry, fetch, clock,
// kill switch and log as arguments; requests and responses are in-memory
// fakes. No socket is opened, no key file is read, no quota file is written.
// The tests that use the REAL registry.js or app.py only read their tables --
// they assert wiring, never reachability.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { test, finish, assert } = require('./test-helper.js');
const G = require('./openai-gateway.js');

// --- fixtures ------------------------------------------------------------

// Shaped like the real registry, small enough to reason about.
function fakeRegistry({ keys = { GROQ_API_KEY: 'gk', OPENROUTER_API_KEY: 'ok', GEMINI_API_KEY: 'mk' }, quota = {} } = {}) {
  const PROVIDERS = {
    ollama: { key: null, url: 'http://127.0.0.1:11434/api/generate', models: { local: 'qwen2.5:3b', localBig: 'qwen2.5:7b' }, dailyLimit: null, native: true },
    groq: { key: 'GROQ_API_KEY', url: 'https://groq.example/v1/chat/completions', models: { fast: 'g-20b', smart: 'g-120b' }, dailyLimit: 1000 },
    openrouter: { key: 'OPENROUTER_API_KEY', url: 'https://or.example/v1/chat/completions', models: { fast: 'or-fast:free' }, dailyLimit: 50 },
    gemini: { key: 'GEMINI_API_KEY', url: 'https://gem.example/{model}:generateContent', models: { quality: 'gem-flash' }, dailyLimit: 20, gemini: true },
  };
  const TIERS = {
    local: [['ollama', 'local']],
    fast: [['groq', 'fast'], ['openrouter', 'fast'], ['ollama', 'local']],
    smart: [['groq', 'smart'], ['ollama', 'localBig']],
    quality: [['gemini', 'quality'], ['groq', 'smart'], ['ollama', 'localBig']],
  };
  const bumps = [];
  return {
    PROVIDERS, TIERS, bumps,
    loadKey: (k) => keys[k] || null,
    available: (n) => !PROVIDERS[n].key || !!keys[PROVIDERS[n].key],
    quotaLeft: (n) => (n in quota ? quota[n] : Infinity),
    bumpQuota: (n) => { bumps.push(n); return bumps.length; },
  };
}

function reply(status, obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
function answer(content, { finish = 'stop', toolCalls, usage = { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } } = {}) {
  const message = { role: 'assistant', content };
  if (toolCalls) message.tool_calls = toolCalls;
  return reply(200, { choices: [{ index: 0, message, finish_reason: finish }], usage });
}

/** fetch that answers each URL from `routes` (substring -> fn), and records every call. */
function scriptedFetch(routes, { tags = null } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    if (url.endsWith('/api/tags')) {
      if (!tags) throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      return reply(200, { models: tags.map((name) => ({ name })) });
    }
    const call = { url, init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unscripted fetch ${url}`);
    return routes[key](call);
  };
  f.calls = calls;
  return f;
}

function fakeReq({ method = 'POST', url = '/v1/chat/completions', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const r = Readable.from(chunks);
  r.method = method;
  r.url = url;
  r.headers = { host: '127.0.0.1:8010', 'content-type': 'application/json', ...headers };
  return r;
}

// Mirrors what the handler relies on from http.ServerResponse -- including
// that 'close' fires after end(), which the abort wiring must not mistake for
// a client hanging up.
function fakeRes() {
  const res = new EventEmitter();
  res.status = null;
  res.headers = {};
  res.chunks = [];
  res.writableEnded = false;
  res.headersSent = false;
  res.writeHead = (s, h) => { res.status = s; res.headers = h || {}; res.headersSent = true; return res; };
  res.write = (c) => { if (res.writableEnded) throw new Error('write after end'); res.chunks.push(String(c)); return true; };
  res.end = (c) => { if (res.writableEnded) throw new Error('end after end'); if (c !== undefined) res.chunks.push(String(c)); res.writableEnded = true; res.emit('close'); };
  res.text = () => res.chunks.join('');
  res.json = () => JSON.parse(res.text());
  return res;
}

// The same line rule as StarNet's parseLine(): blank and ':' lines are
// skipped, only `data:` lines count, `[DONE]` is the sentinel.
function sseEvents(text) {
  return text.split('\n').map((l) => l.trim())
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .map((d) => (d === '[DONE]' ? '[DONE]' : JSON.parse(d)));
}

function gateway(over = {}) {
  const logs = [];
  const gw = G.createGateway({
    registry: over.registry || fakeRegistry(),
    fetch: over.fetch || scriptedFetch({}),
    isStopped: over.isStopped || (() => false),
    apiKey: over.apiKey != null ? over.apiKey : '',
    keepaliveMs: over.keepaliveMs != null ? over.keepaliveMs : 0,
    cloudTimeoutMs: over.cloudTimeoutMs,
    localTimeoutMs: over.localTimeoutMs,
    now: () => 1700000000000,
    newId: () => 'chatcmpl-test',
    log: (l) => logs.push(l),
  });
  gw.logs = logs;
  return gw;
}

async function call(gw, reqOpts) {
  const res = fakeRes();
  await gw.handle(fakeReq(reqOpts), res);
  return res;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = [{ role: 'user', content: 'hi' }];
const TOOL = [{ type: 'function', function: { name: 'fs_read', parameters: { type: 'object', properties: {} } } }];

process.exitCode = 1;   // a run that never reaches finish() must not exit 0

(async () => {

// --- routing -------------------------------------------------------------

await test('REAL registry: every alias app.py accepts resolves to a non-empty chain', () => {
  const reg = require('./providers/registry.js');
  for (const alias of Object.keys(G.TIER_ALIASES)) {
    const r = G.resolveRoute(alias, reg);
    assert.ok(r && r.chain.length > 0, `alias "${alias}" resolved to nothing`);
  }
});

await test('REAL registry: every tier chain ends on local ollama (boots with zero cloud keys)', () => {
  const reg = require('./providers/registry.js');
  for (const alias of Object.keys(G.TIER_ALIASES)) {
    const chain = G.resolveRoute(alias, reg).chain;
    assert.strictEqual(chain[chain.length - 1].provider, 'ollama', `tier "${alias}" has no local floor`);
  }
});

await test('REAL app.py: the gateway maps every tier name exactly as app.py\'s /v1 does', () => {
  // app.py is read, never written. If its tier_map gains or changes a name,
  // the two endpoints would silently disagree about what "fast" means.
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.py'), 'utf8');
  const block = (name) => {
    const m = new RegExp(`${name} = \\{([\\s\\S]*?)\\}`).exec(src);
    assert.ok(m, `app.py has no ${name}`);
    return Object.fromEntries([...m[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((x) => [x[1], x[2]]));
  };
  const tierMap = block('tier_map');
  const tierToModel = block('tier_to_model');
  assert.ok(Object.keys(tierMap).length >= 5, 'tier_map parse found too few entries');
  const reg = require('./providers/registry.js');
  for (const [alias, tier] of Object.entries(tierMap)) {
    const target = tierToModel[tier];
    // app.py's "local" is a bare ollama model; everything else is registry:<tier>.
    const expectTier = target.startsWith('registry:') ? target.slice('registry:'.length) : 'local';
    assert.strictEqual(G.resolveRoute(alias, reg).tier, expectTier, `"${alias}"`);
  }
  assert.deepStrictEqual(Object.keys(G.TIER_ALIASES).sort(), Object.keys(tierMap).sort());
});

await test('an empty model means fast, as on app.py', () => {
  assert.strictEqual(G.resolveRoute('', fakeRegistry()).tier, 'fast');
  assert.strictEqual(G.resolveRoute(undefined, fakeRegistry()).tier, 'fast');
});

await test('$0: a cloud model registry.js does not list is REFUSED, not rerouted', () => {
  const reg = fakeRegistry();
  assert.strictEqual(G.resolveRoute('openrouter/openai/gpt-4o', reg), null);
  assert.strictEqual(G.resolveRoute('groq/some-paid-model', reg), null);
  assert.strictEqual(G.resolveRoute('openai/gpt-4o', reg), null);
  assert.strictEqual(G.resolveRoute('anthropic/claude', reg), null);
});

await test('pinned: a listed cloud model is exactly one hop, no fallback', () => {
  const r = G.resolveRoute('groq/g-120b', fakeRegistry());
  assert.deepStrictEqual(r.chain, [{ provider: 'groq', model: 'g-120b' }]);
  assert.strictEqual(r.kind, 'pinned');
});

await test('pinned: any ollama model is allowed -- local costs nothing', () => {
  const r = G.resolveRoute('ollama/qwen3:4b', fakeRegistry());
  assert.deepStrictEqual(r.chain, [{ provider: 'ollama', model: 'qwen3:4b' }]);
});

await test('an inherited property name is not a provider or a tier', () => {
  assert.strictEqual(G.resolveRoute('constructor', fakeRegistry()), null);
  assert.strictEqual(G.resolveRoute('toString/x', fakeRegistry()), null);
});

// --- request cleanup -----------------------------------------------------

await test('messages: StarNet\'s internal fields are stripped (the handoff\'s fix #10)', () => {
  const out = G.sanitizeMessages([{ role: 'user', content: 'x', agentId: 'raqib', runId: 7, ts: 1 }]);
  assert.deepStrictEqual(out, [{ role: 'user', content: 'x' }]);
});

await test('messages: system and history pass through in order, not just the last user turn', () => {
  const msgs = [
    { role: 'system', content: 'You are Raqib.' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ];
  assert.deepStrictEqual(G.sanitizeMessages(msgs), msgs);
});

await test('messages: text-only part arrays become a string; image parts survive, stripped', () => {
  const [a, b] = G.sanitizeMessages([
    { role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'b' }] },
    { role: 'user', content: [{ type: 'text', text: 'look', cache_control: {} }, { type: 'image_url', image_url: { url: 'data:x' }, junk: 1 }] },
  ]);
  assert.strictEqual(a.content, 'a\nb');
  assert.deepStrictEqual(b.content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:x' } }]);
});

await test('messages: tool calls are normalized -- index dropped, object arguments stringified', () => {
  const [m] = G.sanitizeMessages([{ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: { a: 1 } } }] }]);
  assert.deepStrictEqual(m.tool_calls, [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }]);
  assert.strictEqual(m.content, null, 'a null content next to tool calls is the caller\'s to keep');
});

await test('messages: developer role becomes system', () => {
  assert.strictEqual(G.sanitizeMessages([{ role: 'developer', content: 'x' }])[0].role, 'system');
});

await test('messages: empty, missing or role-less lists throw', () => {
  assert.throws(() => G.sanitizeMessages([]), /non-empty/);
  assert.throws(() => G.sanitizeMessages(undefined), /non-empty/);
  assert.throws(() => G.sanitizeMessages([{ content: 'x' }]), /messages\[0\] has no role/);
});

await test('upstream body: client-leg and disputed params are dropped, tools kept', () => {
  const b = G.buildUpstreamBody({
    stream: true, stream_options: { include_usage: true }, reasoning_effort: 'high', parallel_tool_calls: true,
    temperature: 0.2, top_p: 0.9, stop: ['x'], max_completion_tokens: 256.7, tools: TOOL, tool_choice: 'auto', agentId: 'z',
  }, USER);
  assert.deepStrictEqual(Object.keys(b).sort(), ['max_tokens', 'messages', 'stop', 'stream', 'temperature', 'tool_choice', 'tools', 'top_p']);
  assert.strictEqual(b.stream, false, 'upstream is never streamed');
  assert.strictEqual(b.max_tokens, 256);
});

await test('upstream body: tool_choice without tools is dropped (strict servers 400 on it)', () => {
  const b = G.buildUpstreamBody({ tool_choice: 'auto', tools: [] }, USER);
  assert.ok(!('tool_choice' in b) && !('tools' in b));
});

// --- chat, non-streamed --------------------------------------------------

await test('non-stream: answers from the first provider, with that provider\'s model', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('hello') });
  const gw = gateway({ fetch });
  const res = await call(gw, { body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 200);
  const j = res.json();
  assert.strictEqual(j.choices[0].message.content, 'hello');
  assert.strictEqual(j.choices[0].finish_reason, 'stop');
  assert.strictEqual(j.model, 'fast');
  assert.deepStrictEqual(j.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  assert.strictEqual(res.headers['X-Jarvis-Provider'], 'groq');
  assert.strictEqual(fetch.calls[0].body.model, 'g-20b');
  assert.strictEqual(fetch.calls[0].init.headers.authorization, 'Bearer gk');
});

await test('fallback: a failing provider falls through to the next, and both are counted', async () => {
  const reg = fakeRegistry();
  const fetch = scriptedFetch({ 'groq.example': () => reply(429, { error: 'rate' }), 'or.example': () => answer('from openrouter') });
  const res = await call(gateway({ registry: reg, fetch }), { body: { model: 'fast', messages: USER } });
  const j = res.json();
  assert.strictEqual(j.choices[0].message.content, 'from openrouter');
  assert.strictEqual(j.x_jarvis.provider, 'openrouter');
  assert.ok(/groq\(HTTP 429/.test(j.x_jarvis.tried[0]));
  assert.deepStrictEqual(reg.bumps, ['groq', 'openrouter'], 'an answered call is a spent call, 429 included');
});

await test('fallback: a keyless provider is skipped WITHOUT a request', async () => {
  const reg = fakeRegistry({ keys: {} });
  const fetch = scriptedFetch({ '11434/v1/chat/completions': () => answer('local') });
  const j = (await call(gateway({ registry: reg, fetch }), { body: { model: 'fast', messages: USER } })).json();
  assert.strictEqual(j.x_jarvis.provider, 'ollama');
  assert.deepStrictEqual(fetch.calls.map((c) => c.url), [G.OLLAMA_CHAT_URL]);
  assert.deepStrictEqual(j.x_jarvis.tried, ['groq(no key)', 'openrouter(no key)']);
});

await test('fallback: an exhausted daily quota is skipped WITHOUT a request', async () => {
  const reg = fakeRegistry({ quota: { groq: 0 } });
  const fetch = scriptedFetch({ 'or.example': () => answer('ok') });
  const j = (await call(gateway({ registry: reg, fetch }), { body: { model: 'fast', messages: USER } })).json();
  assert.strictEqual(j.x_jarvis.provider, 'openrouter');
  assert.ok(!fetch.calls.some((c) => c.url.includes('groq')));
});

await test('an empty answer is a failure, not a success -- it falls through', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('   '), 'or.example': () => answer('real') });
  const j = (await call(gateway({ fetch }), { body: { model: 'fast', messages: USER } })).json();
  assert.strictEqual(j.choices[0].message.content, 'real');
});

await test('all providers down -> 503 naming every one, never a 200 with nothing in it', async () => {
  const fetch = scriptedFetch({
    'groq.example': () => reply(500, 'boom'), 'or.example': () => { throw new Error('ENOTFOUND'); },
    '11434': () => reply(404, { error: 'model not found' }),
  });
  const res = await call(gateway({ fetch }), { body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 503);
  const msg = res.json().error.message;
  for (const p of ['groq', 'openrouter', 'ollama']) assert.ok(msg.includes(p), `${p} missing from: ${msg}`);
});

await test('gemini goes to its OpenAI-compatible URL with a bearer key', async () => {
  const fetch = scriptedFetch({ 'generativelanguage.googleapis.com': () => answer('gem') });
  await call(gateway({ fetch }), { body: { model: 'quality', messages: USER } });
  assert.strictEqual(fetch.calls[0].url, G.GEMINI_CHAT_URL);
  assert.strictEqual(fetch.calls[0].body.model, 'gem-flash');
  assert.strictEqual(fetch.calls[0].init.headers.authorization, 'Bearer mk');
});

await test('ollama goes to its /v1 chat endpoint with no auth header', async () => {
  const fetch = scriptedFetch({ '11434': () => answer('local') });
  await call(gateway({ fetch }), { body: { model: 'local', messages: USER } });
  assert.strictEqual(fetch.calls[0].url, G.OLLAMA_CHAT_URL);
  assert.ok(!('authorization' in fetch.calls[0].init.headers));
});

await test('what reaches upstream is the cleaned conversation plus tools', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('ok') });
  const messages = [{ role: 'system', content: 'You are Raqib.', agentId: 'r' }, { role: 'user', content: 'go', agentId: 'r' }];
  await call(gateway({ fetch }), { body: { model: 'fast', messages, tools: TOOL, stream_options: { include_usage: true } } });
  const b = fetch.calls[0].body;
  assert.deepStrictEqual(b.messages, [{ role: 'system', content: 'You are Raqib.' }, { role: 'user', content: 'go' }]);
  assert.deepStrictEqual(b.tools, TOOL);
  assert.ok(!('stream_options' in b));
});

await test('tool calls come back in OpenAI shape with finish_reason tool_calls', async () => {
  const tc = [{ id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{}' } }];
  // Some Ollama builds label a tool-call turn `stop`; the client must still see tool_calls.
  const fetch = scriptedFetch({ 'groq.example': () => answer(null, { toolCalls: tc, finish: 'stop' }) });
  const j = (await call(gateway({ fetch }), { body: { model: 'fast', messages: USER, tools: TOOL } })).json();
  assert.deepStrictEqual(j.choices[0].message.tool_calls, tc);
  assert.strictEqual(j.choices[0].message.content, null);
  assert.strictEqual(j.choices[0].finish_reason, 'tool_calls');
});

await test('a cut-off answer stays cut off: length survives, even beside tool calls', async () => {
  const tc = [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":' } }];
  const fetch = scriptedFetch({ 'groq.example': () => answer('part', { toolCalls: tc, finish: 'length' }) });
  const j = (await call(gateway({ fetch }), { body: { model: 'fast', messages: USER } })).json();
  assert.strictEqual(j.choices[0].finish_reason, 'length');
});

await test('no upstream usage -> no usage field, never an invented count', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('x', { usage: null }) });
  const j = (await call(gateway({ fetch }), { body: { model: 'fast', messages: USER } })).json();
  assert.ok(!('usage' in j));
});

await test('a hung provider times out and the chain moves on', async () => {
  const hang = ({ init }) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const fetch = scriptedFetch({ 'groq.example': hang, 'or.example': () => answer('after timeout') });
  const j = (await call(gateway({ fetch, cloudTimeoutMs: 20 }), { body: { model: 'fast', messages: USER } })).json();
  assert.strictEqual(j.choices[0].message.content, 'after timeout');
  assert.ok(/groq\(timed out after/.test(j.x_jarvis.tried[0]), j.x_jarvis.tried[0]);
});

// --- chat, streamed (StarNet's only mode) ---------------------------------

await test('REGRESSION: stream -> SSE role, content, finish, usage, [DONE] -- what StarNet parses', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('hello') });
  const res = await call(gateway({ fetch }), { body: { model: 'fast', messages: USER, stream: true, stream_options: { include_usage: true } } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers['Content-Type'].startsWith('text/event-stream'));
  const ev = sseEvents(res.text());
  assert.deepStrictEqual(ev[0].choices[0].delta, { role: 'assistant', content: '' });
  assert.strictEqual(ev[1].choices[0].delta.content, 'hello');
  assert.strictEqual(ev[2].choices[0].finish_reason, 'stop');
  assert.deepStrictEqual(ev[3].choices, []);
  assert.strictEqual(ev[3].usage.total_tokens, 7);
  assert.strictEqual(ev[4], '[DONE]');
  assert.strictEqual(ev.length, 5);
  for (const e of ev.slice(0, 4)) assert.strictEqual(e.object, 'chat.completion.chunk');
});

await test('stream: no usage chunk unless the client asked for one', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('hello') });
  const ev = sseEvents((await call(gateway({ fetch }), { body: { model: 'fast', messages: USER, stream: true } })).text());
  assert.ok(!ev.some((e) => e && e.usage));
});

await test('REGRESSION: headers and the role chunk go out BEFORE the upstream call returns', async () => {
  // StarNet aborts when headers take longer than 30s. Hold the upstream
  // open and look at the response while it is still pending.
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = scriptedFetch({ 'groq.example': async () => { await gate; return answer('late'); } });
  const res = fakeRes();
  const done = gateway({ fetch }).handle(fakeReq({ body: { model: 'fast', messages: USER, stream: true } }), res);
  await tick(20);
  assert.strictEqual(res.status, 200, 'headers must not wait for the model');
  assert.strictEqual(sseEvents(res.text()).length, 1, 'only the role chunk so far');
  release();
  await done;
  assert.strictEqual(sseEvents(res.text()).pop(), '[DONE]');
});

await test('stream: keepalive comments flow while waiting, and stop once the stream ends', async () => {
  const fetch = scriptedFetch({ 'groq.example': async () => { await tick(60); return answer('slow'); } });
  const res = fakeRes();
  await gateway({ fetch, keepaliveMs: 10 }).handle(fakeReq({ body: { model: 'fast', messages: USER, stream: true } }), res);
  const text = res.text();
  assert.ok(/: keepalive\n\n/.test(text), 'no keepalive written during a 60ms wait');
  const n = res.chunks.length;
  await tick(40);
  assert.strictEqual(res.chunks.length, n, 'the keepalive timer outlived the stream');
  assert.strictEqual(sseEvents(text).pop(), '[DONE]');
});

await test('stream: the keepalive interval is CLEARED, not just silenced', async () => {
  // The write is guarded by writableEnded, so a leaked interval writes
  // nothing and the test above cannot see it -- but a server leaks one timer
  // per request, forever. Count live timers instead. (getActiveResourcesInfo
  // sees timers; process._getActiveHandles does not -- see HANDOFF.md,
  // 2026-09-10T03:00Z.)
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.strictEqual(typeof process.getActiveResourcesInfo, 'function');
  const probe = setInterval(() => {}, 1000);
  assert.ok(timers() >= 1, 'getActiveResourcesInfo stopped reporting timers; this test would be vacuous');
  clearInterval(probe);
  const fetch = scriptedFetch({ 'groq.example': async () => { await tick(30); return answer('x'); } });
  const before = timers();
  await gateway({ fetch, keepaliveMs: 5 }).handle(fakeReq({ body: { model: 'fast', messages: USER, stream: true } }), fakeRes());
  assert.strictEqual(timers(), before, 'a timer survived the request');
});

await test('stream: parallel tool calls carry indices 0..n and finish tool_calls', async () => {
  const tc = [
    { id: 'a', type: 'function', function: { name: 'fs_read', arguments: '{"p":1}' } },
    { id: 'b', type: 'function', function: { name: 'fs_read', arguments: '{"p":2}' } },
  ];
  const fetch = scriptedFetch({ 'groq.example': () => answer(null, { toolCalls: tc, finish: 'tool_calls' }) });
  const ev = sseEvents((await call(gateway({ fetch }), { body: { model: 'fast', messages: USER, tools: TOOL, stream: true } })).text());
  const calls = ev[1].choices[0].delta.tool_calls;
  assert.deepStrictEqual(calls.map((c) => [c.index, c.id, c.function.arguments]), [[0, 'a', '{"p":1}'], [1, 'b', '{"p":2}']]);
  assert.strictEqual(ev[2].choices[0].finish_reason, 'tool_calls');
  assert.ok(!ev.some((e) => e.choices && e.choices[0] && 'content' in e.choices[0].delta && e.choices[0].delta.content !== ''),
    'a tool-only turn must not emit a content chunk');
});

await test('stream: total failure is an in-stream ERROR object, never an empty "done"', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => reply(500, 'x'), 'or.example': () => reply(500, 'x'), '11434': () => reply(500, 'x') });
  const ev = sseEvents((await call(gateway({ fetch }), { body: { model: 'fast', messages: USER, stream: true } })).text());
  assert.ok(ev[1].error && /All providers failed/.test(ev[1].error.message));
  assert.strictEqual(ev[2], '[DONE]');
  assert.ok(!ev.some((e) => e.choices && e.choices[0] && e.choices[0].finish_reason), 'no finish chunk on a failed run');
});

await test('a client hang-up aborts the upstream call and nothing more is written', async () => {
  let sawAbort = false;
  const fetch = scriptedFetch({
    'groq.example': ({ init }) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => { sawAbort = true; rej(new Error('aborted')); })),
  });
  const res = fakeRes();
  const gw = gateway({ fetch });
  const done = gw.handle(fakeReq({ body: { model: 'fast', messages: USER, stream: true } }), res);
  await tick(10);
  const before = res.chunks.length;
  res.emit('close');   // socket gone, response never ended
  await done;
  assert.ok(sawAbort, 'upstream call was not aborted');
  assert.strictEqual(res.chunks.length, before, 'wrote to a closed client');
  assert.strictEqual(fetch.calls.length, 1, 'fell through to the next provider for nobody');
  assert.ok(gw.logs.some((l) => /client-closed/.test(l)));
});

// --- refusals ------------------------------------------------------------

await test('KILL SWITCH: 503 and no provider is called', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('should not happen') });
  const res = await call(gateway({ fetch, isStopped: () => true }), { body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.json().error.code, 'kill_switch');
  assert.strictEqual(fetch.calls.length, 0);
});

await test('KILL SWITCH: the default reads guard.js, the one switch every other path reads', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openai-gateway.js'), 'utf8');
  assert.ok(/require\('\.\/guard\.js'\)\.isStopped\(\)/.test(src));
});

await test('/health reports a pulled kill switch as 503', async () => {
  const res = await call(gateway({ isStopped: () => true }), { method: 'GET', url: '/health' });
  assert.strictEqual(res.status, 503);
  assert.deepStrictEqual(res.json(), { ok: false, stopped: true });
});

await test('a non-JSON content type is refused (no CORS-free browser POST can spend quota)', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('x') });
  const res = await call(gateway({ fetch }), { headers: { 'content-type': 'text/plain' }, body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 415);
  assert.strictEqual(fetch.calls.length, 0);
});

await test('a foreign Host header is refused (DNS rebinding)', async () => {
  const res = await call(gateway(), { headers: { host: 'evil.example:8010' }, body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await call(gateway(), { headers: { host: undefined }, method: 'GET', url: '/v1/models' })).status, 403);
  for (const h of ['127.0.0.1:8010', 'localhost:8010', '[::1]:8010', 'LOCALHOST']) assert.ok(G.hostAllowed(h), h);
  assert.ok(!G.hostAllowed('127.0.0.1.evil.example'));
});

await test('JX_GATEWAY_KEY set: missing or wrong bearer is 401, the right one passes', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('x') });
  const gw = gateway({ fetch, apiKey: 's3cret' });
  assert.strictEqual((await call(gw, { body: { model: 'fast', messages: USER } })).status, 401);
  assert.strictEqual((await call(gw, { headers: { authorization: 'Bearer nope' }, body: { model: 'fast', messages: USER } })).status, 401);
  assert.strictEqual((await call(gw, { headers: { authorization: 'Bearer s3cret' }, body: { model: 'fast', messages: USER } })).status, 200);
  assert.strictEqual(fetch.calls.length, 1);
});

await test('no JX_GATEWAY_KEY: any bearer (StarNet sends one) is accepted', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('x') });
  const res = await call(gateway({ fetch }), { headers: { authorization: 'Bearer sk-jarvis-local' }, body: { model: 'fast', messages: USER } });
  assert.strictEqual(res.status, 200);
});

await test('an unknown model is a 404 that names the valid ids', async () => {
  const fetch = scriptedFetch({});
  const res = await call(gateway({ fetch }), { body: { model: 'openai/gpt-4o', messages: USER } });
  assert.strictEqual(res.status, 404);
  assert.ok(/Known: fast, smart/.test(res.json().error.message));
  assert.strictEqual(fetch.calls.length, 0);
});

await test('bad bodies: invalid JSON 400, non-object 400, missing messages 400, oversized 413', async () => {
  assert.strictEqual((await call(gateway(), { body: '{not json' })).status, 400);
  assert.strictEqual((await call(gateway(), { body: '[1,2]' })).status, 400);
  assert.strictEqual((await call(gateway(), { body: { model: 'fast' } })).status, 400);
  const big = await call(gateway(), { body: JSON.stringify({ model: 'fast', messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }] }) });
  assert.strictEqual(big.status, 413);
});

await test('unknown routes are 404', async () => {
  assert.strictEqual((await call(gateway(), { method: 'GET', url: '/v1/embeddings' })).status, 404);
  assert.strictEqual((await call(gateway(), { method: 'GET', url: '/v1/chat/completions' })).status, 404);
});

await test('the log line carries routes and counts, NEVER message content', async () => {
  const fetch = scriptedFetch({ 'groq.example': () => answer('ANSWER-TEXT') });
  const gw = gateway({ fetch });
  await call(gw, { body: { model: 'fast', messages: [{ role: 'user', content: 'SECRET-PAYLOAD' }] } });
  assert.strictEqual(gw.logs.length, 1);
  assert.ok(/fast -> groq\/g-20b/.test(gw.logs[0]), gw.logs[0]);
  assert.ok(!/SECRET-PAYLOAD|ANSWER-TEXT/.test(gw.logs[0]));
});

// --- /v1/models ------------------------------------------------------------

await test('/v1/models: fast is FIRST (StarNet\'s key check test-streams models[0] in 15s)', async () => {
  const j = (await call(gateway(), { method: 'GET', url: '/v1/models' })).json();
  assert.strictEqual(j.object, 'list');
  assert.strictEqual(j.data[0].id, 'fast');
  assert.deepStrictEqual(j.data.slice(0, 5).map((m) => m.id), G.TIER_ORDER);
  for (const m of j.data.slice(0, 5)) assert.strictEqual(m.supportsTools, true);
});

await test('/v1/models: pinned cloud ids only for providers with a key', async () => {
  const ids = (await call(gateway({ registry: fakeRegistry({ keys: { GROQ_API_KEY: 'g' } }) }), { method: 'GET', url: '/v1/models' })).json().data.map((m) => m.id);
  assert.ok(ids.includes('groq/g-20b') && ids.includes('groq/g-120b'));
  assert.ok(!ids.some((i) => i.startsWith('openrouter/') || i.startsWith('gemini/')));
});

await test('/v1/models: pulled ollama models appear; a dead daemon leaves the registry two', async () => {
  const up = (await call(gateway({ fetch: scriptedFetch({}, { tags: ['qwen2.5:3b', 'qwen3:4b'] }) }), { method: 'GET', url: '/v1/models' })).json().data;
  assert.ok(up.some((m) => m.id === 'ollama/qwen3:4b'));
  assert.strictEqual(up.filter((m) => m.id === 'ollama/qwen2.5:3b').length, 1, 'duplicate id');
  const down = (await call(gateway({ fetch: scriptedFetch({}) }), { method: 'GET', url: '/v1/models' })).json().data;
  assert.deepStrictEqual(down.filter((m) => m.id.startsWith('ollama/')).map((m) => m.id), ['ollama/qwen2.5:3b', 'ollama/qwen2.5:7b']);
});

await test('/v1/models: tool support is claimed only where documented, never guessed', async () => {
  const data = (await call(gateway({ fetch: scriptedFetch({}, { tags: ['qwen3:4b'] }) }), { method: 'GET', url: '/v1/models' })).json().data;
  const by = Object.fromEntries(data.map((m) => [m.id, m]));
  assert.strictEqual(by['groq/g-20b'].supportsTools, true);
  assert.strictEqual(by['ollama/qwen2.5:3b'].supportsTools, true);
  assert.ok(!('supportsTools' in by['openrouter/or-fast:free']), 'unknown must be absent, not true');
  assert.ok(!('supportsTools' in by['ollama/qwen3:4b']));
});

// --- wiring ----------------------------------------------------------------

await test('REAL registry.js exports bumpQuota, so both paths count one quota', () => {
  const reg = require('./providers/registry.js');
  for (const fn of ['loadKey', 'available', 'quotaLeft', 'bumpQuota']) assert.strictEqual(typeof reg[fn], 'function', fn);
  assert.strictEqual(G.createGateway({ log: () => {} }).deps.registry, reg);
});

await test('REAL config: the default port is not one another Jarvis service already binds', () => {
  // The first version shipped on 8001 -- tts-worker's port -- because nothing
  // checked. Read the port out of every file that binds or calls one, so a
  // new service on 8010 fails here instead of on the Chromebook.
  const root = path.join(__dirname, '..');
  const taken = new Set();
  const scan = (rel, re) => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const found = [...src.matchAll(re)].map((m) => Number(m[1]));
    assert.ok(found.length > 0, `no port found in ${rel}; the pattern went stale`);
    for (const p of found) taken.add(p);
  };
  scan('app.py', /127\.0\.0\.1:(\d{4,5})/g);
  scan('code/tts_worker.py', /port=(\d{4,5})/g);
  scan('code/reply/tools/weather.py', /127\.0\.0\.1:(\d{4,5})/g);
  scan('config/supervisord.conf', /--port (\d{4,5})/g);
  for (const p of [8001, 8000, 8002]) assert.ok(taken.has(p), `expected ${p} among the scanned ports`);
  assert.ok(!taken.has(G.DEFAULT_PORT), `port ${G.DEFAULT_PORT} is already taken by a Jarvis service`);
  assert.notStrictEqual(G.DEFAULT_PORT, 8787, 'StarNet itself listens on 8787');
});

await test('a taken port says which one and how to move it, and flags a failed start', () => {
  const logs = [];
  let fatal = null;
  const fake = new EventEmitter();
  fake.listen = () => fake;
  G.serve({ port: 8010, createServer: () => fake, onFatal: (e) => { fatal = e; }, log: (l) => logs.push(l) });
  const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  fake.emit('error', err);
  assert.strictEqual(fatal, err);
  assert.ok(/port 8010 is already in use -- set JX_GATEWAY_PORT/.test(logs.join('\n')), logs.join('\n'));
});

await test('binds loopback only', () => {
  assert.strictEqual(G.HOST, '127.0.0.1');
  const src = fs.readFileSync(path.join(__dirname, 'openai-gateway.js'), 'utf8');
  assert.ok(/server\.listen\(port, HOST,/.test(src));
  assert.ok(!/0\.0\.0\.0['"]/.test(src.replace(/\/\/.*$/gm, '')));
});

finish();
})();
