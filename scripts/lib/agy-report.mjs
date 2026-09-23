import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

// 왜: 보고서에 저자를 적으려면 **실제로 넘긴 모델명**이 필요하다. 기본값을 두 군데 적어 두면
//   한쪽만 바뀌어 라벨이 조용히 틀어진다(2026-09-23 실측 고장이 정확히 그 모양이었다).
export function agyReportModel() {
  return process.env.AGY_TEXT_MODEL || 'gemini-3.1-pro-high';
}

/**
 * 모델 사슬 — 앞에서 실패하면 뒤로 간다. (2026-09-23, 사장님 "27B를 내릴수 있도록 claude opus 4.6 써")
 *
 * 왜 두 개인가: 27B 를 폴백으로 남겨 둔 이유는 agy 가 실제로 실패하기 때문이다
 *   (오늘 실측 — noon 2건 · afternoon 1건, 그중 macro 는 로컬에서 698.9초를 먹었다).
 *   agy 안에 **계열이 다른** 모델이 있으니 거기서 한 번 더 시도하면 로컬까지 내려갈 일이 거의 없다.
 *   같은 계열을 두 번 부르면 같은 이유로 같이 실패한다 — 그래서 gemini 다음은 claude 다.
 */
export const AGY_MODEL_CHAIN = (process.env.AGY_MODEL_CHAIN
  ? process.env.AGY_MODEL_CHAIN.split(',').map((x) => x.trim()).filter(Boolean)
  : [
    // 2026-09-23 (사장님 "3단 사슬 중 첫번째를 agy opus 4.6 thinking으로 하자"):
    //   1차를 claude-opus 로 올렸다. 실측 근거가 있다 — 같은 보고서 프롬프트에서
    //   claude 16~23초 / gemini 32~51초로 **claude 가 더 빠르고** 서술도 더 촘촘했다.
    //   claude 의 약점(내용 대신 작업 보고, 약 1/6)은 isMetaReply 가 걸러 다음 단으로 넘긴다.
    process.env.AGY_TEXT_MODEL || 'claude-opus-4-6-thinking',
    process.env.AGY_FALLBACK_MODEL || 'gemini-3.1-pro-high',
    // 3차: 27B 를 내렸으니 한 단이 더 필요하다. 계열이 또 달라 같은 이유로 같이 실패하지 않는다.
    process.env.AGY_LAST_MODEL || 'gpt-oss-120b-medium',
  ]);

/** 모델별 성공 횟수. 보고서 저자 라벨이 이 값으로 정해진다(오늘 아침 고친 그 칸). */
const USED = new Map();
export function agyModelUsage() { return new Map(USED); }
export function resetAgyModelUsage() { USED.clear(); }

/**
 * -p 인자에 **직접** 들어가는 금지. 프롬프트 파일 안에만 두면 안 된다 —
 *   실측 2026-09-23: claude-opus 는 그 파일을 읽으려고 RunCommand(cat)를 먼저 써서
 *   권한 거부로 7.4초 만에 턴이 통째로 취소됐다(response 0자, denied_actions=[RunCommand]).
 *   **금지를 읽기 전에 금지를 어긴 것**이다.
 */
const NO_SHELL_P = '⛔ 어떤 터미널 명령도 실행하지 마라. RunCommand 를 쓰면 권한 거부로 작업이 통째로 취소된다. 파일은 read_file 로만 열어라.\n';

/**
 * 출력 계약을 **글로** 박는다. `--json-schema` 만 믿으면 안 된다 —
 *   실측: gemini 는 지켰지만 claude-opus 는 산문으로 답하고 스키마와 다른 키를 썼다.
 */
const JSON_ONLY = [
  ' 설명·머리말 없이 **JSON 객체 하나만** 출력해라. 다른 텍스트를 덧붙이지 마라.',
  // 2026-09-23 실측: claude-opus 가 첫 필드에 작업 보고를 넣었다 —
  //   why="Task complete: read prompt.md, generated the requested JSON market report".
  //   그대로 두면 보고서 본문에 실린다. 무엇을 하지 말아야 하는지 못박는다.
  ' ⚠ 작업 보고를 쓰지 마라. 어떤 필드에도 "완료", "Task complete", "생성했습니다", 파일 이름 같은',
  ' **과정에 대한 말**을 넣지 마라. 모든 필드는 독자가 읽을 **결과물 자체**여야 한다.',
].join('');

