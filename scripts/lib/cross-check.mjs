/**
 * cross-check.mjs — 같은 것을 두 모델에 따로 묻고 답을 맞댄다. (2026-09-23 신설)
 *
 * 왜 (사장님 "claude랑 gemini 둘이서 교차 검증 시키고 눈 검증 시키고"):
 *   agy 는 한 번 부르면 `--model` 로 고른 **한 모델만** 답한다. 스스로 교차검증하지 않는다.
 *   그래서 두 번 묻고 답을 맞대는 이 층이 필요하다.
 *
 * 실측으로 정한 것 (2026-09-23):
 *   · 이미지는 Claude 만 읽는다. Gemini 는 503(Eligibility UNAVAILABLE)을 두 번 다 냈다.
 *     그래서 **눈검증은 Claude 단독**이고, 교차검증은 글·숫자에만 건다.
 *   · 셸을 금지하지 않으면 모델이 파일 읽기 대신 명령을 쓰려다 권한 거부로 **턴이 통째로 취소**된다
 *     (agy-triage.mjs 머리말에 같은 기록이 있다). 프롬프트 첫 줄에 금지를 박는다.
 *   · 지연: 글 13초 안팎, 이미지 100~120초. 그래서 페이지마다 두 번 묻는 것은 비싸다 —
 *     부르는 쪽이 대상을 골라 넣는다. 이 모듈은 고르지 않는다.
 *
 * 맞대기 규칙 — 특히 마지막:
 *   pass          둘 다 조용
 *   confirmed     둘 다 같은 곳을 지적 → 실제 결함일 공산이 크다
 *   disagree      한쪽만 지적 → **버리지 않는다.** 둘 중 하나가 놓쳤거나 헛봤다
 *   inconclusive  한쪽이 답을 못 냄 → 통과가 아니라 **못 본 것**이다
 *
 *   마지막이 핵심이다. 호출은 실제로 실패한다(오늘만 503 한 번·300초 타임아웃 한 번).
 *   그걸 pass 로 세면 아무것도 안 보면서 초록불이 켜진다 — 이 저장소의
 *   'gate-that-can-never-fire' 가 정확히 그 모양이었다.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { agyBin, agyReady } from './agy.mjs';

/** 글·숫자 교차검증용 두 모델. 서로 다른 계열이어야 독립된 눈이 된다. */
export const TEXT_MODELS = Object.freeze(['gemini-3.1-pro-high', 'claude-opus-4-6-thinking']);
/** 눈검증용. Gemini 는 이미지를 못 받는다(실측 503). */
export const VISION_MODEL = 'claude-opus-4-6-thinking';

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          where: { type: 'string' },
          what: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
        required: ['where', 'what', 'severity'],
      },
    },
    unknown: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'findings'],
};

const SEV_RANK = { low: 0, medium: 1, high: 2 };

/** 모델마다 공백·대소문자가 다르다. 같은 곳을 같은 곳으로 보기 위한 열쇠. */
export function normalizeWhere(w) {
  return String(w ?? '').toLowerCase().replace(/\s+/g, '').replace(/[·、,]+$/, '').trim();
}

/** 프롬프트 첫 줄에 박는 금지. 이게 없으면 턴이 통째로 취소된다(실측). */
export const NO_SHELL = [
  '⛔ 어떤 터미널 명령도 실행하지 마라. RunCommand 를 쓰면 권한이 없어 거부되고',
  '   네 작업이 통째로 취소된다(실측 2026-09-23). 파일은 read_file 로만 열어라.',
  '',
].join('\n');

/**
 * 출력 계약을 **프롬프트 안에** 박는다.
 *
 * 왜 (2026-09-23 실측): `--json-schema` 를 줘도 claude-opus 는 안 지킨다. 산문으로 답하고
 *   제멋대로인 키를 쓴 JSON 을 곁들였다(스키마는 ok/findings 인데 `inconsistencies` 로 답했다).
 *   같은 호출에서 gemini 는 스키마를 지켰다. 한쪽만 보고 만들면 다른 쪽에서 조용히 깨진다.
 *   CLI 플래그를 믿지 말고 글로 못박는다 — agy-report.mjs 가 같은 결론에 도달해 있다.
 */
export const OUTPUT_CONTRACT = [
  '',
  '## 출력 계약 (반드시 지켜라)',
  '설명·머리말·맺음말을 쓰지 마라. **JSON 객체 하나만** 출력해라. 키는 정확히 이 셋이다:',
  '```json',
  '{"ok": true, "findings": [{"where":"", "what":"", "severity":"high|medium|low", "evidence":""}], "unknown": []}',
  '```',
  '- 다른 이름의 키(inconsistencies, issues, problems …)를 쓰지 마라. 읽는 쪽이 못 알아본다.',
  '- 어긋난 곳이 없으면 ok=true 와 findings=[] 로 답해라.',
  '- evidence 는 **원문에서 글자 그대로 옮긴 것**이어야 한다. 옮길 것이 없으면 비워라.',
  '  지어낸 근거는 기계가 대조해서 걸러낸다 — 지어내면 네 지적이 통째로 버려진다.',
].join('\n');

