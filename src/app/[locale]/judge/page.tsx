'use client';
// /[locale]/judge — 매수·매도 심판엔진 채팅 *전용 페이지*(2026-06-18 사용자 "이 페이지가 url이 없어").
//   기존엔 홈 위 모달이라 URL 이 없어 링크·북마크·공유 불가 → 독립 라우트로 승격. 닫기=홈으로 이동.
import nextDynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

const JudgeChat = nextDynamic(() => import('@/components/JudgeChat'), { ssr: false });

export default function JudgePage() {
  const router = useRouter();
  const locale = useLocale();
  return <JudgeChat onClose={() => router.push(`/${locale}`)} />;
}
