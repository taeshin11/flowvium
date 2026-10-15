#!/usr/bin/env node
/**
 * agy-viewed.test.mjs — agy 눈검증이 그림을 **실제로 열어 보고** 답했는지. 2026-10-15 신설.
 * 왜(사장님 10/15 "눈검증은 반드시 이미지를 첨부해서 같이 보내 판정받을 것 — 글 설명만으로 판정 금지"):
 *   agy 에는 이미지 첨부 플래그가 없다(--help: --add-dir 뿐). 그림은 작업 폴더에 넣고 모델이 view_file 로 연다.
 *   열지 않고 답해도 structured_output 은 나온다 — 그러면 그림 없이 낸 판정이 '검사함' 으로 남는다.
 *   10/15 실측: 최근 3일 눈검증 대화 29건 모두 프레임을 전부 열었다(대화 DB 의 view_file 단계). 지금은 지켜지고 있고,
 *   이 검사는 그게 깨졌을 때 '못 봄' 으로 세게 만든다.
 * 근거 자리: ~/.gemini/antigravity-cli/conversations/<conversation_id>.db 의 steps.step_payload 에
 *   'view_file' 과 '"AbsolutePath":"…/frame0.jpg"' 가 같이 찍힌다(10/15 대화 86cf92fb 로 확인).
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { viewedImages } from './agy-viewed.mjs';
const Database = createRequire(import.meta.url)('better-sqlite3');
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const dir = mkdtempSync(join(tmpdir(), 'agy-viewed-'));
try {
  const db = new Database(join(dir, 'c1.db'));
  db.exec('CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB)');
  const ins = db.prepare('INSERT INTO steps VALUES (?, ?, ?)');
  ins.run(0, 14, Buffer.from('prompt frame0_1s.jpg frame1_5s.jpg'));                       // 사용자 프롬프트 — 이름만 적힌 곳
  ins.run(1, 132, Buffer.from('call_1 view_file {"AbsolutePath":"/tmp/x/frame0_1s.jpg"}'));  // 실제로 연 것
  ins.run(2, 132, Buffer.from('call_2 {"ok":true} frame1_5s.jpg'));                          // 답에 이름만 — 연 게 아니다
  db.close();
  const v = viewedImages('c1', ['frame0_1s.jpg', 'frame1_5s.jpg'], { dir });
  v && v.missing.join() === 'frame1_5s.jpg' ? ok('[1] 프롬프트·답에 이름만 나온 그림은 안 연 것으로 센다') : bad(`[1] ${JSON.stringify(v)}`);
  const all = viewedImages('c1', ['frame0_1s.jpg'], { dir });
  all && all.missing.length === 0 ? ok('[2] view_file 로 연 그림은 열린 것') : bad(`[2] ${JSON.stringify(all)}`);
  viewedImages('nope', ['frame0_1s.jpg'], { dir }) === null ? ok('[3] 대화 기록이 없으면 null(모름) — 통과 아님') : bad('[3]');
  viewedImages(undefined, ['a.jpg'], { dir }) === null ? ok('[4] conversation_id 가 없으면 null') : bad('[4]');
} finally { rmSync(dir, { recursive: true, force: true }); }
// [5][6] 눈검증 두 길이 이 검사를 실제로 쓴다 — 안 열었으면 '검사함' 이 아니다.
{
  const { readFileSync } = await import('fs');
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  /viewedImages\(j\.conversation_id, names\)/.test(src('./video-eye.mjs')) ? ok('[5] video-eye(쇼츠 프레임) 가 열었는지 확인한다') : bad('[5] video-eye 미연결');
  /viewedImages\(extractJson\(r\.stdout\)\?\.conversation_id, imgs\)/.test(src('./cross-check.mjs')) ? ok('[6] cross-check(그림 첨부 교차검증) 가 열었는지 확인한다') : bad('[6] cross-check 미연결');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
