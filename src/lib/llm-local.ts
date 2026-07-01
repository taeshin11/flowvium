/**
 * src/lib/llm-local.ts — 로컬 vLLM 단일 진입점 (2026-06-15 Ollama→WSL/vLLM 이전).
 *
 * 배경(사용자): "모델이 다 같아야 — 보고서에 쓰는 모델로". 종전엔 Ollama 네이티브 /api/chat +
 *   qwen3:8b(think:false). 2026-06-15 로컬추론을 WSL2+vLLM(Qwen3.6-27B-AWQ-INT4) 로 이전 —
 *   OpenAI-compat /v1/chat/completions 로 전환. thinking off 는 chat_template_kwargs.enable_thinking
 *   =false (Qwen3 계열). 모델은 served-model-name 별칭(flowvium-local)로 고정 → 모델 교체는
 *   vLLM 런치 설정만 수정(앱 무변경).
 *
 * + 외국문자 bleeding 하네스: qwen(중국계)이 타언어 출력에 한자 누출 → hasChineseBleed 로 감지.
 *   (vLLM logit_bias 로 디코딩단 차단도 가능하나 토크나이저별 토큰ID 열거 필요 — locale-aware
 *    재생성 하네스를 그대로 유지. 추후 최적화 여지.)
 */
const VLLM_BASE = (process.env.VLLM_URL || 'http://127.0.0.1:8000/v1').replace(/\s+/g, '').replace(/\\n/g, '').replace(/\/+$/, '');
const VLLM_CHAT = `${VLLM_BASE}/chat/completions`;
export const LOCAL_MODEL = process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local';

// ── 2026-06-12 GPU 과부하 보호 (사용자 "컴퓨터 꺼지지 않게 조치 철저히") ─────────────────
//   웹 경유 Ollama 호출은 트래픽 비례 무한 큐 적체 가능(6/12 16:00~16:28 /api/chat 516건,
//   GPU 96%/82°C 28분 — 6/7 hard freeze 기여 의심 패턴). 동시 2 + 대기 8 + 대기 15s 상한.
//   초과분은 즉시 null → 상위(callAI cloud / 원문 fallback)가 처리. GPU 는 보고서가 우선.
const OLLAMA_MAX_CONCURRENT = 2;
const OLLAMA_MAX_WAITING = 8;
const OLLAMA_WAIT_MS = 15000;
let ollamaActive = 0;
const ollamaWaiters: Array<() => void> = [];
async function ollamaAcquire(): Promise<boolean> {
  if (ollamaActive < OLLAMA_MAX_CONCURRENT) { ollamaActive++; return true; }
  if (ollamaWaiters.length >= OLLAMA_MAX_WAITING) return false;
  const ok = await new Promise<boolean>((res) => {
    const waiter = () => { clearTimeout(timer); res(true); };
    const timer = setTimeout(() => {
      const i = ollamaWaiters.indexOf(waiter);
      if (i >= 0) ollamaWaiters.splice(i, 1);
      res(false);
    }, OLLAMA_WAIT_MS);
    ollamaWaiters.push(waiter);
  });
  if (ok) ollamaActive++;
  return ok;
}
function ollamaRelease(): void {
  ollamaActive--;
  const next = ollamaWaiters.shift();
  if (next) next();
}

export async function localChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!(await ollamaAcquire())) return null; // GPU 포화 — cloud/원문 fallback 에 위임
  try {
    const res = await fetch(VLLM_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.1,
        // Qwen3 thinking 비활성 — vLLM OpenAI 서버는 chat_template_kwargs 로 전달.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const t = (d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return t || null;
  } catch {
    return null;
  } finally {
    ollamaRelease();
  }
}

// ── 외국문자 bleeding 하네스 (2026-06-07: 타 프로그램 vLLM logit_bias 기법 차용) ─────────────
//   vLLM 은 디코딩단계 logit_bias=-100 로 외국문자 토큰 자체를 차단. Ollama(0.21.2)는 logit_bias
//   미지원 → 생성 후 *결정론적 검사*로 동등 효과(감지 시 재생성/거부). 그쪽의 포괄적 스크립트 범위를
//   locale-aware 로 차용: 각 locale 의 "기대 스크립트" 외 외국문자 출현 = bleed.
const SCRIPTS = {
  han: /[\u2E80-\u2FDF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g,  // CJK 한자 6블록 BMP(부수2E80-2FDF·ExtA·Unified·Compat F900-FAFF). ES5 타겟이라 /u astral 제외
  hangul: /[가-힣]/,        // 한글
  kana: /[぀-ヿ]/,          // 히라가나·가타카나
  cyrillic: /[Ѐ-ӿ]/,      // 키릴(러시아)
  thai: /[฀-๿]/,          // 태국
  arabic: /[؀-ۿ]/,        // 아랍
  devanagari: /[ऀ-ॿ]/,    // 데바나가리(힌디)
};
/**
 * target locale 에 부적절한 외국 스크립트가 샜는지 결정론적 감지(qwen 누출).
 *   locale 별 허용 스크립트만 통과 — 나머지 스크립트 출현 시 bleed=true.
 *   한자는 고유명사 1개 허용 위해 ko/en 에서 2개+ 만 bleed(나머지 스크립트는 1개라도).
 */
export function hasChineseBleed(text: string, locale: string): boolean {
  if (!text) return false;
  const hanCount = (text.match(SCRIPTS.han) || []).length;
  switch (locale) {
    case 'zh-CN': case 'zh-TW':
      return SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text);
    case 'ja':  // 한자·가나 정상, 한글/기타 = bleed
      return SCRIPTS.hangul.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text);
    case 'ko':  // 한글 정상, 한자 2개+/기타 스크립트 = bleed
      return hanCount >= 1 || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text); // 2026-07-01 zero-Hanja: ko 는 한자 1개도 bleed(owner 정책)
    case 'ru':  // 키릴 정상
      return hanCount >= 2 || SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text);
    case 'ar':
      return hanCount >= 2 || SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.devanagari.test(text);
    case 'hi':
      return hanCount >= 2 || SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text);
    case 'th':
      return hanCount >= 2 || SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text);
    default:    // Latin 계열(en/es/fr/de/pt/id/tr/vi): 모든 비-Latin 스크립트 = bleed (한자 2개+)
      return hanCount >= 2 || SCRIPTS.hangul.test(text) || SCRIPTS.kana.test(text) || SCRIPTS.cyrillic.test(text) || SCRIPTS.thai.test(text) || SCRIPTS.arabic.test(text) || SCRIPTS.devanagari.test(text);
  }
}

/**
 * bleed-free 번역 — localChat 호출 후 bleed 감지 시 1회 재생성(강한 제약). vLLM logit_bias 의
 *   Ollama 대체(디코딩 마스킹 불가 → 생성후 검사+재시도). 끝까지 bleed 면 null(상위서 fallback).
 */
export async function localChatNoBleed(
  prompt: string,
  locale: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  let out = await localChat(prompt, opts);
  if (out && !hasChineseBleed(out, locale)) return out;
  // 재시도 — 외국문자 금지 명시 강화.
  const strict = `${prompt}\n\nIMPORTANT: Output ONLY in the target language. Do NOT include Chinese characters, Cyrillic, kana, or any other foreign script.`;
  out = await localChat(strict, { ...opts, temperature: 0 });
  return out && !hasChineseBleed(out, locale) ? out : null;
}
