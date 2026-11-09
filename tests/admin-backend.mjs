import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = (await build({ absWorkingDir: root, entryPoints: ['lib/admin-core.ts'], bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: 'tsconfig.json' })).outputFiles[0].text;
const { handleAdminRequest, hashPassword, verifyPassword, publicConnectingIp } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort().map(name => readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://lotto.example.test';
const USER = { userId: 'test-owner-site-id', email: 'owner@example.test' };
const PASSWORD = 'synthetic-test-password-42';
const NEXT_PASSWORD = 'synthetic-replacement-password-43';
const COOKIE = '__Host-lotto-admin';

class MockD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); for (const migration of migrations) this.sql.exec(migration); this.failing = false; }
  prepare(query) {
    const db = this;
    let values = [];
    const statement = {
      query,
      bind(...input) { values = input; return statement; },
      async first() { if (db.failing) throw Error('synthetic DB failure'); return db.sql.prepare(query).get(...values) ?? null; },
      async all() { if (db.failing) throw Error('synthetic DB failure'); return { results: db.sql.prepare(query).all(...values), success: true }; },
      async run() { if (db.failing) throw Error('synthetic DB failure'); const result = db.sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) }, success: true }; },
    };
    return statement;
  }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(statements);
    if (this.failing) throw Error('synthetic DB failure');
    this.sql.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
function fixture() {
  const db = new MockD1();
  const config = { db, canonicalOrigin: ORIGIN };
  let challengeCookie = '';
  async function call(action, data, options = {}) {
    const method = action === 'state' || action === 'visits' ? 'GET' : 'POST';
    const headers = new Headers({ ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...options.headers });
    const cookies = [options.cookie, options.noChallenge ? '' : challengeCookie].filter(Boolean).join('; ');
    if (cookies) headers.set('Cookie', cookies);
    if (options.noOrigin) headers.delete('Origin');
    const request = new Request((options.url ?? ORIGIN + '/api/admin/' + action) + (options.query ?? ''), { method: options.method ?? method, headers, ...(data === undefined ? {} : { body: typeof data === 'string' ? data : JSON.stringify(data) }) });
    const response = await handleAdminRequest(action, request, options.config ?? config, Object.hasOwn(options, 'identity') ? options.identity : USER, options.now ?? NOW);
    const issued = response.headers.get('Set-Cookie');
    if (issued?.startsWith('__Host-lotto-admin-challenge=')) challengeCookie = issued.split(';')[0];
    return response;
  }
  async function state(options) { return (await call('state', undefined, options)).json(); }
  async function csrf(options) { return (await state(options)).csrf; }
  async function setup(options = {}) {
    db.sql.prepare('INSERT INTO lotto_admin (id, user_id, password_hash, credential_version, created_at, updated_at) VALUES (1, ?, ?, 1, ?, ?)')
      .run(USER.userId, await hashPassword(PASSWORD), NOW, NOW);
    const response = await call('login', { username: 'admin', password: PASSWORD, csrf: await csrf(options) }, options);
    assert.equal(response.status, 200);
    // Isolate each test's attempt budget from fixture creation.
    db.sql.exec('DELETE FROM lotto_admin_rate');
    return response.headers.get('Set-Cookie').split(';')[0];
  }
  return { db, config, call, state, csrf, setup };
}
function count(db, table) { return db.sql.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n; }

// Everything in this file uses isolated synthetic identities, passwords, and local memory only.
test('missing configuration, wrong canonical host, and DB errors fail closed', async () => {
  const f = fixture();
  await f.setup();
  for (const [options, expected] of [
    [{ config: { ...f.config, db: undefined } }, 'unavailable'],
    [{ config: { ...f.config, canonicalOrigin: ORIGIN + '/' } }, 'unavailable'],
    [{ url: 'https://other.example.test/api/admin/state' }, 'forbidden'],
  ]) assert.equal((await f.state(options)).state, expected);
  f.db.failing = true;
  assert.equal((await f.state()).state, 'unavailable');
});

