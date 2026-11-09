import { servePrivacyDelete } from '@/lib/privacy-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return servePrivacyDelete(request); }
