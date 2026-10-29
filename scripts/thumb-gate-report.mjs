#!/usr/bin/env node
/**
 * thumb-gate-report.mjs — 오늘(KST) 썸네일 관문: 올린 편·안 올린 편(held)·건너뛴 슬롯(skipped)과 점수 셋. 22:00 보고에 붙인다.
 *   10/28 저녁 정정(사장님): 점수를 받아야 올린다 — 미달은 올리지 않고 표시한다.
 *   근거: logs/thumb-gate.jsonl 의 'uploaded' 줄(video-publish·make-market-brief 가 업로드마다 남긴다, lib/thumb-gate).
 *   사용: node scripts/thumb-gate-report.mjs [--day 2026-10-28]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/project-root.mjs';
import { decide } from './lib/thumb-gate.mjs';

const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

// 지금 기준으로 다시 판정한다 — 기준이 하루에 세 번 바뀌었다(10/28: 셋 다 8 → 8·8·7.5 → 셋 다 7 + 하나 7.5). 점수가 셋 다 있으면 다시 매기고, 아니면 저장된 판정.
const passNow = (x) => (['chatgpt', 'agy', 'claude'].every((k) => typeof x[k] === 'number')
  ? decide({ chatgpt: { score: x.chatgpt }, agy: { score: x.agy }, claude: { score: x.claude } }, undefined, x.bar?.floor ? x.bar : undefined).pass : !!x.passed);
// 10/29: 채널 성적 기준(잘 되는 주 7.0·7.5)으로 매긴 줄은 그 기준(x.bar)으로 — 그 전 줄은 기본 7.5·8.

export function summarize(lines, day) {
  const today = lines.filter((x) => kstDay(x.at) === day).map((x) => ({ ...x, passed: passNow(x), flagged: passNow(x) ? null : (x.flagged ?? '지금 기준 미달(올릴 땐 그때 기준으로 통과)') }));
  const ups = today.filter((x) => x.event === 'uploaded');
  const held = today.filter((x) => x.event === 'held');
  const skipped = today.filter((x) => x.event === 'skipped');
  const out = [`썸네일 관문 ${day}: 올린 ${ups.length}편(통과 ${ups.filter((x) => x.passed).length}) · 안 올림 ${held.length}편 · 건너뛴 슬롯 ${skipped.length}`];
  const hm = (x) => new Date(Date.parse(x.at) + 9 * 3600e3).toISOString().slice(11, 16);
  const kind = (x) => (x.kind === 'long' ? `롱폼${x.edition ? `(${x.edition})` : ''}` : '쇼츠');
  for (const x of [...ups, ...held].sort((a, b) => a.at.localeCompare(b.at))) {
    const mark = x.event === 'held' ? '✋' : x.passed ? '✅' : '⚠';
    out.push(`${mark} ${hm(x)} ${kind(x)} ChatGPT ${x.chatgpt} · agy ${x.agy} · Claude ${x.claude}${x.rounds != null ? ` (${x.rounds}판)` : ''} "${x.text ?? ''}"${x.passed ? '' : ` — ${x.flagged}`} · ${String(x.title ?? '').replace(/\s*#Shorts/i, '').slice(0, 40)}`);
  }
  // 10/29 Mac mini2: 대기열 첨부 한도(.upload-limit)로 ChatGPT 가 못 매긴 판은 따로 센다 — 그 편은 실패(미채점)다
  const limit = today.filter((x) => x.event === 'gate' && /upload-limit|첨부 한도/.test(String(x.chatgptWhy ?? ''))).length;
  if (limit) out.push(`⚠ ChatGPT 첨부 한도 ${limit}번 — 그 판은 미채점(실패)`);
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--day');
  const day = i > 0 ? process.argv[i + 1] : kstDay(new Date().toISOString());
  const f = resolve(ROOT, 'logs/thumb-gate.jsonl');
  const lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  console.log(summarize(lines, day));
}
