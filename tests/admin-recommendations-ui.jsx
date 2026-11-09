// Synthetic DOM/API checks only. Never call live auth, databases, or public APIs.
const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import Admin from '../app/admin/page.tsx';

const dom=new JSDOM('<div id="root"></div>',{url:'https://lotto.test/admin'});
for(const key of ['window','document','navigator','HTMLElement','FormData'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
const {createRoot}=await import('react-dom/client');
const realSetInterval=globalThis.setInterval,realClearInterval=globalThis.clearInterval,polls=new Map();
globalThis.setInterval=(handler,delay,...args)=>{if(delay!==60000)return realSetInterval(handler,delay,...args);const id={};polls.set(id,()=>handler(...args));return id};
globalThis.clearInterval=id=>{if(polls.delete(id))return;realClearInterval(id)};
const acceptedAt=Date.parse('2026-10-13T01:02:03Z');
const groups=[
 {numbers:[1,2,3,4,5,6],status:'matched',rank:1,matchedCount:6,bonusMatch:false},
 {numbers:[1,2,3,4,5,7],status:'matched',rank:2,matchedCount:5,bonusMatch:true},
 {numbers:[1,2,3,4,5,8],status:'matched',rank:3,matchedCount:5,bonusMatch:false},
 {numbers:[1,2,3,4,8,9],status:'matched',rank:4,matchedCount:4,bonusMatch:false},
 {numbers:[1,2,3,8,9,10],status:'matched',rank:5,matchedCount:3,bonusMatch:false},
 ...Array.from({length:5},(_,i)=>({numbers:[10+i,20+i,30+i,35+i,40+i,45],status:'losing',rank:null,matchedCount:0,bonusMatch:false})),
];
function batch(id=20,extra={}){return {id,originalCombinationCount:10,detailsPruned:false,privacyExpired:false,batchId:'synthetic-'+id,acceptedAt,targetRound:1246,targetDate:'2026-10-17',cutoffAt:Date.parse('2026-10-17T11:00:00Z'),window:50,analyzedRound:1245,appVersion:'synthetic-v1',generationMethod:'<script>untrusted-method</script>',source:'client_submission',ip:'<script>synthetic-ip</script>',device:'iphone',os:'ios',browser:'safari',displayMode:'standalone',draw:{round:1246,date:'2026-10-17',numbers:[1,2,3,4,5,6],bonus:7},combinations:structuredClone(groups),...extra}}
const allSummary={batchCount:4,combinationCount:40,pending:10,deletedBeforeResult:0,losing:15,rank1:1,rank2:2,rank3:3,rank4:4,rank5:5,matchedCombinationCount:15};
function payload(extra={}){return {batches:[batch()],nextCursor:'19',summary:allSummary,history:{checkedAt:'2026-10-17T12:00:00Z',source:'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all',status:'live',verification:'live',message:'공식 자료 확인 완료'},processingPending:false,acceptedSince:null,asOf:acceptedAt,availableRounds:[1248,1247,1246],selectedRound:null,...extra}}
let root,state='ready',requests=[],actions=[],holdState=false,heldStates=[],holdAction=false,heldActions=[];
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
globalThis.fetch=(url,options={})=>{
 const path=String(url);
 if(path==='/api/admin/state')return holdState?new Promise(resolve=>heldStates.push(()=>resolve(reply({state,csrf:'synthetic-csrf'})))):Promise.resolve(reply({state,csrf:'synthetic-csrf'}));
 if(path.startsWith('/api/admin/visits'))return Promise.resolve(reply({visits:[{id:1,ip:'synthetic-visit',at:acceptedAt}],nextCursor:null}));
 if(path.startsWith('/api/admin/recommendations'))return new Promise((resolve,reject)=>requests.push({url:path,options,resolve,reject}));
 if(['/api/admin/logout','/api/admin/password','/api/admin/login'].includes(path)){
  actions.push({url:path,options});state=path.endsWith('login')?'ready':'locked';
  return holdAction?new Promise(resolve=>heldActions.push(()=>resolve(reply({})))):Promise.resolve(reply({}));
 }
 throw Error('Unexpected synthetic request '+path);
};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
async function mount(next='ready'){state=next;visibility='visible';requests=[];actions=[];heldStates=[];heldActions=[];holdState=false;holdAction=false;root=createRoot(document.getElementById('root'));await act(async()=>{root.render(<Admin/>);await flush()})}
async function unmount(){await act(async()=>root.unmount());document.getElementById('root').innerHTML=''}
async function succeed(index,value=payload()){await act(async()=>{requests[index].resolve(reply(value));await flush()})}
async function status(index,code){await act(async()=>{requests[index].resolve(new Response('{}',{status:code}));await flush()})}
async function click(label){const button=[...document.querySelectorAll('button')].find(element=>element.textContent===label);assert(button,label);await act(async()=>{button.click();await flush()})}
async function chooseRound(round){const select=document.querySelector('[aria-label="추천 대상 회차"]');assert(select);await act(async()=>{select.value=String(round);select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await flush()})}
async function event(target,name){await act(async()=>{target.dispatchEvent(new dom.window.Event(name));await flush()})}
const panel=()=>document.querySelector('.admin-recommendations');
const rows=()=>document.querySelectorAll('.admin-combination');

for(const denied of ['unauthenticated','forbidden','locked','setup','unavailable']){await mount(denied);assert.equal(panel(),null);assert.equal(requests.length,0);await unmount()}
await mount();assert.equal(requests.length,1);assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.credentials,'same-origin');assert(requests[0].options.signal instanceof AbortSignal);assert(panel().textContent.includes('불러오는 중'));assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='관리자 로그아웃').disabled,false,'recommendation request must not block auth');assert(document.querySelector('.admin-records').textContent.includes('synthetic-visit'),'visits load independently');
await succeed(0);assert.equal(rows().length,10);assert(panel().textContent.includes('분모: 접수 4묶음의 40조합 전체'),'summary denominator independent from current page');for(let rank=1;rank<=5;rank++)assert(panel().querySelector('.admin-combinations').textContent.includes(rank+'등 일치'));assert(panel().textContent.includes('분석 기준 1245회'));assert(panel().textContent.includes('당첨 비교 대상은 1246회만'));assert(panel().textContent.includes('접수 26. 10. 13. 오전 10:02:03 KST'));assert(panel().textContent.includes('아이폰')&&panel().textContent.includes('Safari'));assert(panel().textContent.includes('<script>synthetic-ip</script>'));assert.equal(document.querySelectorAll('script').length,0);assert.equal(document.querySelectorAll('img').length,0);assert(panel().textContent.includes('실제 구매나 당첨자 확인을 뜻하지 않아'));
await click('이전 추천 기록 더 보기');assert.equal(requests.length,2);assert(requests[1].url.includes('before=19'));assert.equal(rows().length,10);await succeed(1,payload({batches:[batch(19)],nextCursor:undefined}));assert.equal(rows().length,20);assert(panel().textContent.includes('분모: 접수 4묶음의 40조합 전체'));
await click('당첨 일치 기록');assert.equal(rows().length,0);assert(requests[2].url.endsWith('?matched=1'));await succeed(2,payload({nextCursor:undefined}));assert.equal(rows().length,5);assert([...rows()].every(row=>row.textContent.includes('등 일치')));assert(panel().textContent.includes('40조합 전체'));
await chooseRound(1246);assert.equal(rows().length,0);assert(requests[3].url.includes('round=1246')&&requests[3].url.includes('matched=1'));await succeed(3,payload({selectedRound:1246,nextCursor:undefined}));assert(panel().textContent.includes('1246회 접수 전체 요약'));await click('전체 추천 기록');assert(requests[4].url.includes('round=1246')&&!requests[4].url.includes('matched'));await succeed(4,payload({selectedRound:1246,nextCursor:undefined}));assert.equal(rows().length,10);
await unmount();

