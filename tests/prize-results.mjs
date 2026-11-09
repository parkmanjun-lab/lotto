import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {estimateNetPrize,normalizeOfficialPrizes,validatePrizeDraws,createPrizeStore} from '../lib/prize-results.mjs';
const snapshot=JSON.parse(readFileSync(new URL('../lib/data/prize-history.json',import.meta.url),'utf8'));
const history=JSON.parse(readFileSync(new URL('../lib/data/history.json',import.meta.url),'utf8'));
const now=Date.parse(snapshot.metadata.retrievedAt);
function official(draws=snapshot.draws){return {data:{list:draws.map(draw=>{
 const row={ltEpsd:draw.round,ltRflYmd:draw.date.replaceAll('-',''),bnsWnNo:draw.bonus};
 draw.numbers.forEach((n,i)=>row[`tm${i+1}WnNo`]=n);
 draw.ranks.forEach(({rank,winners,amount})=>{row[`rnk${rank}WnNope`]=winners;row[`rnk${rank}WnAmt`]=amount});return row;
})}}}
test('all 1–1249 official prize rows validate and existing winning numbers are unchanged',()=>{
 const draws=validatePrizeDraws(snapshot.draws,now);assert.equal(draws.length,1249);
 for(const {ranks,...draw} of draws.slice(0,history.draws.length))assert.deepEqual(draw,history.draws[draw.round-1]);
 assert.deepEqual(normalizeOfficialPrizes(official(),now),draws);
 assert.deepEqual(draws.at(-1).numbers,[2,11,16,25,34,35]);assert.equal(draws.at(-1).bonus,14);
 assert.deepEqual(draws.at(-1).ranks,[{rank:1,winners:14,amount:2025045509},{rank:2,winners:93,amount:50807594},{rank:3,winners:3550,amount:1331016},{rank:4,winners:162101,amount:50000},{rank:5,winners:2634961,amount:5000}]);
 assert.deepEqual(draws[0].ranks[0],{rank:1,winners:0,amount:0});
 assert.equal(draws[0].ranks[3].amount,113400,'historical 4th prizes are not replaced with modern fixed amounts');
});
test('current tax threshold and progressive rates, including exact latest values',()=>{
 for(const n of [0,5000,50000,1331016,2000000])assert.deepEqual(estimateNetPrize(n),{tax:0,net:n});
 assert.deepEqual(estimateNetPrize(2000001),{tax:440000,net:1560001});
 assert.deepEqual(estimateNetPrize(300000000),{tax:66000000,net:234000000});
 assert.deepEqual(estimateNetPrize(500000000),{tax:132000000,net:368000000});
 assert.deepEqual(estimateNetPrize(2025045509),{tax:635265017,net:1389780492});
 assert.deepEqual(estimateNetPrize(50807594),{tax:11177670,net:39629924});
 for(const n of [-1,NaN,Infinity,0.5,'5000',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>estimateNetPrize(n));
});
test('missing and malformed rank data never become fabricated zeroes',()=>{
 for(const bad of [null,undefined,'',true,-1,1.5,'unknown']){const data=official();data.data.list[0].rnk2WnAmt=bad;assert.throws(()=>normalizeOfficialPrizes(data,now))}
 for(const mutate of [d=>d.draws.pop(),d=>d.draws[0].ranks.pop(),d=>d.draws[0].ranks[0].winners=1,d=>d.draws[1].ranks[0].winners=0,d=>d.draws[0].ranks[1].rank=1]){
  const d=structuredClone(snapshot);mutate(d);
  if(d.draws.length===1248)assert.equal(validatePrizeDraws(d.draws,now).length,1248);else assert.throws(()=>validatePrizeDraws(d.draws,now));
 }
 const missing=official();missing.data.list.splice(500,1);assert.throws(()=>normalizeOfficialPrizes(missing,now));
});
test('offline returns verified snapshot and collapse/caching limits network calls',async()=>{
 let calls=0,clock=now;
 const get=createPrizeStore(snapshot,async()=>{calls++;throw Error('offline')},()=>clock);
 const [a,b]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.equal(a.status,'saved');assert.deepEqual(a.draws,snapshot.draws);assert.deepEqual(a,b);
 await get();assert.equal(calls,1);clock+=900001;await get();assert.equal(calls,2);
});
test('valid official refresh succeeds; historical money correction fails closed',async()=>{
 let clock=now,raw=official();
 const get=createPrizeStore(snapshot,async()=>new Response(JSON.stringify(raw)),()=>clock);
 let data=await get();assert.equal(data.status,'live');assert.equal(data.verification,'live');
 clock+=900001;raw=official();raw.data.list[0].rnk2WnAmt+=1;
 data=await get();assert.equal(data.status,'saved');assert.equal(data.verification,'conflict');assert.deepEqual(data.draws,snapshot.draws);assert.equal(data.checkedAt,new Date(now).toISOString());
});
test('regression, malformed response and oversized response preserve last good records',async()=>{
 for(const body of [JSON.stringify(official(snapshot.draws.slice(0,-1))),'bad json','x'.repeat(5000001)]){
  const get=createPrizeStore(snapshot,async()=>new Response(body),()=>now);
  const data=await get();assert.equal(data.status,'saved');assert.deepEqual(data.draws,snapshot.draws);
 }
});
