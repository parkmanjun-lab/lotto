/** Server only. Client submissions are recorded faithfully, never certified as engine output. */
import { createHash } from 'node:crypto';
import {
  AdminDenied, adminJson, adminRateLimit, cleanupAdminRecords, publicConnectingIp,
  requireAdminConfig, requireAdminSameOrigin, requireAdminSession,
  type AdminConfig, type AdminIdentity,
} from './admin-core';
import { getRecommendationTarget } from './recommendation-round';
import {
  normalizeVisitBrowser, normalizeVisitDevice, normalizeVisitDisplayMode, normalizeVisitOs,
  parseVisitEnvironment, VISIT_DISPLAY_MODES,
} from './visit-environment';
import type { Draw } from './lotto.mjs';
import type {
  RecommendationBatch, RecommendationHistoryStatus, RecommendationList, RecommendationPayload,
  RecommendationReceipt, RecommendationResult, RecommendationSummary,
} from './recommendation-types';

export const RECOMMENDATION_BODY_MAX = 4096;
export const RECOMMENDATION_BODY_TIMEOUT_MS = 5000;
const PAGE_SIZE = 25;
const PERSONAL_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
const MAINTENANCE_LIMIT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYLOAD_KEYS = ['batchId', 'combinations', 'window', 'analyzedRound', 'appVersion', 'generationMethod', 'displayMode', 'targetRound', 'deleteSecret'];
type History = RecommendationHistoryStatus & { draws: Draw[] };
export type RecommendationDependencies = { clock?: () => number; bodyTimeoutMs?: number; getHistory?: () => Promise<History> };
type Row = {
  id: number; batch_id: string; payload_hash: string; combinations_json: string | null;
  accepted_at: number; target_round: number; target_date: string; cutoff_at: number;
  analysis_window: 20 | 50 | 100; analyzed_round: number; app_version: string; generation_method: string;
  ip: string | null; device: string | null; os: string | null; browser: string | null; display_mode: string | null;
  results_json: string | null; draw_json: string | null; settled_at: number | null; details_pruned: number;
  losing_count: number; rank1_count: number; rank2_count: number; rank3_count: number; rank4_count: number; rank5_count: number;
};
const COLUMNS = 'id, batch_id, payload_hash, combinations_json, accepted_at, target_round, target_date, cutoff_at, analysis_window, analyzed_round, app_version, generation_method, ip, device, os, browser, display_mode, results_json, draw_json, settled_at, details_pruned, losing_count, rank1_count, rank2_count, rank3_count, rank4_count, rank5_count';
function fail(status: number, code: string): never { throw new AdminDenied(status, code); }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

/** A real wall-clock deadline bounds a missing final chunk as well as an oversized body. */
export async function readRecommendationBody(request: Request, timeoutMs = RECOMMENDATION_BODY_TIMEOUT_MS): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) fail(400, 'invalid_request');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > RECOMMENDATION_BODY_MAX)) fail(413, 'invalid_request');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_request');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const consume = async () => {
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > RECOMMENDATION_BODY_MAX) {
          void reader.cancel().catch(() => {});
          fail(413, 'invalid_request');
        }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail(400, 'invalid_request'); }
  };
  try {
    return await Promise.race([
      consume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => {});
          reject(new AdminDenied(408, 'request_timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function validateRecommendationPayload(value: unknown): RecommendationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_request');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== PAYLOAD_KEYS.length || Object.keys(data).some(key => !PAYLOAD_KEYS.includes(key))) fail(400, 'invalid_request');
  if (typeof data.batchId !== 'string' || !UUID_RE.test(data.batchId)) fail(400, 'invalid_request');
  if (typeof data.deleteSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.deleteSecret)) fail(400, 'invalid_request');
  if (![20, 50, 100].includes(data.window as number)) fail(400, 'invalid_request');
  if (!Number.isInteger(data.analyzedRound) || (data.analyzedRound as number) < 1 || (data.analyzedRound as number) > 10000) fail(400, 'invalid_request');
  if (!Number.isInteger(data.targetRound) || (data.targetRound as number) < 1 || (data.targetRound as number) > 10000 || (data.analyzedRound as number) >= (data.targetRound as number)) fail(400, 'invalid_request');
  if (typeof data.appVersion !== 'string' || !/^[a-f0-9]{24}$/.test(data.appVersion)) fail(400, 'invalid_request');
  if (typeof data.generationMethod !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(data.generationMethod)) fail(400, 'invalid_request');
  if (typeof data.displayMode !== 'string' || !(VISIT_DISPLAY_MODES as readonly string[]).includes(data.displayMode)) fail(400, 'invalid_request');
  if (!Array.isArray(data.combinations) || data.combinations.length !== 10) fail(400, 'invalid_request');
  const combinations = data.combinations.map((numbers: unknown) => {
    if (!Array.isArray(numbers) || numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 45)) fail(400, 'invalid_request');
    return [...numbers].sort((a, b) => a - b) as number[];
  });
  if (new Set(combinations.map(numbers => numbers.join('-'))).size !== 10) fail(400, 'invalid_request');
  // Explicit field order gives a stable digest. Ticket order is part of the submitted batch.
  return {
    batchId: data.batchId.toLowerCase(), combinations, window: data.window as 20 | 50 | 100,
    analyzedRound: data.analyzedRound as number, appVersion: data.appVersion,
    generationMethod: data.generationMethod, displayMode: normalizeVisitDisplayMode(data.displayMode),
    targetRound: data.targetRound as number,
    deleteSecret: data.deleteSecret,
  };
}
function receipt(row: Row): RecommendationReceipt {
  return { batchId: row.batch_id, acceptedAt: row.accepted_at, targetRound: row.target_round,
    targetDate: row.target_date, cutoffAt: row.cutoff_at, appVersion: row.app_version, generationMethod: row.generation_method };
}
function existingReceipt(row: Row, hash: string): Response {
  if (row.payload_hash !== hash) fail(409, 'batch_conflict');
  return adminJson({ ok: true, receipt: receipt(row) });
}

