const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import Home from '../app/page.tsx';
import snapshot from '../lib/data/prize-history.json';
import {APP_VERSION} from '../lib/app-version';
import {validResume} from '../lib/app-updates';
const dom=new JSDOM('<div id="root"></div>',{url:'https://lotto.test/'});
for(const prop of ['window','document','navigator','localStorage','sessionStorage','HTMLElement'])Object.defineProperty(globalThis,prop,{value:dom.window[prop],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.scrollTo=()=>{};
let prizeCalls=0,fail=false;
globalThis.fetch=async url=>{
 if(url==='/api/version')return Response.json({version:APP_VERSION});
 if(url==='/api/history')return Response.json({draws:snapshot.draws,checkedAt:snapshot.metadata.retrievedAt,status:'live'});
 if(url==='/api/prizes'){prizeCalls++;if(fail)throw Error('offline');return Response.json({draws:snapshot.draws,checkedAt:snapshot.metadata.retrievedAt,status:'live',verification:'live'})}
 throw Error('unrelated request disabled');
};
const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(r=>setTimeout(r,10));
const click=async element=>{assert(element);await act(async()=>{element.click();await pause()})};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
const choose=async round=>{await act(async()=>{const select=document.querySelector('.prize-navigation select');select.value=String(round);select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause()})};
const STORE='lotto-notes:saved:v1';
localStorage.setItem(STORE,JSON.stringify([{numbers:[1,2,3,4,5,6],window:50,round:1245,at:'2026-10-12'}]));
const saved=localStorage.getItem(STORE);
try{
 await act(async()=>{root.render(<Home/>);await pause()});assert.equal(prizeCalls,0,'no prize request before opening the tab');
 await click(button('당첨내역'));await act(async()=>{await pause()});
 assert.equal(prizeCalls,1);assert.equal(document.querySelector('.settings'),null);
 assert.equal(document.querySelectorAll('.prize-rank').length,5);
 assert.equal(document.querySelector('.prize-navigation select').value,'1249');
 assert.equal(document.querySelectorAll('.prize-navigation option').length,1249);
 assert.deepEqual([...document.querySelectorAll('.prize-main-balls .ball')].map(b=>Number(b.getAttribute('aria-label'))),[2,11,16,25,34,35]);
 assert(document.querySelector('.prize-rank-1').textContent.includes('2,025,045,509원'));
 assert(document.querySelector('.prize-rank-1').textContent.includes('1,389,780,492원'));
 assert(document.querySelector('.prize-rank-3').textContent.includes('비과세'));
 assert(document.querySelector('[aria-label="다음 회차"]').disabled);
 await click(document.querySelector('[aria-label="이전 회차"]'));assert.equal(document.querySelector('.prize-navigation select').value,'1248');
 await choose(1);assert(document.querySelector('[aria-label="이전 회차"]').disabled);assert(document.querySelector('.prize-rank-1').textContent.includes('당첨 없음'));assert.equal(document.querySelector('.prize-rank-1 .prize-money'),null);
 assert(document.querySelector('.prize-rank-4').textContent.includes('113,400원'));
 await click(button('최신'));assert.equal(document.querySelector('.prize-navigation select').value,'1249');
 const text=document.querySelector('.prize-notes').textContent;assert(text.includes('당첨게임 수'));assert(text.includes('현행 세율'));assert(text.includes('과거 실제 수령액'));
 fail=true;await click(button('당첨내역 새로고침'));assert(document.querySelector('[role="alert"]').textContent.includes('마지막 확인 내역'));assert.equal(document.querySelectorAll('.prize-rank').length,5);
 await click(button('조회'));assert(document.querySelector('.settings'));assert.equal(document.querySelector('.prize-results'),null);assert.equal(localStorage.getItem(STORE),saved);
 assert(validResume({results:[],windowSize:50,tab:'prizes',selected:[],scrollY:0}));
 console.log('Prize UI: lazy request, all rounds, latest/previous/first, full rank data, tax notes, offline retention, saved numbers and updater restoration passed.');
}finally{await act(async()=>root.unmount());dom.window.close()}