const HANGUL = /[\uAC00-\uD7A3]/g;
/** 라틴 **산문** — 낱말 여러 개가 띄어쓰기로 이어진 덩어리. 티커('TSM')나 키('action')는 아니다. */
const LATIN_PROSE = /[A-Za-z][A-Za-z']*(?:[ ,][A-Za-z][A-Za-z']*){4,}/;

/**
 * 내용이 아니라 **과정**을 썼는가. (2026-09-23)
 *
 * 실측으로 두 모양을 봤다 — 둘 다 claude-opus 가 낸 것이고, 그대로 두면 보고서 본문에 실린다:
 *   why="Task complete: read prompt.md, generated the requested JSON market report"
 *   why="Provided the requested single-sentence market summary as a JSON object."
 * 둘째는 배선 이름이 없어서 첫 판정(파일명 노출)을 통과했다.
 *
 * 문구 목록으로 막지 않는다 — 다음엔 또 다른 말로 온다. 두 가지 **구조**를 본다:
 *   (1) 내가 넣은 배선 이름(prompt.md 등)이 결과물에 나타난다 — 시장 서술에 나올 수 없는 말이다.
 *   (2) **한국어로 물었는데 라틴 산문만 왔다** — 요청 언어와 답의 언어가 다르면 내용이 아니다.
 * 숫자·불리언·티커만 있는 결과(fact-check 의 {ok:true} 같은)는 산문이 아니므로 통과시킨다.
 * 판정 기준은 요청 언어다 — 영어로 물었으면 영어 답을 막지 않는다.
 */
export function isMetaReply(out, prompt = '') {
  const text = String(out ?? '');
  if (/prompt\.md|ask\.md|schema\.json/i.test(text)) return true;
  const askedKo = (String(prompt ?? '').match(HANGUL) ?? []).length >= 10;
  if (!askedKo) return false;
  const gotKo = (text.match(HANGUL) ?? []).length;
  return gotKo === 0 && LATIN_PROSE.test(text);
}

