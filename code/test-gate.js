// SCHEMA v5 AND THE GATE — PLAN_5 §3 item 2.
//
// `confidence` + `approved_by` are what turn the audit log from a record into
// a gate. This suite exists for ONE property above all others, and it is worth
// stating before any code:
//
//     ABSENCE MUST NEVER READ AS APPROVAL.
//
// The plan says why in one line: "a guessed 1.0 on old rows is a lie the gate
// would then trust". There were 2810 pre-v5 rows in the log on the machine
// where v3 was written. Not one of them was ever approved by anybody, because
// there was nowhere to record an approval. A gate that defaults them high
// waves through all 2810; one that defaults them low passes judgement on
// history it cannot see. The only honest answer is a third value, and most of
// the assertions below are there to stop that third value collapsing back into
// one of the other two.
//
// The second property, one step finer: `pre-v5` and `not-claimed` are
// different unknowns. The first is a permanent schema limit; the second is a
// live call site that should be passing the field. Collapsing them hides the
// fixable half behind the unfixable half.
//
// Offline: test-helper redirects the audit log to a temp file, so nothing here
// writes to the real logs/actions.jsonl.
const fs = require('fs');
const { test, finish, assert } = require('./test-helper.js');
const G = require('./guard.js');

// See test-status.js: a suite that truncates instead of failing exits 0 and
// prints no tally, which reads as green.
process.exitCode = 1;

/** Rows as they appear on disk at each schema version. */
const v2row = { schema: 'v2', action: 'shell', allowed: true };
const v4row = { schema: 'v4', action: 'shell', allowed: true, origin: 'app', actor: 'agent' };
const v5bare = { schema: 'v5', action: 'shell', allowed: true, origin: 'app', actor: 'agent' };
const v5full = { ...v5bare, confidence: 0.9, approved_by: 'human' };

