#!/usr/bin/env node
/**
 * seed-company-names.mjs — 권위 있는 회사명 매핑을 확정 번역 사전에 넣는다.
 *
 * 배경(2026-08-20): 웹 레인(4B)이 회사명을 음차하다 틀린다 — 실측:
 *     Micron → "마이크로닉스"(정답 마이크론) · Applied Materials → "애플라이드 재료스"
 *     Etsy   → "이츠이"(정답 엣시)
 *   전부 유효한 한국어라 script-splice/isUntranslated 게이트가 못 잡는다.
 *   의미·음차 오류는 자동 검출이 불가능하므로, 애초에 모델에 묻지 않는 게 답이다.
 *
 *   이 저장소에는 이미 권위 소스가 있다:
 *     src/data/company-names-i18n.ts   티커 → [한국어/일본어/중국어 별칭]  (사람이 정리)
 *     data/sp500-tickers.json .meta    티커 → 영문 회사명
 *     data/candidate-tickers.json      .meta(영문명) · .krNames(한국 종목 한국어명)
 *   이 둘을 티커로 조인하면 '영문명 → 한국어명' 쌍이 나온다. source='human' 으로 넣어
 *   모델 출력(qwen3.8-27b/4b)이 나중에 덮어쓰지 못하게 한다(translation-memory 의 rank 규칙).
 *
 * 사용: node scripts/seed-company-names.mjs [--dry]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { openMemory } from './lib/translation-memory.mjs';
import { hasScriptSplice } from './lib/script-splice.mjs';
import { isPlausibleCompanyName } from './lib/company-name-plausible.mjs';

const DRY = process.argv.includes('--dry');
const readJson = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

/** 티커 → 한국어 회사명 (권위 소스 2곳 병합) */
export function loadKoreanNames() {
  const out = new Map();
  const src = readFileSync(resolve(ROOT, 'src/data/company-names-i18n.ts'), 'utf8');
  for (const m of src.matchAll(/^\s*'?([A-Z0-9.]{1,12})'?:\s*\[([^\]]+)\]/gm)) {
    const vals = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const ko = vals.find((x) => /[가-힣]/.test(x));
    if (ko) out.set(m[1], ko);
  }
  // 한국 종목은 krNames 가 이미 티커 → 한국어명
  for (const [t, n] of Object.entries(readJson('data/candidate-tickers.json').krNames ?? {})) {
    if (!out.has(t)) out.set(t, n);
  }
  return out;
}

/** 티커 → 영문 회사명. sp500 쪽이 더 정확해서 나중에 덮어쓴다. */
export function loadEnglishNames() {
  const out = new Map();
  for (const [t, v] of Object.entries(readJson('data/candidate-tickers.json').meta ?? {})) if (v?.name) out.set(t, v.name);
  for (const [t, v] of Object.entries(readJson('data/sp500-tickers.json').meta ?? {})) if (v?.name) out.set(t, v.name);
  return out;
}

/**
 * 영문 전체명 + (모호하지 않은) 축약형 쌍을 만든다.
 * 축약형(첫 토큰)은 UI 에 자주 나오지만("Micron"), 여러 회사가 같은 첫 토큰을 쓰면
 * 어느 쪽인지 알 수 없으므로 제외한다 — 틀린 확정보다 미확정이 낫다.
 */
export function buildPairs(koNames = loadKoreanNames(), enNames = loadEnglishNames()) {
  const full = [], shortCand = [], shortCount = new Map();
  for (const [ticker, ko] of koNames) {
    const en = enNames.get(ticker);
    // 영문명 소스의 품질이 고르지 않다 — 소재지("Mountain View, California")나
    // 사업부문 설명("PC Peripherals (Mice, Keyboards)")이 name 에 들어 있는 티커가 있다.
    // 사전은 TTL 이 없어 한 번 잘못 들어가면 계속 잘못 나가므로 넣기 전에 거른다.
    if (!isPlausibleCompanyName(en)) continue;
    if (hasScriptSplice(ko, 'ko')) continue;
    full.push({ en, ko, ticker });
    const w = en.split(/\s+/);
    if (w.length < 2) continue;
    const s = w[0].replace(/[.,]$/, '');
    if (s.length < 4 || !/^[A-Z][A-Za-z]+$/.test(s)) continue;
    shortCount.set(s, (shortCount.get(s) ?? 0) + 1);
    shortCand.push({ en: s, ko, ticker, short: true });
  }
  const short = shortCand.filter((p) => shortCount.get(p.en) === 1);
  return { full, short, ambiguous: shortCand.length - short.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { full, short, ambiguous } = buildPairs();
  console.log(`  전체명 ${full.length}쌍 · 축약형 ${short.length}쌍 (모호해서 제외 ${ambiguous})`);
  if (DRY) { for (const p of [...full, ...short].slice(0, 10)) console.log(`  (dry) ${p.en} → ${p.ko}`); process.exit(0); }
  const tm = openMemory(resolve(ROOT, 'data/flowvium.db'));
  let added = 0, skipped = 0, corrected = 0, collided = 0;
  for (const p of [...full, ...short]) {
    const cur = tm.lookup(p.en, 'ko');
    // 축약형은 전체명보다 신뢰도가 낮다. 이미 다른 뜻으로 등록돼 있으면 덮지 않는다 —
    // 실측: 회사 축약형 "Defense"가 섹터명 "Defense → 방위"를 "커티스라이트"로 덮었다.
    if (p.short && cur && cur !== p.ko) { collided++; continue; }
    if (cur && cur !== p.ko) { console.log(`  교정 ${p.en}: ${cur} → ${p.ko}`); corrected++; }
    tm.remember(p.en, 'ko', p.ko, { source: 'human' }) ? added++ : skipped++;
  }
  if (collided) console.log(`  축약형 충돌로 보류 ${collided}건 (기존 뜻 보존)`);
  console.log(`  등록 ${added} · 건너뜀 ${skipped} · 교정 ${corrected}`);
  console.log('  사전:', JSON.stringify(tm.stats()));
  tm.close();
}
