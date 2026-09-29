'use client';
/**
 * 아침보고서 메일 — 동의/수신거부 확인 페이지 (2026-09-30).
 *   /{locale}/mail?a=confirm&t=…  또는  ?a=unsubscribe&t=…
 *   바꾸는 것은 버튼을 눌렀을 때만(POST). 링크를 여는 것만으로는 아무것도 바뀌지 않는다.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function MailPrefsPage() {
  const t = useTranslations('mail');
  const q = useSearchParams();
  const action = q.get('a') === 'confirm' ? 'confirm' : 'unsubscribe';
  const token = q.get('t') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const submit = async () => {
    setState('busy');
    try {
      const r = await fetch(`/api/mail/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }) });
      setState(r.ok ? 'done' : 'error');
    } catch { setState('error'); }
  };
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-gray-900 mb-3">{t(action === 'confirm' ? 'confirmTitle' : 'unsubTitle')}</h1>
      {!token && <p className="text-sm text-red-500">{t('invalid')}</p>}
      {token && state !== 'done' && (
        <>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">{t(action === 'confirm' ? 'confirmBody' : 'unsubBody')}</p>
          <button onClick={submit} disabled={state === 'busy'}
            className="px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50">
            {t(action === 'confirm' ? 'confirmButton' : 'unsubButton')}
          </button>
          {state === 'error' && <p className="text-xs text-red-500 mt-3">{t('invalid')}</p>}
        </>
      )}
      {state === 'done' && <p className="text-sm text-gray-700">{t(action === 'confirm' ? 'confirmed' : 'unsubscribed')}</p>}
    </div>
  );
}
