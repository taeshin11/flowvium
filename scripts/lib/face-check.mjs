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
 * 주어(lead)가 제목에 있는가. 그대로 있거나, 끝의 조사 한 글자(의·은·는·이·가·을·를·도·와·과)를 뗀 이름이 **낱말로** 있으면 있다.
 *   2026-10-17: "장동혁의" 주어로 장동혁 사진을 뺄 뻔했다. 낱말 경계(뒤에 한글이 안 붙음)로만 본다 — "박지은"→"박지" 가 "박지원" 에 맞지 않게.
 */
function nameIn(lead, title) {
  if (squash(title).includes(lead)) return true;
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
