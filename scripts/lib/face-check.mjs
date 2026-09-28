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
export function personMismatch({ hook, sourceTitle, faces }) {
  if (!faces || faces < 1 || !sourceTitle) return false;
  const lead = String(hook ?? '').trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';
  if (lead.length < 2) return false;
  return !squash(sourceTitle).includes(lead);
}
