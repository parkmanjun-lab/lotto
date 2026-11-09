import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// No network, real identities, live D1, credentials, registration or deployment is used.
const root = fileURLToPath(new URL('..', import.meta.url));
async function compile(entry) {
  const source = (await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: 'tsconfig.json' })).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const { handleRecommendationRequest, scoreRecommendation } = await compile('lib/recommendation-core.ts');
const { getRecommendationTarget } = await compile('lib/recommendation-round.ts');
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort().map(name => readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
const ORIGIN = 'https://lotto.example.test';
const USER = { userId: 'synthetic-owner', email: 'owner@example.test' };
const START = Date.parse('2026-10-13T12:00:00Z');
const CUTOFF = Date.parse('2026-10-17T11:00:00Z');
const DAY = 86400000;
const TOKEN = 'a'.repeat(43);
const COOKIE = '__Host-lotto-admin=' + TOKEN;
const sha = value => createHash('sha256').update(value).digest('hex');
const DRAW = { round: 1246, date: '2026-10-17', numbers: [1, 2, 3, 4, 5, 6], bonus: 7 };
const COMBINATIONS = [
  [1, 2, 3, 4, 5, 6], // first
  [1, 2, 3, 4, 5, 7], // second
  [1, 2, 3, 4, 5, 8], // third
  [1, 2, 3, 4, 8, 9], // fourth
  [1, 2, 3, 8, 9, 10], // fifth
  [1, 2, 7, 8, 9, 10], // two main plus bonus: losing
  [11, 12, 13, 14, 15, 16],
  [17, 18, 19, 20, 21, 22],
  [23, 24, 25, 26, 27, 28],
  [29, 30, 31, 32, 33, 34],
];
class MockD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    for (const migration of migrations) this.sql.exec(migration);
    this.failing = false;
  }
  prepare(query) {
    const db = this; let values = [];
    const statement = {
      query,
      bind(...input) { values = input; return statement; },
      async first() { if (db.beforeFirst) await db.beforeFirst(query); if (db.failing) throw Error('synthetic db failure'); return db.sql.prepare(query).get(...values) ?? null; },
      async all() { if (db.failing) throw Error('synthetic db failure'); return { results: db.sql.prepare(query).all(...values), success: true }; },
      async run() { if (db.failing) throw Error('synthetic db failure'); const row = db.sql.prepare(query).run(...values); return { results: [], success: true, meta: { changes: Number(row.changes) } }; },
      execute() { if (db.failing) throw Error('synthetic db failure'); const rows = db.sql.prepare(query).all(...values); return { results: rows, success: true, meta: { changes: db.sql.prepare('SELECT changes() AS n').get().n } }; },
    };
    return statement;
  }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(statements);
    this.sql.exec('BEGIN');
    try { const result = statements.map(statement => statement.execute()); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
function fixture({ setup = true, now = START, historyDraws = [] } = {}) {
  const db = new MockD1();
  if (setup) db.sql.prepare('INSERT INTO lotto_admin VALUES (1, ?, ?, 1, ?, ?)').run(USER.userId, 'synthetic-unusable-hash', now, now);
  db.sql.prepare('INSERT INTO lotto_admin_sessions VALUES (?, ?, 1, ?, ?)').run(sha(TOKEN), USER.userId, now, now + 400 * DAY);
  const config = { db, bootstrapEmail: USER.email, canonicalOrigin: ORIGIN, trustConnectingIp: true };
  let current = now, draws = historyDraws, verification = 'live';
  function payload(overrides = {}) { return { batchId: randomUUID(), combinations: structuredClone(COMBINATIONS), window: 50, analyzedRound: 1245, appVersion: 'f'.repeat(24), generationMethod: 'pattern-soft-v7', displayMode: 'standalone', targetRound: getRecommendationTarget(current).targetRound, deleteSecret: 'b'.repeat(43), ...overrides }; }
  let historyCalls = 0;
  async function call(action, data, options = {}) {
    const method = action === 'collect' ? 'POST' : 'GET';
    const headers = new Headers({ ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json', 'cf-connecting-ip': '8.8.8.8', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' } : { Cookie: COOKIE }), ...options.headers });
    if (options.noOrigin) headers.delete('Origin');
    if (options.noCookie) headers.delete('Cookie');
    const body = options.body ?? (data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data));
    const request = new Request((options.origin ?? ORIGIN) + '/api/' + (action === 'collect' ? 'recommendations' : 'admin/recommendations') + (options.query ?? ''), { method: options.method ?? method, headers, ...(body === undefined ? {} : { body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }) });
    return handleRecommendationRequest(action, request, options.config ?? config, Object.hasOwn(options, 'identity') ? options.identity : USER, {
      clock: () => current,
      bodyTimeoutMs: options.bodyTimeoutMs ?? 5000,
      getHistory: async () => { historyCalls++; if (options.failHistory) throw Error('synthetic history failure'); return { draws, checkedAt: new Date(current).toISOString(), source: 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all', status: verification === 'live' ? 'live' : 'saved', verification, message: verification === 'live' ? 'verified' : 'not freshly verified' }; },
    });
  }
  return { db, config, payload, call, setNow: value => { current = value; }, setHistory: (value, status = 'live') => { draws = value; verification = status; }, historyCalls: () => historyCalls };
}
const count = (f, table = 'lotto_recommendations') => f.db.sql.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const row = f => f.db.sql.prepare('SELECT * FROM lotto_recommendations ORDER BY id LIMIT 1').get();
const summary = f => f.db.sql.prepare('SELECT * FROM lotto_recommendation_rounds ORDER BY target_round LIMIT 1').get();

