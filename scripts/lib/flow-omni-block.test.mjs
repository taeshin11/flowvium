#!/usr/bin/env node
/**
 * flow-omni-block.test.mjs — Flow 「비정상적인 활동」 차단이 뜨면 즉시 멈추고 알린다. 2026-10-03 신설.
 *
 * 사장님 결정(Mac mini2 경유, 10/03): Flow Omni 공통 규칙 — 2–3분마다 1컷, 6컷마다 5분 휴식, 한 번에 한 세션.
 *   **차단 뜨면 즉시 멈추고 Mac mini2 에 알리기.**
 * 우리 쪽 현황: 간격 10분(규칙보다 엄격) · 회차당 1컷(6컷 휴식에 닿지 않음) · 드라이브 락(한 세션) — 이미 지킨다.
 * 빠진 것: 차단 감지가 없었다. flow-clip 은 차단 화면이어도 "N초 안에 새 동영상이 없다" 같은 일반 실패로 끝났고,
 *   다음 회차(10분 뒤)가 또 시도했다. → 화면 글자로 차단을 알아보고(exit 3), 정지 표지를 남겨
 *   **사람이 지울 때까지** 생성하지 않으며, 공용 대기열(드라이브 _flow/queue.md)에 한 줄 올린다.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBlockedText, omniAllowed, markBlocked, postBlockNotice } from './flow-omni.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const d = mkdtempSync(join(tmpdir(), 'flowblk-'));
(isBlockedText('계정에서 비정상적인 활동이 감지되었습니다') && isBlockedText('We noticed unusual activity') && !isBlockedText('동영상 생성 중'))
  ? ok('[1] 차단 문구 판별') : bad('[1]');
const env = { FLOW_OMNI_HOURS: '0-24' }, lockFile = join(d, 'lock.txt'), stateFile = join(d, 'last.json'), blockFile = join(d, 'blocked.json');
omniAllowed({ env, lockFile, stateFile, blockFile }).ok ? ok('[2a] 표지 없으면 허용') : bad(`[2a] ${JSON.stringify(omniAllowed({ env, lockFile, stateFile, blockFile }))}`);
markBlocked({ blockFile, reason: '비정상적인 활동' });
const g = omniAllowed({ env, lockFile, stateFile, blockFile });
(!g.ok && /차단/.test(g.reason)) ? ok(`[2b] 표지 있으면 거부: ${g.reason}`) : bad(`[2b] ${JSON.stringify(g)}`);
const q = join(d, 'queue.md'); writeFileSync(q, '# 대기열\n본문\n');
const n = postBlockNotice({ queueFile: q, who: 'mac-flowvium', reason: '비정상적인 활동', now: new Date('2026-10-03T12:00:00Z') });
const body = readFileSync(q, 'utf8');
(n && body.startsWith('> **⛔') && /mac-flowvium/.test(body) && /Mac mini2/.test(body) && body.includes('본문')) ? ok('[3] 대기열 맨 위에 차단 한 줄(기존 내용 보존)') : bad(`[3] ${body.slice(0, 120)}`);
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
(/isBlockedText\(/.test(src('flow-clip.mjs')) && /process\.exit\(3\)/.test(src('flow-clip.mjs'))) ? ok('[4a] flow-clip 이 화면에서 차단을 보면 exit 3') : bad('[4a]');
/r\.status === 3/.test(src('lib/flow-omni.mjs')) ? ok('[4b] exit 3 이면 표지+알림') : bad('[4b]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
