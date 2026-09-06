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
 * 사진끼리 너무 비슷한 것을 골라낸다.
 *
 * 2026-09-06 실측: 이재명 대통령 편에서 1·2·3·5번이 전부 같은 자리·같은 옷이었다.
 *   서로 다른 매체가 같은 행사를 찍은 것이라 URL 도 픽셀도 달라 md5 로는 못 잡는다.
 *   보는 사람에게는 31초 내내 정지 화면이다.
 *
 * 임계값은 재서 정했다 — 같은 장면 변형끼리 0.91~0.97, 서로 다른 사진끼리 0.36~0.69.
 *   0.85 면 둘이 깨끗이 갈린다.
 *
 * @param {string[]} images 사진 경로들(쓰는 순서대로)
 * @returns {number[]} 버려야 할 인덱스 — 앞에 이미 비슷한 게 있는 것들
 */
export function clipDuplicates(images, { threshold = Number(process.env.CLIP_DUP_THRESHOLD || 0.85), timeoutMs = 5 * 60_000 } = {}) {
  const r = clipReady();
  if (!r.ok || (images?.length ?? 0) < 2) return [];
  const dir = join(tmpdir(), 'flowvium-clip');
  mkdirSync(dir, { recursive: true });
  const pf = join(dir, `imgs-${process.pid}.json`);
  const of = join(dir, `sim-${process.pid}.json`);
  try {
    writeFileSync(pf, JSON.stringify(images.map((image) => ({ image }))), 'utf8');
    execFileSync(r.py, [r.script, '--pairs', pf, '--json-out', of, '--image-sim'],
      { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] });
    const sim = JSON.parse(readFileSync(of, 'utf8'));
    const drop = [];
    for (let i = 1; i < images.length; i++) {
      // 앞에서 **남긴 것**과만 견준다 — 이미 버린 것과 비슷하다고 또 버리면 안 된다.
      for (let j = 0; j < i; j++) {
        if (drop.includes(j)) continue;
        if ((sim?.[i]?.[j] ?? 0) >= threshold) { drop.push(i); break; }
      }
    }
    return drop;
  } catch {
    return [];   // 판정 못 하면 막지 않는다
  } finally {
    for (const f of [pf, of]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
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

/**
 * 각 사진이 **도표일 확률**. 0~1.
 *
 * 2026-09-07: 쇼츠는 첫 프레임이 썸네일이라 거기에 막대그래프가 오면 안 된다.
 *   주제와 섞어 재면 안 된다 — softmax 라 주제가 이기면 미끼가 전부 0 이 된다
 *   (실측: 그래프 사진이 "수출 1조달러" 주제에서 0.0047 로 나왔다).
 *   주제 없이 "현장 사진 vs 도표" 2지선다로 잰다 — 실측 96.9% vs 0.2% 로 확실히 갈린다.
 *
 * 판정 못 하면 전부 0 을 돌려준다 — 순서만 정하는 값이라 막지 않는다.
 */
export function clipCharts(images, { timeoutMs = 5 * 60_000 } = {}) {
  const r = clipReady();
  if (!r.ok || !images?.length) return images?.map(() => 0) ?? [];
  const dir = join(tmpdir(), 'flowvium-clip');
  mkdirSync(dir, { recursive: true });
  const pf = join(dir, `charts-${process.pid}.json`);
  const of = join(dir, `charts-out-${process.pid}.json`);
  try {
    writeFileSync(pf, JSON.stringify(images.map((image) => ({ image, topic: '뉴스' }))), 'utf8');
    execFileSync(r.py, [r.script, '--pairs', pf, '--json-out', of],
      { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] });
    const out = JSON.parse(readFileSync(of, 'utf8'));
    const by = new Map(out.map((v) => [v.index, v.chartDecoy ?? 0]));
    return images.map((_, i) => by.get(i) ?? 0);
  } catch {
    return images.map(() => 0);
  } finally {
    for (const f of [pf, of]) { try { unlinkSync(f); } catch { /* noop */ } }
  }
}
