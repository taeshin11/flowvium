#!/usr/bin/env node
// verify-chat-answers.mjs — 챗 "나쁜 답변" 검증체계 (2026-07-05 사용자 "채팅에서 답변에 나쁜 답변 없는지 검증체계 만들어")
//
// 2단 구성 (chat-verify.mjs 단일 소스 재사용 — 라우트와 같은 규칙):
//  [A] self-test: 결함 픽스처 회귀가드 — 검출기가 각 유형을 잡는지 + 교정기가 지우는지 + clean 답변 무결.
//      결정론이라 CI/push 게이트 가능(test-hanja-guard 패턴). 검출규칙이 무뎌지면 ❌ FAIL.
//  [B] 저장대화 전수 재검증: flowvium:judge-chat:index → 대화 답변에 *현재* 검출룰 소급 적용.
//      답변시점 검증로그(flowvium:judge-chat:verify, analyze-chat-logs 가 통계)와 달리 룰 신설 후
//      과거 답변도 재판정 — "이미 나간 나쁜 답변"을 찾아 flag. 저장답변은 sanitize 후 본문이므로
//      교정 가능 유형은 0 이 정상이고, 잔존 결함 = 교정기 사각지대 신호.
//      결과: logs/chat-answer-audit.json + 콘솔. 결함률 20%+ 또는 self-test 실패 → exit 1.
//
// 사용: node scripts/verify-chat-answers.mjs [--n=300] [--self-test-only] [--verbose]
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChatDefects, sanitizeAnswer, DEFECT_LESSON } from './lib/chat-verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=300').split('=')[1]);
const SELF_ONLY = process.argv.includes('--self-test-only');
const VERBOSE = process.argv.includes('--verbose');
const FAIL_RATE = 0.20;  // 저장대화 잔존 결함률 임계 — 20%+ 면 체계 자체가 뚫린 것(critical)
const WARN_RATE = 0.10;

let exitCode = 0;

