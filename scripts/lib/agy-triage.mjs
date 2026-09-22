/**
 * agy-triage.mjs — 경보 하나를 agy 에게 **진단시킨다**. (2026-09-20 신설)
 *
 * 왜 (사용자 "왠만한건 다 agy에 넘겨"):
 *   오늘 경보 두 건(/insider 0건 · korea-flow 빈 param)을 쫓아 보니, 비싼 일은
 *   명령을 치는 쪽이 아니라 **파일을 읽고 추론하는 쪽**이었다. 명령은 몇 줄이면 끝난다.
 *   그 추론을 넘긴다.
 *
 * 왜 agy 에게 셸을 주지 않는가:
 *   진단에는 curl·node 가 필요하고, 그러자면 command 권한을 열어야 한다. 그런데 이 저장소에는
 *   secrets/ 와 .env.local 이 있다. 셸 + 네트워크는 그대로 유출 경로다. 코딩 에이전트를
 *   의심해서가 아니라, 사장님 자산에 그 위험을 얹을 근거가 없어서다.
 *   그래서 **증거는 이쪽이 모으고, 판단만 넘긴다.** agy 는 읽기만 한다.
 *
 * 무엇을 돌려받나: 추측이 아니라 **확인 절차**다.
 *   원인 후보를 여러 개 받고, 각각을 가르는 명령을 받는다. 고르는 것은 사람이 한다 —
 *   오늘 배운 것: agy 는 명세가 옳은지 판단하지 못한다. 후보를 좁히는 데까지만 쓴다.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { agyBin, agyReady } from './agy.mjs';

/** 증거 묶음 하나. cmd 는 이쪽이 돌린다(agy 가 아니라). */
export function evidenceBundle(alert) {
  return [
    { name: '경보', text: String(alert ?? '').trim() },
    { name: '데이터품질', cmd: 'node scripts/check-data-quality.mjs' },
    { name: '정체점검', cmd: 'node scripts/check-stall.mjs' },
    { name: '크론로그', cmd: 'tail -40 /Users/spinai-mini/flowvium_runtime/cron.log' },
    { name: '최근커밋', cmd: 'git log --oneline -12' },
  ];
}

/** 증거를 모은다. 실패한 명령도 그대로 남긴다 — 실패 자체가 증거다. */
export function collect(bundle, { cwd, timeoutMs = 300_000 } = {}) {
  const out = [];
  for (const b of bundle) {
    if (b.text !== undefined) { out.push({ name: b.name, body: b.text }); continue; }
    const r = spawnSync('bash', ['-lc', b.cmd], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    out.push({ name: b.name, cmd: b.cmd, body: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 12000) });
  }
  return out;
}

/** agy 에게 줄 프롬프트. 고치라고 시키지 않는다 — 이 단계는 **좁히기**다. */
export function triagePrompt(alert) {
  return [
    '⛔ 먼저: **어떤 터미널 명령도 실행하지 마라.** RunCommand 도구를 쓰면 권한이 없어 거부되고',
    '   네 작업이 통째로 취소된다(실측 2026-09-23: denied_actions=[RunCommand], 결과 0자).',
    '   파일은 read_file 로만 읽어라. 아래에서 "명령" 을 적으라고 할 때도 **글자로 적기만 하고',
    '   절대 돌리지 마라** — 돌리는 것은 내가 한다.',
    '',
    '너는 이 저장소(FlowVium)의 운영을 돕는다. 지금 할 일은 **고치는 것이 아니라 좁히는 것**이다.',
    '',
    `## 경보\n${alert}`,
    '',
    '## 증거',
    '같은 폴더의 evidence.md 에 지금 막 돌린 명령들의 출력이 들어 있다. 그것을 읽어라.',
    '저장소 파일도 읽을 수 있다(read_file). **터미널 명령은 쓸 수 없다** — 필요하면 내가 대신 돌린다.',
    '',
    '## 돌려줄 것 (JSON)',
    '- `where`: 이 경보가 나오는 코드 위치(파일:줄). 증거나 파일에서 실제로 찾은 것만. 못 찾으면 빈 배열.',
    '- `hypotheses`: 원인 후보 2~4개. 각각 `{ cause, why, check }`',
    '    · `cause` 는 한 문장. `why` 는 증거의 어느 줄을 근거로 삼았는지.',
    '    · `check` 는 **그 후보를 참/거짓으로 가르는 명령 한 줄**. 글자로만 적어라 — 내가 돌린다.',
    '      두 후보의 check 가 같은 결과를 내면 쓸모없다 — 갈라지는 것을 써라.',
    '- `already_tried`: 이 저장소가 **이미 해 보고 버린 방법**이 있으면 적어라.',
    '    모듈 머리말 주석에 그런 기록이 자주 있다. 없으면 빈 배열.',
    '- `unknown`: 증거만으로는 알 수 없는 것. **모르는 것을 아는 것처럼 쓰지 마라.**',
    '',
    '추측을 사실처럼 쓰지 마라. 증거에 없는 것은 unknown 에 넣어라.',
  ].join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    where: { type: 'array', items: { type: 'string' } },
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cause: { type: 'string' }, why: { type: 'string' }, check: { type: 'string' } },
        required: ['cause', 'why', 'check'],
      },
    },
    already_tried: { type: 'array', items: { type: 'string' } },
    unknown: { type: 'array', items: { type: 'string' } },
  },
  required: ['hypotheses', 'unknown'],
};

