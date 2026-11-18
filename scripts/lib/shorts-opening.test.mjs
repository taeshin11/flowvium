#!/usr/bin/env node
/**
 * shorts-opening.test.mjs — 첫 3초에 컷 2~3번(사장님 11/18 5원칙 3) + 핵심 숫자 카드(11/17 3-AI 채택 B). (2026-11-18 신설)
 *
 * 왜(11/17 실측, consult-1117/ours.jpg): 우리 쇼츠 6편 모두 0.2초·1.5초·3초 화면이 같은 정지 사진이었다
 *   (push 편도 3초 안 차이가 거의 안 보임). 경제 상위 3채널의 30일 상위 쇼츠 10편은 3초 안에 그래프·숫자·자막이 바뀐다.
 * 그래서 첫 장면 0~3초를 세 컷으로: 0~1초 사진 그대로 → 1~2초 같은 사진을 바짝 당긴 컷 → 2~3초 핵심 숫자 카드
 *   (숫자가 기사에 없으면 다른 높이로 당긴 컷). 3초부터 원래 사진. 새 그림을 지어내지 않는다 — 같은 기사 사진과 기사 숫자만.
 * 숫자는 **헤드라인(원문)에서만** 뽑는다 — 대본이 쓴 숫자는 틀릴 수 있다.
 */
import { keyNumber, openingCuts, openingFilter, numberCardHtml } from './shorts-opening.mjs';
import { SHORTS } from './shorts-layout.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

// [1] 핵심 숫자 — 헤드라인에서 숫자+단위, 앞 낱말 둘을 이름표로
{
  const a = keyNumber(["AI 특수에 ICT 수출 703억달러…증가율 202% '역대 최고'"]);
  (a?.value === '703억달러' && a?.label === 'ICT 수출') ? ok(`[1] ${JSON.stringify(a)}`) : bad(`[1] ${JSON.stringify(a)}`);
  const b = keyNumber(['아워홈, 일본·호주 코스트코 뚫었다…올해 누적 수출 매출 13% 증가']);
  (b?.value === '13%' && b?.label === '수출 매출') ? ok(`[1b] ${JSON.stringify(b)}`) : bad(`[1b] ${JSON.stringify(b)}`);
  keyNumber(['국힘, 오늘 부산서 조작 기소 특검법 규탄 집회']) === null ? ok('[1c] 숫자 없는 헤드라인은 null') : bad('[1c]');
  // 날짜·차수·나이 같은 것은 '핵심 숫자' 가 아니다
  keyNumber(['11일 국무회의서 제32차 안건 의결']) === null ? ok('[1d] 날짜·차수는 고르지 않는다') : bad(`[1d] ${JSON.stringify(keyNumber(['11일 국무회의서 제32차 안건 의결']))}`);
  const e = keyNumber(['코스피 5,000선 붕괴…외국인 3조 순매도']);
  (e?.value === '5,000선' || e?.value === '3조') ? ok(`[1e] ${JSON.stringify(e)}`) : bad(`[1e] ${JSON.stringify(e)}`);
}

// [2] 컷 계획 — 3초 안에 바뀌는 지점이 2번 이상, 마지막은 3초에 원래 사진으로
{
  const c = openingCuts({ dur: 9.4, hasCard: true });
  const changes = c.filter((s) => s.from > 0 && s.from <= 3).length;
  (changes >= 2 && c.at(-1).kind === 'base' && c.at(-1).from === 3) ? ok(`[2] ${c.map((s) => `${s.from}-${s.to} ${s.kind}`).join(' · ')}`) : bad(`[2] ${JSON.stringify(c)}`);
  openingCuts({ dur: 9.4, hasCard: false }).some((s) => s.kind === 'card') ? bad('[2b] 숫자 없는데 카드') : ok('[2b] 숫자 없으면 카드 대신 다른 높이로 당긴 컷');
  const s = openingCuts({ dur: 2.4, hasCard: true });
  (s.every((x) => x.to <= 2.4) && s.filter((x) => x.from > 0).length >= 2) ? ok('[2c] 장면이 3초보다 짧으면 비율로 줄인다') : bad(`[2c] ${JSON.stringify(s)}`);
}

// [3] ffmpeg 필터 — 같은 입력을 나눠 당긴 컷을 시간 구간으로 얹는다. 카드는 입력 번호로.
{
  const f = openingFilter('0:v', 'v0', { cuts: openingCuts({ dur: 9.4, hasCard: true }), cardInput: 5 });
  (/split=2/.test(f) && /enable='between\(t,1\.00,2\.00\)'/.test(f) && /\[5:v\]/.test(f) && /enable='between\(t,2\.00,3\.00\)'/.test(f) && /\[v0\]$/.test(f))
    ? ok('[3] split·구간 overlay·카드 입력·출력 이름') : bad(`[3] ${f}`);
  const g = openingFilter('0:v', 'v0', { cuts: openingCuts({ dur: 9.4, hasCard: false }), motion: true });
  (/split=3/.test(g) && !/\[\d+:v\]overlay/.test(g.replace('[0:v]', '')) && /min\(t\/4/.test(g)) ? ok('[3b] 카드 없으면 카드 입력 안 씀 · push 움직임은 바탕 컷에 남는다') : bad(`[3b] ${g}`);
}

// [4] 숫자 카드 그림 — 사진 칸 안에만(위 띠·아래 자막 칸은 비움), 숫자·이름표가 그대로, 바탕 투명
{
  const h = numberCardHtml({ value: '703억달러', label: 'ICT 수출' });
  const top = Number((/\.card\{[^}]*top:(\d+)px/.exec(h) ?? [])[1]);
  const ht = Number((/\.card\{[^}]*height:(\d+)px/.exec(h) ?? [])[1]);
  (h.includes('703억달러') && h.includes('ICT 수출') && /background:transparent/.test(h)
    && top >= SHORTS.media.top && top + ht <= SHORTS.media.top + SHORTS.media.height)
    ? ok(`[4] 카드 ${top}~${top + ht}px (사진 칸 ${SHORTS.media.top}~${SHORTS.media.top + SHORTS.media.height})`) : bad(`[4] top=${top} h=${ht}`);
  numberCardHtml({ value: '<b>', label: '' }).includes('<b>') ? bad('[4b] 글자를 이스케이프 안 함') : ok('[4b] 글자 이스케이프');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
