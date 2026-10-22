#!/usr/bin/env node
/**
 * face-opener.test.mjs — 쇼츠 첫 화면에 얼굴을 둔다(한 이슈 편). 2026-10-22 신설(KPI 2차, Mac mini2 사장님 지시).
 * 근거(쇼츠 100편, 첫 화면 0.4초 프레임을 macOS Vision 으로 셈 · scratchpad kpi2/all):
 *   얼굴 있음 64편: 본 비율 중앙 0.49~0.50, 20시간 500회 미만(실패) 1/64
 *   얼굴 없음 36편: 본 비율 중앙 0.33, 실패 6/36
 *   주제 안에서도 같다 — 국내정치 0.508 대 0.358, 증시 0.364 대 0.184. 얼굴 크기는 있고 없고 이상으로 갈리지 않았다.
 *   눈검증: 정상 6편 첫 화면은 6/6 얼굴 클로즈업, 실패 6편은 0/6(건물·간판·회의실). agy argon(그림 첨부)도 '얼굴 없음'을 1순위로 꼽았다.
 * 규칙: 첫 장면 사진에 얼굴이 없고(0 — 모르면 안 바꾼다) 뒤 장면에 얼굴 사진이 있으면 그림만 바꾼다(대본 순서는 그대로).
 *   - 브리핑은 바꾸지 않는다 — 장면이 곧 뉴스 하나라 통째로 옮기면 질문형 첫 문장이 뒤로 간다.
 *   - 도표(0.3 이상)는 후보가 아니다.
 *   - 다른 사람 얼굴을 첫 화면에 올리지 않는다: 첫 장면 자막의 첫 말을 사람 이름으로 **가정**하고
 *     그 사진을 낸 기사 제목에 그 이름이 없으면 후보에서 뺀다(face-check personMismatch 를 isPerson=true 로 — 더 엄한 쪽).
 *   - 2026-10-22 Mac mini2(같은 날 트롯픽에 다른 사람 사진이 나가 비공개): 첫 자막의 첫 말이 **사람 이름으로 판정된 때만**
 *     (personLeads → firstIsPerson === true) 바꾼다. 모르거나 사람이 아니거나 한 글자 말("왜")이면 지금처럼 그대로 낸다.
 *   - 새 사진을 들이지 않는다 — 이미 그 편에 실린(검사를 통과한) 사진끼리만 자리를 바꾼다.
 */
import { readFileSync } from 'fs';
import { faceOpenerIndex } from './face-opener.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const sc = (hook, media, sourceTitle) => ({ hook, media, sourceTitle });
const faces = (m) => (k) => m[k];
{
  const s = [sc('한동훈 사퇴 압박 커지나', 'bldg.jpg', '한동훈 사퇴론'), sc('당내 반발', 'x.jpg', '한동훈 사퇴론 확산'), sc('끝', null)];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 1]), firstIsPerson: true });
  r === 1 ? ok('[1] 첫 화면 얼굴 0 → 같은 사람 기사 얼굴 사진(1번)과 바꾼다') : bad(`[1] ${r}`);
}
{
  const s = [sc('한동훈 사퇴', 'a.jpg', 't'), sc('b', 'b.jpg', '한동훈')];
  const r = faceOpenerIndex(s, { facesAt: faces([2, 1]) });
  r === -1 ? ok('[2] 첫 화면에 이미 얼굴 → 그대로') : bad(`[2] ${r}`);
}
{
  const s = [sc('한동훈 사퇴', 'a.jpg', 't'), sc('b', 'b.jpg', '한동훈')];
  const r = faceOpenerIndex(s, { facesAt: faces([null, 1]) });
  r === -1 ? ok('[3] 첫 화면 얼굴 수를 모름(null) → 바꾸지 않는다') : bad(`[3] ${r}`);
}
{
  const s = [sc('한동훈 사퇴', 'a.jpg', '한동훈'), sc('b', 'b.jpg', '젤렌스키 방한'), sc('c', 'c.jpg', '한동훈 기자회견')];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 1, 1]), firstIsPerson: true });
  r === 2 ? ok('[4] 첫 자막의 이름이 없는 기사의 얼굴(젤렌스키)은 건너뛰고 2번') : bad(`[4] ${r}`);
}
{
  const s = [sc('a', 'a.jpg', 't'), sc('b', 'b.jpg', 'a')];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 1]), brief: true });
  r === -1 ? ok('[5] 브리핑은 바꾸지 않는다') : bad(`[5] ${r}`);
}
{
  const s = [sc('한동훈 사퇴', 'a.jpg', 't'), sc('b', 'b.jpg', '한동훈 기자회견')];
  const a = faceOpenerIndex(s, { facesAt: faces([0, 1]), firstIsPerson: null });
  const b = faceOpenerIndex(s, { facesAt: faces([0, 1]), firstIsPerson: false });
  (a === -1 && b === -1) ? ok('[9] 첫 말이 사람 이름인지 모르거나(null) 아니면(false) 바꾸지 않는다') : bad(`[9] ${a} ${b}`);
}
{
  const s = [sc('왜 사퇴했나', 'a.jpg', 't'), sc('b', 'b.jpg', '한동훈 기자회견')];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 1]), firstIsPerson: true });
  r === -1 ? ok('[10] 첫 말이 한 글자("왜") — 이름 대조를 못 하니 바꾸지 않는다') : bad(`[10] ${r}`);
}
{
  const s = [sc('이창용 동결', 'a.jpg', 't'), sc('b', 'chart.jpg', '이창용 그래프'), sc('c', 'c.jpg', '이창용 총재 회견')];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 1, 1]), chartAt: (k) => [0, 0.9, 0.1][k], firstIsPerson: true });
  r === 2 ? ok('[6] 도표 후보는 건너뛴다') : bad(`[6] ${r}`);
}
{
  const s = [sc('a', 'a.jpg', 't'), { isOutro: true, media: 'o.jpg' }];
  const r = faceOpenerIndex(s, { facesAt: faces([0, 3]) });
  r === -1 ? ok('[7] 끝 장면(outro)은 후보가 아니다') : bad(`[7] ${r}`);
}
{
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  /faceOpenerIndex\(/.test(ms) ? ok('[8] make-shorts 가 첫 화면 얼굴 규칙을 부른다') : bad('[8] make-shorts 에 연결 안 됨');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
