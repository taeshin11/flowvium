#!/usr/bin/env node
/**
 * youtube-auth.mjs — 최초 1회 OAuth. 브라우저 동의 → refresh token 저장.
 *
 * 로컬 루프백 서버로 code 를 직접 받는다. 사용자가 URL 조각을 복사·붙여넣을 필요가 없다
 *   — 그 과정에서 토큰이 대화창에 노출되는 사고가 나기 쉽다(이 세션에 실제로 겪었다).
 *
 * 사용: node scripts/youtube-auth.mjs
 */
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import { credentialsPresent, exchangeCode } from './lib/youtube.mjs';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';

if (!credentialsPresent()) {
  console.error('❌ secrets/youtube-oauth.json 없음');
  console.error('   구글 콘솔 → 사용자 인증 정보 → OAuth 클라이언트 ID → **데스크톱 앱** → JSON 다운로드');
  console.error('   받은 파일을 secrets/youtube-oauth.json 으로 옮겨라(내용을 대화에 붙여넣지 말 것).');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(ROOT, 'secrets/youtube-oauth.json'), 'utf8'));
const c = raw.installed ?? raw.web;
const PORT = Number(process.env.OAUTH_PORT ?? 8788);
const redirect = `http://localhost:${PORT}`;
const oauth = new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
const url = oauth.generateAuthUrl({
  access_type: 'offline', prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/youtube.upload',
    // 업로드만 받으면 channels.list 가 403 이라 어느 채널에 올라갔는지 확인이 안 된다.
    'https://www.googleapis.com/auth/youtube.readonly',
  ],
});

const server = createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err) { res.end(`인증 거부: ${err}`); console.error(`❌ ${err}`); server.close(); process.exit(1); }
  if (!code) { res.end('code 없음'); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error('refresh_token 없음 — 기존 권한 해제 후 재시도');
    const { writeFileSync } = await import('fs');
    writeFileSync(resolve(ROOT, 'secrets/youtube-token.json'), JSON.stringify(tokens, null, 1), { mode: 0o600 });
    res.end('<meta charset="utf-8"><h2>인증 완료 — 창을 닫아도 됩니다.</h2>');
    console.log('✅ secrets/youtube-token.json 저장 (권한 600)');
    console.log('   다음: node scripts/youtube-upload.mjs --file <mp4> --title "..." (기본 비공개)');
  } catch (e) {
    res.end(`실패: ${e.message}`);
    console.error(`❌ ${e.message}`);
  }
  server.close(); setTimeout(() => process.exit(0), 200);
});

server.listen(PORT, () => {
  console.log(`  루프백 대기: ${redirect}`);
  console.log(`  ⚠️  구글 콘솔의 이 클라이언트에 승인된 리디렉션 URI 로 ${redirect} 가 등록돼 있어야 한다.`);
  console.log('  브라우저를 엽니다…');
  spawnSync('open', [url]);
});