// The 60-second authorization poll clears private rows but preserves public filter choices.
await mount();await succeed(0);await click('당첨 일치 기록');await succeed(1);await chooseRound(1246);await succeed(2,payload({selectedRound:1246}));assert.equal(rows().length,5);assert.equal(polls.size,1);holdState=true;
await act(async()=>{[...polls.values()][0]();await flush()});assert.equal(panel(),null);assert(!document.body.textContent.includes('synthetic-ip'));assert.equal(requests.length,3);
await act(async()=>{heldStates.shift()();await flush()});assert.equal(requests.length,4);assert.equal(requests[3].url,'/api/admin/recommendations?round=1246&matched=1');assert.equal(rows().length,0);assert.equal(document.querySelector('[aria-label="추천 대상 회차"]').value,'1246','selected round visible even before available rounds reload');assert.equal([...panel().querySelectorAll('button')].find(button=>button.textContent==='당첨 일치 기록').getAttribute('aria-pressed'),'true');await succeed(3,payload({selectedRound:1246}));assert.equal(rows().length,5);
visibility='hidden';await event(document,'visibilitychange');assert.equal(panel(),null);visibility='visible';holdState=false;await event(document,'visibilitychange');assert.equal(requests[4].url,'/api/admin/recommendations?round=1246&matched=1');await succeed(4,payload({selectedRound:1246}));assert.equal(rows().length,5);await unmount();assert.equal(polls.size,0);

