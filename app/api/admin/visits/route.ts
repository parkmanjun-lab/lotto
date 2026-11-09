import { serveAdmin } from '@/lib/admin-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return serveAdmin('visits', request); }
