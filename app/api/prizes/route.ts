import {getPrizeResults} from '@/lib/prize-server';
export async function GET(){return Response.json(await getPrizeResults(),{headers:{'Cache-Control':'private, no-store'}})}
