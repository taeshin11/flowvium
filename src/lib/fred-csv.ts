/**
 * fred-csv.ts — FRED fredgraph.csv 해석(공용). 2026-10-22 신설, 근거 scripts/lib/fred-csv.test.mjs.
 *
 * FRED 가 점검 중이면 200 + HTML 을 낸다. 예전 해석기들은 아무 줄이나 `split(',')[1]` 을 숫자로 읽어
 * 점검 페이지 글꼴 줄(`Open+Sans:300,400,700`)의 400 을 기준금리·GDP·스프레드 최신값으로 내보냈다.
 * 첫 줄이 FRED 헤더가 아니면 관측 없음([])으로 돌려준다 — 부르는 쪽은 '데이터 없음' 경로(정적·캐시·빈 값)로 간다.
 */
export interface FredObs { date: string; value: number }

const HEADER = /^\s*(observation_date|DATE)\s*,/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseFredCsv(text: string): FredObs[] {
  const lines = String(text ?? '').replace(/\r/g, '').trim().split('\n');
  if (!lines.length || !HEADER.test(lines[0])) return [];
  const out: FredObs[] = [];
  for (const line of lines.slice(1)) {
    const [d, v] = line.split(',');
    const date = (d ?? '').trim(); const raw = (v ?? '').trim();
    if (!ISO_DAY.test(date) || !raw || raw === '.' || raw === 'NA') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}