test('KST Saturday 20:00 cutoff is exact and independent of draw availability', () => {
  assert.deepEqual(getRecommendationTarget(CUTOFF - 1), { targetRound: 1246, targetDate: '2026-10-17', cutoffAt: CUTOFF });
  assert.deepEqual(getRecommendationTarget(CUTOFF), { targetRound: 1247, targetDate: '2026-10-24', cutoffAt: CUTOFF + 7 * DAY });
  assert.equal(getRecommendationTarget(CUTOFF + 35 * 60000).targetRound, 1247);
});

test('setup disabled, wrong origin, missing origin/config, and DB failures return explicit errors', async () => {
  const disabled = fixture({ setup: false });
  const response = await disabled.call('collect', disabled.payload());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'recording_disabled' });
  assert.equal(count(disabled), 0);
  const f = fixture();
  for (const options of [{ noOrigin: true }, { origin: 'https://other.example.test' }, { headers: { Origin: 'https://other.example.test' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]) assert.equal((await f.call('collect', f.payload(), options)).status, 403);
  assert.equal((await f.call('collect', f.payload(), { config: { ...f.config, db: undefined } })).status, 503);
  assert.equal((await f.call('collect', undefined, { method: 'GET' })).status, 405);
  f.db.failing = true;
  assert.deepEqual(await (await f.call('collect', f.payload())).json(), { error: 'unavailable' });
  assert.equal(count(f), 0);
});

