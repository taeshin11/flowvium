#!/usr/bin/env node
// scripts/visual/audit-pages.mjs
// 렌더링 계층 전수 검증체계 (2026-06-16 사용자 "모든 페이지 전수조사 + 검증체계 + 왜 사각지대").
//   기존 검증은 데이터 계층(JSON/probe)만 봤고 *렌더 텍스트*(템플릿이 데이터를 조합한 실제 화면)는
//   사각지대였다 — 이중마이너스("매출 --4.9%")·"원 +46% YoY" 라벨오류·BOJ=FOMC 복사·콘탱고 변종은
//   렌더 텍스트에서만 보임. 이 도구가 모든 페이지의 innerText 를 자동 detector 로 전수검사.
//
// 사용: MEMBER_EMAIL=.. node scripts/visual/audit-pages.mjs [--pages=/ko/report,...] [--slices] [--base=..]
// 출력 1줄 "PAGE-AUDIT OK/ALERT ..." + logs/page-audit.json (페이지별 flag 상세). exit 0/1.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'https://flowvium.net').replace(/\/$/, '');
const EMAIL = process.env.MEMBER_EMAIL || '';
const WANT_SLICES = process.argv.includes('--slices');
const WANT_TABS = process.argv.includes('--tabs');
const DEFAULT_PAGES = ['/ko/report', '/ko/signals', '/ko/short', '/ko/heatmap', '/ko/screener', '/ko/explore',
  '/ko/cascade', '/ko/intelligence', '/ko/news-gap', '/ko/earnings', '/ko/volatility', '/ko/insider', '/ko/osint', '/ko'];
// URL 주소지정 탭(searchParams 'tab') — 클릭 없이 각 탭 직접 감사
const URL_TABS = { '/ko/intelligence': ['capital', 'macro', 'flows', 'fear-greed', 'credit', 'narratives', 'news', 'cot'] };
let PAGES = arg('pages', DEFAULT_PAGES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
if (WANT_TABS) { // URL 탭 페이지를 ?tab= 변형으로 확장
  PAGES = PAGES.flatMap((p) => URL_TABS[p] ? URL_TABS[p].map((t) => `${p}?tab=${t}`) : [p]);
}

// ── Detectors: (name, severity, regex|fn) — 렌더 innerText 대상. precise 하게(오탐 최소) ──────────
const DETECTORS = [
  // 부호 이중("매출 --4.9%", "++3.1%") — 음수 라벨 + 음수값 이중 prepend 버그
  { name: 'double_sign', sev: 'high', re: /[+\-–][\-–]\s?\d/g },
  // "원 +46.8% YoY" — 매출 라벨이 "원"으로(금액 누락) 렌더된 *고아* 원 (라벨/데이터 오류).
  //   2026-06-19: "356억원 +356.7% YoY"(금액 멀쩡, 원=통화접미사)를 오탐하던 버그 fix — 억/조/만/숫자 뒤
  //   원은 정상이므로 negative lookbehind 로 제외. 금액이 안 붙은 고아 "원 +X% YoY"만 high 로 검출.
  { name: 'won_label', sev: 'high', re: /(?<![\d억조만천백])원\s*[+\-]?\d+\.?\d*\s*%\s*YoY/g },
  // 콘탱고 한글 변종 (정상 표기 "콘탱고" 만 허용)
  { name: 'garbled_contango', sev: 'medium', re: /(컨티구오|컨티아고|컨텐고|컨텐코|콘텡고|콘텐고|콘탕고)/g },
  // 자금흐름을 %로 ("16.5% 유입") — flow 는 금액으로만 근거화됨
  { name: 'return_as_flow', sev: 'medium', re: /\d{1,2}\.?\d*\s*%\s*유입/g },
  // 한글 토큰 내 라틴 누출("스que이즈")
  { name: 'latin_bleed', sev: 'medium', re: /[가-힣][a-z]{2,6}[가-힣]/g },
  // 중국어/일본어 한자 누출 (국가약어 제외)
  // 2026-06-17 전수조사 detector-tuning: 단일 한자 11자 화이트리스트는 정상 한국어 금융문(半導體·證券·美中 등)을
  //   cjk_bleed 로 오탐. 진짜 신호는 *고립된 흔한 한자*가 아니라 *비허용 한자의 런(run)* — 즉 미번역 중/일 문장.
  //   ① 허용 한자를 흔한 금융/국가 한자로 확장(오탐 제거), ② 단일 한자 → 4자 이상 CJK 클러스터(공백 무관)로
  //   바꿔 비허용 한자가 >=4 누적된 경우만 매칭(런 휴리스틱). 정상 한국어의 산발적 한자는 통과, 미번역 문장은 검출.
  { name: 'cjk_bleed', sev: 'medium', re: /[㐀-䶿一-鿿]{1,}(?:\s*[㐀-䶿一-鿿]){3,}/g, minBad: 4,
    allow: new Set([...'美中日韓北南東西獨佛英露濠伊獨佛美中國本日韓朝臺香港上下高低大小新舊年月日時分秒兆億萬千百株債金利率銀行證券半導體市場經濟貿易輸出入油金利價格指數平均長短期前後內外總純粹發行收益損失資本産業企業財政通貨換率金融投資配當株式債券油價原油銅銀鐵銅鋼鐵綜合電子車自動車製造販賣物價賃金雇用失業政策財務報告']) },
  // 렌더 사고: NaN/undefined/null/[object Object]
  { name: 'nan_undef', sev: 'high', re: /\b(NaN|undefined)\b|\[object Object\]|\bnull\b(?!\s*=)/g },
  // 미치환 placeholder ([주력시장 핵심], [TARGET_LANG] 등)
  { name: 'placeholder_leak', sev: 'high', re: /\[(?:TARGET_LANG|주력시장[^\]]*|동인[^\]]*|입력[^\]]*|방향|리스크|두 힘)[^\]]*\]/g },
  // 반복 어절("단기적 단기", "상승 상승")
  { name: 'word_dup', sev: 'low', re: /(\b[가-힣]{2,4})\s+\1\b/g },
];

