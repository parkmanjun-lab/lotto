/** Server-only administrator controls. Never import this module from client components. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeVisitBrowser, normalizeVisitDevice, normalizeVisitDisplayMode, normalizeVisitOs, parseVisitEnvironment } from './visit-environment';

export type AdminIdentity = { userId: string; email: string } | null;
export type AdminConfig = {
  db?: D1Database;
  /** Legacy setting accepted for callers; never used for administrator authorization. */
  bootstrapEmail?: string;
  canonicalOrigin?: string;
  /** Enable only after confirming the hosting edge replaces this header. */
  trustConnectingIp?: boolean;
  /** Runtime enables this so old clients without a local deletion key cannot collect new visits. */
  requireVisitProof?: boolean;
};
export type AdminAction = 'state' | 'visits' | 'setup' | 'login' | 'password' | 'logout' | 'visit';
type Admin = { user_id: string; password_hash: string; credential_version: number };
type Context = { db: D1Database; admin: Admin; now: number; csrfSubject: string };
const ADMIN_USERNAME = 'admin';
type Body = Record<string, unknown>;
const COOKIE = '__Host-lotto-admin';
const CHALLENGE_COOKIE = '__Host-lotto-admin-challenge';
const SESSION_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_MS = 15 * 60 * 1000;
const RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
const PASSWORD_MAX = 128;
const BODY_MAX = 4096;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class Denied extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function deny(status: number, code: string): never { throw new Denied(status, code); }
function json(value: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Cookie',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return Response.json(value, { status, headers });
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function token(): string { return randomBytes(32).toString('base64url'); }
function cookie(value: string, maxAge = SESSION_MS / 1000): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function configured(config: AdminConfig, request: Request): D1Database {
  const { db, canonicalOrigin } = config;
  if (!db || !canonicalOrigin) deny(503, 'unavailable');
  let canonical: URL;
  try { canonical = new URL(canonicalOrigin); } catch { deny(503, 'unavailable'); }
  if (canonical.protocol !== 'https:' || canonical.origin !== canonicalOrigin) deny(503, 'unavailable');
  if (new URL(request.url).origin !== canonicalOrigin) deny(403, 'forbidden');
  return db;
}
function sameOrigin(request: Request, origin: string): void {
  // Deliberately no Referer fallback, wildcard, forwarded-host, or subdomain match.
  if (request.headers.get('origin') !== origin) deny(403, 'forbidden');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') deny(403, 'forbidden');
}
async function body(request: Request): Promise<Body> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) deny(400, 'invalid_request');
  const declared = Number(request.headers.get('content-length'));
  if (declared > BODY_MAX) deny(413, 'invalid_request');
  const reader = request.body?.getReader();
  if (!reader) deny(400, 'invalid_request');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > BODY_MAX) { await reader.cancel(); deny(413, 'invalid_request'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { deny(400, 'invalid_request'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) deny(400, 'invalid_request');
  return parsed as Body;
}
function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > PASSWORD_MAX) deny(400, 'invalid_request');
  return value;
}
function newPassword(data: Body): string {
  const value = password(data.password);
  if (data.confirmPassword !== value) deny(400, 'invalid_request');
  return value;
}
function derive(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(value, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }, (error, result) => error ? reject(error) : resolve(result));
  });
}
export async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16);
  const result = await derive(value, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${result.toString('hex')}`;
}
export async function verifyPassword(value: string, stored: string): Promise<boolean> {
  // Stored parameters are not allowed to control KDF cost or allocation.
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored);
  if (!match) return false;
  const actual = await derive(value, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
async function administrator(db: D1Database, request: Request, now: number, challenge?: string): Promise<Context> {
  // The singleton's legacy user_id is an internal database key, never proof of identity.
  // No external identity header, claimed user ID, or email can authorize an operation.
  const admin = await db.prepare('SELECT user_id, password_hash, credential_version FROM lotto_admin WHERE id = 1').first<Admin>();
  // No public bootstrap: an empty installation requires separately authorized provisioning.
  if (!admin) deny(503, 'unavailable');
  const sessionValue = sessionToken(request);
  const browserChallenge = challenge ?? readTokenCookie(request, CHALLENGE_COOKIE);
  const csrfSubject = admin.user_id + ':' + (sessionValue ? 'session:' + digest(sessionValue) : browserChallenge ? 'login:' + digest(browserChallenge) : 'missing');
  return { db, admin, now, csrfSubject };
}
async function rate(db: D1Database, key: string, now: number, limit: number, period = CHALLENGE_MS): Promise<void> {
  const start = Math.floor(now / period) * period;
  const row = await db.prepare(`INSERT INTO lotto_admin_rate (bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ? RETURNING attempts`)
    .bind(`${key}:${start}`, start + period, limit).first<{ attempts: number }>();
  if (!row) deny(429, 'rate_limited');
}
async function kdfRate(context: Context, action: string): Promise<void> {
  await rate(context.db, 'kdf:global', context.now, 15);
  await rate(context.db, `kdf:${action}:${digest(context.admin.user_id)}`, context.now, 5);
}
async function cleanup(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM lotto_visits WHERE id IN (SELECT id FROM lotto_visits WHERE at < ? ORDER BY id LIMIT 100)').bind(now - RETENTION_MS),
    db.prepare('DELETE FROM lotto_admin_sessions WHERE token_hash IN (SELECT token_hash FROM lotto_admin_sessions WHERE expires_at <= ? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM lotto_admin_csrf WHERE token_hash IN (SELECT token_hash FROM lotto_admin_csrf WHERE expires_at <= ? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM lotto_admin_rate WHERE bucket IN (SELECT bucket FROM lotto_admin_rate WHERE expires_at <= ? LIMIT 100)').bind(now),
  ]);
}
async function issueCsrf(context: Context, authenticated: boolean, request: Request, config: AdminConfig): Promise<string> {
  if (authenticated) {
    // Public state traffic cannot exhaust a signed-in administrator's polling budget.
    await rate(context.db, `csrf:session:${digest(context.csrfSubject)}`, context.now, 120);
  } else {
    // Global cap also bounds anonymous cookie resets and arbitrary cookie values.
    await rate(context.db, 'csrf:anonymous:global', context.now, 300);
    const ip = config.trustConnectingIp ? publicConnectingIp(request.headers.get('cf-connecting-ip')) : null;
    if (ip) await rate(context.db, `csrf:anonymous:address:${digest(ip)}`, context.now, 60);
    await rate(context.db, `csrf:anonymous:browser:${digest(context.csrfSubject)}`, context.now, 30);
  }
  const value = token();
  await context.db.prepare('INSERT INTO lotto_admin_csrf (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(digest(value), context.csrfSubject, context.now + CHALLENGE_MS).run();
  return value;
}
async function consumeCsrf(context: Context, value: unknown): Promise<void> {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) deny(403, 'forbidden');
  const removed = await context.db.prepare('DELETE FROM lotto_admin_csrf WHERE token_hash = ? AND user_id = ? AND expires_at > ? RETURNING token_hash')
    .bind(digest(value), context.csrfSubject, context.now).first();
  if (!removed) deny(403, 'forbidden');
}
function readTokenCookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return TOKEN_RE.test(value) ? value : null;
}
function sessionToken(request: Request): string | null { return readTokenCookie(request, COOKIE); }
async function session(context: Context, request: Request): Promise<boolean> {
  if (!context.admin) return false;
  const value = sessionToken(request);
  if (!value) return false;
  const row = await context.db.prepare(`SELECT s.token_hash FROM lotto_admin_sessions AS s
    JOIN lotto_admin AS a ON a.id = 1 AND a.user_id = s.user_id AND a.credential_version = s.credential_version
    WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ?`)
    .bind(digest(value), context.admin.user_id, context.now).first();
  return !!row;
}
async function createSession(context: Context, expected: Admin, request: Request): Promise<string> {
  const value = token();
  const previous = sessionToken(request);
  const result = await context.db.batch([
    context.db.prepare(`INSERT INTO lotto_admin_sessions (token_hash, user_id, credential_version, created_at, expires_at)
      SELECT ?, user_id, credential_version, ?, ? FROM lotto_admin WHERE id = 1 AND user_id = ? AND credential_version = ? AND password_hash = ?`)
      .bind(digest(value), context.now, context.now + SESSION_MS, context.admin.user_id, expected.credential_version, expected.password_hash),
    context.db.prepare(`DELETE FROM lotto_admin_sessions WHERE token_hash = ? AND user_id = ?
      AND EXISTS (SELECT 1 FROM lotto_admin_sessions WHERE token_hash = ? AND user_id = ?)`)
      .bind(previous ? digest(previous) : '', context.admin.user_id, digest(value), context.admin.user_id),
  ]);
  if (result[0].meta.changes !== 1) deny(403, 'forbidden');
  return value;
}

/** Return only a publicly routable IP from the trusted edge header; never inspect XFF/body IP. */
export function publicConnectingIp(value: string | null): string | null {
  if (!value || value.length > 45 || value.trim() !== value || value.includes('%')) return null;
  const kind = isIP(value);
  if (kind === 4) {
    const [a, b, c] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return null;
    return value;
  }
  if (kind !== 6 || value.includes('.')) return null;
  // IPv6 global unicast is 2000::/3. Exclude special-use ranges and the Workers sentinel.
  const normalized = new URL(`https://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  const second = Number.parseInt(normalized.split(':')[1] || '0', 16);
  if (first < 0x2000 || first > 0x3fff || normalized === '2a06:98c0:3600::103' || (first === 0x2001 && (second < 0x0200 || second === 0x0db8)) || first === 0x2002 || (first === 0x3fff && second < 0x1000)) return null;
  return normalized;
}
async function visit(request: Request, config: AdminConfig, db: D1Database, now: number): Promise<Response> {
  sameOrigin(request, config.canonicalOrigin!);
  const data = await body(request);
  if (typeof data.visitId !== 'string' || !UUID_RE.test(data.visitId)) deny(400, 'invalid_request');
  const deleteSecret = typeof data.deleteSecret === 'string' && TOKEN_RE.test(data.deleteSecret) ? data.deleteSecret : null;
  if (config.requireVisitProof && !deleteSecret) deny(400, 'invalid_request');
  const active = await db.prepare('SELECT id FROM lotto_admin WHERE id = 1').first();
  if (!active) return json({ ok: true });
  await rate(db, 'visit:global', now, 120, 60_000);
  const ip = config.trustConnectingIp ? publicConnectingIp(request.headers.get('cf-connecting-ip')) : null;
  if (ip) await rate(db, `visit:address:${digest(ip)}`, now, 30, 60_000);
  await cleanup(db, now);
  const environment = parseVisitEnvironment(request.headers.get('user-agent'));
  const displayMode = normalizeVisitDisplayMode(data.displayMode);
  await db.prepare(`INSERT INTO lotto_visits (visit_id, ip, at, device, os, browser, display_mode, delete_proof_hash)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lotto_deleted_records WHERE kind = 'visit' AND id_hash = ? AND proof_hash = ?)
    ON CONFLICT(visit_id) DO NOTHING`)
    .bind(data.visitId.toLowerCase(), ip, now, environment.device, environment.os, environment.browser, displayMode,
      deleteSecret ? digest(deleteSecret) : null, digest(`visit:${data.visitId.toLowerCase()}`), deleteSecret ? digest(deleteSecret) : '').run();
  return json({ ok: true });
}

export async function handleAdminRequest(action: AdminAction, request: Request, config: AdminConfig, _identity: AdminIdentity, now = Date.now()): Promise<Response> {
  try {
    const expectedMethod = action === 'state' || action === 'visits' ? 'GET' : 'POST';
    if (request.method !== expectedMethod) deny(405, 'invalid_request');
    const db = configured(config, request);
    if (action === 'visit') return await visit(request, config, db, now);
    if (request.method === 'POST') sameOrigin(request, config.canonicalOrigin!);
    if (action === 'setup') deny(403, 'forbidden');
    const challenge = action === 'state' && !sessionToken(request) && !readTokenCookie(request, CHALLENGE_COOKIE) ? token() : undefined;
    const context = await administrator(db, request, now, challenge);
    if (action === 'state') {
      const authenticated = await session(context, request);
      const state = authenticated ? 'ready' : 'locked';
      const csrf = await issueCsrf(context, authenticated, request, config);
      await cleanup(db, now);
      return json({ state, csrf }, 200, challenge
        ? `${CHALLENGE_COOKIE}=${challenge}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${CHALLENGE_MS / 1000}` : undefined);
    }
    if (action === 'visits') {
      if (!await session(context, request)) deny(401, 'locked');
      const cursor = new URL(request.url).searchParams.get('before');
      if (cursor !== null && (!/^[1-9]\d{0,15}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) deny(400, 'invalid_request');
      await cleanup(db, now);
      const rows = await db.prepare('SELECT id, ip, at, device, os, browser, display_mode FROM lotto_visits WHERE at >= ? AND id < ? ORDER BY id DESC LIMIT 51')
        .bind(now - RETENTION_MS, cursor === null ? Number.MAX_SAFE_INTEGER : Number(cursor)).all<{
          id: number; ip: string | null; at: number;
          device: string | null; os: string | null; browser: string | null; display_mode: string | null;
        }>();
      const visits = rows.results.slice(0, 50).map(row => ({
        ...row,
        device: row.device === null ? null : normalizeVisitDevice(row.device),
        os: row.os === null ? null : normalizeVisitOs(row.os),
        browser: row.browser === null ? null : normalizeVisitBrowser(row.browser),
        display_mode: row.display_mode === null ? null : normalizeVisitDisplayMode(row.display_mode),
      }));
      return json({ visits, ...(rows.results.length > 50 ? { nextCursor: String(visits[visits.length - 1].id) } : {}) });
    }
    const data = await body(request);
    await consumeCsrf(context, data.csrf);
    if (action === 'login') {
      if (!context.admin) deny(403, 'forbidden');
      const value = password(data.password);
      await kdfRate(context, action);
      const validPassword = await verifyPassword(value, context.admin.password_hash);
      if (data.username !== ADMIN_USERNAME || !validPassword) deny(401, 'invalid_credentials');
      return json({ ok: true }, 200, cookie(await createSession(context, context.admin, request)));
    }
    if (!context.admin || !await session(context, request)) deny(401, 'locked');
    if (action === 'logout') {
      await db.prepare('DELETE FROM lotto_admin_sessions WHERE token_hash = ? AND user_id = ?')
        .bind(digest(sessionToken(request)!), context.admin.user_id).run();
      return json({ ok: true }, 200, cookie('', 0));
    }
    const value = newPassword(data);
    const current = password(data.currentPassword);
    await kdfRate(context, action);
    if (!await verifyPassword(current, context.admin.password_hash)) deny(401, 'invalid_credentials');
    const hash = await hashPassword(value);
    const sessionValue = token();
    const nextVersion = context.admin.credential_version + 1;
    const result = await db.batch([
      db.prepare('UPDATE lotto_admin SET password_hash = ?, credential_version = ?, updated_at = ? WHERE id = 1 AND user_id = ? AND credential_version = ? AND password_hash = ?')
        .bind(hash, nextVersion, now, context.admin.user_id, context.admin.credential_version, context.admin.password_hash),
      db.prepare('DELETE FROM lotto_admin_sessions WHERE user_id = ? AND credential_version <> (SELECT credential_version FROM lotto_admin WHERE id = 1)')
        .bind(context.admin.user_id),
      db.prepare(`INSERT INTO lotto_admin_sessions (token_hash, user_id, credential_version, created_at, expires_at)
        SELECT ?, user_id, credential_version, ?, ? FROM lotto_admin WHERE id = 1 AND user_id = ? AND credential_version = ? AND password_hash = ?`)
        .bind(digest(sessionValue), now, now + SESSION_MS, context.admin.user_id, nextVersion, hash),
      db.prepare('DELETE FROM lotto_admin_csrf'),
    ]);
    if (result[0].meta.changes !== 1 || result[2].meta.changes !== 1) deny(403, 'forbidden');
    return json({ ok: true }, 200, cookie(sessionValue));
  } catch (error) {
    // Public navigation never depends on logging success. No request values enter logs/errors.
    if (action === 'visit') return json({ ok: true });
    const failure = error instanceof Denied ? error : new Denied(503, 'unavailable');
    const state = ['unauthenticated', 'unavailable', 'forbidden'].includes(failure.code) ? failure.code : 'unavailable';
    return json(action === 'state' ? { state } : { error: failure.code }, failure.status);
  }
}

/** Narrow server-only reuse by recommendation routes; existing admin behavior stays unchanged. */
export {
  Denied as AdminDenied,
  configured as requireAdminConfig,
  sameOrigin as requireAdminSameOrigin,
  rate as adminRateLimit,
  cleanup as cleanupAdminRecords,
  json as adminJson,
};
export async function requireAdminSession(db: D1Database, _identity: AdminIdentity, _config: AdminConfig, request: Request, now: number): Promise<string> {
  const context = await administrator(db, request, now);
  if (!await session(context, request)) deny(401, 'locked');
  return context.admin.user_id;
}