/**
 * 두 판정을 맞댄다. 순수 함수 — 여기에 네트워크가 없어야 규칙을 테스트할 수 있다.
 * @param {null|{ok:boolean,findings:Array}} a
 * @param {null|{ok:boolean,findings:Array}} b
 */
export function reconcile(a, b) {
  const bad = (v) => !v || !Array.isArray(v.findings);
  if (bad(a) || bad(b)) {
    return { status: 'inconclusive', agreed: [], onlyA: [], onlyB: [],
      why: `판정을 못 받았다(A ${a ? '있음' : '없음'} · B ${b ? '있음' : '없음'})` };
  }
  const idx = (list) => {
    const m = new Map();
    for (const f of list) m.set(normalizeWhere(f.where), f);
    return m;
  };
  const A = idx(a.findings); const B = idx(b.findings);
  const agreed = []; const onlyA = []; const onlyB = [];
  for (const [k, fa] of A) {
    const fb = B.get(k);
    if (!fb) { onlyA.push(fa); continue; }
    // 두 모델의 '왜' 를 모두 남긴다 — 사람이 읽을 때 한쪽만 있으면 판단이 안 선다.
    agreed.push({
      where: fa.where,
      what: `${fa.what} ⟂ ${fb.what}`,
      // 낮은 쪽을 따르면 더 잘 본 모델의 경고가 묻힌다. 높은 쪽을 따른다.
      severity: (SEV_RANK[fb.severity] ?? 1) > (SEV_RANK[fa.severity] ?? 1) ? fb.severity : fa.severity,
      evidence: [fa.evidence, fb.evidence].filter(Boolean).join(' / '),
    });
  }
  for (const [k, fb] of B) if (!A.has(k)) onlyB.push(fb);

  const status = agreed.length ? 'confirmed'
    : (onlyA.length || onlyB.length) ? 'disagree'
      : 'pass';
  return { status, agreed, onlyA, onlyB,
    why: status === 'pass' ? '두 모델 모두 조용' : `일치 ${agreed.length} · A만 ${onlyA.length} · B만 ${onlyB.length}` };
}

/** ANSI 를 걷고 첫 { ~ 마지막 } 만 꺼낸다. 작업 폴더를 붙이면 앞뒤에 다른 출력이 섞인다(실측). */
function extractJson(stdout) {
  const clean = String(stdout ?? '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const a = clean.indexOf('{'); const b = clean.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(clean.slice(a, b + 1)); } catch { return null; }
}

function unwrap(j) {
  if (!j) return null;
  if (j.structured_output && typeof j.structured_output === 'object') return j.structured_output;
  const r = j.response;
  if (typeof r === 'string') {
    const m = r.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { return JSON.parse((m ? m[1] : r).trim()); } catch { return null; }
  }
  if (r && typeof r === 'object') return r;
  return null;
}

/**
 * 한 모델에게 한 번 묻는다. 실패하면 **null 과 이유**를 돌려준다 — 조용히 통과시키지 않는다.
 * @param {{prompt:string, model:string, files?:string[], timeoutMs?:number}} o
 * @returns {{verdict:object|null, why:string|null, sec:number, model:string}}
 */
export function ask({ prompt, model, files = [], timeoutMs = 600_000 }) {
  const t0 = Date.now();
  const sec = () => (Date.now() - t0) / 1000;
  if (!agyReady()) return { verdict: null, why: 'agy 준비 안 됨', sec: sec(), model };
  const dir = mkdtempSync(join(tmpdir(), 'xcheck-'));
  try {
    for (const f of files) if (existsSync(f)) copyFileSync(f, join(dir, basename(f)));
    writeFileSync(join(dir, 'ask.md'), NO_SHELL + prompt + OUTPUT_CONTRACT);
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(VERDICT_SCHEMA));
    // 2026-09-23 실측 사고: 금지 문구를 ask.md **안에만** 넣었더니 claude-opus 가 그 파일을
    //   읽으려고 RunCommand(cat)를 먼저 썼다 → 권한 거부 → 7.4초 만에 턴이 통째로 취소되고
    //   response 0자(denied_actions=[RunCommand]). **금지를 읽기 전에 금지를 어긴 것**이다.
    //   금지는 반드시 -p 인자에 직접 있어야 한다 — 파일 안에 두면 닭과 달걀이 된다.
    const r = spawnSync(agyBin(), [
      '-p', NO_SHELL + '같은 폴더의 ask.md 를 read_file 로 읽고 그 지시를 수행해라.',
      '--model', model, '--sandbox', '--add-dir', dir,
      '--json-schema', join(dir, 'schema.json'), '--output-format', 'json',
    ], { cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 24 * 1024 * 1024 });
    if (r.error?.code === 'ETIMEDOUT') return { verdict: null, why: `시간초과 ${timeoutMs / 1000}초`, sec: sec(), model };
    if (r.status !== 0) return { verdict: null, why: `종료코드 ${r.status}: ${String(r.stderr ?? '').slice(0, 120)}`, sec: sec(), model };
    const v = unwrap(extractJson(r.stdout));
    if (!v || !Array.isArray(v.findings)) {
      // 왜 못 읽었는지 **남긴다.** "못 읽었다" 만 적으면 다음에 또 추측하게 된다
      //   (agy-triage.mjs 가 같은 이유로 덤프를 남긴다).
      const dump = join(tmpdir(), `xcheck-fail-${model}-${Date.now()}.json`);
      try { writeFileSync(dump, r.stdout ?? ''); } catch { /* 비치명 */ }
      const j = extractJson(r.stdout);
      return { verdict: null, sec: sec(), model,
        why: `판정을 못 읽었다(키 ${j ? Object.keys(j).join(',') : '없음'} · response ${String(j?.response ?? '').length}자) — 원문 ${dump}` };
    }
    return { verdict: v, why: null, sec: sec(), model };
  } catch (e) {
    return { verdict: null, why: `예외 ${String(e?.message ?? e).slice(0, 100)}`, sec: sec(), model };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 비치명 */ } }
}

