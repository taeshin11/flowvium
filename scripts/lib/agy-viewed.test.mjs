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
  // [7] 2026-10-20 agy 1.4.3: 그림 열기가 view_file{"AbsolutePath"} → read_file{"Path"} 로 바뀌었다(10/19 21시 대화까지 view_file,
  //   10/20 08시부터 read_file). 옛 형식만 알아서 그날 쇼츠 눈검증이 전부 '안 열고 답함' → gemini-2.5-flash 로 떨어졌다.
  //   실제 바이트(대화 1963df69 단계 2, 993KB — 그림 내용이 실렸다): 'read_file\x1a`{"Path":"…/frame0_0s.jpg"}:'.
  const db2 = new Database(join(dir, 'c2.db'));
  db2.exec('CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB)');
  const ins2 = db2.prepare('INSERT INTO steps VALUES (?, ?, ?)');
  ins2.run(0, 14, Buffer.from('read_file(/private/var/folders/x/T/agy-eye-ab12) prompt frame0_0s.jpg frame1_2s.jpg frame2_4s.jpg'));
  ins2.run(2, 132, Buffer.from('\x0bcall_129407\x12\x09read_file\x1a`{"Path":"/private/var/folders/x/T/agy-eye-ab12/frame0_0s.jpg"}:\xc2\x01'));
  ins2.run(3, 132, Buffer.from('\x0bcall_2\x12\x08list_dir\x1a`{"Path":"/private/var/folders/x/T/agy-eye-ab12/frame1_2s.jpg"}:'));   // 여는 도구가 아니다
  ins2.run(4, 132, Buffer.from('\x0bcall_3\x12\x09read_file\x1a`{"Path":"/private/var/folders/x/T/agy-eye-ab12/notes.txt"} frame2_4s.jpg'));   // 다른 파일을 열고 이름만
  db2.close();
  const v2 = viewedImages('c2', ['frame0_0s.jpg', 'frame1_2s.jpg', 'frame2_4s.jpg'], { dir });
  v2 && v2.viewed.join() === 'frame0_0s.jpg' && v2.missing.join() === 'frame1_2s.jpg,frame2_4s.jpg'
    ? ok('[7] agy 1.4.3 read_file{"Path"} 로 연 그림도 열린 것 — 다른 도구·다른 파일 옆 이름은 아니다') : bad(`[7] ${JSON.stringify(v2)}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
// [5][6] 눈검증 두 길이 이 검사를 실제로 쓴다 — 안 열었으면 '검사함' 이 아니다.
{
  const { readFileSync } = await import('fs');
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  /viewedImages\(j\.conversation_id, names\)/.test(src('./video-eye.mjs')) ? ok('[5] video-eye(쇼츠 프레임) 가 열었는지 확인한다') : bad('[5] video-eye 미연결');
  /viewedImages\(extractJson\(r\.stdout\)\?\.conversation_id, imgs\)/.test(src('./cross-check.mjs')) ? ok('[6] cross-check(그림 첨부 교차검증) 가 열었는지 확인한다') : bad('[6] cross-check 미연결');
  // [8] 10/20 14:14 발행 로그는 '✅ gemini-2.5-flash 이상 없음' 만 적었다 — agy 를 왜 못 썼는지(그림 안 열고 답함)가 없어
  //   형식이 바뀐 걸 발행 로그로는 알 수 없었다. agy 가 아닌 눈으로 봤으면 그 이유를 같은 줄에 남긴다.
  /eye\.model\.startsWith\('agy:'\) \? '' : ` · agy 못 씀: \$\{eyeWhy\(\)\.join\(' · '\) \|\| '이유 없음'\}`/.test(src('../video-publish.mjs'))
    ? ok('[8] 발행 눈검증이 agy 대신 다른 모델로 봤으면 그 이유를 적는다') : bad('[8] 발행 로그에 agy 를 못 쓴 이유가 없다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
