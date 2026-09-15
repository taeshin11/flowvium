#!/usr/bin/env node
/**
 * repair-candidate-meta.mjs — candidate-tickers.json 의 이름·섹터를 실제 출처로 덮는다. (2026-09-15)
 *
 * 왜: 그 파일의 meta 는 **정규식 긁기**로 만들어진다(build-candidate-tickers.mjs) —
 *   티커 뒤 3000자에서 첫 name·sector 를 집는다. 그래서 내부 제품 배열이나 다음 회사 항목이 들어왔다.
 *     GOOG → "Meta Platforms" / semiconductors      MSFT → "Amazon AWS" / semiconductors
 *     AMZN → "Google Cloud" / semiconductors        JNJ  → "Innovative Medicine"(사업부문명)
 *   이름은 대조 가능한 872종 중 **700종(80%)** 이 어긋났다.
 *
 *   섹터는 분산·회전룰·튜너 섹터분석이 본다. META·GOOG·AMZN·MSFT 가 다 '반도체' 면
 *   포트폴리오는 분산됐다고 믿는데 실제로는 아니다.
 *
 * 출처를 바꾼다 — 긁은 값 대신:
 *   이름  data/company-names.json      (이미 있고 맞다 — GOOG·GOOGL 둘 다 "Alphabet Inc.")
 *   섹터  DB ticker_sectors            (야후 assetProfile · ingest-ticker-sectors.mjs 가 채운다)
 * 출처에 없으면 **그대로 둔다.** 모르는 값으로 덮으면 있는 것도 잃는다.
 *
 * 사용: node scripts/repair-candidate-meta.mjs [--dry]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ROOT } from './lib/project-root.mjs';
import { getTickerSectors } from './lib/db.mjs';

const DRY = process.argv.includes('--dry');
const P = resolve(ROOT, 'data/candidate-tickers.json');
const j = JSON.parse(readFileSync(P, 'utf8'));
const meta = j.meta ?? {};
const names = (() => { const n = JSON.parse(readFileSync(resolve(ROOT, 'data/company-names.json'), 'utf8')); return n.map ?? n; })();
const sectors = getTickerSectors();

let nameFixed = 0, sectorFixed = 0, untouched = 0;
const examples = [];
for (const [t, m] of Object.entries(meta)) {
  // 이름 출처 우선순위. **한국 종목은 건드리지 않는다** —
  //   메타의 한글 이름(kr-major-indexes 출처)이 맞고, 야후는 "Samsung Electronics Co., Ltd." 를 준다.
  //   한국어 채널에 영문 법인명을 쓰면 그게 더 나쁘다(2026-09-15 실측: 한글 431종 → 4종으로 날릴 뻔했다).
  //   미국 종목은 야후(price.longName)가 1순위다 — company-names.json 자체가 오염돼 있다
  //   ("MSFT" → "Microsoft Azure", "AMZN" → "Amazon AWS"). 같은 정규식 긁기로 만들어진 것으로 보인다.
  const isKR = /\.(KS|KQ)$/i.test(t);
  const wantName = isKR ? null : (sectors[t]?.name ?? names[t]);
  const wantSector = sectors[t]?.sector;
  const before = { name: m.name, sector: m.sector };
  if (wantName && m.name !== wantName) { m.name = wantName; nameFixed++; }
  if (wantSector && m.sector !== wantSector) { m.sector = wantSector; sectorFixed++; }
  if (before.name === m.name && before.sector === m.sector) untouched++;
  else if (examples.length < 10) examples.push([t, before, { name: m.name, sector: m.sector }]);
}

console.log(`종목 ${Object.keys(meta).length} · 이름 교체 ${nameFixed} · 섹터 교체 ${sectorFixed} · 그대로 ${untouched}\n`);
console.log('  티커     전(이름/섹터)                              후');
for (const [t, b, a] of examples) {
  console.log(`  ${t.padEnd(8)}${String(b.name).slice(0, 22).padEnd(24)}${String(b.sector).slice(0, 16).padEnd(18)}`
    + `→ ${String(a.name).slice(0, 20).padEnd(22)}${a.sector}`);
}
// 출처가 없어 손 못 댄 것도 세어 둔다 — 조용히 남겨 두지 않는다.
const noName = Object.keys(meta).filter((t) => !names[t]).length;
const noSector = Object.keys(meta).filter((t) => !sectors[t]?.sector).length;
console.log(`\n출처 없어 그대로 둔 것 — 이름 ${noName}종 · 섹터 ${noSector}종`);

if (DRY) { console.log('\n(--dry: 파일 미기록)'); process.exit(0); }
// 백업을 덮지 않는다 — 두 번 돌리면 "고치기 전" 이 사라진다(2026-09-15 실제로 그랬다).
const bak = `${P}.bak-meta-repair`;
if (!existsSync(bak)) copyFileSync(P, bak);
else console.log(`  (백업 유지: ${bak} — 첫 실행본이다)`);
j.meta = meta;
j.metaRepairedAt = new Date().toISOString();
writeFileSync(P, JSON.stringify(j, null, 2));
console.log(`\n✅ ${P} (원본은 .bak-meta-repair)`);
