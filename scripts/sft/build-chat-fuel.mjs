#!/usr/bin/env node
// scripts/sft/build-chat-fuel.mjs — 과거 저장대화 → SFT 연료 채굴 (2026-07-06)
//
// Redis 에 180일 쌓이는 실사용 대화(flowvium:judge-chat:index → conv)를 현행 chat-verify 룰로 전수
// 재판정해, *전 턴 클린*인 대화만 SFT 연료(JSONL)로 스냅샷. AISVI ■5 교훈(연료 loop 는 프로듀서-컨슈머
// 3단이 다 있어야) — 대화 저장(프로듀서)만 있고 굽는 컨슈머가 없던 갭의 컨슈머.
//   채택 기준(엄격): 모든 assistant 턴 결함 0(15종) · 각 답변 60~4000자 · fallback 문구 아님.
//   산출: fuel/chat-sft-history.jsonl (매 실행 전량 재생성 — 중복 append 없는 멱등 스냅샷)
//        + rejected 사유 통계 콘솔. 대화 단위 1레코드(멀티턴 SFT 용 messages 원문 포함).
// 사용: node scripts/sft/build-chat-fuel.mjs [--n=2000] [--out=G:/내 드라이브/0.SFT_Flovium]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import { checkChatDefects } from '../lib/chat-verify.mjs';

const N = Number((process.argv.find(a => a.startsWith('--n=')) || '--n=2000').split('=')[1]);
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '--out=G:/내 드라이브/0.SFT_Flovium').split('=').slice(1).join('=');
mkdirSync(resolve(OUT, 'fuel'), { recursive: true });

const r = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 2 });
try {
  const rows = await r.lrange('flowvium:judge-chat:index', 0, N - 1);
  const idx = rows.map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  const byKey = new Map();                                  // conv 키 → 최신 index 메타 (중복 POST 제거)
  for (const e of idx) if (e.key && !byKey.has(e.key)) byKey.set(e.key, e);
  const keys = [...byKey.keys()];
  const fuel = [];
  const rejectWhy = {};
  const reject = (why) => { rejectWhy[why] = (rejectWhy[why] ?? 0) + 1; };
  for (let i = 0; i < keys.length; i += 100) {
    const vals = keys.length ? await r.mget(keys.slice(i, i + 100)) : [];
    for (let j = 0; j < vals.length; j++) {
      if (!vals[j]) { reject('conv_expired'); continue; }
      let conv; try { conv = JSON.parse(vals[j]); } catch { reject('parse_fail'); continue; }
      const msgs = (conv.messages ?? []).filter(m => m?.role && typeof m.content === 'string');
      const assist = msgs.filter(m => m.role === 'assistant');
      if (!assist.length || !msgs.some(m => m.role === 'user')) { reject('empty'); continue; }
      const meta = byKey.get(keys[i + j]) ?? {};
      const g = { tickers: (Array.isArray(meta.tickers) ? meta.tickers : []).map(t => ({ ticker: String(t), price: NaN })) };
      let bad = null;
      for (let k = 0; k < msgs.length && !bad; k++) {
        if (msgs[k].role !== 'assistant') continue;
        const answer = msgs[k].content;
        if (answer.length < 60 || answer.length > 4000) { bad = 'length'; continue; }
        const question = msgs.slice(0, k).reverse().find(m => m.role === 'user')?.content ?? '';
        const locale = /[\u3040-\u30FF]/.test(answer) ? 'ja' : (/[가-힣]/.test(question) || /[가-힣]/.test(answer)) ? 'ko' : 'en';
        const defects = checkChatDefects(question, answer, g, locale);
        if (defects.length) bad = `defect:${defects[0].type}`;
      }
      if (bad) { reject(bad); continue; }
      fuel.push({
        id: `hist-${conv.id ?? keys[i + j].split(':').pop()}`, origin: 'history', ts: meta.ts ?? null,
        mode: conv.mode ?? null, source: conv.source ?? null, tickers: meta.tickers ?? [],
        turns: assist.length, messages: msgs,
      });
    }
  }
  const file = resolve(OUT, 'fuel', 'chat-sft-history.jsonl');
  writeFileSync(file, fuel.map(x => JSON.stringify(x)).join('\n') + (fuel.length ? '\n' : ''), 'utf8');
  console.log(`=== SFT 연료 채굴: 대화 ${keys.length}개 스캔 → 클린 ${fuel.length}개 채택 (${keys.length ? Math.round(fuel.length / keys.length * 100) : 0}%) ===`);
  console.log(`reject 사유: ${JSON.stringify(rejectWhy)}`);
  console.log(`→ ${file} (멱등 스냅샷 — 매 실행 전량 재생성)`);
  const turns = fuel.reduce((s, x) => s + x.turns, 0);
  console.log(`총 Q/A 턴: ${turns} (멀티턴 대화 ${fuel.filter(x => x.turns >= 2).length}개 포함)`);
} finally { r.disconnect(); }
