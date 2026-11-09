const {JSDOM} = await import(process.env.LOTTO_TEST_JSDOM || 'jsdom');
import React, {act} from 'react';
import assert from 'node:assert/strict';
import Privacy from '../app/privacy/page.tsx';
import * as privacy from '../lib/visitor-privacy.ts';

// All identifiers and capabilities in this test are synthetic browser-local data.
const dom = new JSDOM('<div id="root"></div>', {url: 'https://lotto-notes.parkmanjun.chatgpt.site/privacy'});
for (const property of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'StorageEvent']) {
  Object.defineProperty(globalThis, property, {value: dom.window[property], configurable: true});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createRoot} = await import('react-dom/client');
const {prepareRecordProof, getRecordProof, listRecordProofs, forgetRecordProofs, subscribeRecordProofs, RECORD_PROOF_PREFIX} = privacy;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const key = (kind, id) => `${RECORD_PROOF_PREFIX}${kind}:${id}`;
const savedKey = 'lotto-notes:saved:v1';
localStorage.setItem(savedKey, '[{"numbers":[1,2,3,4,5,6]}]');
const savedValue = localStorage.getItem(savedKey);
assert.equal('getRecordingChoice' in privacy, false);
assert.equal('setRecordingChoice' in privacy, false);
assert.equal('subscribeRecordingChoice' in privacy, false);

let notifications = 0;
const unsubscribe = subscribeRecordProofs(() => notifications++);
const firstProof = prepareRecordProof('visit', uuid(1));
assert.match(firstProof, /^[A-Za-z0-9_-]{43}$/);
assert.equal(getRecordProof('visit', uuid(1)), firstProof);
assert.equal(prepareRecordProof('visit', uuid(1)), firstProof, 'retry keeps the capability');
assert.equal(notifications, 1);
window.dispatchEvent(new StorageEvent('storage', {key: savedKey, storageArea: localStorage}));
assert.equal(notifications, 1, 'saved-number events do not affect deletion registry');
window.dispatchEvent(new StorageEvent('storage', {key: key('visit', uuid(1)), storageArea: localStorage}));
assert.equal(notifications, 2);
unsubscribe();
assert.throws(() => prepareRecordProof('visit', 'not-a-uuid'));
localStorage.setItem(key('visit', uuid(2)), 'broken');
assert.throws(() => prepareRecordProof('visit', uuid(2)), /record_proof_unavailable/);
assert.equal(localStorage.getItem(key('visit', uuid(2))), 'broken', 'never overwrite a corrupted prior capability');
localStorage.removeItem(key('visit', uuid(2)));
localStorage.setItem(`${key('visit', uuid(1))}:extra`, firstProof);
assert.equal(listRecordProofs().length, 1, 'malformed registry key is ignored');
localStorage.removeItem(`${key('visit', uuid(1))}:extra`);

const storagePrototype = dom.window.Storage.prototype;
const originalSetItem = storagePrototype.setItem;
storagePrototype.setItem = () => { throw Error('synthetic quota'); };
assert.throws(() => prepareRecordProof('recommendation', uuid(3)), /record_proof_unavailable/);
storagePrototype.setItem = () => {};
assert.throws(() => prepareRecordProof('recommendation', uuid(3)), /record_proof_unavailable/, 'readback verification is mandatory');
storagePrototype.setItem = originalSetItem;
forgetRecordProofs(listRecordProofs());
assert.equal(localStorage.getItem(savedKey), savedValue);

let requests = [];
let handleRequest = async () => new Response(JSON.stringify({ok: true}));
globalThis.fetch = async (url, options = {}) => {
  requests.push({url, options, body: JSON.parse(options.body)});
  return handleRequest(url, options);
};
const root = createRoot(document.getElementById('root'));
await act(async () => root.render(<Privacy />));
const requestButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '삭제할 기록 확인');
const confirmButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '확인한 서버 기록 삭제');
const cancelButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '취소');
async function click(button) { assert(button); await act(async () => button.click()); }
async function stage() { await click(requestButton()); }

