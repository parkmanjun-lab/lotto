import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { VISIT_BROWSERS, VISIT_DEVICES, VISIT_DISPLAY_MODES, VISIT_OSES } from '../lib/visit-environment';

export const lottoAdmin = sqliteTable('lotto_admin', {
  id: integer('id').primaryKey(),
  userId: text('user_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  credentialVersion: integer('credential_version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [check('lotto_admin_single_owner', sql`${table.id} = 1`)]);

export const lottoAdminSessions = sqliteTable('lotto_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  credentialVersion: integer('credential_version').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('lotto_sessions_expiry').on(table.expiresAt), index('lotto_sessions_user').on(table.userId)]);

export const lottoAdminCsrf = sqliteTable('lotto_admin_csrf', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('lotto_csrf_expiry').on(table.expiresAt)]);

export const lottoAdminRate = sqliteTable('lotto_admin_rate', {
  bucket: text('bucket').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('lotto_rate_expiry').on(table.expiresAt)]);

export const lottoVisits = sqliteTable('lotto_visits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  visitId: text('visit_id').notNull().unique(),
  deleteProofHash: text('delete_proof_hash'),
  ip: text('ip'),
  at: integer('at').notNull(),
  device: text('device', { enum: VISIT_DEVICES }),
  os: text('os', { enum: VISIT_OSES }),
  browser: text('browser', { enum: VISIT_BROWSERS }),
  displayMode: text('display_mode', { enum: VISIT_DISPLAY_MODES }),
}, table => [index('lotto_visits_at').on(table.at)]);

// Receipt columns never change. Raw detail is compacted after its retention period.
export const lottoRecommendations = sqliteTable('lotto_recommendations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id').notNull().unique(),
  payloadHash: text('payload_hash').notNull(),
  deleteProofHash: text('delete_proof_hash').notNull(),
  combinationsJson: text('combinations_json'),
  acceptedAt: integer('accepted_at').notNull(),
  targetRound: integer('target_round').notNull(),
  targetDate: text('target_date').notNull(),
  cutoffAt: integer('cutoff_at').notNull(),
  analysisWindow: integer('analysis_window').notNull(),
  analyzedRound: integer('analyzed_round').notNull(),
  appVersion: text('app_version').notNull(),
  generationMethod: text('generation_method').notNull(),
  ip: text('ip'),
  device: text('device', { enum: VISIT_DEVICES }),
  os: text('os', { enum: VISIT_OSES }),
  browser: text('browser', { enum: VISIT_BROWSERS }),
  displayMode: text('display_mode', { enum: VISIT_DISPLAY_MODES }),
  resultsJson: text('results_json'),
  drawJson: text('draw_json'),
  settledAt: integer('settled_at'),
  detailsPruned: integer('details_pruned').notNull().default(0),
  losingCount: integer('losing_count').notNull().default(0),
  rank1Count: integer('rank1_count').notNull().default(0),
  rank2Count: integer('rank2_count').notNull().default(0),
  rank3Count: integer('rank3_count').notNull().default(0),
  rank4Count: integer('rank4_count').notNull().default(0),
  rank5Count: integer('rank5_count').notNull().default(0),
}, table => [
  index('lotto_recommendations_accepted').on(table.acceptedAt),
  index('lotto_recommendations_round_id').on(table.targetRound, table.id),
  index('lotto_recommendations_unsettled').on(table.settledAt, table.targetRound),
  check('lotto_recommendations_numbers', sql`(${table.combinationsJson} IS NULL AND ${table.detailsPruned} = 1) OR (json_valid(${table.combinationsJson}) AND json_type(${table.combinationsJson}) = 'array' AND ((${table.detailsPruned} = 0 AND json_array_length(${table.combinationsJson}) = 10) OR (${table.detailsPruned} = 1 AND json_array_length(${table.combinationsJson}) BETWEEN 1 AND 10)))`),
  check('lotto_recommendations_window', sql`${table.analysisWindow} IN (20, 50, 100)`),
  check('lotto_recommendations_target', sql`${table.analyzedRound} > 0 AND ${table.analyzedRound} < ${table.targetRound} AND ${table.acceptedAt} < ${table.cutoffAt}`),
  check('lotto_recommendations_settlement', sql`${table.settledAt} IS NULL OR ${table.losingCount} + ${table.rank1Count} + ${table.rank2Count} + ${table.rank3Count} + ${table.rank4Count} + ${table.rank5Count} = 10`),
]);

// Anonymous complete denominators survive removal of losing-number detail.
export const lottoRecommendationRounds = sqliteTable('lotto_recommendation_rounds', {
  targetRound: integer('target_round').primaryKey(),
  drawJson: text('draw_json'),
  verifiedAt: integer('verified_at'),
  batchCount: integer('batch_count').notNull().default(0),
  combinationCount: integer('combination_count').notNull().default(0),
  pending: integer('pending').notNull().default(0),
  deletedUnresolved: integer('deleted_unresolved').notNull().default(0),
  losing: integer('losing').notNull().default(0),
  rank1: integer('rank1').notNull().default(0),
  rank2: integer('rank2').notNull().default(0),
  rank3: integer('rank3').notNull().default(0),
  rank4: integer('rank4').notNull().default(0),
  rank5: integer('rank5').notNull().default(0),
}, table => [check('lotto_recommendation_rounds_total', sql`${table.combinationCount} = ${table.pending} + ${table.deletedUnresolved} + ${table.losing} + ${table.rank1} + ${table.rank2} + ${table.rank3} + ${table.rank4} + ${table.rank5}`)]);

// Bound to both random record ID and capability: pre-delete cannot deny an unrelated future proof.
export const lottoDeletedRecords = sqliteTable('lotto_deleted_records', {
  idHash: text('id_hash').notNull(),
  proofHash: text('proof_hash').notNull(),
  kind: text('kind', { enum: ['visit', 'recommendation'] }).notNull(),
}, table => [primaryKey({ columns: [table.idHash, table.proofHash] })]);
