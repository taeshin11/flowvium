/**
 * channel-links.test — 채널 프로필 링크 순서 바꾸기(2026-11-26 사장님 수익 지시 → 3-AI 3/3 안 A).
 *   쇼츠에서 눌리는 곳은 프로필 링크뿐이고 채널 머리엔 첫 링크만 보인다. AISVI 는 10/28부터 2번째였다.
 *   Studio 의 끌어 옮기기 대신 칸의 값을 순서대로 다시 쓴다 — 무엇을 어디에 쓸지는 이 순수 함수가 정한다.
 */
let fail = 0;
const ok = (m) => console.log('  PASS ', m), bad = (m) => { fail++; console.log('  FAIL ', m); };
const M = await import('./channel-links.mjs').catch(() => ({}));
const f = M.planLinkFirst;
if (typeof f !== 'function') bad('[1] planLinkFirst 없음');
else {
  const rows = [{ title: 'Flowvium', url: 'https://flowvium.net' }, { title: 'AISVI 무료 체험', url: 'https://aisviagent.com/?utm_source=youtube&utm_medium=channel_links' }];
  const p = f(rows, 'aisviagent.com');
  (p.changed && p.order[0].url.includes('aisviagent.com') && p.order[1].url === 'https://flowvium.net' && p.order[0].title === 'AISVI 무료 체험')
    ? ok('[1] AISVI 를 맨 앞으로, 나머지 순서 유지, 제목·주소 짝 유지') : bad(`[1] ${JSON.stringify(p)}`);
  (p.order[0].url === rows[1].url) ? ok('[2] UTM 주소를 그대로 둔다') : bad('[2] 주소가 바뀌었다');
  const q = f([rows[1], rows[0]], 'aisviagent.com');
  (q.changed === false) ? ok('[3] 이미 첫째면 아무것도 안 쓴다') : bad('[3]');
  const r = f(rows, 'nothere.com');
  (r.changed === false && r.why) ? ok('[4] 대상 링크가 없으면 쓰지 않고 이유를 남긴다') : bad('[4]');
  const s = f([...rows, { title: 'X', url: 'https://x.com' }], 'aisviagent.com');
  (s.order.map((x) => x.title).join('|') === 'AISVI 무료 체험|Flowvium|X') ? ok('[5] 세 개일 때도 나머지 순서 유지') : bad(`[5] ${s.order.map((x) => x.title)}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