async function collect(request: Request, config: AdminConfig, db: D1Database, dependencies: RecommendationDependencies): Promise<Response> {
  requireAdminSameOrigin(request, config.canonicalOrigin!);
  if (!await db.prepare('SELECT id FROM lotto_admin WHERE id = 1').first()) fail(503, 'recording_disabled');
  const clock = dependencies.clock ?? Date.now;
  const ip = config.trustConnectingIp ? publicConnectingIp(request.headers.get('cf-connecting-ip')) : null;
  const requestAt = clock();
  // Invalid/stalled requests, replays and collisions consume this quota before body work.
  await adminRateLimit(db, 'recommendation:request:global', requestAt, 240, 60_000);
  await adminRateLimit(db, `recommendation:request:address:${ip ? digest(ip) : 'unknown'}`, requestAt, 60, 60_000);
  const payload = validateRecommendationPayload(await readRecommendationBody(request, dependencies.bodyTimeoutMs ?? RECOMMENDATION_BODY_TIMEOUT_MS));
  const hash = digest(JSON.stringify(payload));
  const idHash = digest(`recommendation:${payload.batchId}`);
  const proofHash = digest(payload.deleteSecret);
  if (await db.prepare("SELECT id_hash FROM lotto_deleted_records WHERE kind = 'recommendation' AND id_hash = ? AND proof_hash = ?").bind(idHash, proofHash).first()) fail(410, 'record_deleted');
  // A retry returns the original immutable receipt even after the target's cutoff.
  const previous = await db.prepare(`SELECT ${COLUMNS} FROM lotto_recommendations WHERE batch_id = ?`).bind(payload.batchId).first<Row>();
  if (previous) return existingReceipt(previous, hash);
  const rateAt = clock();
  await adminRateLimit(db, 'recommendation:global', rateAt, 120, 60_000);
  // Missing/untrusted addresses share one bounded anonymous bucket; XFF is never read.
  await adminRateLimit(db, `recommendation:address:${ip ? digest(ip) : 'unknown'}`, rateAt, 30, 60_000);
  await cleanupAdminRecords(db, rateAt);
  await cleanupRecommendationRecords(db, rateAt);
  const environment = parseVisitEnvironment(request.headers.get('user-agent'));
  const acceptedAt = clock();
  const target = getRecommendationTarget(acceptedAt);
  if (payload.targetRound !== target.targetRound) fail(409, 'target_expired');
  // All ten combinations and their metadata live in one atomic INSERT, never ten partial writes.
  const row = await db.prepare(`INSERT INTO lotto_recommendations
    (batch_id, payload_hash, delete_proof_hash, combinations_json, accepted_at, target_round, target_date, cutoff_at, analysis_window, analyzed_round, app_version, generation_method, ip, device, os, browser, display_mode)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM lotto_admin WHERE id = 1)
      AND NOT EXISTS (SELECT 1 FROM lotto_deleted_records WHERE kind = 'recommendation' AND id_hash = ? AND proof_hash = ?)
    ON CONFLICT(batch_id) DO NOTHING RETURNING ${COLUMNS}`)
    .bind(payload.batchId, hash, proofHash, JSON.stringify(payload.combinations), acceptedAt, target.targetRound, target.targetDate, target.cutoffAt,
      payload.window, payload.analyzedRound, payload.appVersion, payload.generationMethod, ip,
      environment.device, environment.os, environment.browser, payload.displayMode, idHash, proofHash).first<Row>();
  if (row) return adminJson({ ok: true, receipt: receipt(row) }, 201);
  // A concurrent submit can win the unique key. Never overwrite it or use this request's time.
  const winner = await db.prepare(`SELECT ${COLUMNS} FROM lotto_recommendations WHERE batch_id = ?`).bind(payload.batchId).first<Row>();
  if (winner) return existingReceipt(winner, hash);
  if (await db.prepare("SELECT id_hash FROM lotto_deleted_records WHERE kind = 'recommendation' AND id_hash = ? AND proof_hash = ?").bind(idHash, proofHash).first()) fail(410, 'record_deleted');
  fail(503, 'recording_disabled');
}

