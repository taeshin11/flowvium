/**
 * report-mail.mjs — 아침보고서를 메일 한 통으로 옮긴다(순수). 근거·못박은 것은 report-mail.test.mjs 머리말.
 *   보고서의 사실 필드만 옮긴다 — 새 문장을 짓지 않는다. 자세한 내용은 사이트로 보낸다.
 */
import { deliverable } from './mail-store.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const STANCE = { bullish: '강세', bearish: '약세', neutral: '중립' };
const ACTION = { buy: '매수', watch: '관찰', hold: '보유', sell: '매도', add: '추가매수', trim: '일부매도' };
// 문장 끝 = 마침표 뒤에 공백·끝이 오는 자리. "6,871(-0.3%)" 의 소수점에서 자르지 않는다(9/30 눈검증).
const firstSentences = (t, n = 2) => String(t ?? '').split(/(?<=[.!?。])\s+/).slice(0, n).join(' ').trim();

export function buildMorningMail(report, { reportUrl, unsubUrl, oneClickUrl }) {
  const d = kstDate(report.generatedAt);
  const [, mm, dd] = d.split('-').map(Number);
  const subject = `FlowVium ${mm}월 ${dd}일 아침보고서 — ${STANCE[report.stance] ?? '중립'} · 위험 ${({ low: '낮음', medium: '보통', high: '높음' })[report.riskLevel] ?? '보통'}`;
  const lead = firstSentences(report.thesis, 2);
  const watch = report.marketNarrative?.watch ?? '';
  const rows = (report.portfolio ?? []).slice(0, 8);
  // 날짜순, 발간일 이전 일정은 뺀다(9/30 눈검증: 10-29 가 10-02 앞에 있었다).
  const next = (report.riskEvents ?? []).filter((e) => e?.date && e?.event && String(e.date) >= d)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 3);
  const td = 'padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;white-space:nowrap';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111">
