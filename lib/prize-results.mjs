import {normalizeOfficial,validateDraws,SOURCE} from './lotto.mjs';

export const TAX_GUIDE='https://www.dhlottery.co.kr/guide/wnrGuide';
export const RESULTS_PAGE='https://www.dhlottery.co.kr/smarPage';
export const PRIZE_CRITERIA=['6개 번호 일치','5개 + 보너스 일치','5개 번호 일치','4개 번호 일치','3개 번호 일치'];
const integer=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

// Current-rate comparison only, not a reconstruction of historical tax payments.
// The purchase cost and the paying bank's won-level settlement are not included.
export function estimateNetPrize(amount){
  if(!integer(amount))throw Error('잘못된 당첨금');
  if(amount<=2_000_000)return {tax:0,net:amount};
  const tax=Math.floor((Math.min(amount,300_000_000)*22+Math.max(0,amount-300_000_000)*33)/100);
  return {tax,net:amount-tax};
}

export function validatePrizeDraws(input,now=Date.now()){
  const draws=validateDraws(input,now);
  const original=new Map(input.map(draw=>[draw.round,draw]));
  return draws.map(draw=>{
    const ranks=original.get(draw.round)?.ranks;
    if(!Array.isArray(ranks)||ranks.length!==5)throw Error('등수별 당첨내역이 없거나 형식이 달라졌어.');
    return {...draw,ranks:ranks.map((row,i)=>{
      if(row?.rank!==i+1||!integer(row.winners)||!integer(row.amount)||(row.winners>0&&row.amount===0)||(row.winners===0&&row.amount!==0))throw Error('등수별 당첨내역이 없거나 형식이 달라졌어.');
      return {rank:i+1,winners:row.winners,amount:row.amount};
    })};
  });
}

export function normalizeOfficialPrizes(raw,now=Date.now()){
  const draws=normalizeOfficial(raw,now);
  const records=new Map(raw.data.list.map(row=>[Number(row.ltEpsd),row]));
  const parse=value=>{
    if(value===null||value===undefined||value===''||typeof value==='boolean')throw Error('등수별 당첨내역 누락');
    const n=Number(value);if(!integer(n))throw Error('등수별 당첨내역 오류');return n;
  };
  return validatePrizeDraws(draws.map(draw=>({...draw,ranks:Array.from({length:5},(_,i)=>{
    const row=records.get(draw.round);return {rank:i+1,winners:parse(row[`rnk${i+1}WnNope`]),amount:parse(row[`rnk${i+1}WnAmt`])};
  })})),now);
}

export function createPrizeStore(snapshot,fetcher=(...args)=>fetch(...args),clock=()=>Date.now()){
  let lastGood=null,checkedAt=snapshot.metadata.retrievedAt,lastTry=null,pending=null,status='saved',verification='cached';
  async function refresh(){
    const response=await fetcher(SOURCE,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('upstream');
    const raw=await response.text();if(raw.length>5_000_000)throw Error('size');
    const next=normalizeOfficialPrizes(JSON.parse(raw),clock());
    if(next.length<lastGood.length)throw Error('regression');
    if(lastGood.some((draw,i)=>JSON.stringify(draw)!==JSON.stringify(next[i])))throw Error('conflict');
    const fetchedAt=Number(response.headers?.get?.('x-upstream-fetched-at'));lastGood=next;checkedAt=new Date(Number.isFinite(fetchedAt)&&fetchedAt>0?fetchedAt:clock()).toISOString();status='live';verification='live';
  }
  return async function getPrizeResults(){
    if(!lastGood)lastGood=validatePrizeDraws(snapshot.draws,clock());
    if(lastTry===null||clock()-lastTry>15*60*1000){
      lastTry=clock();pending=refresh().catch(error=>{status='saved';verification=error?.message==='conflict'?'conflict':'cached'}).finally(()=>{pending=null});
    }
    if(pending)await pending;
    return {draws:lastGood,checkedAt,status,verification,source:SOURCE,taxGuide:TAX_GUIDE};
  };
}