test('empty database cannot be claimed with public setup, identity or spoofed headers', async () => {
  const f = fixture();
  assert.equal((await f.state()).state, 'unavailable');
  for (const identity of [null, USER, { userId: 'attacker', email: USER.email }]) {
    assert.equal((await f.call('setup', { username: 'admin', password: PASSWORD, confirmPassword: PASSWORD, csrf: 'a'.repeat(43) },
      { identity, headers: { 'oai-authenticated-user-id': USER.userId, 'oai-authenticated-user-email': USER.email } })).status, 403);
    assert.equal((await f.call('login', { username: 'admin', password: PASSWORD }, { identity })).status, 503);
  }
  assert.equal(count(f.db, 'lotto_admin'), 0);
  assert.equal(count(f.db, 'lotto_admin_csrf'), 0);
});

test('independent login preserves the legacy password and key and needs no Sites identity', async () => {
  const f = fixture();
  const cookie = await f.setup({ identity: null });
  const before = f.db.sql.prepare('SELECT * FROM lotto_admin').get();
  assert.equal(before.user_id, USER.userId);
  assert.equal(await verifyPassword(PASSWORD, before.password_hash), true);
  assert.equal((await f.state({ cookie, identity: null })).state, 'ready');
  assert.equal((await f.state({ identity: USER })).state, 'locked');
  assert.equal((await f.state({ identity: { userId: 'attacker', email: USER.email } })).state, 'locked');
  const headers = { 'oai-authenticated-user-id': USER.userId, 'oai-authenticated-user-email': USER.email };
  assert.equal((await f.call('visits', undefined, { headers, identity: USER })).status, 401);
  const response = await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() }, { identity: null });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /^__Host-lotto-admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM lotto_admin').get(), before);
  const rawToken = response.headers.get('Set-Cookie').split(';')[0].split('=')[1];
  const stored = f.db.sql.prepare('SELECT * FROM lotto_admin_sessions WHERE token_hash = ?').get(createHash('sha256').update(rawToken).digest('hex'));
  assert.equal(stored.expires_at - stored.created_at, 8 * 3600_000);
});

test('username is actually verified and shares a durable attempt budget', async () => {
  const f = fixture(); await f.setup();
  for (const username of [undefined, '', 'Admin', 'admin ', 'attacker']) {
    const response = await f.call('login', { username, password: PASSWORD, csrf: await f.csrf() });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_credentials' });
  }
  assert.equal((await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() })).status, 429);
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
});

test('login enforces bounded passwords, exact Origin, JSON and body limits', async () => {
  const f = fixture(); await f.setup();
  for (const value of ['short', 'x'.repeat(129)]) {
    assert.equal((await f.call('login', { username: 'admin', password: value, csrf: await f.csrf() })).status, 400);
  }
  const payload = { username: 'admin', password: PASSWORD, csrf: await f.csrf() };
  for (const options of [{ headers: { Origin: 'https://evil.example.test' } }, { noOrigin: true }, { headers: { Origin: ORIGIN + '/' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Content-Type': 'text/plain' } }]) {
    const response = await f.call('login', payload, options);
    assert(response.status === 400 || response.status === 403);
  }
  assert.equal((await f.call('login', 'x'.repeat(4097))).status, 413);
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
});

test('CSRF is hashed, session-bound, expiring, and single-use', async () => {
  const f = fixture(); const cookie = await f.setup();
  const csrf = await f.csrf({ cookie });
  assert(f.db.sql.prepare('SELECT token_hash FROM lotto_admin_csrf WHERE token_hash = ?').get(createHash('sha256').update(csrf).digest('hex')));
  const payload = { csrf };
  assert.equal((await f.call('logout', payload)).status, 403);
  assert.equal((await f.call('logout', payload, { cookie, now: NOW + 15 * 60_000 })).status, 403);
  assert.equal((await f.call('logout', payload, { cookie })).status, 200);
  assert.equal((await f.call('logout', payload, { cookie })).status, 403);
});

test('durable failed-login limit survives requests and clears only at a new fixed window', async () => {
  const f = fixture();
  await f.setup();
  for (let n = 0; n < 5; n++) {
    const response = await f.call('login', { username: 'admin', password: NEXT_PASSWORD, csrf: await f.csrf() });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'invalid_credentials');
  }
  assert.equal((await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() })).status, 429);
  const later = { now: NOW + 16 * 60_000 };
  const response = await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf(later) }, later);
  assert.equal(response.status, 200);
});