/** ```json … ``` 으로 감싸 온 응답에서 본체만 꺼낸다. 아니면 null. */
function parseFenced(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
  try { const o = JSON.parse(String(m[1]).trim()); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** 증거를 파일로 주고 판단을 받는다. 실패하면 null — 부르는 쪽이 사람에게 넘긴다. */
export function triage(alert, evidence, { cwd, model, timeoutMs = 600_000 } = {}) {
  const bin = agyBin();
  if (!bin || !agyReady()) return { ok: false, why: 'agy 준비 안 됨' };
  const dir = mkdtempSync(join(tmpdir(), 'agy-tri-'));
  try {
    writeFileSync(join(dir, 'evidence.md'), evidence
      .map((e) => `## ${e.name}${e.cmd ? `\n\`${e.cmd}\`` : ''}\n\n\`\`\`\n${e.body}\n\`\`\``).join('\n\n'));
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(SCHEMA));
    const r = spawnSync(bin, ['-p', triagePrompt(alert),
      '--model', model || process.env.AGY_TEXT_MODEL || 'gemini-3.1-pro-high',
      '--effort', 'high', '--sandbox',
      '--add-dir', dir, '--add-dir', cwd,
      '--json-schema', join(dir, 'schema.json'), '--output-format', 'json'],
    { cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 || !r.stdout) return { ok: false, why: `종료코드 ${r.status}` };
    // stdout 전체가 JSON 이라고 믿지 않는다 — 작업 폴더를 여럿 붙이면 앞뒤에 다른 출력이 섞인다
    //   (2026-09-23 실측: status=SUCCESS 인데 통째로 parse 하다 실패했다).
    //   ANSI 를 걷어 낸 뒤 **첫 { 부터 마지막 } 까지**만 꺼낸다.
    const clean = r.stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, why: 'JSON 덩어리를 못 찾았다' };
    const j = JSON.parse(clean.slice(a, b + 1));
    // agy 는 스키마가 단순하면 structured_output 에, 복잡하면 response 에 **마크다운으로 감싼**
    //   JSON 을 넣는다(실측 2026-09-20). 둘 다 받는다 — 한쪽만 보면 조용히 실패한다.
    const s = j?.structured_output ?? parseFenced(j?.response);
    if (s) return { ok: true, result: s };
    // 왜 못 읽었는지 **말하게** 한다. "못 읽었다" 만 남기면 다음에 또 추측하게 된다.
    const dump = join(tmpdir(), `agy-triage-fail-${Date.now()}.json`);
    try { writeFileSync(dump, r.stdout ?? ''); } catch { /* 비치명 */ }
    return { ok: false, why: `판단을 못 읽었다(status=${j?.status ?? '?'} · turns=${j?.num_turns ?? '?'} · `
      + `키 ${Object.keys(j ?? {}).join(',')} · response ${String(j?.response ?? '').length}자) — 원문 ${dump}` };
  } catch (e) { return { ok: false, why: `예외 ${e?.message ?? e}` }; }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 비치명 */ } }
}
