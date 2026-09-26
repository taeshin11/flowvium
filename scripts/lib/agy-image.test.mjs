#!/usr/bin/env node
/**
 * agy-image.test.mjs — agy 의 generate_image 로 그림을 만드는 길. 2026-09-25 신설.
 *
 * 사장님 "flow 차단을 좀 줄일수있나해서". Flow 는 브라우저 자동화라 막히고,
 *   agy 는 같은 계열 모델(gemini-3.1-flash-image = Nano Banana)을 명령줄로 부른다.
 *
 * 여기서 못박는 것 — **도구가 성공했다고 믿지 않고 산출물을 잰다**:
 *   · 모델이 말한 경로가 아니라 agy 가 남긴 도구 출력에서 파일을 찾는다
 *   · 그림이 없거나, 새까맣거나, 비율이 틀리면 실패다
 *   · 셸 권한 없이 돈다(--sandbox, 권한 건너뛰기 금지)
 *   · 끝나면 agy 대화 폴더(중간물)를 지운다 — 미디어는 지정한 곳에만 남긴다
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { generateImage } from './agy-image.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const work = mkdtempSync(join(tmpdir(), 'agy-image-test-'));
const brainRoot = join(work, 'brain');
mkdirSync(brainRoot);

/** 가짜 agy — 지정한 크기·색의 그림을 brain/<id>/ 에 만들고 도구 출력을 남긴다. */
function fakeAgy({ w = 768, h = 1376, color = '0x3366aa', makeImage = true, id = '11111111-2222-3333-4444-555555555555' } = {}) {
  const seen = { args: null };
  const impl = async (args) => {
    seen.args = args;
    const dir = join(brainRoot, id);
    mkdirSync(join(dir, '.system_generated/steps/1'), { recursive: true });
    if (makeImage) {
      const img = join(dir, 'pic_123.jpg');
      spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`,
        '-vf', 'noise=alls=30:allf=t', '-frames:v', '1', img]);
      writeFileSync(join(dir, '.system_generated/steps/1/output.txt'),
        `Generated image is saved at ${img}.\n Do not output the path of this image to show to the user.`);
    }
    return { stdout: JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '{"path":"/somewhere/else.jpg"}' }) };
  };
  return { impl, seen, dir: join(brainRoot, id) };
}

// [1] 정상 — 산출물이 지정한 곳에 생기고, 대화 폴더는 지워진다
{
  const f = fakeAgy();
  const out = join(work, 'out1.jpg');
  const r = await generateImage({ prompt: '어두운 추상 배경', out, aspect: '9:16', agyImpl: f.impl, brainRoot });
  (r.ok && existsSync(out) && r.width === 768 && r.height === 1376)
    ? ok(`[1] 생성 → ${r.width}x${r.height} 저장`) : bad(`[1] ${JSON.stringify(r)}`);
  !existsSync(f.dir) ? ok('[1b] agy 대화 폴더(중간물)를 지웠다') : bad('[1b] 대화 폴더가 남았다');
  const a = f.seen.args ?? [];
  (a.includes('--sandbox') && !a.some((x) => /dangerously/.test(x)))
    ? ok('[1c] --sandbox · 권한 건너뛰기 없음') : bad(`[1c] args=${a.join(' ').slice(0, 120)}`);
  const p = a[a.indexOf('-p') + 1] ?? '';
  (/터미널 명령/.test(p) && /9:16/.test(p) && /generate_image/.test(p) && p.includes('어두운 추상 배경'))
    ? ok('[1d] 프롬프트: 셸 금지 · 비율 · 도구 이름 · 원문') : bad(`[1d] ${p.slice(0, 160)}`);
}

// [2] 그림을 안 만들고 말로만 답했다 → 실패
{
  const f = fakeAgy({ makeImage: false, id: '22222222-2222-3333-4444-555555555555' });
  const r = await generateImage({ prompt: 'x', out: join(work, 'out2.jpg'), aspect: '9:16', agyImpl: f.impl, brainRoot });
  (!r.ok && /그림|image/i.test(r.reason)) ? ok(`[2] 그림 없음 → 실패 (${r.reason})`) : bad(`[2] ${JSON.stringify(r)}`);
}

// [3] 새까만 그림 → 실패 (스크린샷·업로드는 빈 그림도 성공한다)
{
  const f = fakeAgy({ color: 'black', id: '33333333-2222-3333-4444-555555555555' });
  const orig = spawnSync; // noise 없이 순수 검정이 되도록 색만 검정 — noise 30 이라도 평균은 낮다
  const r = await generateImage({ prompt: 'x', out: join(work, 'out3.jpg'), aspect: '9:16', agyImpl: async (args) => {
    const res = await f.impl(args);
    // 순수 검정으로 덮어쓴다
    spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=768x1376', '-frames:v', '1', join(f.dir, 'pic_123.jpg')]);
    return res;
  }, brainRoot });
  void orig;
  (!r.ok && /밝기|어둡|blank/i.test(r.reason)) ? ok(`[3] 빈 그림 → 실패 (${r.reason})`) : bad(`[3] ${JSON.stringify(r)}`);
}

// [4] 비율이 틀림(9:16 을 달랬는데 정사각) → 실패
{
  const f = fakeAgy({ w: 1024, h: 1024, id: '44444444-2222-3333-4444-555555555555' });
  const r = await generateImage({ prompt: 'x', out: join(work, 'out4.jpg'), aspect: '9:16', agyImpl: f.impl, brainRoot });
  (!r.ok && /비율/.test(r.reason)) ? ok(`[4] 비율 틀림 → 실패 (${r.reason})`) : bad(`[4] ${JSON.stringify(r)}`);
}

// [5] 참고 그림 — 작업 폴더로 넘기고 이름을 프롬프트에 적는다. 4장 이상은 거절(도구 상한 3)
{
  const ref = join(work, 'ref.jpg');
  spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', ref]);
  const f = fakeAgy({ id: '55555555-2222-3333-4444-555555555555' });
  const r = await generateImage({ prompt: 'x', out: join(work, 'out5.jpg'), aspect: '9:16', refs: [ref], agyImpl: f.impl, brainRoot });
  const a = f.seen.args ?? [];
  const p = a[a.indexOf('-p') + 1] ?? '';
  const addDir = a[a.indexOf('--add-dir') + 1] ?? '';
  (r.ok && p.includes(addDir) && /ref/.test(p)) ? ok('[5] 참고 그림 경로를 넘긴다') : bad(`[5] ok=${r.ok} p=${p.slice(0, 200)}`);
  const r2 = await generateImage({ prompt: 'x', out: join(work, 'out5b.jpg'), aspect: '9:16', refs: [ref, ref, ref, ref], agyImpl: f.impl, brainRoot });
  (!r2.ok && /3/.test(r2.reason)) ? ok('[5b] 참고 그림 4장 → 거절') : bad(`[5b] ${JSON.stringify(r2)}`);
}

// [7] 이미지 모델 할당량 소진(429)이면 **그렇게** 말한다 — 리셋 시각까지 (2026-09-27 실측: agy 는 {"done":true} 로 답하고
//   도구 출력에만 "You have exhausted your capacity on this model. Your quota will reset after 3h15m42s." 가 있었다.
//   사유가 "그림을 만들지 않았다" 뿐이라 다른 세션이 원인을 못 찾았다. /usage 의 Gemini 여유는 글 모델 몫이다.)
{
  const id = '77777777-2222-3333-4444-555555555555';
  const impl = async () => {
    const dir = join(brainRoot, id);
    mkdirSync(join(dir, '.system_generated/steps/2'), { recursive: true });
    writeFileSync(join(dir, '.system_generated/steps/2/output.txt'),
      'Encountered error in step execution: failed to generate content: 429 Too Many Requests, body: {"error":{"code":429,"message":"You have exhausted your capacity on this model. Your quota will reset after 3h15m42s.","status":"RESOURCE_EXHAUSTED"}}');
    return { stdout: JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '{"done":true}' }) };
  };
  const r = await generateImage({ prompt: 'x', out: join(work, 'o7.jpg'), aspect: '1:1', agyImpl: impl, brainRoot });
  (!r.ok && /할당량/.test(r.reason) && /3h15m42s/.test(r.reason) && r.quotaExhausted === true) ? ok(`[7] 할당량 소진을 사유로(${r.reason})`) : bad(`[7] ${JSON.stringify(r)}`);
}

// [6] 모르는 비율은 부르기 전에 막는다
{
  let called = false;
  const r = await generateImage({ prompt: 'x', out: join(work, 'o6.jpg'), aspect: '7:5', agyImpl: async () => { called = true; return { stdout: '{}' }; }, brainRoot });
  (!r.ok && !called) ? ok('[6] 모르는 비율 → 부르지 않고 실패') : bad(`[6] ${JSON.stringify(r)} called=${called}`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
