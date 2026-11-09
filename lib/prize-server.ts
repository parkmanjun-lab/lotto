import snapshot from '@/lib/data/prize-history.json';
import {createPrizeStore} from '@/lib/prize-results.mjs';
import {upstreamFetch} from '@/lib/upstream-fetch';
export const getPrizeResults=createPrizeStore(snapshot,upstreamFetch);
