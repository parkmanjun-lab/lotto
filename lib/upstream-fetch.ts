// Shares official-data responses across Worker isolates through D1.
// Without it, every new isolate waits for the official site (up to 8 s)
// before it can answer /api/history, /api/prizes or the admin records.
// A fresh copy (younger than TTL_MS) is served from D1; otherwise the
// upstream is fetched as before and the copy is replaced.
// Outside the Worker (tests, local scripts) it is plain fetch().
const TTL_MS = 15 * 60 * 1000;
const FETCHED_AT = 'x-upstream-fetched-at';
let tableReady: Promise<unknown> | null = null;

function database(): D1Database | undefined {
  return (globalThis as { __siteEnv?: { DB?: D1Database } }).__siteEnv?.DB;
}

function ensureTable(db: D1Database) {
  tableReady ??= db
    .prepare('CREATE TABLE IF NOT EXISTS upstream_cache (url TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL)')
    .run()
    .catch((error) => { tableReady = null; throw error; });
  return tableReady;
}

// The table is created on first use, so a normal read costs one D1 query.
async function readCopy(db: D1Database, url: string) {
  const select = () => db.prepare('SELECT body, fetched_at FROM upstream_cache WHERE url = ?').bind(url).first<{ body: string; fetched_at: number }>();
  try {
    return await select();
  } catch (error) {
    if (!String(error).includes('no such table')) throw error;
    await ensureTable(db);
    return select();
  }
}

export async function upstreamFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const db = database();
  if (!db) return fetch(input, init);
  try {
    const row = await readCopy(db, url);
    if (row && Date.now() - row.fetched_at < TTL_MS) {
      return new Response(row.body, { headers: { 'Content-Type': 'application/json', [FETCHED_AT]: String(row.fetched_at) } });
    }
  } catch {
    return fetch(url, init);
  }
  const response = await fetch(url, init);
  if (!response.ok) return response;
  const body = await response.text();
  const fetchedAt = Date.now();
  if (body.length <= 1_500_000) {
    await db.prepare('INSERT INTO upstream_cache (url, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
      .bind(url, body, fetchedAt).run().catch(() => undefined);
  }
  return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json', [FETCHED_AT]: String(fetchedAt) } });
}

export function fetchedAtOf(response: Response, fallback: number): number {
  const value = Number(response.headers.get(FETCHED_AT));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
