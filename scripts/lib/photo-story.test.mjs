#!/usr/bin/env node
/**
 * photo-story.test.mjs — 장면 사진 ↔ 장면 뉴스 대조(agy 그림 첨부). 2026-10-20 신설. 근거는 photo-story.mjs 머리말.
 * 평가(10/20, 이 모듈의 프롬프트 그대로, 6장씩 묶어 19번 호출 — 18번 답, 1번 300초 시간초과):
 *   남의 기사 사진 × 다른 헤드라인 54쌍: 판정 51 중 통과 9(18%) — 같은 조건 CLIP 관문은 106/162(65%) 통과.
 *     통과 9 중 2는 명패로 확인된 **같은 인물**(한병도·김민석)이라 실제로는 맞는 사진, 나머지 7은 전부 '마이크 앞 정치인' — 얼굴을 안 쓰니
 *     못 가르는 자리다(사람 바꿔치기는 출처 — 기사 자기 사진·구글 제목 겹침·얼굴 검사의 자막 주어 — 로 막는다).
 *   자기 기사 사진 × 자기 헤드라인 55(젤렌스키 포함): 판정 52 중 뺀 것 1 — 노동부 기사에 민주당 회의 사진(명패·당기) — 사진이 실제로 다른 대상.
 * 실제 게시 쇼츠 19편 68장면 감사(같은 기준, agy + 눈 확인): 오해를 부를 '다른 대상' 사진 0 · 사진 아닌 것 3(연합뉴스 로고·채권지표 표·은행 홍보 그림) ·
 *   느슨한 대체 사진 ~5. agy 는 재사용·느슨한 사진을 wrong 으로 더 세게 부른다 — 빼도 통과 사진으로 채우거나(한 사건) 장면을 뺀다(브리핑).
 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const P = await import('./photo-story.mjs');

// [1] 답 읽기 — 모르는 판정·남의 파일 이름은 버린다(= 모름). 통과로 바꾸지 않는다.
{
  const m = P.parseVerdicts('```json\n{"photos":[{"name":"photo1.jpg","verdict":"wrong","why":"다른 인물"},{"name":"photo2.jpg","verdict":"ok"},{"name":"x.jpg","verdict":"match"}]}\n```', ['photo1.jpg', 'photo2.jpg']);
  (m.get('photo1.jpg')?.verdict === 'wrong' && !m.has('photo2.jpg') && !m.has('x.jpg')) ? ok('[1] 판정·이름이 틀린 칸은 모름으로 둔다') : bad(`[1] ${JSON.stringify([...m])}`);
}
// [2] 프롬프트에 장면마다 파일·헤드라인이 다 들어간다
{
  const t = P.photoStoryPrompt([{ name: 'photo1.jpg', headline: 'A 뉴스', say: '가' }, { name: 'photo2.png', headline: 'B 뉴스' }]);
  (/photo1\.jpg: 헤드라인 「A 뉴스」/.test(t) && /photo2\.png: 헤드라인 「B 뉴스」/.test(t) && /not_photo/.test(t)) ? ok('[2] 장면마다 파일·헤드라인') : bad('[2] 프롬프트 누락');
  /얼굴로 누구인지 판단하지 마라/.test(t) ? ok('[2b] 얼굴로 사람을 가리지 않는다(보이는 증거만)') : bad('[2b] 얼굴 추측 금지 문구가 없다');
}
// [3] agy 가 실패하면 verdicts=null + 이유 — 조용히 통과시키지 않는다
{
  const dir = mkdtempSync(join(tmpdir(), 'ps-test-')); const img = join(dir, 'a.jpg'); writeFileSync(img, 'x');
  const r = await P.checkPhotoStory([{ image: img, headline: 'A' }], { run: async () => { throw new Error('timeout 300000ms'); }, bin: () => 'agy' });
  (r.verdicts === null && /agy 실패/.test(r.why)) ? ok('[3] agy 실패 → 모름 + 이유') : bad(`[3] ${JSON.stringify(r)}`);
  // [4] 그림을 안 열고 답하면(대화 기록 없음) 판정을 쓰지 않는다 — 사장님 10/15 "이미지를 첨부해 판정받을 것"
  const r2 = await P.checkPhotoStory([{ image: img, headline: 'A' }], { run: async () => ({ stdout: JSON.stringify({ conversation_id: 'no-such-conv', response: '{"photos":[{"name":"photo1.jpg","verdict":"match"}]}' }) }), bin: () => 'agy' });
  (r2.verdicts === null && /열었는지 확인 불가|안 열고/.test(r2.why)) ? ok('[4] 그림을 열었는지 모르면 판정을 버린다') : bad(`[4] ${JSON.stringify(r2)}`);
}
// [5] make-shorts 연결 — CLIP·얼굴 검사 뒤, 렌더 전에 남은 사진을 대조하고 wrong·not_photo 를 뺀다. 못 받으면 이유를 남긴다.
{
  const ms = readFileSync(new URL('../video/make-shorts.mjs', import.meta.url), 'utf8');
  (/checkPhotoStory\(/.test(ms) && /DROP\.has\(/.test(ms) && /사진·뉴스 대조 못 함/.test(ms))
    ? ok('[5] make-shorts 가 사진·뉴스 대조를 하고, 못 하면 이유를 남긴다') : bad('[5] make-shorts 미연결');
  const iClip = ms.indexOf('CLIP 검사 건너뜀'); const iPs = ms.indexOf('checkPhotoStory('); const iGate = ms.indexOf('const MIN_REAL = footageFloor');
  (iClip > 0 && iPs > iClip && iPs < iGate) ? ok('[5b] 순서: CLIP → 사진·뉴스 대조 → 실사진 하한') : bad(`[5b] 순서 ${iClip}/${iPs}/${iGate}`);
  (/process\.env\.SHORTS_PHOTO_STORY !== '0'/.test(ms) && /timeoutMs: 180_000/.test(ms)) ? ok('[5c] 기본 켬 · 상한 180초') : bad('[5c] 기본값·상한');
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