// ── [A] self-test — 유형별 픽스처. expect: 반드시 검출돼야 하는 type. correctable: sanitize 후 사라져야 하는 type.
const PRICE1 = { tickers: [{ ticker: 'TEST', price: 200, fiscalYear: null }] };
const NOPRICE = { tickers: [{ ticker: 'TEST', price: null }] };
const FIXTURES = [
  { name: 'score_tag+rule_id', a: '모멘텀이 강합니다 (+5). price_momentum_52w_high 조건 충족으로 긍정적입니다.', g: PRICE1, expect: ['score_tag_leak', 'rule_id_leak'], corrected: ['score_tag_leak', 'rule_id_leak'] },
  { name: 'engine_score_no_data', a: '이 종목은 매수엔진 총점 12점으로 매력적입니다. 다만 데이터가 제한적이니 유의하세요.', g: NOPRICE, expect: ['engine_score_no_data'], corrected: ['engine_score_no_data'] },
  { name: 'magnitude_overstate', a: '어제 주가가 2.1% 급락했습니다. 시장 변동성에 유의해야 합니다.', g: PRICE1, expect: ['magnitude_overstate'], corrected: ['magnitude_overstate'] },
  { name: 'fake_multiple', a: '현재 시가총액은 순이익의 938배에 달해 극단적 고평가 상태입니다.', g: PRICE1, expect: ['fake_multiple'], corrected: [] },
  { name: 'stale_year', a: '2023년 기준 최신 매출은 10조원이며 성장세가 이어지고 있습니다.', g: PRICE1, expect: ['stale_year'], corrected: ['stale_year'] },
  { name: 'entry_far_from_price', a: '진입가 280~300 구간을 제시합니다. 손절은 진입가 대비 7% 아래로 설정하세요.', g: PRICE1, expect: ['entry_far_from_price'], corrected: [] },
  { name: 'verdict_mismatch', a: '결론적으로 지금은 매수 추천합니다. 분할 매수로 접근하세요.', g: { ...PRICE1, expectedAction: { action: '매도', verdict: 'sell', net: -9 } }, expect: ['verdict_mismatch'], corrected: [] },
  { name: 'hanja_leak', a: '美 증시가 강세를 보이며 반도체 업종이 상승을 주도했습니다.', g: PRICE1, expect: ['hanja_leak'], corrected: ['hanja_leak'] },
  { name: 'price_mismatch', a: '현재가 300달러 수준에서 거래되고 있어 밸류에이션 부담이 있습니다.', g: PRICE1, expect: ['price_mismatch'], corrected: [] },
  // 07-05 E2E 실증 오검 회귀가드: "현재가가 52주 고점 대비"의 52(주)를 현재가로 오파싱하지 않아야 함.
  { name: 'price_mismatch 오검가드(52주)', a: '현재가가 52주 고점 대비 18% 하락한 상태라 변동성 확대에 유의해야 합니다. 다만 장기 추세는 유효합니다.', g: PRICE1, expect: [], corrected: [] },
  // 07-06 SFT eval S6 오검 회귀가드: "현재가가 200일 이동평균선"의 200(일)을 현재가로 오파싱 금지.
  { name: 'price_mismatch 오검가드(200일선)', a: '현재가가 200일 이동평균선 위에서 지지되고 있어 장기 추세는 유효합니다. 분할 접근을 권합니다.', g: PRICE1, expect: [], corrected: [] },
  // 07-06 UI eval 오검 회귀가드: "현재가가 50MA($209.80)"의 50 을 현재가로 오파싱 금지.
  { name: 'price_mismatch 오검가드(50MA)', a: '현재가가 50MA 아래에 있지만 200MA 위라서 장기 추세는 유효합니다. 분할 매수 관점이 좋습니다.', g: PRICE1, expect: [], corrected: [] },
  // 07-06 UI eval 실증: 줄바꿈 없이 이어지는 문장 반복(degenerate 65회) — 검출 + 전역 문장 dedupe 교정.
  { name: 'repetition 비연속(문장 나열)', a: '매도 신호가 발동되면 즉시 대응해야 합니다. 매도 신호가 발동되면 즉시 대응해야 합니다. 매도 신호가 발동되면 즉시 대응해야 합니다. 결론적으로 분할 접근이 안전합니다.', g: PRICE1, expect: ['repetition_loop'], corrected: ['repetition_loop'] },
  // 07-06 스트레스 실증 오검 회귀가드: "현재가 기준으로 $236.54[목표가]"의 목표가를 현재가로 오파싱 금지.
  //   (grounding 현재가 200 과 236 은 18% 차이라 종전 검출기는 오탐. '기준으로' 역할어 개입 = 현재가 아님.)
  { name: 'price_mismatch 오검가드(현재가 기준으로 목표가)', a: '현재가 $200.00 기준으로, 목표가는 52주 고가 $236.54를 목표로 삼되 돌파 시 추가 상승 여력이 있습니다.', g: PRICE1, expect: [], corrected: [] },
  // 07-06 SFT eval S5 오검 회귀가드: 레벨 나열("손절 $108.68, 목표 $128.55")로 끝나는 답변은 절단 아님.
  { name: 'truncated 오검가드(레벨 꼬리)', a: '오늘 리포트 포트폴리오 기준으로 반도체 비중 확대가 유효합니다. 추천 종목의 상세 레벨은 다음과 같으며 리스크 관리를 위해 분할 접근을 권합니다. AVGO 진입 현재가 부근, 손절 $108.68, 목표 $128.55', g: PRICE1, expect: [], corrected: [] },
  { name: 'english_answer', a: 'This stock shows strong momentum with solid fundamentals. The revenue growth accelerated last quarter and margins expanded significantly across segments.', g: PRICE1, expect: ['english_answer'], corrected: [] },
  { name: 'truncated_answer', a: '이 종목의 최근 실적은 양호합니다. 매출과 영업이익이 모두 성장했고 가이던스도 상향 조정됐습니다. 다만 밸류에이션 측면에서 보면 지금 주가는 동종업계 대비 상당한 프리미엄이 붙어 있는 상태라서 진입 시점을 신중하게 고민해야 하는 구간인데, 특히 주의해야 할 부분은 바로', g: PRICE1, expect: ['truncated_answer'], corrected: [] },
  { name: 'repetition_loop', a: '분할 매수로 접근하는 것이 안전합니다.\n분할 매수로 접근하는 것이 안전합니다.\n분할 매수로 접근하는 것이 안전합니다.', g: PRICE1, expect: ['repetition_loop'], corrected: ['repetition_loop'] },
  { name: 'non_answer(fallback문구)', a: '지금 심판엔진이 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.', g: PRICE1, expect: ['non_answer'], corrected: [] },
  // 07-06 (사용자 "없다=정답 아님"): grounding 에 가격 있는데 "시세 못 불러왔다"=거짓 부재. 검출 필수.
  { name: 'false_disclaimer(가격 있는데 없다함)', a: '현재 시세를 불러오지 못해 정확한 판단이 어렵습니다. 일반적인 원칙만 말씀드리면 분할 접근이 안전합니다.', g: PRICE1, expect: ['false_disclaimer'], corrected: [] },
  // 가드: grounding 이 진짜 비었으면(NOPRICE) "데이터 없음"은 정당 — false_disclaimer 오검 금지.
  { name: 'false_disclaimer 가드(진짜 없음)', a: '해당 종목의 실시간 데이터를 불러오지 못해 판단을 보류합니다. 일반 원칙만 안내드립니다.', g: NOPRICE, expect: [], corrected: [] },
  // ■1 메타언급 가드(2026-07-06 AISVI 차용): 예시/부정 문맥의 룰 ID 는 실누출 아님 — 검출 0 + 교정기 보존.
  { name: 'rule_id 메타언급 가드', a: '내부 룰 ID(price_momentum_52w_high 같은)는 답변에 쓰지 않습니다. 대신 의미를 우리말로 풀어 설명합니다.', g: PRICE1, expect: [], corrected: [] },
  // clean — 결함 0 이어야 함(과검출 회귀가드). 현재가는 grounding 실가와 일치, 문장 완결, 한자/누출 없음.
  { name: 'clean', a: '테스트 종목은 현재가 200달러 부근에서 거래 중입니다. 최근 실적이 양호하고 수급도 안정적이라 분할 매수 접근이 유효합니다. 손절선은 186달러로 잡으세요.', g: PRICE1, expect: [], corrected: [] },
];