test('exact ten unique valid six-number sets and bounded strictly typed metadata are required', async () => {
  const f = fixture();
  const invalid = [
    {}, { combinations: COMBINATIONS.slice(0, 9) }, { combinations: [...COMBINATIONS, COMBINATIONS[0]] },
    { combinations: [COMBINATIONS[0], ...COMBINATIONS.slice(0, 9)] },
    { combinations: [[1, 1, 2, 3, 4, 5], ...COMBINATIONS.slice(1)] },
    { combinations: [[0, 2, 3, 4, 5, 6], ...COMBINATIONS.slice(1)] },
    { combinations: [[46, 2, 3, 4, 5, 6], ...COMBINATIONS.slice(1)] },
    { combinations: [['1', 2, 3, 4, 5, 6], ...COMBINATIONS.slice(1)] },
    { combinations: [[1.5, 2, 3, 4, 5, 6], ...COMBINATIONS.slice(1)] },
    { batchId: 'not-a-uuid' }, { window: 10 }, { window: '50' }, { analyzedRound: 1246 },
    { appVersion: 'x'.repeat(100) }, { generationMethod: '../escape' }, { displayMode: 'model-secret' },
    { targetRound: '1246' }, { ip: '1.1.1.1' }, { acceptedAt: 1 },
  ];
  for (let index = 0; index < invalid.length; index++) {
    const data = index === 0 ? {} : f.payload(invalid[index]);
    assert.equal((await f.call('collect', data)).status, 400, JSON.stringify(invalid[index]));
  }
  assert.equal(count(f), 0); assert.equal(count(f, 'lotto_recommendation_rounds'), 0);
  assert.equal((await f.call('collect', 'x'.repeat(4097))).status, 413);
  assert.equal((await f.call('collect', f.payload(), { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await f.call('collect', undefined, { body: new Uint8Array([0xff, 0xfe]) })).status, 400);
});

test('one successful INSERT records all ten and only trusted IP/coarse environment, with no raw UA', async () => {
  const f = fixture(); const data = f.payload();
  const response = await f.call('collect', data); assert.equal(response.status, 201);
  const receipt = (await response.json()).receipt;
  assert.deepEqual(receipt, { batchId: data.batchId, acceptedAt: START, ...getRecommendationTarget(START), appVersion: data.appVersion, generationMethod: data.generationMethod });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const stored = row(f);
  assert.deepEqual(JSON.parse(stored.combinations_json), data.combinations);
  assert.equal(stored.ip, '8.8.8.8'); assert.equal(stored.device, 'iphone'); assert.equal(stored.browser, 'safari');
  assert.equal(stored.display_mode, 'standalone'); assert(!JSON.stringify(stored).includes('Mozilla'));
  assert.equal(summary(f).combination_count, 10); assert.equal(summary(f).pending, 10);
  const g = fixture(); g.config.trustConnectingIp = false;
  await g.call('collect', g.payload(), { headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' } });
  assert.equal(row(g).ip, null);
});

test('idempotent retries preserve original receipt across cutoff and canonical number order; changed content conflicts', async () => {
  const f = fixture({ now: CUTOFF - 1 }); const data = f.payload();
  const first = await (await f.call('collect', data)).json();
  f.setNow(CUTOFF + 1000);
  const retry = await f.call('collect', data); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), first);
  const reordered = { ...data, combinations: data.combinations.map(numbers => [...numbers].reverse()) };
  assert.deepEqual(await (await f.call('collect', reordered)).json(), first);
  for (const changed of [{ window: 20 }, { displayMode: 'browser' }, { combinations: [...data.combinations].reverse() }, { targetRound: 1247 }]) {
    const response = await f.call('collect', { ...data, ...changed }); assert.equal(response.status, 409); assert.equal((await response.json()).error, 'batch_conflict');
  }
  assert.equal(count(f), 1); assert.equal(summary(f).combination_count, 10);
});

test('concurrent same-UUID submissions insert once; a collision cannot overwrite the winning content', async () => {
  const f = fixture(); const data = f.payload();
  const results = await Promise.all([f.call('collect', data), f.call('collect', data)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  assert.equal(count(f), 1); assert.equal(summary(f).batch_count, 1);
  const g = fixture(); const input = g.payload();
  const collisions = await Promise.all([g.call('collect', input), g.call('collect', { ...input, window: 20 })]);
  assert.deepEqual(collisions.map(result => result.status).sort(), [201, 409]);
  assert.equal(count(g), 1); assert.equal(summary(g).pending, 10);
});

test('a slow body crossing cutoff is rejected, and acceptedAt is sampled after full body and DB checks', async () => {
  const f = fixture({ now: CUTOFF - 1 }); const data = f.payload(); let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const pending = f.call('collect', undefined, { body: stream });
  await new Promise(resolve => setImmediate(resolve));
  f.setNow(CUTOFF + 1); controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close();
  const response = await pending; assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'target_expired' });
  assert.equal(count(f), 0);
  const g = fixture({ now: CUTOFF - 1 }); const earlier = g.payload();
  g.db.beforeFirst = async query => { if (query.startsWith('INSERT INTO lotto_admin_rate')) g.setNow(CUTOFF + 1); };
  assert.equal((await g.call('collect', earlier)).status, 409); assert.equal(count(g), 0);
  const h = fixture(); const newData = h.payload();
  h.db.beforeFirst = async query => { if (query.startsWith('INSERT INTO lotto_admin_rate')) h.setNow(START + 500); };
  assert.equal((await (await h.call('collect', newData)).json()).receipt.acceptedAt, START + 500);
});

test('a stalled final body chunk times out and cancels without inserting anything', async () => {
  const f = fixture(); let canceled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } });
  const start = performance.now(); const response = await f.call('collect', undefined, { body, bodyTimeoutMs: 20 });
  assert.equal(response.status, 408); assert.deepEqual(await response.json(), { error: 'request_timeout' });
  assert(performance.now() - start < 1000); assert(canceled); assert.equal(count(f), 0);
});

