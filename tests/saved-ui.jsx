// Synthetic localStorage only. Run: node --import tsx tests/saved-ui.jsx
const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import Home from '../app/page.tsx';

const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
for(const prop of ['window','document','navigator','localStorage','HTMLElement'])Object.defineProperty(globalThis,prop,{value:dom.window[prop],configurable:true});
dom.window.scrollTo=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.fetch=async()=>{throw Error('offline synthetic test')};
// JSDOM has no top-layer implementation. Browser focus trapping is provided by
// native <dialog>; this shim tests the app's open/close and cancel wiring only.
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');this.querySelector('[autofocus]')?.focus()};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
const {createRoot}=await import('react-dom/client');
const STORE='lotto-notes:saved:v1';
const fixtures=[
 {numbers:[1,2,3,4,5,6],window:50,round:1244,at:'2026-10-09T01:00:00.000Z',anchor:[1,2],anchorCount:3,anchorPeriods:{20:2,50:3,100:4},method:'multi-period-diverse-v3',note:'synthetic provenance retained'},
 {numbers:[7,8,9,10,11,12],window:10,round:1234,at:'2026-08-01T02:00:00.000Z',anchor:[8,9],anchorCount:2},
 {numbers:[13,14,15,16,17,18],window:20,round:1243,at:'2026-10-01T03:00:00.000Z',anchor:[13,14],anchorCount:2,method:'mixed-recent50-v4',frequencyGroups:{upper:[13],middle:[14,15],lower:[16,17,18]},filterRound:1243},
 {numbers:[19,20,21,22,23,24],window:100,round:1244,at:'2026-10-09T04:00:00.000Z',anchor:[20,21],anchorCount:4,anchorPeriods:{20:1,50:2,100:4},method:'soft-preferences-v6',preferenceWeight:1.35,mixedMultiplier:1.2,numberMultiplier:1.1,groupMultiplier:1.02},
];
const extra={numbers:[25,26,27,28,29,30],window:50,round:1244,at:'2026-10-09T05:00:00.000Z',note:'synthetic new item from another tab'};
let root;
const click=async element=>{assert(element,'expected an interactive element');await act(async()=>element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})))};
const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(element=>element.textContent===label);
const nav=label=>[...document.querySelectorAll('.tabs button')].find(element=>element.textContent.includes(label));
const boxes=()=>[...document.querySelectorAll('.ticket input[type="checkbox"]')];
const allBox=()=>document.querySelector('.saved-selection input');
const selectedAction=()=>document.querySelector('.saved-actions button');
const clearAction=()=>button('전체 보관 해제',document.querySelector('.saved-actions'));
const dialog=()=>document.querySelector('dialog');
const stored=()=>JSON.parse(localStorage.getItem(STORE));
const count=()=>document.querySelectorAll('.ticket').length;
const assertSelected=n=>{assert.equal(boxes().filter(input=>input.checked).length,n);assert.equal(document.querySelector('.saved-selection>span').textContent,`${n}개 선택`);assert.equal(selectedAction().disabled,n===0)};
async function mount(items){if(root)await act(async()=>root.unmount());if(items!==undefined)localStorage.setItem(STORE,JSON.stringify(items));root=createRoot(document.getElementById('root'));await act(async()=>root.render(<Home/>));await click(nav('보관함'))}
async function storageUpdate(items){localStorage.setItem(STORE,JSON.stringify(items));await act(async()=>window.dispatchEvent(new dom.window.StorageEvent('storage',{key:STORE,storageArea:localStorage,newValue:JSON.stringify(items)})))}

await mount(fixtures);
assert.equal(count(),4);assertSelected(0);assert.deepEqual(stored(),fixtures);
assert(document.querySelectorAll('.saved-date')[1].textContent.includes('최근 10회 기준'));
assert(!dialog());
await click(selectedAction());assert(!dialog(),'disabled action cannot open confirmation');
await click(boxes()[0]);await click(boxes()[2]);assertSelected(2);assert(allBox().indeterminate);assert.equal(document.querySelectorAll('.ticket-selected').length,2);
await click(boxes()[0]);assertSelected(1);
await click(button('선택 취소'));assertSelected(0);assert(!allBox().indeterminate);assert.deepEqual(stored(),fixtures);
await click(allBox());assertSelected(4);assert(allBox().checked);assert(!allBox().indeterminate);
await click(allBox());assertSelected(0);assert.deepEqual(stored(),fixtures);

