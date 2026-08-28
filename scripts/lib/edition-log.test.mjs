#!/usr/bin/env node
/**
 * edition-log.test.mjs — 하루 여러 편을 낼 때 같은 뉴스를 되풀이하지 않는가.
 *
 * 요구(2026-08-28): 하루 5편. 그 사이 새로 나온 뉴스를 모아 만든다.
 *   수집 창이 고정 12시간이면 5편이 같은 뉴스를 다섯 번 내보낸다.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./edition-log.mjs');

// ── 1. 헤드라인 정규화 ───────────────────────────────────────────────────────
//   같은 기사를 매체마다 따옴표·대소문자를 달리 쓴다. 그대로 비교하면 중복을 못 잡는다.
{
  const a = M.normHeadline('Trump signs order to rename Lake Ontario "Lake America"');
  const b = M.normHeadline('Trump signs order to rename Lake Ontario “Lake America”');
  const c = M.normHeadline('TRUMP SIGNS ORDER TO RENAME LAKE ONTARIO ‘LAKE AMERICA’');
  if (a === b && b === c) ok(`따옴표·대소문자 차이를 흡수한다 ("${a.slice(0, 40)}…")`);
  else bad(`정규화가 안 맞는다\n      ${a}\n      ${b}\n      ${c}`);
  if (M.normHeadline(null) === '') ok('빈 입력은 빈 문자열');
  else bad('빈 입력 처리 이상');
}

// ── 2. 이미 쓴 뉴스는 뺀다 ───────────────────────────────────────────────────
{
  const log = [
    { headlines: ['Trump renames Lake Ontario', 'Fed says claims untrue'] },
    { headlines: ['Judge rules Anthropic blacklist illegal'] },
  ];
  const used = M.usedHeadlines(log, 5);
  const rows = [
    { headline: 'Trump renames Lake Ontario' },          // 중복
    { headline: 'TRUMP RENAMES LAKE ONTARIO' },          // 대소문자만 다른 중복
    { headline: 'Senate passes new budget bill' },       // 새 것
  ];
  const r = M.filterUsed(rows, used);
  if (r.rows.length === 1 && r.dropped === 2 && r.rows[0].headline.includes('Senate'))
    ok(`이미 쓴 2건을 빼고 새 1건만 남긴다`);
  else bad(`중복 제거 이상 — 남은 ${r.rows.length}건, 뺀 ${r.dropped}건`);
}

// ── 3. 최근 N 편만 본다 ──────────────────────────────────────────────────────
//   무한정 보면 며칠 지난 후속 보도까지 막혀 소재가 마른다.
{
  const log = [
    { headlines: ['old story'] },
    { headlines: ['newer story'] },
  ];
  const only1 = M.usedHeadlines(log, 1);
  if (!only1.has(M.normHeadline('old story')) && only1.has(M.normHeadline('newer story')))
    ok('최근 1편만 보면 그 이전 편은 다시 쓸 수 있다');
  else bad('최근 N 편 제한이 안 걸린다');
  if (M.usedHeadlines([], 5).size === 0) ok('기록이 없으면 아무것도 막지 않는다');
  else bad('빈 기록인데 뭔가 막았다');
}

// ── 4. 기록 쓰기·읽기 ────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'edlog-'));
  const f = join(dir, 'nested', 'editions.json');
  try {
    M.appendEdition(f, { at: '2026-08-28T10:00:00Z', keywords: ['trump'], headlines: ['A', 'B'], video: 'abc' });
    M.appendEdition(f, { at: '2026-08-28T14:00:00Z', keywords: ['fed'], headlines: ['C'] });
    const log = M.readLog(f);
    if (log.length === 2 && log[1].keywords[0] === 'fed') ok('없는 폴더에도 기록을 만들고 이어 쓴다');
    else bad(`기록 이상 — ${JSON.stringify(log)}`);
    // 상한: 오래된 것부터 버린다
    for (let i = 0; i < 70; i++) M.appendEdition(f, { headlines: [`h${i}`] }, 60);
    const capped = M.readLog(f);
    if (capped.length === 60) ok('기록은 최근 60편만 남는다');
    else bad(`상한이 안 걸린다 — ${capped.length}편`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── 5. 깨진 기록에도 멈추지 않는다 ───────────────────────────────────────────
//   중복 방지 실패보다 편성 중단이 더 나쁘다.
{
  const dir = mkdtempSync(join(tmpdir(), 'edlog2-'));
  const f = join(dir, 'bad.json');
  try {
    (await import('node:fs')).writeFileSync(f, '{ 깨진 json');
    if (M.readLog(f).length === 0) ok('깨진 기록은 빈 것으로 보고 계속 간다');
    else bad('깨진 기록에서 뭔가 읽었다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(fail ? `\n  ${fail}개 실패` : '\n✅ edition-log 전부 통과');
process.exit(fail ? 1 : 0);
