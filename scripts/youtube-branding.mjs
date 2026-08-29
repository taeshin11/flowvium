#!/usr/bin/env node
/**
 * youtube-branding.mjs — 채널 브랜딩(설명·키워드·국가·기본언어)을 읽고 바꾼다.
 *
 * ⚠ API 로 **못 바꾸는 것**이 있다. 착각하면 "바꿨는데 왜 그대로냐" 가 된다:
 *   · 프로필 사진, 배너 이미지 — Studio 에서 사람이 올려야 한다.
 *   · 맞춤 URL(@handle) — 이름을 바꿔도 따라오지 않는다. 따로 신청한다.
 *   · 채널 이름 — brandingSettings.channel.title 로 보내면 받아주긴 하나
 *     구글 계정에 연결된 채널에서는 무시되는 경우가 많다. **보내고 다시 읽어 확인한다.**
 *
 * 덮어쓰기 전에 현재 값을 파일로 **백업**한다. 남의 채널을 되돌릴 수 없게 만들면 안 된다.
 *
 * 사용:
 *   node scripts/youtube-branding.mjs --show
 *   node scripts/youtube-branding.mjs --apply --preset flowvium
 *   node scripts/youtube-branding.mjs --restore <백업파일>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { google } from 'googleapis';
import { ROOT } from './lib/project-root.mjs';
import { authorizedClient, currentChannel } from './lib/youtube.mjs';

const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };

const PRESETS = {
  flowvium: {
    title: 'Flowvium',
    description: [
      'Flowvium — daily US news and issues, told straight.',
      '',
      'Every day we take the stories actually moving the United States — politics, the economy,',
      'the courts, culture — and turn them into a tight, watchable briefing. No filler, no hype,',
      'no 20-minute detours. Just what happened, why it matters, and what comes next.',
      '',
      'On this channel:',
      '• Daily news briefings on US politics and policy',
      '• Markets, the Federal Reserve, and the economy explained',
      '• Courts, elections, and the stories shaping the national conversation',
      '• Entertainment and culture that people are actually talking about',
      '',
      'New briefings every day. Subscribe so you never miss the story.',
      '',
      // 영어 채널이라 **영어 강제** 주소를 쓴다 — flowvium.net 은 브라우저 언어를 따라간다.
      '▶ Full coverage, live market data and deeper analysis: https://flowvium.net/go/en',
      '',
      '#news #usnews #politics #breakingnews #economy',
    ].join('\n'),
    // 채널 키워드는 공백 구분이고, 여러 낱말짜리는 따옴표로 묶는다.
    keywords: [
      'news', 'US news', 'breaking news', 'daily news', 'politics', 'US politics',
      'economy', 'markets', 'Federal Reserve', 'news briefing', 'world news',
      'current events', 'top stories', 'news update', 'Flowvium',
    ].map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' '),
    country: 'US',
    defaultLanguage: 'en',
  },
};

const yt = google.youtube({ version: 'v3', auth: authorizedClient() });

async function read() {
  const r = await yt.channels.list({ part: ['snippet', 'brandingSettings', 'status'], mine: true });
  const c = r.data.items?.[0];
  if (!c) throw new Error('채널을 못 읽었다');
  return c;
}

const ch = await read();

if (a.includes('--show') || a.length === 0) {
  console.log('채널     :', ch.snippet.title, `(${ch.id})`);
  console.log('맞춤URL  :', ch.snippet.customUrl ?? '(없음)');
  console.log('국가     :', ch.brandingSettings?.channel?.country ?? '(없음)');
  console.log('기본언어 :', ch.brandingSettings?.channel?.defaultLanguage ?? '(없음)');
  console.log('키워드   :', ch.brandingSettings?.channel?.keywords ?? '(없음)');
  console.log('설명     :', (ch.snippet.description || '(없음)').split('\n')[0].slice(0, 90));
  process.exit(0);
}

if (a.includes('--restore')) {
  const file = arg('--restore');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  await yt.channels.update({ part: ['brandingSettings'], requestBody: { id: ch.id, brandingSettings: saved.brandingSettings } });
  console.log(`✅ 되돌렸다 — ${file}`);
  process.exit(0);
}

if (!a.includes('--apply')) { console.error('❌ --show / --apply / --restore 중 하나가 필요하다'); process.exit(1); }

const preset = PRESETS[arg('--preset', 'flowvium')];
if (!preset) { console.error(`❌ 프리셋 없음: ${arg('--preset')} (있는 것: ${Object.keys(PRESETS).join(', ')})`); process.exit(1); }

// 되돌릴 수 있게 먼저 저장한다.
const dir = resolve(ROOT, 'secrets/youtube-branding-backup');
mkdirSync(dir, { recursive: true });
const stamp = ch.etag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
const backup = resolve(dir, `${ch.id}-${stamp}.json`);
writeFileSync(backup, JSON.stringify({ id: ch.id, snippet: ch.snippet, brandingSettings: ch.brandingSettings }, null, 1), { mode: 0o600 });
console.log(`  백업: ${backup}`);

const body = {
  id: ch.id,
  brandingSettings: {
    ...ch.brandingSettings,
    channel: {
      ...ch.brandingSettings?.channel,
      title: preset.title,
      description: preset.description,
      keywords: preset.keywords,
      country: preset.country,
      defaultLanguage: preset.defaultLanguage,
    },
  },
};

await yt.channels.update({ part: ['brandingSettings'], requestBody: body });

// "보냈다" 와 "바뀌었다" 는 다르다 — 다시 읽어 확인한다.
const after = await read();
const got = after.brandingSettings?.channel ?? {};
const check = (label, want, have) => {
  const okv = String(have ?? '').trim() === String(want ?? '').trim();
  console.log(`  ${okv ? '✅' : '❌'} ${label}: ${okv ? '반영됨' : `요청 "${String(want).slice(0, 40)}" → 실제 "${String(have ?? '(없음)').slice(0, 40)}"`}`);
  return okv;
};
console.log('\n적용 결과:');
check('설명', preset.description, after.snippet.description);
check('키워드', preset.keywords, got.keywords);
check('국가', preset.country, got.country);
check('기본언어', preset.defaultLanguage, got.defaultLanguage);
const titleOk = check('이름', preset.title, after.snippet.title);
if (!titleOk) {
  console.log('\n  ℹ 채널 이름은 API 로 안 바뀐다 — YouTube Studio → 맞춤설정 → 브랜딩 에서 직접 바꿔야 한다.');
}
console.log('\n  API 로 못 하는 것: 프로필 사진, 배너, 맞춤 URL(@handle).');
console.log(`  되돌리려면: node scripts/youtube-branding.mjs --restore ${backup}`);
