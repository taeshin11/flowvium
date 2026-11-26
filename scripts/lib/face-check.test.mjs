#!/usr/bin/env node
/**
 * face-check.test.mjs — 자막이 가리키는 사람과 다른 사람의 얼굴을 그 장면에 깔지 않는다. 2026-09-29 신설.
 *
 * 9/29 01:54 예비: 자막 「박윤주 1차관 초치」 아래 **젤렌스키** 사진(hani 기사 og:image — 기사 제목엔 둘 다 없다).
 *   시청자는 화면의 얼굴을 자막의 사람으로 읽는다. CLIP 관문은 "주제" 만 봐서 통과시켰다.
 * 규칙: 사진에 얼굴이 있고, 장면 훅의 **첫 말(주어)** 이 그 사진을 낸 기사 제목에 없으면 쓰지 않는다.
 *   얼굴이 없는 사진(건물·현장)은 상관없다. 얼굴 수는 macOS Vision(VNDetectFaceRectanglesRequest)으로 센다.
 *   실측(이 예비의 프레임): 젤렌스키 1 · 외교부 청사 0 · 외교부 현판 0 · 한경 카드 0 · AISVI 카드 인물 1.
 */
import { personMismatch, faceCount, personLeads } from './face-check.mjs';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const hani = '외교부, 주한우크라 대사대리 초치…“북 포로 한국행 공개·허위공보 강력 유감”';
const cases = [
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: 1, isPerson: true }, true, '얼굴 있고 주어(박윤주)가 기사 제목에 없음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: 0, isPerson: true }, false, '얼굴 없는 사진'],
  [{ hook: '대사대리 전격 초치', sourceTitle: hani, faces: 1, isPerson: true }, false, '주어(대사대리)가 제목에 있음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: '박윤주 외교부 1차관, 우크라 대사대리 불러', faces: 2, isPerson: true }, false, '주어가 제목에 있음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: null, faces: 1, isPerson: true }, false, '출처 제목 모름 → 막지 않음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: null, isPerson: true }, false, '얼굴 수 모름 → 막지 않음'],
];
const got = cases.map(([a]) => personMismatch(a));
cases.every(([, want], i) => got[i] === want) ? ok(`[1] ${cases.map(([, w, d]) => `${d}→${w}`).join(' · ')}`) : bad(`[1] ${JSON.stringify(got)}`);
// [2] 실제 얼굴 세기(Vision) — 사람 없는 그림 0. 도구가 없으면 null(막지 않음)
{
  const w = mkdtempSync(join(tmpdir(), 'face-test-'));
  const img = join(w, 'flat.jpg');
  spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3366aa:s=400x600', '-frames:v', '1', img]);
  const n = faceCount(img);
  (n === 0 || n === null) ? ok(`[2] 단색 그림 얼굴 ${n}`) : bad(`[2] ${n}`);
  const miss = faceCount(join(w, 'none.jpg'));
  miss === null ? ok('[2b] 없는 파일 → null') : bad(`[2b] ${miss}`);
}
// [3] make-shorts 가 CLIP 뒤에 이 검사를 건다(소스)
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/personMismatch\(/.test(src) && src.indexOf('personMismatch(') > src.indexOf('CLIP 검사 ${verdict.length}장 중'))
    ? ok('[3] make-shorts: CLIP 관문 뒤에 얼굴·주어 검사') : bad('[3] make-shorts 에 얼굴·주어 검사가 없다');
}
// [4] 9/30 실측: 첫 말 규칙이 사람 이름이 아닌 말로도 사진을 뺐다 — "부동산" "당정협의" "긴밀한" "선정된" "특수목적법인"
//   (진짜 사람은 "김여정" 하나). 예비 3번이 회색 카드로 거절됐다. → **첫 말이 사람 이름일 때만** 이 규칙을 건다.
//   사람 이름인지는 agy 에 한 번 묻는다(부동산·선정된 도 흔한 성씨로 시작해 성씨 목록으로는 못 가른다). 못 물으면 null → 막지 않는다.
{
  const hooks = ['부동산 대책 발표', '김여정 담화', '선정된 기업들', '특수목적법인 설립'];
  const fake = async (p) => { if (!/김여정/.test(p) || !/부동산/.test(p)) return null; return JSON.stringify({ p: { 0: false, 1: true, 2: false, 3: false } }); };
  const leads = await personLeads(hooks, { call: fake });
  (JSON.stringify(leads) === '[false,true,false,false]') ? ok('[4] 사람 이름인 첫 말만 참(김여정)') : bad(`[4] ${JSON.stringify(leads)}`);
  const hani = '외교부, 주한우크라 대사대리 초치';
  (!personMismatch({ hook: '부동산 대책 발표', sourceTitle: hani, faces: 1, isPerson: false })
    && personMismatch({ hook: '김여정 담화', sourceTitle: hani, faces: 1, isPerson: true })
    && !personMismatch({ hook: '김여정 담화', sourceTitle: hani, faces: 1, isPerson: null }))
    ? ok('[4b] 사람이 아니면·모르면 빼지 않는다, 사람이면 뺀다') : bad('[4b]');
  const broken = await personLeads(hooks, { call: async () => 'not json' });
  (broken === null) ? ok('[4c] 답을 못 읽으면 null(막지 않는다)') : bad(`[4c] ${JSON.stringify(broken)}`);
}
{
  // [5] 빈 자리 채우기가 얼굴 검사를 되돌리면 안 된다 (2026-10-17 실측, IG 한동훈 편):
  //   3번 장면 「룰라 선물 논란」 에서 한동훈 사진을 '주어 룰라가 제목에 없다' 로 뺐는데, 채우기가 1번 장면의 한동훈 사진을 다시 넣었다.
  const M = await import('./face-check.mjs');
  if (typeof M.donorAllowed !== 'function') bad('[5] donorAllowed 가 없다');
  else {
    const han = { faces: 1, sourceTitle: '한동훈 (Han Dong-hoon) — Han 2022.jpg' };
    const flag = { faces: 0, sourceTitle: 'Flag of Brazil.svg' };
    !M.donorAllowed({ faceSubject: '룰라' }, han) ? ok('[5] 주어가 다른 사람인 자리에 다른 얼굴 사진을 채우지 않는다') : bad('[5] 룰라 자리에 한동훈 얼굴을 채웠다');
    M.donorAllowed({ faceSubject: '룰라' }, flag) ? ok('[5] 얼굴 없는 사진은 채워도 된다') : bad('[5] 얼굴 없는 사진도 막았다');
    M.donorAllowed({ faceSubject: '한동훈' }, han) && M.donorAllowed({}, han) ? ok('[5] 같은 사람이거나 얼굴 검사로 빠진 자리가 아니면 채운다') : bad('[5] 정상 채우기를 막았다');
  }
}
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  // 2026-10-17: 채우기는 lib/face-check fillMediaGaps 로 옮겼다 — 거기서 donorAllowed 를 거치는지 본다.
  const lib = readFileSync(new URL('./face-check.mjs', import.meta.url), 'utf8');
  /fillMediaGaps\(scenes\)/.test(src) && /good\.find\(\(g\) => [^\n]*donorAllowed\(x, g\)/.test(lib) && /x\.faceSubject = /.test(src)
    ? ok('[5] make-shorts 의 빈 자리 채우기가 donorAllowed 를 거친다') : bad('[5] make-shorts 빈 자리 채우기가 얼굴 검사를 무시한다');
}
{ // [6] 2026-10-17 훅 첫 말에 조사가 붙은 주어("장동혁의"·"한동훈은") — 조사 뗀 이름이 제목에 **낱말로** 있으면 같은 사람.
  //   IG 릴스 렌더에서 「장동혁의 …」 장면의 장동혁 사진이 "장동혁의" 가 제목에 없다고 빠질 뻔했다.
  //   낱말 경계로만 본다 — "박지은" 의 '은' 을 떼어 "박지원" 제목과 맞추면 안 된다.
  const t = '장동혁 (Jang Dong-hyuk) — Jang Dong-hyuk 2024.jpg';
  (!personMismatch({ hook: '장동혁의 반격', sourceTitle: t, faces: 1, isPerson: true })
    && !personMismatch({ hook: '한동훈은 왜', sourceTitle: '한동훈, 국감서 발언', faces: 1, isPerson: true }))
    ? ok('[6] 조사 붙은 주어도 같은 사람으로 본다(장동혁의·한동훈은)') : bad('[6] 조사 때문에 같은 사람 사진을 뺀다');
  (personMismatch({ hook: '박지은 첫 공판', sourceTitle: '박지원, 국정원 발언', faces: 1, isPerson: true })
    && personMismatch({ hook: '김민석의 사과', sourceTitle: '추미애 (Choo Mi-ae) — portrait.jpg', faces: 1, isPerson: true }))
    ? ok('[6] 조사를 떼도 다른 사람이면 뺀다(박지은≠박지원 · 김민석≠추미애)') : bad('[6] 다른 사람 사진을 통과시켰다');
}
{ // [7] leadName — 얼굴 검사가 요구할 바로 그 이름(훅 첫 말, 끝 조사 뗌). 인물 사진 찾기가 이걸 먼저 쓴다(10/17 릴스: properNounsFrom 은 "국무"·"국민의힘" 을 내고 이름을 놓쳤다).
  const M = await import('./face-check.mjs');
  const { readFileSync } = await import('fs');
  const { leadName } = M;
  (typeof leadName === 'function' && leadName('김민석의 사과') === '김민석' && leadName('장동혁 반발') === '장동혁' && leadName('박지은') === '박지은' && leadName('') === '')
    ? ok('[7] leadName: 김민석의→김민석 · 장동혁 · 박지은(이름 자체가 은으로 끝나면 3글자 유지)') : bad(`[7] ${typeof leadName === 'function' ? [leadName('김민석의 사과'), leadName('장동혁 반발'), leadName('박지은')] : '없음'}`);
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  const blk = ms.slice(ms.indexOf('권리 분명 모드의 인물 사진'), ms.indexOf('컷마다 유튜브 CC 영상'));
  (blk.indexOf('leadName(') > 0 && blk.indexOf('leadName(') < blk.indexOf('issue.keyword')) ? ok('[7] 인물 사진 이름 후보 첫째가 leadName(훅)') : bad('[7] make-shorts 인물 사진이 leadName 을 먼저 안 쓴다');
}
{ // [8] 빈 자리 채우기 — 한 자리에 줄 사진이 없다고 **멈추지 않는다**(2026-10-17 릴스: 2번(김민석 자리)에 줄 게 없어 break → 4번(추미애 자리)도 카드).
  const M = await import('./face-check.mjs');
  const A = { media: 'a.jpg', credit: 'cA', faces: 1, sourceTitle: '추미애 (Choo Mi-ae) — p.png' };
  const B = { media: null, faceSubject: '김민석' };
  const C = { media: 'c.jpg', credit: 'cC', faces: 1, sourceTitle: '장동혁 (Jang Dong-hyuk) — p.png' };
  const D = { media: null };
  const n = typeof M.fillMediaGaps === 'function' ? M.fillMediaGaps([A, B, C, D]) : -1;
  (n === 1 && B.media === null && D.media === 'a.jpg' && D.credit === 'cA')
    ? ok('[8] 김민석 자리는 비우고(다른 얼굴 금지) 다음 빈 자리는 채운다') : bad(`[8] n=${n} B=${B.media} D=${D.media}`);
  const E = { media: null }, F = { media: null }, G = { media: null };
  const n2 = M.fillMediaGaps?.([{ ...A }, E, F, G]);
  (n2 === 1) ? ok('[8] 한 사진은 두 번까지만(세 번째 자리부터는 카드)') : bad(`[8] 상한 n2=${n2}`);
  const { readFileSync } = await import('fs');
  /fillMediaGaps\(scenes\)/.test(readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8')) ? ok('[8] make-shorts 가 fillMediaGaps 를 쓴다') : bad('[8] make-shorts 연결 안 됨');
}
{ // [9] 한자 성씨 줄임 — 「韓총리」「李 "…"」「張 "…"」 는 그 사람이다(2026-11-26 사장님 화면: 「한성숙 총리 충청 행보」 첫 장면이 회색 카드로 나감, __1CTMT_Q28).
  //   video.log 실측: 얼굴 검사가 뺀 127건 중 한자 성씨 제목에서 뺀 이름 6명(이재명·한성숙·한동훈 등).
  const { personMismatch, donorAllowed } = await import('./face-check.mjs');
  const same = (hook, t) => personMismatch({ hook, sourceTitle: t, faces: 1, isPerson: true }) === false;
  (same('한성숙 총리 충청 행보', '[포토] 韓총리, 충청 기업인과 규제 간담회')
    && same('이재명 대통령 발언', '"대통령 혼자 딴 세상 사나" 李 \'집값 폭락 대비\'')
    && same('장동혁 반박', '한동훈 "조작 징계 당했다" vs 張 "맞다, 언론 조작 징계했다"')
    && same('윤석열 정상회담', '尹대통령, 오늘 조코위 인도네시아 대통령과 정상회담')
    && same('한성숙 총리 발언', '한 총리 &ldquo;수능 블루투스 기록 수사의뢰&hellip;스마트기기 판매자'))
    ? ok('[9] 韓총리=한성숙 · 李=이재명 · 張=장동혁 · 尹대통령=윤석열 · 한 총리=한성숙') : bad('[9] 한자 성씨 줄임을 다른 사람으로 봤다');
  // 다른 뜻의 한자(韓=한국)·다른 성씨는 여전히 뺀다
  (!same('한동훈 발언', '韓증시 저평가, 불합리…금융시장 정상화') && !same('한동훈 발언', '또 \'한일 경제 동맹\' 강조한 최태원…"韓日 AI 플랫폼"')
    && !same('한성숙 총리', '李 대통령 "증시 골 깊으면 산도 높다"')
    && !same('한동훈 발언', '대한 총리실 입장') && !same('한성숙 총리', '이 총리 "…"'))
    ? ok('[9] 韓증시·韓日(나라 이름)·다른 성씨(李≠한)는 그대로 뺀다') : bad('[9] 나라 이름 韓 이나 다른 성씨를 같은 사람으로 봤다');
  donorAllowed({ faceSubject: '한성숙' }, { faces: 1, sourceTitle: '韓총리 "규제 합리화 속도내야…지역 혁신으로 국가 성장"' })
    ? ok('[9] 빈 자리 채우기도 韓총리 사진을 한성숙 자리에 넣는다') : bad('[9] donorAllowed 가 韓총리 사진을 막았다');
}
{ // [10] 첫 장면이 회색 카드로 나가지 않는다(2026-11-26 __1CTMT_Q28: 소재 2/4 로 '절반' 관문은 넘었는데 빈 자리가 1번이었다).
  const M = await import('./face-check.mjs');
  const f = M.coverFirstScene;
  if (typeof f !== 'function') bad('[10] coverFirstScene 없음');
  else {
    // 1번이 비고, 3번 사진은 이미 두 번 쓰여 채우기가 못 줬다 → 3번 사진을 1번으로 옮기고 3번 자리는 다시 채운다
    const S = [{ media: null }, { media: 'b.jpg', credit: 'cB' }, { media: 'b.jpg', credit: 'cB' }, { media: 'd.jpg', credit: 'cD' }, { media: 'd.jpg', credit: 'cD' }, { isOutro: true, media: 'o.mp4' }];
    const r = f(S);
    (r === true && S[0].media && S.filter((x) => !x.isOutro && !x.media).length <= 1) ? ok('[10] 1번 빈 자리를 다른 장면 사진으로 덮는다') : bad(`[10] r=${r} first=${S[0].media}`);
    // 1번 자막 주어 사진이 없으면(다른 사람 얼굴뿐) 덮지 않고 false — 회차를 거른다
    const T = [{ media: null, faceSubject: '김민석' }, { media: 'a.jpg', faces: 1, sourceTitle: '추미애 "…"' }, { media: 'a.jpg', faces: 1, sourceTitle: '추미애 "…"' }];
    (f(T) === false && T[0].media === null) ? ok('[10] 다른 사람 얼굴로는 1번을 덮지 않는다(거른다)') : bad(`[10] T0=${T[0].media}`);
    const U = [{ isOutro: true, media: 'o.mp4' }, { media: 'x.jpg' }];
    (f(U) === true) ? ok('[10] 1번에 사진이 있으면 그대로') : bad('[10] 멀쩡한 회차를 막았다');
  }
  const { readFileSync } = await import('fs');
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/coverFirstScene\(scenes\)/.test(ms) && ms.indexOf('coverFirstScene(scenes)') > ms.indexOf('fillMediaGaps(scenes)'))
    ? ok('[10] make-shorts 가 채우기 뒤에 첫 장면을 확인한다') : bad('[10] make-shorts 연결 안 됨');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