<div style="max-width:600px;margin:0 auto;background:#fff;padding:24px">
<p style="margin:0 0 4px;font-size:12px;color:#7c3aed;font-weight:700">FlowVium 아침보고서 · ${esc(d)}</p>
<h1 style="margin:0 0 16px;font-size:20px">시장 판단: ${esc(STANCE[report.stance] ?? '중립')} · 위험 ${esc(({ low: '낮음', medium: '보통', high: '높음' })[report.riskLevel] ?? '보통')}</h1>
${lead ? `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(lead)}</p>` : ''}
${watch ? `<p style="font-size:14px;line-height:1.6;margin:0 0 16px;padding:10px 12px;background:#f5f3ff;border-radius:8px"><b>오늘 지켜볼 것</b> — ${esc(watch)}</p>` : ''}
${rows.length ? `<h2 style="font-size:15px;margin:16px 0 8px">종목</h2>
<table style="width:100%;border-collapse:collapse"><tr style="background:#fafafa"><th style="${td};text-align:left">종목</th><th style="${td}">의견</th><th style="${td}">진입</th><th style="${td}">목표</th><th style="${td}">손절</th></tr>
${rows.map((p) => `<tr><td style="${td};white-space:normal"><b>${esc(p.ticker)}</b><br><span style="color:#666;font-size:12px">${esc(p.name)}</span></td><td style="${td};text-align:center">${esc(ACTION[p.action] ?? p.action ?? '')}</td><td style="${td};text-align:center">${esc(p.entryZone)}</td><td style="${td};text-align:center">${esc(p.target)}</td><td style="${td};text-align:center">${esc(p.stopLoss)}</td></tr>`).join('\n')}
</table>` : ''}
${next.length ? `<h2 style="font-size:15px;margin:16px 0 8px">다가오는 일정</h2><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${next.map((e) => `<li>${esc(e.date)} · ${esc(e.event)}</li>`).join('')}</ul>` : ''}
<p style="margin:24px 0"><a href="${esc(reportUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">전체 보고서 보기</a></p>
<p style="font-size:11px;color:#888;line-height:1.6;margin:16px 0 0">이 메일은 정보 제공용이며 투자 권유가 아닙니다. 투자 판단과 그 결과의 책임은 본인에게 있습니다.<br>
FlowVium 아침보고서 메일 수신에 동의하셔서 보내 드립니다. 더 받지 않으려면 <a href="${esc(unsubUrl)}" style="color:#888">수신거부</a>를 누르세요.</p>
</div></body></html>`;
  const text = [
    `FlowVium 아침보고서 · ${d}`, `시장 판단: ${STANCE[report.stance] ?? '중립'}`, '', lead, watch ? `오늘 지켜볼 것 — ${watch}` : '', '',
    ...rows.map((p) => `${p.ticker} ${p.name} · ${ACTION[p.action] ?? p.action ?? ''} · 진입 ${p.entryZone ?? '-'} · 목표 ${p.target ?? '-'} · 손절 ${p.stopLoss ?? '-'}`),
    '', ...next.map((e) => `${e.date} · ${e.event}`), '', `전체 보고서: ${reportUrl}`, '',
    '이 메일은 정보 제공용이며 투자 권유가 아닙니다.', `수신거부: ${unsubUrl}`,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  return { subject, html, text, headers: { 'List-Unsubscribe': `<${oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

/** 받을 사람: 동의(active)했고, 토큰이 있고, 오늘 아직 안 받은 사람. */
export function recipientsFor(subs, sentToday = new Set()) {
  return (subs ?? []).filter((s) => s?.status === 'active' && s.token && s.email && deliverable(s.email) && !sentToday.has(s.email));
}

/** 보내면 안 되는 이유. 보내도 되면 null. 메일은 되돌릴 수 없으니 확인된 보고서만 보낸다. */
export function mailBlockReason({ report, file, kstDate: today, recheck }) {
  if (report?.session !== 'morning') return `아침보고서가 아니다(${report?.session})`;
  if (kstDate(report.generatedAt) !== today) return `오늘(${today}) 보고서가 아니다(${kstDate(report.generatedAt)})`;
  if (!(report.portfolio?.length) && !String(report.thesis ?? '').trim()) return '보고서가 비었다(종목·요지 없음)';
  const base = (p) => String(p ?? '').split('/').pop();
  if (!recheck || base(recheck.reportFile) !== base(file)) return '이 보고서의 라이브 재검 기록이 아직 없다';
  if (recheck.liveConfirmed !== true) return '라이브 재검에서 사이트 반영을 확인하지 못했다';
  return null;
}

/** 기존 가입자에게 한 번 보내는 수신 동의 요청(사장님 9/30 선택). 누르지 않으면 아무것도 안 온다. */
export function buildInviteMail({ confirmUrl }) {
  const subject = 'FlowVium 아침보고서를 메일로 받아 보시겠어요?';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:24px">
<p style="font-size:15px;line-height:1.7">FlowVium 에 가입해 주셔서 고맙습니다.<br>매일 아침 발간되는 <b>아침보고서</b>(시장 판단·관심 종목·다가오는 일정)를 메일로 받아 보실 수 있게 되었습니다.</p>
<p style="font-size:15px;line-height:1.7">받아 보시려면 아래 버튼을 눌러 주세요. <b>누르지 않으시면 메일은 가지 않습니다.</b></p>
<p style="margin:24px 0"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">아침보고서 메일 받기</a></p>
<p style="font-size:11px;color:#888;line-height:1.6">이 메일은 FlowVium 가입 이메일로 한 번만 보내 드립니다. 받아 보시다가 언제든 메일 아래의 수신거부로 그만 받으실 수 있습니다.</p>
</div></body></html>`;
  const text = `FlowVium 에 가입해 주셔서 고맙습니다.\n매일 아침보고서를 메일로 받아 보시려면 아래 주소를 열어 확인을 눌러 주세요. 누르지 않으시면 메일은 가지 않습니다.\n${confirmUrl}\n\n이 메일은 한 번만 보내 드립니다.`;
  return { subject, html, text };
}
