#!/usr/bin/env node
/**
 * pin-comment.test.mjs — 업로드 직후 홍보 댓글을 달고 바로 확인하는가. 2026-10-08 신설.
 *
 * 사장님 "aisviagent.com 광고를 쿠팡파트너스 링크 달듯이 댓글에" + "영상 업로드 후 댓글 달렸는지 바로바로 체크하는걸 원칙으로".
 * Mac mini2 공지(사장님 원칙): 공개 직후 시청자 화면에서 ①고정 댓글이 보이는지 ②작성자가 그 채널인지 ③고정됐는지,
 *   링크 댓글은 스팸 필터로 사라질 수 있어 10분 뒤 다시 확인.
 * → 업로드 직후 yt-pin-comment 를 띄운다: 로그인 상태로 달기·고정·되읽기(①②③) 후 10분 뒤 **로그아웃 브라우저**로 다시 본다
 *   (주인 화면에는 걸러진 댓글도 보일 수 있다 — 시청자 화면이 기준).
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pub = src('video-publish.mjs');
(/yt-pin-comment\.mjs/.test(pub) && /--then-verify/.test(pub)) ? ok('[1] 쇼츠 발행 직후 댓글 달기 + 10분 뒤 재확인을 띄운다') : bad('[1] video-publish 가 댓글 단계를 안 띄운다');
const rd = src('video/make-daily-roundup.mjs');
(/yt-pin-comment\.mjs/.test(rd) && /--then-verify/.test(rd) && /'long'/.test(rd)) ? ok('[2] 총정리 롱폼 업로드 직후에도(링크 눌리는 utm 판)') : bad('[2] 총정리에 댓글 단계 없음');
const pc = src('yt-pin-comment.mjs');
(/then-verify/.test(pc) && /chromium\.launch\(/.test(pc) && /@flowvium/.test(pc) && /offsetWidth \|\| b\.offsetHeight/.test(pc)) ? ok('[3] 재확인은 로그아웃 브라우저 · 작성자 @flowvium · 고정 표시가 보이는지') : bad('[3] 재확인 조건 부족');
// 2026-10-13 사장님 지시(Mac mini2 경유, "광고 시간 최소화"): AISVI 광고는 한 줄로만 —
//   "무료 AI 비서 AISVI, aisviagent.com, 가입 없이 바로 무료 체험". 고정댓글·설명란·끝 카드 모두 같은 말. 새 편부터.
const { AD_LINE, withAdLine } = await import('./ad-line.mjs');
const { uploadRequestBody } = await import('./youtube.mjs');
(AD_LINE === '무료 AI 비서 AISVI, aisviagent.com, 가입 없이 바로 무료 체험') ? ok('[4] 광고 한 줄은 지시 그대로') : bad(`[4] AD_LINE ${AD_LINE}`);
(/import \{ AD_LINE \} from '\.\/lib\/ad-line\.mjs'/.test(pc) && /commentFor = \(\) => AD_LINE/.test(pc)) ? ok('[5] 고정댓글(쇼츠·롱폼) = 그 한 줄') : bad('[5] 고정댓글이 그 한 줄이 아니다');
const lastLine = (x) => x.trimEnd().split('\n').at(-1);
const d = uploadRequestBody({ title: 't', description: '본문\n\n※ 투자 권유 아님' }).snippet.description;
(lastLine(d) === AD_LINE && d.startsWith('본문')) ? ok('[6] 모든 업로드 설명란 맨 아래 그 한 줄(기존 고지 아래)') : bad(`[6] ${JSON.stringify(d)}`);
(withAdLine(d) === d) ? ok('[7] 두 번 붙이지 않는다') : bad('[7] 중복');
const lg = withAdLine('가'.repeat(6000));
(lg.length <= 5000 && lastLine(lg) === AD_LINE) ? ok('[8] 5000자 한도 — 본문을 줄이고 광고 줄은 남긴다') : bad(`[8] ${lg.length}`);
const oc = src('video/make-outro-clip.mjs');
const koCopy = /\n  ko: \{[\s\S]*?\n  \},/.exec(oc)?.[0] ?? '';
(/cardLines: AD_LINE\.split\(', '\)/.test(koCopy) && /import \{ AD_LINE \} from '\.\.\/lib\/ad-line\.mjs'/.test(oc))
  ? ok('[9] aisvi 2초 카드 화면 글자 = 그 한 줄의 세 토막') : bad('[9] 카드 글자가 세 줄이 아니다');
(/CARD && T\.cardLines \? T\.cardLines\.map/.test(oc) && /CARD && T\.cardLines \? '' : /.test(oc)) ? ok('[10] 카드에는 세 줄 말고 다른 문구(초록 띠·구독 줄·다운로드)가 없다') : bad('[10] 카드에 다른 문구가 남는다');
(/cardSay: '에이스비 에이전트 닷컴, 가입 없이 무료 체험'/.test(koCopy) && /CARD \? \(process\.env\.AISVI_SITE_SPOKEN \|\| T\.cardSay/.test(oc) && !/cardSay[^\n]*구독/.test(koCopy))
  ? ok('[11] 카드 대사 = 공식 카드와 같은 말(구독 줄 없음)') : bad('[11] 카드 대사');
// 2026-10-19 Mac mini2(사장님) 점검: AvHbcWuXvJQ 가 고정 댓글 없이 사흘. 10/16 달기가 시간초과로 실패 →
//   10분 뒤 재확인이 state 에 {verifiedAt, visibleToViewers:false} 를 적었고, 달기 쪽은 'state 에 있으면 끝난 편' 으로 봐
//   다시는 안 골랐다. 재확인의 실패 사진도 shots 가 달기 블록 안에만 있어 ReferenceError 로 죽었다. 다시 거는 정기 쓸기도 없었다.
const { needsPin, MAX_PIN_TRIES } = await import('./pin-state.mjs');
(needsPin(undefined) && needsPin({ verifiedAt: 'x', visibleToViewers: false, pinnedToViewers: false })) ? ok('[12a] 재확인 기록만 있는 편(단 적 없음)은 다시 단다') : bad('[12a]');
(!needsPin({ at: 'x', kind: 'short', verifiedAt: 'y', visibleToViewers: true, pinnedToViewers: true }) && !needsPin({ at: 'x', kind: 'short' })) ? ok('[12b] 달고 고정한 편은 건너뛴다') : bad('[12b]');
(needsPin({ at: 'x', visibleToViewers: false, pinnedToViewers: false }) && needsPin({ at: 'x', visibleToViewers: true, pinnedToViewers: false })) ? ok('[12c] 시청자 화면에서 안 보이거나 고정 표시 없으면 다시') : bad('[12c]');
(!needsPin({ verifiedAt: 'x', failedTries: MAX_PIN_TRIES })) ? ok(`[12d] ${MAX_PIN_TRIES}번 실패하면 멈추고 사람에게 남긴다(매일 같은 실패를 되풀이하지 않는다)`) : bad('[12d]');
(/needsPin\(state\[t\.id\]\)/.test(pc) && !/!state\[t\.id\]\)/.test(pc)) ? ok('[13] 달기 대상 고르기가 needsPin 으로') : bad('[13] 아직 "state 에 있으면 끝" 으로 고른다');
(/^const shots = /m.test(pc)) ? ok('[14] 실패 사진 폴더가 맨 위에 — 재확인 단독(--verify-only·--then-verify)에서도 쓸 수 있다') : bad('[14] shots 가 달기 블록 안에만 있다');
(/failedTries/.test(pc)) ? ok('[15] 달기 실패를 원장에 센다') : bad('[15]');
const cr = src('cron-runner.mjs');
(/label: 'pin-sweep',\s+script: 'scripts\/yt-pin-comment\.mjs --recent 336 --then-verify 600'/.test(cr)) ? ok('[16] 매일 최근 14일 빠진 편을 다시 거는 쓸기') : bad('[16] 다시 거는 정기 쓸기가 없다');
// [17] 2026-10-19: 매일 쓸기와 손 실행(또는 발행 직후 달기·10분 뒤 재확인)이 겹치면 각자 처음 읽은 원장 전체를 덮어써
//   서로의 기록을 지웠다(실측 18:00~18:21 두 실행이 같은 파일). 한 편씩, 쓰기 직전에 다시 읽고 합친다.
{
  const { writeEntry } = await import('./pin-state.mjs');
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const { join: pj } = await import('node:path'); const { tmpdir: td } = await import('node:os');
  const f = pj(mkdtempSync(pj(td(), 'pin-state-')), 'yt-pinned.json');
  wf(f, JSON.stringify({ a: { at: '1' } }));
  writeEntry(f, 'b', () => ({ at: '2' }));                                   // 다른 실행
  writeEntry(f, 'c', (prev) => ({ ...prev, verifiedAt: '3' }));             // 이 실행 — 처음 읽은 것엔 b 가 없었다
  writeEntry(f, 'b', (prev) => ({ ...prev, visibleToViewers: true }));
  const j = JSON.parse(rf(f, 'utf8'));
  (j.a?.at === '1' && j.b?.at === '2' && j.b?.visibleToViewers === true && j.c?.verifiedAt === '3') ? ok('[17a] 겹친 실행이 서로의 기록을 지우지 않는다') : bad(`[17a] ${JSON.stringify(j)}`);
  (!/writeFileSync\(STATE/.test(pc) && /writeEntry\(STATE/.test(pc)) ? ok('[17b] yt-pin-comment 의 원장 쓰기가 전부 writeEntry') : bad('[17b] 원장 전체를 덮어쓰는 곳이 남았다');
}
// [18] 접힌 댓글에서 링크가 보여야 한다 — 10/19 사장님(차꾸 22편: 링크가 7번째 줄이라 '더보기' 전엔 안 보임).
//   폰 폭 접힌 보기는 첫 ~3줄. 우리 댓글은 한 줄이고 링크가 그 안에 있어야 한다(한 줄 ~70자 넘으면 접힘 줄을 더 먹는다).
//   10/19 22:5x 로그아웃 iPhone 13 폭 실측: 이 한 줄이 2줄로 그려지고 링크는 1번째 줄.
(!/\n/.test(AD_LINE) && [...AD_LINE].length <= 70 && /aisviagent\.com/.test(AD_LINE) && /commentFor = \(\) => AD_LINE/.test(pc))
  ? ok(`[18] 고정 댓글은 한 줄(${[...AD_LINE].length}자)이고 링크가 그 안 — 접힌 보기에서 보인다`) : bad(`[18] 댓글이 길거나 링크가 밖: ${JSON.stringify(AD_LINE)}`);
// [19] 2026-10-20 코드 점검(Claude·ChatGPT REAL): '이미 고정됨' 갈래가 원장 칸을 통째로 바꿔 failedTries 를 지웠다.
//   주인 화면엔 고정돼 보이고 시청자 화면엔 안 보이는(스팸 필터) 편은 매일 '이미 있음' → 칸 초기화 → 10분 뒤 false → 다음날 또.
//   3회 상한이 영영 안 걸린다. 시청자 화면에서 안 보이면 실패 1회로 세고, '이미 있음' 은 그 수를 지우지 않는다.
{
  const P = await import('./pin-state.mjs');
  let e = { at: 't0', verifiedAt: 'v', visibleToViewers: false, pinnedToViewers: false };   // 주인 화면엔 고정, 시청자 화면엔 없음
  for (let day = 0; day < 4 && P.needsPin(e); day++) {
    e = P.alreadyEntry?.(e, `d${day}`, 'short') ?? { at: `d${day}`, kind: 'short', skipped: 'already' };
    e = P.verifiedEntry?.(e, { mine: false, pinned: false }, `v${day}`) ?? { ...e, verifiedAt: `v${day}`, visibleToViewers: false, pinnedToViewers: false };
  }
  (!P.needsPin(e) && e.failedTries === P.MAX_PIN_TRIES) ? ok(`[19a] 시청자에게 안 보이는 편은 ${P.MAX_PIN_TRIES}번 뒤 멈춘다(사람에게)`) : bad(`[19a] 매일 다시 단다: ${JSON.stringify(e)}`);
  const v = P.verifiedEntry?.({ at: 'a', failedTries: 1 }, { mine: true, pinned: true }, 'v');
  (v?.visibleToViewers === true && v?.failedTries === 1) ? ok('[19b] 보이면 실패 수를 안 올린다') : bad(`[19b] ${JSON.stringify(v)}`);
  (/alreadyEntry\(prev, /.test(pc) && /verifiedEntry\(prev, r, /.test(pc)) ? ok('[19c] yt-pin-comment 가 두 함수를 쓴다') : bad('[19c] yt-pin-comment 미연결');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
