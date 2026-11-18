#!/usr/bin/env node
/**
 * blog-cards.test.mjs — 블로그 글(Blogger·네이버)에 그림을 넣는다. (2026-11-19 신설)
 *
 * 왜(11/19 실측): 플로비움 Blogger 최근 5편 그림 0장, 네이버 글쓰기 코드엔 그림 넣는 부분이 아예 없었다.
 *   사장님 11/19 (Mac mini2 경유): 글마다 그림 3~6장, 첫 그림은 제목 바로 아래, 소제목마다 1장.
 *   남의 사진·검색 이미지 금지 — 우리 영상 썸네일·직접 만든 표/체크리스트 카드만. 그림마다 alt·짧은 캡션,
 *   가로 1080 이하·장당 500KB 이하. 영상 링크는 본문 중간 1곳 + 끝 1곳.
 * 그래서 그림은 **글에 이미 있는 숫자·문장으로만** 만든 카드다(새 사실을 지어내지 않는다).
 */
import { parsePost, planCards, cardHtml, withCardImages, videoIdOf } from './blog-cards.mjs';
import { mdToHtml } from './blog-html.mjs';
import { readFileSync } from 'fs';

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const md = readFileSync(new URL('./fixtures/blog-2026-11-19-morning.md', import.meta.url), 'utf8');

// [1] 글 구조 — 제목, 꼬리(---) 앞 소제목들, 표·목록·하위 종목
{
  const p = parsePost(md);
  const names = p.sections.map((s) => s.title);
  (p.title.startsWith('United Rentals') && names.join('|') === '오늘 시장, 이렇게 봤습니다|지수부터 짚고 가겠습니다|그래서 오늘은 어떻게 볼까|눈여겨본 종목|앞으로 확인할 일정')
    ? ok(`[1] 소제목 ${names.length}개(꼬리 '이 정리는 어디서'·'1분 영상' 은 뺌)`) : bad(`[1] ${JSON.stringify(names)}`);
  const t = p.sections[1].table;
  (t && t.head[0] === '지수' && t.rows.length === 5) ? ok('[1b] 표') : bad(`[1b] ${JSON.stringify(t)}`);
  (p.sections[3].subs.length === 3 && p.sections[4].list.length === 2) ? ok('[1c] 종목 3·일정 2') : bad('[1c]');
}

// [2] 그림 계획 — 3~6장, 첫 장은 제목 아래, 나머지는 소제목마다, 영상 썸네일 1장(우리 영상)
{
  const cards = planCards(parsePost(md));
  const n = cards.length;
  (n >= 3 && n <= 6) ? ok(`[2] 그림 ${n}장`) : bad(`[2] ${n}장`);
  cards[0].anchor === null && cards[0].kind === 'hero' ? ok('[2b] 첫 그림은 제목 바로 아래') : bad(`[2b] ${JSON.stringify(cards[0])}`);
  const anchors = cards.slice(1).map((c) => c.anchor);
  new Set(anchors).size === anchors.length ? ok('[2c] 한 소제목에 한 장') : bad(`[2c] ${anchors}`);
  const v = cards.find((c) => c.kind === 'video');
  (v && v.src === 'https://i.ytimg.com/vi/jI7ic_KJih0/hqdefault.jpg' && v.link === 'https://www.youtube.com/watch?v=jI7ic_KJih0')
    ? ok('[2d] 영상 썸네일은 우리 영상(글 끝 링크의 영상)') : bad(`[2d] ${JSON.stringify(v)}`);
  cards.every((c) => c.alt && c.caption && c.caption.length <= 40) ? ok('[2e] 모든 그림에 alt·짧은 캡션') : bad('[2e]');
  // 등락이 전부 '–' 인 열은 그림에서 뺀다 — 빈 칸만 있는 열은 정보가 아니다
  // 제목 카드는 바로 아래 첫 문장을 되풀이하지 않는다(11/19 눈검증) — 글의 첫 표 숫자 셋을 보여 준다
  const hero = cards[0];
  (!hero.intro && JSON.stringify(hero.figures) === JSON.stringify([{ label: '코스피', value: '5,067.44' }, { label: '코스닥', value: '662.81' }, { label: '나스닥', value: '24,322.71' }]))
    ? ok('[2g] 제목 카드 = 첫 표 숫자 셋(첫 문장 되풀이 안 함)') : bad(`[2g] ${JSON.stringify(hero)}`);
  const tb = cards.find((c) => c.kind === 'table');
  (tb && !tb.head.includes('등락')) ? ok('[2f] 값이 전부 빈 열(등락 –)은 표 그림에서 뺀다') : bad(`[2f] ${JSON.stringify(tb?.head)}`);
}

