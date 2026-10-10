#!/usr/bin/env node
/**
 * ask-chatgpt.mjs — ChatGPT(전용 프로필, spinaiceo)에 한 번 묻고 답을 찍는다. lib/chatgpt.mjs.
 * 사용: node scripts/ask-chatgpt.mjs "질문"   (또는 표준입력으로 질문)
 */
import { ask } from './lib/chatgpt.mjs';
let q = process.argv.slice(2).join(' ').trim();
if (!q) { const chunks = []; for await (const c of process.stdin) chunks.push(c); q = Buffer.concat(chunks).toString('utf8').trim(); }
if (!q) { console.error('질문이 없다'); process.exit(2); }
try { console.log(await ask(q, { log: (m) => console.error(`[chatgpt] ${m}`) })); }
catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
