/**
 * vo-burst.mjs — 대사 wav 앞·끝의 '쉭/지직' 잡음 덩어리를 잘라낸다. 2026-10-17 신설.
 *
 * 사장님 "woosh 문제 없도록 다 방지" (desktop1 전달, 10/17 20:2x).
 *   다른 채널의 Gemini TTS(24kHz) 가 문장 끝 바로 뒤에 0.12~0.13초짜리 −6dB 전대역 잡음을,
 *   앞에 10ms 를 붙였다 — 문장이 바뀔 때마다 '쉭'. 우리 MeloTTS(44.1kHz) 에선 10/17 19:20 회차
 *   대사 4개·릴스·완성본 스펙트로그램 어디에도 없었다. 그래도 엔진은 바뀐다(Qwen·Piper 폴백이 있다)
 *   — 엔진 출구에서 매번 재고, 발행 전에 한 번 더 잰다.
 *
 * 판정(desktop1 기준을 그대로): 파일 자신의 표본율/100 크기 10ms 창의 RMS.
 *   꼬리 — 파일의 마지막 큰 소리(> −25dB) 덩어리가 8~20창이고 바로 앞 창이 −45dB 아래.
 *   머리 — 첫 창(들)이 −25dB 위이고 3창 안에 −45dB 아래 창이 온다.
 *   정렬의 말 끝 시각(speechEndSec)보다 앞에서 시작하는 덩어리는 **말**이다 — 자르지 않는다.
 *   20창(0.2초)을 넘는 덩어리도 말일 수 있어 자르지 않는다. 모르면 손대지 않는다.
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, renameSync } from 'fs';
import { createRequire } from 'module';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const LOUD = -25, QUIET = -45, MIN_RUN = 8, MAX_RUN = 20;

/** 10ms 창 RMS(dB) 배열. 표본율·코덱도 같이. */
export function scanVo(path) {
  const info = String(spawnSync(FF, ['-hide_banner', '-i', path], { encoding: 'utf8' }).stderr ?? '');
  const sr = Number((info.match(/Audio: \S+.*?, (\d+) Hz/) ?? [])[1]);
  const codec = (info.match(/Audio: (\w+)/) ?? [])[1] ?? 'pcm_s16le';
  if (!(sr > 0)) throw new Error(`표본율을 못 읽었다: ${path}`);
  const r = spawnSync(FF, ['-hide_banner', '-i', path, '-af',
    `asetnsamples=n=${Math.round(sr / 100)},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) throw new Error(`RMS 측정 실패: ${String(r.stderr).slice(-200)}`);
  const db = [...String(r.stderr).matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -120 : Number(m[1])));
  return { sr, codec, db, burst: findBurst(db) };
}

/** 순수 판정. db: 10ms 창 RMS. → { head: 잘라낼 앞 창 수(0=없음), tail: {start,len}|null } */
export function findBurst(db, { speechEndSec = null } = {}) {
  let head = 0;
  if (db[0] > LOUD) {
    const q = db.slice(0, 4).findIndex((v) => v < QUIET);
    if (q > 0 && db.slice(0, q).every((v) => v > LOUD)) head = q;
  }
  let tail = null;
  let e = db.length - 1;
  while (e >= 0 && !(db[e] > LOUD)) e--;
  if (e > 0) {
    let s = e;
    while (s > 0 && db[s - 1] > LOUD) s--;
    const len = e - s + 1;
    const afterSpeech = speechEndSec == null || s / 100 >= speechEndSec - 0.02;
    if (len >= MIN_RUN && len <= MAX_RUN && s > 0 && db[s - 1] < QUIET && afterSpeech && s > head) tail = { start: s, len };
  }
  return { head, tail };
}

/**
 * 제자리에서 자른다. 잘랐으면 원본은 <이름>.orig.wav 로 남긴다.
 * @returns {{cutHeadSec:number, cutTailSec:number, durationSec:number|null}}
 */
export function trimBurst(path, { speechEndSec = null } = {}) {
  const { sr, codec, db } = scanVo(path);
  const { head, tail } = findBurst(db, { speechEndSec });
  if (!head && !tail) return { cutHeadSec: 0, cutTailSec: 0, durationSec: null };
  const start = head / 100, end = tail ? tail.start / 100 : db.length / 100;
  const orig = path.replace(/(\.\w+)?$/, '.orig$1');
  if (!existsSync(orig)) copyFileSync(path, orig);
  const tmp = `${path}.trim.wav`;
  const r = spawnSync(FF, ['-v', 'error', '-y', '-i', orig, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`,
    '-c:a', codec.startsWith('pcm_') ? codec : 'pcm_s16le', '-ar', String(sr), tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`자르기 실패: ${String(r.stderr).slice(-200)}`);
  renameSync(tmp, path);
  return { cutHeadSec: start, cutTailSec: tail ? db.length / 100 - end : 0, durationSec: end - start };
}

/**
 * 엔진 반환({path, alignment, durationSec, note}[])을 받아 잡음을 잘라내고 길이·정렬을 맞춘다.
 * 말 끝은 정렬에서 읽는다 — 정렬보다 앞의 소리는 건드리지 않는다.
 */
export function cleanVoOut(out, log = (m) => console.log(`  [vo-burst] ${m}`)) {
  return out.map((o, i) => {
    if (!o?.path || !existsSync(o.path)) return o;
    const r = trimBurst(o.path, { speechEndSec: speechEnd(o.alignment) });
    if (!r.cutHeadSec && !r.cutTailSec) return o;
    const h = r.cutHeadSec;
    const shift = (a) => (Array.isArray(a) ? a.map((t) => Math.max(0, t - h)) : a);
    const alignment = o.alignment ? {
      ...o.alignment,
      character_start_times_seconds: shift(o.alignment.character_start_times_seconds),
      character_end_times_seconds: shift(o.alignment.character_end_times_seconds),
    } : o.alignment;
    log(`${i + 1} 잡음 잘라냄 — 앞 ${(h * 1000).toFixed(0)}ms · 끝 ${(r.cutTailSec * 1000).toFixed(0)}ms (원본 .orig 보관)`);
    return { ...o, alignment, durationSec: r.durationSec };
  });
}

/** 말 끝 시각(정렬의 마지막 글자 끝). 정렬이 없으면 null. */
function speechEnd(alignment) {
  const ends = alignment?.character_end_times_seconds ?? [];
  return ends.length ? Math.max(...ends) : null;
}

/**
 * 발행 전 관문: [{path, alignment}] 중 잡음이 남은 것과 말이 잘린 것을 돌려준다(빈 배열 = 통과).
 *   '말이 잘렸다' = 파일 길이가 정렬의 말 끝보다 짧다(desktop1: 자른 wav 가 말 끝을 덮는지).
 */
export function assertNoVoBurst(items) {
  const bad = [];
  for (const { path, alignment } of items) {
    const se = speechEnd(alignment);
    const { db } = scanVo(path);
    const burst = findBurst(db, { speechEndSec: se });
    const cut = se != null && db.length / 100 < se - 0.02;
    if (burst.head || burst.tail || cut) bad.push({ path, ...burst, speechCut: cut });
  }
  return bad;
}
