#!/usr/bin/env node
/**
 * shorts-layout.test.mjs — 세로 쇼츠 화면이 참고 구성대로 나오는가.
 *
 * 배경(2026-09-03): 사용자가 참고 쇼츠 두 장을 보여주며 "그렇게 해" 라고 했다.
 *   읽은 구성 — 검은 띠(훅 2줄: 흰색/노랑) · 소재 레터박스(우하단 출처) · 검은 띠(형광 연두 캡션).
 *   기존 파이프라인은 1920×1080 가로에 하단 밝은 자막 띠 하나다. 기하가 전부 다르다.
 *
 * 이 검사가 보는 것은 "예쁜가" 가 아니라 **깨지지 않는가** 다:
 *   띠와 소재가 겹치지 않는가, 화면 밖으로 나가지 않는가, 훅이 두 줄로 갈리는가,
 *   그리고 소재가 **잘리지 않는가**(뉴스 사진은 잘리면 현장·인물이 사라진다).
 */
let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

const M = await import('./shorts-layout.mjs');
const g = M.SHORTS;

// ── 기하: 9:16, 겹침 없음, 화면 안 ──────────────────────────────────────────────
{
  g.W === 1080 && g.H === 1920 ? ok('1080×1920 (유튜브 쇼츠 표준)') : bad(`${g.W}×${g.H}`);
  const ratio = g.H / g.W;
  Math.abs(ratio - 16 / 9) < 0.01 ? ok('9:16 비율') : bad(`비율 ${ratio.toFixed(3)}`);

  g.hook.top + g.hook.height === g.media.top
    ? ok('훅 띠와 소재가 맞닿는다(틈 없음)')
    : bad(`틈/겹침: 훅 끝 ${g.hook.top + g.hook.height} vs 소재 시작 ${g.media.top}`);
  g.media.top + g.media.height === g.caption.top
    ? ok('소재와 캡션 띠가 맞닿는다')
    : bad(`틈/겹침: 소재 끝 ${g.media.top + g.media.height} vs 캡션 시작 ${g.caption.top}`);
  g.caption.top + g.caption.height === g.H
    ? ok('캡션 띠가 화면 끝에서 정확히 끝난다')
    : bad(`화면 밖으로 ${g.caption.top + g.caption.height - g.H}px`);
}

// ── 훅 두 줄 분할 — 뒷줄이 강조(노랑)라 결정적인 말이 뒤로 가야 한다 ───────────
{
  const [a, b] = M.splitHook('삼성전자가 만든 세계 1위 반도체');
  a && b ? ok(`훅이 두 줄로 갈린다 ("${a}" / "${b}")`) : bad(`분할 실패: ${JSON.stringify([a, b])}`);
  b.length <= 12 ? ok(`뒷줄이 한 줄에 들어간다 (${b.length}자)`) : bad(`뒷줄 ${b.length}자 — 넘친다`);
  `${a} ${b}`.replace(/\s+/g, '') === '삼성전자가만든세계1위반도체'
    ? ok('원문을 잃지 않는다') : bad(`원문이 바뀌었다: "${a} ${b}"`);

  const [c, d] = M.splitHook('짧은훅');
  (c + d).length > 0 ? ok('한 덩어리도 처리한다') : bad('한 덩어리에서 빈 결과');
  const [e, f] = M.splitHook('');
  e === '' && f === '' ? ok('빈 입력은 빈 두 줄(예외 아님)') : bad('빈 입력 처리 실패');
}

// ── 오버레이: 색 위계와 출처 ────────────────────────────────────────────────────
{
  const html = M.shortsOverlayHtml({ hook: '두바이 하늘이 갈라졌다', caption: '요즘 전 세계에서 늘고 있어요', credit: '출처- X, Murat Etyemez', brand: 'FLOWVIUM' });
  /#fff/.test(html) && /#ffd400/.test(html)
    ? ok('훅 1줄 흰색 · 2줄 노랑') : bad('훅 색 위계가 없다');
  /#b6ff3b/.test(html) ? ok('캡션 형광 연두') : bad('캡션 색이 참고와 다르다');
  /출처- X, Murat Etyemez/.test(html) ? ok('출처 표기가 화면에 들어간다') : bad('출처가 빠졌다');
  /background:#000/.test(html) ? ok('위아래 검은 띠') : bad('검은 띠가 없다');

  // 사용자 입력이 그대로 HTML 로 들어가면 화면이 깨진다
  const evil = M.shortsOverlayHtml({ hook: '<script>x</script>', caption: 'a & b' });
  !/<script>/.test(evil) && /&amp;/.test(evil)
    ? ok('HTML 이스케이프') : bad('이스케이프가 안 된다 — 오버레이가 깨진다');
}

