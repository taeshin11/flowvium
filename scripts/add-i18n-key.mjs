#!/usr/bin/env node
/**
 * add-i18n-key.mjs — UI 문자열을 16개 로케일 메시지 키로 한 번에 넣는다.
 *
 * 배경(2026-08-20): i18n 래칫 baseline 2,781건 중 실제 UI 부채는
 *   src/components/pages(594) + src/app/[locale](511) 쪽이다(나머지 1,491건은 api 의 로그 태그·프롬프트).
 *   줄이려면 키를 16개 로케일에 넣어야 하는데 손으로 하면 꼭 빠뜨린다 —
 *   빠뜨린 로케일은 런타임 MISSING_MESSAGE 로 깨진다(이번 세션에 실제로 겪음).
 *
 * 번역은 27B(:8000)로 한다. 웹 레인(4B)은 금융·UI 용어를 틀리는 게 실측으로 확인됐다.
 * 보고서가 도는 중이면 GPU 를 다투므로 돌리지 말 것(cron 이 아니라 수동 도구다).
 *
 * 사용: node scripts/add-i18n-key.mjs <키경로> "<영문 원문>" [--dry]
 *   예: node scripts/add-i18n-key.mjs home.breadth "Breadth"
 */
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { listLocales, setKey, missingLocales, getKey } from './lib/i18n-keys.mjs';
import { buildTranslatePrompt } from './lib/translate-prompt.mjs';
import { hasScriptSplice } from './lib/script-splice.mjs';
import { openMemory } from './lib/translation-memory.mjs';
import { readFileSync } from 'fs';

const MESSAGES = resolve(ROOT, 'messages');
const REPORT_LANE = process.env.REPORT_LLM_URL || 'http://127.0.0.1:8000/v1';
const DRY = process.argv.includes('--dry');
const [, , keyPath, sourceText] = process.argv;

if (!keyPath || !sourceText) {
  console.error('사용: node scripts/add-i18n-key.mjs <키경로> "<영문 원문>" [--dry]');
  process.exit(2);
}

// 로케일 코드 → 언어명. 모르는 코드는 코드 그대로 넘겨 모델이 판단하게 둔다(창작 금지 원칙).
const LANG = { en: 'English', ko: '한국어', ja: '日本語', 'zh-CN': '简体中文', 'zh-TW': '繁體中文',
  es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ru: 'Русский', ar: 'العربية',
  hi: 'हिन्दी', id: 'Bahasa Indonesia', th: 'ไทย', vi: 'Tiếng Việt', tr: 'Türkçe' };

async function translate(text, locale) {
  const r = await fetch(`${REPORT_LANE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.VLLM_MODEL || 'default_model', max_tokens: 200, temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },   // thinking 켜두면 예산을 사고에 소진해 본문이 안 나온다(실측)
      messages: [{ role: 'user', content: buildTranslatePrompt({
        text, langName: LANG[locale] ?? locale, context: 'UI 라벨 — 짧고 자연스럽게. 설명 붙이지 말 것.' }) }],
    }),
    signal: AbortSignal.timeout(Number(process.env.SEED_TIMEOUT_MS) || 300_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const c = d.choices?.[0]?.message?.content;
  if (typeof c !== 'string' || !c.trim()) throw new Error(`content 없음 (finish=${d.choices?.[0]?.finish_reason})`);
  return c.trim().replace(/^["']|["']$/g, '');
}

const locales = listLocales(MESSAGES);
console.log(`  키 ${keyPath} · 원문 ${JSON.stringify(sourceText)} · 로케일 ${locales.length}개`);
const tm = openMemory(resolve(ROOT, 'data/flowvium.db'));
let done = 0, skipped = 0, failed = 0;

for (const loc of locales) {
  const cur = getKey(JSON.parse(readFileSync(resolve(MESSAGES, `${loc}.json`), 'utf8')), keyPath);
  if (cur !== undefined) { skipped++; continue; }
  let value = sourceText;
  if (loc !== 'en') {
    // 확정 번역 사전을 먼저 본다 — 같은 용어를 매번 GPU 로 보낼 이유가 없다.
    const memo = tm.lookup(sourceText, loc);
    if (memo) value = memo;
    else {
      try {
        value = await translate(sourceText, loc);
        if (hasScriptSplice(value, loc)) { console.log(`  ✗ ${loc}: 음차 중단 ${JSON.stringify(value)}`); failed++; continue; }
        tm.remember(sourceText, loc, value, { source: 'qwen3.8-27b' });
      } catch (e) { console.log(`  ✗ ${loc}: ${e.message}`); failed++; continue; }
    }
  }
  if (DRY) { console.log(`  (dry) ${loc}: ${value}`); continue; }
  setKey(MESSAGES, loc, keyPath, value) ? (console.log(`  ✓ ${loc}: ${value}`), done++) : failed++;
}
tm.close();

const missing = missingLocales(MESSAGES, keyPath);
console.log(`\n  추가 ${done} · 이미 있음 ${skipped} · 실패 ${failed}`);
if (missing.length && !DRY) {
  console.log(`  🚨 여전히 누락된 로케일 ${missing.length}개: ${missing.join(', ')} — 그 로케일은 런타임에 깨진다`);
  process.exit(1);
}
if (!DRY) console.log('  ✅ 전 로케일 보유');