test('durable global and address rate limits fail explicitly while accepted retries remain stable', async () => {
  const f = fixture(); const data = f.payload(); const first = await (await f.call('collect', data)).json();
  const start = Math.floor(START / 60000) * 60000;
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 30 WHERE bucket = ?').run(`recommendation:address:${sha('8.8.8.8')}:${start}`);
  assert.equal((await f.call('collect', f.payload())).status, 429);
  assert.deepEqual(await (await f.call('collect', data)).json(), first);
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 120 WHERE bucket = ?').run(`recommendation:global:${start}`);
  assert.equal((await f.call('collect', f.payload(), { headers: { 'cf-connecting-ip': '1.1.1.1' } })).status, 429);
  f.setNow(START + 60000); assert.equal((await f.call('collect', f.payload())).status, 201);
});

test('rank scoring counts main numbers only and bonus affects only five-main matches', () => {
  const results = COMBINATIONS.map(numbers => scoreRecommendation(numbers, DRAW));
  assert.deepEqual(results.map(result => result.rank), [1, 2, 3, 4, 5, null, null, null, null, null]);
  assert.equal(results[5].matchedCount, 2); assert.equal(results[5].bonusMatch, true); assert.equal(results[5].status, 'losing');
  assert.equal(scoreRecommendation(COMBINATIONS[0], null).status, 'pending');
});

test('admin list requires an unexpired session before history or detail', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  for (const [options, status] of [[{ noCookie: true }, 401], [{ headers: { Cookie: COOKIE + '; ' + COOKIE } }, 401]]) {
    assert.equal((await f.call('list', undefined, options)).status, status);
  }
  assert.equal(f.historyCalls(), 0);
  f.db.sql.prepare('UPDATE lotto_admin SET credential_version = 2').run();
  assert.equal((await f.call('list')).status, 401); assert.equal(f.historyCalls(), 0);
});

test('admin list accepts valid sessions without Sites identity and ignores spoofed identity headers', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  for (const identity of [null, { userId: 'attacker', email: 'other@example.test' }]) {
    assert.equal((await f.call('list', undefined, { identity })).status, 200);
    assert.equal((await f.call('list', undefined, { identity, noCookie: true,
      headers: { 'oai-authenticated-user-id': USER.userId } })).status, 401);
  }
});

test('exact target result is settled once, and summary covers all combinations including losing sets', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  f.setHistory([{ ...DRAW, round: 1245 }]);
  const pending = await (await f.call('list')).json();
  assert.equal(pending.summary.pending, 10); assert.equal(pending.batches[0].draw, null);
  f.setHistory([DRAW]); f.setNow(CUTOFF + 60 * 60000);
  const matched = await (await f.call('list')).json();
  assert.deepEqual(matched.summary, { batchCount: 1, combinationCount: 10, pending: 0, deletedBeforeResult: 0, losing: 5, rank1: 1, rank2: 1, rank3: 1, rank4: 1, rank5: 1, matchedCombinationCount: 5 });
  assert.equal(matched.batches[0].source, 'client_submission');
  assert.equal(matched.batches[0].originalCombinationCount, 10);
  assert.deepEqual(matched.batches[0].draw, DRAW);
  await f.call('list'); assert.equal(summary(f).rank1, 1); assert.equal(summary(f).pending, 0);
});

test('cached verified targets can settle; history conflict preserves existing results and leaves new targets pending', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  f.setHistory([DRAW], 'cached');
  const cached = await (await f.call('list')).json(); assert.equal(cached.summary.rank1, 1); assert.equal(cached.history.verification, 'cached');
  await f.call('collect', f.payload());
  f.setHistory([{ ...DRAW, numbers: [30, 31, 32, 33, 34, 35] }], 'conflict');
  const conflict = await (await f.call('list')).json();
  assert.equal(conflict.summary.rank1, 1); assert.equal(conflict.summary.pending, 10);
  assert.equal(conflict.batches[0].combinations[0].status, 'pending');
  assert.equal(conflict.batches[1].combinations[0].rank, 1);
  assert.deepEqual(conflict.batches[1].draw, DRAW);
});

