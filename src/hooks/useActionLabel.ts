'use client';
/**
 * useActionLabel — 기관 수급 행동(accumulating·reducing·new_position·exit)을 로케일 라벨로.
 *
 * 왜 훅인가(2026-08-22): 같은 라벨 배선이 페이지마다 따로 있었다 —
 *   ScreenerPage·ShortPage 는 각자 손수 맵을 들고 있었고, ComparePage 는 아예 없어서
 *   `sig.action.replace('_',' ')` 로 원시 값을 찍었다. 그 결과 /ko/compare 에
 *   'accumulating'·'reducing' 이 6건 영문으로 노출됐다(페이지 감사 실측).
 *   useSectorLabel·useRoleLabel 과 같은 이유로 단일 출처로 모은다 —
 *   배선을 컴포넌트 안에 두면 다음 소비처가 생길 때 반드시 어긋난다.
 *
 * 키가 없는 값은 원본을 그대로 둔다 — t() 는 없는 키에 예외를 던지므로 존재 확인이 먼저다.
 */
import { useCallback, useMemo } from 'react';
import { useTranslations, useMessages } from 'next-intl';

export function useActionLabel(): (v?: string | null) => string {
  const tAct = useTranslations('signals.actions');
  // useMessages() 결과에서 파생한 객체를 그대로 deps 에 넣으면 매 렌더 새 참조가 되어
  //   useCallback 이 무의미해진다(ESLint react-hooks/exhaustive-deps 가 지적). useMemo 로 고정한다.
  const messages = useMessages() as { signals?: { actions?: Record<string, unknown> } } | undefined;
  const msgs = useMemo(() => messages?.signals?.actions ?? {}, [messages]);
  return useCallback((v?: string | null): string => {
    const k = String(v ?? '');
    return Object.prototype.hasOwnProperty.call(msgs, k) ? tAct(k) : k.replace(/_/g, ' ');
  }, [msgs, tAct]);
}