// ── 소재는 잘리지 않는다 ────────────────────────────────────────────────────────
{
  const f = M.mediaFilter('0:v', 'bg');
  /force_original_aspect_ratio=decrease/.test(f)
    ? ok('레터박스 — 소재를 잘라내지 않는다(뉴스 사진은 잘리면 현장이 사라진다)')
    : bad('crop 으로 잘라낸다');
  // 2026-09-03 정정: 처음엔 "increase 금지" 로 못 박았는데, 블러 채움을 넣으며 그 규칙이
  //   너무 넓어졌다. 잘리면 안 되는 것은 **앞의 원본** 이고, 뒤 배경은 잘려도 정보 손실이 아니다.
  //   규칙을 정확히 다시 쓴다 — 원본 경로에는 crop 이 붙지 않아야 한다.
  const fg = f.split(';').find((seg) => /\[mfg\]/.test(seg)) ?? '';
  /decrease/.test(fg) && !/crop/.test(fg)
    ? ok('앞 원본 경로에는 crop 이 없다')
    : bad(`원본을 잘라낸다: ${fg.slice(0, 80)}`);
  new RegExp(`pad=${g.W}:${g.H}`).test(f) ? ok('전체 화면 크기로 패딩') : bad(`패딩 크기가 틀렸다: ${f.slice(0, 90)}`);
  // 블러 채움 — 가로로 긴 사진이 얇은 띠가 되어 영역 절반이 비던 것을 메운다(2026-09-03 실측).
  //   뒤 배경은 잘라도 된다(정보가 아니다). 앞 원본은 여전히 잘리지 않아야 한다.
  /boxblur/.test(f) ? ok('블러 배경으로 영역을 채운다') : bad('빈 검은 여백이 남는다');
  (f.match(/force_original_aspect_ratio=decrease/g) || []).length >= 1
    ? ok('앞 원본은 여전히 잘리지 않는다') : bad('원본까지 잘라낸다');
  /setsar=1/.test(f) ? ok('픽셀 종횡비 고정(찌그러짐 방지)') : bad('setsar 없음 — 소재가 찌그러질 수 있다');
}

// ── 화면 글자의 숫자 띄어쓰기 (2026-09-05) ─────────────────────────────────────
// 대본 프롬프트가 "숫자는 한글로 풀어 쓴다(TTS 오독 방지)" 라고 시켜서 LLM 이
//   "6 억 8 천만", "15 일", "왜 6 개" 처럼 띄어 쓴다. 음성에는 그게 낫지만
//   **자막·훅은 사람이 쓴 글로 보여야 한다**. 화면 글자에서만 붙인다.
{
  const t = M.tightenNumbers;
  t('김승원 후보자, 수원 아파트 등 6 억 8 천만 원 재산신고했습니다') === '김승원 후보자, 수원 아파트 등 6억 8천만원 재산신고했습니다'
    ? ok('"6 억 8 천만 원" → "6억 8천만원"') : bad(`금액: ${t('6 억 8 천만 원')}`);
  t('15 일 국회 인사청문회') === '15일 국회 인사청문회' ? ok('"15 일" → "15일"') : bad(`날짜: ${t('15 일 국회')}`);
  t('왜 6 개') === '왜 6개' ? ok('"6 개" → "6개"') : bad(`개수: ${t('왜 6 개')}`);
  t('특별감찰관 18 일') === '특별감찰관 18일' ? ok('단위 앞 공백만 지운다') : bad(`${t('특별감찰관 18 일')}`);
  // 지우면 안 되는 공백 — 단위가 아닌 낱말은 그대로 둔다
  t('6 개월 만에 3 조 원') === '6개월 만에 3조원' ? ok('"만에" 는 단위가 아니다(그대로)') : bad(`${t('6 개월 만에 3 조 원')}`);
  t('한 개도 없다') === '한 개도 없다' ? ok('숫자가 아니면 안 건드린다') : bad(`${t('한 개도 없다')}`);
  t('') === '' && t(null) === '' ? ok('빈 입력 안전') : bad('빈 입력에서 깨진다');
  // 실제로 화면에 나가는 경로에 걸려 있는가 — 함수만 있고 안 쓰면 소용없다
  const h = M.shortsOverlayHtml({ hook: '6 억 8 천만', caption: '15 일 청문회' });
  !/6 억/.test(h) && !/15 일/.test(h)
    ? ok('훅·자막 렌더 경로에 실제로 적용된다') : bad('함수는 있는데 렌더에 안 걸렸다');
}

console.log(fail === 0 ? '\n✅ shorts-layout 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