test('pagination and matched/round filters never shrink the aggregate denominator', async () => {
  const f = fixture();
  for (let i = 0; i < 27; i++) assert.equal((await f.call('collect', f.payload())).status, 201);
  f.setHistory([DRAW]);
  const first = await (await f.call('list', undefined, { query: '?matched=1&round=1246' })).json();
  assert.equal(first.batches.length, 25); assert.equal(first.summary.combinationCount, 270); assert.equal(first.summary.rank1, 27);
  assert.deepEqual(first.availableRounds, [1246]); assert.equal(first.selectedRound, 1246); assert(first.nextCursor);
  const next = await (await f.call('list', undefined, { query: '?matched=1&round=1246&before=' + first.nextCursor })).json();
  assert.equal(next.batches.length, 2); assert.equal(next.summary.combinationCount, 270); assert.equal(next.nextCursor, undefined);
  const empty = await (await f.call('list', undefined, { query: '?round=1247' })).json(); assert.equal(empty.summary.combinationCount, 0);
  for (const query of ['?before=0', '?before=1&before=2', '?matched=all', '?round=NaN', '?other=1']) assert.equal((await f.call('list', undefined, { query })).status, 400);
});

test('database trigger failure rolls back the whole original batch and its counters', async () => {
  const f = fixture();
  f.db.sql.exec("CREATE TRIGGER synthetic_failure AFTER INSERT ON lotto_recommendation_rounds BEGIN SELECT RAISE(ABORT, 'synthetic counter failure'); END;");
  const response = await f.call('collect', f.payload()); assert.equal(response.status, 503);
  assert.equal(count(f), 0); assert.equal(count(f, 'lotto_recommendation_rounds'), 0);
});

test('database failure during settlement leaves both prior pending totals and original batch unchanged', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  f.db.sql.exec("CREATE TRIGGER synthetic_settlement_failure AFTER UPDATE ON lotto_recommendation_rounds BEGIN SELECT RAISE(ABORT, 'synthetic settlement failure'); END;");
  f.setHistory([DRAW]); assert.equal((await f.call('list')).status, 503);
  assert.equal(row(f).settled_at, null); assert.equal(summary(f).pending, 10); assert.equal(summary(f).rank1, 0);
});

test('replays and conflicts are covered by independent durable request quotas', async () => {
  const f = fixture(); const data = f.payload(); const first = await (await f.call('collect', data)).json();
  const start = Math.floor(START / 60000) * 60000;
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 60 WHERE bucket = ?').run(`recommendation:request:address:${sha('8.8.8.8')}:${start}`);
  const blocked = await f.call('collect', data); assert.equal(blocked.status, 429);
  assert.equal((await f.call('collect', { ...data, window: 20 })).status, 429);
  assert.equal(count(f), 1); assert.equal(summary(f).combination_count, 10);
  f.setNow(START + 60000);
  assert.deepEqual(await (await f.call('collect', data)).json(), first);
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 240 WHERE bucket = ?').run(`recommendation:request:global:${start + 60000}`);
  assert.equal((await f.call('collect', data, { headers: { 'cf-connecting-ip': '1.1.1.1' } })).status, 429);
});

test('durable official pins detect corrected target data after a simulated Worker restart', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  f.setHistory([DRAW]); await f.call('list');
  assert.deepEqual(JSON.parse(summary(f).draw_json), DRAW);
  await f.call('collect', f.payload());
  // A fresh process has no in-memory conflict flag, but the database pin still wins.
  f.setHistory([{ ...DRAW, numbers: [30, 31, 32, 33, 34, 35], bonus: 36 }], 'live');
  const response = await (await f.call('list')).json();
  assert.equal(response.history.verification, 'conflict');
  assert.equal(response.summary.rank1, 1); assert.equal(response.summary.pending, 10);
  assert.deepEqual(response.batches[1].draw, DRAW); assert.equal(response.batches[0].draw, null);
  assert.deepEqual(JSON.parse(summary(f).draw_json), DRAW);
});

