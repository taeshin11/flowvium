#!/usr/bin/env node
/**
 * clip-floor.test.mjs — CLIP 사진 관문의 판정식(scripts/tts/clip_match.py decide). 2026-10-13 신설.
 *
 * 왜: 미끼 softmax 만으로 판정하면 미끼 목록에 없는 종류의 사진은 소거법으로 통과한다.
 *   10/10 정기결제 편에 천안문 탱크 사진이 "주제 0.60 vs 미끼 0.16" 으로 나갔다(AVYDYnJYOHY, 평균 시청 20%).
 *   그래서 주제 문장과의 **절대 유사도(코사인) 하한**을 같이 건다.
 * 하한 0.16 은 잰 값이다(10/13, 게시 쇼츠 23편 첫 장면 사진 × 자기 헤드라인):
 *   자기 기사 0.166~0.348(최저 0.166 → 0/23 오탐) · 남의 기사와 짝지은 사진 0.091~0.257(9/23 잡음, 종전 관문은 13/23 통과) ·
 *   탱크 0.150(잡음) · 일본 내각 사진-권익위 0.174(못 잡음). 여유가 얇다 — 실제 거절 로그로 다시 잰다.
 * 2026-10-20 재측정(실제 거절 로그 10/13~): 하한**만**으로 걸린 사진은 1장 — 10/18 21:45 브리핑(WYtOA2WgZTI) 3번 장면
 *   젤렌스키 기사 사진(yna AKR20261018004300009, 기자회견 중인 젤렌스키 — 눈으로 확인, **맞는 사진**)이 주제 0.905·미끼 0.0701·유사도 0.1595 로
 *   걸려 그 뉴스가 화면에서 빠졌다(같은 수치 재현). 10/13~ 게시 56편 기사 사진(도표 2장 제외 54) × 자기 헤드라인 최저 0.1614,
 *   × 남의 헤드라인 162쌍 중 미끼 관문을 넘은 106쌍에서 하한이 더 잡는 것은 0.15~0.16 어디서나 **1쌍**(값을 내려도 잃는 것 없음).
 *   → 0.155: 탱크 0.150 은 여전히 잡고, 맞는 사진 최저 0.1595 는 통과. 여전히 얇다 — 남의 사진 106/162 가 미끼 관문을 넘는다(하한이 아닌 관문 설계의 한계).
 */
import { spawnSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { requires } from './test-env.mjs';

await requires({ paths: ['~/.flowvium-tools/qwen-tts-venv/bin/python'], macos: true });

const dir = fileURLToPath(new URL('../tts/', import.meta.url));
const py = process.env.CLIP_PYTHON || join(homedir(), '.flowvium-tools', 'qwen-tts-venv', 'bin', 'python');
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const decide = (args) => {
  const r = spawnSync(py, ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(dir)}); import clip_match as c; print(json.dumps([c.decide(*a) for a in ${JSON.stringify(args)}]), c.SIM_FLOOR)`], { encoding: 'utf8' });
  if (r.status !== 0) return { err: r.stderr.trim().split('\n').at(-1) };
  const [arr, floor] = r.stdout.trim().split(/\s(?=[\d.]+$)/);
  return { out: JSON.parse(arr), floor: Number(floor) };
};
// (topic, decoy, form, sim)
const r = decide([[0.5977, 0.1648, 0.0717, 0.150], [0.60, 0.16, 0.07, 0.166], [0.30, 0.40, 0.01, 0.30], [0.9, 0.05, 0.25, 0.30], [0.905, 0.0701, 0.0159, 0.1595]]);
if (r.err) bad(`[0] decide 를 부를 수 없다: ${r.err}`);
else {
  r.floor === 0.155 ? ok(`[1] 하한 ${r.floor}(10/20 재측정 값)`) : bad(`[1] 하한 ${r.floor}`);
  r.out[0] === false ? ok('[2] 탱크(주제가 미끼를 이겨도 유사도 0.150) → 거른다') : bad(`[2] ${r.out[0]}`);
  r.out[1] === true ? ok('[3] 자기 기사 최저값 0.166 → 통과') : bad(`[3] ${r.out[1]}`);
  r.out[2] === false ? ok('[4] 미끼가 이기면 종전대로 거른다') : bad(`[4] ${r.out[2]}`);
  r.out[3] === false ? ok('[5] 배너로 보이면 종전대로 거른다') : bad(`[5] ${r.out[3]}`);
  r.out[4] === true ? ok('[6] 10/18 젤렌스키 기사 사진(맞는 사진, 유사도 0.1595) → 통과') : bad(`[6] 맞는 사진을 거른다: ${r.out[4]}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
