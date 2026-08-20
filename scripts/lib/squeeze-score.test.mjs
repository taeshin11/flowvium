#!/usr/bin/env node
/**
 * squeeze-score.test.mjs — 숏스퀴즈 점수가 실데이터에서 계산되는지 검증.
 *
 * 배경(2026-08-20 실측):
 *   · 점수를 LLM 이 지어낸다. generate-report-local.mjs:6221 의 프롬프트 스키마에
 *     `{"shortSqueeze":[{"ticker":"[TICKER]","score":0,...}]}` 로 score 가 들어 있고,
 *     :2467 이 그 출력을 squeezeMap 으로 만들어 :5329 에서 매수룰 ctx.squeezeScore 로 먹인다.
 *   · 결과: 아카이브 546건의 고유 점수값이 9개뿐이고 45점이 296건(54%). 실측 분포가 아니다.
 *   · 매수룰 micro_squeeze_score 임계 50 vs LLM 이 45 근처를 찍음 → 전체 이력 발화 0건.
 *     룰이 죽어 있는데 표시 섹션은 88%가 임계 미달인 후보를 계속 노출했다.
 *   · 임계값만 내리면 그건 하드코딩이고 근본이 아니다. 점수를 실데이터로 계산해야 한다.
 *
 * 선행연구(Tapeboard/Fintel 계열): 숏비중(%float)·차입수수료·유동주식 활용률·일간 숏볼륨비율·
 *   days to cover·5일 모멘텀·차입수수료 변화의 가중합, 0~100, 50이 평균.
 *   우리가 무료로 얻는 것은 일부뿐이므로 '커버리지'를 함께 보고해야 한다.
 */
const M = await import('./squeeze-score.mjs').catch(() => null);
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
if (!M?.computeSqueezeScore) { bad('computeSqueezeScore 미구현 — 점수가 여전히 LLM 산출'); console.log('\n결과: 실패 1건'); process.exit(1); }

// ① 가중치가 설정에서 온다
const cfg = M.loadSqueezeConfig();
(cfg?.components && typeof cfg.minCoverage === 'number') ? ok(`설정 로드 — 성분 ${Object.keys(cfg.components).length}종, 최소 커버리지 ${cfg.minCoverage}`)
                                                          : bad('설정 구조 없음');

// ② 실데이터로 계산되고, 값이 연속적이어야 한다 (LLM 처럼 45 에 몰리면 안 됨)
const mrna = M.computeSqueezeScore({ daysToCover: 7.2, volumeRatio: 7.8, momentum5dPct: 12.0 });
const aapl = M.computeSqueezeScore({ daysToCover: 2.6, volumeRatio: 1.1, momentum5dPct: 0.5 });
(mrna?.score != null && aapl?.score != null && mrna.score > aapl.score)
  ? ok(`실데이터 반영: MRNA(DTC 7.2) ${mrna.score} > AAPL(DTC 2.6) ${aapl.score}`)
  : bad(`순서 미반영 (${mrna?.score} vs ${aapl?.score})`);

// ③ 커버리지를 보고해야 한다 — 몇 개 성분으로 낸 점수인지 숨기지 않는다
(mrna.coverage != null && Array.isArray(mrna.missing))
  ? ok(`커버리지 보고 ${(mrna.coverage*100).toFixed(0)}% · 결측 [${mrna.missing.join(', ')}]`)
  : bad('커버리지/결측 미보고');

// ④ 커버리지가 최소 미만이면 점수를 만들지 않는다 (지어내기 금지)
const thin = M.computeSqueezeScore({ momentum5dPct: 3 });
thin === null ? ok('커버리지 부족 → null (지어내지 않음)') : bad(`커버리지 부족인데 점수 ${thin?.score} 반환`);

// ⑤ 입력이 아예 없으면 null
M.computeSqueezeScore({}) === null ? ok('입력 없음 → null') : bad('입력 없는데 점수 반환');

// ⑥ ★ 이미 터진 종목은 후보가 아니다 — 실현된 급등에 만점을 주면 추격이 된다
//    실측: MRNA 2026-08-18 $62.96 → 08-19 $174.38 (하루 +177%). Yahoo 원본 대조 확인.
//    "숏스퀴즈 후보"로 표시됐지만 스퀴즈는 이미 끝난 뒤였다.
const fresh = M.computeSqueezeScore({ daysToCover: 7.2, volumeRatio: 7.8, momentum5dPct: 12 });
const blown = M.computeSqueezeScore({ daysToCover: 7.2, volumeRatio: 7.8, momentum5dPct: 173.9 });
(fresh && blown && blown.score < fresh.score)
  ? ok(`소진 반영: 모멘텀 +12% ${fresh.score}점 > +173.9%(이미 터짐) ${blown.score}점`)
  : bad(`이미 터진 급등이 더 높거나 같다 (+12%:${fresh?.score} vs +173.9%:${blown?.score})`);
(blown && blown.exhausted === true) ? ok('소진 플래그 보고') : bad('소진 여부를 알려주지 않는다');

// ⑦ 소진된 종목은 정책에 따라 후보에서 제외
const cfgX = M.loadSqueezeConfig();
if (cfgX.excludeExhausted) {
  M.isSqueezeCandidate(blown) === false ? ok('소진 종목은 후보 제외 (excludeExhausted=true)')
                                        : bad(`소진인데 후보로 통과 (score ${blown.score})`);
}
M.isSqueezeCandidate(null) === null ? ok('점수 없음 → 미판정(null)') : bad('점수 없는데 단정');

// ⑧ 임계값도 설정에서 (코드 리터럴 아님)
typeof cfg.candidateThreshold === 'number' ? ok(`후보 임계 ${cfg.candidateThreshold} (설정)`) : bad('임계값이 설정에 없음');

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
