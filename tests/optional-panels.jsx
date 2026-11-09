// DOM/module-loading regressions only. No HTTP or real-browser measurements.
const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import Home from '../app/page.tsx';
import snapshot from '../lib/data/history-client';
import {frequencies,recent50Groups} from '../lib/lotto.mjs';

const dom=new JSDOM('<div id="root"></div>',{url:'https://lotto.test/'});
for(const prop of ['window','document','navigator','localStorage','sessionStorage','HTMLElement'])Object.defineProperty(globalThis,prop,{value:dom.window[prop],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.scrollTo=()=>{};
const RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-12T06:00:00Z']))}static now(){return RealDate.parse('2026-10-12T06:00:00Z')}};
const realPerformance=globalThis.performance;
let clock=1000,copied='';
Object.defineProperty(globalThis,'performance',{configurable:true,value:{
  now:()=>clock,
  getEntriesByName:()=>[{startTime:700}],
  getEntriesByType:type=>type==='navigation'?[{responseStart:400,responseEnd:500,requestStart:200,type:'navigate'}]:[
    {name:'https://lotto.test/_next/static/chunks/initial.js',startTime:550,duration:350,responseEnd:900,transferSize:1024},
    {name:'https://lotto.test/_next/static/chunks/optional.js',startTime:89000,duration:500,responseEnd:89500,transferSize:2048},
  ],
}});
const requests=[];
globalThis.fetch=async(url)=>{requests.push(String(url));throw Error('Synthetic offline; no HTTP allowed')};
navigator.clipboard={writeText:async text=>{copied=text}};
const {createRoot}=await import('react-dom/client');
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const click=async element=>{assert(element,'expected control exists');await act(async()=>{element.click();await pause()})};
const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text);
const disclose=async(selector,open=true)=>{
  const detail=document.querySelector(selector);assert(detail,selector);
  await act(async()=>{detail.open=open;detail.dispatchEvent(new dom.window.Event('toggle'));await pause()});
  assert.equal(detail.open,open);
};
const absent=()=>{
  for(const selector of ['.criteria','.mixed-summary','.filter-details','.group-list','.frequency-row','.hot-list','.pattern-list','.startup-timing','.method>p','.deferred-panel'])assert.equal(document.querySelector(selector),null,`${selector} must not mount initially`);
};
const assertStats=windowSize=>{
  const counts=frequencies(snapshot.draws,windowSize);
  const ranked=Array.from({length:45},(_,index)=>({number:index+1,count:counts[index+1]})).sort((a,b)=>b.count-a.count||a.number-b.number);
  assert.deepEqual([...document.querySelectorAll('.frequency-row')].map(row=>({number:Number(row.querySelector('.ball').getAttribute('aria-label')),count:Number(row.querySelector('strong').textContent.replace('회',''))})),ranked,`all 45 frequencies and tie-break order for ${windowSize}`);
  assert.deepEqual([...document.querySelectorAll('.hot-list .ball')].map(ball=>Number(ball.getAttribute('aria-label'))),ranked.slice(0,6).map(row=>row.number));
  assert.equal(document.querySelectorAll('.stats-fold').length,2);
  assert([...document.querySelectorAll('.stats-fold')].every(detail=>!detail.open));
};
const STORE='lotto-notes:saved:v1';

try{
  await act(async()=>root.render(<Home/>));
  absent();
  assert.equal(document.querySelector('.recommend-settings').open,false);
  assert.equal(document.querySelector('.query').disabled,false);
  const initialRequests=requests.length;

  await disclose('.recommend-settings');
  assert.deepEqual([...document.querySelectorAll('.criteria>span')].map(element=>element.textContent.trim()),[
    '상·하위 혼합 우대','번호 빈도·반복 묶음 우대','연속 최대 2개','합계 80–200','홀수 1–5개','직전 번호 최대 2개','역대 6개 일치 제외','번호 최대 4회 · 쌍 최대 2회',
  ]);
  assert.equal(document.querySelector('.filter-summary').textContent,'10조합 전체 기준 · 번호 최대 4회, 같은 쌍 최대 2회');
  assert(document.querySelector('.recommend-settings>.range').textContent.startsWith('1196–1245회'));
  const groups=recent50Groups(snapshot.draws);
  assert.deepEqual([...document.querySelectorAll('.group-list p span')].map(element=>element.textContent),['upper','middle','lower'].map(group=>[...groups[group]].sort((a,b)=>a-b).join(' · ')));
  const filterText=document.querySelector('.recommend-settings').textContent;
  for(const text of ['필수가 아니야','최근에 나온 2개 연속번호도 허용','최대 ×1.728','당첨 확률이나 최종 10세트 포함 확률을 뜻하지 않아'])assert(filterText.includes(text),text);
  await disclose('.filter-details');
  assert(document.querySelector('.criteria'),'nested toggle must not close the outer panel');
  await disclose('.recommend-settings',false);
  assert.equal(document.querySelector('.criteria'),null);
  await disclose('.recommend-settings');
  assert.equal(document.querySelector('.recommend-settings').textContent,filterText,'reopening preserves filter content');
  await click(button('최근 20회'));
  assert(document.querySelector('.recommend-settings>.range').textContent.startsWith('1226–1245회'));
  assert(document.querySelector('.filter-details').textContent.includes('1196–1245회'),'frequency groups still use their fixed recent-50 window');

  await click(document.querySelector('.query'));
  assert.equal(document.querySelectorAll('.ticket').length,10);
  const tickets=[...document.querySelectorAll('.ticket .balls')].map(element=>element.textContent);
  await click(document.querySelector('.save'));
  const saved=localStorage.getItem(STORE);
  assert.equal(JSON.parse(saved).length,1);
  await click(button('통계'));
  assert.equal(document.querySelector('.recommend-settings'),null);
  assertStats(20);
  await click(button('최근 100회'));
  assertStats(100);
  await click([...document.querySelectorAll('.tabs button')].find(element=>element.textContent.includes('보관함')));
  assert.equal(document.querySelector('.frequency-row'),null);
  assert.equal(document.querySelectorAll('.ticket').length,1);
  await click(button('통계'));
  assertStats(100);
  await click(button('조회'));
  assert.equal(document.querySelector('.recommend-settings').open,false);
  assert.equal(document.querySelector('.criteria'),null,'returning to query does not mount a closed filter');
  assert.deepEqual([...document.querySelectorAll('.ticket .balls')].map(element=>element.textContent),tickets);
  assert.equal(localStorage.getItem(STORE),saved);
  await disclose('.recommend-settings');
  assert(document.querySelector('.recommend-settings>.range').textContent.startsWith('1146–1245회'));
  await disclose('.recommend-settings',false);

  clock=90000;
  await disclose('.method:not(.install-help)');
  const method=document.querySelector('.method:not(.install-help)');
  for(const text of ['1회부터 1245회까지 본번호 6개','번호 순서는 무관하고 보너스는 제외','합계 80과 200은 포함','각 번호 최대 4번·각 번호쌍 최대 2번','이 가중치는 당첨 확률을 높이지 않아','최신 회차가 누락된 상태에서는 새 번호 생성을 중단','연결 실패 · 마지막 검증본 사용'])assert(method.textContent.includes(text),text);
  assert.equal(method.querySelector('a').href,'https://www.dhlottery.co.kr/');
  await click(method.querySelector('.startup-timing button'));
  assert(copied.startsWith(`로또 6/45 시작 진단 · ${document.querySelector('main').dataset.appVersion}\n`));
  assert(copied.includes('페이지 초기화: 1.00초'));
  assert(copied.includes('추천 화면 조작 준비: 1.00초'));
  assert(copied.includes('초기 JS 최종 수신: 0.90초'));
  assert(!copied.includes('90.00초')&&!copied.includes('optional.js'));
  const diagnostic=copied;
  const methodParagraphs=[...method.querySelectorAll(':scope>p')].map(element=>element.textContent);
  await disclose('.method:not(.install-help)',false);
  assert.equal(document.querySelector('.startup-timing'),null);
  clock=140000;
  await disclose('.method:not(.install-help)');
  assert.deepEqual([...method.querySelectorAll(':scope>p')].map(element=>element.textContent),methodParagraphs);
  await click(method.querySelector('.startup-timing button'));
  assert.equal(copied,diagnostic,'diagnostic marks survive method close/reopen');
  await disclose('.method:not(.install-help)',false);

  await disclose('.install-help');
  const installText=document.querySelector('.install-help').textContent;
  for(const text of ['iPhone은 Safari의 공유 메뉴','Android는 브라우저 메뉴','보관 번호와 미보관 추천·분석 기간·탭을 유지','보관함은 현재 브라우저에만 저장','공식 기록 확인에는 인터넷 연결이 필요'])assert(installText.includes(text),text);
  await disclose('.install-help',false);
  assert.equal(document.querySelector('.install-help>p'),null);
  await disclose('.install-help');
  assert.equal(document.querySelector('.install-help').textContent,installText);
  assert.equal(requests.filter(url=>url!=='/api/recommendations').length,initialRequests,'opening optional panels does not issue application fetches; generation separately records its batch');
  assert.equal(localStorage.getItem(STORE),saved);
  await act(async()=>root.render(null));
  console.log('Optional panels content PASS: absent at startup, unchanged filter/help, nested disclosures, all 45 stats rows, periods, tab return, results/storage, and captured startup marks.');

  // A test-only esbuild alias controls the dynamic import promise. Exporting
  // `then` makes the ESM namespace a thenable, so failures/pending/retries can
  // be simulated while exercising the unmodified DeferredPanels loader.
  const fixture={requests:[]};
  globalThis.__LOTTO_OPTIONAL_IMPORT_FIXTURE__=fixture;
  const repo=process.cwd();
  const require=createRequire(path.join(repo,'package.json'));
  const compiled=await build({
    absWorkingDir:repo,entryPoints:['app/page.tsx'],bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',tsconfig:'tsconfig.json',
    plugins:[{name:'optional-panel-import-fixture',setup(builder){
      builder.onResolve({filter:/^react(?:-dom)?(?:\/|$)/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));
      builder.onResolve({filter:/^\.\/OptionalPanels$/},()=>({path:'controlled-panels',namespace:'optional-fixture'}));
      builder.onLoad({filter:/.*/,namespace:'optional-fixture'},()=>({loader:'js',resolveDir:repo,contents:`
        import Panel from ${JSON.stringify(path.join(repo,'components/OptionalPanels.tsx'))};
        export function then(resolve,reject){
          globalThis.__LOTTO_OPTIONAL_IMPORT_FIXTURE__.requests.push({
            succeed:()=>resolve({default:Panel}),fail:()=>reject(new Error('Synthetic chunk failure'))
          });
        }
      `}));
    }}],
  });
  const ControlledHome=(await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))).default;
  localStorage.clear();sessionStorage.clear();clock=1000;
  await act(async()=>root.render(<ControlledHome/>));
  absent();
  assert.equal(fixture.requests.length,0,'a closed page must not request the optional module');
  await disclose('.recommend-settings');
  assert.equal(fixture.requests.length,1);
  assert(document.querySelector('.deferred-panel').textContent.includes('불러오는 중'));
  await click(document.querySelector('.query'));
  assert.equal(document.querySelectorAll('.ticket').length,10,'pending optional content does not block recommendations');
  const pendingTickets=[...document.querySelectorAll('.ticket .balls')].map(element=>element.textContent);
  await click(document.querySelector('.save'));
  const pendingSaved=localStorage.getItem(STORE);
  await disclose('.recommend-settings',false);
  await act(async()=>{fixture.requests[0].fail();await pause()});
  assert.equal(document.querySelector('.deferred-panel'),null,'late failure after dismiss must not remount the panel');
  assert.equal(document.querySelector('.criteria'),null);
  assert.equal(localStorage.getItem(STORE),pendingSaved);

  await disclose('.recommend-settings');
  assert.equal(fixture.requests.length,2,'reopening retries a previously dismissed failed import');
  await act(async()=>{fixture.requests[1].fail();await pause()});
  assert(document.querySelector('.deferred-panel').textContent.includes('내용을 불러오지 못했어'));
  assert(button('다시 불러오기'));
  await disclose('.recommend-settings',false);
  assert.equal(document.querySelector('.deferred-panel'),null,'a displayed error can be dismissed');
  await disclose('.recommend-settings');
  assert.equal(fixture.requests.length,3,'reopening a dismissed error starts a fresh attempt');
  await act(async()=>{fixture.requests[2].fail();await pause()});
  await click(button('다시 불러오기'));
  assert.equal(fixture.requests.length,4,'retry starts another import attempt');
  assert(document.querySelector('.deferred-panel').textContent.includes('불러오는 중'));
  await disclose('.recommend-settings',false);
  await click(button('통계'));
  assert.equal(fixture.requests.length,4,'a newly opened panel shares the pending module request');
  assert(document.querySelector('.deferred-panel'));
  await click(button('최근 20회'));
  assert.equal(fixture.requests.length,4,'period changes share the pending module request');
  await click(button('조회'));
  await act(async()=>{fixture.requests[3].succeed();await pause()});
  assert.equal(document.querySelector('.deferred-panel'),null,'late success cannot remount a dismissed panel');
  assert.equal(document.querySelector('.frequency-row'),null,'late stats load cannot change the selected tab');
  assert.equal(document.querySelector('.criteria'),null);
  assert.deepEqual([...document.querySelectorAll('.ticket .balls')].map(element=>element.textContent),pendingTickets);
  assert.equal(localStorage.getItem(STORE),pendingSaved);
  await disclose('.recommend-settings');
  assert(document.querySelector('.criteria'),'successful retry is reusable after reopening');
  assert.equal(fixture.requests.length,4,'cached module is reused');
  await click(button('통계'));
  assertStats(20);
  assert.equal(fixture.requests.length,4);
  assert.equal(localStorage.getItem(STORE),pendingSaved);
  console.log('Optional loader PASS: no initial import, pending generation/save, rejected load, dismiss before failure, retry, shared pending request, dismiss before success, cached reopen, and storage/results preserved.');
}finally{
  await act(async()=>root.unmount());
  globalThis.Date=RealDate;
  Object.defineProperty(globalThis,'performance',{configurable:true,value:realPerformance});
  delete globalThis.__LOTTO_OPTIONAL_IMPORT_FIXTURE__;
  dom.window.close();
}