const slug = (p) => (p.replace(/^\//, '') || 'root').replace(/[^a-z0-9가-힣]/gi, '_');

async function runDetectors(text) {
  const flags = [];
  for (const d of DETECTORS) {
    const hits = [];
    for (const m of text.matchAll(d.re)) {
      const v = m[0];
      // 2026-06-17 전수조사 detector-tuning: allow 가 있으면 *비허용 문자 수*를 센다. d.minBad(기본 1) 미만이면 skip.
      //   cjk_bleed 는 minBad=4 → 흔한 한자가 산발(<4)이면 통과, 비허용 한자가 4자+ 누적된 미번역 런만 flag.
      if (d.allow) { const bad = [...v].filter((c) => !d.allow.has(c)).length; if (bad < (d.minBad ?? 1)) continue; }
      // 문맥 스니펫(앞뒤 24자)
      const i = m.index ?? text.indexOf(v);
      const snip = text.slice(Math.max(0, i - 24), i + v.length + 24).replace(/\s+/g, ' ').trim();
      if (!hits.some((h) => h.snip === snip)) hits.push({ v, snip });
      if (hits.length >= 6) break;
    }
    if (hits.length) flags.push({ detector: d.name, sev: d.sev, count: hits.length, samples: hits.slice(0, 4) });
  }
  // 중복 리스크이벤트(BOJ=FOMC 복사): "예상: X%" + "노출 종목: ..." 동일 조합 2회+
  const exposures = [...text.matchAll(/노출\s*종목[:：]\s*([^\n]{6,80})/g)].map((m) => m[1].trim());
  const dupExp = exposures.filter((e, i) => exposures.indexOf(e) !== i);
  // 2026-06-17 sev high→medium (사용자 "확실해?" 재검증): 동일 노출종목이 다른 카테고리 이벤트에 반복되는 건
  //   LLM laziness 인 *콘텐츠 품질* 이슈(거짓 아님) — NaN/이중부호 같은 렌더파손이 아님. medium 으로 검출·기록은
  //   유지하되(추세추적) 매 사이클 proactive ALERT(high) 은 끔. 진짜 완전복제(BOJ=FOMC)는 데이터probe 가 별도 검출.
  if (dupExp.length) flags.push({ detector: 'dup_riskevent_exposure', sev: 'medium', count: dupExp.length, samples: [{ snip: `중복 노출종목: ${[...new Set(dupExp)][0]}` }] });
  return flags;
}

// 클릭 기반 탭(OSINT/Insider 등 URL 비주소지정) — 탭바 버튼 그룹 발견 → 각 탭 클릭 후 감사.
async function auditClickTabs(page) {
  const tabFlags = [];
  let labels = [];
  try {
    labels = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('button, [role="tab"]')].filter((b) => {
        const t = (b.innerText || '').trim(); const r = b.getBoundingClientRect();
        return t && t.length <= 16 && r.width > 0 && r.height > 0 && r.top < window.innerHeight * 0.6 && !/^\$|\d{2,}|매수|매도/.test(t);
      });
      const byParent = new Map();
      for (const b of cands) { const p = b.parentElement; if (!p) continue; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push((b.innerText || '').trim()); }
      let best = []; for (const arr of byParent.values()) if (arr.length > best.length) best = arr;
      return best.length >= 3 ? [...new Set(best)] : [];
    });
  } catch { /* no tabs */ }
  for (const label of labels.slice(0, 8)) {
    try {
      const before = page.url();
      await page.getByText(label, { exact: true }).first().click({ timeout: 4000 });
      await page.waitForTimeout(700);
      if (page.url() !== before) { await page.goBack({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
      const text = (await page.evaluate(() => document.body?.innerText || '')).trim();
      for (const f of await runDetectors(text)) tabFlags.push({ tab: label, ...f });
    } catch { /* 클릭 실패 — skip */ }
  }
  return { labels, tabFlags };
}

const results = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'ko-KR' });
let authState = 'anon';
if (EMAIL) { try { const pr = await ctx.request.post(`${BASE}/api/member`, { data: { email: EMAIL }, timeout: 12000 }); authState = pr.ok() ? 'member' : `auth${pr.status()}`; } catch { authState = 'autherr'; } }

