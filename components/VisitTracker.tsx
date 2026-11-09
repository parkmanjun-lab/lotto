'use client';
import {useEffect, useRef} from 'react';
import {prepareRecordProof} from '@/lib/visitor-privacy';

export default function VisitTracker() {
  const sent = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sent.current) return;
      try {
        const visitId = crypto.randomUUID();
        const deleteSecret = prepareRecordProof('visit', visitId);
        const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ||
          (navigator as Navigator & {standalone?: boolean}).standalone ? 'standalone' : 'browser';
        sent.current = true;
        // Persist proof before sending and retain it after failed/lost responses.
        // Opening the notice is not consent; no consent flag or browser gate exists.
        void fetch('/api/visit', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({visitId, displayMode, deleteSecret}),
          cache: 'no-store',
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
