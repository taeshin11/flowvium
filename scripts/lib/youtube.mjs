/**
 * youtube.mjs — YouTube 업로드. OAuth 는 최초 1회만 브라우저, 이후는 refresh token.
 *
 * 왜 API 인가(2026-08-27): 사용자가 "API 말고 브라우저 자동화로" 를 원했지만, **업로드만은 예외**다.
 *   videos.insert 는 2025-12-04 에 1,600→100 유닛으로 내렸고 2026-06-01 부터 **전용 버킷 하루 100건**
 *   (기존 10,000 유닛 풀과 별개)이다. 즉 무료·정식 경로가 넉넉하다.
 *   브라우저로 업로드를 자동화하면 얻는 게 0이고 ToS 위반 위험만 진다.
 *
 * 자격증명은 secrets/youtube-oauth.json(구글 콘솔 다운로드본), 토큰은 secrets/youtube-token.json.
 *   둘 다 .gitignore 로 제외한다. 값을 로그에 찍지 않는다.
 *
 * 주의(미리 알아둘 것): OAuth 동의화면이 '테스트' 모드면 refresh token 이 7일마다 만료된다.
 *   매일 자동 업로드를 계속하려면 앱을 게시해야 하고, youtube.upload 는 민감 스코프라 심사 대상이다.
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  // readonly 를 같이 받는 이유: upload 만으로는 channels.list / videos.list 가 403 이라
  //   **올린 영상이 어느 채널에 갔는지 확인할 수 없다**(2026-08-27, 사용자가 스튜디오에서 못 찾음).
  //   올려놓고 확인이 안 되는 자동화는 실패를 조용히 넘긴다.
  'https://www.googleapis.com/auth/youtube.readonly',
  // 채널 정보(설명·키워드·국가·기본언어) 수정에 필요하다. upload 만으로는 channels.update 가 403 이다.
  //   ⚠ 이 스코프로도 **채널 이름과 프로필 사진은 못 바꾼다** — 그건 Studio 에서 사람이 한다.
  'https://www.googleapis.com/auth/youtube',
];
const CRED = resolve(ROOT, 'secrets/youtube-oauth.json');
const TOKEN = resolve(ROOT, 'secrets/youtube-token.json');

export function credentialsPresent() { return existsSync(CRED); }
export function tokenPresent() { return existsSync(TOKEN); }

function loadClient() {
  if (!existsSync(CRED)) {
    throw new Error(`OAuth 자격증명 없음 — 구글 콘솔에서 '데스크톱 앱' 클라이언트를 만들어 ${CRED} 로 저장하라`);
  }
  const raw = JSON.parse(readFileSync(CRED, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c?.client_id) throw new Error('자격증명 형식 오류 — installed(데스크톱 앱) 타입이어야 한다');
  // 데스크톱 앱은 loopback redirect 를 쓴다. 콘솔에 등록된 값이 있으면 그걸 우선한다.
  const redirect = c.redirect_uris?.[0] ?? 'http://localhost';
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
}

/** 최초 1회. 브라우저 동의 → code → refresh token 저장. */
export function authUrl() {
  const o = loadClient();
  return o.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function exchangeCode(code) {
  const o = loadClient();
  const { tokens } = await o.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('refresh_token 이 없다 — prompt=consent 로 다시 동의하거나 기존 앱 권한을 해제하고 재시도하라');
  }
  // **요청한 권한이 다 왔는지 여기서 본다.** 동의 화면은 권한마다 체크박스가 따로 있어서,
  //   체크를 안 하면 그 권한만 조용히 빠진 채 성공으로 끝난다(2026-08-28 두 번 겪었다).
  //   나중에 channels.update 가 403 을 낼 때가 아니라, 지금 알아야 한다.
  const granted = new Set(String(tokens.scope ?? '').split(/\s+/).filter(Boolean));
  const missing = SCOPES.filter((s) => !granted.has(s));
  if (missing.length) {
    throw new Error(
      `동의 화면에서 일부 권한이 빠졌다 — 받지 못한 권한:\n    ${missing.join('\n    ')}\n`
      + `  받은 권한: ${[...granted].join(' ') || '(없음)'}\n`
      + '  동의 화면의 **체크박스를 모두 켜고** 다시 동의할 것.'
      + ' 체크박스가 아예 안 보이면 구글 클라우드 콘솔의 OAuth 동의 화면에 그 범위가 등록되지 않은 것이다.',
    );
  }
  writeFileSync(TOKEN, JSON.stringify(tokens, null, 1), { mode: 0o600 });
  return TOKEN;
}

export function authorizedClient() { return authorized(); }

function authorized() {
  const o = loadClient();
  if (!existsSync(TOKEN)) throw new Error(`토큰 없음 — node scripts/youtube-auth.mjs 를 먼저 실행하라`);
  o.setCredentials(JSON.parse(readFileSync(TOKEN, 'utf8')));
  // 갱신된 토큰을 다시 저장해 둔다(access_token 만 바뀌어도).
  o.on('tokens', (t) => {
    try {
      const cur = JSON.parse(readFileSync(TOKEN, 'utf8'));
      writeFileSync(TOKEN, JSON.stringify({ ...cur, ...t }, null, 1), { mode: 0o600 });
    } catch { /* 비치명 */ }
  });
  return o;
}

