/**
 * agy-viewed.mjs — agy 가 그림 파일을 view_file 로 실제로 열었는지 대화 기록에서 확인한다. 2026-10-15 신설.
 * 근거·규칙은 agy-viewed.test.mjs 머리말(사장님 "눈검증은 이미지를 첨부해 판정받을 것 — 글 설명만으로 판정 금지").
 */
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';

const CONV_DIR = join(homedir(), '.gemini', 'antigravity-cli', 'conversations');

/**
 * @param {string} conversationId  agy --output-format json 의 conversation_id
 * @param {string[]} names         작업 폴더에 넣은 그림 파일 이름
 * @returns {{viewed:string[], missing:string[]}|null}  기록을 못 읽으면 null(모름)
 */
export function viewedImages(conversationId, names, { dir = CONV_DIR } = {}) {
  if (!conversationId || !/^[\w-]+$/.test(conversationId)) return null;
  const file = join(dir, `${conversationId}.db`);
  if (!existsSync(file)) return null;
  let rows;
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { rows = db.prepare('SELECT step_payload FROM steps').all(); } finally { db.close(); }
  } catch { return null; }
  // 여는 도구 이름 바로 뒤(길이 바이트 1~4개)의 인자 JSON 첫 키가 그 파일이다 — 같은 호출에 묶어 센다.
  //   agy ≤1.4.2: view_file {"AbsolutePath":…}, 1.4.3(2026-10-20~): read_file {"Path":…}. 다른 도구(list_dir 등)의 Path 는 아니다.
  const opened = new Set();
  for (const { step_payload: p } of rows) {
    const s = Buffer.isBuffer(p) ? p.toString('utf8') : String(p ?? '');
    for (const m of s.matchAll(/(?:view_file|read_file)[^{]{1,4}\{"(?:AbsolutePath|Path)":"([^"]+)"/g)) opened.add(basename(m[1]));
  }
  const want = names.map((n) => basename(n));
  return { viewed: want.filter((n) => opened.has(n)), missing: want.filter((n) => !opened.has(n)) };
}