export function scoreRecommendation(numbers: number[], draw: Draw | null): RecommendationResult {
  if (!draw) return { numbers, status: 'pending', rank: null, matchedCount: null, bonusMatch: null };
  const matchedCount = numbers.filter(number => draw.numbers.includes(number)).length;
  const bonusMatch = numbers.includes(draw.bonus);
  const rank = matchedCount === 6 ? 1 : matchedCount === 5 ? (bonusMatch ? 2 : 3) : matchedCount === 4 ? 4 : matchedCount === 3 ? 5 : null;
  return { numbers, status: rank === null ? 'losing' : 'matched', rank, matchedCount, bonusMatch };
}

/** Request-driven bounded physical maintenance. Read responses mask expired data immediately. */
export async function cleanupRecommendationRecords(db: D1Database, now: number): Promise<void> {
  const expired = now - PERSONAL_RETENTION_MS;
  await db.batch([
    db.prepare(`UPDATE lotto_recommendations SET ip = NULL, device = NULL, os = NULL, browser = NULL, display_mode = NULL
      WHERE id IN (SELECT id FROM lotto_recommendations WHERE accepted_at <= ?
      AND (settled_at IS NULL OR losing_count = 10)
      AND (ip IS NOT NULL OR device IS NOT NULL OR os IS NOT NULL OR browser IS NOT NULL OR display_mode IS NOT NULL)
      ORDER BY id LIMIT ${MAINTENANCE_LIMIT})`).bind(expired),
    db.prepare(`UPDATE lotto_recommendations SET
      combinations_json = CASE WHEN losing_count = 10 THEN NULL ELSE
        (SELECT json_group_array(json(n.value)) FROM json_each(combinations_json) AS n
          WHERE CAST(json_extract(results_json, '$[' || n.key || '].rank') AS INTEGER) BETWEEN 1 AND 5) END,
      results_json = CASE WHEN losing_count = 10 THEN NULL ELSE
        (SELECT json_group_array(json(r.value)) FROM json_each(results_json) AS r
          WHERE CAST(json_extract(r.value, '$.rank') AS INTEGER) BETWEEN 1 AND 5) END,
      details_pruned = 1
      WHERE id IN (SELECT id FROM lotto_recommendations WHERE accepted_at <= ? AND settled_at IS NOT NULL
        AND details_pruned = 0 ORDER BY id LIMIT ${MAINTENANCE_LIMIT})`).bind(expired),
  ]);
}

function canonicalDraw(draw: Draw): string {
  return JSON.stringify({ round: draw.round, date: draw.date, numbers: [...draw.numbers].sort((a, b) => a - b), bonus: draw.bonus });
}
async function persistentConflict(db: D1Database, known: Map<number, Draw>): Promise<boolean> {
  const pins = await db.prepare('SELECT target_round, draw_json FROM lotto_recommendation_rounds WHERE draw_json IS NOT NULL').all<{ target_round: number; draw_json: string }>();
  return pins.results.some(pin => {
    const draw = known.get(pin.target_round);
    return draw !== undefined && canonicalDraw(draw) !== pin.draw_json;
  });
}