test('a competing official pin cannot mix corrected results into one target round', async () => {
  const f = fixture(); await f.call('collect', f.payload());
  f.setHistory([DRAW]);
  const other = { ...DRAW, numbers: [30, 31, 32, 33, 34, 35], bonus: 36 };
  let raced = false;
  f.db.beforeBatch = async statements => {
    if (!raced && statements.some(statement => statement.query.includes('SET results_json'))) {
      raced = true;
      // Another transaction pins a different verified draw between precheck and our atomic settlement.
      f.db.sql.prepare('UPDATE lotto_recommendation_rounds SET draw_json = ?, verified_at = ? WHERE target_round = ?')
        .run(JSON.stringify(other), START, DRAW.round);
    }
  };
  const response = await (await f.call('list')).json();
  assert.equal(response.history.verification, 'conflict'); assert.equal(response.summary.pending, 10);
  assert.equal(row(f).settled_at, null); assert.equal(summary(f).rank1, 0);
  assert.deepEqual(JSON.parse(summary(f).draw_json), other);
});

test('concurrent settlement retries count each accepted combination exactly once', async () => {
  const f = fixture(); await f.call('collect', f.payload()); f.setHistory([DRAW]);
  const responses = await Promise.all([f.call('list'), f.call('list')]);
  assert(responses.every(response => response.status === 200));
  assert.equal(summary(f).combination_count, 10); assert.equal(summary(f).rank1, 1); assert.equal(summary(f).pending, 0);
});

test('runtime collection adapter is default-off without the explicit feature switch', async () => {
  const source = readFileSync(new URL('../lib/recommendation-server.ts', import.meta.url), 'utf8');
  assert.match(source, /action === 'collect' && runtime\.RECOMMENDATION_RECORDING_ENABLED !== '1'/);
  assert.match(source, /return adminJson\(\{ error: 'recording_disabled' \}, 503\)/);
});

test('ordinary visit reads use the newly requested ten-day window even before bounded purge catches up', async () => {
  const { handleAdminRequest } = await compile('lib/admin-core.ts');
  const f = fixture();
  for (let i = 0; i < 150; i++) f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, at) VALUES (?, ?)').run(randomUUID(), START - 10 * DAY - 1);
  f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, at) VALUES (?, ?)').run(randomUUID(), START - 9 * DAY);
  const response = await handleAdminRequest('visits', new Request(ORIGIN + '/api/admin/visits', { headers: { Cookie: COOKIE } }), f.config, USER, START);
  assert.equal(response.status, 200);
  const list = await response.json(); assert.equal(list.visits.length, 1); assert.equal(list.visits[0].at, START - 9 * DAY);
  assert.equal(count(f, 'lotto_visits'), 51, 'one request removes at most 100 expired visit rows');
});

const { handlePrivacyDelete } = await compile('lib/privacy-core.ts');
async function removeRecords(f, records, options = {}) {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json', 'cf-connecting-ip': '8.8.8.8', ...options.headers });
  if (options.noOrigin) headers.delete('Origin');
  const body = options.body ?? JSON.stringify({ records });
  const request = new Request(ORIGIN + '/api/privacy/delete', { method: options.method ?? 'POST', headers, ...(options.method === 'GET' ? {} : { body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }) });
  return handlePrivacyDelete(request, f.config, { clock: () => options.now ?? START, bodyTimeoutMs: options.bodyTimeoutMs ?? 5000 });
}
function deletion(data) { return { kind: 'recommendation', id: data.batchId, proof: data.deleteSecret }; }

test('self deletion removes winning detail and personal data, retains anonymous counts, and blocks old retries', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data); f.setHistory([DRAW]); await f.call('list');
  assert.equal(summary(f).rank1, 1);
  const response = await removeRecords(f, [deletion(data)]);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(count(f), 0); assert.equal(summary(f).combination_count, 10); assert.equal(summary(f).rank1, 1);
  const tombstone = f.db.sql.prepare('SELECT * FROM lotto_deleted_records').get();
  assert.deepEqual(Object.keys(tombstone).sort(), ['id_hash', 'kind', 'proof_hash']);
  assert.equal(tombstone.proof_hash, sha(data.deleteSecret));
  assert.equal(tombstone.id_hash, sha('recommendation:' + data.batchId));
  assert(!JSON.stringify(tombstone).includes(data.batchId)); assert(!JSON.stringify(tombstone).includes(data.deleteSecret));
  const retry = await f.call('collect', data); assert.equal(retry.status, 410); assert.deepEqual(await retry.json(), { error: 'record_deleted' });
  const after = await (await f.call('list')).json(); assert.equal(after.batches.length, 0); assert.equal(after.summary.combinationCount, 10);
  assert.deepEqual(await (await removeRecords(f, [deletion(data)])).json(), { ok: true });
});

