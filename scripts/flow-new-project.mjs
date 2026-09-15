#!/usr/bin/env node
/**
 * flow-new-project.mjs — 우리 전용 Flow 프로젝트를 만들고 주소를 알려준다. (2026-09-15 신설)
 *
 * 왜 (실측): openProject 가 **목록의 첫 프로젝트**로 들어갔는데, 거기엔
 *   "Children waving at snowplow" · "Family having festive dinner" 같은 **우리가 만들지 않은**
 *   영상이 가득했다. 갤러리 썸네일이 새 결과로 오인돼 그대로 내려받혔고 ✅ 까지 찍혔다
 *   (사무실 사진을 시켰는데 눈사람 만화가 왔다).
 *
 *   남의 작업과 섞이지 않는 자리를 따로 둔다. 만들고 나면 주소를 .env.local 의
 *   FLOW_PROJECT_URL 에 넣으면 이후 모든 생성이 거기로만 간다.
 *
 * 사용: node scripts/flow-new-project.mjs [--name "FlowVium assets"]
 */
import { openFlow, FLOW_URL, dismissDialogs } from './lib/flow.mjs';

const argOf = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NAME = argOf('name', 'FlowVium assets');

const { ctx, page } = await openFlow();
try {
  await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await dismissDialogs(page);

  const before = page.url();
  // 목록 화면의 "새 프로젝트" 단추. 라벨이 로케일마다 달라 여러 표기를 시도한다.
  const labels = ['새 프로젝트', 'New project', 'add', '프로젝트 만들기', 'Create'];
  let clicked = false;
  for (const t of labels) {
    const b = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
    if (await b.count().catch(() => 0)) {
      await b.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(4000);
      if (/\/project\//.test(page.url()) && page.url() !== before) { clicked = true; console.log(`  "${t}" 로 만들어짐`); break; }
    }
  }
  if (!clicked) {
    console.error('❌ 새 프로젝트 단추를 못 찾았다 — 화면이 바뀌었을 수 있다.');
    console.error('   Flow 에서 직접 만드시고 주소만 알려 주시면 됩니다.');
    process.exit(1);
  }
  const url = page.url();
  console.log(`\n✅ 새 프로젝트: ${url}`);
  console.log('\n.env.local 에 이 줄을 넣으십시오 (그 뒤 모든 생성이 여기로만 갑니다):');
  console.log(`FLOW_PROJECT_URL=${url}`);
} finally { await ctx.close(); }
