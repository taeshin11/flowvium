#!/usr/bin/env node
/**
 * scripts/fetch-dart-corp-codes.mjs
 *
 * DART /api/corpCode.xml.zip 에서 전체 상장사 stockCode↔corpCode 매핑 추출.
 * dart-financials.ts 의 getDartCorpInfo 가 이 매핑을 사용 (DART company.json 은
 * corp_code 가 필수이며 stock_code 로는 조회 불가).
 *
 * 출력: data/dart-corp-codes.json
 * 실행: node scripts/fetch-dart-corp-codes.mjs   (월 1회)
 */
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DART_KEY = (() => {
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    const m = env.match(/^DART_API_KEY\s*=\s*['"]?([A-Za-z0-9]+)['"]?/m);
    return m?.[1] ?? process.env.DART_API_KEY;
  } catch { return process.env.DART_API_KEY; }
})();
if (!DART_KEY) {
  console.error('❌ DART_API_KEY 미설정 (.env.local 또는 환경변수)');
  process.exit(1);
}

const WORK = resolve(ROOT, '.dart-work');
if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const ZIP_PATH = resolve(WORK, 'corpCode.zip');
const XML_PATH = resolve(WORK, 'CORPCODE.xml');

console.log('▶ DART corpCode.xml fetch...');
const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`, {
  signal: AbortSignal.timeout(30000),
});
if (!res.ok) {
  console.error(`❌ HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(ZIP_PATH, buf);
console.log(`  ZIP 다운로드: ${(buf.length / 1024).toFixed(1)} KB`);

// Windows PowerShell Expand-Archive 로 unzip
console.log('▶ ZIP unzip via PowerShell...');
const unzip = spawnSync('powershell', [
  '-NoProfile', '-NonInteractive',
  '-Command', `Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${WORK}' -Force`
], { stdio: 'inherit' });
if (unzip.status !== 0) {
  console.error('❌ unzip 실패');
  process.exit(1);
}
if (!existsSync(XML_PATH)) {
  console.error(`❌ ${XML_PATH} 없음 — ZIP 구조 변경 의심`);
  process.exit(1);
}

const xml = readFileSync(XML_PATH, 'utf8');
console.log(`  XML 로드: ${(xml.length / 1024 / 1024).toFixed(1)} MB`);

// XML 구조: <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name>
//          <stock_code>005930</stock_code><modify_date>20240315</modify_date></list>
const listRe = /<list>([\s\S]*?)<\/list>/g;
const map = {};
let total = 0, listed = 0;
let m;
while ((m = listRe.exec(xml)) !== null) {
  total++;
  const body = m[1];
  const corpCode = body.match(/<corp_code>(\d+)<\/corp_code>/)?.[1];
  const corpName = body.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1]?.trim();
  const stockCode = body.match(/<stock_code>([^<\s]+)<\/stock_code>/)?.[1]?.trim();
  if (!corpCode || !stockCode || stockCode.length !== 6) continue;
  // 6자리 stock_code 만 = KOSPI/KOSDAQ/KONEX 상장사
  map[stockCode] = { corpCode, corpName: corpName ?? stockCode };
  listed++;
}

console.log(`  파싱: ${total} 전체 entry, ${listed} 상장사 (stock_code 6자리)`);

const out = {
  source: 'dart-opendart-corpCode',
  fetchedAt: new Date().toISOString(),
  totalListed: listed,
  // stockCode → { corpCode, corpName }
  map,
};
const outPath = resolve(ROOT, 'data/dart-corp-codes.json');
writeFileSync(outPath, JSON.stringify(out, null, 0), 'utf8'); // 압축 — 약 600KB → 250KB
console.log(`\n✅ ${listed} 종목 매핑 → ${outPath}`);
console.log(`  샘플: 005930=${map['005930']?.corpCode} (${map['005930']?.corpName})`);

// cleanup
rmSync(WORK, { recursive: true, force: true });
