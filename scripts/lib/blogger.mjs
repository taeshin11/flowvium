/**
 * blogger.mjs — Blogger v3 로 글을 올린다. (2026-09-18 신설)
 *
 * 왜 Blogger 인가: 사용자가 네이버 자동 게시를 원했지만 네이버는 글쓰기 API 를 2020-05 에
 *   종료했고 약관이 자동 게재를 금지한다. 티스토리 오픈 API 도 2024-02 에 완전 종료됐다.
 *   지금 **정식 API 로 글을 올릴 수 있는 곳**은 Blogger v3 와 워드프레스뿐이다.
 *   Blogger 는 폐지 공지가 없고 OAuth 2.0 으로 posts.insert 를 그대로 받는다.
 *
 * 자격증명은 유튜브와 **같은 OAuth 클라이언트**(secrets/youtube-oauth.json)를 쓴다.
 *   같은 구글 클라우드 프로젝트이므로 클라이언트를 또 만들 이유가 없다. 대신 토큰 파일은
 *   따로 둔다(secrets/blogger-token.json) — 하나로 합치면 한쪽 재동의가 다른 쪽을 날린다.
 *   (실제로 youtube.mjs 는 스코프가 하나라도 빠지면 저장을 거부한다. 파일을 공유하면
 *    blogger 만 동의한 토큰이 유튜브 업로드를 멈추게 만든다.)
 *
 * 두 파일 모두 .gitignore 의 secrets/ 아래라 커밋되지 않는다. 값을 로그에 찍지 않는다.
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './project-root.mjs';

// 글을 쓰려면 읽기 전용(blogger.readonly)으로는 안 된다. 목록 조회도 이 스코프로 같이 된다.
export const SCOPES = ['https://www.googleapis.com/auth/blogger'];

const CRED = resolve(ROOT, 'secrets/youtube-oauth.json');
export const TOKEN = resolve(ROOT, 'secrets/blogger-token.json');

export function credentialsPresent() { return existsSync(CRED); }
export function tokenPresent() { return existsSync(TOKEN); }

export function loadClient(redirect) {
  if (!existsSync(CRED)) {
    throw new Error(`OAuth 자격증명 없음 — ${CRED} (유튜브와 같은 '데스크톱 앱' 클라이언트를 쓴다)`);
  }
  const raw = JSON.parse(readFileSync(CRED, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c?.client_id) throw new Error(`자격증명 형식 오류 — installed(데스크톱 앱) 타입이어야 한다`);
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirect ?? c.redirect_uris?.[0] ?? 'http://localhost');
}

/** 동의로 받은 토큰을 저장한다. 요청한 권한이 다 왔는지 **저장 전에** 확인한다. */
export function saveTokens(tokens) {
  if (!tokens.refresh_token) {
    throw new Error(`refresh_token 이 없다 — prompt=consent 로 다시 동의하거나 기존 앱 권한을 해제하고 재시도하라`);
  }
  const granted = new Set(String(tokens.scope ?? '').split(/\s+/).filter(Boolean));
  const missing = SCOPES.filter((s) => !granted.has(s));
  if (missing.length) {
    throw new Error(`동의에서 빠진 권한: ${missing.join(', ')}\n  받은 권한: ${[...granted].join(' ') || '(없음)'}`);
  }
  writeFileSync(TOKEN, JSON.stringify(tokens, null, 1), { mode: 0o600 });
  return TOKEN;
}

function authorized() {
  if (!existsSync(TOKEN)) throw new Error(`토큰 없음 — node scripts/blogger-auth.mjs 를 먼저 실행하라`);
  const o = loadClient();
  o.setCredentials(JSON.parse(readFileSync(TOKEN, 'utf8')));
  o.on('tokens', (t) => {
    try {
      const cur = JSON.parse(readFileSync(TOKEN, 'utf8'));
      writeFileSync(TOKEN, JSON.stringify({ ...cur, ...t }, null, 1), { mode: 0o600 });
    } catch { /* 갱신 저장 실패는 비치명 — 다음 호출에서 다시 갱신한다 */ }
  });
  return o;
}

const api = (auth) => google.blogger({ version: 'v3', auth: auth ?? authorized() });

/** 이 계정이 가진 블로그 목록. 올리기 **전에** 어디로 가는지 확인하려고 쓴다. */
export async function listBlogs(auth) {
  const r = await api(auth).blogs.listByUser({ userId: 'self' });
  return (r.data.items ?? []).map((b) => ({ id: b.id, name: b.name, url: b.url, posts: b.posts?.totalItems ?? 0 }));
}

/**
 * 글 하나를 올린다.
 * @param {{blogId:string, title:string, html:string, labels?:string[], draft?:boolean}} o
 * @returns {Promise<{id:string, url:string, status:string}>}
 */
export async function insertPost({ blogId, title, html, labels = [], draft = false }) {
  if (!blogId) throw new Error(`blogId 가 없다 — .env.local 의 BLOGGER_BLOG_ID 를 채우거나 --blog 로 넘겨라`);
  if (!title?.trim()) throw new Error(`제목이 비었다`);
  if (!html?.trim()) throw new Error(`본문이 비었다`);
  const r = await api().posts.insert({
    blogId,
    isDraft: draft,
    requestBody: { kind: 'blogger#post', title: title.trim(), content: html, labels },
  });
  return { id: r.data.id, url: r.data.url, status: r.data.status ?? (draft ? 'DRAFT' : 'LIVE') };
}