test('global KDF cap is durable and blocks otherwise valid attempts before hashing', async () => {
  const f = fixture();
  await f.setup();
  const bucket = 'kdf:global:' + Math.floor(NOW / 900_000) * 900_000;
  f.db.sql.prepare('INSERT INTO lotto_admin_rate (bucket, attempts, expires_at) VALUES (?, 15, ?)').run(bucket, NOW + 900_000);
  assert.equal((await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() })).status, 429);
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
});

test('session is independent of identity, rejects duplicate cookies, expires, and is revoked by logout', async () => {
  const f = fixture();
  const cookie = await f.setup();
  assert.equal((await f.call('visits')).status, 401);
  assert.equal((await f.call('visits', undefined, { cookie, identity: null })).status, 200);
  assert.equal((await f.call('visits', undefined, { cookie, identity: { userId: 'other', email: USER.email } })).status, 200);
  assert.equal((await f.state({ cookie: cookie + '; ' + cookie })).state, 'locked');
  const csrf = await f.csrf({ cookie });
  const loggedOut = await f.call('logout', { csrf }, { cookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await f.state({ cookie })).state, 'locked');
  const login = await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() });
  const newCookie = login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await f.state({ cookie: newCookie, now: NOW + 8 * 3600_000 })).state, 'locked');
});

test('password change needs current password and revokes all prior sessions and challenges', async () => {
  const f = fixture();
  const cookie = await f.setup();
  const login = await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() });
  const secondCookie = login.headers.get('Set-Cookie').split(';')[0];
  const unusedCsrf = await f.csrf({ cookie });
  const wrong = await f.call('password', { currentPassword: NEXT_PASSWORD, password: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD, csrf: await f.csrf({ cookie }) }, { cookie });
  assert.equal(wrong.status, 401);
  const response = await f.call('password', { currentPassword: PASSWORD, password: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD, csrf: await f.csrf({ cookie }) }, { cookie });
  assert.equal(response.status, 200);
  const currentCookie = response.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await f.state({ cookie })).state, 'locked');
  assert.equal((await f.state({ cookie: secondCookie })).state, 'locked');
  assert.equal((await f.state({ cookie: currentCookie })).state, 'ready');
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
  assert.equal((await f.call('logout', { csrf: unusedCsrf }, { cookie: currentCookie })).status, 403);
  assert.equal((await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf() })).status, 401);
  assert.equal((await f.call('login', { username: 'admin', password: NEXT_PASSWORD, csrf: await f.csrf() })).status, 200);
});

test('visits remain disabled until setup, have server time, ignore injected IPs, and are idempotent', async () => {
  const f = fixture();
  const visitId = randomUUID();
  await f.call('visit', { visitId });
  assert.equal(count(f.db, 'lotto_visits'), 0);
  await f.setup();
  const injected = { visitId, ip: '8.8.8.8', at: 1 };
  await f.call('visit', injected, { headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '1.1.1.1' } });
  await f.call('visit', { visitId }, { now: NOW + 1 });
  const rows = f.db.sql.prepare('SELECT * FROM lotto_visits').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ip, null, 'unverified provenance is always null, even with a plausible request header');
  assert.equal(rows[0].at, NOW);
  for (const data of [{ visitId: 'bad' }, {}, { visitId: 'x'.repeat(5000) }]) assert.equal((await f.call('visit', data)).status, 200);
  assert.equal(count(f.db, 'lotto_visits'), 1);
});

