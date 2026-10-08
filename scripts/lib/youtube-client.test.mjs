#!/usr/bin/env node
/**
 * youtube-client.test.mjs — 한 프로세스는 OAuth 클라이언트를 **하나만** 쓴다. 2026-10-08 신설.
 *
 * 사고(10/08): 쇼츠 7편이 렌더까지 끝나고 업로드에서 전부 401 "Request had invalid authentication credentials".
 *   토큰은 유효(tokeninfo 200·youtube.upload 스코프), 같은 토큰으로 직접 보낸 업로드 요청도 200.
 *   격리 실험(같은 토큰·같은 파일): A 새 클라이언트로 insert 만 → OK · C 한 클라이언트로 channels.list 후 insert → OK
 *   · B/D **클라이언트 둘** — 하나로 channels.list(채널 확인) 뒤 새로 만든 다른 클라이언트로 insert → 401.
 *   upload() 가 currentChannel()(클라이언트 1)과 videos.insert(클라이언트 2)를 따로 만들고 있었다.
 *   10/06 부터 썸네일·재생목록에서 가끔 나던 같은 오류도 이 모양(클라이언트를 새로 만들어 이어 부르기).
 * 고침: authorized() 를 프로세스당 하나로 memo — 모든 호출이 같은 클라이언트를 쓴다.
 */
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const m = await import('./youtube.mjs');
let same = false;
try { same = m.authorizedClient() === m.authorizedClient(); } catch (e) { console.log('  (토큰 없음 — 구조만 본다)', e.message); same = /let _client/.test(readFileSync(new URL('./youtube.mjs', import.meta.url), 'utf8')); }
same ? ok('[1] authorizedClient() 가 같은 클라이언트를 돌려준다') : bad('[1] 부를 때마다 새 클라이언트');
const rc = readFileSync(new URL('../shorts-reconcile.mjs', import.meta.url), 'utf8');
/privacyStatus/.test(rc) && /'public'/.test(rc) ? ok('[2] 원장 맞추기는 공개 영상만(비공개 시험 업로드가 쇼츠로 잡히지 않게)') : bad('[2] reconcile 이 비공개도 넣는다');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
