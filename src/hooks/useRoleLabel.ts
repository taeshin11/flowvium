'use client';
/**
 * useRoleLabel — 공급망 역할·관계 유형(role/type)을 로케일 라벨로.
 *
 * 왜 훅인가(2026-08-22): 이 배선은 원래 CompanyPage.tsx 안에만 있었다. 내가 전날
 *   그 페이지의 `capitalize` 표기를 고치면서 거기서만 만들었고, 같은 값을 찍는
 *   ComparePage 는 그대로 뒀다. 다음 날 페이지 감사에서 /ko/compare 에
 *   'leader' · 'supplier' · 'accumulating' 이 영문으로 17건 잡혔다.
 *   useSectorLabel 이 이미 같은 이유로 훅이 됐는데도 같은 실수를 반복했다.
 *   배선을 컴포넌트 안에 두면 다음 소비처가 생길 때 반드시 어긋난다.
 *
 * 키가 없는 값은 원본을 그대로 둔다 — t() 는 없는 키에 예외를 던지므로 존재 확인이 먼저다.
 */
import { useCallback, useMemo } from 'react';
import { useTranslations, useMessages } from 'next-intl';

export function useRoleLabel(): (v?: string | null) => string {
  const tRole = useTranslations('roles');
  // useMessages() 결과에서 파생한 객체를 그대로 deps 에 넣으면 매 렌더 새 참조가 되어
  //   useCallback 이 무의미해진다(ESLint react-hooks/exhaustive-deps 가 지적). useMemo 로 고정한다.
  const messages = useMessages() as { roles?: Record<string, unknown> } | undefined;
  const roleMsgs = useMemo(() => messages?.roles ?? {}, [messages]);
  return useCallback((v?: string | null): string => {
    const k = String(v ?? '');
    return Object.prototype.hasOwnProperty.call(roleMsgs, k) ? tRole(k) : k.replace(/_/g, ' ');
  }, [roleMsgs, tRole]);
}