test('self deletion before verdict preserves the full denominator and labels unresolved deleted combinations', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data);
  await removeRecords(f, [deletion(data)]);
  assert.equal(count(f), 0); assert.equal(summary(f).pending, 0); assert.equal(summary(f).deleted_unresolved, 10);
  f.setHistory([DRAW]); const after = await (await f.call('list')).json();
  assert.equal(after.summary.deletedBeforeResult, 10); assert.equal(after.summary.combinationCount, 10);
  assert.equal(after.summary.rank1, 0);
});

test('wrong proof, unknown ID and repeated removal return identical generic acknowledgments without deleting others', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data);
  const wrong = await removeRecords(f, [{ ...deletion(data), proof: 'c'.repeat(43) }]);
  const unknown = await removeRecords(f, [{ ...deletion(data), id: randomUUID() }]);
  assert.deepEqual(await wrong.json(), { ok: true }); assert.deepEqual(await unknown.json(), { ok: true }); assert.equal(count(f), 1);
  await removeRecords(f, [deletion(data)]); assert.equal(count(f), 0);
  assert.deepEqual(await (await removeRecords(f, [deletion(data)])).json(), { ok: true });
});

test('deletion is exact-origin, bounded, capability-scoped, and unavailable for GET', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data);
  assert.equal((await removeRecords(f, [deletion(data)], { noOrigin: true })).status, 403);
  assert.equal((await removeRecords(f, [deletion(data)], { headers: { Origin: 'https://evil.example.test' } })).status, 403);
  assert.equal((await removeRecords(f, [deletion(data)], { method: 'GET' })).status, 405);
  for (const records of [[], Array.from({ length: 21 }, () => ({ ...deletion(data), id: randomUUID() })), [deletion(data), deletion(data)], [{ ...deletion(data), proof: 'short' }], [{ ...deletion(data), kind: 'admin' }], [{ ...deletion(data), ip: '8.8.8.8' }]]) {
    assert.equal((await removeRecords(f, records)).status, 400);
  }
  assert.equal((await removeRecords(f, [], { body: 'x'.repeat(4097) })).status, 413);
  assert.equal(count(f), 1);
});

test('delete-request body stalls consume quota, expire, and never touch stored rows', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data); let canceled = false;
  const body = new ReadableStream({ start() {}, cancel() { canceled = true; } });
  assert.equal((await removeRecords(f, [], { body, bodyTimeoutMs: 20 })).status, 408);
  assert(canceled); assert.equal(count(f), 1);
  const bucket = `privacy-delete:address:${sha('8.8.8.8')}:${Math.floor(START / 60000) * 60000}`;
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 12 WHERE bucket = ?').run(bucket);
  assert.equal((await removeRecords(f, [deletion(data)])).status, 429); assert.equal(count(f), 1);
});

