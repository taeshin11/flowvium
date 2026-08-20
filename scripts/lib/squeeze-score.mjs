/**
 * squeeze-score.mjs — 숏스퀴즈 점수를 실데이터에서 계산한다.
 *
 * 종전에는 LLM 이 프롬프트 스키마(generate-report-local.mjs:6221)의 score 필드를 지어냈다.
 * 아카이브 546건의 고유값이 9개뿐이고 45점에 54%가 몰렸다 — 실측 분포가 아니다.
 * 매수룰 micro_squeeze_score(임계 50)는 그 어림값과 비교하느라 전체 이력에서 0건 발화했다.
 *
 * 설계:
 *   · 가중치·정규화 기준·임계값을 data/squeeze-score.json 에서 읽는다. 코드에 숫자를 박지 않는다.
 *   · 성분마다 '실데이터가 있었는가'를 추적해 커버리지를 함께 돌려준다.
 *     무료 소스가 없는 성분(차입수수료·활용률)을 있는 척하지 않는다.
 *   · 커버리지가 최소 미만이면 null. 모르는 것을 숫자로 만들지 않는다.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = process.env.SQUEEZE_CONFIG_PATH ?? resolve(HERE, '../../data/squeeze-score.json');
let _cfg = null;

export function loadSqueezeConfig() {
  if (_cfg) return _cfg;
  const c = JSON.parse(readFileSync(PATH, 'utf8'));
  for (const k of ['components', 'minCoverage', 'candidateThreshold']) {
    if (c[k] === undefined) throw new Error(`squeeze-score: '${k}' 없음 (${PATH})`);
  }
  return (_cfg = c);
}

/**
 * @param {object} inputs 성분별 실측값. 없는 성분은 넣지 않거나 null.
 * @returns {{score:number, coverage:number, present:string[], missing:string[], parts:object, exhausted:boolean}|null}
 */
export function computeSqueezeScore(inputs = {}) {
  const cfg = loadSqueezeConfig();
  let wSum = 0, acc = 0, exhausted = false;
  const present = [], missing = [], parts = {};
  for (const [name, c] of Object.entries(cfg.components)) {
    const v = inputs[name];
    if (v == null || !Number.isFinite(Number(v))) { missing.push(name); continue; }
    // 0~1 로 정규화 후 가중. full 이상은 1 로 클램프(상단 포화), 음수는 0.
    let norm = Math.max(0, Math.min(1, Number(v) / c.full));
    // 소진(exhaustion): 이 성분이 '이미 일어난 크기'를 재는 경우, 일정 수준을 넘으면 감쇠한다.
    //   스퀴즈 점수는 앞으로 터질 가능성이지 이미 터진 크기가 아니다. 만점을 주면 추격이 된다.
    //   exhaustionPct 이상에서 선형 감쇠, 그 2배 지점에서 0 — 값과 사유는 설정에 있다.
    if (c.exhaustionPct != null && Number(v) > c.exhaustionPct) {
      const over = (Number(v) - c.exhaustionPct) / c.exhaustionPct;
      norm = Math.max(0, norm * Math.max(0, 1 - over));
      exhausted = true;
    }
    parts[name] = { value: Number(v), norm: +norm.toFixed(3), weight: c.weight };
    acc += norm * c.weight;
    wSum += c.weight;
    present.push(name);
  }
  const totalW = Object.values(cfg.components).reduce((s, c) => s + c.weight, 0);
  const coverage = totalW ? wSum / totalW : 0;
  if (!present.length || coverage < cfg.minCoverage) return null;
  // 있는 성분만으로 0~100 환산(가중치 재정규화). 커버리지를 함께 보고하므로 과대해석 방지.
  return {
    score: Math.round((acc / wSum) * 100),
    coverage: +coverage.toFixed(3),
    present, missing, parts, exhausted,
    threshold: cfg.candidateThreshold,
  };
}

/**
 * 후보 임계 통과 여부. 점수가 없으면 null(미판정) — false 로 단정하지 않는다.
 * 소진된 종목은 excludeExhausted 정책에 따라 제외한다. 이미 터진 스퀴즈는 정의상 후보가 아니다.
 */
export function isSqueezeCandidate(result) {
  if (!result) return null;
  const cfg = loadSqueezeConfig();
  if (result.exhausted && cfg.excludeExhausted) return false;
  return result.score >= result.threshold;
}
