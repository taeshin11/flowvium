// attributePctSubjects 오주석 — 11/26 오후~11/27: 물가 4.08%·성장률 4.1% 에 "(XLRE·달러 기준)" 이 붙었다.
//   원인 ① 거시 문맥 단어가 영어(CPI)뿐 — '물가'·'성장률' 을 못 봤다.
//         ② 문장 경계를 '.' 로 찾아 앞 숫자의 소수점(0.6%·3.25%)에서 창이 잘렸다.
import assert from 'node:assert/strict';
import { attributePctSubjects } from './narrative-fix.mjs';
const pool = [{ ticker: 'XLRE', label: 'Real Estate', values: [4.08, 4.1] }, { ticker: 'EWY', label: 'Korea', values: [-12.13] }];
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('ok ', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); } };
const run = (thesis) => { const r = { thesis, macroAnalysis: '' }; attributePctSubjects(r, pool); return r.thesis; };
t('[1] 11/27 아침: 소비자물가 4.08% 에 주석 없음', () => assert.equal(run('장중인 미국 증시는 소비자물가 4.08%의 고물가로 눌렸다.'), '장중인 미국 증시는 소비자물가 4.08%의 고물가로 눌렸다.'));
const s2 = '미국 증시는 전일 S&P500이 0.3%, 나스닥이 0.6% 내렸는데, 물가 4.08%·엔비디아 3.9% 하락이 겹쳤다.';
t('[2] 11/26 오후: 앞 소수점에 창이 잘려도 물가 4.08% 무주석', () => assert.ok(!run(s2).includes('XLRE')));
const s3 = '한국은행이 기준금리를 3.25%로 올리고 내년 성장률을 4.1%로 높인 가운데 원화가 약했다.';
t('[3] 11/27 낮: 성장률 4.1% 무주석', () => assert.ok(!run(s3).includes('XLRE')));
t('[4] 원래 일(EWY 무주어 급락)은 그대로 주석', () => assert.ok(run('외국인 자금이 빠지며 1주 -12.13% 밀렸다.').includes('(미국 상장 한국주식 ETF EWY·달러 기준)')));
t('[5] 앞 문장 마침표 뒤 새 문장은 앞 문장 단어를 보지 않는다', () => assert.ok(run('물가는 안정됐다. 외국인 자금이 빠지며 1주 -12.13% 밀렸다.').includes('EWY·달러 기준')));
if (fail) { console.log(`${fail}개 실패`); process.exit(1); } else console.log('모두 통과');
