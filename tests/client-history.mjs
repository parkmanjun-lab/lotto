import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build,transform} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {encodeClientHistory,renderClientHistory,CLIENT_HISTORY_ALPHABET} from '../scripts/build-client-history.mjs';
import {FIRST,WEEK,validateDraws} from '../lib/lotto.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const original=JSON.parse(readFileSync(new URL('../lib/data/history.json',import.meta.url),'utf8'));
const verifiedAt=Date.parse(original.metadata.retrievedAt);
const generated=readFileSync(new URL('../lib/data/history-client.ts',import.meta.url),'utf8');
let instance=0;
async function load(source){
  const {code}=await transform(source,{loader:'ts',format:'esm',target:'es2022'});
  return(await import('data:text/javascript;base64,'+Buffer.from(code+`\n// isolated history ${++instance}`).toString('base64'))).default;
}

test('generated client snapshot is current and every full draw round-trips exactly',async()=>{
  assert.equal(CLIENT_HISTORY_ALPHABET.length,45);
  assert.equal(new Set(CLIENT_HISTORY_ALPHABET).size,45);
  assert.equal(generated,renderClientHistory(original,verifiedAt));
  const snapshot=await load(generated);
  assert.deepEqual(snapshot.draws,original.draws);
  assert.equal(snapshot.metadata.retrievedAt,original.metadata.retrievedAt);
  assert.deepEqual(validateDraws(snapshot.draws,verifiedAt),validateDraws(original.draws,verifiedAt));
  assert.equal(encodeClientHistory(original,verifiedAt).encoded.length,original.draws.length*7);
});

test('decoder imports at a zero or unavailable request clock; validation still rejects future history',async t=>{
  t.mock.method(Date,'now',()=>0);
  const zeroClock=await load(generated);
  assert.deepEqual(zeroClock.draws,original.draws);
  assert.throws(()=>validateDraws(zeroClock.draws),/회차 누락 또는 잘못된 번호/);
  t.mock.method(Date,'now',()=>{throw Error('Request clock is unavailable')});
  assert.deepEqual((await load(generated)).draws,original.draws);
  assert.deepEqual(validateDraws(zeroClock.draws,verifiedAt),original.draws);
});

test('generator refuses missing, reordered, nonweekly, invalid and future records',()=>{
  for(const mutate of [
    data=>data.draws.splice(1,1),
    data=>{[data.draws[0],data.draws[1]]=[data.draws[1],data.draws[0]]},
    data=>{data.draws[1].date='2002-12-15'},
    data=>{data.draws[1].numbers[0]=data.draws[1].numbers[1]},
    data=>{data.draws[1].bonus=data.draws[1].numbers[0]},
    data=>{data.draws[1].extra='must not silently drop canonical data'},
  ]){
    const data=structuredClone(original);mutate(data);
    assert.throws(()=>encodeClientHistory(data,verifiedAt));
  }
  assert.throws(()=>encodeClientHistory(original,0),/회차 누락 또는 잘못된 번호/);
});

test('metadata changes do not alter draws and a future valid release includes its newest round',async()=>{
  const data=structuredClone(original);
  data.metadata.retrievedAt='2026-10-13T00:00:00.000Z';
  data.metadata.sourceName='Metadata-only update';
  data.metadata.extra={retainedOnlyInCanonicalJson:true};
  const metadataOnly=await load(renderClientHistory(data,verifiedAt));
  assert.deepEqual(metadataOnly.draws,original.draws);
  assert.equal(metadataOnly.metadata.retrievedAt,data.metadata.retrievedAt);
  const index=data.draws.length,date=new Date(FIRST+index*WEEK).toISOString().slice(0,10);
  data.draws.push({round:index+1,date,numbers:[1,8,15,22,29,36],bonus:43});
  const now=Date.parse(date+'T12:00:00Z');
  data.metadata.retrievedAt=new Date(now).toISOString();
  const future=await load(renderClientHistory(data,now));
  assert.deepEqual(future.draws,data.draws);
  assert.equal(future.metadata.retrievedAt,data.metadata.retrievedAt);
  assert.deepEqual(validateDraws(future.draws,now),data.draws);
});

test('client decoder bundles without canonical history, engine code, or network imports',async()=>{
  const result=await build({absWorkingDir:root,entryPoints:['lib/data/history-client.ts'],bundle:true,write:false,format:'esm',platform:'browser',minify:true,metafile:true});
  assert.deepEqual(Object.keys(result.metafile.inputs),['lib/data/history-client.ts']);
  assert.equal(result.outputFiles.length,1);
  assert(result.outputFiles[0].contents.length<11000);
  assert(!result.outputFiles[0].text.includes('fetch('));
  assert(!result.outputFiles[0].text.includes('Date.now'));
  assert(!result.outputFiles[0].text.includes('generateDetailed'));
});
