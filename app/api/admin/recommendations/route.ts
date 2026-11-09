import { serveRecommendations } from '@/lib/recommendation-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return serveRecommendations('list', request); }