test('trusted connecting header requires server config and rejects private, local, reserved, and sentinel addresses', async () => {
  const f = fixture();
  await f.setup();
  f.config.trustConnectingIp = true;
  await f.call('visit', { visitId: randomUUID(), ip: '1.1.1.1' }, { headers: { 'cf-connecting-ip': '8.8.8.8' } });
  assert.equal(f.db.sql.prepare('SELECT ip FROM lotto_visits').get().ip, '8.8.8.8');
  for (const value of [null, '', '10.1.2.3', '127.0.0.1', '169.254.1.2', '172.31.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2001::1', '2001:21::1', '2002::1', '3fff::1', '::ffff:8.8.8.8', '2a06:98c0:3600::103', '2A06:98C0:3600:0:0:0:0:0103', ' 8.8.8.8', '8.8.8.8,1.1.1.1', '8.8.8.8:443', 'fe80::1%lo']) assert.equal(publicConnectingIp(value), null, 'disallowed address class');
  assert.equal(publicConnectingIp('2606:4700:4700::1111'), '2606:4700:4700::1111');
  await f.call('visit', { visitId: randomUUID() }, { headers: { 'x-forwarded-for': '8.8.8.8' } });
  assert.equal(f.db.sql.prepare('SELECT ip FROM lotto_visits ORDER BY id DESC').get().ip, null);
});

test('public logging errors and cross-origin attempts never break navigation or expose details', async () => {
  const f = fixture();
  await f.setup();
  assert.equal((await f.call('visit', { visitId: randomUUID() }, { noOrigin: true })).status, 200);
  assert.equal(count(f.db, 'lotto_visits'), 0);
  f.db.failing = true;
  assert.deepEqual(await (await f.call('visit', { visitId: randomUUID() })).json(), { ok: true });
  assert.equal((await f.call('visits')).status, 503);
});

test('visit environment comes from bounded server UA, saves enum-only values, and ignores client device claims', async () => {
  const f = fixture();
  const cookie = await f.setup();
  const visitId = randomUUID();
  const ua = 'Mozilla/5.0 (Linux; Android 15; SyntheticPrivateModel) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/130.0.0.0 Mobile Safari/537.36';
  const payload = { visitId, displayMode: 'standalone', device: 'iphone', os: 'ios', browser: 'safari', userAgent: 'raw-client-value' };
  assert.equal((await f.call('visit', payload, { headers: { 'User-Agent': ua }, identity: null })).status, 200);
  const row = f.db.sql.prepare('SELECT * FROM lotto_visits').get();
  assert.equal(row.device, 'android-phone');
  assert.equal(row.os, 'android');
  assert.equal(row.browser, 'samsung');
  assert.equal(row.display_mode, 'standalone');
  assert(!JSON.stringify(row).includes('SyntheticPrivateModel'));
  assert(!JSON.stringify(row).includes('raw-client-value'));
  assert.deepEqual(Object.keys(row).sort(), ['id', 'visit_id', 'ip', 'at', 'device', 'os', 'browser', 'display_mode', 'delete_proof_hash'].sort());
  await f.call('visit', { visitId, displayMode: 'browser' }, { headers: { 'User-Agent': 'iPhone' }, now: NOW + 1 });
  assert.equal(count(f.db, 'lotto_visits'), 1);
  assert.equal(f.db.sql.prepare('SELECT display_mode FROM lotto_visits').get().display_mode, 'standalone', 'duplicate visits never rewrite original metadata');
  assert.equal((await f.call('visits', undefined, { identity: null })).status, 401);
  const response = await (await f.call('visits', undefined, { cookie })).json();
  assert.deepEqual(response.visits, [{ id: row.id, ip: null, at: NOW, device: 'android-phone', os: 'android', browser: 'samsung', display_mode: 'standalone' }]);
});

