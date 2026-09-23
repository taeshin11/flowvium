#!/usr/bin/env node
/**
 * kr-flow-corrector-reach.test.mjs — 교정기가 **실제로 불리는가.** 2026-09-23 신설.
 *
 * 오늘의 사고: afternoon 회차가 실측 "외국인 794억 순매도" 인데
 *   thesis 에 "원화 강세가 외국인 자금 유입을 촉진하는 긍정적 요인으로 작용했다" 를 발간했다.
 *   verify-report 는 잡았지만(발간 뒤 push 가 막혀서 알았다) 교정기는 안 돌았다.
 *
 * 원인은 교정기가 아니라 **그 앞의 관문**이었다:
 *   generate-report-local.mjs `if (_krClaim) { fixKrFlowContradiction(...) }`
 *   2026-09-10 에 "claim 이 없으면 regionStances.korea.thesis 로 떨어진다" 는 폴백을
 *   함수 **안에** 넣었는데, 호출부는 여전히 claim 이 있을 때만 부른다.
 *   그래서 그 폴백은 만든 날부터 **죽은 코드**였다. 함수는 고치고 관문은 안 고친 것이다.
 *
 * 그래서 이 테스트는 함수만 보지 않는다. **호출부가 막지 않는지**도 본다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fixKrFlowContradiction } from './narrative-fix.mjs';
import { ROOT } from './project-root.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// 오늘 실제로 발간된 모양 — claim 은 없고, 실측은 regionStances 에만 있다
const shaped = () => ({
  thesis: '오늘 시장은 기술주 중심의 강세가 두드러졌으며, 특히 한국에서는 원화 강세(USD/KRW 1353)가 외국인 자금 유입을 촉진하는 긍정적 요인으로 작용했다. 돈의 흐름을 보면 에너지에서 기술주로 이동하는 조짐이 보인다.',
  macroAnalysis: '',
  marketNarrative: {},
  regionStances: { korea: { thesis: '달러 환산 EWY가 1주 만에 9.1% 급등했으나, 794억 원의 외국인 순매도는 단기 수급 부담 요인으로 작용합니다.' } },
});

// [1] 교정기 자체는 claim 없이도 고친다 — 함수는 멀쩡하다
{
  const r = shaped();
  const { nFix, log } = fixKrFlowContradiction(r, '');
  nFix > 0 && !/외국인 자금 유입/.test(r.thesis)
    ? ok(`[1] claim 없이도 교정한다 (${log.join(',')})`) : bad(`[1] nFix=${nFix} thesis=${r.thesis.slice(0, 60)}`);
}

// [2] ★ 호출부가 claim 유무로 막지 않는가 — **오늘의 진짜 결함은 여기였다.**
//     함수를 고쳐도 앞에서 막으면 고친 적이 없는 것과 같다.
{
  // 2026-09-23: 처음엔 generate-report-local.mjs 만 봤다. 고치고 나서 발간본 교정을 돌렸더니
  //   **patch-narrative.mjs 에도 똑같은 관문**이 있어 거기서도 건너뛰었다.
  //   부르는 곳을 전부 본다 — 한 곳만 고치면 다른 경로로 그대로 샌다.
  const callers = ['scripts/generate-report-local.mjs', 'scripts/patch-narrative.mjs'];
  const gatedFiles = [];
  for (const f of callers) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    let from = 0;
    while (true) {
      const i = src.indexOf('fixKrFlowContradiction(', from);
      if (i < 0) break;
      from = i + 1;
      if (/^import|from '/.test(src.slice(Math.max(0, i - 200), i).split('\n').pop() ?? '')) continue;
      // 구조분해(`const { nFix } = …`)에 중괄호가 들어 있어 "여는 { 이후 } 없음" 으로는 못 본다.
      //   호출 바로 앞에서 claim 유무를 묻는 if / 삼항이 있는지만 본다 — 그게 이 결함의 모양이다.
      const before = src.slice(Math.max(0, i - 300), i);
      if (/(if\s*\(\s*_?krClaim\s*\)|_krClaim\s*\?)\s*$|(if\s*\(\s*_?krClaim\s*\)|_krClaim\s*\?)[^;]{0,120}$/.test(before)) gatedFiles.push(f);
    }
  }
  gatedFiles.length === 0
    ? ok(`[2] 부르는 ${callers.length}곳 모두 claim 유무로 막지 않는다`)
    : bad(`[2] claim 이 있을 때만 부르는 곳: ${[...new Set(gatedFiles)].join(', ')} — 함수 안 폴백이 죽은 코드가 된다`);
}

// [3] 실측이 순매수면 반대 방향 서술을 고친다 — 한쪽만 고치면 다른 쪽이 샌다
{
  const r = shaped();
  r.regionStances.korea.thesis = '외국인이 1조 2,000억 원 순매수하며 수급이 개선되고 있습니다.';
  r.thesis = '외국인 매도세가 지속되며 지수에 부담을 주고 있다. 기술주는 강세를 보였다.';
  const { nFix } = fixKrFlowContradiction(r, '');
  nFix > 0 && !/매도세가 지속/.test(r.thesis)
    ? ok('[3] 순매수 쪽도 고친다') : bad(`[3] nFix=${nFix} ${r.thesis.slice(0, 50)}`);
}

// [4] 모순이 없으면 건드리지 않는다 — 교정기가 멀쩡한 문장을 지우면 더 나쁘다
{
  const r = shaped();
  r.thesis = '기술주가 강세를 보였고, 외국인은 794억 원을 순매도했다.';
  const before = r.thesis;
  fixKrFlowContradiction(r, '');
  r.thesis === before ? ok('[4] 일치하는 서술은 보존') : bad(`[4] 멀쩡한 문장을 바꿨다: ${r.thesis}`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
