/**
 * agy-models.mjs — agy 에 넘길 모델 이름을 **한 곳에서** 정한다. (2026-10-13 신설)
 *
 * 실측(10/13 12:10): agy 서버 목록에서 gemini-3.1-pro-high · gemini-3.7-flash-high · claude-opus-4-6-thinking 이
 *   사라졌다. agy 실행파일은 10/10 그대로였다 — 서버 쪽 목록이 바뀐 것이다. 이름이 코드 곳곳(8군데)에
 *   박혀 있어 모든 agy 호출이 "is not recognized" 로 떨어졌고, 쇼츠 대본이 로컬 4B 로 내려가
 *   없는 직함("한동훈 주한미대사")을 지어낸 편이 공개됐다.
 * 그래서: 선호 순서는 여기 두되, **지금 서버가 받는 이름만** 쓴다(`agy models` 목록으로 거른다).
 *   목록은 logs/agy-models.json 에 1시간 둔다(`agy models` 는 몇 초 걸린다). 목록을 못 읽으면 거르지 않는다 —
 *   모르는 상태로 사슬을 비우면 그게 더 나쁘다. "not recognized" 를 보면 부르는 쪽이 forgetAgyModels() 로 버린다.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 글. 순서가 선호다. **gemini 만** — 9/24~25 실측에서 claude-opus 37회·gpt-oss 4회가 503·할당량 소진으로
//   떨어졌고 gemini 는 0회였다(사장님 "gemini 쓰면되지", agy-chain/agy-two-tier 테스트가 지킨다).
//   3.1 pro 가 돌아오면 다시 1차가 된다(목록에 있으면 쓴다). 10/13 지금 남은 gemini 는 3.8 flash high/medium/low.
export const PREFERRED_TEXT = Object.freeze([
  'gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'gemini-3.7-flash-high', 'gemini-3.8-flash-medium',
]);
// 주제 분류(topic-classify) 전용. 2026-10-15 — 근거는 topic-classify.test.mjs [7]: 같은 60편에서 argon 82%·실패 0,
//   flash-high 는 도구 없이도 180초 한계에 붙고 검색을 돌다 끊겼다. 짧은 분류에 긴 생각은 시간만 먹는다.
export const PREFERRED_CLASSIFY = Object.freeze([
  'gemini-4-argon-medium', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
]);
// 검증(사실 확인·문장 근거 판정·교차검증의 gemini 쪽·그림 검증). 2026-10-15 사장님 "agy 검증에는 gemini4 argon medium".
//   뒤 칸은 argon 이 서버 목록에서 빠졌을 때만 쓴다(10/13 이름 퇴출로 전 호출이 떨어진 일 — agy-model-names-vanish).
export const PREFERRED_VERIFY = Object.freeze([
  'gemini-4-argon-medium', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium',
]);
// 그림(프레임) 보기. cross-check 는 claude 를 썼다(9/23 gemini 3.x 이미지 503 실측), video-eye 는 gemini 3.1 pro 를 썼다.
//   10/15 실측: argon-medium 은 그림을 읽는다(테스트 그림 3장 색·위치·개수 모두 맞힘, 17~21초) → 검증 지시대로 1순위.
export const PREFERRED_EYE = Object.freeze([
  'gemini-4-argon-medium', 'gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'claude-opus-5-5-medium', 'claude-sonnet-5-5-medium',
]);
export const PREFERRED_VISION = Object.freeze([
  'gemini-4-argon-medium', 'claude-opus-4-6-thinking', 'claude-opus-5-5-medium', 'claude-sonnet-5-5-medium', 'gemini-3.8-flash-high',
]);

const TTL_MS = 60 * 60 * 1000;
const cacheFile = () => process.env.AGY_MODELS_FILE
  || fileURLToPath(new URL('../../logs/agy-models.json', import.meta.url));

/** `agy models` 출력에서 이름(첫 칸)만. 머리말("Fetching …")은 버린다. */
export function parseModelList(text) {
  return String(text ?? '').split('\n')
    .map((l) => /^([a-z][a-z0-9.-]+)\t/.exec(l.trim() + (l.includes('\t') ? '' : '\t'))?.[1])
    .filter((m) => m && /-/.test(m) && !/^fetching$/i.test(m));
}

function bin() {
  const cands = [process.env.AGY_BIN, join(process.env.HOME ?? '', '.local/bin/agy'), '/usr/local/bin/agy'];
  return cands.find((c) => c && existsSync(c)) ?? null;
}

let _mem = null;
/** 지금 서버가 받는 이름들. 못 읽으면 null(=모른다). */
export function agyModels() {
  if (process.env.AGY_MODELS_LIST) return process.env.AGY_MODELS_LIST.split(',').map((x) => x.trim()).filter(Boolean);
  if (_mem) return _mem;
  try {
    const c = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    if (Array.isArray(c.models) && c.models.length && Date.now() - Date.parse(c.at) < TTL_MS) return (_mem = c.models);
  } catch { /* 없으면 새로 읽는다 */ }
  const b = bin();
  if (!b) return null;
  const r = spawnSync(b, ['models'], { encoding: 'utf8', timeout: 60000 });
  const models = r.status === 0 ? parseModelList(r.stdout) : [];
  if (!models.length) return null;
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ at: new Date().toISOString(), models }));
  } catch { /* 캐시는 덤 */ }
  return (_mem = models);
}

/** "not recognized" 를 본 쪽이 부른다 — 다음 호출이 목록을 새로 읽는다. */
export function forgetAgyModels() {
  _mem = null;
  try { rmSync(cacheFile(), { force: true }); } catch { /* 없으면 그만 */ }
}

/**
 * 선호 목록 중 살아 있는 것만, 순서 그대로. 목록을 모르면(null) 그대로 둔다.
 * 하나도 안 남으면 전체 선호 목록에서 살아 있는 것으로 채운다 — 빈 사슬은 "로컬 4B 로 대본" 이 된다.
 */
export function pickAvailable(preferred, avail = agyModels()) {
  if (!avail) return [...preferred];
  const live = preferred.filter((m) => avail.includes(m));
  if (live.length) return live;
  const any = [...new Set([...PREFERRED_TEXT, ...PREFERRED_VERIFY, ...PREFERRED_EYE, ...PREFERRED_VISION])].filter((m) => avail.includes(m));
  return any.length ? any : avail.slice(0, 1);
}

/** 글 모델 하나(사슬이 없는 호출부용). AGY_TEXT_MODEL 이 있으면 그것을 앞에 둔다. */
export function defaultTextModel() {
  return pickAvailable([process.env.AGY_TEXT_MODEL, ...PREFERRED_TEXT].filter(Boolean))[0];
}
export function defaultEyeModel() {
  return pickAvailable([process.env.AGY_EYE_MODEL, ...PREFERRED_EYE].filter(Boolean))[0];
}
/** 교차검증용 — 계열이 다른 둘(gemini 하나, claude 하나). */
export function crossCheckModels() {
  const live = pickAvailable(PREFERRED_VERIFY);
  const g = live.find((m) => m.startsWith('gemini-'));
  const c = pickAvailable(PREFERRED_VISION).find((m) => m.startsWith('claude-'));
  return [g, c].filter(Boolean);
}
/** 검증 호출용 사슬 — 지금 서버가 받는 이름만. */
export function verifyChain() {
  return pickAvailable(PREFERRED_VERIFY);
}
export function defaultVisionModel() {
  return pickAvailable(PREFERRED_VISION)[0];
}
