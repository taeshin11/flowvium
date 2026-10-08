#!/usr/bin/env node
/**
 * youtube-retry.test.mjs — 유튜브 업로드 계열 쓰기의 간헐 401 을 기록하며 다시 시도한다. 2026-10-09 신설.
 *
 * 10/08 하루 0편의 원인 정정: 처음엔 '클라이언트 둘' 로 결론냈으나(시도 1~2회짜리 비교였다) 10/09 실측에서
 *   클라이언트 하나·같은 유효 토큰으로 업로드 세션 시작을 10번 보내자 401 이 5번(401,401,200,200,200,401,401,401,200,200).
 *   테크이슈 세션도 같은 결과(직접 호출 10번 중 6번 실패) — **유튜브 쪽 간헐 거부**다. 우리 버그를 덮는 재시도가 아니라
 *   외부의 일시 오류에 대한 재시도다. 401 만, 최대 5번, 간격을 늘리며, 매번 로그에 남긴다(조용히 삼키지 않는다).
 *   다른 오류(403 권한·400 형식)는 다시 시도해도 안 낫는다 — 바로 던진다.
 */
import { with401Retry } from './youtube.mjs';
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const e401 = () => Object.assign(new Error('Request had invalid authentication credentials'), { status: 401 });
const logs = [];
let n = 0;
const r = await with401Retry(async () => { n++; if (n < 3) throw e401(); return 'ok'; }, { label: 't', waitMs: 1, log: (m) => logs.push(m) });
(r === 'ok' && n === 3 && logs.length === 2) ? ok(`[1] 401 두 번 뒤 성공 — 재시도 2번 모두 기록("${logs[0]}")`) : bad(`[1] r=${r} n=${n} logs=${logs.length}`);
let m403 = 0, threw = null;
try { await with401Retry(async () => { m403++; throw Object.assign(new Error('forbidden'), { status: 403 }); }, { waitMs: 1, log: () => {} }); } catch (e) { threw = e; }
(threw?.status === 403 && m403 === 1) ? ok('[2] 401 아닌 오류는 바로 던진다(다시 해도 안 낫는다)') : bad(`[2] ${m403}`);
let k = 0; threw = null;
try { await with401Retry(async () => { k++; throw e401(); }, { tries: 5, waitMs: 1, log: () => {} }); } catch (e) { threw = e; }
(threw?.status === 401 && k === 5) ? ok('[3] 5번 다 401 이면 마지막 오류를 던진다(무한 반복 없음)') : bad(`[3] ${k}`);
const src = readFileSync(new URL('./youtube.mjs', import.meta.url), 'utf8');
(/with401Retry\(\(\) => yt\.videos\.insert/.test(src) && /with401Retry\(\(\) => yt\.thumbnails\.set/.test(src)) ? ok('[4] 업로드·썸네일이 재시도를 쓴다(매번 새 스트림)') : bad('[4] 연결 안 됨');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