test('legacy visit body and invalid optional environment inputs fall back to unknown without storing raw values', async () => {
  const f = fixture();
  await f.setup();
  await f.call('visit', { visitId: randomUUID() });
  for (const value of [null, true, {}, ['standalone'], 'browser ', '<script>']) {
    await f.call('visit', { visitId: randomUUID(), displayMode: value });
  }
  await f.call('visit', { visitId: randomUUID(), displayMode: 'browser' }, { headers: { 'User-Agent': 'iPhone ' + 'x'.repeat(1024) } });
  const rows = f.db.sql.prepare('SELECT device, os, browser, display_mode FROM lotto_visits ORDER BY id').all();
  assert.equal(rows.length, 8);
  for (const row of rows) assert.deepEqual({ ...row }, { device: 'unknown', os: 'unknown', browser: 'unknown', display_mode: row === rows.at(-1) ? 'browser' : 'unknown' });
});

test('visit environment migration preserves prior rows with null categories; reads whitelist malformed stored categories', async () => {
  const oldDb = new DatabaseSync(':memory:');
  oldDb.exec(migrations[0]);
  const visitId = randomUUID();
  oldDb.prepare('INSERT INTO lotto_visits (visit_id, ip, at) VALUES (?, ?, ?)').run(visitId, '8.8.8.8', NOW);
  for (const migration of migrations.slice(1)) oldDb.exec(migration);
  assert.deepEqual({ ...oldDb.prepare('SELECT * FROM lotto_visits').get() }, {
    id: 1, visit_id: visitId, ip: '8.8.8.8', at: NOW,
    device: null, os: null, browser: null, display_mode: null, delete_proof_hash: null,
  });
  oldDb.close();
  const f = fixture();
  const cookie = await f.setup();
  f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, ip, at) VALUES (?, NULL, ?)').run(randomUUID(), NOW);
  f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, ip, at, device, os, browser, display_mode) VALUES (?, NULL, ?, ?, ?, ?, ?)')
    .run(randomUUID(), NOW + 1, '<device>', '<os>', '<browser>', '<display-mode>');
  const response = await (await f.call('visits', undefined, { cookie })).json();
  assert.deepEqual(response.visits.map(({ device, os, browser, display_mode }) => ({ device, os, browser, display_mode })), [
    { device: 'unknown', os: 'unknown', browser: 'unknown', display_mode: 'unknown' },
    { device: null, os: null, browser: null, display_mode: null },
  ]);
});

test('visit reads require session, filter the recent 10 days, paginate stably, and clean only bounded old rows', async () => {
  const f = fixture();
  const cookie = await f.setup();
  const insert = f.db.sql.prepare('INSERT INTO lotto_visits (visit_id, ip, at) VALUES (?, NULL, ?)');
  for (let i = 0; i < 150; i++) insert.run(randomUUID(), NOW - 31 * 86400_000);
  for (let i = 0; i < 55; i++) insert.run(randomUUID(), NOW - i * 1000);
  assert.equal((await f.call('visits')).status, 401);
  assert.equal(count(f.db, 'lotto_visits'), 205);
  const first = await (await f.call('visits', undefined, { cookie })).json();
  assert.equal(first.visits.length, 50);
  assert.equal(count(f.db, 'lotto_visits'), 105, 'one read cleans at most 100 old rows');
  assert(first.visits.every(row => row.at >= NOW - 10 * 86400_000));
  const next = await (await f.call('visits', undefined, { cookie, query: '?before=' + first.nextCursor })).json();
  assert.equal(next.visits.length, 5);
  assert.equal(next.nextCursor, undefined);
  assert(first.visits.at(-1).id > next.visits[0].id);
  assert.equal(count(f.db, 'lotto_visits'), 55);
  assert.equal((await f.call('visits', undefined, { cookie, query: '?before=1%20OR%201=1' })).status, 400);
});

test('security responses disable caching, expose no CORS, and contain no credential content', async () => {
  const f = fixture();
  const response = await f.call('state');
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const hash = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, hash.replace('$32768$', '$999999999$')), false, 'stored parameters cannot amplify KDF cost');
  const hashAgain = await hashPassword(PASSWORD);
  assert.notEqual(hashAgain, hash, 'fresh random salt per password hash');
});