await click(boxes()[0]);await click(boxes()[2]);await click(selectedAction());
assert(dialog().open);assert.equal(dialog().getAttribute('aria-labelledby'),'remove-title');assert.equal(dialog().getAttribute('aria-describedby'),'remove-description');
assert(dialog().textContent.includes('선택한 조합 2개'));assert.deepEqual(stored(),fixtures);
await click(button('취소',dialog()));assert(!dialog());assertSelected(2);assert.deepEqual(stored(),fixtures);
await click(selectedAction());await act(async()=>dialog().dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
assert(!dialog());assertSelected(2);assert.deepEqual(stored(),fixtures);
await click(selectedAction());await click(button('선택 보관 해제',dialog()));
assert(!dialog());assert.equal(count(),2);assert.deepEqual(stored(),[fixtures[1],fixtures[3]]);assertSelected(0);
assert.equal(document.activeElement,document.querySelector('.results h2'),'successful removal focuses the list heading');
await mount();assert.equal(count(),2);assert.deepEqual(stored(),[fixtures[1],fixtures[3]]);assertSelected(0);

await click(boxes()[0]);await click(document.querySelector('.save'));assert.equal(count(),1);assertSelected(0);assert.deepEqual(stored(),[fixtures[3]]);
await click(clearAction());assert(dialog().textContent.includes('보관한 조합 1개'));await click(button('취소',dialog()));assert.equal(count(),1);assert.deepEqual(stored(),[fixtures[3]]);
await click(clearAction());const confirmAll=button('전체 보관 해제',dialog());
await act(async()=>{confirmAll.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));confirmAll.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))});
assert.equal(count(),0);assert(!dialog());assert(!document.querySelector('.saved-tools'));assert.deepEqual(stored(),[]);
assert(document.querySelector('.empty').textContent.includes('아직 보관한 조합이 없어'));
assert(document.querySelector('.toast').textContent.includes('1개 조합'));
await mount();assert.equal(count(),0);assert(!document.querySelector('.saved-tools'));

await mount(fixtures);await click(boxes()[1]);await click(nav('통계'));assert(!document.querySelector('.saved-tools'));await click(nav('보관함'));assertSelected(0);assert.deepEqual(stored(),fixtures);
await click(boxes()[2]);await click(selectedAction());await click(nav('조회'));assert(!dialog());await click(nav('보관함'));assertSelected(0);assert.deepEqual(stored(),fixtures);
await click(boxes()[3]);await click(selectedAction());await click(button('취소',dialog()));await click(selectedAction());await click(button('선택 보관 해제',dialog()));assert.deepEqual(stored(),fixtures.slice(0,3));

await mount(fixtures);await click(boxes()[1]);await click(selectedAction());
const setItem=dom.window.Storage.prototype.setItem;
dom.window.Storage.prototype.setItem=function(){throw Error('synthetic quota failure')};
await click(button('선택 보관 해제',dialog()));
assert(!dialog());assert.equal(count(),4);assertSelected(1);assert.deepEqual(stored(),fixtures);assert(document.querySelector('.toast').textContent.includes('변경하지 못했어'));
dom.window.Storage.prototype.setItem=setItem;
await click(selectedAction());await click(button('선택 보관 해제',dialog()));assert.deepEqual(stored(),[fixtures[0],fixtures[2],fixtures[3]]);

await mount(fixtures);await click(clearAction());dom.window.Storage.prototype.setItem=function(){throw Error('synthetic quota failure')};
await click(button('전체 보관 해제',dialog()));assert.equal(count(),4);assert.deepEqual(stored(),fixtures);
dom.window.Storage.prototype.setItem=setItem;
await click(clearAction());await click(button('전체 보관 해제',dialog()));assert.equal(count(),0);assert.deepEqual(stored(),[]);

await mount(fixtures);await click(boxes()[0]);await click(selectedAction());await storageUpdate([...fixtures,extra]);
assert(!dialog());assert.equal(count(),5);assertSelected(0);assert.deepEqual(stored(),[...fixtures,extra]);
assert(document.querySelector('.toast').textContent.includes('다른 탭'));
await click(clearAction());await storageUpdate([]);assert(!dialog());assert.equal(count(),0);assert(!document.querySelector('.saved-tools'));

// If another tab adds an item before its storage event arrives, only the
// records explicitly included in the confirmation are removed.
await mount(fixtures);await click(clearAction());localStorage.setItem(STORE,JSON.stringify([...fixtures,extra]));await click(button('전체 보관 해제',dialog()));
assert.equal(count(),1);assert.deepEqual(stored(),[extra]);assertSelected(0);
await mount(fixtures);await click(boxes()[0]);await click(selectedAction());localStorage.setItem(STORE,JSON.stringify([...fixtures,extra]));await click(button('선택 보관 해제',dialog()));
assert.deepEqual(stored(),[...fixtures.slice(1),extra]);

// Individual removal also reads the current records, avoiding loss of a new
// item if its cross-tab notification has not yet reached this document.
await mount(fixtures);localStorage.setItem(STORE,JSON.stringify([...fixtures,extra]));await click(document.querySelector('.save'));assert.deepEqual(stored(),[...fixtures.slice(1),extra]);
await mount(fixtures);localStorage.setItem(STORE,JSON.stringify(fixtures.slice(1)));await click(document.querySelector('.save'));assert.deepEqual(stored(),fixtures.slice(1),'individual removal must not re-add a record removed by another tab');
await act(async()=>root.unmount());
console.log('Saved UI PASS: selection/deselection, select all, selected removal preserves all remaining metadata, clear all cancel/confirm, Escape, repeated confirms, tab interruption, legacy records, persistence/reload, empty state, storage failures and cross-tab safety. Native dialog focus trapping and visual mobile layout still require a browser check.');
