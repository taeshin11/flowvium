#!/usr/bin/env node
/**
 * outro-locale.test.mjs — 광고 클립이 로케일을 받되, 못 읽는 말을 읽지 않는가.
 *
 * 배경(2026-09-15): 같은 광고를 일본어로도 붙이게 됐다(옆 세션 K연예 채널).
 *   사본을 뜨면 시간이 지나 어긋나므로 문구만 갈아끼우게 고쳤다.
 *
 * 2026-09-16 사용자 "일본어판은 왜 발행용이 안되?" — 맞는 물음이었다.
 *   "우리 TTS 는 한국어 전용" 은 사실이 아니라 **배선이 없었다**는 뜻이었다.
 *   MeloTTS 는 japanese/japanese_bert 를 갖고 있는데 파이썬 쪽이 language="KR" 로
 *   못박혀 있었다. 이 테스트도 그 제약을 **사실인 양 못박아** 두고 있었다(ja 는 exit 2 여야 한다).
 *   제약을 없앴으니 테스트도 새 불변식으로 바꾼다 — 다만 지키려던 뜻은 그대로다.
 *
 * 여기서 못박는 것은 **조용히 틀리지 않는 것** 둘이다:
 *   · ja 를 한국어 발음으로 읽지 않는다. 이제는 막는 대신 **일본어로 읽는다** —
 *     실측: 만든 소리를 whisper 에 언어 지정 없이 물으니 ja, 확률 1.00 이었다.
 *   · 모르는 로케일은 통과시키지 않는다. 아는 목록에 없으면 멈춘다.
 */
import { spawnSync } from 'child_process';
import { join } from 'path';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const script = join(ROOT, 'scripts/video/make-outro-clip.mjs');
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000 });

// [1] ja 는 **일본어로** 읽는다 — 한국어 경로로 새지 않는다
//   렌더 전체는 느리니(모델 적재) 소스에서 배선을 본다. 소리가 실제로 일본어인지는
//   whisper 로 확인했다(ja 1.00) — 그 측정은 파일 주석에 남겼다.
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  const wired = /MELO_LANGS\.has\(LOCALE\)/.test(src)
    && /synthesizeKoreanMelo\(\[SAY\]/.test(src) && /lang: LOCALE/.test(src);
  const koOnly = /LOCALE === 'ko'/.test(src);
  (wired && koOnly)
    ? ok('ja 는 MeloTTS 로 일본어를 만든다 (lang 을 넘긴다)')
    : bad(`ja 배선이 없다 — melo 분기=${wired}, ko 분기=${koOnly}`);
  /話すだけで/.test(src)
    ? ok('일본어 문구가 실제로 들어 있다')
    : bad('일본어 문구가 안 나온다');
}

// [2] 모르는 로케일은 막는다
{
  const r = run(['--locale', 'fr']);
  (r.status === 2 && /모르는 로케일/.test(`${r.stdout}${r.stderr}`))
    ? ok('모르는 로케일은 막는다')
    : bad(`모르는 로케일이 통과한다 (exit ${r.status})`);
}

// [3] 한국어 기본 경로가 그대로다 — make-shorts 가 이 경로를 본다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  /assets\/outro\/aisvi\$\{LOCALE === 'ko' \? '' : `-\$\{LOCALE\}`\}\.mp4/.test(src)
    ? ok("한국어는 종전 경로(assets/outro/aisvi.mp4) 유지, 다른 로케일만 파일을 나눈다")
    : bad('한국어 출력 경로가 바뀌었다 — make-shorts 가 못 찾는다');
}

// [신설 2026-09-17] 받아 온 소리는 크기를 맞춘다
//   사무실2 의 VoxCPM2 음성이 -34.7 LUFS 였고(우리 한국어 광고 -17.3), 종전엔 손대지 않고 썼다.
//   그대로 나가면 광고가 거의 안 들린다. loudnorm 으로 맞춘 결과 -17.0 LUFS 였다(실측).
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  const branch = src.slice(src.indexOf('if (AUDIO_IN) {'), src.indexOf("} else if (LOCALE === 'ko')"));
  (/loudnorm=I=/.test(branch) && /voice = \{ path: normed/.test(branch))
    ? ok('받아 온 음성은 loudnorm 을 거친 파일을 쓴다')
    : bad('받아 온 음성을 크기 맞춤 없이 그대로 쓴다');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
