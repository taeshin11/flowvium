#!/usr/bin/env node
/**
 * scripts/cron-runner.mjs — 자가호스팅 크론 러너 (Vercel cron 대체).
 *
 * 2026-06-02: Vercel fair-use 차단 → 자가호스팅 이전. vercel.json 의 crons 26개를
 *   node-cron 으로 로컬에서 동일 스케줄로 실행 (http://localhost:PORT/api/cron/* 호출).
 *   단일 프로세스. next start 와 함께 상시 구동.
 *
 * 사용: PORT=3000 node scripts/cron-runner.mjs
 *   (vercel.json 의 schedule 을 그대로 읽어 동기화 — cron 추가/변경 시 자동 반영)
 *
 * 스케줄 기준 시각: 로컬 머신 타임존 (Vercel 은 UTC 였음 — KST 머신이면 9시간 시프트됨).
 *   → CRON_TZ 환경변수로 'Etc/UTC' 지정 시 기존 Vercel UTC 스케줄 그대로 유지.
 */
import cron from 'node-cron';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

// 2026-06-04: .env.local 로드 — pm2(plain node)는 next 와 달리 .env.local 자동 로드 안 함.
//   CRON_SECRET 미로드 → Authorization 헤더 없이 호출 → web route(CRON_SECRET 보유)가 401 →
//   모든 authed cron(news-cascade 다국어 번역 warm 등) silent 실패(HTTP 401).
try {
  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* non-fatal */ }

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const TZ = process.env.CRON_TZ || 'Etc/UTC'; // Vercel cron 은 UTC 기준이었음 → 동일 유지
const SECRET = process.env.CRON_SECRET || ''; // 있으면 Authorization 헤더로 전달

const vercelJson = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
const crons = vercelJson.crons || [];

function log(...a) { console.log(`[cron-runner ${new Date().toISOString().slice(0, 19)}]`, ...a); }

async function runJob(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
      signal: AbortSignal.timeout(120000),
    });
    log(`${path} → HTTP ${res.status} (${Date.now() - t0}ms)`);
  } catch (e) {
    log(`${path} → ERROR ${String(e?.message || e)} (${Date.now() - t0}ms)`);
  }
}

let scheduled = 0;
for (const c of crons) {
  if (!c.path || !c.schedule) continue;
  if (!cron.validate(c.schedule)) { log(`⚠️ invalid schedule "${c.schedule}" for ${c.path} — skip`); continue; }
  cron.schedule(c.schedule, () => runJob(c.path), { timezone: TZ });
  scheduled++;
}
log(`스케줄 등록 ${scheduled}/${crons.length} (TZ=${TZ}, BASE=${BASE}). Ctrl+C 종료.`);

// 2026-06-05: 자동 모니터 (촘촘히) — 수동 의존 제거. */20분 check-stall + check-data-quality 실행,
//   execSync timeout 으로 hang 방지, 결과를 logs/monitor-status.json 에 기록(가시) + 결함 시 로그 강조.
function runMonitor() {
  const result = { ts: new Date().toISOString(), checks: {}, defects: [] };
  for (const [key, script] of [['stall', 'scripts/check-stall.mjs'], ['dataQuality', 'scripts/check-data-quality.mjs']]) {
    try {
      execSync(`node ${script}`, { stdio: 'pipe', timeout: 170000 });   // timeout = hang 방지
      result.checks[key] = 'OK';
    } catch (e) {
      const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      result.checks[key] = e.signal === 'SIGTERM' ? 'TIMEOUT(hang)' : 'DEFECT';
      for (const l of out.split('\n')) if (l.includes('🚨')) result.defects.push(l.replace(/.*🚨\s*/, '').trim());
    }
  }
  try { writeFileSync(resolve(process.cwd(), 'logs/monitor-status.json'), JSON.stringify(result, null, 2)); } catch { /* */ }
  log(`[auto-monitor] stall=${result.checks.stall} dq=${result.checks.dataQuality}${result.defects.length ? ' 🚨 ' + result.defects.slice(0, 4).join(' | ') : ' ✅'}`);

  // 2026-06-06 cold-cache self-heal: 자가호스팅이라 cloud 번역 warm-cron(401) 부재 → 뉴스 새로고침
  //   후 비-ko locale 이 cold 로 남아 모니터마다 [B] 결함 재발(수동 warm 반복). 감지 시 자동 warm
  //   fetch 로 self-heal. 단일 ollama GPU → 직렬 warm(순차 fetch). "최선의 방법을 자동화" 요청 반영.
  const coldLocales = [...new Set(result.defects
    .map(d => d.match(/뉴스 번역\s+([a-zA-Z-]+)\s+\d+\/\d+/)?.[1])
    .filter(Boolean))];
  if (coldLocales.length) {
    (async () => {
      for (const loc of coldLocales) {
        try {
          await fetch(`${BASE}/api/news-cascade?locale=${loc}`, { signal: AbortSignal.timeout(150000) });
          log(`[auto-warm] ${loc} 번역 warm 트리거 (cold-cache self-heal)`);
        } catch { log(`[auto-warm] ${loc} warm 실패`); }
      }
    })();
  }
}
cron.schedule('*/20 * * * *', runMonitor, { timezone: TZ });
log('자동 모니터 등록: */20분 (check-stall + check-data-quality, hang-protected, → logs/monitor-status.json)');

// keep alive
process.stdin.resume();
