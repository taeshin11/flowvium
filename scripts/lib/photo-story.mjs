/**
 * photo-story.mjs — 장면 사진이 **그 장면의 뉴스**를 보여 주는가를 agy(그림 첨부)로 본다. 2026-10-20 신설.
 *
 * 왜(Mac mini2 10/20, 사장님 쪽 우선순위 "뉴스 쇼츠에 틀린 사진은 시청 유지보다 신뢰를 더 깎는다"):
 *   CLIP 관문은 미끼 softmax + 유사도 하한이다. 남의 기사 사진을 붙인 162쌍 중 106쌍이 통과했다(lib/clip-floor.test 머리말) —
 *   CLIP 은 "정치인이 연단에 선 사진" 과 "다른 정치인이 연단에 선 사진" 을 못 가른다.
 *   얼굴 검사(lib/face-check)는 기사 사진의 자막 주어만 본다. 도표·표·로고(og:image 기본값)도 지나간다
 *   (10/20 3eus-sStXNE 4번 장면 15초가 연합뉴스 로고, gjonwJqtHk0 3번 장면이 채권지표 표).
 * 그래서 렌더 전에 남은 사진 전부를 한 번에 agy 에 보여 주고, 장면 헤드라인·대사와 견준다.
 *   wrong(다른 사람·사건·회사) · not_photo(로고·표·문서·글자판) 는 뺀다. match · generic 은 둔다.
 * 얼굴로 사람을 가리지 않는다 — 10/20 감사에서 agy 가 기사 자기 사진(etYbsbGD1C8, 그 뉴스 한경 기사 og:image)을 얼굴 추측으로 wrong 이라 했다.
 *   사람 바꿔치기는 출처(기사 자기 사진 / 구글 제목 겹침 / 얼굴 검사의 자막 주어)로 막고, 여기서는 **보이는 증거**만 쓴다.
 * 판정을 못 받으면(agy 실패·그림을 안 열고 답함) **null 과 이유** — 통과도 차단도 아니다. 부르는 쪽이 그 이유를 로그에 남긴다.
 */
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, extname } from 'path';
import { runAgy, NO_SHELL_P } from './agy-run.mjs';
import { agyBin } from './agy.mjs';
import { viewedImages } from './agy-viewed.mjs';

export const PHOTO_STORY_MODEL = 'gemini-4-argon-medium';   // 사장님 10/15 "agy 검증에는 gemini4 argon medium"
export const DROP = new Set(['wrong', 'not_photo']);

/** @param {{name:string, headline:string, say?:string}[]} items */
export function photoStoryPrompt(items) {
  const rows = items.map((x) => `- ${x.name}: 헤드라인 「${x.headline}」${x.say ? ` / 대사 「${String(x.say).slice(0, 160)}」` : ''}`).join('\n');
  return `너는 뉴스 쇼츠의 사진 검수자다. 아래 그림 파일마다, 그 장면의 헤드라인·대사와 사진이 맞는지 판정한다.
그림 파일을 하나도 빼지 말고 read_file 로 열어서 본 뒤 판정한다.

${rows}

판정(하나만):
- "match": 그 뉴스의 대상(이름이 나온 사람·기관·장소·사건·제품, 또는 그 사건의 현장)을 보여 준다.
- "generic": 그 대상 자체는 아니지만 주제에 맞고 오해를 부르지 않는 그림(정치 뉴스에 국회 건물, 증시 뉴스에 시세판).
- "wrong": **사진에 보이는 증거**가 다른 대상·사건·주제를 가리킨다 — 시청자가 그 뉴스의 사진이라고 오해한다.
  증거는 사진 속 글자(현수막·이름표·로고·간판), 국기, 장소, 사건의 종류(화재 기사에 축구 경기 등)다.
- "not_photo": 사진이 아니라 로고·표·문서·글자판·슬라이드다.
⚠ **얼굴로 누구인지 판단하지 마라.** 얼굴만 보고 "다른 사람" 이라고 하면 안 된다(실측: 기사 자기 사진을 얼굴 추측으로 wrong 이라 했다).
  사람만 있고 글자·장소 증거가 없으면, 장면과 어울리면 match, 판단이 안 서면 generic 이다.

JSON 만 답한다: {"photos":[{"name":"<파일 이름>","verdict":"match|generic|wrong|not_photo","why":"<짧은 이유>"}]}`;
}

/** 답에서 파일별 판정. 모르는 판정·빠진 파일은 넣지 않는다(= 모름). */
export function parseVerdicts(text, names) {
  const s = String(text ?? '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return new Map();
  let obj; try { obj = JSON.parse(s.slice(i, j + 1)); } catch { return new Map(); }
  const ok = new Set(['match', 'generic', 'wrong', 'not_photo']);
  const out = new Map();
  for (const p of obj?.photos ?? []) if (names.includes(p?.name) && ok.has(p?.verdict)) out.set(p.name, { verdict: p.verdict, why: String(p.why ?? '').slice(0, 120) });
  return out;
}

/**
 * @param {{image:string, headline:string, say?:string}[]} items
 * @returns {Promise<{verdicts: ({verdict:string, why:string}|null)[] | null, why: string|null}>}  verdicts 는 items 순서. 판정 못 받은 칸은 null.
 */
export async function checkPhotoStory(items, { model = PHOTO_STORY_MODEL, timeoutMs = 300_000, run = runAgy, bin = agyBin } = {}) {
  const usable = items.map((x, k) => ({ ...x, k })).filter((x) => x.image && existsSync(x.image));
  if (!usable.length) return { verdicts: items.map(() => null), why: '볼 사진 없음' };
  const dir = mkdtempSync(join(tmpdir(), 'photo-story-'));
  try {
    const named = usable.map((x, n) => ({ ...x, name: `photo${n + 1}${extname(x.image).toLowerCase() || '.jpg'}` }));
    for (const x of named) copyFileSync(x.image, join(dir, x.name));
    writeFileSync(join(dir, 'ask.md'), photoStoryPrompt(named));
    const names = named.map((x) => x.name);
    const p = `${NO_SHELL_P}같은 폴더의 ask.md 를 read_file 로 읽고, 그림 파일(${names.join(', ')})을 전부 read_file 로 연 뒤 ask.md 대로 답해라.`;
    let r;
    try { r = await run(bin(), ['-p', p, '--model', model, '--sandbox', '--add-dir', dir, '--output-format', 'json'], { cwd: dir, timeoutMs }); }
    catch (e) { return { verdicts: null, why: `agy 실패: ${String(e?.message ?? e).slice(0, 80)}` }; }
    let env; try { env = JSON.parse(String(r.stdout).slice(String(r.stdout).indexOf('{'))); } catch { return { verdicts: null, why: 'agy 답을 못 읽었다' }; }
    const seen = viewedImages(env.conversation_id, names);
    if (!seen) return { verdicts: null, why: '그림을 열었는지 확인 불가(대화 기록 없음)' };
    if (seen.missing.length) return { verdicts: null, why: `그림을 안 열고 답함(${seen.missing.join(', ')})` };
    const got = parseVerdicts(env.response ?? env.result ?? '', names);
    const verdicts = items.map(() => null);
    for (const x of named) verdicts[x.k] = got.get(x.name) ?? null;
    return { verdicts, why: got.size < names.length ? `판정 빠짐 ${names.length - got.size}장` : null };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 비치명 */ } }
}
