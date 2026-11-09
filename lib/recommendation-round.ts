import type { RecommendationTarget } from './recommendation-types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Round 1: Saturday 2002-12-07, 20:00 Korea Standard Time (UTC+09:00).
const FIRST_CUTOFF = Date.UTC(2002, 11, 7, 11);

/** Pure shared schedule helper. The server independently recomputes this at acceptance. */
export function getRecommendationTarget(now: number): RecommendationTarget {
  if (!Number.isFinite(now) || now < FIRST_CUTOFF - WEEK_MS) throw new Error('invalid_time');
  const targetRound = Math.max(1, Math.floor((now - FIRST_CUTOFF) / WEEK_MS) + 2);
  const cutoffAt = FIRST_CUTOFF + (targetRound - 1) * WEEK_MS;
  return { targetRound, targetDate: new Date(cutoffAt).toISOString().slice(0, 10), cutoffAt };
}
