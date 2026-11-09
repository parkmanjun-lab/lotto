// Per-record deletion capabilities live only in this browser. They are not consent.
export type RecordKind = 'visit' | 'recommendation';
export type RecordProof = { kind: RecordKind; id: string; proof: string };

export const RECORD_PROOF_PREFIX = 'lotto-notes:privacy:record-proof:v1:';
const RECORD_PROOF_EVENT = 'lotto:record-proofs-change';
export const PRIVACY_RETENTION = {
  ordinaryDays: 10,
  winning: '1~5등 일치 추천의 IP·기기 환경·접수 시각·번호는 사이트 운영 종료까지 보관해.',
  pending: '10일이 지나도 공식 결과를 확인하지 못한 추천은 IP·기기 환경을 지우고 번호·대상 회차 등 결과 확인에 필요한 정보만 보관해.',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function notifyRecordProofs(): void {
  window.dispatchEvent(new Event(RECORD_PROOF_EVENT));
}

export function subscribeRecordProofs(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(RECORD_PROOF_PREFIX)) return;
    try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch {}
    listener();
  };
  window.addEventListener(RECORD_PROOF_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(RECORD_PROOF_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function proofKey(kind: RecordKind, id: string): string {
  if ((kind !== 'visit' && kind !== 'recommendation') || !UUID.test(id)) throw Error('invalid_record');
  return `${RECORD_PROOF_PREFIX}${kind}:${id.toLowerCase()}`;
}

export function getRecordProof(kind: RecordKind, id: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const proof = window.localStorage.getItem(proofKey(kind, id));
    return proof && SECRET.test(proof) ? proof : null;
  } catch { return null; }
}

// Persist before sending. If this cannot be verified, do not send the record.
// Individual keys avoid losing other tabs' proofs through shared-array writes.
export function prepareRecordProof(kind: RecordKind, id: string): string {
  if (typeof window === 'undefined') throw Error('record_proof_unavailable');
  const key = proofKey(kind, id);
  try {
    const existing = window.localStorage.getItem(key);
    if (existing !== null) {
      if (!SECRET.test(existing)) throw Error('record_proof_unavailable');
      return existing;
    }
  } catch { throw Error('record_proof_unavailable'); }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const proof = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    window.localStorage.setItem(key, proof);
    if (window.localStorage.getItem(key) !== proof) throw Error('record_proof_unavailable');
  } catch { throw Error('record_proof_unavailable'); }
  notifyRecordProofs();
  return proof;
}

export function listRecordProofs(): RecordProof[] {
  if (typeof window === 'undefined') return [];
  const records: RecordProof[] = [];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(RECORD_PROOF_PREFIX)) continue;
      const parts = key.slice(RECORD_PROOF_PREFIX.length).split(':');
      if (parts.length !== 2) continue;
      const [kind, id] = parts;
      if ((kind !== 'visit' && kind !== 'recommendation') || !UUID.test(id ?? '')) continue;
      if (key !== proofKey(kind, id)) continue;
      const proof = storage.getItem(key);
      if (proof && SECRET.test(proof)) records.push({kind, id, proof});
    }
  } catch { return []; }
  return records;
}

export function forgetRecordProofs(records: RecordProof[]): void {
  if (typeof window === 'undefined') return;
  for (const record of records) {
    try {
      const key = proofKey(record.kind, record.id);
      if (window.localStorage.getItem(key) === record.proof) window.localStorage.removeItem(key);
    } catch {}
  }
  notifyRecordProofs();
}
