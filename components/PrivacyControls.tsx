'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  forgetRecordProofs, listRecordProofs, subscribeRecordProofs, type RecordProof,
} from '@/lib/visitor-privacy';

// Kept as a link for existing callers; this never opens a consent prompt.
export function PrivacySettingsButton({children = '내 서버 기록 삭제'}: {children?: ReactNode}) {
  return <a className="privacy-settings-button" href="/privacy#delete-records">{children}</a>;
}

export default function PrivacyControls() {
  const [count, setCount] = useState(0);
  const [confirmation, setConfirmation] = useState<RecordProof[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const started = useRef(false);
  const requestButton = useRef<HTMLButtonElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const update = () => setCount(listRecordProofs().length);
    update();
    const unsubscribe = subscribeRecordProofs(update);
    return () => { mounted.current = false; unsubscribe(); };
  }, []);

  useEffect(() => { if (confirmation) confirmationHeading.current?.focus(); }, [confirmation]);

  function cancel() {
    if (started.current) return;
    setConfirmation(null);
    requestButton.current?.focus();
  }

  async function deleteRecords() {
    if (!confirmation?.length || started.current) return;
    started.current = true;
    setBusy(true);
    setMessage('');
    const records = confirmation;
    try {
      for (let index = 0; index < records.length; index += 20) {
        const batch = records.slice(index, index + 20);
        const response = await fetch('/api/privacy/delete', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({records: batch}), cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        const result = await response.json() as {ok?: unknown};
        if (!response.ok || result?.ok !== true) throw Error('delete_unconfirmed');
        forgetRecordProofs(batch);
      }
      if (mounted.current) setMessage('삭제 요청 처리가 완료됐어. 확인 정보와 일치하는 서버 기록이 삭제되며, 이미 없어진 기록은 그대로야.');
    } catch {
      if (mounted.current) setMessage('삭제 완료를 확인하지 못했어. 완료 응답을 받지 못한 기록의 확인 정보는 이 브라우저에 남겨뒀어. 잠시 후 다시 요청해줘.');
    } finally {
      started.current = false;
      if (mounted.current) {
        setBusy(false);
        setConfirmation(null);
        setCount(listRecordProofs().length);
      }
    }
  }

  return <section id="delete-records" className="privacy-delete-controls" aria-labelledby="privacy-delete-title">
    <h2 id="privacy-delete-title">이 브라우저의 서버 기록 삭제</h2>
    <p className="privacy-note">{count > 0
      ? `이 브라우저에 삭제 확인 정보 ${count}건이 있어. 접수되지 않았거나 이미 삭제된 기록도 포함될 수 있어.`
      : '이 브라우저에서 사용할 수 있는 삭제 확인 정보가 없어. 다른 브라우저의 기록이나 이전 기록은 여기서 본인 기록으로 확인할 수 없어.'}</p>
    <p className="privacy-note">확인 정보가 없으면 사이트 관리자에게 삭제를 요청해줘. IP만으로 본인 기록을 확정하지 않아.</p>
    <button ref={requestButton} type="button" className="saved-action" style={{minHeight: 44}} disabled={busy || count === 0} onClick={() => {
      const records = listRecordProofs();
      setCount(records.length);
      if (records.length) { setMessage(''); setConfirmation(records); }
    }}>{busy ? '삭제 요청 중…' : '삭제할 기록 확인'}</button>
    {confirmation && <div className="privacy-delete-confirm" role="group" aria-labelledby="privacy-delete-confirm-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); cancel(); }
    }}>
      <h3 ref={confirmationHeading} id="privacy-delete-confirm-title" tabIndex={-1}>서버 기록을 삭제할까?</h3>
      <p>이 브라우저에 삭제 확인 정보가 있는 방문·추천 기록 {confirmation.length}건에 대해 삭제를 요청해. 일치하는 서버 기록은 되돌릴 수 없어.</p>
      <p className="privacy-note">보관함의 번호는 그대로야. 이 요청 이후의 방문이나 새 추천은 새 기록으로 남을 수 있어.</p>
      <div className="privacy-actions">
        <button type="button" className="saved-action" style={{minHeight: 44}} disabled={busy} onClick={cancel}>취소</button>
        <button type="button" className="saved-action danger" style={{minHeight: 44}} disabled={busy} onClick={() => void deleteRecords()}>{busy ? '삭제 요청 중…' : '확인한 서버 기록 삭제'}</button>
      </div>
    </div>}
    <p className="privacy-status" role="status" aria-live="polite">{message}</p>
  </section>;
}
