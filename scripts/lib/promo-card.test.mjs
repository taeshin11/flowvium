#!/usr/bin/env node
/**
 * promo-card.test.mjs — 쇼츠 끝 2초 광고를 aisviagent.com 과 flowvium.net 으로 번갈아. 2026-09-30 신설.
 *   사장님 "광고를 flowvium.net 도 2초카드 만들어서 aisviagent.com 광고와 번갈아가면서 하자".
 * 번갈아 넣는 단위: **네 편씩.** 이미 두 실험이 돈다 — 제목 방식(누적 편수 짝홀)·구독 권유(누적 % 4 < 2).
 *   편마다 바꾸면 제목 실험과 겹쳐(짝수 편 = 늘 같은 광고) 어느 쪽 효과인지 못 가른다.
 *   ⌊n/4⌋ 짝홀로 바꾸면 여덟 편마다 세 실험의 모든 조합이 한 번씩 나온다(2×2×2).
 * 파일이 없으면 다른 광고로 대신한다 — 광고 때문에 회차를 잃지 않는다.
 */
import { promoFor, promoPath, PROMO_FILES } from './promo-card.mjs';
import { subCtaFor } from './sub-cta.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
{
  const seq = Array.from({ length: 8 }, (_, n) => promoFor(n));
  const combos = new Set(Array.from({ length: 8 }, (_, n) => `${n % 2}|${subCtaFor(n) ? 1 : 0}|${promoFor(n)}`));
  (seq.filter((x) => x === 'aisvi').length === 4 && seq.filter((x) => x === 'flowvium').length === 4 && combos.size === 8)
    ? ok(`[1] 8편 중 4:4 · 제목×구독×광고 조합 8가지가 한 번씩 (${seq.join(',')})`) : bad(`[1] ${seq} combos=${combos.size}`);
}
{
  const root = mkdtempSync(join(tmpdir(), 'promo-test-'));
  mkdirSync(join(root, 'assets/outro'), { recursive: true });
  writeFileSync(join(root, PROMO_FILES.aisvi), 'x');
  const a = promoPath('flowvium', root), b = promoPath('aisvi', root);
  (a.name === 'aisvi' && a.fallback === true && b.name === 'aisvi' && !b.fallback) ? ok('[2] flowvium 카드가 없으면 aisvi 로 대신(대신했다고 표시)') : bad(`[2] ${JSON.stringify([a, b])}`);
  writeFileSync(join(root, PROMO_FILES.flowvium), 'x');
  const c = promoPath('flowvium', root);
  (c.name === 'flowvium' && c.path.endsWith('flowvium-card.mp4')) ? ok('[2b] 있으면 그대로') : bad(`[2b] ${JSON.stringify(c)}`);
  const d = promoPath('nope', mkdtempSync(join(tmpdir(), 'promo-empty-')));
  (d.path === null) ? ok('[2c] 둘 다 없으면 광고 없이') : bad(`[2c] ${JSON.stringify(d)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
