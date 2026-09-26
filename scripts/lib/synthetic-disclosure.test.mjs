#!/usr/bin/env node
/**
 * synthetic-disclosure.test.mjs — 생성 영상이 들어간 편은 유튜브에 '합성 콘텐츠' 로 신고한다. 2026-09-26 신설.
 * 사장님: 소재가 모자라면 Omni Flash ×1 로 만들고, 사건 재현도 허용. 유튜브 정책상 사실적인 생성·합성 영상은 알려야 한다.
 * 경로: make-shorts 메타 synthetic → video-publish 가 --synthetic → youtube-upload → status.containsSyntheticMedia=true.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './project-root.mjs';
import { uploadRequestBody } from './youtube.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const b1 = uploadRequestBody({ title: 't', privacy: 'public', synthetic: true });
const b0 = uploadRequestBody({ title: 't', privacy: 'public' });
(b1.status.containsSyntheticMedia === true && !('containsSyntheticMedia' in b0.status) && b0.status.privacyStatus === 'public')
  ? ok('[1] synthetic → containsSyntheticMedia=true · 아니면 필드 없음') : bad(`[1] ${JSON.stringify([b1.status, b0.status])}`);
const ms = readFileSync(join(ROOT, 'scripts/video/make-shorts.mjs'), 'utf8');
const vp = readFileSync(join(ROOT, 'scripts/video-publish.mjs'), 'utf8');
const yu = readFileSync(join(ROOT, 'scripts/youtube-upload.mjs'), 'utf8');
(/synthetic:\s*scenes\.some/.test(ms)) ? ok('[2] make-shorts 메타에 synthetic') : bad('[2] 메타에 synthetic 없음');
(/last\.synthetic/.test(vp) && /--synthetic/.test(vp)) ? ok('[3] video-publish 가 --synthetic 을 넘긴다') : bad('[3] video-publish 배선 없음');
(/--synthetic/.test(yu) && /synthetic:/.test(yu)) ? ok('[4] youtube-upload 가 받는다') : bad('[4] youtube-upload 배선 없음');
// [5] 업로드 경로에 **정의 안 된 변수**가 없다 — 2026-09-26 실제로 youtube-upload 에 없는 `argv` 를 써서
//   모든 업로드가 죽을 뻔했다(node --check 와 소스 grep 은 못 잡았다). eslint no-undef 로 직접 본다.
{
  const { spawnSync } = await import('child_process');
  const r = spawnSync('npx', ['eslint', '--no-eslintrc', '--env', 'node,browser,es2024', '--parser-options', 'ecmaVersion:latest',
    '--parser-options', 'sourceType:module', '--rule', 'no-undef:error', 'scripts/youtube-upload.mjs', 'scripts/lib/youtube.mjs', 'scripts/video-publish.mjs'],
    { cwd: ROOT, encoding: 'utf8' });
  r.status === 0 ? ok('[5] 업로드 경로 no-undef 깨끗') : bad(`[5] 정의 안 된 변수: ${(r.stdout ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 3).join(' | ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
