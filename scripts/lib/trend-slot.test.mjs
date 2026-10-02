#!/usr/bin/env node
/**
 * trend-slot.test.mjs — 여섯 편에 한 편은 스튜디오 '트렌드' 탭에서 고른 주제로(트렌드 칸). 2026-10-02 신설.
 *
 * 사장님 지시(Mac mini2 경유, 10/02): 주 1회 Studio → 분석 → 트렌드 탭을 보고 다음 편 주제 1~2개를 골라라.
 *   6편 중 1편은 그 주제로, 48시간 성적을 비교 보고.
 * 첫 점검(10/02 20:2x): 이 채널의 트렌드 탭은 '인기 검색어·브레이크아웃' 목록이 아니라 **검색창 + 키워드별 '현재 인기 콘텐츠' 3편**만 준다
 *   (검색 전 기본 아이디어는 '뉴욕 건축사·팬케이크·헤드폰' — 우리 채널과 무관). 그래서 시드 키워드로 검색해 인기 제목을 모으고,
 *   **여러 제목에 겹치는 낱말**을 주제어로 쓴다(한 편에만 나온 낱말은 그 영상의 말버릇일 수 있다).
 * 칸: 섞은 누적 편수 % 6 === 3 — 실험 칸(=== 0)과 절대 겹치지 않는다.
 * 비교: topic-lift 와 같은 잣대(영상마다 48h 근처 조회수 ÷ 같은 날 중앙값).
 */
import { exploreFor, trendFor, trendTerms, trendOrder, slotLift } from './explore-slot.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
{
  const N = 600, tr = Array.from({ length: N }, (_, n) => trendFor(n));
  const rate = tr.filter(Boolean).length / N;
  const both = tr.filter((x, n) => x && exploreFor(n)).length;
  (rate > 0.13 && rate < 0.21 && both === 0) ? ok(`[1] 약 1/6(${(rate * 100).toFixed(1)}%) · 실험 칸과 겹침 ${both}`) : bad(`[1] rate=${rate} both=${both}`);
}
{
  const items = [
    { q: '주식', title: "AI순환매 새로운 주도주 '이 주식' 상상초월 압도적 황제주 될 겁니다" },
    { q: '주식', title: '"파는게 아니라 사세요" 다음주 화요일부터 주식 많이 사세요. 10월 이때부터 시장 폭등' },
    { q: '증시', title: '10월 증시 폭등 온다, 반도체 주도주 바뀐다' },
    { q: '뉴스', title: '팬케이크 만드는법' },
  ];
  const t = trendTerms(items);
  (t.includes('주도주') && t.includes('폭등') && !t.includes('팬케이크') && !t.includes('주식')) ? ok(`[2] 여러 제목에 겹친 낱말만(시드어 제외): ${t.join(',')}`) : bad(`[2] ${JSON.stringify(t)}`);
  const cands = [{ keyword: '정치 공방', headlines: ['여야 국감 공방'] }, { keyword: '반도체', headlines: ['반도체 주도주 교체, 10월 폭등 전망'] }, { keyword: '날씨', headlines: ['내일 비'] }];
  const o = trendOrder(cands, t);
  (o[0].keyword === '반도체' && o[1].keyword === '정치 공방') ? ok('[3] 주제어가 겹치는 후보가 앞으로, 나머지는 원래 순서') : bad(`[3] ${o.map((c) => c.keyword)}`);
  (trendOrder(cands, []).map((c) => c.keyword).join() === cands.map((c) => c.keyword).join()) ? ok('[3b] 주제어 없으면 순서 그대로') : bad('[3b]');
}
{
  const rows = [];
  const day = (d, vid, views, slot) => rows.push({ video_id: vid, views, age_hours: 48, published_at: `2026-10-0${d}T03:00:00Z`, slot });
  day(1, 'a', 100, 'other'); day(1, 'b', 300, 'trend'); day(1, 'c', 100, 'other');
  day(2, 'd', 200, 'other'); day(2, 'e', 100, 'trend'); day(2, 'f', 200, 'other');
  const m = slotLift(rows);
  (m.get('trend')?.n === 2 && Math.abs(m.get('trend').lift - 1.75) < 0.01) ? ok(`[4] 같은 날 중앙값 대비 — 트렌드 ${JSON.stringify(m.get('trend'))}`) : bad(`[4] ${JSON.stringify([...m])}`);
}
{
  /SHORTS_TREND/.test(src('video-publish.mjs')) && /trend: last\.trend/.test(src('video-publish.mjs')) ? ok('[5a] 발행이 트렌드 칸을 정하고 기록한다') : bad('[5a]');
  /trendOrder\(/.test(src('video/make-shorts.mjs')) && /trend: TREND/.test(src('video/make-shorts.mjs')) ? ok('[5b] 쇼츠가 트렌드 칸에서 순서를 바꾸고 meta 에 남긴다') : bad('[5b]');
  /ADD COLUMN trend INTEGER/.test(src('lib/db.mjs')) ? ok('[5c] DB 열') : bad('[5c]');
  /yt-trend-topics\.mjs/.test(src('cron-runner.mjs')) ? ok('[5d] 주 1회 작업 등록') : bad('[5d]');
  /'shorts_published\.trend'/.test(src('audit-coverage.mjs')) ? ok('[5e] 신규 열 감사 등록') : bad('[5e]');
}
{
  // [6] 첫 수집 실측: 빈도만으로 '겁니다·터질·sbs·뉴스데스크' 가 주제어가 됐다 → agy 가 고르고 코드가 거른다
  const { validTopics, pickTrendTopics } = await import('./trend-topics.mjs');
  const items = [{ q: '뉴스', title: '시중 은행 줄줄이 다 뚫렸다‥국민·하나도 유출 - [LIVE] MBC 뉴스데스크' }, { q: '경제', title: '코스피 급락에 "세계 최악"..폭락 원인은?' }];
  const v = validTopics([{ topic: '은행 개인정보 유출', keywords: ['유출', '은행', '해킹', '뉴스'] }, { topic: '코스피 급락', keywords: ['코스피', '겁니다 터질'] }, { topic: 'x', keywords: ['없는말'] }], items);
  (v?.length === 2 && v[0].keywords.join() === '유출,은행' && v[1].keywords.join() === '코스피')
    ? ok(`[6a] 제목에 없는 말(해킹)·시드어(뉴스)·띄어쓴 말은 버린다: ${JSON.stringify(v)}`) : bad(`[6a] ${JSON.stringify(v)}`);
  (validTopics([{ topic: 'x', keywords: ['없는말'] }], items) === null) ? ok('[6b] 남는 게 없으면 null(칸이 쉰다)') : bad('[6b]');
  const r = await pickTrendTopics(items, { call: async () => '작업을 완료했습니다' });
  r === null ? ok('[6c] agy 가 일꾼처럼 답하면 null') : bad('[6c]');
  /pickTrendTopics\(/.test(src('yt-trend-topics.mjs')) ? ok('[6d] 주간 작업이 agy 선택을 쓴다') : bad('[6d]');
}
{
  // [7] 10/02 실측: 스키마의 배열에 items 가 없어 Gemini 가 400 으로 거절 → 주제 0개. 스키마 안의 모든 배열에 items 가 있는가.
  const src2 = src('lib/trend-topics.mjs');
  const arrays = (src2.match(/type: 'array'/g) ?? []).length, withItems = (src2.match(/type: 'array', items:/g) ?? []).length;
  (arrays > 0 && arrays === withItems) ? ok(`[7] 스키마 배열 ${arrays}개 모두 items 있음`) : bad(`[7] 배열 ${arrays} · items ${withItems}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
