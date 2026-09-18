#!/usr/bin/env node
/**
 * blogger-auth.mjs — Blogger 최초 1회 OAuth. 브라우저 동의 → refresh token 저장.
 *
 * 루프백 서버로 code 를 직접 받는다 — 사용자가 URL 조각을 복사·붙여넣지 않게 한다.
 *   그 과정에서 토큰이 대화창에 노출되는 사고가 나기 쉽다(youtube-auth.mjs 주석 참고).
 *
 * **비밀번호는 사람이 직접 넣는다.** 이 스크립트는 구글 로그인 화면을 열 뿐이고
 *   아이디·비밀번호를 만지지 않는다.
 *
 * 사용: node scripts/blogger-auth.mjs [--account you@gmail.com]
 */
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import { credentialsPresent, loadClient, saveTokens, listBlogs, SCOPES, TOKEN } from './lib/blogger.mjs';
import { loadEnvLocal } from './lib/llm-config.mjs';

loadEnvLocal?.();

if (!credentialsPresent()) {
  console.error(`❌ secrets/youtube-oauth.json 없음 — 유튜브와 같은 '데스크톱 앱' OAuth 클라이언트가 필요하다`);
  process.exit(1);
}

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const ACC = (() => {
  const v = arg('account') || process.env.BLOGGER_ACCOUNT;
  if (!v) return undefined;
  return v.includes('@') ? v : `${v}@gmail.com`;
})();

const PORT = Number(process.env.OAUTH_PORT ?? 8788);
const redirect = `http://localhost:${PORT}`;
const oauth = loadClient(redirect);
// 스코프는 lib/blogger.mjs 의 SCOPES 하나만 본다 — 두 군데 적으면 반드시 어긋난다
//   (youtube-auth 에서 그 실수로 두 번 오진했다).
const url = oauth.generateAuthUrl({
  access_type: 'offline', prompt: 'consent', scope: SCOPES,
  ...(ACC ? { login_hint: ACC } : {}),
});

const server = createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err) { res.end(`인증 거부: ${err}`); console.error(`❌ ${err}`); server.close(); process.exit(1); }
  if (!code) { res.end('code 없음'); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    saveTokens(tokens);   // 권한이 다 왔는지 저장 전에 확인한다
    console.log(`✅ ${TOKEN} 저장 (권한 600)`);

    // 올릴 곳이 실제로 있는지 지금 확인한다. 블로그가 0개면 자동 게시는 시작할 수 없다.
    oauth.setCredentials(tokens);
    const blogs = await listBlogs(oauth);
    if (!blogs.length) {
      console.log(`⚠ 이 계정에 블로그가 없다 — https://www.blogger.com 에서 블로그를 먼저 만들어라`);
    } else {
      console.log(`  블로그 ${blogs.length}개:`);
      for (const b of blogs) console.log(`    ${b.id}  ${b.name}  ${b.url}  (글 ${b.posts})`);
      console.log(`  다음: .env.local 에 BLOGGER_BLOG_ID=${blogs[0].id} 를 넣어라`);
    }
    res.end('<meta charset="utf-8"><h2>인증 완료 — 창을 닫아도 됩니다.</h2>');
  } catch (e) {
    res.end(`실패: ${e.message}`);
    console.error(`❌ ${e.message}`);
  }
  server.close(); setTimeout(() => process.exit(0), 200);
});

server.listen(PORT, () => {
  console.log(`  루프백 대기: ${redirect}`);
  console.log(`  ⚠️  구글 콘솔의 이 클라이언트에 ${redirect} 가 승인된 리디렉션 URI 로 등록돼 있어야 한다(유튜브와 같은 값).`);
  if (ACC) console.log(`  계정 지정: ${ACC}`);
  if (process.argv.includes('--no-open')) {
    // 다른 브라우저(이미 그 계정으로 로그인된 창)에서 동의를 진행할 때 쓴다.
    console.log(`AUTH_URL ${url}`);
  } else {
    console.log('  브라우저를 엽니다 — 로그인과 동의는 직접 해 주세요.');
    spawnSync('open', [url]);
  }
});
