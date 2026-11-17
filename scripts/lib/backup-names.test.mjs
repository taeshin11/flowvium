#!/usr/bin/env node
/**
 * backup-names.test.mjs — Drive 로 올리는 밤 DB 백업은 gzip 사본이다. (2026-11-17)
 *
 * 배경(11/17 실측): Drive 앱 기록(DriveFS metadata_sqlite_db)을 보니 11/05 이후 밤 DB 백업(각 770~830MB)이
 *   하나도 안 올라갔다 — 0바이트 'local-' 자리표시만. Drive 는 04:20~05:20 창에서 업로드하다 메모리가
 *   4.5GB·8.1GB·12.3GB 로 불어 mini2 drive_guard 상한에 사흘 연속 꺼졌다. 로컬 2차 백업(~/flowvium_backups)은 멀쩡.
 *   mini2 승인: Drive 로 가는 것만 .db.gz, 로컬 원본은 그대로. 옛 .db 자리표시는 정상 파일로 바뀐 걸 본 뒤
 *   사람이 정리한다 — 그래서 보존정책은 .db.gz 만 센다.
 */
import { remoteDbName, REMOTE_DB_RE, remoteRetention } from './backup-names.mjs';

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

remoteDbName('2026-11-18') === 'flowvium-2026-11-18.db.gz' ? ok('[1] Drive 이름은 .db.gz') : bad(`[1] ${remoteDbName('2026-11-18')}`);

(REMOTE_DB_RE.test('flowvium-2026-11-18.db.gz') && !REMOTE_DB_RE.test('flowvium-2026-11-18.db') && !REMOTE_DB_RE.test('.flowvium-backup.part'))
  ? ok('[2] 원격 판정은 .db.gz 만') : bad('[2] REMOTE_DB_RE');

const files = ['flowvium-2026-11-05.db', 'flowvium-2026-11-16.db', 'HANDOFF.md',
  ...Array.from({ length: 9 }, (_, i) => `flowvium-2026-11-${String(10 + i).padStart(2, '0')}.db.gz`)];
const victims = remoteRetention(files, 7);
(JSON.stringify(victims) === JSON.stringify(['flowvium-2026-11-10.db.gz', 'flowvium-2026-11-11.db.gz']))
  ? ok('[3] 보존정책은 오래된 .db.gz 만 지운다 — 옛 .db 자리표시·다른 파일은 그대로') : bad(`[3] ${JSON.stringify(victims)}`);

remoteRetention(['flowvium-2026-11-18.db.gz'], 7).length === 0 ? ok('[4] KEEP 이하면 아무것도 안 지운다') : bad('[4]');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
