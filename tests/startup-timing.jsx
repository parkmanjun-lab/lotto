const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import Timing from '../components/StartupTiming';

const dom=new JSDOM('<div id="root"></div>',{url:'https://lotto-notes.parkmanjun.chatgpt.site'});
for(const prop of ['window','document','navigator','HTMLElement'])Object.defineProperty(globalThis,prop,{value:dom.window[prop],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const realPerformance=globalThis.performance;
let now=4380;
const resources=[
  {name:'https://lotto-notes.parkmanjun.chatgpt.site/_next/static/chunks/index-test.js?secret=not-copied',startTime:2200,duration:1200,responseEnd:3400,transferSize:1234},
  {name:'https://lotto-notes.parkmanjun.chatgpt.site/api/history',duration:300},
];
Object.defineProperty(globalThis,'performance',{configurable:true,value:{
  now:()=>now,
  getEntriesByName:()=>[{startTime:2270}],
  getEntriesByType:type=>type==='navigation'?[{responseStart:2180,responseEnd:2180,requestStart:1100,domainLookupStart:10,domainLookupEnd:20,connectStart:20,connectEnd:100,secureConnectionStart:40,type:'navigate'}]:resources,
}});
let copied='',calls=0;
globalThis.fetch=async()=>{calls++;throw Error('No network allowed')};
navigator.clipboard={writeText:async text=>{copied=text}};
const {createRoot}=await import('react-dom/client');
const root=createRoot(document.getElementById('root'));
const copy=async()=>{await act(async()=>document.querySelector('button').click());return copied};

try{
  await act(async()=>root.render(<Timing interactive appVersion="synthetic-startup-version"/>));
  assert(document.body.textContent.includes('2.18초'));
  assert(document.body.textContent.includes('2.27초'));
  assert(document.body.textContent.includes('1.08초'));
  assert(document.body.textContent.includes('4.38초'));
  await copy();
  assert(copied.startsWith('로또 6/45 시작 진단 · synthetic-startup-version\n'));
  assert(copied.includes('index-test.js'));
  assert(copied.includes('초기 JS 최종 수신: 3.40초'));
  assert(!copied.includes('secret=')&&!copied.includes('https://'));
  navigator.clipboard.writeText=async()=>{throw Error('denied')};
  await copy();
  assert(document.querySelector('textarea').readOnly);
  assert.equal(document.querySelector('textarea').value,copied);

  // A panel opened much later must report the page's marks, not its mount time.
  await act(async()=>root.render(null));
  now=90000;
  resources.push({name:'https://lotto-notes.parkmanjun.chatgpt.site/_next/static/chunks/optional-panel.js?late=1',startTime:85000,duration:1100,responseEnd:86100,transferSize:2000});
  navigator.clipboard.writeText=async text=>{copied=text};
  const capturedMarks={initialized:4380,interactive:4920,restored:true};
  await act(async()=>root.render(<Timing capturedMarks={capturedMarks} appVersion="synthetic-startup-version"/>));
  await copy();
  assert(copied.includes('페이지 초기화: 4.38초'));
  assert(copied.includes('추천 화면 조작 준비: 4.92초'));
  assert(copied.includes('초기 JS 최종 수신: 3.40초'));
  assert(copied.includes('화면 복원'));
  assert(!copied.includes('90.00초')&&!copied.includes('optional-panel.js'));
  const firstLateReport=copied;

  // Closing/reopening the disclosure cannot silently restart the clock.
  await act(async()=>root.render(null));
  now=140000;
  await act(async()=>root.render(<Timing capturedMarks={capturedMarks} appVersion="synthetic-startup-version"/>));
  await copy();
  assert.equal(copied,firstLateReport);
  await act(async()=>window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow',{persisted:false})));
  await copy();
  assert(!copied.includes('화면 복원'));
  assert(copied.includes('페이지 초기화: 4.38초'));
  assert(copied.includes('추천 화면 조작 준비: 4.92초'));
  assert.equal(calls,0);
}finally{
  await act(async()=>root.unmount());
  Object.defineProperty(globalThis,'performance',{configurable:true,value:realPerformance});
  dom.window.close();
}
console.log('Startup timing PASS: exact phases, sanitized resource names, copy/fallback, preserved initial/ready marks on late mount and reopen, late JS excluded, restoration state, no network.');
