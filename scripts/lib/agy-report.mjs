import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

// 왜: 보고서에 저자를 적으려면 **실제로 넘긴 모델명**이 필요하다. 기본값을 두 군데 적어 두면
//   한쪽만 바뀌어 라벨이 조용히 틀어진다(2026-09-23 실측 고장이 정확히 그 모양이었다).
export function agyReportModel() {
  return process.env.AGY_TEXT_MODEL || 'gemini-3.1-pro-high';
}

// 왜: 환경변수 REPORT_VIA_AGY=1 일 때 agy를 통해 프롬프트를 처리하기 위함
export async function agyReport(prompt, { label, schema, timeoutMs, agyImpl } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-report-'));

  try {
    const promptPath = path.join(tmpDir, 'prompt.md');
    // 왜: 프롬프트가 매우 길어 argv로 넘기면 길이 제한에 걸릴 수 있으므로 파일로 저장
    // 왜: 터미널 명령을 방지하여 권한 거부로 작업이 취소되는 것을 막음
    const instruction = "어떤 터미널 명령도 실행하지 마라. RunCommand 를 쓰면 권한 거부로 작업이 통째로 취소된다. 파일은 read_file 로만 읽어라.\n\n" + prompt;
    await fs.writeFile(promptPath, instruction, 'utf8');

    const args = [
      '--sandbox', // 왜: dangerously-skip-permissions 금지, 샌드박스에서 안전하게 실행
      // ⚠ 이것이 없으면 agy 가 산문으로 답한다. JSON 봉투(structured_output/response)를 받으려면 필수다.
      '--output-format', 'json',
      '--model', agyReportModel(),
      '--add-dir', tmpDir
    ];

    if (schema) {
      const schemaPath = path.join(tmpDir, 'schema.json');
      await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf8');
      args.push('--json-schema', schemaPath);
      // 왜: 파일로 저장한 프롬프트를 지시사항으로 전달
      args.push('-p', '같은 폴더의 prompt.md 를 읽고 그 지시를 수행해라.');
    } else {
      // 왜: 스키마가 없으면 단일 JSON 객체 생성을 명시
      args.push('-p', '같은 폴더의 prompt.md 를 읽고 그 지시를 수행해라. 결과는 단 하나의 JSON 객체만 출력해라.');
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

    // fallback: 구조화된 출력이 모두 없는 경우
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
