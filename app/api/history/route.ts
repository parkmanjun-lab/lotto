import {getOfficialHistory} from '@/lib/history-server';
export async function GET(){return Response.json(await getOfficialHistory(),{headers:{'Cache-Control':'private, no-store'}})}
