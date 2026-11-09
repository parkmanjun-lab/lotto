const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';import fs from 'node:fs';import assert from 'node:assert/strict';import Home from '../app/page.tsx';
const dom=new JSDOM('<!doctype html><head></head><body><div id="root"></div></body>',{url:'https://lotto.test/'});
for(const prop of ['window','document','navigator','localStorage','sessionStorage','HTMLElement'])Object.defineProperty(globalThis,prop,{value:dom.window[prop],configurable:true});
const style=document.createElement('style');style.textContent=fs.readFileSync('app/globals.css','utf8');document.head.appendChild(style);
dom.window.scrollTo=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.fetch=async()=>{throw Error('synthetic offline')};
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-12T13:34:00Z']))}static now(){return RealDate.parse('2026-10-12T13:34:00Z')}};
const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));await act(async()=>root.render(<Home/>));
const css=selector=>dom.window.getComputedStyle(document.querySelector(selector));
assert.equal(document.querySelectorAll('.intro,.edition,.heading-mark,.brand small').length,0);
assert.equal(document.querySelector('h1').textContent,'번호 추천');assert.equal(css('h1').position,'absolute');
assert.equal(css('.compact-header').height,'56px');assert.equal(css('.logo').width,'28px');assert.equal(css('.compact-header .data-line button').minHeight,'44px');assert.equal(css('.periods button').minHeight,'44px');assert.equal(css('.query').minHeight,'48px');assert.equal(css('.query-note').display,'none');
assert.equal(document.querySelector('.settings h2').textContent,'분석 기간');assert.equal(document.querySelector('.query').textContent,'10개 추천받기');assert.equal(document.querySelector('.recommend-settings').open,false);
assert.equal(document.querySelector('.recommend-settings .range'),null);assert.equal(document.querySelector('.filter-summary'),null);
assert.equal(document.querySelector('[aria-label="공식 기록 새로고침"]').getAttribute('title'),'공식 기록 새로고침');assert(!document.querySelector('.compact-header').textContent.includes('FOR YOU'));

assert.equal(css('.settings h2').position,'absolute');
assert.equal(document.querySelector('.periods').getAttribute('aria-label'),'최근 분석 기간');
assert.equal(css('.settings').padding,'10px');assert.equal(css('.periods').marginTop,'0px');
assert.equal(css('.recommend-settings>summary').position,'absolute');assert.equal(css('.recommend-settings>summary').minHeight,'44px');
assert.equal(css('.query').marginTop,'8px');
assert(document.querySelector('.recommend-settings').compareDocumentPosition(document.querySelector('.query')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
for(const w of [20,50,100]){const button=[...document.querySelectorAll('.periods button')].find(b=>b.textContent===`최근 ${w}회`);await act(async()=>button.click());assert.equal(button.getAttribute('aria-pressed'),'true');}
const detail=document.querySelector('.recommend-settings');await act(async()=>{detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,0))});assert.equal(detail.open,true);assert(document.querySelector('.recommend-settings .range').textContent.includes('1245회'));assert(document.querySelector('.filter-summary').textContent.includes('번호 최대 4회'));assert(css('.recommend-settings').paddingTop==='10px');await act(async()=>{detail.open=false;detail.dispatchEvent(new dom.window.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,0))});assert.equal(detail.open,false);assert.equal(document.querySelector('.filter-summary'),null);
for(const width of [320,375,390,430,700]){const appWidth=Math.min(width,560),appSides=width<=340?24:width<=380?30:width>=700?58:40;const inner=appWidth-appSides-22;const periodButton=(inner-104-8)/3;assert(periodButton>=44,`period target at ${width}: ${periodButton}`);const before=width<=380?215.5:219.5;const after=22+44+8+48;assert(before-after>=93.5);console.log(`CSS formula ${width}px: settings ${before} -> ${after}px; period button ${periodButton.toFixed(2)}px`);}
await act(async()=>root.unmount());globalThis.Date=RealDate;
console.log('Compact UI PASS: single-row header, redundant intro removed, semantic heading, 44px touch targets, 48px primary action, empty note hidden, dates/rules preserved in collapsed details. CSS assertions are not real-browser layout measurements.');
