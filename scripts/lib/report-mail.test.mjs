#!/usr/bin/env node
/**
 * report-mail.test.mjs — 아침보고서 메일(2026-09-30 사장님 "매일매일 아침보고서만 메일로 보내줘").
 *
 * 되물음 결과: 수신 동의한 사람에게만(기존 가입자 2명은 동의 메일 1회) · 발송은 Resend.
 * 여기서 못박는 것:
 *   · 본문은 보고서의 **사실 필드만** 옮긴다(스탠스·요지·지켜볼 것·종목 표·다음 일정). 새 문장을 짓지 않는다.
 *   · 모든 메일에 **수신거부 링크** + List-Unsubscribe(원클릭, RFC 8058) — 정보통신망법 §50 · Gmail/Yahoo 대량발송 요건.
 *   · 투자 권유가 아니라는 고지. 보낸 곳(FlowVium)·전체 보고서 링크.
 *   · 수신자는 status==='active' 인 사람만. 이미 보낸 날엔 다시 안 보낸다.
 *   · 보고서 검증이 실패했거나(라이브 재검 미확인) 다른 날 보고서면 보내지 않는다 — 메일은 되돌릴 수 없다.
 */
import { buildMorningMail, recipientsFor, mailBlockReason } from './report-mail.mjs';
let fail = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const report = {
  session: 'morning', locale: 'ko', generatedAt: '2026-09-29T20:34:54Z', stance: 'bullish', riskLevel: 'medium',
  thesis: '미국과 한국 모두 고금리·고유가 부담. 외국인이 2조 4,614억원 순매도했다. 세 번째 문장.',
  marketNarrative: { watch: '초장기 국채 금리 급등이 반도체로 번지는지', why: 'x' },
  marketVerdict: { verdict: 'neutral' },
  portfolio: [
    { ticker: 'LRCX', name: 'Lam Research Corporation', action: 'buy', entryZone: '$310-$320', target: '$390', stopLoss: '$289' },
    { ticker: 'WAT', name: 'Waters <script>', action: 'watch', entryZone: '$300-$310', target: '$360', stopLoss: '$280' },
  ],
  riskEvents: [{ date: '2026-10-29', event: '미국 FOMC 금리 결정', impact: 'high' }],
};
const m = buildMorningMail(report, { reportUrl: 'https://flowvium.net/ko/report', unsubUrl: 'https://flowvium.net/ko/mail?a=unsubscribe&t=TOK', oneClickUrl: 'https://flowvium.net/api/mail/unsubscribe?t=TOK' });
(/9월 30일/.test(m.subject) && /아침/.test(m.subject)) ? ok(`[1] 제목 "${m.subject}"`) : bad(`[1] ${m.subject}`);
(m.html.includes('LRCX') && m.html.includes('$390') && m.html.includes('$289') && m.html.includes('초장기 국채')) ? ok('[2] 종목·목표·손절·지켜볼 것이 본문에') : bad('[2]');
(m.html.includes('a=unsubscribe&amp;t=TOK') && /수신거부/.test(m.html) && /수신거부/.test(m.text)) ? ok('[3] html·text 모두 수신거부 링크') : bad('[3]');
(m.headers['List-Unsubscribe'] === '<https://flowvium.net/api/mail/unsubscribe?t=TOK>' && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click') ? ok('[4] 원클릭 수신거부 헤더') : bad(`[4] ${JSON.stringify(m.headers)}`);
(/투자 권유가 아닙니다/.test(m.html) && /투자 권유가 아닙니다/.test(m.text)) ? ok('[5] 투자 권유 아님 고지') : bad('[5]');
(!m.html.includes('<script>') && m.html.includes('&lt;script&gt;')) ? ok('[6] 보고서 글자는 이스케이프') : bad('[6] 이스케이프 안 됨');
// [7] 수신자: active 만, 오늘 이미 보낸 사람 제외
{
  const subs = [{ email: 'a@x.com', status: 'active', token: 't1' }, { email: 'b@x.com', status: 'pending', token: 't2' },
    { email: 'c@x.com', status: 'unsubscribed', token: 't3' }, { email: 'd@x.com', status: 'active', token: 't4' }, { email: 'e@x.com', status: 'active' }];
  const r = recipientsFor(subs, new Set(['d@x.com'])).map((s) => s.email);
  (r.length === 1 && r[0] === 'a@x.com') ? ok('[7] active·미발송·토큰 있는 사람만 (a)') : bad(`[7] ${r}`);
}
// [8] 보내지 말아야 할 때
{
  const today = '2026-09-30';
  const good = mailBlockReason({ report, kstDate: today, recheck: { reportFile: 'x/report-2026-09-30-morning-ko.json', liveConfirmed: true }, file: 'x/report-2026-09-30-morning-ko.json' });
  const wrongDay = mailBlockReason({ report, kstDate: '2026-10-01', recheck: { reportFile: 'x/report-2026-09-30-morning-ko.json', liveConfirmed: true }, file: 'x/report-2026-09-30-morning-ko.json' });
  const notLive = mailBlockReason({ report, kstDate: today, recheck: { reportFile: 'x/report-2026-09-30-morning-ko.json', liveConfirmed: false }, file: 'x/report-2026-09-30-morning-ko.json' });
  const otherRecheck = mailBlockReason({ report, kstDate: today, recheck: { reportFile: 'x/report-2026-09-29-evening-ko.json', liveConfirmed: true }, file: 'x/report-2026-09-30-morning-ko.json' });
  const notMorning = mailBlockReason({ report: { ...report, session: 'noon' }, kstDate: today, recheck: { reportFile: 'x/report-2026-09-30-morning-ko.json', liveConfirmed: true }, file: 'x/report-2026-09-30-morning-ko.json' });
  const empty = mailBlockReason({ report: { ...report, portfolio: [], thesis: '' }, kstDate: today, recheck: { reportFile: 'x/report-2026-09-30-morning-ko.json', liveConfirmed: true }, file: 'x/report-2026-09-30-morning-ko.json' });
  (good === null && wrongDay && notLive && otherRecheck && notMorning && empty)
    ? ok(`[8] 막음: 다른 날 · 라이브 미확인 · 다른 보고서 재검 · 아침 아님 · 빈 보고서 (${[wrongDay, notLive, otherRecheck, notMorning, empty].map((x) => x.slice(0, 14)).join(' / ')})`)
    : bad(`[8] ${JSON.stringify([good, wrongDay, notLive, otherRecheck, notMorning, empty])}`);
}
// [9] 눈검증(9/30 미리보기)에서 잡은 것: 요지가 "KOSPI 6,871(-0." 에서 잘렸다(소수점을 문장 끝으로 봄) · 일정이 날짜순이 아니었다
{
  const r2 = { ...report, generatedAt: '2026-09-29T20:34:54Z', thesis: '외국인이 순매도하며 KOSPI 6,871(-0.3%)선으로 눌렀다. 미국은 5.26%다. 셋째.',
    riskEvents: [{ date: '2026-10-29', event: 'FOMC' }, { date: '2026-10-02', event: '고용' }, { date: '2026-09-01', event: '지난 일' }, { date: '2026-10-13', event: 'CPI' }] };
  const m2 = buildMorningMail(r2, { reportUrl: 'u', unsubUrl: 'v', oneClickUrl: 'w' });
  (m2.text.includes('KOSPI 6,871(-0.3%)선으로 눌렀다. 미국은 5.26%다.') && !m2.text.includes('셋째')) ? ok('[9] 요지 두 문장 — 소수점에서 안 자른다') : bad(`[9] ${m2.text.split('\n')[3]}`);
  const i1 = m2.text.indexOf('고용'), i2 = m2.text.indexOf('CPI'), i3 = m2.text.indexOf('FOMC');
  (i1 > 0 && i1 < i2 && i2 < i3 && !m2.text.includes('지난 일')) ? ok('[9b] 일정은 날짜순, 지난 일정은 뺀다') : bad(`[9b] ${[i1, i2, i3]}`);
}
console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
