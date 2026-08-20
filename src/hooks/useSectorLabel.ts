'use client';
/**
 * useSectorLabel — 섹터 문자열(카탈로그 id 또는 보고서 JSON 의 자유 표기)을 로케일 라벨로.
 *
 * 카탈로그(data/sectors.ts 의 id)와 번역(messages/*.json 의 explore.sectors.<id>)을 한 곳에서 묶는다.
 * 페이지마다 같은 배선을 반복하면 한 곳만 고쳐져 어긋난다 — 실제로 signals·screener·report 가
 * 각자 다른 방식으로 섹터명을 찍고 있었고, report 만 영문으로 남아 있었다.
 */
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { sectors as sectorCatalog } from '@/data/sectors';
import { localizeSector } from '@/lib/sector-label';

export function useSectorLabel(): (raw: string) => string {
  const tExplore = useTranslations('explore');
  const known = useMemo(() => new Set(sectorCatalog.map((s) => s.id)), []);
  return useCallback((raw: string) => localizeSector(raw, known, tExplore), [known, tExplore]);
}
