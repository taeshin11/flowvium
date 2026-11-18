/**
 * shorts-skeleton.mjs — 쇼츠 대본 뼈대(구성 순서·길이 비중)와 첫 3초·저장 요소·구독 권유. 근거·출처는 shorts-skeleton.test.mjs 머리말.
 *   뼈대는 구성만 가져온다 — 출처 영상의 내용·문장·장면은 프롬프트에 넣지 않는다. 출처 URL 은 메타(작업 파일)에만 남긴다.
 */

// share = 출처 영상에서 그 구간이 차지한 시간 비중(자동 자막 시점 실측).
export const SKELETONS = Object.freeze([
  { id: 'flip', name: '통념 뒤집기', open: '반전', src: 'https://www.youtube.com/shorts/Kvvrc6nzbdc', srcViews: 704361, srcSec: 65,
    beats: [
      { role: '흔히 믿는 것을 뒤집는 한 줄로 열고, 그와 다른 사실(숫자)을 바로 댄다', share: 0.2 },
      { role: '왜 그런지 — 진짜 이유', share: 0.185 },
      { role: '큰 그림 — 기사에 있는 숫자 둘셋으로 규모를 보여준다', share: 0.31 },
      { role: '그래서 무엇이 달라지나, 한 문장 결론', share: 0.305 },
    ] },
  { id: 'crisis', name: '위기와 버팀선', open: '위기', src: 'https://www.youtube.com/shorts/adnS05irnDw', srcViews: 726438, srcSec: 86,
    beats: [
      { role: '무엇이 무너졌나(위기)로 열고 짧은 답을 바로 준다', share: 0.233 },
      { role: '어디까지 갈 수 있나 — 기사에 있는 숫자로 나쁜 경우와 버티는 경우', share: 0.291 },
      { role: '지금 무엇을 보면 되나', share: 0.116 },
      { role: '근본 원인', share: 0.36 },
    ] },
  { id: 'vs', name: '결론 먼저 비교', open: '결론', src: 'https://www.youtube.com/shorts/g1sZdE5hmRA', srcViews: 773254, srcSec: 44,
    beats: [
      { role: '결론을 먼저 말하고, 무엇과 무엇을 견주는지 밝힌다', share: 0.227 },
      { role: '양쪽을 숫자로 나란히 비교', share: 0.409 },
      { role: '핵심 한 가지', share: 0.273 },
      { role: '한 줄로 정리', share: 0.091 },
    ] },
  { id: 'twist', name: '놀라운 사실과 반전', open: '반전', src: 'https://www.youtube.com/shorts/zOt7Z_v8AXE', srcViews: 508788, srcSec: 71,
    beats: [
      { role: '놀라운 사실 하나와 그 숫자로 연다', share: 0.197 },
      { role: '이게 보는 사람에게 어떤 일인지로 바꿔 묻는다(기사에 있는 영향만)', share: 0.268 },
      { role: '답 — 예상과 다른 점(반전)', share: 0.31 },
      { role: '처음 사실로 돌아가 정리', share: 0.225 },
    ] },
]);

// 편 번호를 섞는다(explore-slot 과 같은 곱셈 해시, 다른 오프셋) — n%4 를 그대로 쓰면 다른 A/B 박자와 겹친다.
const mix = (n) => { let x = (Math.abs(Math.trunc(Number(n) || 0)) + 0x51ed27) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };

/** 편 번호로 고르되 직전 편과 같은 뼈대는 피한다. recent = 최근 편의 뼈대 id(최신이 앞). */
export function pickSkeleton(seed, recent = []) {
  const n = SKELETONS.length;
  let i = mix(seed) % n;
  if (SKELETONS[i].id === recent?.[0]) i = (i + 1 + (mix(seed + 1) % (n - 1))) % n;
  return SKELETONS[i];
}

const FLOOR = 0.15;   // 가장 짧은 장면도 저장 요소·한 문장은 담게
/** 대본 프롬프트에 넣을 규칙. 장면 4개 기준. */
export function skeletonRule(sk, budget) {
  const raw = sk.beats.map((b) => Math.max(FLOOR, b.share));
  const tot = raw.reduce((a, b) => a + b, 0);
  const chars = raw.map((s) => Math.round((budget * s) / tot));
  const lines = sk.beats.map((b, i) => `  ${i + 1}번 장면: ${b.role} — ${chars[i]}자 안팎`);
  return `
- **이번 편의 구성(뼈대) — 순서와 분량을 따른다.** 다른 영상의 내용·문장을 베끼지 말고, 이 기사 사실로만 채운다.
${lines.join('\n')}
- **1번 장면 첫 문장은 15자 이내의 '${sk.open}'으로 연다** — 첫 3초 자막이 된다. 기사에 있는 사실로만.
- **${sk.beats.length}번 장면에 '저장할 이유'를 넣는다** — 앞에서 말한 숫자 둘셋을 "기억할 숫자는 …"처럼 다시 짚는다(새 숫자를 만들지 마라).`;
}

const noSpace = (t) => String(t ?? '').replace(/\s+/g, '');
/** 첫 3초 자막 — 띄어쓰기 빼고 15자 이내. */
export const firstCaptionOk = (t) => { const n = noSpace(t).length; return n > 0 && n <= 15; };

// 날짜·차례·시각(17일·11월·2026년·3차·9시)은 '다시 볼 숫자' 가 아니다 — 기사 뼈대일 뿐이다.
const NUM = /(?<![\d,.])\d[\d,.]*(?![\d,.])\s*(?!일|월|년|차|시(?!간)|분(?!의)|주년)/g;
/** 저장 요소 — 다시 볼 숫자가 둘 이상. */
export const saveItemOk = (say) => (String(say ?? '').match(NUM) ?? []).length >= 2;

const CTA = [
  (k) => `${k}, 이어지는 소식도 바로 정리해 드립니다. 구독해 두세요.`,
  (k) => `${k} 다음 소식도 여기서 먼저 짚겠습니다. 구독해 두세요.`,
  (k) => `${k} 후속, 구독해 두시면 놓치지 않습니다.`,
  (k) => `다음 ${k} 소식도 짧게 정리합니다. 구독해 두세요.`,
];
/** 끝 구독 권유 — 그 사안 이름을 넣고 편마다 문형을 돌린다. 링크·주소는 넣지 않는다(쇼츠에선 안 눌린다). */
export function subCtaLine(keyword, seed) {
  const k = String(keyword ?? '').trim() || '이 소식';
  return CTA[Math.abs(Math.trunc(Number(seed) || 0)) % CTA.length](k);
}
