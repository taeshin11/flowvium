'use client';
/**
 * useSectorLabel — 섹터 문자열(카탈로그 id 또는 보고서 JSON 의 자유 표기)을 로케일 라벨로.
 *
 * 카탈로그(data/sectors.ts 의 id)와 번역(messages/*.json 의 explore.sectors.<id>)을 한 곳에서 묶는다.
 * 페이지마다 같은 배선을 반복하면 한 곳만 고쳐져 어긋난다 — 실제로 signals·screener·report 가
 * 각자 다른 방식으로 섹터명을 찍고 있었고, report 만 영문으로 남아 있었다.
 */
import { useCallback, useMemo } from 'react';
import { useTranslations, useMessages } from 'next-intl';
import { sectors as sectorCatalog } from '@/data/sectors';
import { localizeSector } from '@/lib/sector-label';

export function useSectorLabel(): (raw: string) => string {
  const tExplore = useTranslations('explore');
  const messages = useMessages() as Record<string, unknown> | undefined;
  // 2026-08-21: 게이트를 '카탈로그 멤버십' 에서 '번역 보유 여부' 로 바꾼다.
  //   localizeSector 는 known 에 없으면 원문을 그대로 돌려준다. known 을 data/sectors.ts 의
  //   id 집합으로 잡았더니, messages 에 번역이 있어도 카탈로그에 없는 섹터는 영문이 나갔다
  //   (실측: /ko/cascade 에 "Financials / Fintech" "Materials / Critical Minerals" 노출).
  //   이 함수가 실제로 묻는 것은 "이걸 번역할 수 있나" 이므로 messages 를 근거로 삼는 게 맞다.
  //   카탈로그는 messages 를 못 읽을 때의 폴백으로만 둔다.
  const known = useMemo(() => {
    const sectors = (messages as { explore?: { sectors?: Record<string, unknown> } } | undefined)?.explore?.sectors;
    const ids = sectors ? Object.keys(sectors) : [];
    return new Set(ids.length ? ids : sectorCatalog.map((s) => s.id));
  }, [messages]);
  return useCallback((raw: string) => localizeSector(raw, known, tExplore), [known, tExplore]);
}
