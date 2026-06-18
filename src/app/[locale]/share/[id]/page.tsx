'use client';
// /[locale]/share/[id] — 공유된 심판엔진 대화 읽기전용 페이지(2026-06-18 사용자 "채팅 링크 공유").
//   /api/judge-chat/share?id= 스냅샷을 받아 렌더. 인증 불필요(공개). 새 질문은 /judge 로 유도.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { Scale, Home } from 'lucide-react';

interface Snap { title?: string; mode?: string; messages?: Array<{ role: string; content: string }>; sharedAt?: number }

// 아주 가벼운 마크다운(굵게/줄바꿈)만 — 읽기전용 표시용.
function render(text: string) {
  const html = (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
  return { __html: html };
}

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`/api/judge-chat/share?id=${encodeURIComponent(String(id))}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setSnap).catch(() => setErr(true));
  }, [id]);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center flex-shrink-0"><Scale className="w-4 h-4 text-white" /></div>
          <span className="font-bold text-gray-900 truncate">{snap?.title ?? '매수·매도 심판엔진'}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">· 공유됨</span>
        </div>
        <Link href={`/${locale}`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><Home className="w-4 h-4" /> 홈</Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {err && <p className="text-center text-gray-400 py-20">공유된 대화를 찾을 수 없습니다(만료되었거나 잘못된 링크).</p>}
        {!err && !snap && <p className="text-center text-gray-400 py-20">불러오는 중…</p>}
        {snap?.messages?.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-3xl rounded-br-md bg-gray-100 px-4 py-2.5 text-[15px] text-gray-900 whitespace-pre-wrap">{m.content}</div></div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 via-rose-500 to-pink-600 flex items-center justify-center mt-0.5"><Scale className="w-4 h-4 text-white" /></div>
              <div className="flex-1 min-w-0 text-[15px] text-gray-800 leading-relaxed" dangerouslySetInnerHTML={render(m.content)} />
            </div>
          )
        ))}
        {snap && (
          <div className="pt-6 text-center">
            <Link href={`/${locale}/judge`} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-orange-500 to-pink-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg transition-shadow">
              <Scale className="w-4 h-4" /> 나도 심판엔진에게 물어보기
            </Link>
            <p className="text-[11px] text-gray-400 mt-3">AI 판단이며 투자 책임은 본인에게 있습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