test('atomic self deletion rolls back its anti-replay tombstone and aggregate changes if any deletion fails', async () => {
  const f = fixture(); const a = f.payload(), b = f.payload(); await f.call('collect', a); await f.call('collect', b);
  f.db.sql.exec("CREATE TRIGGER synthetic_delete_failure AFTER DELETE ON lotto_recommendations BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
  const response = await removeRecords(f, [deletion(a), deletion(b)]); assert.equal(response.status, 503);
  assert.equal(count(f), 2); assert.equal(count(f, 'lotto_deleted_records'), 0);
  assert.equal(summary(f).pending, 20); assert.equal(summary(f).deleted_unresolved, 0);
});

test('visit deletion uses the same owned proof, cannot be replayed, and never guesses legacy ownership', async () => {
  const { handleAdminRequest } = await compile('lib/admin-core.ts');
  const f = fixture(); f.config.requireVisitProof = true;
  const visitId = randomUUID(), proof = 'd'.repeat(43);
  const visit = data => handleAdminRequest('visit', new Request(ORIGIN + '/api/visit', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'cf-connecting-ip': '8.8.8.8' }, body: JSON.stringify(data) }), f.config, null, START);
  await visit({ visitId }); assert.equal(count(f, 'lotto_visits'), 0, 'runtime-required proof rejects old clients without recording');
  await visit({ visitId, deleteSecret: proof }); assert.equal(count(f, 'lotto_visits'), 1);
  const stored = f.db.sql.prepare('SELECT * FROM lotto_visits').get(); assert.equal(stored.delete_proof_hash, sha(proof)); assert(!JSON.stringify(stored).includes(proof));
  const request = [{ kind: 'visit', id: visitId, proof }];
  assert.deepEqual(await (await removeRecords(f, request)).json(), { ok: true }); assert.equal(count(f, 'lotto_visits'), 0);
  await visit({ visitId, deleteSecret: proof }); assert.equal(count(f, 'lotto_visits'), 0);
  const legacy = randomUUID(); f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, at) VALUES (?, ?)').run(legacy, START);
  await removeRecords(f, [{ kind: 'visit', id: legacy, proof }]); assert.equal(count(f, 'lotto_visits'), 1, 'legacy proofless rows are not attributed by IP');
});

test('same UUID in different record kinds has separate anti-replay tombstones', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data);
  f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, at, delete_proof_hash) VALUES (?, ?, ?)').run(data.batchId, START, sha(data.deleteSecret));
  await removeRecords(f, [deletion(data), { kind: 'visit', id: data.batchId, proof: data.deleteSecret }]);
  assert.equal(count(f), 0); assert.equal(count(f, 'lotto_visits'), 0); assert.equal(count(f, 'lotto_deleted_records'), 2);
});

// These exercise the current local draft policy only. Production collection stays disabled.
test('draft ten-day compaction keeps only matched numbers with their stored context and full anonymous denominator', async () => {
  const f = fixture(); const data = f.payload(); await f.call('collect', data); f.setHistory([DRAW]);
  f.setNow(START + 11 * DAY);
  const response = await (await f.call('list')).json();
  assert.equal(response.batches.length, 1); const batch = response.batches[0];
  assert.equal(batch.detailsPruned, true); assert.equal(batch.privacyExpired, false); assert.equal(batch.ip, '8.8.8.8');
  assert.equal(batch.combinations.length, 5); assert(batch.combinations.every(result => result.status === 'matched'));
  assert.equal(JSON.parse(row(f).combinations_json).length, 5); assert.equal(JSON.parse(row(f).results_json).length, 5);
  assert.equal(response.summary.combinationCount, 10); assert.equal(response.summary.losing, 5);
  const retry = await f.call('collect', data); assert.equal(retry.status, 200); assert.equal((await retry.json()).receipt.acceptedAt, START);
});

test('draft expired losing detail is removed while pending numbers survive with personal fields stripped', async () => {
  const f = fixture(); const losing = f.payload({ combinations: Array.from({ length: 10 }, (_, i) => [20 + i, 21 + i, 22 + i, 23 + i, 24 + i, 25 + i]) });
  await f.call('collect', losing); f.setHistory([DRAW]); f.setNow(START + 11 * DAY);
  const cleared = await (await f.call('list')).json();
  assert.equal(cleared.batches.length, 0); assert.equal(row(f).combinations_json, null); assert.equal(row(f).results_json, null);
  for (const field of ['ip', 'device', 'os', 'browser', 'display_mode']) assert.equal(row(f)[field], null);
  assert.equal(cleared.summary.combinationCount, 10); assert.equal(cleared.summary.losing, 10);
  const g = fixture(); await g.call('collect', g.payload()); g.setNow(START + 11 * DAY);
  const pending = await (await g.call('list')).json(); assert.equal(pending.batches[0].combinations.length, 10); assert.equal(pending.batches[0].privacyExpired, true);
  assert.equal(row(g).ip, null); assert.equal(JSON.parse(row(g).combinations_json).length, 10);
  g.setHistory([DRAW]); const later = await (await g.call('list')).json();
  assert.equal(later.batches[0].combinations.length, 5); assert.equal(later.batches[0].ip, null, 'deleted personal data is never reconstructed');
});
