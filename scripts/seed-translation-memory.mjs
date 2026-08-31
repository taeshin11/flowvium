#!/usr/bin/env node
/**
 * seed-translation-memory.mjs — 확정 번역을 27B(:8000)로 채운다.
 *
 * 왜 필요한가(2026-08-20 실측): 웹 레인은 4B(:8001)이고 금융 용어를 틀린다.
 *     industrial conglomerate → "산업 컨glomerate"(깨짐)  Short squeeze candidate → "단축 압력 후보"(오역)
 *   레인을 27B 로 되돌리면 보고서와 GPU 경합이 재발하므로, 반복 용어만 27B 품질로 미리 확정한다.
 *
 * 언제 돌리나: 보고서가 안 도는 시간대. 27B 는 짧은 구절에 1~2초다.
 *
 * 2026-08-31 — 이 잡이 8일간 산출 0 인 채로 27B 를 매시 깨우고 있었다(mlx.log :25 = 4일 421회,
 *   idle 시간대 최대 소비자. translation_memory 의 마지막 27B 행은 08-23).
 *   원인은 아래 루프에 실패를 기억하는 곳이 없다는 것이었다. 성공하면 backlog.resolve() 로
 *   빠지지만 가드가 거부한 것은 아무 데도 안 남아서, 다음 회차에 같은 문자열이 또 온다.
 *   그리고 그것들은 원리적으로 번역이 안 되는 것들이었다(실행 로그):
 *     ✗ EWY 1w, F&G → "EWY 1주, F&G"   ✗ TSM 1w, 59 → "TSM 1주, 59"   ✗ tyChg3m → tyChg3m
 *   전부 data/translation-seed-terms.json 에 섞여 들어간 차트 툴팁 조각·데이터 필드명이다.
 *   시드 파일에서 그 7건을 지우는 건 이번 입력만 막는 대응이라 하지 않았다 — 다음에 또 섞인다.
 *   대신 backlog 에 소진 판정을 두고 여기서 그걸 본다(translation-backlog.mjs 참조).
 * 사용: node scripts/seed-translation-memory.mjs [--locales=ko,ja] [--limit=N] [--dry]
 */
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ROOT } from './lib/project-root.mjs';
import { openMemory } from './lib/translation-memory.mjs';
import { openBacklog, MAX_GUARD_FAILURES } from './lib/translation-backlog.mjs';
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

const seedTerms = JSON.parse(readFileSync(resolve(ROOT, 'data/translation-seed-terms.json'), 'utf8')).terms;

// 대기열이 먼저다. 거기 있는 건 '실제로 사용자에게 영문이 노출된' 문자열이고,
// 시드 목록은 그럴 것이라 예상한 것이다. 실측이 예상보다 우선한다.
const backlog = openBacklog(resolve(ROOT, 'data/flowvium.db'));

async function translate(text, locale) {
  const res = await fetch(`${REPORT_LANE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 256, temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },   // thinking 켜두면 예산을 사고에 소진해 본문이 안 나온다(실측)
      messages: [{ role: 'user', content: buildTranslatePrompt({ text, langName: LANG_NAME[locale] ?? locale }) }],
    }),
    // 2026-08-20 실측: 27B 는 segments-refresh(20분마다 10-K 추출, 4,609토큰 프리필)와 상시 경합한다.
    //   120s 로는 대기 중에 끊겨 8/8 전부 실패했다. 재시도로 덮지 않고 실제 대기시간에 맞춘다 —
    //   이 잡은 배경 품질개선이라 느려도 되지만, 조용히 실패하면 사전이 영영 안 찬다.
    signal: AbortSignal.timeout(Number(process.env.SEED_TIMEOUT_MS) || 300_000),
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
let added = 0, skipped = 0, failed = 0, exhausted = 0;

/** 가드가 거부했다. 결정론적 실패이므로 소진 카운터를 올린다. */
function reject(text, locale, reason, out) {
  console.log(`  ✗ ${text} → ${reason}: ${JSON.stringify(out)}`);
  backlog.recordFailure(text, locale, reason);
  if (backlog.isExhausted(text, locale)) console.log(`     └ ${MAX_GUARD_FAILURES}회 거부 — 더 시도하지 않는다(27B 를 깨우지 않음)`);
  failed++;
}
for (const locale of LOCALES) {
  const queued = backlog.pending(locale).map(r => r.text);
  if (queued.length) console.log(`  [${locale}] 대기열 ${queued.length}건 (실제 노출 사례) + 시드 ${seedTerms.length}건`);
  // 대기열과 시드 목록은 겹친다 — 가드가 거부한 시드 용어는 그 순간부터 대기열에도 생기기 때문이다.
  // 중복을 안 걷으면 한 런에서 같은 문자열을 두 번 번역한다(실측: 2회차에 7건이 각각 두 번 호출됐다).
  const seen = new Set();
  const terms = [...queued, ...seedTerms].filter((t) => {
    const k = String(t).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let n = 0;
  for (const text of terms) {
    if (n >= LIMIT) break;
    if (tm.lookup(text, locale)) { skipped++; continue; }
    // 여기서 거르는 게 핵심이다 — 27B 를 아예 안 깨운다. 이 검사가 없어서 같은 정크가
    // 매시간 LIMIT 예산을 전부 먹었다(실측 '등록 0 · 건너뜀 98 · 실패 7' 이 11일 반복).
    if (backlog.isExhausted(text, locale)) { exhausted++; continue; }
    n++;
    try {
      const out = await translate(text, locale);
      // 가드 거부는 *결정론적* 이다 — 같은 입력에 같은 결과. 그러므로 소진으로 센다.
      if (isUntranslated(out, locale)) { reject(text, locale, 'untranslated', out); continue; }
      // 음차 중단("케urig 드피퍼")을 사전에 넣으면 깨진 번역이 영구히 박힌다. 27B 도 고유명사에서 낸다.
      if (hasScriptSplice(out, locale)) { reject(text, locale, 'script-splice', out); continue; }
      if (DRY) { console.log(`  (dry) ${text} → ${out}`); continue; }
      if (tm.remember(text, locale, out, { source: SOURCE })) { added++; backlog.resolve(text, locale); }
      else skipped++;
      console.log(`  ✓ ${locale}  ${text}  →  ${out}`);
    } catch (e) {
      // 타임아웃·HTTP 는 *서버* 사정이다. 이걸 소진으로 세면 08-28~08-31 처럼 서버가 3일 죽었을 때
      // 멀쩡한 용어가 통째로 은퇴한다 — 복구가 두 번째 사고를 내는 형태다.
      console.log(`  ✗ ${text} — ${e.message} (일시적 — 소진으로 세지 않음)`);
      backlog.recordFailure(text, locale, e.message, { transient: true });
      failed++;
    }
  }
}
console.log(`\n등록 ${added} · 건너뜀 ${skipped} · 실패 ${failed}${exhausted ? ` · 소진 ${exhausted}(27B 미호출)` : ''}`);
if (failed > 0 && added === 0) {
  console.log('  ⚠️ 한 건도 못 넣었다 — 27B 경합(보고서/segments-refresh) 가능성. 다음 회차에 재시도된다.');
}
console.log('  현재 사전:', JSON.stringify(tm.stats()));
for (const locale of LOCALES) {
  const left = backlog.pending(locale).length;
  if (left) console.log(`  [${locale}] 대기열 잔여 ${left}건 — 다음 실행에서 재시도`);
}
backlog.close();
tm.close();
