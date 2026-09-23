#!/usr/bin/env node
/**
 * model-provenance.test.mjs — 보고서가 **자기 저자를 옳게 적는가.** 2026-09-23 신설.
 *
 * 재현한 사고: 2026-09-23 noon 회차. agy 18건 · 로컬 0건인데 보고서에는
 *   model='Qwen3.8-27B-8bit' / source='local-Qwen3.8-27B-8bit' 이 적혔다.
 *   이 컬럼으로 모델별 결함률을 재는데, agy 결함이 전부 Qwen 앞으로 달린다.
 */
import { reportProvenance } from './model-provenance.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

// [1] 오늘의 사고 그대로 — 전부 agy 면 Qwen 이름이 어디에도 없어야 한다
{
  const p = reportProvenance({ agyCalls: 18, localCalls: 0, agyModel: 'gemini-3.1-pro-high', localModel: 'Qwen3.8-27B-8bit' });
  !/Qwen/i.test(p.model + p.source)
    ? ok(`[1] agy 전용 회차에 Qwen 이름이 안 붙는다 → ${p.source}`) : bad(`[1] ${JSON.stringify(p)}`);
  // 사장님 지시(2026-09-23): source 에 경로('agy-')를 붙이지 않는다. 저자는 모델이다.
  p.source === 'gemini-3.1-pro-high'
    ? ok('[1a] source 는 모델 이름 그대로') : bad(`[1a] ${p.source}`);
  p.model === 'gemini-3.1-pro-high' ? ok('[1b] 실제 저자를 적는다') : bad(`[1b] ${p.model}`);
}

// [2] 예전 경로는 그대로 — vLLM 만 돌면 local- 접두사와 해석된 모델명
{
  const p = reportProvenance({ agyCalls: 0, localCalls: 17, localModel: 'Qwen3.8-27B-8bit' });
  p.source === 'local-Qwen3.8-27B-8bit' && p.model === 'Qwen3.8-27B-8bit'
    ? ok('[2] 로컬 전용은 종전과 같다') : bad(`[2] ${JSON.stringify(p)}`);
}

// [3] 섞이면 한쪽에 달지 않는다 — 다수결로 몰면 결함률이 조용히 오염된다
{
  const p = reportProvenance({ agyCalls: 12, localCalls: 6, agyModel: 'gemini-3.1-pro-high', localModel: 'Qwen3.8-27B-8bit' });
  p.model === 'mixed' ? ok('[3] 섞인 회차는 mixed 로 따로 묶는다') : bad(`[3] ${p.model}`);
  /gemini-3\.1-pro-high/.test(p.source) && /local6/.test(p.source)
    ? ok(`[3b] 내역이 남는다 → ${p.source}`) : bad(`[3b] ${p.source}`);
}

// [4] agy 가 돌았는데 모델명을 모르면 **모른다고 적는다** — 그럴듯한 기본값은 같은 고장의 재발이다
{
  const p = reportProvenance({ agyCalls: 3, localCalls: 0, agyModel: null, localModel: 'Qwen3.8-27B-8bit' });
  p.model === 'unknown' ? ok('[4] 모르면 unknown') : bad(`[4] ${p.model}`);
}

// [5] 아무 호출도 없으면 로컬 라벨(종전 기본값) — 빈 값이면 unknown
{
  reportProvenance({ localModel: 'X' }).source === 'local-X' ? ok('[5] 무호출 기본') : bad('[5]');
  reportProvenance({}).model === 'unknown' ? ok('[5b] 이름이 없으면 unknown') : bad('[5b]');
}

// [6] ★ 지금 **실제로 설정된** agy 모델이 발행 허용 판정을 통과하는가.
//     source 를 모델 이름으로 바꾸면서 허용목록이 'gemini-' 접두사에 묶였다.
//     AGY_TEXT_MODEL 을 다른 계열로 바꾸고 report-source.mjs 를 안 늘리면
//     그 회차는 last-good 캐시에 못 들어가고 Redis 가 튈 때 generic 이 서빙된다.
{
  const { agyReportModel } = await import('./agy-report.mjs');
  const { isGeneratedSource } = await import('./report-source.mjs');
  const src = reportProvenance({ agyCalls: 1, localCalls: 0, agyModel: agyReportModel(), localModel: 'x' }).source;
  isGeneratedSource(src)
    ? ok(`[6] 설정된 모델이 허용 판정을 통과 — ${src}`)
    : bad(`[6] ${src} 가 막힌다 — report-source.mjs 의 허용목록을 늘려라`);
}

console.log(fail ? `\n  ❌ ${fail}건 실패` : '\n  ✅ 전부 통과');
process.exit(fail ? 1 : 0);
