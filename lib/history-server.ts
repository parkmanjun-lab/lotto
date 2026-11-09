import snapshot from '@/lib/data/history.json';
import {normalizeOfficial,validateDraws,SOURCE,key} from '@/lib/lotto.mjs';
import type {Draw} from '@/lib/lotto.mjs';
import {upstreamFetch,fetchedAtOf} from '@/lib/upstream-fetch';
// Workers may evaluate modules without a request clock. Keep date validation
// inside GET so the snapshot is checked against the actual request time.
let lastGood:Draw[]=[];
let checkedAt=snapshot.metadata.retrievedAt;
let lastTry=0;
let pending:Promise<boolean>|null=null;
let fresh=false;
let conflict=false;
async function refresh(){
  const response=await upstreamFetch(SOURCE,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('upstream');
  const raw=await response.text();if(raw.length>5_000_000)throw Error('size');
  const draws=normalizeOfficial(JSON.parse(raw));
  if(draws.length<lastGood.length)throw Error('regression');
  for(let i=0;i<lastGood.length;i++)if(key(draws[i].numbers)!==key(lastGood[i].numbers)||draws[i].bonus!==lastGood[i].bonus)throw Error('historical correction requires review');
  lastGood=draws;checkedAt=new Date(fetchedAtOf(response,Date.now())).toISOString();return true;
}
export async function getOfficialHistory():Promise<{draws:Draw[],checkedAt:string,source:string,status:'live'|'saved',message:string,verification:'live'|'cached'|'conflict'}>{
  if(lastGood.length===0)lastGood=validateDraws(snapshot.draws);
  if(Date.now()-lastTry>15*60*1000){lastTry=Date.now();pending=refresh().then(ok=>{conflict=false;return ok}).catch(error=>{if(error instanceof Error&&error.message==='historical correction requires review')conflict=true;return false}).then(ok=>{fresh=ok;return ok;}).finally(()=>{pending=null;});}
  if(pending)await pending;
  return {draws:lastGood,checkedAt,verification:conflict?'conflict':fresh?'live':'cached',source:SOURCE,status:fresh?'live':'saved',message:fresh?'공식 데이터 확인 완료':'공식 사이트 연결을 확인하지 못했어. 마지막 검증 데이터를 사용 중이야.'};
}
