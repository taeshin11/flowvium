/**
 * blog-html.mjs — 블로그 글(마크다운)을 Blogger 가 받는 HTML 로 바꾼다. (2026-09-18 신설)
 *
 * 왜 직접 쓰는가: 다룰 입력이 make-blog-post.mjs 가 내는 것 하나뿐이다. 범용 파서를 끌어오면
 *   그 파서의 버릇(스마트 따옴표·자동 줄바꿈 규칙)까지 같이 들어오고, 의존성도 하나 는다.
 *   대신 **내가 실제로 내보내는 문법만** 다루고 그 목록을 blog-html.test.mjs 에 고정한다.
 *   새 문법을 글에 쓰기 시작하면 테스트가 먼저 깨지게 둔다.
 *
 * 순서가 중요하다: 먼저 **전부 이스케이프**한 뒤 우리가 아는 문법만 태그로 되살린다.
 *   반대로 하면(태그부터 만들고 이스케이프) 만든 태그가 다시 escape 돼 글자로 보인다.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 파일 맨 앞의 `<!-- 제목 후보 ... -->` 주석을 떼어낸다. */
export function stripFrontComment(md) {
  return String(md ?? '').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
}

/** `# 제목` 한 줄에서 제목을 꺼낸다. 없으면 null — 지어내지 않는다. */
export function extractTitle(md) {
  const m = /^#\s+(.+)$/m.exec(String(md ?? ''));
  return m ? m[1].trim() : null;
}

/** 이스케이프가 끝난 한 줄 안에서 굵게·링크를 되살린다. */
function inline(line) {
  let t = esc(line);
  // 굵은 URL(`**https://...**`)이 먼저다. b 를 만든 뒤에 링크를 걸면 a 가 b 안에 들어가고,
  //   링크를 먼저 걸면 ** 가 a 태그 속성 사이에 끼어 문법이 깨진다.
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 맨 URL 을 누를 수 있게 만든다. 이미 href 안에 있는 것은 건드리지 않는다(앞에 =" 가 붙는다).
  t = t.replace(/(^|[^"=])(https?:\/\/[^\s<)]+)/g, (_m, pre, url) => `${pre}<a href="${url}">${url}</a>`);
  return t;
}

/**
 * 마크다운 → HTML. 문단·제목·표·목록·인용·구분선만 다룬다.
 * @param {string} md
 * @returns {string}
 */
export function mdToHtml(md) {
  const lines = stripFrontComment(md).split('\n');
  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) { flush(); continue; }

    // 표: 헤더줄 다음이 정렬줄(| --- | ---: |)일 때만 표로 본다. 아니면 그냥 문단이다.
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      flush();
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\|/.test(lines[j].trim())) { rows.push(cells(lines[j])); j += 1; }
      out.push(
        '<table border="1" cellpadding="6" cellspacing="0">'
        + `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        + '</table>',
      );
      i = j - 1;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      // h1 은 글 제목이라 본문에 두지 않는다 — Blogger 는 제목을 따로 받는다.
      if (h[1].length > 1) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    if (/^---+$/.test(line)) { flush(); out.push('<hr>'); continue; }

    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) { flushPara(); (list ??= []).push(li[1]); continue; }

    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) { flush(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }

    flushList();
    para.push(line);
  }
  flush();
  return out.join('\n');
}
