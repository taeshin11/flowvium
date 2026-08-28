#!/usr/bin/env node
/**
 * thumbnail.test.mjs — 썸네일 문구를 헤드라인에서 뽑는다.
 *
 * 배경(2026-08-27): "사람들이 확 끌릴 요소". 썸네일 클릭률이 조회수의 첫 관문이고,
 *   거기 들어가는 건 문장이 아니라 **덩어리 몇 개**다. 헤드라인을 그대로 넣으면 아무도 못 읽는다.
 *
 * 규칙: 화면에 크게 들어가려면 2~4단어. 고유명사(사람·기관)를 우선 살리고, 동사·수식어는 버린다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./thumbnail.mjs');

// ── 1. 길이 ─────────────────────────────────────────────────────────────────
{
  const t = M.thumbText('Dolly Parton theme park president says "we have a lot of plans in place"');
  if (t.split(/\s+/).length <= 4) ok(`4단어 이하: "${t}"`);
  else bad(`너무 길다: "${t}"`);
  if (t.length > 0) ok('빈 문자열이 아니다');
  else bad('빈 결과');
}

// ── 2. 고유명사를 살린다 ─────────────────────────────────────────────────────
{
  const t = M.thumbText('3 Secret Service officials put on leave amid investigation into misconduct');
  if (/secret service/i.test(t)) ok(`기관명 보존: "${t}"`);
  else bad(`기관명 유실: "${t}"`);
}

// ── 3. 숫자를 살린다 — 숫자는 클릭을 만든다 ─────────────────────────────────
{
  const t = M.thumbText('24 states sue to block new Postal Service order');
  if (/24/.test(t)) ok(`숫자 보존: "${t}"`);
  else bad(`숫자 유실: "${t}"`);
}

// ── 4. 붙어 있는 구를 뽑는다 (2026-08-28 변경) ───────────────────────────────
//   종전엔 점수 높은 낱말을 흩어서 골랐다. 그 결과 실제 렌더에서
//   "Fed unfounded untrue" 가 나왔다 — 크게 박아 놔도 뜻이 안 선다.
//   이제 **헤드라인에 실제로 붙어 있던 구간**만 뽑는다.
{
  const DROP_SAMPLE = ['the', 'a', 'to', 'of', 'in', 'on', 'for', 'and', 'its', 'says', 'are'];
  const cases = [
    'Fed’s Cook says Trump’s claims are unfounded and untrue',
    'Judge denies request to halt Dolly Parton theme park expansion',
    '3 Secret Service officials removed after security lapse',
    'Postal Service to raise stamp prices in 24 states',
    'Ratko Mladic, the Butcher of Bosnia, dies in prison at 85',
    'Big Brother set to air its one thousandth episode',
    'Peter Cullen, the voice of Optimus Prime, has died at 84',
  ];
  let bad_ = 0;
  for (const h of cases) {
    const out = M.thumbText(h);
    const words = out.split(/\s+/).filter(Boolean);
    // ① 4낱말 이하
    if (words.length > 4) { bad(`"${out}" — 4낱말을 넘었다`); bad_++; continue; }
    // ② 원문에 그 순서 그대로 붙어 있어야 한다
    const flat = h.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w));
    let contiguous = false;
    for (let i = 0; i + words.length <= flat.length; i++) {
      if (flat.slice(i, i + words.length).join(' ') === words.join(' ')) { contiguous = true; break; }
    }
    if (!contiguous) { bad(`"${out}" — 원문에 붙어 있지 않다 (${h.slice(0, 40)}…)`); bad_++; continue; }
    // ③ 불용어가 남지 않는다
    const leak = words.filter((w) => DROP_SAMPLE.includes(w.toLowerCase()));
    if (leak.length) { bad(`"${out}" — 불용어 잔류 ${JSON.stringify(leak)}`); bad_++; continue; }
    // ④ 숫자 하나만 남지 않는다 — 무슨 얘기인지 알 수 없다
    if (words.length === 1 && /^\d+$/.test(words[0])) { bad(`"${out}" — 숫자 하나만 남았다`); bad_++; continue; }
  }
  if (!bad_) ok(`구 추출 ${cases.length}건 — 붙어 있고, 불용어 없고, 4낱말 이하`);
}

// ── 5. 한국어 ────────────────────────────────────────────────────────────────
{
  const t = M.thumbText('이재명 대통령이 국무회의에서 밝힌 내용');
  if (t.length <= 14 && t.startsWith('이재명')) ok(`한국어 축약: "${t}" (${t.length}자)`);
  else bad(`한국어 축약 이상: "${t}"`);
}

// ── 6. 빈 입력 ───────────────────────────────────────────────────────────────
{
  if (M.thumbText('') === '' && M.thumbText(null) === '') ok('빈 입력 → 빈 문자열');
  else bad('빈 입력 이상');
}

// ── 7. HTML — 외부 데이터가 마크업으로 새지 않는다 ───────────────────────────
{
  const h = M.thumbnailHtml({ text: 'Dolly Parton', kicker: 'BREAKING', image: '/x.jpg' }, { width: 1280, height: 720 });
  if (/^<!doctype html>/i.test(h) && h.includes('Dolly') && h.includes('Parton')) ok('HTML 생성');
  else bad('HTML 이상');

  // 노랑 글씨 + 빨강 강조 한 낱말 (2026-08-28 지시: "사진에 노랑 빨강 글씨 넣어서 눈에 띄게").
  if (h.includes('#ffe11a')) ok('본문 글자는 노랑');
  else bad('노랑 색이 없다');
  const hots = [...h.matchAll(/<span class="hot">/g)].length;
  if (hots === 1) ok('빨강 강조는 한 낱말만');
  else bad(`빨강 강조가 ${hots}군데 — 하나여야 시선이 정해진다`);
  if (h.includes('#ff2b2b')) ok('강조는 빨강');
  else bad('빨강 색이 없다');
  // 밝은 사진 위에서 노랑은 그냥 사라진다. 외곽선이 있어야 한다.
  if (/-webkit-text-stroke:\s*\d+px/.test(h)) ok('검은 외곽선으로 감싼다');
  else bad('외곽선이 없다 — 밝은 배경에서 노랑이 사라진다');

  // 한 낱말짜리 문구는 강조하지 않는다(전부 빨강이 되면 의미가 없다).
  const one = M.thumbnailHtml({ text: 'Trump' });
  if (!one.includes('class="hot"')) ok('한 낱말이면 강조 없음');
  else bad('한 낱말인데 강조가 붙었다');
  // 외부 문자열이 마크업으로 새지 않는다. 본문 문구는 thumbLines 가 글자·숫자만 남기고
  //   털어내므로 애초에 태그가 들어오지 않고, 키커·이미지 경로는 esc 로 막는다.
  const e = M.thumbnailHtml({ text: '<script>x</script>&', kicker: 'A & B', image: 'x".jpg' }, {});
  if (!/<script>/.test(e)) ok('본문에 태그가 안 남는다');
  else bad('본문에 <script> 가 남았다');
  if (e.includes('A &amp; B')) ok('키커 이스케이프');
  else bad('키커가 이스케이프되지 않았다');
  if (e.includes('&quot;') && !/background-image:url\('x"/.test(e)) ok('이미지 경로 이스케이프');
  else bad('이미지 경로가 이스케이프되지 않았다 — 속성 밖으로 샌다');
}

console.log(fail ? `\n❌ thumbnail ${fail} 실패` : '\n✅ thumbnail 전부 통과');
process.exit(fail ? 1 : 0);
