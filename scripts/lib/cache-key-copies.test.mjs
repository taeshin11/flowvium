#!/usr/bin/env node
// cache-key-copies.test.mjs — Redis 캐시 키 사본 금지. 2026-10-16 사이트 눈검증: fedwatch·macro-indicators 라우트를 고쳐 키 버전을
//   올렸더니 홈 카드·브리프·알림·헬스가 각자 박아 둔 옛 키를 읽어 고치기 전 값('인상 84%'·'직전 224K')을 계속 냈다.
//   키는 lib 함수(fedwatchCacheKey·macroCacheKey) 한 곳에서만 만든다.
import { execFileSync } from 'child_process';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const root = new URL('../../', import.meta.url).pathname;
for (const [pat, home] of [['fedwatch:v[0-9]', /fedwatch-calc\.(ts|test\.mjs)$/], ['macro-indicators:v[0-9]', /macro-cache-key\.ts$/], ['credit-balance:v[0-9]', /credit-cache-key\.ts$/]]) {
  let out = '';
  try { out = execFileSync('grep', ['-rn', pat, 'src', 'scripts'], { cwd: root, encoding: 'utf8' }); } catch { /* 없음 */ }
  const copies = out.split('\n').filter(Boolean).filter((l) => !home.test(l.split(':')[0]) && !/\.bak|cache-key-copies\.test|^\S+:\d+:\s*\/\//.test(l));
  copies.length === 0 ? ok(`'${pat}' 키는 한 곳에서만`) : bad(`'${pat}' 사본: ${copies.map((l) => l.split(':').slice(0, 2).join(':')).join(', ')}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
