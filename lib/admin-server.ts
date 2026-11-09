import { env } from 'cloudflare:workers';
import { handleAdminRequest, type AdminAction, type AdminConfig } from './admin-core';

type Runtime = {
  DB?: D1Database;
  ADMIN_BOOTSTRAP_EMAIL?: string;
  ADMIN_CANONICAL_ORIGIN?: string;
  ADMIN_TRUST_CF_CONNECTING_IP?: string;
  RECOMMENDATION_RECORDING_ENABLED?: string;
};

export async function serveAdmin(action: AdminAction, request: Request): Promise<Response> {
  const runtime = env as Runtime;
  if (action === 'visit' && runtime.RECOMMENDATION_RECORDING_ENABLED !== '1') return Response.json({ ok: true }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
  const config: AdminConfig = {
    db: runtime.DB,
    bootstrapEmail: runtime.ADMIN_BOOTSTRAP_EMAIL,
    canonicalOrigin: runtime.ADMIN_CANONICAL_ORIGIN,
    // This stays off unless the hosting boundary is confirmed to replace the header.
    trustConnectingIp: runtime.ADMIN_TRUST_CF_CONNECTING_IP === '1',
    requireVisitProof: true,
  };
  try {
    return await handleAdminRequest(action, request, config, null);
  } catch {
    return Response.json(action === 'visit' ? { ok: true } : action === 'state' ? { state: 'unavailable' } : { error: 'unavailable' }, {
      status: action === 'visit' ? 200 : 503,
      headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
    });
  }
}
