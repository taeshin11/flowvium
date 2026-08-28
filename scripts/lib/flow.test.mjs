#!/usr/bin/env node
/**
 * flow.test.mjs — Flow 조작 결과를 **왜 실패했는지** 구분해서 돌려주는가.
 *
 * 배경(2026-08-28): 앵커 클립 생성이 두 번 실패했는데 화면에 뜬 메시지는
 *   "0 크레딧 모델이 반영되지 않았다" 였다. 그런데 실제 원인은 **설정 패널이 열리지 않은 것**이다.
 *   setVideoModel 이 실패를 전부 빈 문자열('')로 뭉개서 호출부가 구분할 수 없었다.
 *
 * 이건 이번 세션에서 반복된 것과 같은 실수의 변종이다 —
 *   "했다 ≠ 됐다" 를 고쳐놓고, **"왜 안 됐는지" 를 잃어버리는** 코드를 그대로 뒀다.
 *   원인이 여러 개일 때 하나의 값으로 뭉개면 진단이 감으로 떨어진다.
 *
 * 이 테스트는 브라우저 없이 **반환 형태**만 검증한다(실제 조작은 통합 실행에서 본다).
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./flow.mjs');

// ── 1. 실패 사유가 구분되는가 ────────────────────────────────────────────────
{
  const kinds = M.MODEL_RESULT;
  if (kinds && kinds.OK && kinds.PANEL_CLOSED && kinds.OPTION_MISSING && kinds.NOT_APPLIED)
    ok(`실패 사유 구분: ${Object.values(kinds).join(' / ')}`);
  else bad(`사유 상수 없음: ${JSON.stringify(kinds)}`);
}

// ── 2. 결과 객체 형태 ────────────────────────────────────────────────────────
{
  const r = M.modelResult(M.MODEL_RESULT.PANEL_CLOSED, '');
  if (r.status === M.MODEL_RESULT.PANEL_CLOSED && r.shown === '' && !r.ok) ok('실패 결과 형태');
  else bad(`형태 이상: ${JSON.stringify(r)}`);
  const g = M.modelResult(M.MODEL_RESULT.OK, 'Veo 3.1 - Lite [Lower Priority]');
  if (g.ok && g.shown.includes('Lower Priority')) ok('성공 결과 형태');
  else bad(`성공 형태 이상: ${JSON.stringify(g)}`);
}

// ── 3. 사람이 읽는 설명이 붙는가 ─────────────────────────────────────────────
// 로그만 보고 어디를 봐야 할지 알아야 한다. "반영되지 않았다" 는 패널이 안 열린 경우에
//   쓰면 **틀린 안내**다 — 모델 목록을 뒤지게 만든다.
{
  const msgs = [M.MODEL_RESULT.PANEL_CLOSED, M.MODEL_RESULT.OPTION_MISSING, M.MODEL_RESULT.NOT_APPLIED]
    .map((s) => M.modelResult(s, '').hint);
  if (msgs.every((m) => typeof m === 'string' && m.length > 10)) ok('사유별 안내 문구');
  else bad(`안내 누락: ${JSON.stringify(msgs)}`);
  if (new Set(msgs).size === msgs.length) ok('사유마다 다른 안내');
  else bad('같은 문구를 재사용 — 구분이 무의미');
}

// ── 4. 0 크레딧 판정은 표시 문자열로만 ───────────────────────────────────────
// "Veo 3.1 - Lite" 는 "Veo 3.1 - Lite [Lower Priority]" 의 **접두사**다.
{
  if (M.isFreeModel('Veo 3.1 - Lite [Lower Priority]')) ok('0크레딧 모델 인식');
  else bad('0크레딧 모델 미인식');
  if (!M.isFreeModel('Veo 3.1 - Lite')) ok('접두사가 같은 유료 모델을 0크레딧으로 오인하지 않는다');
  else bad('유료 모델을 0크레딧으로 판정 — 크레딧이 샌다');
  if (!M.isFreeModel('') && !M.isFreeModel(null)) ok('빈 값은 0크레딧이 아니다');
  else bad('빈 값을 통과시킨다');
}


// ── 5. 재시도 가능 / 치명적 구분 (codex FunctionCallError 에서 차용) ─────────
//
// openai/codex 의 툴 에러는 딱 두 갈래다:
//     RespondToModel(String)  — 호출부가 **다르게 시도**할 수 있음
//     Fatal(String)           — 중단해야 함
// 핵심 축이 "무엇이 실패했나" 가 아니라 **"호출부가 뭘 할 수 있나"** 다.
// sst/opencode 도 같다 — 에러 클래스의 message 게터가 **다음에 뭘 하라는 문장**을 만든다.
// browser-use 의 ActionResult 는 error 를 "always include in long term memory" 로 들고 다닌다.
//
// 내 modelResult 는 사유를 4개로 나눴지만 이 구분이 없어서, 호출부가 전부 중단으로 처리했다.
// 실측(2026-08-28): 신기능 안내 모달 때문에 패널이 안 열린 건 **모달을 치우고 다시 하면 되는**
//   상황이었는데 그냥 죽었다. 이 구분만 있었으면 자동 복구됐다.
{
  const R = M.MODEL_RESULT;
  if (M.isRetryable(R.PANEL_CLOSED)) ok('패널 미개방 = 재시도 가능 (모달 치우고 다시)');
  else bad('패널 미개방을 치명적으로 본다 — 자동 복구를 포기한다');
  if (M.isRetryable(R.NOT_APPLIED)) ok('미반영 = 재시도 가능');
  else bad('미반영을 치명적으로 본다');
  // 모델 목록에 항목이 없는 건 재시도해도 안 된다. Flow 가 구성을 바꾼 것이고 사람이 봐야 한다.
  if (!M.isRetryable(R.OPTION_MISSING)) ok('항목 없음 = 치명적 (같은 시도를 반복해도 소용없다)');
  else bad('항목 없음을 재시도 가능으로 본다 — 무한 반복한다');
  if (!M.isRetryable(R.OK)) ok('성공은 재시도 대상이 아니다');
  else bad('성공을 재시도한다');
}


// ── 6. 새로 생긴 결과인지 판정 (2026-08-28 실측 사고) ────────────────────────
//
// 사고: 앵커 클립을 요청했는데 **기존 시장 클립**이 내려받아졌다.
//   paid-test.mp4 와 anchor-en.mp4 가 SHA256 까지 동일했다(4,593,256B / 9dbe1c38…).
//   화면이 에디터 뷰였고, 열려 있던 기존 클립의 <video> 를 "새 결과" 로 오인한 것이다.
//   그 탓에 "유료 등급도 워터마크가 붙는다" 라는 **틀린 결론**까지 냈다 —
//   같은 파일을 두 번 보고 비교했다.
//
// "before 에 없던 URL" 만으로는 부족하다. 페이지 전환으로 <video> 가 새로 붙어도 새 URL 이다.
// → **생성을 시킨 뒤에 늘어난 것**이어야 하고, 화면이 에디터가 아니라 작업 화면이어야 한다.
{
  const before = ['a', 'b'];
  if (M.freshMedia(before, ['a', 'b', 'c']) === 'c') ok('늘어난 항목을 고른다');
  else bad(`선택 이상: ${M.freshMedia(before, ['a', 'b', 'c'])}`);
  if (M.freshMedia(before, ['a', 'b']) === null) ok('안 늘었으면 null');
  else bad('안 늘었는데 골랐다');
  // 개수가 줄면서 새 URL 이 나타나는 건 **화면 전환**이다. 생성 결과가 아니다.
  if (M.freshMedia(['a', 'b', 'c'], ['z']) === null) ok('개수가 줄면 화면 전환으로 본다 (생성 아님)');
  else bad('화면 전환을 생성 결과로 오인 — 기존 클립을 내려받는다');
  if (M.freshMedia([], ['z']) === 'z') ok('0개 → 1개는 생성으로 본다');
  else bad('첫 생성을 못 잡는다');
  if (M.freshMedia(null, null) === null) ok('빈 입력 안전');
  else bad('빈 입력 이상');
}

console.log(fail ? `\n❌ flow ${fail} 실패` : '\n✅ flow 전부 통과');
process.exit(fail ? 1 : 0);
