/**
 * face-check.mjs — 사진 속 얼굴이 자막의 사람과 어긋나는가. (2026-09-29, 근거는 face-check.test.mjs 머리말)
 *   얼굴 수는 macOS Vision 으로 센다 — scripts/tools/facecount.swift 를 처음 한 번 ~/.flowvium-tools/facecount 로 굽는다.
 *   도구가 없거나 못 읽으면 null(모름) — 모르면 막지 않는다.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { ROOT } from './project-root.mjs';

const BIN = join(homedir(), '.flowvium-tools', 'facecount');
const SRC = resolve(ROOT, 'scripts/tools/facecount.swift');

function ensureBin() {
  if (existsSync(BIN)) return true;
  if (!existsSync(SRC)) return false;
  mkdirSync(join(homedir(), '.flowvium-tools'), { recursive: true });
  const r = spawnSync('swiftc', ['-O', SRC, '-o', BIN], { timeout: 180_000, encoding: 'utf8' });
  return r.status === 0 && existsSync(BIN);
}

/** 얼굴 수. 못 세면 null. */
export function faceCount(image) {
  if (!image || !existsSync(image) || !ensureBin()) return null;
  const r = spawnSync(BIN, [image], { timeout: 20_000, encoding: 'utf8' });
  const n = Number(String(r.stdout ?? '').trim());
  return r.status === 0 && Number.isInteger(n) && n >= 0 ? n : null;
}

