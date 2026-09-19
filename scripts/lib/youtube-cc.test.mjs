#!/usr/bin/env node
/**
 * youtube-cc.test.mjs — 컷마다 CC 영상을 찾는 경로의 회귀 방지.
 *
 * 네트워크 없이 도는 부분만 본다(검색 자체는 쿼터를 쓰므로 여기서 부르지 않는다).
 * 실측 근거는 모듈 주석에 있다 — 6개 주제 CC 검색 5/5, 표본 6건 중 b-roll 로 쓸 것 0건.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

const { durationSec, pickSegment, ccDownloadReady, downloadCcClip, MIN_SEC, MAX_SEC } = await import('./youtube-cc.mjs');
const { licenseUsable, attributionFree, creditLine } = await import('./footage.mjs');

// [1] ISO 길이 — 못 읽으면 null 이어야 한다. 0 을 돌려주면 길이 검사가 통과해 버린다
{
  const cases = [['PT1M4S', 64], ['PT4H17S', 14417], ['PT25S', 25], ['P1DT2H', 93600],
    ['쓰레기', null], ['', null], [null, null], ['PT0S', null]];
  const wrong = cases.filter(([i, want]) => durationSec(i) !== want);
  wrong.length === 0 ? ok(`ISO 길이 ${cases.length}종 (못 읽으면 null)`)
    : bad(`길이 파싱 틀림: ${wrong.map(([i, w]) => `${i}→${durationSec(i)}(want ${w})`).join(', ')}`);
}

// [2] 라이브·통방송은 안 쓴다 — 실측: "국회 본회의" 10건 중 3건이 43분·2시간·4시간이었다
{
  const tooLong = durationSec('PT4H17S') > MAX_SEC;
  const tooShort = durationSec('PT5S') < MIN_SEC;
  (tooLong && tooShort) ? ok(`길이 창 ${MIN_SEC}~${MAX_SEC}초 — 4시간 라이브·5초 클립 모두 밖`)
    : bad(`길이 창이 통방송을 못 막는다 (${MIN_SEC}~${MAX_SEC})`);
}

// [3] 구간은 앞뒤를 피한다 — 앞은 인트로, 뒤는 엔드카드
{
  const a = pickSegment(434, 6), b = pickSegment(25, 6), c = pickSegment(4, 6);
  const okA = a.start >= 434 * 0.15 && a.start + a.dur <= 434 * 0.90;
  const okB = b.start > 0 && b.start + b.dur <= 25;
  const okC = c.start === 0 && c.dur <= 4;         // 영상이 원하는 길이보다 짧으면 있는 만큼
  (okA && okB && okC) ? ok(`구간 선택 — 434초→${a.start.toFixed(0)}s · 25초→${b.start.toFixed(0)}s · 4초→전체`)
    : bad(`구간이 앞뒤를 안 피한다: ${JSON.stringify({ a, b, c })}`);
}

// [4] 유튜브 CC 는 CC BY 3.0 — 쓸 수 있고, **표기 의무가 있다**
{
  const l = 'CC BY 3.0';
  (licenseUsable(l) && !attributionFree(l))
    ? ok('CC BY 3.0 — 사용 가능하고 표기 의무가 붙는다')
    : bad(`라이선스 판정이 틀렸다: usable=${licenseUsable(l)} free=${attributionFree(l)}`);
}

// [5] 후보 모양이 기존 계약에 맞는가 — 여기가 어긋나면 크레딧이 조용히 빈다
{
  const cand = { license: 'CC BY 3.0', title: '국회 본회의 통과', author: '이데일리TV',
    source: 'YouTube', pageUrl: 'https://youtu.be/abc' };
  const line = creditLine(cand);
  (line && line.includes('이데일리TV') && line.includes('CC BY 3.0') && line.includes('youtu.be/abc'))
    ? ok(`creditLine 이 그대로 먹는다 — ${line.slice(0, 56)}`)
    : bad(`크레딧이 안 만들어진다: ${line}`);
}

// [6] 내려받기는 기본으로 꺼져 있다 — 약관 판단은 채널 주인 몫이지 스크립트 몫이 아니다
{
  const saved = process.env.YT_CC_DOWNLOAD;
  delete process.env.YT_CC_DOWNLOAD;
  const off = ccDownloadReady();
  if (saved !== undefined) process.env.YT_CC_DOWNLOAD = saved;
  (!off.ok && /YT_CC_DOWNLOAD/.test(off.reason))
    ? ok('YT_CC_DOWNLOAD 없이는 내려받지 않는다')
    : bad(`기본값이 켜져 있다: ${JSON.stringify(off)}`);
}

// [7] 배선 — CLIP 관문이 영상 소재를 사진으로 열려다 회차 전체 검사를 건너뛰지 않는가
{
  const { readFileSync } = await import('fs');
  const { ROOT } = await import('./project-root.mjs');
  const src = readFileSync(`${ROOT}/scripts/video/make-shorts.mjs`, 'utf8');
  const raw = (src.match(/clipCheck\(\s*\[?\{\s*image:\s*r\.x\.media\s*\}/g) ?? []).length
            + (src.match(/clipDuplicates\(withMedia\.map\(\(r\) => r\.x\.media\)\)/g) ?? []).length;
  const still = (src.match(/clipStill\(/g) ?? []).length;
  // 호출 지점 셋 — 중복 검사 · 브리핑 장면별 검사 · 한 회차 묶음 검사
  (raw === 0 && still >= 3)
    ? ok(`CLIP 관문이 영상도 프레임으로 잰다 (호출 ${still}곳, 날것 ${raw}곳)`)
    : bad(`media 를 그대로 사진으로 여는 곳이 ${raw}곳 남았다`);
}

// 지난 회차 파일이 남아 새 회차에 섞이지 않는가 (2026-09-19)
//   make-shorts 의 작업 폴더는 회차마다 새로 만들지 않고 이름을 장면 번호로 짓는다(cc0.mp4).
//   downloadCcClip 은 마지막에 existsSync(outFile) 로 성공을 판정하는데, yt-dlp 가 mp4 가
//   아닌 형식으로 저장하면(포맷 폴백 두 갈래가 ext 를 강제하지 않는다) 이번 회차에는 그 파일이
//   안 생긴다. 그때 **어제 회차의 cc0.mp4 가 남아 있으면 그걸 돌려준다** — 남의 영상이 실린다.
//   실측: /tmp/flowvium-shorts 에 12:11 회차가 끝난 뒤 11:41 의 p3.mp4 와 09:23 의 ov0_4.png 가
//   그대로 있었다. 옆 세션도 같은 사고를 겪었다(슬러그 번호 재사용으로 옛 소재가 새 편에 섞임).
{
  const { mkdtempSync, writeFileSync, existsSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const dir = mkdtempSync(join(tmpdir(), 'cc-stale-'));
  const out = join(dir, 'cc0.mp4');
  writeFileSync(out, 'ANCIENT');                      // 어제 회차가 남긴 파일
  // 받기 자체가 안 되는 상태로 부른다(ccDownloadReady 실패 또는 videoId 없음) —
  // 그래도 옛 파일이 살아 있으면 안 된다.
  const got = downloadCcClip({ videoId: '', url: '' }, out, { seconds: 6 });
  got === null && !existsSync(out)
    ? ok('옛 회차 파일을 지우고 null 을 돌려준다')
    : bad(`옛 파일이 살아남았다 — got=${got} exists=${existsSync(out)}`);
}

// make-shorts 가 회차 시작 때 작업 폴더를 비우는가 (같은 결함 부류의 경계 방어)
//   막는 자리를 하나씩 늘리는 대신 없는 상태에서 시작한다 — 새 파일이 늘어도 규칙이 따라간다.
{
  const { readFileSync: rf } = await import('fs');
  const { ROOT: R } = await import('./project-root.mjs');
  const src = rf(`${R}/scripts/video/make-shorts.mjs`, 'utf8');
  const i = src.indexOf("const WORK = join(tmpdir()");
  const head = i >= 0 ? src.slice(i, i + 1400) : '';
  /rmSync\(WORK,[^)]*recursive[^)]*\)/.test(head) && head.indexOf('rmSync(WORK') < head.indexOf('mkdirSync(WORK')
    ? ok('회차 시작 때 작업 폴더를 비우고 다시 만든다')
    : bad('작업 폴더를 비우지 않고 시작한다 — 지난 회차 파일이 섞인다');
}

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
