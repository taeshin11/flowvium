#!/usr/bin/env node
/**
 * kr-latin.test.mjs — 영문 약어를 소리 나는 대로 한글로. 2026-09-25 신설.
 *
 * 시청자 댓글(OECD 성장률 편): "G20을 <지이영>으로 발음하는 AI가 너무 싫어".
 * 되들어 보니(Melo → whisper small) G20 만이 아니었다:
 *   OECD → "띠" · GDP → "뿐" · IMF → "네" · SK하이닉스 → "피하이닉스" · LG전자 → "외전자"
 * 한글 글자 이름으로 주면 제대로 읽었다: 오이씨디 → OECD · 지디피 → GDP · 아이엠에프 → IMF ·
 *   "지 이십"(띄움) → G20. 붙여 쓴 "지이십" 은 "지식" 으로 뭉개졌다 — 글자와 숫자 사이는 띄운다.
 *
 * 소리용이다. 자막에는 원문(G20)이 그대로 나간다.
 */
import { speakLatin } from './kr-latin.mjs';
import { speakNumbers } from './kr-number.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const spoken = (t) => speakNumbers(speakLatin(t));
const eq = (label, got, want) => (got === want ? ok(`${label}: ${got}`) : bad(`${label}: "${got}" ≠ "${want}"`));

// [1] 글자+숫자 — 띄우고 숫자는 한자어로 (댓글이 지적한 것)
// 문장 안에서는 띄움만으로 모자랐다: "지 이십" → "치 20" · "지이십" → "지의식". 쉼표(짧은 쉼)를 두면
//   "지, 이십" → G20 · "에프, 삼십오" → F-35 로 들렸다(2026-09-25 되들음, 같은 문장 안에서 비교).
eq('[1] G20', spoken('G20 중 최대 폭 상향'), '지, 이십 중 최대 폭 상향');
eq('[1b] G7', spoken('G7 정상회의'), '지, 칠 정상회의');
eq('[1c] F-35', spoken('F-35 전투기'), '에프, 삼십오 전투기');
eq('[1d] 5G', spoken('5G 통신망'), '오 지 통신망');
// [2] 글자 약어 — 한글 글자 이름으로
eq('[2] OECD', spoken('OECD가 전망을 올렸다'), '오이씨디가 전망을 올렸다');
eq('[2b] GDP', spoken('GDP 성장률'), '지디피 성장률');
eq('[2c] IMF', spoken('IMF 총재'), '아이엠에프 총재');
eq('[2d] SK하이닉스', spoken('SK하이닉스 실적'), '에스케이 하이닉스 실적');
eq('[2e] LG전자', spoken('LG전자 조사'), '엘지 전자 조사');
// [3] 낱말처럼 읽는 약어는 낱말로 (글자로 읽으면 틀린다: "에이피이씨")
eq('[3] APEC', spoken('APEC 정상회의'), '에이펙 정상회의');
eq('[3b] KOSPI', spoken('KOSPI 하락'), '코스피 하락');
eq('[3c] NATO', spoken('NATO 회의'), '나토 회의');
// [3d] AI·반도체 업계 낱말은 낱말로(테크이슈 세션 공지 2항 실측: NVIDIA → "엔브이아이디아이에이", DRAM → "디알에이엠")
eq('[3d] NVIDIA', spoken('NVIDIA 실적'), '엔비디아 실적');
eq('[3e] DRAM', spoken('DRAM 가격'), '디램 가격');
eq('[3f] NAND·CUDA·ARM', spoken('NAND CUDA ARM'), '낸드 쿠다 암');
// [4] 건드리지 않는 것 — 대소문자 섞인 영단어·주소·이미 한글
eq('[4] 영단어', spoken('Tesla 주가'), 'Tesla 주가');
eq('[4b] 주소', spoken('flowvium.net 에서'), 'flowvium.net 에서');
eq('[4c] 한글', spoken('코스피 2,610'), '코스피 이천륙백십');
eq('[4d] iPhone', spoken('iPhone 판매'), 'iPhone 판매');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
