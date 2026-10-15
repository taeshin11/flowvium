#!/usr/bin/env node
/**
 * runner-reload.test.mjs — cron-runner 가 자기 코드가 바뀌면 스스로 내려간다(launchd KeepAlive 가 새 코드로 올린다). 2026-10-15 신설.
 *
 * 왜: 잡 표(MAINT_JOBS)는 프로세스가 뜰 때 한 번 읽힌다. 10/15 에 platform-daily 를 넣고 푸시했지만 러너는
 *   10/12 14:13 부터 떠 있어 **한 번도 돌지 않았다** — 커밋·푸시·verify 통과가 '등록됨' 을 뜻하지 않았다.
 *   어떤 새 잡이든, 기존 잡의 일정 변경이든 같은 식으로 조용히 안 먹는다.
 * 규칙:
 *   - 기준은 러너 파일과 그것이 직접 부르는 ./lib 파일들의 내용 해시(ESM 은 한 번 읽으면 다시 안 읽는다).
 *   - 바뀌었어도 **자식 프로세스가 하나라도 있으면** 내려가지 않는다 — 돌던 잡(보고서 backfill·커밋 중)을 죽이지 않는다.
 *   - 해시를 못 구하면(파일 없음 등) 내려가지 않는다 — 모르면 그대로 둔다.
 */
import { localImports, codeHash, shouldReload } from './runner-reload.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

const src = `import cron from 'node-cron';\nimport { a } from './lib/cron-slot.mjs';\nimport { b } from "./lib/report-sessions.mjs";\nconst x = await import('./lib/dyn.mjs');`;
const li = localImports(src);
li.join(',') === './lib/cron-slot.mjs,./lib/report-sessions.mjs' ? ok('[1] 정적 ./lib import 만 고른다(외부 패키지·동적 import 제외)') : bad(`[1] ${li}`);
const files = { 'r.mjs': 'A', 'l.mjs': 'B' };
const read = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
const h1 = codeHash(['r.mjs', 'l.mjs'], read);
files['l.mjs'] = 'B2';
const h2 = codeHash(['r.mjs', 'l.mjs'], read);
h1 && h2 && h1 !== h2 ? ok('[2] lib 한 파일만 바뀌어도 해시가 바뀐다') : bad(`[2] ${h1} ${h2}`);
codeHash(['r.mjs', 'none.mjs'], read) === null ? ok('[3] 파일을 못 읽으면 null') : bad('[3]');
shouldReload({ boot: h1, now: h2, children: 0 }) === true ? ok('[4] 바뀜 + 자식 없음 → 내려간다') : bad('[4]');
shouldReload({ boot: h1, now: h2, children: 1 }) === false ? ok('[5] 자식이 돌고 있으면 기다린다') : bad('[5]');
shouldReload({ boot: h1, now: h1, children: 0 }) === false ? ok('[6] 안 바뀌었으면 그대로') : bad('[6]');
shouldReload({ boot: h1, now: null, children: 0 }) === false && shouldReload({ boot: null, now: h2, children: 0 }) === false ? ok('[7] 해시를 모르면 그대로') : bad('[7]');
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
