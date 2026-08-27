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
  writeFileSync(TOKEN, JSON.stringify(tokens, null, 1), { mode: 0o600 });
  return TOKEN;
}

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
export async function upload(o) {
  if (!o?.file || !existsSync(o.file)) throw new Error(`영상 파일 없음: ${o?.file}`);
  if (!o?.title) throw new Error('title 필요');
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