// ── 한자 성씨 줄임 (2026-11-26, face-check.test [9]) ─────────────────────────────────────────
//   한국 기사 제목은 사람을 한자 성씨 한 글자로 줄인다 — 「韓총리」「李 "…"」「張 "…"」「尹대통령」.
//   그걸 몰라 「한성숙 총리」 자리에서 [포토] 韓총리 사진을 빼고 첫 장면이 회색 카드로 나갔다(__1CTMT_Q28).
//   韓 은 '한국'(韓증시·韓日)이기도 하다 — 그래서 뒤에 **따옴표·직함·끝**이 올 때만 사람으로 본다.
const HANJA_SURNAME = {
  李: '이', 尹: '윤', 韓: '한', 文: '문', 朴: '박', 金: '김', 崔: '최', 鄭: '정', 趙: '조', 姜: '강', 張: '장',
  林: '임', 吳: '오', 申: '신', 權: '권', 黃: '황', 安: '안', 宋: '송', 柳: '유', 洪: '홍', 全: '전', 高: '고',
  孫: '손', 秋: '추', 盧: '노', 曺: '조', 禹: '우', 元: '원', 丁: '정', 劉: '유', 兪: '유', 沈: '심', 許: '허',
  南: '남', 河: '하', 郭: '곽', 成: '성', 車: '차', 具: '구', 嚴: '엄', 羅: '나', 閔: '민', 任: '임', 池: '지',
  陳: '진', 方: '방', 呂: '여', 蔡: '채', 卞: '변', 魯: '노', 都: '도', 馬: '마', 奇: '기', 玄: '현', 孔: '공',
  康: '강', 延: '연', 陸: '육', 卓: '탁', 千: '천', 吉: '길', 薛: '설', 皮: '피', 白: '백', 徐: '서', 梁: '양',
  孟: '맹', 睦: '목', 裵: '배', 房: '방', 表: '표', 邊: '변', 慶: '경', 承: '승', 魏: '위', 明: '명', 夫: '부',
};
const ROLE_AFTER = '(?:대통령|부총리|총리|대표|장관|차관|의원|위원장|시장|지사|회장|원장|청장|대행|대변인|실장|후보|측)';
export function hanjaSurnameIn(lead, title) {
  const first = String(lead ?? '')[0];
  if (!first) return false;
  const t = String(title ?? '').replace(/&#0?39;|&quot;/g, "'");
  const re = new RegExp(`([\\u4E00-\\u9FFF])(?=\\s*(?:["'“”‘’「『]|${ROLE_AFTER}|[,·…|]|$))`, 'gu');
  for (const m of t.matchAll(re)) {
    const prev = t[m.index - 1] ?? '';
    if (/[\u4E00-\u9FFF·]/u.test(prev)) continue;   // 韓日·美中·美·韓 같은 나라 이름 묶음의 끝 글자는 아니다
    if (HANJA_SURNAME[m[1]] === first) return true;
  }
  // 한글 성씨 + 띄어 쓴 직함 — 「한 총리」「이 대통령」. 앞에 한글이 붙으면(「대한 총리실」) 사람이 아니다. 따옴표 뒤는 안 본다(「이 "…"」 는 지시어일 수 있다).
  const hangul = new RegExp(`(^|[^가-힣])${first}\\s${ROLE_AFTER}`, 'u');
  return hangul.test(t.replace(/&\w+;/g, ' '));
}

const squash = (s) => String(s ?? '').replace(/[\s·,.…"'“”‘’]/g, '');

/**
 * 얼굴이 있는 사진이 **다른 사람**일 가능성이 큰가 — 훅의 첫 말(주어)이 그 사진을 낸 기사 제목에 없으면 그렇다.
 * 얼굴 수·출처 제목을 모르면 false(막지 않는다).
 */
export function personMismatch({ hook, sourceTitle, faces, isPerson }) {
  // 2026-09-30: 첫 말이 **사람 이름일 때만**(personLeads). "부동산"·"선정된" 으로 사진을 빼 예비가 회색 카드로 거절됐다.
  if (isPerson !== true) return false;
  if (!faces || faces < 1 || !sourceTitle) return false;
  const lead = String(hook ?? '').trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';
  if (lead.length < 2) return false;
  return !nameIn(lead, sourceTitle);
}

/**
 * 빈 자리를 통과한 사진으로 채운다(한 이슈 편). 사진 하나는 두 번까지. 얼굴 검사로 비운 자리엔 같은 사람만(donorAllowed).
 *   2026-10-17: 한 자리에 줄 사진이 없으면 break 하던 것을 그 자리만 건너뛰게 — donorAllowed 가 생긴 뒤로
 *   '줄 게 없음' 은 그 자리 사정일 수 있다(릴스: 김민석 자리에서 멈춰 추미애 자리까지 카드). @returns 채운 수
 */
export function fillMediaGaps(scenes) {
  const good = scenes.filter((x) => !x.isOutro && x.media);
  const useCount = (m) => scenes.filter((x) => x.media === m).length;
  let filled = 0;
  for (const x of scenes) {
    if (x.isOutro || x.media) continue;
    const donor = good.find((g) => useCount(g.media) < 2 && donorAllowed(x, g));
    if (!donor) continue;
    x.media = donor.media; x.credit = donor.credit;
    filled += 1;
  }
  return filled;
}

/**
 * 첫 장면이 회색 카드로 나가지 않게 한다(2026-11-26, face-check.test [10]) — 쇼츠는 첫 3초·첫 프레임이 전부다.
 *   채우기 뒤에도 1번이 비면 다른 장면 사진을 1번으로 옮긴다(한 이슈 편: 그림만 옮긴다, 대본 순서는 그대로).
 *   1번 주어가 사람인데(faceSubject) 그 사람 사진이 없으면 옮기지 않는다 — false 를 돌려 회차를 거르게 한다.
 * @returns 1번에 그림이 있으면 true
 */
export function coverFirstScene(scenes) {
  const first = scenes.findIndex((x) => !x.isOutro);
  if (first < 0 || scenes[first].media) return true;
  const k = scenes.findIndex((x, i) => i !== first && !x.isOutro && x.media && donorAllowed(scenes[first], x));
  if (k < 0) return false;
  for (const f of ['media', 'pick', 'credit', 'faces', 'sourceTitle']) { const t = scenes[first][f]; scenes[first][f] = scenes[k][f]; scenes[k][f] = t; }
  scenes[k].faceSubject = undefined;   // 1번의 '이 사람만' 조건은 1번에 남는다 — 옮겨 간 자리는 조건 없이 다시 채운다
  fillMediaGaps(scenes);
  return true;
}

/**
 * 훅 첫 말에서 사람 이름 후보 — 얼굴 검사가 요구할 바로 그 이름. 4글자 이상이면 끝 조사 한 글자를 뗀다
 *   (김민석의→김민석 · 한동훈은→한동훈). 3글자 이하는 그대로(박지은·이은 같은 이름 보호).
 */
export function leadName(hook) {
  const t = String(hook ?? '').trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';
  return t.length >= 4 && /[의은는이가을를도와과]$/u.test(t) ? t.slice(0, -1) : t;
}

/**
 * 주어(lead)가 제목에 있는가. 그대로 있거나, 끝의 조사 한 글자(의·은·는·이·가·을·를·도·와·과)를 뗀 이름이 **낱말로** 있으면 있다.
 *   2026-10-17: "장동혁의" 주어로 장동혁 사진을 뺄 뻔했다. 낱말 경계(뒤에 한글이 안 붙음)로만 본다 — "박지은"→"박지" 가 "박지원" 에 맞지 않게.
 */
function nameIn(lead, title) {
  if (squash(title).includes(lead)) return true;
  if (hanjaSurnameIn(lead, title)) return true;
  const m = /^(.{2,})[의은는이가을를도와과]$/u.exec(lead);
  if (!m) return false;
  return new RegExp(`${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![가-힣])`, 'u').test(String(title ?? '').replace(/\s+/g, ' '));
}

/**
 * 빈 자리 채우기 — 얼굴 검사로 비운 자리(target.faceSubject = 그 자리 자막의 주어)에 **다른 사람 얼굴**을 다시 넣지 않는다.
 * 2026-10-17 실측: 「룰라 선물 논란」 자리에서 한동훈 사진을 뺐는데 채우기가 한동훈 사진을 다시 넣었다(face-check.test [5]).
 * @param {{faceSubject?:string}} target @param {{faces?:number, sourceTitle?:string}} donor
 */
export function donorAllowed(target, donor) {
  const who = String(target?.faceSubject ?? '').replace(/[^\p{L}\p{N}]/gu, '');
  if (!who) return true;
  if (!donor?.faces || donor.faces < 1) return true;
  return nameIn(who, donor.sourceTitle ?? '');
}

/**
 * 훅마다 첫 말이 **특정 인물의 이름**인가 — agy 에 한 번 묻는다. 못 물으면 null(그때 얼굴 검사는 아무것도 빼지 않는다).
 *   흔한 성씨로 시작하는 보통 말(부동산·선정된·당정협의)이 많아 규칙으로는 못 가른다(9/30 실측).
 */
export async function personLeads(hooks, { call } = {}) {
  const lead = (h) => String(h ?? '').trim().split(/\s+/)[0] ?? '';
  const list = hooks.map((h, i) => `${i}|${lead(h)}|${String(h ?? '').slice(0, 60)}`).join('\n');
  const prompt = ['아래는 뉴스 자막 목록이다(번호|첫 말|자막 전체).',
    '각 줄의 **첫 말**이 실존하는 특정 인물의 이름(예: 김여정, 트럼프, 이재명)인지 판단해라.',
    '직책·기관·일반 명사·형용사·동사(예: 대통령실, 부동산, 선정된, 당정협의)는 false 다.', '', list, '',
    'JSON 으로만 답해라: {"p": {"0": true|false, ...}} — 모든 번호를 빠짐없이.'].join('\n');
  const doCall = call ?? (async (pp) => (await import('./agy-report.mjs')).agyReport(pp, {
    label: 'person-lead', chain: (await import('./agy-models.mjs')).verifyChain(), timeoutMs: 120_000,
    schema: { type: 'object', properties: { p: { type: 'object' } }, required: ['p'] },
    accept: (out) => { try { const o = JSON.parse(out)?.p; return !!o && hooks.every((_, i) => typeof (o[i] ?? o[String(i)]) === 'boolean'); } catch { return false; } },
  }));
  let out;
  try { out = await doCall(prompt); } catch { return null; }
  try {
    const raw = JSON.parse(out)?.p;
    const o = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [String(k).replace(/['"\s]/g, ''), v]));
    const r = hooks.map((_, i) => o[String(i)]);
    return r.every((x) => typeof x === 'boolean') ? r : null;
  } catch { return null; }
}
