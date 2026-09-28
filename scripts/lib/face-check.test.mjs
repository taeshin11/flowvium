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
import { personMismatch, faceCount } from './face-check.mjs';
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
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: 1 }, true, '얼굴 있고 주어(박윤주)가 기사 제목에 없음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: 0 }, false, '얼굴 없는 사진'],
  [{ hook: '대사대리 전격 초치', sourceTitle: hani, faces: 1 }, false, '주어(대사대리)가 제목에 있음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: '박윤주 외교부 1차관, 우크라 대사대리 불러', faces: 2 }, false, '주어가 제목에 있음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: null, faces: 1 }, false, '출처 제목 모름 → 막지 않음'],
  [{ hook: '박윤주 1차관 초치', sourceTitle: hani, faces: null }, false, '얼굴 수 모름 → 막지 않음'],
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
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
