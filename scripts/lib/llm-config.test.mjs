#!/usr/bin/env node
/**
 * llm-config.test.mjs — LLM 접속 정보(URL·모델)의 단일 소스.
 *
 * 배경(2026-08-20 실측): cron 의 segments-refresh 가 15회 실행에 성공 0 / 실패 90 (0.0%)이었다.
 *   20분마다 GPU 를 달구면서 아무것도 못 만들고 있었다. 원인을 따라가 보니:
 *     build-segments-dynamic.mjs:178  model: process.env.OLLAMA_TRANSLATE_MODEL || 'flowvium-local'
 *     · 이 스크립트는 .env.local 을 읽지 않는다(그 로딩은 generate-report-local.mjs 안에만 있다)
 *     · cron-runner 의 launchd 환경에도 그 변수가 없다
 *     → 옛 Ollama 별칭 'flowvium-local' 로 폴백 → mlx 가 HTTP 404 로 거부
 *     → `if (!r.ok) return []` 이 조용히 삼킴 → 'exaone-no-rows' 로 보고
 *   실측 확인: default_model → 200 · flowvium-local → 404.
 *   Qwen 이관 때 남은 구멍이고, 폴백 기본값이 '서버가 거부하는 값'이라 영원히 실패한다.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// 2026-08-22: 이 테스트가 무엇을 필요로 하는지 스스로 선언한다. 없으면 스킵(코드 77).
//   CI(깨끗한 clone)엔 .env.local·라이브 LLM·데이터가 든 DB 가 없다 — 그걸 '실패' 로 세면
//   CI 가 상시 빨갛고, 상시 빨간 CI 는 아무도 안 본다. --strict 에서는 스킵도 실패로 센다.
import { requires } from './test-env.mjs';
await requires({ envFile: true });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };

let C;
try { C = await import('./llm-config.mjs'); }
catch (e) { console.log(`  FAIL  모듈 없음: ${e.message}`); process.exit(1); }

// [1] .env.local 을 읽어 process.env 에 주입 (기존 env 는 보존)
const env = C.loadEnvLocal();
env.VLLM_MODEL ? ok(`.env.local 로드 (VLLM_MODEL=${env.VLLM_MODEL})`) : bad('.env.local 로드 실패');
process.env.VLLM_MODEL === env.VLLM_MODEL ? ok('process.env 주입') : bad('process.env 미주입');

// [2] 레인별 해석
const rep = C.resolveLlm('report');
rep.url.includes('8000') && rep.model ? ok(`report 레인: ${rep.url} · ${rep.model}`) : bad(`report 레인 이상: ${JSON.stringify(rep)}`);
const web = C.resolveLlm('web');
web.url.includes('8001') && web.model ? ok(`web 레인: ${web.url} · ${web.model}`) : bad(`web 레인 이상: ${JSON.stringify(web)}`);

// [3] 서버가 거부하는 옛 별칭을 기본값으로 쓰면 안 된다 — 그게 이번 사고의 원인이다
for (const stale of ['flowvium-local', 'qwen3:8b', 'exaone']) {
  rep.model !== stale && web.model !== stale ? ok(`옛 별칭 미사용: ${stale}`) : bad(`옛 별칭을 반환: ${stale}`);
}

// [4] 실행 경로의 스크립트들이 옛 별칭을 폴백으로 들고 있으면 드러나야 한다
const stalePat = /['"`](flowvium-local|qwen3:8b)['"`]/;
const offenders = [];
for (const f of readdirSync(resolve(ROOT, 'scripts')).filter(x => x.endsWith('.mjs'))) {
  const p = resolve(ROOT, 'scripts', f);
  let src = ''; try { src = readFileSync(p, 'utf8'); } catch { continue; }
  // 주석 줄은 제외 — 사고 경위 기록은 남겨야 한다
  const live = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  if (stalePat.test(live)) offenders.push(f);
}
offenders.length === 0
  ? ok('실행 경로에 옛 모델 별칭 폴백 없음')
  : bad(`옛 별칭 폴백 잔존 ${offenders.length}개: ${offenders.join(', ')}`);

// ── [5] 레인 ↔ launchd 라벨 (2026-08-31: 잘못된 서비스를 재기동하던 경로) ─────────
//   실측 사고: `node scripts/llm-health-check.mjs --lane=web` 이 :8001 이 아니라 :8000 을
//   검사했다. 그 CLI 의 arg 파서가 `--lane web`(공백) 만 받고 `--lane=web`(이 저장소의
//   나머지 스크립트가 전부 쓰는 형식 — --locales=ko, --limit=12, --refresh=8)은 조용히
//   무시하고 기본값 report 로 떨어졌기 때문이다.
//
//   더 위험한 쪽은 --repair 다. 라벨 기본값이 레인과 무관하게 'com.spinai.flowvium-llm'
//   이라, `--lane web --repair` 는 :8001 이 죽은 걸 보고 **:8000(27B)을 재기동** 한다.
//   보고서 모델을 죽여서 웹 모델을 고치는 셈이다 — llm-memory.mjs 가 막으려던 바로 그
//   "복구가 두 번째 사고를 내는" 형태다. 라벨은 레인에서 파생돼야 한다.
{
  const rl = C.resolveLaunchdLabel;
  typeof rl === 'function' ? ok('resolveLaunchdLabel 제공') : bad('레인→라벨 매핑이 없다 — 호출부가 라벨을 직접 고른다');
  if (typeof rl === 'function') {
    const lr = rl('report'), lw = rl('web');
    lr !== lw ? ok(`레인마다 다른 라벨 (report=${lr} · web=${lw})`) : bad(`두 레인이 같은 라벨 ${lr} — 재기동이 엉뚱한 서비스를 죽인다`);
    // 라벨은 실제로 등록된 plist 와 일치해야 한다. 없는 라벨을 kickstart 하면 조용히 실패한다.
    for (const [lane, lbl] of [['report', lr], ['web', lw]]) {
      const plist = `${process.env.HOME}/Library/LaunchAgents/${lbl}.plist`;
      if (!existsSync(`${process.env.HOME}/Library/LaunchAgents`)) { console.log(`  – LaunchAgents 없음 — 이 기계 전용 검사 건너뜀 (${lane})`); continue; }
      existsSync(plist) ? ok(`${lane} 라벨이 실제 plist 와 일치: ${lbl}`) : bad(`${lane} 라벨 ${lbl} 에 해당하는 plist 가 없다`);
    }
    // 그리고 그 plist 가 가리키는 포트가 레인 URL 과 같아야 한다 — 여기까지 봐야 "짝" 이다.
    for (const lane of ['report', 'web']) {
      const port = (C.resolveLlm(lane).url.match(/:(\d+)/) ?? [])[1];
      let args = ''; try { args = readFileSync(`${process.env.HOME}/Library/LaunchAgents/${rl(lane)}.plist`, 'utf8'); } catch { continue; }
      args.includes(`<string>${port}</string>`) || args.includes(`:${port}`)
        ? ok(`${lane} 라벨의 plist 가 포트 ${port} 를 띄운다`)
        : bad(`${lane} 라벨(${rl(lane)}) 의 plist 에 포트 ${port} 가 없다 — 레인과 서비스가 어긋났다`);
    }
  }
}

console.log(fail ? `\n결과: 실패 ${fail}건` : '\n결과: 전부 통과');
process.exit(fail ? 1 : 0);