// 왜: 환경변수 REPORT_VIA_AGY=1 일 때 agy를 통해 프롬프트를 처리하기 위함
async function attemptOnce(prompt, { label, schema, timeoutMs, agyImpl, model } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-report-'));

  try {
    // 2026-09-23: 프롬프트를 **되도록 -p 로 직접** 준다.
    //   종전엔 무조건 prompt.md 에 쓰고 "그 파일을 읽고 수행해라" 라고 시켰는데, claude-opus 는
    //   그것을 **작업**으로 받아 첫 필드에 완료 보고를 썼다(실측:
    //   why="Task complete: read prompt.md, generated the requested JSON market report").
    //   같은 내용을 -p 로 직접 주니 정상적인 시장 서술이 나왔다 — 읽을 파일이 없으면 보고할 작업도 없다.
    //   ARG_MAX 는 1,048,576 이고 이 저장소의 최대 보고서 프롬프트는 12,588자다. 파일이 필요 없었다.
    //   그래도 상한은 둔다 — 언젠가 프롬프트가 커지면 argv 가 터지는데, 그건 조용히 실패한다.
    const INLINE_MAX = 200_000;
    const inline = String(prompt ?? '').length <= INLINE_MAX;
    const promptPath = path.join(tmpDir, 'prompt.md');
    if (!inline) {
      await fs.writeFile(promptPath, NO_SHELL_P + '\n' + prompt, 'utf8');
    }

    const args = [
      '--sandbox', // 왜: dangerously-skip-permissions 금지, 샌드박스에서 안전하게 실행
      // ⚠ 이것이 없으면 agy 가 산문으로 답한다. JSON 봉투(structured_output/response)를 받으려면 필수다.
      '--output-format', 'json',
      '--model', model,
      '--add-dir', tmpDir
    ];

    if (schema) {
      const schemaPath = path.join(tmpDir, 'schema.json');
      await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf8');
      args.push('--json-schema', schemaPath);
      // 왜: 파일로 저장한 프롬프트를 지시사항으로 전달
      args.push('-p', NO_SHELL_P + (inline ? prompt : '같은 폴더의 prompt.md 를 read_file 로 읽고 그 지시를 수행해라.') + JSON_ONLY);
    } else {
      // 왜: 스키마가 없으면 단일 JSON 객체 생성을 명시
      args.push('-p', NO_SHELL_P + (inline ? prompt : '같은 폴더의 prompt.md 를 read_file 로 읽고 그 지시를 수행해라.') + JSON_ONLY);
    }

    const ac = new AbortController();
    const timeoutId = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;

    let stdout = '', stderr = '';
    try {
      if (agyImpl) {
        // 왜: 테스트 시 실제 agy 프로세스를 실행하지 않고 주입된 함수로 대체
        const res = await agyImpl(args, { signal: ac.signal });
        stdout = res.stdout;
        stderr = res.stderr || '';
      } else {
        // ⚠ PATH 로 부르지 않는다. 크론·launchd 환경에는 ~/.local/bin 이 없어서 조용히 못 찾는다
        //   (scripts/lib/agy.mjs 머리말에 같은 함정이 적혀 있다). 절대경로를 쓴다.
        const { agyBin } = await import('./agy.mjs');
        const bin = agyBin();
        if (!bin) { console.error(`[agy:${label}] agy 실행파일을 못 찾았다`); return null; }
        const res = await execFileAsync(bin, args, {
          signal: ac.signal,
          maxBuffer: 20 * 1024 * 1024 // 20MB
        });
        stdout = res.stdout;
        stderr = res.stderr || '';
      }
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error(`[agy:${label}] 시간 초과 (${timeoutMs}ms)`);
      } else {
        console.error(`[agy:${label}] 실행 실패: ${err.message}`);
        if (err.stderr) console.error(`[agy:${label}] stderr: ${err.stderr}`);
      }
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    // 왜: stdout에 ANSI 코드나 불필요한 텍스트가 섞일 수 있으므로 첫 '{'부터 마지막 '}'까지만 추출
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      console.error(`[agy:${label}] 출력에서 JSON 중괄호를 찾을 수 없습니다.\nStderr: ${stderr}`);
      return null;
    }

    const jsonStr = stdout.slice(firstBrace, lastBrace + 1);
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      console.error(`[agy:${label}] JSON 파싱 실패: ${err.message}`);
      return null;
    }

    // 왜: 스키마 구조에 따라 structured_output 또는 response 필드로 반환됨
    if (parsed.structured_output !== undefined) {
      return typeof parsed.structured_output === 'string'
        ? parsed.structured_output
        : JSON.stringify(parsed.structured_output);
    }

    if (parsed.response !== undefined) {
      const resp = parsed.response;
      if (typeof resp === 'string') {
        // 왜: response 문자열이 마크다운 json 블록으로 감싸져 있을 수 있으므로 본체만 추출
        const mdMatch = resp.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (mdMatch) {
          return mdMatch[1].trim();
        }
        return resp.trim();
      }
      return JSON.stringify(resp);
    }

    // 2026-09-23: 여기가 **조용한 실패 경로**였다. structured_output 도 response 도 없으면
    //   아무 말 없이 null 을 돌려줬고, 부르는 쪽은 그냥 로컬로 떨어졌다.
    //   실제로 afternoon 회차의 macro 가 이 길로 빠져 27B 에서 698.9초를 먹었는데
    //   로그 어디에도 이유가 없어서 회차가 끝난 뒤에야 알았다. 왜 못 받았는지 남긴다.
    const dump = join(os.tmpdir(), `agy-report-fail-${label ?? 'x'}-${Date.now()}.json`);
    try { await fs.writeFile(dump, stdout ?? '', 'utf8'); } catch { /* 비치명 */ }
    console.error(`[agy:${label}] 봉투에 본문이 없다(키 ${Object.keys(parsed ?? {}).join(',') || '없음'}`
      + ` · status=${parsed?.status ?? '?'} · turns=${parsed?.num_turns ?? '?'}) — 원문 ${dump}`);
    return null;

  } finally {
    // 왜: 사용 후 임시 폴더 삭제
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // 무시
    }
  }
}

/**
 * 사슬을 돈다. 앞 모델이 못 내놓으면 다음 모델에 같은 것을 묻는다.
 * 성공한 모델을 센다 — 부르는 쪽이 저자 라벨을 만들 때 쓴다.
 */
export async function agyReport(prompt, opt = {}) {
  const chain = opt.model ? [opt.model] : AGY_MODEL_CHAIN;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const out = await attemptOnce(prompt, { ...opt, model });
    if (out && isMetaReply(out, prompt)) {
      // 내용 대신 과정을 썼다. 성공으로 세면 그 문장이 보고서 본문에 실린다.
      console.error(`[agy:${opt.label}] ${model} 이 내용 대신 작업 보고를 냈다 — 실패로 본다: ${String(out).slice(0, 80)}`);
    } else if (out) { USED.set(model, (USED.get(model) ?? 0) + 1); return out; }
    if (i < chain.length - 1) {
      console.error(`[agy:${opt.label}] ${model} 실패 → ${chain[i + 1]} 로 한 번 더`);
    }
  }
  return null;
}
