#!/usr/bin/env node
/**
 * seed-translation-memory.mjs — 확정 번역을 27B(:8000)로 채운다.
 *
 * 왜 필요한가(2026-08-20 실측): 웹 레인은 4B(:8001)이고 금융 용어를 틀린다.
 *     industrial conglomerate → "산업 컨glomerate"(깨짐)  Short squeeze candidate → "단축 압력 후보"(오역)
 *   레인을 27B 로 되돌리면 보고서와 GPU 경합이 재발하므로, 반복 용어만 27B 품질로 미리 확정한다.
 *
 * 언제 돌리나: 보고서가 안 도는 시간대. 27B 는 짧은 구절에 1~2초다.
 * 사용: node scripts/seed-translation-memory.mjs [--locales=ko,ja] [--limit=N] [--dry]
 */
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import { openMemory } from './lib/translation-memory.mjs';
import { buildTranslatePrompt } from './lib/translate-prompt.mjs';
import { isUntranslated } from './lib/lang-detect.mjs';
import { hasScriptSplice } from './lib/script-splice.mjs';
import { sanitizeText } from './lib/narrative-fix.mjs';

const REPORT_LANE = process.env.REPORT_LLM_URL || 'http://127.0.0.1:8000/v1';
const MODEL = process.env.VLLM_MODEL || 'default_model';
const SOURCE = 'qwen3.8-27b';
const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const DRY = process.argv.includes('--dry');
const LOCALES = arg('locales', 'ko').split(',').filter(Boolean);
const LIMIT = Number(arg('limit', '0')) || Infinity;

const LANG_NAME = { ko: '한국어', ja: '日本語', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch',
  pt: 'Português', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी', id: 'Bahasa Indonesia', th: 'ไทย',
  vi: 'Tiếng Việt', tr: 'Türkçe', it: 'Italiano', nl: 'Nederlands' };

const terms = JSON.parse(readFileSync(resolve(ROOT, 'data/translation-seed-terms.json'), 'utf8')).terms;

async function translate(text, locale) {
  const res = await fetch(`${REPORT_LANE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 256, temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },   // thinking 켜두면 예산을 사고에 소진해 본문이 안 나온다(실측)
      messages: [{ role: 'user', content: buildTranslatePrompt({ text, langName: LANG_NAME[locale] ?? locale }) }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const c = d.choices?.[0]?.message?.content;
  // content 부재는 '빈 번역'이 아니라 실패다 — 빈 문자열로 뭉개면 실패가 사전에 박힌다.
  if (typeof c !== 'string' || !c.trim()) throw new Error(`content 없음 (finish=${d.choices?.[0]?.finish_reason})`);
  // 이 출력은 그대로 사용자에게 보이는 한국어 산문이므로 한자 가드를 태운다
  // (check-hanja-coverage 가 이 파일을 LLM 출력표면으로 잡는다 — 분류로 넘기지 않고 실제로 경유시킨다).
  return sanitizeText(c.trim(), locale);
}

const tm = openMemory(resolve(ROOT, 'data/flowvium.db'));
let added = 0, skipped = 0, failed = 0;
for (const locale of LOCALES) {
  let n = 0;
  for (const text of terms) {
    if (n >= LIMIT) break;
    if (tm.lookup(text, locale)) { skipped++; continue; }
    n++;
    try {
      const out = await translate(text, locale);
      if (isUntranslated(out, locale)) { console.log(`  ✗ ${text} → 번역 안 됨: ${JSON.stringify(out)}`); failed++; continue; }
      // 음차 중단("케urig 드피퍼")을 사전에 넣으면 깨진 번역이 영구히 박힌다. 27B 도 고유명사에서 낸다.
      if (hasScriptSplice(out, locale)) { console.log(`  ✗ ${text} → 음차 중단: ${JSON.stringify(out)}`); failed++; continue; }
      if (DRY) { console.log(`  (dry) ${text} → ${out}`); continue; }
      tm.remember(text, locale, out, { source: SOURCE }) ? added++ : skipped++;
      console.log(`  ✓ ${locale}  ${text}  →  ${out}`);
    } catch (e) { console.log(`  ✗ ${text} — ${e.message}`); failed++; }
  }
}
console.log(`\n등록 ${added} · 건너뜀 ${skipped} · 실패 ${failed}`);
console.log('  현재 사전:', JSON.stringify(tm.stats()));
tm.close();
