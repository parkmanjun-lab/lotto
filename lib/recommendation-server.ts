/** Server-only runtime adapter. No bootstrap, session or secret is changed by these routes. */
import { env } from 'cloudflare:workers';
import { getOfficialHistory } from './history-server';
import { adminJson, type AdminConfig } from './admin-core';
import { handleRecommendationRequest } from './recommendation-core';

export async function serveRecommendations(action: 'collect' | 'list', request: Request): Promise<Response> {
  const runtime = env as { DB?: D1Database; ADMIN_BOOTSTRAP_EMAIL?: string; ADMIN_CANONICAL_ORIGIN?: string; ADMIN_TRUST_CF_CONNECTING_IP?: string; RECOMMENDATION_RECORDING_ENABLED?: string };
  // Default OFF: deployment alone cannot activate this policy-pending collection feature.
  if (action === 'collect' && runtime.RECOMMENDATION_RECORDING_ENABLED !== '1') return adminJson({ error: 'recording_disabled' }, 503);
  const config: AdminConfig = {
    db: runtime.DB, bootstrapEmail: runtime.ADMIN_BOOTSTRAP_EMAIL, canonicalOrigin: runtime.ADMIN_CANONICAL_ORIGIN,
    trustConnectingIp: runtime.ADMIN_TRUST_CF_CONNECTING_IP === '1',
  };
  try {
    return await handleRecommendationRequest(action, request, config, null, {
      getHistory: async () => {
        const history = await getOfficialHistory();
        return { ...history, status: history.status === 'live' ? 'live' : 'saved',
          verification: history.verification === 'conflict' ? 'conflict' : history.verification === 'live' ? 'live' : 'cached' };
      },
    });
  } catch { return adminJson({ error: 'unavailable' }, 503); }
}