console.log('=== [A] chat-verify self-test (검출·교정 회귀가드) ===');
let selfFail = 0;
for (const f of FIXTURES) {
  const q = f.q ?? '이 종목 어때?';
  const types = checkChatDefects(q, f.a, f.g, f.locale ?? 'ko').map(x => x.type);
  const missing = f.expect.filter(t => !types.includes(t));
  const unexpected = f.expect.length === 0 ? types : [];
  // 교정 검증 — sanitize 후 해당 유형이 사라져야 함
  const after = checkChatDefects(q, sanitizeAnswer(f.a, f.g, f.locale ?? 'ko'), f.g, f.locale ?? 'ko').map(x => x.type);
  const notCorrected = (f.corrected ?? []).filter(t => after.includes(t));
  if (missing.length || unexpected.length || notCorrected.length) {
    selfFail++;
    console.log(`❌ ${f.name}: ${missing.length ? `미검출=[${missing}] ` : ''}${unexpected.length ? `과검출=[${unexpected}] ` : ''}${notCorrected.length ? `미교정=[${notCorrected}]` : ''}`);
  } else if (VERBOSE) console.log(`✅ ${f.name}: 검출=[${types.join(',') || '-'}]`);
}
// DEFECT_LESSON 커버리지 — 검출 유형에 폐루프 교훈이 빠지면 detector-without-corrector dead-end (non_answer 는 인프라 신호라 예외).
const allTypes = new Set(FIXTURES.flatMap(f => f.expect));
allTypes.delete('non_answer');
const noLesson = [...allTypes].filter(t => !DEFECT_LESSON[t]);
if (noLesson.length) { selfFail++; console.log(`❌ DEFECT_LESSON 미매핑(폐루프 dead-end): ${noLesson.join(', ')}`); }
if (selfFail) { exitCode = 1; console.log(`\n❌ self-test 실패 ${selfFail}건 — 검출·교정 규칙 회귀`); }
else console.log(`✅ self-test ${FIXTURES.length} 픽스처 + 교훈매핑 전부 통과`);

