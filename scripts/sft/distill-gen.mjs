#!/usr/bin/env node
// SERA distillation 데이터 생성 — 로컬 235B teacher(llama.cpp OpenAI-compat)로 v1 프롬프트 재생성.
// 완전 로컬 주권: 프롬프트/응답이 네트워크 밖으로 안 나감. 결과 = AISVI v2 QLoRA 학습 데이터.
// teacher-agnostic: TEACHER_URL 만 바꾸면 클러스터 llama.cpp / 단일 vLLM 모두 동작.
// env: TEACHER_URL(기본 http://localhost:8080/v1), TEACHER_MODEL, SEEDS(jsonl), OUT, MAX(0=all), CONC, TEMP
import fs from 'node:fs';

const TEACHER_URL   = process.env.TEACHER_URL   || 'http://localhost:8080/v1';
const TEACHER_MODEL = process.env.TEACHER_MODEL || 'qwen3-235b';
const SEEDS         = process.env.SEEDS         || '/root/aisvi-finance-t.jsonl';
const OUT           = process.env.OUT           || '/root/aisvi-finance-t-v2.jsonl';
const MAX           = parseInt(process.env.MAX  || '0', 10);
const CONC          = parseInt(process.env.CONC || '8', 10);
const TEMP          = parseFloat(process.env.TEMP || '0.6');
const MAXTOK        = parseInt(process.env.MAXTOK || '2048', 10);

// 품질 필터 (clean-sft.mjs 와 동일 기준 — 환각/누락가/원문영어 차단)
const MISSING_PRICE = /현재가\s*\?/;
const LEAK = /\[수정\]|수정 필요|환각|defect|verify/i;
const hasCJK = s => /[가-힣]/.test(s);

function loadSeeds(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const seeds = [];
  for (const ln of lines) {
    try {
      const d = JSON.parse(ln);
      if (d.messages) {                       // v1 messages 포맷
        const sys = d.messages.find(m => m.role === 'system');
        const usr = d.messages.find(m => m.role === 'user');
        if (sys && usr) seeds.push({ system: sys.content, user: usr.content, lang: hasCJK(usr.content) ? 'ko' : 'en' });
      } else if (d.system && d.user) {         // bilingual-seeds 포맷 {system,user,lang}
        seeds.push({ system: d.system, user: d.user, lang: d.lang || (hasCJK(d.user) ? 'ko' : 'en') });
      }
    } catch { /* skip */ }
  }
  return seeds;
}

async function callTeacher(system, user) {
  const res = await fetch(`${TEACHER_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEACHER_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: TEMP, max_tokens: MAXTOK,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

function qualityOk(a, lang) {
  if (!a || a.length < 40) return false;
  if (MISSING_PRICE.test(a)) return false;
  if (LEAK.test(a)) return false;
  const cjkCount = (a.match(/[가-힣]/g) || []).length;
  if (lang === 'ko') {
    if (cjkCount < 5) return false;                  // 한국어 기대인데 한글 거의 없음(원문영어)
  } else {                                            // en
    if (!/[a-zA-Z]/.test(a)) return false;           // 영어 글자 없음
    if (cjkCount > a.length * 0.1) return false;      // 영어 기대인데 한글 과다(언어혼선)
  }
  return true;
}

async function main() {
  let seeds = loadSeeds(SEEDS);
  if (MAX > 0) seeds = seeds.slice(0, MAX);
  // resume: 이미 생성된 user 프롬프트 skip
  const done = new Set();
  if (fs.existsSync(OUT)) {
    for (const ln of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      try { done.add(JSON.parse(ln).messages.find(m => m.role === 'user').content); } catch {}
    }
  }
  const todo = seeds.filter(s => !done.has(s.user));
  console.log(`[distill] teacher=${TEACHER_URL} model=${TEACHER_MODEL}`);
  console.log(`[distill] seeds=${seeds.length} done=${done.size} todo=${todo.length} conc=${CONC}`);
  if (!todo.length) { console.log('=== 생성할 것 없음(이미 완료) ==='); return; }

  const outStream = fs.createWriteStream(OUT, { flags: 'a' });
  let ok = 0, fail = 0, i = 0;
  const t0 = Date.now();
  async function worker() {
    while (i < todo.length) {
      const s = todo[i++];
      try {
        const answer = await callTeacher(s.system, s.user);
        if (qualityOk(answer, s.lang)) {
          outStream.write(JSON.stringify({ messages: [
            { role: 'system', content: s.system },
            { role: 'user', content: s.user },
            { role: 'assistant', content: answer },
          ] }) + '\n');
          ok++;
        } else fail++;
      } catch { fail++; }
      const n = ok + fail;
      if (n % 20 === 0) {
        const rate = n / ((Date.now() - t0) / 1000);
        const eta = Math.round((todo.length - n) / rate / 60);
        console.log(`  진행 ${n}/${todo.length} ok=${ok} fail=${fail} ${rate.toFixed(2)}/s eta=${eta}분`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await new Promise(r => outStream.end(r));
  console.log(`=== 완료 ok=${ok} fail=${fail} → ${OUT} ===`);
}
main().catch(e => { console.error('[FATAL]', e?.stack ?? e); process.exit(1); });
