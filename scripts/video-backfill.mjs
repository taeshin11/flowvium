#!/usr/bin/env node
/**
 * video-backfill.mjs — 거른 회차를 나중에 메운다.
 *
 * 왜 (2026-09-05 사용자 "백필로 국뽕주제라도 하라고 했잖아"):
 *   오늘 8슬롯 중 07:00·09:00·19:00 세 번을 걸렀다. 거른 판단 자체는 옳았다 —
 *   회색 카드나 틀린 사진을 내보내느니 거르는 게 낫다. 그런데 **거기서 끝났다.**
 *   19:00 은 구글 봇 확인 쿨다운(30분)이 원인이었으므로, 조금 기다렸다 다시 하면 됐다.
 *
 *   슬롯을 놓친 것과 그날 편수가 모자란 것은 다른 문제다. 슬롯은 지나가지만 편수는 메울 수 있다.
 *
 * 어떻게:
 *   · 오늘 지나간 슬롯 수와 실제 발행 수를 견준다. 모자라면 한 편 만든다.
 *   · 구글이 쿨다운이면 아무 주제도 소재가 없다 — 그냥 돌아간다(다음 백필에 다시 본다).
 *   · 국뽕 주제를 우선한다(사용자 지시). 없으면 평소 편성으로 간다.
 *   · **한 번에 한 편만.** 모자란 만큼 몰아서 올리면 채널이 이상해진다.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';

loadEnvLocal();
const log = (...a) => console.log(
  new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 19), '[backfill]', ...a);

/** 편성표. plist 와 같은 값이어야 한다 — 어긋나면 백필이 헛돈다. */
const SLOTS = (process.env.SHORTS_SLOTS || '07:00,09:00,12:00,13:30,16:00,17:30,19:00,22:00')
  .split(',').map((s) => s.trim()).filter(Boolean);

const kst = () => new Date(Date.now() + 9 * 3600_000);
const nowMin = () => { const d = kst(); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const elapsed = SLOTS.filter((s) => toMin(s) <= nowMin()).length;

const { openDb, shortsLiveCountSince } = await import('./lib/db.mjs');
const db = openDb();
// KST 오늘 = UTC 로 어제 15:00 이후
const since = new Date(`${kst().toISOString().slice(0, 10)}T00:00:00+09:00`).toISOString();
// **내린 편은 세지 않는다.** 잘못 나가서 비공개로 돌린 것을 "냈다" 로 세면 메울 기회를 잃는다.
const done = shortsLiveCountSince(since);

log(`오늘 지나간 슬롯 ${elapsed} · 발행 ${done}`);
if (done >= elapsed) { log('모자라지 않는다 — 할 일 없음'); process.exit(0); }

// 마지막 발행이 너무 최근이면 쉰다. 백필이 정규 슬롯 바로 뒤에 붙으면 두 편이 몰린다.
const GAP_MIN = Number(process.env.BACKFILL_MIN_GAP_MIN || 40);
const last = db.prepare('SELECT published_at FROM shorts_published ORDER BY rowid DESC LIMIT 1').get();
if (last) {
  const mins = (Date.now() - Date.parse(last.published_at)) / 60000;
  if (mins < GAP_MIN) { log(`마지막 발행이 ${Math.round(mins)}분 전 — ${GAP_MIN}분은 띄운다`); process.exit(0); }
}

// 2026-09-05: 이 검사를 **주석에만 쓰고 구현하지 않았다.** 그래서 구글 쿨다운 중에 백필이 돌아
//   회색 카드 3장 + 임시정부 청사 사진으로 한 편이 나갔다(내렸다). 문서와 코드가 어긋나면
//   문서 쪽을 믿게 되어 더 나쁘다.
// 2026-09-05: 20:45 백필이 저녁 보고서와 겹쳐 **75분을 기다렸다.** 백필은 메우는 일이라
//   급하지 않다 — 기다리며 GPU 를 물고 있느니 다음 차례에 하는 게 낫다.
//   (video-publish 는 정규 슬롯을 위해 기다리도록 만들어졌다. 백필은 그 대상이 아니다.)
if (spawnSync('/usr/bin/pgrep', ['-f', 'generate-report-local'], { encoding: 'utf8' }).status === 0) {
  log('보고서 생성 중 — 백필은 급하지 않다. 다음 차례에 본다');
  process.exit(0);
}

const { googleCoolingDown } = await import('./lib/google-images.mjs');
if (googleCoolingDown()) {
  log('구글 봇 확인 쿨다운 중 — 지금 만들면 소재가 없다. 다음 백필에 다시 본다');
  process.exit(0);
}

log(`${elapsed - done}편 모자란다 — 한 편 메운다(국뽕 우선)`);
const r = spawnSync(process.execPath, [
  resolve(ROOT, 'scripts/video-publish.mjs'),
  '--shorts', '--locale', 'ko', '--privacy', 'public',
], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SHORTS_PREFER_PROUD: '1' } });

// exit 3 = 낼 것이 없다(고장 아님). 백필은 다음 차례에 다시 본다.
if (r.status === 3) { log('이번엔 낼 것이 없다 — 다음 백필에 다시 본다'); process.exit(0); }
process.exit(r.status ?? 1);
