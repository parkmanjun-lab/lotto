// Synthetic DOM/API checks only; never read, enter, or save a real password.
const {JSDOM}=await import(process.env.LOTTO_TEST_JSDOM||'jsdom');
import React,{act} from 'react';
import assert from 'node:assert/strict';
import Admin from '../app/admin/page.tsx';
const dom=new JSDOM('<div id="root"></div>',{url:'https://lotto.test/admin'});
for(const key of ['window','document','navigator','HTMLElement','FormData','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let visibility='visible';Object.defineProperty(document,'visibilityState',{get:()=>visibility});
const {createRoot}=await import('react-dom/client');
let root,state,csrf,holdState,stateReplies,actionReplies,requests,stateReads;
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
globalThis.fetch=(url,options={})=>{
 const path=String(url);requests.push({path,options});
 if(path==='/api/admin/state'){
  const value={state,csrf:'synthetic-csrf-'+(++csrf)};stateReads++;
  return holdState?new Promise(resolve=>stateReplies.push(()=>resolve(reply(value)))):Promise.resolve(reply(value));
 }
 if(path==='/api/admin/login')return new Promise((resolve,reject)=>actionReplies.push({resolve:code=>{if(code===200)state='ready';resolve(new Response('{}',{status:code}))},reject}));
 if(path.startsWith('/api/admin/visits'))return Promise.resolve(reply({visits:[],nextCursor:null}));
 if(path.startsWith('/api/admin/recommendations'))return Promise.resolve(new Response('{}',{status:503}));
 throw Error('Unexpected synthetic API '+path);
};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
async function mount(next='locked'){
 state=next;csrf=0;stateReads=0;holdState=false;stateReplies=[];actionReplies=[];requests=[];visibility='visible';
 root=createRoot(document.getElementById('root'));await act(async()=>{root.render(<Admin/>);await flush()});
}
async function unmount(){await act(async()=>root.unmount());document.getElementById('root').innerHTML=''}
async function event(target,name){await act(async()=>{target.dispatchEvent(new dom.window.Event(name,{bubbles:true,cancelable:true}));await flush()})}
async function finish(code){await act(async()=>{actionReplies.shift().resolve(code);await flush()})}
const login=()=>document.querySelector('#admin-login');
const password=()=>document.querySelector('#admin-login-password');
const posts=()=>requests.filter(r=>r.path==='/api/admin/login');
await mount();
let form=login(),input=password();
assert.equal(form.method,'post');assert.equal(form.getAttribute('action'),'/api/admin/login');assert.equal(form.getAttribute('autocomplete'),'on');
const username=form.querySelector('[name=username]');assert.equal(username.autocomplete,'username');assert.equal(username.value,'admin');assert(!username.readOnly);assert.equal(username.type,'text');
assert.equal(input.autocomplete,'current-password');assert.equal(input.name,'password');assert.equal(input.type,'password');assert.equal(input.labels.length,1);assert.equal(form.querySelector('button').type,'submit');
assert(document.body.textContent.includes('저장 안내가 안 뜨면'));assert(document.body.textContent.includes('암호 앱'));
// AutoFill may set the DOM value without React's change handler.
input.value='synthetic-autofilled-password';
visibility='hidden';await event(document,'visibilitychange');assert.equal(login(),form);assert.equal(password(),input);assert.equal(stateReads,1);
visibility='visible';holdState=true;await event(document,'visibilitychange');assert.equal(login(),form);assert.equal(input.value,'synthetic-autofilled-password');assert(form.querySelector('button').disabled);
await act(async()=>{stateReplies.shift()();await flush()});holdState=false;assert.equal(login(),form);assert.equal(input.value,'synthetic-autofilled-password');assert(!form.querySelector('button').disabled);
await event(window,'pageshow');assert.equal(login(),form);assert.equal(input.value,'synthetic-autofilled-password');
let resets=0;form.reset=()=>{resets++};
await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush()});
assert.equal(posts().length,1,'synchronous duplicate submit is blocked');assert.equal(login(),form,'retain filled form until server response');
assert.deepEqual(JSON.parse(posts()[0].options.body),{csrf:'synthetic-csrf-3',username:'admin',password:'synthetic-autofilled-password'});assert.equal(posts()[0].options.method,'POST');assert.equal(posts()[0].options.cache,'no-store');
const beforeReads=stateReads;visibility='hidden';await event(document,'visibilitychange');visibility='visible';await event(document,'visibilitychange');await event(window,'pageshow');assert.equal(stateReads,beforeReads,'overlay must not invalidate an in-flight login');assert.equal(login(),form);
await finish(401);assert.equal(login(),form,'failed login retains same form and input');assert.equal(input.value,'synthetic-autofilled-password');assert.equal(resets,0);assert(!form.querySelector('button').disabled);
input.value='synthetic-retry-password';await event(form,'submit');assert.equal(posts().length,2);assert.deepEqual(JSON.parse(posts()[1].options.body),{csrf:'synthetic-csrf-4',username:'admin',password:'synthetic-retry-password'});
await finish(200);assert.equal(login(),null);assert.equal(resets,0,'successful form is removed without erasing its submitted value first');assert.equal(input.value,'synthetic-retry-password');
assert(requests.every(r=>!r.path.includes('synthetic-')&&!r.path.includes('password=')));assert.equal(localStorage.length,0);assert.equal(sessionStorage.length,0);assert.equal(document.cookie,'');
await unmount();
// A successful login while the page is hidden cannot load or render private records.
await mount();form=login();password().value='synthetic-hidden-success';await event(form,'submit');visibility='hidden';await event(document,'visibilitychange');await finish(200);assert.equal(login(),null);assert.equal(document.querySelector('.admin-records'),null);assert(!requests.some(r=>r.path.startsWith('/api/admin/visits')||r.path.startsWith('/api/admin/recommendations')));visibility='visible';await event(document,'visibilitychange');assert(requests.some(r=>r.path.startsWith('/api/admin/visits')));await unmount();
// An unavailable service during an overlay closes the login form.
await mount();password().value='synthetic-not-a-real-password';state='unavailable';await event(window,'pageshow');assert.equal(login(),null);assert.equal(document.querySelector('input[type=password]'),null);await unmount();
// Network failure also keeps retry possible, with fresh CSRF.
await mount();form=login();password().value='synthetic-network-password';await event(form,'submit');await act(async()=>{actionReplies.shift().reject(Error('synthetic offline'));await flush()});assert.equal(login(),form);assert(!form.querySelector('button').disabled);assert.equal(password().value,'synthetic-network-password');await unmount();
// A response arriving after unmount cannot restore a form or private content.
await mount();form=login();password().value='synthetic-stale-password';await event(form,'submit');const pending=actionReplies.shift();await unmount();await act(async()=>{pending.resolve(200);await flush()});assert.equal(document.body.textContent,'');
// Setup and password-change fields expose separate current/new-password scopes.
await mount('setup');assert.equal(document.querySelector('form'),null,'unknown/legacy setup state cannot expose registration');await unmount();
await mount('ready');form=document.querySelector('#admin-password-change');assert.equal(form.method,'post');assert.equal(form.querySelector('[name=currentPassword]').autocomplete,'current-password');assert.equal(form.querySelectorAll('[autocomplete=new-password]').length,2);assert.equal(form.querySelector('[name=username]').value,'admin');await unmount();
console.log('Admin AutoFill UI PASS: stable semantic POST forms, DOM autofill, overlay/CSRF refresh, pending and failed login lifecycle, duplicate submission, stale response, no credential storage/GET leakage. Native iPhone save prompts are not exercised by DOM tests.');
