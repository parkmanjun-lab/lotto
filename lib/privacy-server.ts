import { env } from 'cloudflare:workers';
import { handlePrivacyDelete } from './privacy-core';

export async function servePrivacyDelete(request: Request): Promise<Response> {
  const runtime = env as { DB?: D1Database; ADMIN_BOOTSTRAP_EMAIL?: string; ADMIN_CANONICAL_ORIGIN?: string; ADMIN_TRUST_CF_CONNECTING_IP?: string };
  // Deletion remains available even while collection is disabled.
  return handlePrivacyDelete(request, {
    db: runtime.DB, bootstrapEmail: runtime.ADMIN_BOOTSTRAP_EMAIL, canonicalOrigin: runtime.ADMIN_CANONICAL_ORIGIN,
    trustConnectingIp: runtime.ADMIN_TRUST_CF_CONNECTING_IP === '1',
  });
}
