#!/usr/bin/env node
/**
 * media-stage.test.mjs — 쇼츠는 로컬에서 만들고 로컬에서 올린다. 드라이브는 올린 뒤 보관만. 2026-09-28 신설.
 *
 * 9/28 21:45 회차가 통째로 빠졌다: 렌더 3번이 모두 마지막 단계에서
 *   "…/내 드라이브/FlowVium-media/shorts-ko.mp4: Resource deadlock avoided"(EDEADLK) 로 죽었고,
 *   예비(역시 드라이브 spares/)를 같은 자리로 복사하다 같은 오류(-11)로 실패했다. 10분 뒤 같은 쓰기는 됐다 — 일시적이다.
 *   드라이브(File Provider)는 파일을 온라인 전용으로 내리고(dataless) 동기화 중엔 잠근다. 9/26 에는 Dropbox 파일 open 이
 *   1시간 44분 멈췄다(cloud-folder-open-can-hang). 발행 경로가 클라우드 폴더를 거치는 한 같은 일이 또 난다.
 * → 렌더 산출물·예비는 로컬(임시폴더). 업로드도 로컬 파일로. 드라이브 보관은 **올린 뒤**, 자식 프로세스 + 시간 한도로.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { archiveToMedia } from './media-stage.mjs';
import { spareDir } from './shorts-spare.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const w = mkdtempSync(join(tmpdir(), 'media-stage-test-'));

// [1] 예비 폴더 기본값은 로컬(클라우드 폴더 아님), 환경변수로 바꿀 수 있다
{
  const d = spareDir({});
  const e = spareDir({ SHORTS_SPARE_DIR: '/x/y' });
  (!/CloudStorage|Dropbox|GoogleDrive/.test(d) && d.startsWith(tmpdir()) && e === '/x/y') ? ok(`[1] 예비 폴더 로컬: ${d}`) : bad(`[1] ${d} / ${e}`);
}
// [2] 보관: 파일을 옮겨 적는다
{
  const from = join(w, 'stage'), to = join(w, 'media'); mkdirSync(from); mkdirSync(to);
  writeFileSync(join(from, 'shorts-ko.mp4'), 'VID'); writeFileSync(join(from, 'shorts-ko-meta.json'), '{}');
  const r = archiveToMedia({ from, to, files: ['shorts-ko.mp4', 'shorts-ko-meta.json', 'shorts-ko-thumb.jpg'] });
  (r.ok && readFileSync(join(to, 'shorts-ko.mp4'), 'utf8') === 'VID' && r.copied.length === 2) ? ok(`[2] 보관 ${r.copied.join(', ')}`) : bad(`[2] ${JSON.stringify(r)}`);
}
// [2b] 임시 이름으로 쓰고 바꿔 끼운다 — 드라이브의 온라인 전용 자리표시 위에 cp 가 실패했다(9/29 meta.json 7회)
{
  const src = readFileSync(new URL('./media-stage.mjs', import.meta.url), 'utf8');
  /tmp-\$\{process\.pid\}/.test(src) && /'mv', \['-f'/.test(src) ? ok('[2b] 임시 파일 → rename') : bad('[2b] 기존 파일 위에 바로 쓴다');
  const { readdirSync } = await import('fs');
  const left = readdirSync(join(w, 'media')).filter((n) => n.includes('.tmp-'));
  left.length === 0 ? ok('[2c] 임시 파일이 남지 않는다') : bad(`[2c] ${left}`);
}
// [3] 보관 대상이 멈추면(클라우드 파일 open 이 안 돌아옴) 시간 한도 안에 포기한다 — FIFO 로 흉내
{
  const from = join(w, 'stage3'), to = join(w, 'media3'); mkdirSync(from); mkdirSync(to);
  execSync(`mkfifo '${join(from, 'shorts-ko.mp4')}'`);
  const t0 = Date.now();
  const r = archiveToMedia({ from, to, files: ['shorts-ko.mp4'], timeoutMs: 2000 });
  const ms = Date.now() - t0;
  (!r.ok && ms < 8000) ? ok(`[3] 멈추면 ${ms}ms 안에 포기(${r.reason})`) : bad(`[3] ${ms}ms ${JSON.stringify(r)}`);
}
// [4] video-publish: 렌더는 로컬 스테이지로, 예비도 스테이지로 옮긴다(소스)
{
  const src = readFileSync(new URL('../video-publish.mjs', import.meta.url), 'utf8');
  (/SHORTS_OUT_DIR:\s*STAGE/.test(src) && /promoteSpare\(sp,\s*STAGE/.test(src) && /archiveToMedia\(/.test(src))
    ? ok('[4] video-publish: 로컬 스테이지에서 만들고 올린 뒤 보관') : bad('[4] video-publish 가 아직 드라이브에 바로 쓴다');
}
// [5] shorts-spare 스크립트도 같은 예비 폴더를 쓴다
{
  const src = readFileSync(new URL('../shorts-spare.mjs', import.meta.url), 'utf8');
  /spareDir\(/.test(src) ? ok('[5] shorts-spare 가 spareDir() 을 쓴다') : bad('[5] shorts-spare 가 아직 드라이브 spares/ 를 쓴다');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