/**
 * 근거 대조 — 모델이 댄 문구가 원문에 **실제로 있는지** 본다. (2026-09-23 신설)
 *
 * 왜: 첫 실전에서 claude-opus 가 `indexLevelsAbs.S&P500 키에 "&amp;" 가 섞였다` 고 지적했는데
 *   실제 키는 'S&P500' 이고 &amp; 는 없었다. 지어낸 것이다.
 *   맞대기만으로는 못 거른다 — 한쪽만 지적하면 disagree 로 사람에게 넘어가는데, 사람이 매번 볼 수 없다.
 *   그래서 **글자 그대로 있는지**를 기계가 먼저 본다.
 *
 * 버리지 않고 unverified 로 옮긴다: 원문을 슬라이스해 넘겼다면 근거가 잘려 나갔을 수도 있다.
 *   조용히 지우면 그 가능성을 못 본다.
 * 근거를 아예 안 단 지적은 **통과시킨다** — "이 필드가 비었다" 처럼 인용할 것이 없는 지적이 있다.
 *   없는 것을 못 찾았다고 버리면 진짜 결함을 놓친다.
 */
export function screenFindings(verdict, subjectText) {
  if (!verdict || !Array.isArray(verdict.findings)) return { findings: [], unverified: [] };
  const norm = (t) => String(t ?? '').replace(/["'`\u201c\u201d\u2018\u2019]/g, '').replace(/\s+/g, '').toLowerCase();
  const hay = norm(subjectText);
  const keep = []; const unverified = [];
  for (const f of verdict.findings) {
    const ev = String(f.evidence ?? '').trim();
    if (!ev) { keep.push(f); continue; }
    (hay.includes(norm(ev)) ? keep : unverified).push(f);
  }
  return { findings: keep, unverified };
}

/** 두 모델에 묻고 맞댄다. 두 호출은 순차다 — 같은 CLI 를 동시에 두 번 띄우지 않는다. */
export function crossCheck({ prompt, subjectText = '', files = [], models = TEXT_MODELS, timeoutMs = 600_000 }) {
  const runs = models.map((m) => ask({ prompt, model: m, files, timeoutMs }));
  // 맞대기 **전에** 근거를 대조한다. 지어낸 지적이 두 모델에서 우연히 겹치면
  //   confirmed 로 올라가 가장 먼저 사람 눈에 들어온다 — 그게 제일 나쁜 순서다.
  const screened = runs.map((r) => (r.verdict && subjectText
    ? { ...r, verdict: { ...r.verdict, ...screenFindings(r.verdict, subjectText) } }
    : r));
  const out = reconcile(screened[0].verdict, screened[1].verdict);
  const unverified = screened.flatMap((r) => (r.verdict?.unverified ?? []).map((f) => ({ ...f, model: r.model })));
  return { ...out, unverified, runs: screened };
}
