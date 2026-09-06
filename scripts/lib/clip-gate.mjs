/**
 * clip-gate.mjs — 사진이 이 회차 이야기인지 **모델에게** 묻는다.
 *
 * 왜 (2026-09-06 사용자 "실패하면 웹이든 허깅페이스든 깃허브든 좀 물어보고 어떻게든 성공시켜"):
 *   이틀 동안 잘못된 사진을 여덟 번 눈으로 잡아 내렸다 — 검찰총장 개회사, 임시정부 청사,
 *   투호·지게, CU 편의점, YTN 로고, 혁명수비대 엠블럼. 매번 새로운 종류라
 *   규칙(제목 겹침·날짜·도표 패턴)을 더해도 다음 회차가 다른 방식으로 빠져나갔다.
 *   **사람이 보고 판단하던 것을 모델에게 시킨다.**
 *
 *   한국어 CLIP(Bingsu/clip-vit-large-patch14-ko)으로 사진과 문장의 거리를 잰다.
 *   판정은 **미끼와 견주어** — 절대 점수는 사진마다 들쭉날쭉하고, 장면 자막끼리 견주는 것도
 *   안 된다(한 회차 장면들은 대개 같은 사건이라 사진이 서로 바꿔 써도 맞는다. 실측으로 헛경보).
 *   실제로 내보냈다가 내린 것들을 미끼로 두고, 미끼가 주제를 이기면 버린다.
 *
 *   실측: YTN 로고+남산 야경 사진 → 주제 0.011 / 미끼 0.876 로 걸렸다.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { ROOT } from './project-root.mjs';

export function clipReady() {
  const py = process.env.CLIP_PYTHON
    || join(homedir(), '.flowvium-tools', 'qwen-tts-venv', 'bin', 'python');
  const script = resolve(ROOT, 'scripts/tts/clip_match.py');
  if (!existsSync(py)) return { ok: false, reason: `python 없음: ${py}` };
  if (!existsSync(script)) return { ok: false, reason: `스크립트 없음: ${script}` };
  return { ok: true, py, script };
}

/**
 * @param {Array<{image:string}>} items 검사할 사진들
 * @param {string} topic 이 회차 주제(헤드라인)
 * @returns {Array<{index:number, ok:boolean, topic:number, decoy:number, worstDecoy:string}>}
 *          실패하면 빈 배열 — **판정할 수 없으면 막지 않는다.** 관문이 못 돌아서 회차를 잃으면 안 된다.
 */
export function clipCheck(items, topic, { timeoutMs = 5 * 60_000 } = {}) {
  const r = clipReady();
  if (!r.ok || !items?.length) return [];
  const dir = join(tmpdir(), 'flowvium-clip');
  mkdirSync(dir, { recursive: true });
  const pf = join(dir, `pairs-${process.pid}.json`);
  const of = join(dir, `out-${process.pid}.json`);
  try {
    writeFileSync(pf, JSON.stringify(items.map((x) => ({ image: x.image, topic }))), 'utf8');
    execFileSync(r.py, [r.script, '--pairs', pf, '--json-out', of],
      { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] });
    return JSON.parse(readFileSync(of, 'utf8'));
  } catch {
    return [];   // 모델이 없거나 느려도 발행은 계속한다
  } finally {
    for (const f of [pf, of]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}
