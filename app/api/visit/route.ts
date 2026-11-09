import { serveAdmin } from '@/lib/admin-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return serveAdmin('visit', request); }
