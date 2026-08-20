/**
 * news-feeds.mjs — 뉴스 피드 단일 소스 + RSS 파싱.
 *
 * 배경(2026-08-20 실측): 뉴스 수집이 보고서 생성에만 붙어 있었다.
 *   news_archive 1,364건 기준 발행→수집 지연 중앙값 125분 · p90 287분.
 *   수집 시각이 보고서 세션(05:30·10:30·14:30·20:00·22:30)에 정확히 몰려 p90 이 세션 간격과 같았다.
 *   즉 병목은 소스도, 트위터 유무도 아니라 '주기'다. 독립 폴러가 같은 목록을 쓰도록 밖으로 뺀다.
 *   목록을 두 곳에 복사하면 한쪽만 고쳐 조용히 어긋난다.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeXML } from 'entities';
import { ROOT } from './project-root.mjs';

const raw = JSON.parse(readFileSync(resolve(ROOT, 'data/news-feeds.json'), 'utf8'));

export const FINANCIAL_SIGNAL = new RegExp(raw.financialSignal, 'i');

/** 피드 정의. titleFilter 는 JSON 에 문자열로 저장돼 있으므로 RegExp 으로 복원한다. */
export function loadFeeds() {
  return raw.feeds.map(f => ({ ...f, titleFilter: f.titleFilter ? new RegExp(f.titleFilter) : undefined }));
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return decodeXML(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
};

/**
 * RSS/Atom → [{ title, link, guid, pubDate, pubMs, summary }].
 * 깨진 입력은 예외가 아니라 빈 배열 — 피드 하나가 죽었다고 폴링 전체가 멈추면 안 된다.
 */
export function parseFeed(xml) {
  const out = [];
  if (typeof xml !== 'string' || !xml) return out;
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    if (!title) continue;
    let link = tag(b, 'link');
    if (!link) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) ?? [])[1] ?? '';
    const pubDate = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const pubMs = pubDate ? Date.parse(pubDate) : NaN;
    // guid 가 없으면 link 로 대체한다. 안정적인 식별자가 없으면 폴링마다 같은 기사가 다시 쌓인다.
    const guid = tag(b, 'guid') || tag(b, 'id') || link;
    out.push({
      title, link, guid,
      pubDate: pubDate || null,
      pubMs: Number.isFinite(pubMs) ? pubMs : NaN,
      summary: tag(b, 'description') || tag(b, 'summary') || '',
    });
  }
  return out;
}

/** 피드 정의의 필터를 적용. 통과하면 true. */
export function passesFilter(item, { requireFinancial = false, titleFilter } = {}) {
  const t = `${item.title ?? ''} ${item.summary ?? ''}`;
  if (titleFilter && !titleFilter.test(item.title ?? '')) return false;
  if (requireFinancial && !FINANCIAL_SIGNAL.test(t)) return false;
  return true;
}
