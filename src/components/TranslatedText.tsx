'use client';
/**
 * TranslatedText — 런타임 번역 래퍼.
 *
 * 2026-08-20: 같은 3줄짜리 `function T({ text })` 가 여러 페이지에 각각 지역 정의돼 있었다.
 * 복제를 늘리지 않으려고 공용으로 뺀다. 동작은 기존과 동일(useTranslatedText 위임).
 *
 * 왜 messages/*.json 이 아니라 런타임 번역인가:
 *   src/data/sectors.ts 의 description 같은 '데이터에 붙은 설명문'은 16개 언어를 손으로
 *   유지하기 어렵고, 이 저장소는 이미 회사·Cascade·Explore 페이지에서 같은 방식을 쓴다.
 *   UI 라벨(버튼·메뉴)은 종전대로 messages/*.json 을 쓴다 — 이 컴포넌트는 데이터 설명문용이다.
 */
import { useTranslatedText } from '@/hooks/useTranslatedText';

export function TranslatedText({ text }: { text: string | undefined }) {
  const translated = useTranslatedText(text);
  return <>{translated}</>;
}
export default TranslatedText;
