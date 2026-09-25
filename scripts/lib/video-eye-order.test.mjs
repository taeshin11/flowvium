#!/usr/bin/env node
/**
 * video-eye-order.test.mjs — 눈검증은 키가 없어도 agy 로 먼저 본다. 2026-09-25 신설.
 * 테크이슈 세션 공지 4항: GEMINI_API_KEY 검사가 agy 시도보다 앞에 있어, 키가 없는 곳에선
 *   agy(키 불필요) 눈검증까지 통째로 빠졌다("판정 없음 — GEMINI_API_KEY 없음"). 우리 코드도 같은 순서였다.
 *   agy 호출을 바꿔 끼울 자리가 없어 순서를 소스에서 본다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';
const src = readFileSync(join(ROOT, 'scripts/lib/video-eye.mjs'), 'utf8');
const body = src.slice(src.indexOf('export async function inspectFrames'));
const agyAt = body.indexOf('agyInspect(');
const keyGate = body.search(/if \(!key\) return/);
const ok = agyAt > 0 && keyGate > agyAt;
console.log(ok ? '  PASS  키 검사가 agy 시도 뒤에 있다' : `  FAIL  키 검사(${keyGate})가 agy 시도(${agyAt})보다 앞이다 — 키 없으면 눈검증이 빠진다`);
console.log(ok ? '\n✅ 전부 통과' : '\n❌ 1건 실패');
process.exit(ok ? 0 : 1);
