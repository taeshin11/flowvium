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
import { tmpdir } from 'os';
import { ROOT } from './project-root.mjs';

let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const script = join(ROOT, 'scripts/video/make-outro-clip.mjs');
// 출력은 **언제나 임시 경로로**. 2026-09-24: 옛 스크립트가 --card 를 몰라 이 테스트의 인자로 실제 렌더를 해
//   assets/outro/aisvi.mp4(쇼츠에 붙는 광고)를 덮어썼다. 멈춰야 할 입력이 안 멈추는 회귀가 오면 똑같이 된다.
const SAFE_OUT = join(tmpdir(), `outro-locale-test-${process.pid}.mp4`);
const run = (args) => spawnSync(process.execPath, [script, ...args, '--out', SAFE_OUT], { encoding: 'utf8', timeout: 60_000 });

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

// [신설 2026-09-17] 시연 영상 옵션 — 없는 파일이면 조용히 옛 구성으로 가지 않고 멈춘다
{
  const r = run(['--demo', '/nonexistent/demo.mp4']);
  (r.status === 2 && /시연 영상이 없다/.test(`${r.stdout}${r.stderr}`))
    ? ok('--demo 에 없는 파일을 주면 멈춘다')
    : bad(`없는 시연 영상으로 진행했다 (exit ${r.status})`);
}

// [신설 2026-09-24] 2초 카드 — 쇼츠에 붙는 광고를 덮지 않고, 시연과 섞이지 않는다
{
  const { readFileSync } = await import('fs');
  const src = readFileSync(script, 'utf8');
  /assets\/outro\/aisvi-card\$\{LOCALE === 'ko'/.test(src)
    ? ok('카드는 aisvi-card.mp4 로 따로 나간다')
    : bad('카드 출력 경로가 쇼츠 광고(aisvi.mp4)와 같다');
  const r = run(['--card', '--demo', 'assets/outro/aisvi-demo.mp4']);
  (r.status === 2 && /--card/.test(`${r.stdout}${r.stderr}`))
    ? ok('--card 와 --demo 를 같이 주면 멈춘다')
    : bad(`--card 에 시연이 섞였다 (exit ${r.status})`);
  const s2 = run(['--card', '--sec', '9']);
  (s2.status === 2 && /--sec/.test(`${s2.stdout}${s2.stderr}`))
    ? ok('카드 길이 범위 밖(9초)은 멈춘다')
    : bad(`--sec 9 가 통과했다 (exit ${s2.status})`);
}

// [신설 2026-09-24] 값 없는 플래그 뒤에 다른 플래그가 와도 그 플래그를 값으로 먹지 않는다
//   `--demo --out x` 에서 '--out' 을 시연 경로로 먹어 "시연 영상이 없다: .../--out" 으로 멈췄다.
//   --ar 22050 은 렌더 전에 멈추는 입력이라, 고쳐졌으면 '--ar' 오류로, 아니면 '시연 영상이 없다' 로 멈춘다.
{
  const r = run(['--demo', '--ar', '22050']);
  const out = `${r.stdout}${r.stderr}`;
  (r.status === 2 && /--ar 는/.test(out) && !/시연 영상이 없다/.test(out))
    ? ok("'--demo --ar' 에서 --ar 을 시연 경로로 먹지 않는다")
    : bad(`다음 플래그를 값으로 먹었다: ${out.split('\n').find(Boolean)?.slice(0, 90)}`);
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
