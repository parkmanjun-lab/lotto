/** Server-only proof-of-possession deletion. Never log or return deletion capabilities. */
import { createHash } from 'node:crypto';
import { AdminDenied, adminJson, adminRateLimit, publicConnectingIp, requireAdminConfig, requireAdminSameOrigin, type AdminConfig } from './admin-core';
import { readRecommendationBody } from './recommendation-core';

type DeletionRecord = { kind: 'visit' | 'recommendation'; id: string; proof: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROOF_RE = /^[A-Za-z0-9_-]{43}$/;
function fail(status: number, code: string): never { throw new AdminDenied(status, code); }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function parse(value: unknown): DeletionRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_request');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.records) || data.records.length < 1 || data.records.length > 20) fail(400, 'invalid_request');
  const records = data.records.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_request');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 3 || !['visit', 'recommendation'].includes(item.kind as string) ||
      typeof item.id !== 'string' || !UUID_RE.test(item.id) || typeof item.proof !== 'string' || !PROOF_RE.test(item.proof)) fail(400, 'invalid_request');
    return { kind: item.kind as DeletionRecord['kind'], id: item.id.toLowerCase(), proof: item.proof };
  });
  if (new Set(records.map(record => `${record.kind}:${record.id}`)).size !== records.length) fail(400, 'invalid_request');
  return records;
}

export async function handlePrivacyDelete(request: Request, config: AdminConfig, options: { clock?: () => number; bodyTimeoutMs?: number } = {}): Promise<Response> {
  try {
    if (request.method !== 'POST') fail(405, 'invalid_request');
    const db = requireAdminConfig(config, request);
    requireAdminSameOrigin(request, config.canonicalOrigin!);
    const now = (options.clock ?? Date.now)();
    const ip = config.trustConnectingIp ? publicConnectingIp(request.headers.get('cf-connecting-ip')) : null;
    await adminRateLimit(db, 'privacy-delete:global', now, 60, 60_000);
    await adminRateLimit(db, `privacy-delete:address:${ip ? digest(ip) : 'unknown'}`, now, 12, 60_000);
    const records = parse(await readRecommendationBody(request, options.bodyTimeoutMs));
    const statements: D1PreparedStatement[] = [];
    for (const record of records) {
      const table = record.kind === 'visit' ? 'lotto_visits' : 'lotto_recommendations';
      const idColumn = record.kind === 'visit' ? 'visit_id' : 'batch_id';
      const proofHash = digest(record.proof);
      const idHash = digest(`${record.kind}:${record.id}`);
      statements.push(
        // For an absent row, retain this exact capability's pre-delete intent. A different
        // proof cannot block its future creation. Existing rows require the matching proof.
        db.prepare(`INSERT INTO lotto_deleted_records (id_hash, proof_hash, kind) SELECT ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${idColumn} = ?
            AND (delete_proof_hash IS NULL OR delete_proof_hash <> ?))
          ON CONFLICT(id_hash, proof_hash) DO NOTHING`).bind(idHash, proofHash, record.kind, record.id, proofHash),
        db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ? AND delete_proof_hash = ?`).bind(record.id, proofHash),
      );
    }
    // Includes winner detail and IP. Aggregate triggers retain only anonymous full counts.
    // Pre-delete/tombstone + deletion are atomic. Collection checks the same proof-bound
    // tombstone inside its INSERT, closing the delete-before-first-INSERT race.
    if (statements.length) await db.batch(statements);
    return adminJson({ ok: true });
  } catch (error) {
    const failure = error instanceof AdminDenied ? error : new AdminDenied(503, 'unavailable');
    return adminJson({ error: failure.code }, failure.status);
  }
}