/**
 * @param {{file:string, title:string, description?:string, tags?:string[],
 *          privacy?:'private'|'unlisted'|'public', categoryId?:string, locale?:string}} o
 * 기본 공개범위는 **private** 다 — 공개 채널에 잘못된 영상이 올라가면 되돌리기 어렵다.
 */
/**
 * 지금 토큰이 가리키는 채널. 올리기 **전에** 확인하려고 따로 뺀다.
 */
export async function currentChannel() {
  const yt = google.youtube({ version: 'v3', auth: authorized() });
  const r = await yt.channels.list({ part: ['snippet', 'statistics'], mine: true });
  const c = r.data.items?.[0];
  if (!c) throw new Error('채널을 못 읽었다 — youtube.readonly 스코프가 있는지 확인할 것');
  return {
    id: c.id, title: c.snippet.title, customUrl: c.snippet.customUrl ?? null,
    videos: Number(c.statistics?.videoCount ?? 0), subs: Number(c.statistics?.subscriberCount ?? 0),
  };
}

/**
 * 올릴 채널이 **의도한 채널인지** 확인한다.
 *
 * 실측 사고(2026-08-27, 08-28): OAuth 동의 때 고른 채널로 계속 간다. 그래서
 *   ① 건강 채널(Dr. Eliot)에 뉴스 영상이 올라갔고,
 *   ② 다시 인증했더니 이번엔 개인 채널(영상 114개·구독자 764명)이 잡혔다.
 *   둘 다 "올라갔다" 는 성공 메시지가 그대로 나왔다 — 조용히 남의 채널에 올린 것이다.
 *
 * .env.local 의 YOUTUBE_CHANNEL_ID 와 다르면 **올리지 않는다.**
 *   설정이 없으면 막지 않되(첫 사용), 어느 채널인지 반드시 알린다.
 */
export function channelMismatch(actual, expected) {
  if (!expected) return null;
  if (actual?.id === expected) return null;
  return `채널이 다르다 — 기대 ${expected}, 실제 ${actual?.id} "${actual?.title}"`
    + ` (영상 ${actual?.videos}개·구독자 ${actual?.subs}명).`
    + ' 의도한 채널이면 .env.local 의 YOUTUBE_CHANNEL_ID 를 고치고,'
    + ' 아니면 node scripts/youtube-auth.mjs 로 그 채널을 골라 다시 인증할 것.';
}

export async function upload(o) {
  if (!o?.file || !existsSync(o.file)) throw new Error(`영상 파일 없음: ${o?.file}`);
  if (!o?.title) throw new Error('title 필요');
  // 올리기 전에 어느 채널인지 확인한다 — 올린 뒤에 알면 지우는 수밖에 없다.
  const ch = await currentChannel();
  const bad = channelMismatch(ch, o.expectChannel ?? null);
  if (bad) throw new Error(bad);
  console.log(`   채널: ${ch.title} (${ch.id}, 영상 ${ch.videos}개·구독자 ${ch.subs}명)`);
  const yt = google.youtube({ version: 'v3', auth: authorized() });
  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: String(o.title).slice(0, 100),
        description: String(o.description ?? '').slice(0, 5000),
        tags: (o.tags ?? []).slice(0, 30),
        categoryId: o.categoryId ?? '25',           // 25 = News & Politics
        defaultLanguage: o.locale ?? 'ko',
        defaultAudioLanguage: o.locale ?? 'ko',
      },
      status: { privacyStatus: o.privacy ?? 'private', selfDeclaredMadeForKids: false },
    },
    media: { body: createReadStream(o.file) },
  });
  return { id: res.data.id, url: `https://youtu.be/${res.data.id}`, bytes: statSync(o.file).size };
}

/**
 * 맞춤 썸네일 지정. **채널이 전화 인증돼 있어야** 한다 — 아니면 403 이 온다.
 * 업로드 자체는 성공했는데 썸네일만 실패하는 경우가 흔하므로, 던지지 않고 결과를 돌려준다.
 *   여기서 던지면 이미 올라간 영상의 링크까지 같이 잃는다.
 */
export async function setThumbnail(videoId, file) {
  if (!videoId) throw new Error('videoId 필요');
  if (!file || !existsSync(file)) return { ok: false, reason: `썸네일 파일 없음: ${file}` };
  const bytes = statSync(file).size;
  // 유튜브 상한 2MB. 넘으면 API 가 그냥 400 을 내므로 미리 관측값과 함께 알린다.
  if (bytes > 2 * 1024 * 1024) return { ok: false, reason: `2MB 초과 (${(bytes / 1048576).toFixed(2)}MB)` };
  const yt = google.youtube({ version: 'v3', auth: authorized() });
  try {
    await yt.thumbnails.set({ videoId, media: { body: createReadStream(file) } });
    return { ok: true, bytes };
  } catch (e) {
    const msg = e?.errors?.[0]?.reason ?? e?.message ?? String(e);
    return {
      ok: false,
      reason: /forbidden|unauthorized/i.test(msg)
        ? `${msg} — 채널이 전화 인증돼 있어야 맞춤 썸네일을 올릴 수 있다 (youtube.com/verify)`
        : msg,
    };
  }
}