test('successful login rotates and atomically revokes the presented previous session', async () => {
  const f = fixture();
  const oldCookie = await f.setup();
  const login = await f.call('login', { username: 'admin', password: PASSWORD, csrf: await f.csrf({ cookie: oldCookie }) }, { cookie: oldCookie });
  assert.equal(login.status, 200);
  const newCookie = login.headers.get('Set-Cookie').split(';')[0];
  assert.notEqual(newCookie, oldCookie);
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
  assert.equal((await f.state({ cookie: oldCookie })).state, 'locked');
  assert.equal((await f.state({ cookie: newCookie })).state, 'ready');
});

test('an in-flight old-password login cannot mint a session after password change wins', async () => {
  const f = fixture();
  const oldCookie = await f.setup();
  const loginCsrf = await f.csrf();
  const changeCsrf = await f.csrf({ cookie: oldCookie });
  let releaseLogin;
  let notifyPaused;
  const loginPaused = new Promise(resolve => { notifyPaused = resolve; });
  const mayResume = new Promise(resolve => { releaseLogin = resolve; });
  f.db.beforeBatch = async statements => {
    if (statements[0].query.startsWith('INSERT INTO lotto_admin_sessions')) {
      notifyPaused();
      await mayResume;
    }
  };
  const pendingLogin = f.call('login', { username: 'admin', password: PASSWORD, csrf: loginCsrf });
  await loginPaused;
  const changed = await f.call('password', { currentPassword: PASSWORD, password: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD, csrf: changeCsrf }, { cookie: oldCookie });
  assert.equal(changed.status, 200);
  releaseLogin();
  assert.equal((await pendingLogin).status, 403);
  assert.equal(count(f.db, 'lotto_admin_sessions'), 1);
  assert.equal((await f.state({ cookie: oldCookie })).state, 'locked');
  const currentCookie = changed.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await f.state({ cookie: currentCookie })).state, 'ready');
});

test('state challenge creation is durably bounded and still returns a documented closed state', async () => {
  const f = fixture();
  await f.setup();
  for (let n = 0; n < 30; n++) assert.equal((await f.state()).state, 'locked');
  const response = await f.call('state');
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { state: 'unavailable' });
  assert.equal(count(f.db, 'lotto_admin_csrf'), 30);
});

test('pre-login CSRF requires its browser cookie and spoofed identity headers cannot replace it', async () => {
  const f = fixture(); await f.setup();
  const csrf = await f.csrf();
  const payload = { username: 'admin', password: PASSWORD, csrf };
  const headers = { 'oai-authenticated-user-id': USER.userId };
  assert.equal((await f.call('login', payload, { noChallenge: true, headers })).status, 403);
  assert.equal((await f.call('login', payload, { headers })).status, 200);
});

test('anonymous browser and global caps do not block authenticated state polling', async () => {
  const f = fixture(); const cookie = await f.setup();
  for (let n = 0; n < 30; n++) assert.equal((await f.call('state')).status, 200);
  assert.equal((await f.call('state')).status, 429);
  for (let n = 0; n < 120; n++) assert.equal((await f.state({ cookie })).state, 'ready');
  assert.equal((await f.call('state', undefined, { cookie })).status, 429);
  const periodStart = Math.floor(NOW / 900_000) * 900_000;
  f.db.sql.prepare('UPDATE lotto_admin_rate SET attempts = 299 WHERE bucket = ?')
    .run('csrf:anonymous:global:' + periodStart);
  assert.equal((await f.call('state', undefined, { noChallenge: true })).status, 200);
  assert.equal((await f.call('state', undefined, { noChallenge: true })).status, 429);
  assert.equal(count(f.db, 'lotto_admin_csrf'), 151);
});

test('public state traffic cannot consume the authenticated session budget', async () => {
  const f = fixture(); const cookie = await f.setup();
  for (let n = 0; n < 300; n++) assert.equal((await f.call('state', undefined, { noChallenge: true })).status, 200);
  assert.equal((await f.call('state', undefined, { noChallenge: true })).status, 429);
  assert.equal((await f.state({ cookie })).state, 'ready');
  assert.equal(count(f.db, 'lotto_admin_csrf'), 301);
});
