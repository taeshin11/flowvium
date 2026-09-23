/**
 * report-backend.mjs — "보고서를 무엇이 쓰는가" 를 한 곳에서 답한다. (2026-09-23 신설)
 *
 * 왜:
 *   2026-09-23 에 보고서 생성을 agy 로 옮기고 로컬 27B(:8000, 28GB)를 내렸다.
 *   그런데 **되살리는 곳이 여럿**이었다:
 *     · run-report.sh 의 1-a 관문 (사전점검에서 plist 를 다시 올린다)
 *     · cron-runner 의 auto-monitor self-heal ("보고서 생성이 이 레인을 쓴다")
 *   앞의 것만 고치고 뒤를 놓쳤다. 둘 다 "보고서는 :8000 을 쓴다" 를 각자 전제하고 있었기 때문이다.
 *   같은 질문을 여러 곳이 각자 답하면 반드시 갈라진다 — 이 저장소가 오늘만 세 번 겪었다
 *   (rememberGood 의 local- 접두사 · fixKrFlowContradiction 의 claim 관문 · 이것).
 *
 * 어떻게 아는가:
 *   설정의 진짜 자리는 **launchd plist** 다(보고서 회차를 거기서 띄운다). 그걸 읽는다.
 *   추측하지 않는다 — plist 를 하나도 못 읽으면 `null`(모름)을 돌려주고,
 *   부르는 쪽이 종전 동작(로컬을 쓴다고 보는 쪽)으로 떨어진다. 모르면서 내리면 보고서를 잃는다.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const AGENTS_DIR = join(homedir(), 'Library/LaunchAgents');
const LABEL_RE = /^com\.spinai\.flowvium-report-[a-z]+\.plist$/;

/**
 * 보고서 회차가 agy 로 도는가.
 * @returns {true|false|null} null = 판단 못 함(plist 를 못 읽음)
 */
export function reportViaAgy({ dir = AGENTS_DIR, env = process.env } = {}) {
  // 명시적 지정이 있으면 그것이 우선 — 회차 프로세스 안에서 부를 때가 그렇다.
  if (env.REPORT_VIA_AGY === '1') return true;
  if (env.REPORT_VIA_AGY === '0') return false;
  let files;
  try { files = readdirSync(dir).filter((f) => LABEL_RE.test(f)); } catch { return null; }
  if (!files.length) return null;
  let on = 0;
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    let xml = '';
    try { xml = readFileSync(p, 'utf8'); } catch { return null; }
    // plist 는 <key>REPORT_VIA_AGY</key><string>1</string> 형태다. 파서를 들이지 않는다 —
    //   키와 바로 다음 값만 본다. 형태가 달라지면 매칭이 안 되고, 그때는 아래에서 '섞임' 으로 빠진다.
    if (/<key>\s*REPORT_VIA_AGY\s*<\/key>\s*<string>\s*1\s*<\/string>/.test(xml)) on++;
  }
  if (on === files.length) return true;
  if (on === 0) return false;
  return null;   // 섞여 있다 — 한쪽으로 단정하지 않는다
}
