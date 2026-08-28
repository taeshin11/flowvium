#!/usr/bin/env node
/**
 * media-root.test.mjs — 미디어 저장 위치 결정.
 *
 * 요구(2026-08-28): 영상·사진은 구글드라이브에만 둔다. 로컬 디스크가 부족하다.
 *
 * 여기서 지켜야 할 것은 하나다: **드라이브가 죽었는데 로컬에 조용히 쓰지 않는다.**
 *   조용히 떨어지면 사람은 옮겨졌다고 믿고, 디스크는 다시 찬다.
 */
let fail = 0;
const ok  = m => console.log(`  PASS  ${m}`);
const bad = m => { console.log(`  FAIL  ${m}`); fail++; };
const M = await import('./media-root.mjs');

const okProbe   = () => ({ ok: true, reason: null });
const deadProbe = () => ({ ok: false, reason: 'EINTR Interrupted system call' });

// ── 1. 설정값이 가장 세다 ────────────────────────────────────────────────────
{
  const r = M.resolveMediaRoot({ configured: '/set/here', accounts: ['/drive/acc'], probe: okProbe });
  if (r.root === '/set/here' && r.where === 'configured') ok('MEDIA_ROOT 이 드라이브보다 우선');
  else bad(`설정값을 안 썼다 (got ${r.root} / ${r.where})`);
}

// ── 2. 설정이 없으면 드라이브 ────────────────────────────────────────────────
{
  const r = M.resolveMediaRoot({ accounts: ['/drive/acc'], probe: okProbe });
  if (r.where === 'drive' && r.root.includes(M.MEDIA_DIRNAME)) ok(`드라이브로 간다 (${r.root})`);
  else bad(`드라이브로 안 갔다 (got ${r.root} / ${r.where})`);
}

// ── 3. 드라이브가 죽었고 로컬 허용이 없으면 **던진다** ───────────────────────
//   이게 이 파일의 핵심이다. 실측(2026-08-28): 마운트는 남아 있는데 ls 가 EINTR 로 튕겼다.
{
  let threw = null;
  try { M.resolveMediaRoot({ accounts: ['/drive/acc'], probe: deadProbe, localFallback: '/tmp/x' }); }
  catch (e) { threw = e; }
  if (!threw) bad('드라이브가 죽었는데 조용히 통과했다 — 로컬에 쌓이고 사람은 모른다');
  else if (/Google Drive/.test(threw.message) && /MEDIA_ROOT/.test(threw.message)
        && /EINTR/.test(threw.message)) ok('죽으면 던지고, 관측값·다음 행동을 같이 낸다');
  else bad(`던지긴 했는데 안내가 부족하다:\n${threw.message}`);
}

// ── 4. 명시적으로 허용했을 때만 로컬 ─────────────────────────────────────────
{
  const probe = (d) => (d === '/local/fallback' ? okProbe() : deadProbe());
  const r = M.resolveMediaRoot({ accounts: ['/drive/acc'], probe, localFallback: '/local/fallback', allowLocal: true });
  if (r.where === 'local') ok('허용했을 때만 로컬로 떨어진다');
  else bad(`로컬 폴백이 안 걸렸다 (got ${r.where})`);
}

// ── 5. 쓰기 검사는 **실제로 써 본다** ────────────────────────────────────────
//   존재 여부만 보면 죽은 마운트를 살아 있다고 읽는다.
{
  const calls = [];
  const r = M.probeWritable('/some/dir', {
    mkdir: (d, o) => calls.push(['mkdir', d, o?.recursive === true]),
    write: (f) => calls.push(['write', f]),
    rm: (f) => calls.push(['rm', f]),
  });
  const kinds = calls.map((c) => c[0]).join(',');
  if (r.ok && kinds === 'mkdir,write,rm') ok('쓰기 검사가 mkdir→write→rm 을 실제로 한다');
  else bad(`쓰기 검사 동작이 다르다 (ok=${r.ok}, ${kinds})`);

  const dead = M.probeWritable('/dead', { mkdir: () => { const e = new Error('Interrupted system call'); e.code = 'EINTR'; throw e; } });
  if (!dead.ok && /EINTR/.test(dead.reason)) ok(`쓰기 실패 사유를 그대로 전한다 (${dead.reason})`);
  else bad(`실패 사유가 비었다 (${JSON.stringify(dead)})`);
}

// ── 6. 한국어·영어 드라이브 UI 둘 다 ─────────────────────────────────────────
{
  const seen = [];
  const probe = (d) => { seen.push(d); return d.includes('My Drive') ? okProbe() : deadProbe(); };
  const r = M.resolveMediaRoot({ accounts: ['/acc'], probe });
  if (r.root.includes('My Drive') && seen.some((d) => d.includes('내 드라이브')))
    ok('"내 드라이브"·"My Drive" 둘 다 본다');
  else bad(`한쪽만 봤다 — ${JSON.stringify(seen)}`);
}

console.log(fail ? `\n  ${fail}개 실패` : '\n✅ media-root 전부 통과');
process.exit(fail ? 1 : 0);