const shotRoot = `${ROOT}/logs/screenshots/page-audit-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
if (WANT_SLICES) mkdirSync(shotRoot, { recursive: true });

for (const path of PAGES) {
  const page = await ctx.newPage();
  const rec = { path, bodyLen: 0, flags: [], slices: 0, err: null };
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.evaluate(async () => { await new Promise((res) => { let y = 0; const t = setInterval(() => { window.scrollTo(0, y); y += 700; if (y >= document.body.scrollHeight) { clearInterval(t); window.scrollTo(0, 0); res(); } }, 90); }); });
    await page.waitForTimeout(900);
    const text = (await page.evaluate(() => document.body?.innerText || '')).trim();
    rec.bodyLen = text.length;
    rec.flags = await runDetectors(text);
    // 클릭 탭 순회 (URL 주소지정 안 되는 탭 — OSINT/Insider 등). ?tab= 변형은 이미 별도 항목.
    if (WANT_TABS && !path.includes('?tab=')) {
      const { labels, tabFlags } = await auditClickTabs(page);
      rec.tabs = labels;
      // 탭별 flag 를 detector 단위로 병합(탭명 표기)
      for (const tf of tabFlags) { const ex = rec.flags.find((f) => f.detector === tf.detector); if (ex) { ex.count += tf.count; (ex.tabs ??= []).push(tf.tab); } else rec.flags.push({ ...tf, tabs: [tf.tab] }); }
    }
    if (WANT_SLICES) {
      const total = await page.evaluate(() => document.body.scrollHeight);
      const n = Math.min(12, Math.ceil(total / 1100));
      const dir = `${shotRoot}/${slug(path)}`; mkdirSync(dir, { recursive: true });
      for (let i = 0; i < n; i++) { await page.evaluate((y) => window.scrollTo(0, y), i * 1100); await page.waitForTimeout(180); await page.screenshot({ path: `${dir}/slice_${String(i).padStart(2, '0')}.png` }); }
      rec.slices = n;
    }
  } catch (e) { rec.err = String(e?.message || e).slice(0, 80); }
  finally { results.push(rec); await page.close(); }
}
await browser.close();

const totalFlags = results.reduce((a, r) => a + r.flags.reduce((b, f) => b + (f.sev === 'low' ? 0 : 1), 0), 0);
const highFlags = results.reduce((a, r) => a + r.flags.filter((f) => f.sev === 'high').length, 0);
writeFileSync(`${ROOT}/logs/page-audit.json`, JSON.stringify({ ts: new Date().toISOString(), base: BASE, authState, totalFlags, highFlags, shotRoot: WANT_SLICES ? shotRoot : null, pages: results }, null, 2));

const summary = results.map((r) => `${r.path.replace('/ko', '') || '/'}${r.err ? '⚠nav' : ''}${r.flags.length ? `[${r.flags.map((f) => `${f.detector}×${f.count}`).join(',')}]` : '✓'}`).join(' ');
const line = (highFlags > 0)
  ? `PAGE-AUDIT ALERT: high ${highFlags} / 총 ${totalFlags} flag (auth=${authState}) — ${summary}`
  : `PAGE-AUDIT OK  ${totalFlags} flag (auth=${authState}) — ${summary}`;
console.log(line);
process.exitCode = highFlags > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 1500).unref();
