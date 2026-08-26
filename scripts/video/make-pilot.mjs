#!/usr/bin/env node
/**
 * make-pilot.mjs — 30초 파일럿 1편. 우리 데이터 + 앵커 음성 + ffmpeg 합성.
 *
 * 왜 이 순서인가(2026-08-27): 자동화 코드를 쓰기 전에 **볼 만한지부터** 확인한다.
 *   볼 만하지 않으면 자동화는 쓰레기를 빠르게 찍어내는 장치일 뿐이고, 그건 YouTube 의
 *   inauthentic content 정책(채널 단위 단속)에 정면으로 걸리는 길이다.
 *
 * 소재는 우리만 가진 것으로 고른다 — SEC 8-K 계약 + **수혜 예상 종목 계산**
 *   (supplyChainChanges[].downstreamBeneficiaries). 긁어온 뉴스가 아니라 자체 산출물이다.
 *
 * 장면 길이는 나레이션 실측 길이로 맞춘다. 고정 초를 쓰면 음성과 화면이 어긋난다.
 *
 * 사용: node scripts/video/make-pilot.mjs [--locale ko] [--out reports/video/pilot.mp4]
 */
import Database from 'better-sqlite3';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from '../lib/project-root.mjs';
import { synthesize } from '../lib/tts.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const locale = arg('--locale', 'ko');
const OUT = resolve(ROOT, arg('--out', 'reports/video/pilot.mp4'));
const WORK = resolve(ROOT, 'reports/video/.work');
const W = 1920, H = 1080;   // Flow 기본이 16:9 라 맞춘다(클립을 나중에 끼울 때 합성이 깨지지 않게)

// ── 1. 데이터 ────────────────────────────────────────────────────────────────
const db = new Database(resolve(ROOT, 'data/flowvium.db'), { readonly: true });
const row = db.prepare('SELECT id, full_json FROM reports ORDER BY created_at DESC LIMIT 1').get();
db.close();
if (!row) { console.error('❌ 보고서 없음'); process.exit(1); }
const R = JSON.parse(row.full_json);

const sc = (R.supplyChainChanges ?? []).find((s) => (s.downstreamBeneficiaries ?? []).length >= 2)
        ?? (R.supplyChainChanges ?? [])[0];
if (!sc) { console.error('❌ supplyChainChanges 없음 — 이 파일럿의 소재가 없다'); process.exit(1); }
const themes = (R.marketNarrative?.hotThemes ?? []).slice(0, 4);
const bens = (sc.downstreamBeneficiaries ?? []).slice(0, 3);

// ── 2. 장면 (대본은 숫자를 한글로 푼다 — TTS 가 "$105billion" 을 못 읽는다) ──
const scenes = [
  { key: 'intro',  kicker: 'FLOWVIUM', title: '오늘의 공급망 신호',
    lines: themes.map((t) => `#${t}`),
    say: '플로비움 마켓 시그널입니다. 오늘 포착된 공급망 변화를 짚어드립니다.' },
  { key: 'signal', kicker: sc.signalType ?? 'SIGNAL', title: sc.ticker,
    lines: [String(sc.headline ?? '').replace(/^8-K\s*/, '').slice(0, 70)],
    say: `${sc.ticker} 에서 사업계약 공시가 확인됐습니다. 확신도는 백 점 만점에 ${sc.conviction ?? 0}점입니다.` },
  { key: 'chain',  kicker: '파급 예상', title: '수혜 후보',
    lines: bens,
    say: `이 변화는 ${bens.join(', ')} 로 이어질 수 있습니다.` },
  { key: 'outro',  kicker: '', title: 'flowvium.net',
    lines: ['매일 다섯 번, AI 가 시장을 다시 봅니다'],
    say: '자세한 분석은 플로비움 닷 넷에서 확인하실 수 있습니다.' },
];