// Retry and saved-history visibility, including a late response from the old filter.
await mount();await status(0,500);assert(panel().querySelector('[role=alert]'));await click('추천 기록 다시 시도');assert.equal(requests.length,2);await succeed(1,payload({nextCursor:undefined,history:{checkedAt:'2026-10-10T12:00:00Z',source:'javascript:alert(1)',status:'saved',verification:'cached',message:'최신 결과 확인에 실패했어.'},batches:[batch(20,{draw:null,combinations:groups.map(result=>({...result,status:'pending',rank:null,matchedCount:null,bonusMatch:null})),device:'<img>',os:{x:true},browser:'toString',displayMode:'<svg>'})]}));assert(panel().textContent.includes('공식 원본 최신 확인 실패'));assert(panel().textContent.includes('공식 결과가 없어 아직 비교하지 않았어'));assert.equal(panel().querySelector('a[href^="javascript:"]'),null);assert.equal((panel().querySelector('.admin-environment').textContent.match(/미확인/g)||[]).length,4);assert.equal(panel().querySelectorAll('.admin-result--pending').length,10);
await click('당첨 일치 기록');await click('전체 추천 기록');assert(requests[2].options.signal.aborted);await succeed(3,payload({nextCursor:undefined,batches:[batch(30,{ip:'newer-response'})]}));await succeed(2,payload({batches:[batch(29,{ip:'must-not-return'})]}));assert(panel().textContent.includes('newer-response'));assert(!panel().textContent.includes('must-not-return'));await unmount();

// Hidden page immediately drops rows; ignored aborts cannot resurrect private records.
await mount();await succeed(0);await click('추천 기록 새로고침');visibility='hidden';await event(document,'visibilitychange');assert.equal(panel(),null);assert(requests[1].options.signal.aborted);await succeed(1,payload({batches:[batch(21,{ip:'hidden-late'})]}));assert.equal(panel(),null);visibility='visible';await event(document,'visibilitychange');assert.equal(requests.length,3);await succeed(2);holdState=true;await event(window,'pageshow');assert.equal(panel(),null,'pageshow clears before state check completes');assert(!document.body.textContent.includes('synthetic-ip'));await act(async()=>{heldStates.shift()();await flush()});assert.equal(requests.length,4);await succeed(3);await unmount();

// Password/logout remove all recommendation content before the mutation resolves.
for(const action of ['관리자 로그아웃','비밀번호 변경']){
 await mount();await succeed(0);holdAction=true;
 const form=action==='비밀번호 변경'?document.querySelector('.admin-password form'):[...document.querySelectorAll('form')].find(form=>form.textContent.includes(action));
 for(const input of form.querySelectorAll('input'))input.value='synthetic-password-only';
 await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush()});
 assert.equal(panel(),null,action+' hides private panel synchronously');assert.equal(document.querySelector('.admin-records'),null);assert(requests[0].options.signal.aborted);assert.equal(actions.length,1);
 await act(async()=>{heldActions.shift()();await flush()});assert.equal(panel(),null);assert(document.querySelector('input[name=password]'));await unmount();
}

