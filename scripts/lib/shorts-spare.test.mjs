#!/usr/bin/env node
/**
 * shorts-spare.test.mjs — 예비 쇼츠를 미리 만들어 두고, 정규 렌더가 실패·지연되면 예비를 올린다. 2026-09-26 신설.
 * 사장님: "시간이 지나서 못올린다는게 말이됨? 예비를 계속 뽑아놔야지"
 * 실측: 9/26 21:45 회차가 Dropbox 락 파일 open 에서 1시간 44분 멈춰 그 회차가 통째로 안 나갔다.
 * 규칙: 예비는 6시간 안에 만든 것만(뉴스는 늦으면 가치가 없다) · 그 이슈가 이미 나갔으면 못 쓴다 · 쓴 예비는 지운다.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listSpares, pickSpare, promoteSpare, SPARE_FILES } from './shorts-spare.mjs';

let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const root = mkdtempSync(join(tmpdir(), 'spare-test-'));
const spares = join(root, 'spares');
const mk = (name, hoursAgo, keyword) => {
  const d = join(spares, name); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, SPARE_FILES.video), 'mp4');
  writeFileSync(join(d, SPARE_FILES.thumb), 'jpg');
  writeFileSync(join(d, SPARE_FILES.meta), JSON.stringify({ keyword, headlines: [keyword], createdAt: new Date(Date.now() - hoursAgo * 3600e3).toISOString() }));
  return d;
};
mk('a', 1, '호르무즈');
mk('b', 3, '지뢰사고');
mk('c', 8, '오래된것');
mkdirSync(join(spares, 'broken'), { recursive: true });   // 영상 없는 반쪽
// [1] 목록 — 영상·메타가 다 있는 것만
{
  const l = listSpares(spares);
  (l.length === 3 && l.every((x) => x.meta.keyword)) ? ok('[1] 반쪽(영상 없음)은 예비가 아니다') : bad(`[1] ${l.map((x) => x.dir).join(',')}`);
}
// [2] 고르기 — 6시간 안 · 아직 안 나간 이슈 · 가장 새것
{
  const p = pickSpare({ dir: spares, maxAgeH: 6, isPublished: (k) => k === '호르무즈' });
  (p?.meta.keyword === '지뢰사고') ? ok('[2] 이미 나간 이슈·6시간 넘은 것 빼고 → 지뢰사고') : bad(`[2] ${p?.meta.keyword}`);
  const none = pickSpare({ dir: spares, maxAgeH: 6, isPublished: () => true });
  none === null ? ok('[2b] 쓸 게 없으면 null') : bad('[2b]');
}
// [3] 올리기 — 정규 산출물 이름으로 옮기고 예비 폴더는 지운다
{
  const media = join(root, 'media'); mkdirSync(media);
  const p = pickSpare({ dir: spares, maxAgeH: 6, isPublished: () => false });
  const r = promoteSpare(p, media, 'ko');
  (r && existsSync(join(media, 'shorts-ko.mp4')) && existsSync(join(media, 'shorts-ko-meta.json')) && !existsSync(p.dir)
    && JSON.parse(readFileSync(join(media, 'shorts-ko-meta.json'), 'utf8')).keyword === p.meta.keyword)
    ? ok(`[3] 예비(${p.meta.keyword}) → shorts-ko.* 로 옮기고 예비 폴더 삭제`) : bad(`[3] ${JSON.stringify(r)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