// ── [B] 저장대화 전수 재검증 ────────────────────────────────────────────────────
if (!SELF_ONLY) {
  console.log(`\n=== [B] 저장대화 재검증 (최근 index ${N}건, 현행 룰 소급) ===`);
  let redis = null;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true });
    await redis.connect();
  } catch { console.log('⏭️  Redis(6379) 미가용 — 저장대화 스캔 skip (CI/오프라인 정상)'); redis = null; }
  if (redis) {
    try {
      const rows = await redis.lrange('flowvium:judge-chat:index', 0, N - 1);
      const idx = rows.map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
      const keys = [...new Set(idx.map(e => e.key).filter(Boolean))];
      const flagged = [];
      let scanned = 0;
      const typeCount = {};
      for (let i = 0; i < keys.length; i += 100) {
        const vals = keys.length ? await redis.mget(keys.slice(i, i + 100)) : [];
        for (let j = 0; j < vals.length; j++) {
          if (!vals[j]) continue;
          let conv; try { conv = JSON.parse(vals[j]); } catch { continue; }
          const msgs = conv.messages ?? [];
          for (let k = 0; k < msgs.length; k++) {
            if (msgs[k]?.role !== 'assistant') continue;
            const answer = String(msgs[k].content ?? '');
            const question = String(msgs.slice(0, k).reverse().find(m => m?.role === 'user')?.content ?? '');
            // locale 추정(conv 에 미저장): 가나→ja / 질문·답변에 한글→ko / 그 외 en (english_answer·hanja 오검 방지)
            const locale = /[\u3040-\u30FF]/.test(answer) ? 'ja' : (/[가-힣]/.test(question) || /[가-힣]/.test(answer)) ? 'ko' : 'en';
            // 저장 conv 엔 grounding 미보존. 종목이 있던 대화는 답변 시점에 엔진 데이터가 있었다고 간주해야
            //   engine_score_no_data 오검(첫 스캔에서 TSM/삼성전자 정상답변 2건 오flag)을 막는다 → price 에
            //   NaN placeholder: `!= null`(hasEngineData)은 true, truthy 가드(가격·진입가 수치비교)는 falsy 라 skip.
            const idxTickers = idx.find(e => e.key === keys[i + j])?.tickers;
            const g = { tickers: (Array.isArray(idxTickers) ? idxTickers : []).map(t => ({ ticker: String(t), price: NaN })) };
            scanned++;
            const defects = checkChatDefects(question, answer, g, locale);
            if (defects.length) {
              for (const df of defects) typeCount[df.type] = (typeCount[df.type] ?? 0) + 1;
              flagged.push({ ts: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : conv.ts ?? null, q: question.slice(0, 50), types: defects.map(x => x.type), details: defects.map(x => x.detail).filter(Boolean).slice(0, 3), snippet: answer.slice(0, 80) });
            }
          }
        }
      }
      const rate = scanned ? flagged.length / scanned : 0;
      console.log(`스캔 답변 ${scanned}건 중 결함 잔존 ${flagged.length}건 (${(rate * 100).toFixed(1)}%)`);
      const typeRows = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
      for (const [t, c] of typeRows) console.log(`  ${t}: ${c}건${DEFECT_LESSON[t] ? '' : ' (인프라 신호)'}`);
      for (const f of flagged.slice(0, VERBOSE ? 30 : 8)) console.log(`  · ${String(f.ts).slice(0, 19)} | "${f.q}" | ${f.types.join(',')} | ${f.details.join(' / ')}`);
      const status = { updatedAt: new Date().toISOString(), scanned, flagged: flagged.length, rate: +(rate * 100).toFixed(1), types: typeCount, examples: flagged.slice(0, 20) };
      try { writeFileSync(resolve(ROOT, 'logs/chat-answer-audit.json'), JSON.stringify(status, null, 2)); } catch { /* */ }
      if (scanned && rate >= FAIL_RATE) { exitCode = 1; console.log(`\n🚨 잔존 결함률 ${(rate * 100).toFixed(1)}% ≥ ${FAIL_RATE * 100}% — 검증·교정 체계가 뚫림(critical)`); }
      else if (scanned && rate >= WARN_RATE) console.log(`\n⚠️ 잔존 결함률 ${(rate * 100).toFixed(1)}% ≥ ${WARN_RATE * 100}% — 교정기 사각지대 점검 권장`);
      else if (scanned) console.log(`\n✅ 저장대화 잔존 결함률 ${(rate * 100).toFixed(1)}% (정상)`);
      else console.log('저장된 대화 없음 (아직 질답 미발생).');
    } finally { redis.disconnect(); }
  }
}
process.exit(exitCode);