// Expired authorization clears both record sections and does not refetch in a loop.
await mount();state='locked';await status(0,403);assert.equal(panel(),null);assert.equal(document.querySelector('.admin-records'),null);assert.equal(requests.length,1);assert(document.querySelector('input[name=password]'));await unmount();
await mount();await status(0,401);assert.equal(panel(),null);assert.equal(requests.length,1,'inconsistent ready response cannot recursively reopen failed panel');await unmount();

// Preserved winning details remain browsable after privacy/losing-detail expiry.
await mount();await succeed(0,payload({nextCursor:undefined,batches:[batch(20,{privacyExpired:true,detailsPruned:true,ip:'must-never-render-after-expiry',device:'iphone',os:'ios',browser:'safari',displayMode:'standalone',combinations:[groups[1]]})]}));assert.equal(rows().length,1);assert(panel().textContent.includes('IP 보존기간 경과'));assert(panel().textContent.includes('10일 보존기간 경과로 제거됨'));assert(!panel().textContent.includes('must-never-render-after-expiry'));assert(!panel().textContent.includes('아이폰'));assert(panel().textContent.includes('최초 접수 10조합'));assert(panel().textContent.includes('낙첨 원본은 제거되어 등수 일치 조합만'));assert(panel().textContent.includes('40조합 전체'));assert(panel().textContent.includes('목록 수와 다를 수 있어'));await unmount();
await mount();await succeed(0,payload({nextCursor:undefined,processingPending:true,history:{checkedAt:'2026-10-17T12:00:00Z',source:'https://www.dhlottery.co.kr/',status:'saved',verification:'conflict',message:'검증 자료 충돌'}}));assert(panel().textContent.includes('공식 자료 충돌 · 새 결과 비교 보류'));assert(panel().textContent.includes('이미 확정된 비교 결과는 보존'));assert(panel().textContent.includes('일부 접수 기록의 결과 비교를 처리 중'));assert.equal(rows().length,10);await unmount();

// Failed pagination retries the same cursor without replacing already rendered details.
await mount();await succeed(0);await click('이전 추천 기록 더 보기');await status(1,500);assert.equal(rows().length,10);await click('추천 기록 다시 시도');assert.equal(requests[1].url,requests[2].url);await succeed(2,payload({batches:[batch(19)],nextCursor:undefined}));assert.equal(rows().length,20);await unmount();

// Deleted-before-result submissions remain in the full denominator without becoming losses.
await mount();await succeed(0,payload({summary:{...allSummary,pending:0,deletedBeforeResult:10}}));assert.equal(rows().length,10);const deleted=[...panel().querySelectorAll('.admin-summary-item')].find(item=>item.querySelector('dt').textContent==='판정 전 삭제');assert.equal(deleted.querySelector('dd').textContent,'10');assert(panel().textContent.includes('40조합 전체'));await unmount();

// Invalid API shape must never leak records or create misleading totals.
await mount();await succeed(0,payload({summary:{...allSummary,combinationCount:999}}));assert.equal(rows().length,0);assert(panel().querySelector('[role=alert]'));await unmount();
await mount();const pending=requests[0];await unmount();assert(pending.options.signal.aborted);await act(async()=>{pending.resolve(reply(payload()));await flush()});assert.equal(document.body.textContent,'');
globalThis.setInterval=realSetInterval;globalThis.clearInterval=realClearInterval;
console.log('Admin recommendations UI PASS: authenticated-only fetch, all10/ranks/pending, exact-target labeling, global denominators, pagination, matched/round filters, escaping/KST/environment, retry/saved source, hidden/pageshow/auth mutations, aborted late responses, and unmount cleanup.');
