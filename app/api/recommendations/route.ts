import { serveRecommendations } from '@/lib/recommendation-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return serveRecommendations('collect', request); }
