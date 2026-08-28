#!/usr/bin/env node
/**
 * music.test.mjs — 배경음악 후보 고르기.
 *
 * 배경(2026-08-27): "배경음악 살짝만 깔자". 나레이션만 있으면 화면이 정적으로 느껴진다.
 *
 * 선택 규칙:
 *   · 직접 내려받을 수 있어야 한다 — Openverse 결과에 랜딩페이지 URL 이 섞여 온다(실측 22건 중 5건).
 *   · CC0/PD 우선 — 표기 의무가 없다. CC BY 도 쓰되 크레딧 한 줄이 붙는다.
 *   · 영상보다 길어야 이어붙이지 않는다. 짧으면 반복해야 하고 이음매가 들린다.
 *   · NC/ND 금지 — 수익화·편집과 충돌한다(licenseUsable 과 같은 기준).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./music.mjs');

const T = (o) => ({ url: 'https://x/a.mp3', license: 'cc0', duration: 120_000, title: 't', ...o });

// ── 1. 직접 다운로드 가능한 것만 ─────────────────────────────────────────────
{
  const c = [T({ url: 'https://x/landing?id=3', license: 'cc0' }), T({ url: 'https://x/a.mp3' })];
  if (M.pickTrack(c, { needSec: 60 })?.url.endsWith('.mp3')) ok('오디오 파일만 고른다');
  else bad('랜딩 URL 을 골랐다');
}

// ── 2. CC0 우선 ──────────────────────────────────────────────────────────────
{
  const c = [T({ url: 'https://x/by.mp3', license: 'by 4.0', duration: 300_000 }),
             T({ url: 'https://x/cc0.mp3', license: 'cc0 1.0', duration: 120_000 })];
  if (M.pickTrack(c, { needSec: 60 })?.url.includes('cc0')) ok('CC0 를 먼저 (표기 의무 0)');
  else bad('CC BY 를 먼저 골랐다');
}

// ── 3. 길이 ──────────────────────────────────────────────────────────────────
{
  const c = [T({ url: 'https://x/short.mp3', duration: 20_000 }),
             T({ url: 'https://x/long.mp3', duration: 200_000 })];
  if (M.pickTrack(c, { needSec: 90 })?.url.includes('long')) ok('영상보다 긴 트랙 우선');
  else bad('짧은 트랙을 골랐다');
  // 전부 짧으면 그중 가장 긴 것 — 없는 것보다 낫다(루프로 채운다).
  const shorts = [T({ url: 'https://x/a.mp3', duration: 20_000 }), T({ url: 'https://x/b.mp3', duration: 40_000 })];
  if (M.pickTrack(shorts, { needSec: 90 })?.url.includes('b')) ok('전부 짧으면 최장 트랙');
  else bad('짧은 것만 있을 때 처리 이상');
}

// ── 4. NC/ND 차단 ────────────────────────────────────────────────────────────
{
  const c = [T({ url: 'https://x/nc.mp3', license: 'by-nc 3.0' }), T({ url: 'https://x/nd.mp3', license: 'by-nd 4.0' })];
  if (M.pickTrack(c, { needSec: 60 }) === null) ok('NC·ND 만 있으면 음악 없이 간다');
  else bad('NC/ND 를 골랐다');
}

// ── 5. 빈 입력 ───────────────────────────────────────────────────────────────
{
  if (M.pickTrack([], {}) === null && M.pickTrack(null, {}) === null) ok('빈 입력 안전');
  else bad('빈 입력 이상');
}

// ── 6. 크레딧 ────────────────────────────────────────────────────────────────
{
  if (M.musicCredit(T({ license: 'cc0 1.0' })) === null) ok('CC0 는 크레딧 없음');
  else bad('CC0 크레딧 생성');
  const c = M.musicCredit(T({ license: 'by 4.0', title: 'Sleep of Eons', author: 'szegvari' }));
  if (c && c.includes('Sleep of Eons') && c.includes('szegvari')) ok(`CC BY 크레딧: ${c.slice(0, 50)}`);
  else bad(`크레딧 부실: ${c}`);
}

console.log(fail ? `\n❌ music ${fail} 실패` : '\n✅ music 전부 통과');
process.exit(fail ? 1 : 0);