/** Durable official pins outlive Worker caches. Verdicts and counters are write-once. */
async function settleKnown(db: D1Database, history: History, now: number): Promise<{ processingPending: boolean; conflict: boolean }> {
  if (history.verification === 'conflict') return { processingPending: false, conflict: true };
  const known = new Map(history.draws.map(draw => [draw.round, draw]));
  if (await persistentConflict(db, known)) return { processingPending: false, conflict: true };
  const knownRoundJson = JSON.stringify([...known.keys()]);
  const candidates = await db.prepare(`SELECT ${COLUMNS} FROM lotto_recommendations
    WHERE settled_at IS NULL AND accepted_at <= ? AND target_round IN (SELECT value FROM json_each(?))
    ORDER BY id LIMIT ${MAINTENANCE_LIMIT + 1}`).bind(now, knownRoundJson).all<Row>();
  const toSettle = candidates.results.slice(0, MAINTENANCE_LIMIT);
  if (toSettle.length) {
    const rounds = [...new Set(toSettle.map(row => row.target_round))];
    const pins = rounds.map(round => db.prepare(`UPDATE lotto_recommendation_rounds SET draw_json = ?, verified_at = ?
      WHERE target_round = ? AND draw_json IS NULL`).bind(canonicalDraw(known.get(round)!), now, round));
    const updates = toSettle.map(row => {
      const draw = known.get(row.target_round)!;
      const numbers = JSON.parse(row.combinations_json!) as number[][];
      const results = numbers.map(ticket => scoreRecommendation(ticket, draw));
      const counts = Array.from({ length: 6 }, (_, rank) => results.filter(result => (result.rank ?? 0) === rank).length);
      // Numbers are retained only in combinations_json; verdicts do not duplicate losing numbers.
      const verdicts = results.map(({ rank, matchedCount, bonusMatch }) => ({ rank, matchedCount, bonusMatch }));
      return db.prepare(`UPDATE lotto_recommendations SET results_json = ?, draw_json = ?, settled_at = ?,
        losing_count = ?, rank1_count = ?, rank2_count = ?, rank3_count = ?, rank4_count = ?, rank5_count = ?
        WHERE id = ? AND settled_at IS NULL AND EXISTS (SELECT 1 FROM lotto_recommendation_rounds
          WHERE target_round = ? AND draw_json = ?)`)
        .bind(JSON.stringify(verdicts), canonicalDraw(draw), now, ...counts, row.id, row.target_round, canonicalDraw(draw));
    });
    // First official pin, guarded verdicts and aggregate triggers commit in one transaction.
    // A competing Worker with a different result can neither replace the pin nor mix verdicts.
    await db.batch([...pins, ...updates]);
  }
  return { processingPending: candidates.results.length > MAINTENANCE_LIMIT, conflict: await persistentConflict(db, known) };
}
function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, 'invalid_request');
  return Number(value);
}
async function list(request: Request, config: AdminConfig, db: D1Database, identity: AdminIdentity, dependencies: RecommendationDependencies): Promise<Response> {
  const clock = dependencies.clock ?? Date.now;
  const administratorId = await requireAdminSession(db, identity, config, request, clock());
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some(key => !['before', 'round', 'matched'].includes(key))) fail(400, 'invalid_request');
  if (['before', 'round', 'matched'].some(key => url.searchParams.getAll(key).length > 1)) fail(400, 'invalid_request');
  const before = positiveInteger(url.searchParams.get('before'));
  const selectedRound = positiveInteger(url.searchParams.get('round'));
  if (selectedRound !== null && selectedRound > 10000) fail(400, 'invalid_request');
  const matched = url.searchParams.get('matched');
  if (matched !== null && matched !== '1') fail(400, 'invalid_request');
  await adminRateLimit(db, `recommendation:read:${digest(administratorId)}`, clock(), 60);
  if (!dependencies.getHistory) fail(503, 'unavailable');
  const history = await dependencies.getHistory();
  const asOf = clock();
  await cleanupAdminRecords(db, asOf);
  const settlement = await settleKnown(db, history, asOf);
  const processingPending = settlement.processingPending;
  await cleanupRecommendationRecords(db, asOf);
  const summaryQuery = `SELECT
    COALESCE(SUM(batch_count), 0) AS batchCount, COALESCE(SUM(combination_count), 0) AS combinationCount,
    COALESCE(SUM(pending), 0) AS pending, COALESCE(SUM(losing), 0) AS losing,
    COALESCE(SUM(deleted_unresolved), 0) AS deletedBeforeResult,
    COALESCE(SUM(rank1), 0) AS rank1, COALESCE(SUM(rank2), 0) AS rank2,
    COALESCE(SUM(rank3), 0) AS rank3, COALESCE(SUM(rank4), 0) AS rank4,
    COALESCE(SUM(rank5), 0) AS rank5,
    COALESCE(SUM(rank1 + rank2 + rank3 + rank4 + rank5), 0) AS matchedCombinationCount
    FROM lotto_recommendation_rounds WHERE (? IS NULL OR target_round = ?)`;
  const pageQuery = `SELECT ${COLUMNS} FROM lotto_recommendations WHERE id < ? AND accepted_at <= ?
    AND (? IS NULL OR target_round = ?) AND combinations_json IS NOT NULL
    AND NOT (accepted_at <= ? AND settled_at IS NOT NULL AND losing_count = 10)
    AND (? = 0 OR rank1_count + rank2_count + rank3_count + rank4_count + rank5_count > 0)
    ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`;
  // Page, full denominator and round choices share one transactional database snapshot.
  const queries = await db.batch([
    db.prepare(summaryQuery).bind(selectedRound, selectedRound),
    db.prepare(pageQuery).bind(before ?? Number.MAX_SAFE_INTEGER, asOf, selectedRound, selectedRound,
      asOf - PERSONAL_RETENTION_MS, matched === '1' ? 1 : 0),
    db.prepare('SELECT target_round FROM lotto_recommendation_rounds ORDER BY target_round DESC LIMIT 10000'),
  ]);
  const summary = queries[0].results[0] as unknown as RecommendationSummary;
  const rows = queries[1].results as unknown as Row[];
  const availableRounds = (queries[2].results as unknown as { target_round: number }[]).map(row => row.target_round);
  const batches: RecommendationBatch[] = rows.slice(0, PAGE_SIZE).map(row => {
    const draw = row.draw_json === null ? null : JSON.parse(row.draw_json) as Draw;
    const numbers = JSON.parse(row.combinations_json!) as number[][];
    const verdicts = row.results_json === null ? null : JSON.parse(row.results_json) as Pick<RecommendationResult, 'rank' | 'matchedCount' | 'bonusMatch'>[];
    const pastOrdinaryRetention = row.accepted_at <= asOf - PERSONAL_RETENTION_MS;
    const hasConfirmedMatch = row.settled_at !== null && row.losing_count < 10;
    const privacyExpired = pastOrdinaryRetention && (!hasConfirmedMatch ||
      (row.ip === null && row.device === null && row.os === null && row.browser === null && row.display_mode === null));
    const detailsPruned = row.details_pruned === 1 || (pastOrdinaryRetention && row.settled_at !== null);
    let combinations = numbers.map((ticket, index): RecommendationResult => {
      if (!verdicts) return scoreRecommendation(ticket, null);
      const verdict = verdicts[index];
      return { numbers: ticket, ...verdict, status: verdict.rank === null ? 'losing' : 'matched' };
    });
    // Never expose expired losing detail even if bounded physical cleanup has a backlog.
    if (detailsPruned) combinations = combinations.filter(result => result.status === 'matched');
    return { ...receipt(row), id: row.id, window: row.analysis_window, analyzedRound: row.analyzed_round,
      source: 'client_submission', originalCombinationCount: 10, detailsPruned, privacyExpired,
      ip: privacyExpired ? null : row.ip,
      device: privacyExpired || row.device === null ? null : normalizeVisitDevice(row.device),
      os: privacyExpired || row.os === null ? null : normalizeVisitOs(row.os),
      browser: privacyExpired || row.browser === null ? null : normalizeVisitBrowser(row.browser),
      displayMode: privacyExpired || row.display_mode === null ? null : normalizeVisitDisplayMode(row.display_mode),
      draw, combinations };
  });
  const response: RecommendationList = {
    batches, ...(rows.length > PAGE_SIZE ? { nextCursor: String(batches[batches.length - 1].id) } : {}),
    summary, history: { checkedAt: history.checkedAt, source: history.source, status: history.status,
      verification: settlement.conflict ? 'conflict' : history.verification,
      message: settlement.conflict ? '저장된 공식 결과와 새 응답이 달라 새 판정을 보류했어. 기존 확정 결과는 유지해.' : history.message },
    acceptedSince: null, asOf, availableRounds, selectedRound, processingPending,
  };
  return adminJson(response);
}

export async function handleRecommendationRequest(action: 'collect' | 'list', request: Request, config: AdminConfig, identity: AdminIdentity, dependencies: RecommendationDependencies = {}): Promise<Response> {
  try {
    if (request.method !== (action === 'collect' ? 'POST' : 'GET')) fail(405, 'invalid_request');
    const db = requireAdminConfig(config, request);
    return action === 'collect' ? await collect(request, config, db, dependencies) : await list(request, config, db, identity, dependencies);
  } catch (error) {
    const failure = error instanceof AdminDenied ? error : new AdminDenied(503, 'unavailable');
    // Unlike optional visits, a recording failure is never reported as success.
    return adminJson({ error: failure.code }, failure.status);
  }
}