// [3] 카드 내용은 글에 있는 것뿐 — 종목 카드의 숫자가 원문 숫자와 같다
{
  const cards = planCards(parsePost(md));
  const picks = cards.find((c) => c.kind === 'picks');
  const html = picks ? cardHtml(picks, { date: '11월 19일' }) : '';
  (['URI', '$1050-1090', '$980', '$1250', 'VLTO', '$140'].every((x) => html.includes(x)) && /width:\s*1080px/.test(html))
    ? ok('[3] 종목 카드 = 원문의 진입·손절·목표 그대로, 가로 1080') : bad('[3] 종목 카드');
  cardHtml({ kind: 'list', title: '<b>', items: ['<script>'] }).includes('<script>') ? bad('[3b] 이스케이프 안 함') : ok('[3b] 글자 이스케이프');
}

// [4] 그림 줄 넣기 — 제목 아래·소제목 바로 아래, 영상 링크는 중간 1곳 + 끝(원래 있던 것) 1곳
{
  const cards = planCards(parsePost(md));
  const out = withCardImages(md, cards, (c) => `https://flowvium.net/api/blog-img/x-${c.id}.jpg`);
  const lines = out.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  /^!\[/.test(lines.slice(h1 + 1).find((l) => l.trim()) ?? '') ? ok('[4] 제목 바로 아래 첫 그림') : bad('[4]');
  const imgs = lines.filter((l) => /^!\[/.test(l)).length;
  imgs === cards.length ? ok(`[4b] 그림 줄 ${imgs}`) : bad(`[4b] ${imgs} vs ${cards.length}`);
  const links = (out.match(/youtube\.com\/watch\?v=jI7ic_KJih0/g) ?? []).length;
  const tail = out.indexOf('### 1분 영상으로도');
  const mid = out.indexOf('youtube.com/watch?v=jI7ic_KJih0');
  (links >= 2 && mid < tail) ? ok('[4c] 영상 링크 본문 중간 1 + 끝 1') : bad(`[4c] links=${links} mid=${mid} tail=${tail}`);
  withCardImages(out, cards, () => 'u') === out ? ok('[4d] 두 번 넣어도 같은 글(이미 넣었으면 그대로)') : bad('[4d] 중복으로 들어간다');
}

// [5] mdToHtml 이 그림 줄을 figure·img·alt·figcaption 으로, 주소는 https 만
{
  const h = mdToHtml('![지수 표](https://flowvium.net/api/blog-img/a.jpg "직접 만든 표")');
  (/<figure[^>]*><img[^>]+src="https:\/\/flowvium\.net\/api\/blog-img\/a\.jpg"[^>]+alt="지수 표"[^>]*><figcaption>직접 만든 표<\/figcaption><\/figure>/.test(h))
    ? ok('[5] figure/img/alt/figcaption') : bad(`[5] ${h}`);
  !/<img/.test(mdToHtml('![x](javascript:alert(1) "c")')) ? ok('[5b] https 아닌 주소는 그림으로 안 만든다') : bad('[5b]');
}

// [6] 영상 id — 글 끝 '최근 영상' 링크에서
videoIdOf(md) === 'jI7ic_KJih0' && videoIdOf('영상 없음') === null ? ok('[6] 영상 id') : bad('[6]');

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
