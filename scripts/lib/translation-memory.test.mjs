#!/usr/bin/env node
/**
 * translation-memory.test.mjs — 확정 번역 저장소(사용자 제안 "llm wiki나 db").
 *
 * 배경(2026-08-20 실측): 웹 LLM 레인은 Qwen3.5-4B(:8001)다. 보고서(27B, :8000)의 20분짜리
 *   프리필이 GPU 를 독점해 웹 요청이 타임아웃되던 문제 때문에 내가 분리한 구조다. 그 이유는 실재했다.
 *   그런데 4B 의 금융 번역 품질이 실측상 못 쓸 수준이다 (같은 프롬프트, thinking 끈 상태):
 *       industrial conglomerate  4B "산업 컨glomerate" / "산업 컨гло머리트"   27B "산업 재벌"
 *       Short squeeze candidate  4B "단축 압력 후보"(의미 오역)              27B "숏 스퀴즈 후보"
 *       earnings beat            4B "수익 예측 상회"                        27B "실적 상회"
 *   앞의 것은 게이트가 걸러 원문이 노출되고, 가운데 것은 '한국어이긴 해서' 게이트를 통과해
 *   틀린 번역이 그대로 나간다 — 이쪽이 더 위험하다.
 *
 *   모델을 바꾸는 대신(=보고서와 GPU 경합 재발) 반복되는 용어를 미리 확정해 둔다.
 *   웹 경로는 조회만 하므로 GPU 를 안 건드리고, 품질은 27B 것이다.
 */
import { existsSync, rmSync } from 'fs';
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let TM;
try { TM = await import('./translation-memory.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

const DB = '/tmp/tm-test.db';
if (existsSync(DB)) rmSync(DB);
const tm = TM.openMemory(DB);

tm.lookup('industrial conglomerate', 'ko') === null ? ok('미등록 → null (조용한 빈문자열 아님)') : bad('미등록인데 값이 나옴');

tm.remember('industrial conglomerate', 'ko', '산업 재벌', { source: 'qwen3.8-27b' });
tm.lookup('industrial conglomerate', 'ko') === '산업 재벌' ? ok('등록 후 조회') : bad('조회 실패');
tm.lookup('industrial conglomerate', 'ja') === null ? ok('로케일 분리') : bad('로케일이 섞임');

// 표기 흔들림 흡수 — UI 문자열은 대소문자·공백이 제각각이다
tm.lookup('  Industrial  Conglomerate ', 'ko') === '산업 재벌'
  ? ok('대소문자·공백 정규화 매칭') : bad('정규화 미적용 — 같은 용어를 매번 GPU 로 보내게 된다');

// 덮어쓰기는 되되, 더 낮은 품질이 더 높은 품질을 덮으면 안 된다
tm.remember('industrial conglomerate', 'ko', '산업 컨glomerate', { source: 'qwen3.5-4b' });
tm.lookup('industrial conglomerate', 'ko') === '산업 재벌'
  ? ok('저품질 소스가 고품질을 덮지 않음') : bad(`4B 가 27B 를 덮어씀: ${tm.lookup('industrial conglomerate','ko')}`);

tm.remember('industrial conglomerate', 'ko', '산업 대기업', { source: 'human' });
tm.lookup('industrial conglomerate', 'ko') === '산업 대기업' ? ok('사람 교정은 모델을 덮음') : bad('사람 교정이 반영 안 됨');

// 빈 값/원문 그대로는 저장하면 안 된다 — 실패를 캐시하면 영구 고착된다
tm.remember('supply chain', 'ko', '', { source: 'qwen3.8-27b' });
tm.remember('supply chain', 'ko', 'supply chain', { source: 'qwen3.8-27b' });
tm.lookup('supply chain', 'ko') === null ? ok('빈 값·원문 그대로는 저장 거부') : bad(`실패를 캐시함: ${tm.lookup('supply chain','ko')}`);

const st = tm.stats();
st.total === 1 && st.byLocale.ko === 1 ? ok(`통계 (총 ${st.total})`) : bad(`통계 이상: ${JSON.stringify(st)}`);
tm.close(); rmSync(DB, { force: true });
console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
