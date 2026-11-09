import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('..',import.meta.url));
const snapshot=JSON.parse(readFileSync(new URL('../lib/data/history.json',import.meta.url),'utf8'));
const requestTime=Date.parse(snapshot.metadata.retrievedAt)+1000;
// Compile in memory so the real route and its dependencies are exercised without
// writing build output, changing source, or making any external requests.
const compiled=(await build({absWorkingDir:root,entryPoints:['app/api/history/route.ts'],bundle:true,write:false,format:'esm',platform:'node',tsconfig:'tsconfig.json'})).outputFiles[0].text;
let instance=0;
async function loadOutsideRequest(){
  const realNow=Date.now;
  Date.now=()=>0;
  try{return await import('data:text/javascript;base64,'+Buffer.from(compiled+`\n// isolated route ${++instance}`).toString('base64'))}
  finally{Date.now=realNow}
}
function official(draws=snapshot.draws){
  return{data:{list:draws.map(d=>({ltEpsd:d.round,ltRflYmd:d.date.replaceAll('-',''),bnsWnNo:d.bonus,...Object.fromEntries(d.numbers.map((n,i)=>[`tm${i+1}WnNo`,n]))}))}};
}
function syntheticNextDraw(){
  const latest=snapshot.draws.at(-1);
  return{round:latest.round+1,date:new Date(Date.parse(latest.date+'T00:00:00Z')+7*86400000).toISOString().slice(0,10),numbers:[1,8,15,22,29,36],bonus:43};
}

test('zero-clock module import succeeds; first request validates and preserves offline snapshot',async t=>{
  t.mock.method(Date,'now',()=>requestTime);
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('synthetic offline')});
  const route=await loadOutsideRequest();
  assert.equal(calls,0,'module initialization must not fetch');
  const response=await route.GET(),data=await response.json();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(data.status,'saved');
  assert.equal(data.checkedAt,snapshot.metadata.retrievedAt);
  assert.deepEqual(data.draws,snapshot.draws);
  assert.equal(calls,1);
});

test('snapshot future-date validation still runs in the request context',async t=>{
  t.mock.method(Date,'now',()=>0);
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not fetch')});
  const route=await loadOutsideRequest();
  await assert.rejects(route.GET(),/회차 누락 또는 잘못된 번호/);
  assert.equal(calls,0);
});

test('valid official history returns live and keeps the fifteen-minute upstream cache',async t=>{
  t.mock.method(Date,'now',()=>requestTime);
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(official())});
  const route=await loadOutsideRequest();
  const first=await(await route.GET()).json(),second=await(await route.GET()).json();
  assert.equal(first.status,'live');
  assert.deepEqual(first.draws,snapshot.draws);
  assert.deepEqual(second,first);
  assert.equal(calls,1);
});

test('future upstream draw fails closed and returns the previously validated snapshot',async t=>{
  t.mock.method(Date,'now',()=>requestTime);
  t.mock.method(globalThis,'fetch',async()=>Response.json(official([...snapshot.draws,syntheticNextDraw()])));
  const route=await loadOutsideRequest(),data=await(await route.GET()).json();
  assert.equal(data.status,'saved');
  assert.deepEqual(data.draws,snapshot.draws);
  assert.equal(data.checkedAt,snapshot.metadata.retrievedAt);
});

test('regression and historical correction each preserve the validated fallback',async t=>{
  t.mock.method(Date,'now',()=>requestTime);
  const correction=structuredClone(snapshot.draws);
  correction[0].numbers=[1,23,29,33,37,40];
  for(const draws of [snapshot.draws.slice(0,-1),correction]){
    t.mock.method(globalThis,'fetch',async()=>Response.json(official(draws)));
    const route=await loadOutsideRequest(),data=await(await route.GET()).json();
    assert.equal(data.status,'saved');
    assert.deepEqual(data.draws,snapshot.draws);
    assert.equal(data.checkedAt,snapshot.metadata.retrievedAt);
  }
});

test('later refresh failure retains a newer last-good draw and its checked timestamp',async t=>{
  const next=syntheticNextDraw(),draws=[...snapshot.draws,next];
  let now=Date.parse(next.date+'T12:00:00Z'),fail=false,calls=0;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async()=>{calls++;if(fail)throw Error('synthetic timeout');return Response.json(official(draws))});
  const route=await loadOutsideRequest(),first=await(await route.GET()).json();
  assert.equal(first.status,'live');
  assert.deepEqual(first.draws,draws);
  now+=15*60*1000+1;fail=true;
  const fallback=await(await route.GET()).json();
  assert.equal(fallback.status,'saved');
  assert.deepEqual(fallback.draws,draws);
  assert.equal(fallback.checkedAt,first.checkedAt);
  assert.equal(calls,2);
});

test('concurrent requests share one refresh after request-context initialization',async t=>{
  t.mock.method(Date,'now',()=>requestTime);
  let release,calls=0;
  t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(resolve=>{release=resolve})});
  const route=await loadOutsideRequest(),first=route.GET(),second=route.GET();
  assert.equal(calls,1);
  release(Response.json(official()));
  const payloads=await Promise.all([first,second].map(async promise=>(await promise).json()));
  assert.equal(payloads[0].status,'live');
  assert.deepEqual(payloads[1],payloads[0]);
});

test('historical correction is distinguished and remains blocked until a verified refresh',async t=>{
 let now=requestTime,mode='conflict';t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{if(mode==='offline')throw Error('offline');const data=official();if(mode==='conflict')data.data.list[0].bnsWnNo=1;return Response.json(data)});
 const route=await loadOutsideRequest();let data=await(await route.GET()).json();assert.equal(data.verification,'conflict');assert.deepEqual(data.draws,snapshot.draws);now+=15*60*1000+1;mode='offline';data=await(await route.GET()).json();assert.equal(data.verification,'conflict');now+=15*60*1000+1;mode='live';data=await(await route.GET()).json();assert.equal(data.verification,'live');
});
