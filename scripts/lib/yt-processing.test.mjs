#!/usr/bin/env node
/**
 * yt-processing.test.mjs — 처리 끝난 영상만 스튜디오에서 만진다. 2026-10-19 신설.
 *
 * 실측: 10/14~10/17 관련 동영상 걸기 32편 중 7편 실패(locator.click 30초 초과 5 · 저장 뒤 빈 칸 1 · 대상 못 찾음 1).
 *   남은 실패 화면 3장(O3Ka6mtggzc·tILYRdDAKl8·MdgWTaUbfHg) 모두 '동영상 업로드 중…' · 공개 상태 '대기 중' —
 *   업로드 직후 처리 중이라 '관련 동영상' 칸이 아직 없었다. 발행이 업로드 끝나자마자 뒤에서 띄우기 때문.
 *   같은 편들을 지금 API 로 보면 uploadStatus=processed · processingStatus=succeeded.
 * → API 로 처리 끝을 기다린 뒤 연다. 끝내 안 끝나면 실패로 적지 않고 '처리 중이라 못 함' 으로 적는다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const { processingState, waitProcessed } = await import('./yt-processing.mjs');

const v = (u, p) => ({ status: { uploadStatus: u }, processingDetails: { processingStatus: p } });
(processingState(v('processed', 'succeeded')) === 'ready' && processingState(v('uploaded', 'processing')) === 'pending'
  && processingState(v('failed', 'failed')) === 'dead' && processingState(v('rejected', 'terminated')) === 'dead' && processingState(undefined) === 'pending')
  ? ok('[1] ready · pending · dead') : bad('[1]');

// [2] 처음엔 처리 중 → 두 번째 조회에서 끝남. 끝난 것만 ready 로.
let calls = 0;
const fake = async (ids) => { calls++; return ids.map((id) => ({ id, ...(id === 'a' || calls > 1 ? v('processed', 'succeeded') : v('uploaded', 'processing')) })); };
const r = await waitProcessed(['a', 'b'], { list: fake, timeoutMs: 1000, pollMs: 1, sleep: async () => {} });
(r.ready.join() === 'a,b' && r.pending.length === 0 && calls === 2) ? ok('[2] 끝날 때까지 다시 묻는다') : bad(`[2] ${JSON.stringify(r)} calls=${calls}`);
const never = await waitProcessed(['b'], { list: async (ids) => ids.map((id) => ({ id, ...v('uploaded', 'processing') })), timeoutMs: 5, pollMs: 1, sleep: async (ms) => new Promise((s) => setTimeout(s, ms)) });
(never.ready.length === 0 && never.pending.join() === 'b') ? ok('[3] 끝내 안 끝나면 pending 으로 돌려준다') : bad(`[3] ${JSON.stringify(never)}`);

const src = readFileSync(new URL('../yt-related-video.mjs', import.meta.url), 'utf8');
(/waitProcessed\(/.test(src) && src.indexOf('waitProcessed(') < src.indexOf('launchPersistentContext'))
  ? ok('[4] yt-related-video 가 스튜디오를 열기 전에 처리 끝을 기다린다') : bad('[4]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
