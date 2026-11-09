import type { Draw } from './lotto.mjs';
import type { VisitBrowser, VisitDevice, VisitDisplayMode, VisitOs } from './visit-environment';

/** These are client-submitted numbers, not proof of engine execution or a purchased ticket. */
export type RecommendationPayload = {
  batchId: string;
  combinations: number[][];
  window: 20 | 50 | 100;
  analyzedRound: number;
  appVersion: string;
  generationMethod: string;
  displayMode: VisitDisplayMode;
  targetRound: number;
  deleteSecret: string;
};
export type RecommendationTarget = { targetRound: number; targetDate: string; cutoffAt: number };
export type RecommendationReceipt = RecommendationTarget & {
  batchId: string;
  acceptedAt: number;
  appVersion: string;
  generationMethod: string;
};
export type RecommendationRank = 1 | 2 | 3 | 4 | 5;
export type RecommendationResult = {
  numbers: number[];
  status: 'pending' | 'losing' | 'matched';
  rank: RecommendationRank | null;
  matchedCount: number | null;
  bonusMatch: boolean | null;
};
export type RecommendationBatch = RecommendationReceipt & {
  id: number;
  window: 20 | 50 | 100;
  analyzedRound: number;
  source: 'client_submission';
  originalCombinationCount: 10;
  detailsPruned: boolean;
  privacyExpired: boolean;
  ip: string | null;
  device: VisitDevice | null;
  os: VisitOs | null;
  browser: VisitBrowser | null;
  displayMode: VisitDisplayMode | null;
  draw: Draw | null;
  combinations: RecommendationResult[];
};
export type RecommendationSummary = {
  batchCount: number;
  combinationCount: number;
  pending: number;
  deletedBeforeResult: number;
  losing: number;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  rank5: number;
  matchedCombinationCount: number;
};
export type RecommendationHistoryStatus = {
  checkedAt: string;
  source: string;
  status: 'live' | 'saved';
  verification: 'live' | 'cached' | 'conflict';
  message: string;
};
export type RecommendationList = {
  batches: RecommendationBatch[];
  nextCursor?: string;
  summary: RecommendationSummary;
  history: RecommendationHistoryStatus;
  acceptedSince: number | null;
  asOf: number;
  availableRounds: number[];
  selectedRound: number | null;
  processingPending: boolean;
};
