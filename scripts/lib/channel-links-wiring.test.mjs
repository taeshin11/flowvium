// 11/26 21:12: 읽기는 offsetParent 로, 쓰기는 Playwright visible 필터로 '보이는 입력' 순번을 따로 셌다.
// 두 순번이 하나 어긋나 제목이 주소 칸에, 주소가 이메일 칸에 들어갔고 Studio 가 '오류가 발생했습니다'로 막았다.
// 쓰기는 읽을 때 표시해 둔 바로 그 칸(data-cl)을 집어야 하고, 게시 뒤 오류 알림을 보면 실패로 끝나야 한다.
import { readFileSync } from 'fs';
import assert from 'assert';
const s = readFileSync('scripts/yt-channel-links.mjs', 'utf8');
let fail = 0;
const t = (name, fn) => { try { fn(); console.log('ok', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
t('쓰기가 따로 센 순번을 안 쓴다', () => assert.ok(!/filter\(\{\s*visible:\s*true\s*\}\)\.nth\(/.test(s)));
t('읽을 때 칸에 표시를 단다', () => assert.ok(/setAttribute\('data-cl'/.test(s)));
t('쓰기는 표시된 칸을 집는다', () => assert.ok(/input\[data-cl="\$\{/.test(s)));
t('게시 전 게시 버튼이 켜졌는지 본다', () => assert.ok(/게시 버튼이 안 켜졌다/.test(s)));
t('게시 뒤 오류 알림을 본다', () => assert.ok(/오류가 발생했습니다/.test(s)));
process.exit(fail ? 1 : 0);