// ── 3. 화면 (Playwright 로 카드 렌더) ────────────────────────────────────────
const card = (s) => `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:linear-gradient(135deg,#0b1020,#141c33 60%,#0b1020);
     font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;color:#e8eefc;
     display:flex;flex-direction:column;justify-content:center;padding:0 140px}
.kicker{font-size:34px;letter-spacing:.22em;color:#6ea8ff;font-weight:700;margin-bottom:28px}
.title{font-size:${s.title.length > 12 ? 92 : 132}px;font-weight:800;letter-spacing:-.02em;line-height:1.08}
.lines{margin-top:44px;display:flex;flex-direction:column;gap:22px}
.line{font-size:46px;color:#b8c7e6;line-height:1.35}
.chip{display:inline-block;background:#1c2947;border:1px solid #2f4270;border-radius:999px;
      padding:14px 34px;font-size:52px;font-weight:700;color:#dbe7ff;margin-right:18px}
.bar{position:absolute;left:0;top:0;width:10px;height:100%;background:linear-gradient(#6ea8ff,#3f6fd8)}
.foot{position:absolute;bottom:64px;left:140px;font-size:28px;color:#5f7099;letter-spacing:.1em}
</style><div class="bar"></div>
${s.kicker ? `<div class="kicker">${s.kicker}</div>` : ''}
<div class="title">${s.title}</div>
<div class="lines">${s.lines.map((l) => s.key === 'chain'
  ? `<div><span class="chip">${l}</span></div>` : `<div class="line">${l}</div>`).join('')}</div>
<div class="foot">FLOWVIUM · ${row.id}</div>`;

mkdirSync(WORK, { recursive: true });
mkdirSync(resolve(ROOT, 'reports/video'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const s of scenes) {
  await page.setContent(card(s));
  await page.screenshot({ path: `${WORK}/${s.key}.png` });
}
await browser.close();
console.log(`  [화면] ${scenes.length}장 렌더`);

// ── 4. 음성 (장면별로 따로 — 길이를 알아야 화면과 맞출 수 있다) ──────────────
const durOf = (f) => {
  const i = spawnSync('afinfo', [f], { encoding: 'utf8' }).stdout ?? '';
  return Number((i.match(/estimated duration:\s*([\d.]+)/i) ?? [])[1] ?? 0);
};
let total = 0;
for (const s of scenes) {
  s.audio = `${WORK}/${s.key}.mp3`;
  await synthesize(s.say, { provider: 'elevenlabs', locale, outPath: s.audio, model: 'eleven_multilingual_v2' });
  s.dur = durOf(s.audio) + 0.35;   // 문장 사이 숨
  total += s.dur;
  console.log(`  [음성] ${s.key.padEnd(7)} ${s.dur.toFixed(1)}초`);
}

// ── 5. 합성 ──────────────────────────────────────────────────────────────────
writeFileSync(`${WORK}/audio.txt`, scenes.map((s) => `file '${s.audio}'`).join('\n'));
writeFileSync(`${WORK}/video.txt`,
  scenes.map((s) => `file '${WORK}/${s.key}.png'\nduration ${s.dur.toFixed(2)}`).join('\n')
  + `\nfile '${WORK}/${scenes[scenes.length - 1].key}.png'\n`);   // concat demuxer 는 마지막 장을 한 번 더 요구한다

const run = (args, label) => {
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`❌ ffmpeg ${label}: ${String(r.stderr).slice(-400)}`); process.exit(1); }
};
run(['-y', '-f', 'concat', '-safe', '0', '-i', `${WORK}/audio.txt`, '-c', 'copy', `${WORK}/voice.mp3`], 'audio-concat');
run(['-y', '-f', 'concat', '-safe', '0', '-i', `${WORK}/video.txt`, '-i', `${WORK}/voice.mp3`,
     '-vf', `scale=${W}:${H},format=yuv420p`, '-r', '30',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
     '-c:a', 'aac', '-b:a', '192k', '-shortest', OUT], 'mux');

const size = existsSync(OUT) ? (await import('fs')).statSync(OUT).size : 0;
console.log(`\n✅ ${OUT}`);
console.log(`   ${total.toFixed(1)}초 · ${(size / 1048576).toFixed(1)}MB · ${W}x${H} · 소재: ${row.id}`);
console.log(`   대본 ${scenes.reduce((n, s) => n + s.say.length, 0)}자 (ElevenLabs 크레딧)`);