assert.equal(requests.length, 0, 'opening privacy notice does not transmit records or delete them');
assert.equal(document.querySelectorAll('[role="dialog"], dialog').length, 0, 'no popup or choice gate');
assert(!document.body.textContent.includes('기록에 동의하고 이용'));
assert(!document.body.textContent.includes('기록 없이 이용'));
assert(document.body.textContent.includes('안내를 열거나 닫는 동작을 기록 동의로 처리하거나 동의 여부를 저장하지 않아'));
assert(document.body.textContent.includes('사이트 운영 종료까지'));
assert(document.body.textContent.includes('정확히 10일째'));
assert(document.body.textContent.includes('정해진 시각에 자동으로 삭제되는 방식은 아니야'));
assert.equal(requestButton().disabled, true, 'missing capabilities cannot identify records');
assert(document.body.textContent.includes('사이트 관리자에게 삭제를 요청'));

let visitProof, recommendationProof;
await act(async () => {
  visitProof = prepareRecordProof('visit', uuid(11));
  recommendationProof = prepareRecordProof('recommendation', uuid(12));
});
assert.equal(requestButton().disabled, false);
await stage();
assert.equal(requests.length, 0, 'review alone is not deletion authorization');
assert.equal(document.activeElement.id, 'privacy-delete-confirm-title');
assert(!document.documentElement.outerHTML.includes(visitProof));
assert(!document.documentElement.outerHTML.includes(recommendationProof));
await click(cancelButton());
assert.equal(requests.length, 0);
assert.equal(listRecordProofs().length, 2);
assert.equal(document.activeElement, requestButton());
await stage();
await act(async () => document.querySelector('.privacy-delete-confirm').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
assert.equal(document.querySelector('.privacy-delete-confirm'), null);
assert.equal(requests.length, 0);
await stage();
let resolveResponse;
handleRequest = () => new Promise(resolve => { resolveResponse = resolve; });
const confirming = confirmButton();
await act(async () => { confirming.click(); confirming.click(); });
assert.equal(requests.length, 1, 'repeated confirm clicks send one request');
assert.equal(requests[0].url, '/api/privacy/delete');
assert.equal(requests[0].options.method, 'POST');
assert.equal(requests[0].options.cache, 'no-store');
assert.equal(requests[0].body.records.length, 2);
assert.deepEqual(Object.keys(requests[0].body), ['records']);
assert(requests[0].body.records.every(record => Object.keys(record).sort().join(',') === 'id,kind,proof'));
await act(async () => resolveResponse(new Response(JSON.stringify({ok: true}))));
assert.equal(listRecordProofs().length, 0);
assert(document.querySelector('[role="status"]').textContent.includes('삭제 요청 처리가 완료'));
assert.equal(localStorage.getItem(savedKey), savedValue, 'server-record deletion never clears stored numbers');

await act(async () => prepareRecordProof('recommendation', uuid(21)));
handleRequest = async () => { throw Error('synthetic lost response'); };
await stage(); await click(confirmButton());
assert.equal(listRecordProofs().length, 1, 'lost response preserves capability for retry');
assert(document.querySelector('[role="status"]').textContent.includes('완료 응답을 받지 못한'));
handleRequest = async () => new Response(JSON.stringify({ok: false}));
await stage(); await click(confirmButton());
assert.equal(listRecordProofs().length, 1, 'invalid success body does not discard capability');
handleRequest = async () => new Response(JSON.stringify({ok: true}));
await stage(); await click(confirmButton());
assert.equal(listRecordProofs().length, 0);

await act(async () => { for (let index = 30; index < 55; index++) prepareRecordProof('visit', uuid(index)); });
requests = [];
handleRequest = async () => requests.length === 2
  ? new Response(JSON.stringify({error: 'synthetic unavailable'}), {status: 503})
  : new Response(JSON.stringify({ok: true}));
await stage(); await click(confirmButton());
assert.deepEqual(requests.map(request => request.body.records.length), [20, 5]);
assert.equal(listRecordProofs().length, 5, 'only acknowledged batches lose local capabilities');
requests = [];
handleRequest = async () => new Response(JSON.stringify({ok: true}));
await stage(); await click(confirmButton());
assert.deepEqual(requests.map(request => request.body.records.length), [5]);
assert.equal(listRecordProofs().length, 0);
assert.equal(localStorage.getItem(savedKey), savedValue);
assert([...document.querySelectorAll('button')].every(button => Number.parseInt(button.style.minHeight) >= 44));
assert.equal([...Object.keys(localStorage)].some(storageKey => /choice|consent/.test(storageKey)), false);

await act(async () => root.unmount());
console.log('Privacy DOM: notice-only/no consent gate, capability persistence, direct confirmation, cancel/Escape, duplicate-click guard, batched retry and saved-number isolation pass');
