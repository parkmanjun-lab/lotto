import snapshot from '@/lib/data/prize-history.json';
import {createPrizeStore} from '@/lib/prize-results.mjs';
export const getPrizeResults=createPrizeStore(snapshot);