// The temp audit log does not exist until the first append, so a read before
// any write must be empty rather than ENOENT.
const readLog = () => (fs.existsSync(G.currentLogFile())
  ? fs.readFileSync(G.currentLogFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

// --- THE property ----------------------------------------------------------

(async () => {

await test('a pre-v5 row is UNKNOWN to the gate, never approved', () => {
  // The 2810-row case. If this ever returns 'approved', every action anyone
  // took before v5 existed is retroactively authorised by a default nobody chose.
  assert.strictEqual(G.gateVerdict(v4row), 'unknown');
  assert.strictEqual(G.gateVerdict(v2row), 'unknown');
  assert.strictEqual(G.gateVerdict({}), 'unknown');
  assert.strictEqual(G.gateVerdict(null), 'unknown');
});

await test('a pre-v5 row reports NO confidence value at all, not a default', () => {
  const c = G.readConfidence(v4row);
  assert.strictEqual(c.known, false);
  assert.strictEqual(c.reason, 'pre-v5');
  assert.ok(!('value' in c), 'a value key at all invites `?? 1.0` at the call site');
});

await test('the two kinds of unknown are distinguishable', () => {
  // pre-v5: the log could not record it — permanent, nothing to fix.
  assert.strictEqual(G.readConfidence(v4row).reason, 'pre-v5');
  assert.strictEqual(G.readApproval(v4row).reason, 'pre-v5');
  // not-claimed: a live v5 call site said nothing — a real thing to go fix.
  assert.strictEqual(G.readConfidence(v5bare).reason, 'not-claimed');
  assert.strictEqual(G.readApproval(v5bare).reason, 'not-claimed');
  // Both still gate to unknown; the distinction is for the human reading it.
  assert.strictEqual(G.gateVerdict(v5bare), 'unknown');
});

await test('the verdict is three-valued, so absence cannot ride in as a boolean', () => {
  // `if (approved)` on a boolean makes absence indistinguishable from refusal,
  // and whichever way it falls, one of the two is silently wrong.
  for (const row of [v4row, v5bare, v5full, { ...v5full, confidence: 0.1 }]) {
    const v = G.gateVerdict(row);
    assert.ok(['approved', 'refused', 'unknown'].includes(v), `bad verdict ${v}`);
    assert.notStrictEqual(typeof v, 'boolean');
  }
});

// --- the ordinary cases ----------------------------------------------------

await test('a fully-claimed row above the bar is approved', () => {
  assert.strictEqual(G.gateVerdict(v5full), 'approved');
  assert.deepStrictEqual(G.readConfidence(v5full), { known: true, value: 0.9 });
  assert.deepStrictEqual(G.readApproval(v5full), { known: true, value: 'human' });
});

await test('below the confidence bar is refused, not unknown', () => {
  // Refused and unknown are different answers: this row DID make a claim and
  // the claim was not good enough. Reporting it as unknown would lose that.
  assert.strictEqual(G.gateVerdict({ ...v5full, confidence: 0.5 }), 'refused');
  assert.strictEqual(G.gateVerdict({ ...v5full, confidence: 0.79 }), 'refused');
  assert.strictEqual(G.gateVerdict({ ...v5full, confidence: 0.80 }), 'approved',
    'the bar is inclusive');
});

await test('an approver outside the allowed set is refused', () => {
  assert.strictEqual(G.gateVerdict({ ...v5full, approved_by: 'jarvis' }), 'refused',
    'the default allows only human — jarvis approving its own action is the thing to prevent');
  assert.strictEqual(
    G.gateVerdict({ ...v5full, approved_by: 'jarvis' }, { allow: ['human', 'jarvis'] }),
    'approved', 'a caller can widen it, but must say so in its own code');
});

await test('the default bar is the retire-grade 0.80, and callers can lower it explicitly', () => {
  const row = { ...v5full, confidence: 0.65 };
  assert.strictEqual(G.gateVerdict(row), 'refused');
  assert.strictEqual(G.gateVerdict(row, { minConfidence: 0.6 }), 'approved');
});

// --- malformed claims ------------------------------------------------------

await test('a malformed confidence is refused and RECORDED as refused, not dropped', () => {
  // Dropping it hides a call site passing nonsense; storing it lets the gate
  // compare against garbage. The row keeps the rejection instead.
  for (const bad of [1.5, -0.1, NaN, Infinity, 'high', null, {}]) {
    const row = G.normalizeClaim({ action: 'x', confidence: bad });
    assert.ok(!('confidence' in row), `${String(bad)} was stored as a confidence`);
    assert.ok('confidence_rejected' in row, `${String(bad)} vanished without trace`);
    assert.strictEqual(G.readConfidence({ schema: 'v5', ...row }).reason, 'rejected');
  }
});

await test('a valid confidence at either boundary survives normalisation', () => {
  assert.strictEqual(G.normalizeClaim({ confidence: 0 }).confidence, 0);
  assert.strictEqual(G.normalizeClaim({ confidence: 1 }).confidence, 1);
  assert.ok(!('confidence_rejected' in G.normalizeClaim({ confidence: 0 })),
    '0 is a real claim of no confidence, not a malformed one');
});

await test('an approver outside the closed set is refused and recorded as refused', () => {
  const row = G.normalizeClaim({ action: 'x', approved_by: 'ahmed' });
  assert.ok(!('approved_by' in row));
  assert.strictEqual(row.approved_by_rejected, 'ahmed');
  assert.strictEqual(G.readApproval({ schema: 'v5', ...row }).reason, 'rejected');
  // The vocabulary is CONSTITUTION.md §V's, not the memory template's.
  assert.deepStrictEqual(G.APPROVERS, ['human', 'jarvis']);
  assert.ok(!G.APPROVERS.includes('oracle'),
    'a third approver the written law does not name is a §VII amendment, not a constant');
});

await test('a rejected claim gates to unknown, never to approved', () => {
  const row = { schema: 'v5', ...G.normalizeClaim({ confidence: 99, approved_by: 'human' }) };
  assert.strictEqual(G.gateVerdict(row), 'unknown');
});

// --- schema parsing --------------------------------------------------------

await test('schemaVersion parses this log\'s versions and refuses everything else', () => {
  assert.strictEqual(G.schemaVersion('v5'), 5);
  assert.strictEqual(G.schemaVersion('v4'), 4);
  assert.strictEqual(G.schemaVersion('v2'), 2);
  assert.strictEqual(G.schemaVersion(undefined), 0, 'the oldest rows carry no schema at all');
  // agent.js writes `type-v2` to a DIFFERENT log. Mistaking it for this one's
  // v2 would be quietly wrong, so it parses to 0 rather than to 2.
  assert.strictEqual(G.schemaVersion('type-v2'), 0);
  assert.strictEqual(G.schemaVersion('5'), 0);
  assert.strictEqual(G.schemaVersion(5), 0);
});

// --- the writer: claims actually reach the log -----------------------------

await test('guard() records a claim on the success path', () => {
  const before = readLog().length;
  G.guard('gated-ok', 'quick', () => 'done', { confidence: 0.95, approved_by: 'human' });
  const row = readLog()[before];
  assert.strictEqual(row.schema, 'v5');
  assert.strictEqual(row.confidence, 0.95);
  assert.strictEqual(row.approved_by, 'human');
  assert.strictEqual(G.gateVerdict(row), 'approved');
});

await test('guard() records a claim on the ERROR path, which is the row worth reading', () => {
  const before = readLog().length;
  assert.throws(() => G.guard('gated-boom', 'quick', () => { throw new Error('inner failure'); },
    { confidence: 0.9, approved_by: 'human' }));
  const row = readLog()[before];
  assert.strictEqual(row.outcome, 'error');
  assert.strictEqual(row.approved_by, 'human',
    'an action that was authorised and then failed must still show who authorised it');
});

await test('guard() with no claim writes a row that reads as not-claimed', () => {
  const before = readLog().length;
  G.guard('unclaimed', 'quick', () => 1);
  const row = readLog()[before];
  assert.ok(!('confidence' in row), 'a missing claim must not be filled in');
  assert.strictEqual(G.readConfidence(row).reason, 'not-claimed');
  assert.strictEqual(G.gateVerdict(row), 'unknown');
});

await test('an async guard() carries the claim to the settled row', async () => {
  const before = readLog().length;
  await G.guard('gated-async', 'quick', async () => 'ok', { confidence: 0.85, approved_by: 'jarvis' });
  const row = readLog()[before];
  assert.strictEqual(row.async, true);
  assert.strictEqual(row.approved_by, 'jarvis');
});

await test('logAction carries a claim too', () => {
  const before = readLog().length;
  G.logAction('noted', 'quick', { allowed: true, confidence: 0.7, approved_by: 'jarvis' });
  const row = readLog()[before];
  assert.strictEqual(row.confidence, 0.7);
  assert.strictEqual(row.approved_by, 'jarvis');
});

await test('a claim object cannot smuggle extra keys into an audit row', () => {
  // Callers pass options bags around; only the two v5 fields may land in the log.
  assert.deepStrictEqual(
    G.claimFields({ confidence: 0.5, approved_by: 'human', allowed: true, actor: 'forged' }),
    { confidence: 0.5, approved_by: 'human' });
  assert.deepStrictEqual(G.claimFields(null), {});
  assert.deepStrictEqual(G.claimFields('nope'), {});

  const before = readLog().length;
  G.guard('no-smuggling', 'quick', () => 1, { approved_by: 'human', actor: 'forged', origin: 'test' });
  const row = readLog()[before];
  assert.notStrictEqual(row.actor, 'forged', 'actor is detected from argv, never supplied');
});

await test('the killswitch row records the claim, so a blocked authorised action is visible', () => {
  const stop = G.STOP_FILE;
  fs.writeFileSync(stop, '');
  try {
    const before = readLog().length;
    assert.throws(() => G.guard('blocked', 'quick', () => 1,
      { confidence: 1, approved_by: 'human' }), /Kill switch/);
    const row = readLog()[before];
    assert.strictEqual(row.outcome, 'killswitch');
    assert.strictEqual(row.approved_by, 'human',
      'the switch stopping an approved action is exactly what an audit needs to show');
  } finally {
    fs.unlinkSync(stop);
  }
});

// --- wiring ----------------------------------------------------------------

await test('the module writes the version its readers expect', () => {
  assert.strictEqual(G.SCHEMA, 'v5');
  const before = readLog().length;
  G.guard('version-check', 'quick', () => 1);
  assert.strictEqual(readLog()[before].schema, G.SCHEMA,
    'a bumped SCHEMA that append() does not use would make every new row read as pre-v5');
});

await test('v5 rows still carry v3/v4 attribution — a bump must not drop a field', () => {
  const before = readLog().length;
  G.guard('still-attributed', 'quick', () => 1);
  const row = readLog()[before];
  assert.ok(row.origin === 'test' || row.origin === 'app', 'v3 origin survives');
  assert.strictEqual(typeof row.actor, 'string', 'v4 actor survives');
  assert.ok(row.timestamp && row.pid, 'v2 fields survive');
});

finish();
})();
