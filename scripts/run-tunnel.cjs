// cloudflared 터널 실행 래퍼 — .cf-tunnel-token(gitignore) 읽어 토큰으로 구동.
// pm2 가 이 스크립트를 관리 (autorestart). 토큰을 코드/설정에 안 박음.
const { spawn } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

// 2026-06-15: cloudflared 위치 후보 — MSI 설치 경로 → portable(C:\Flowvium) → env override.
const CLOUDFLARED = [
  process.env.CLOUDFLARED_PATH,
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Flowvium\\cloudflared.exe',
].find((p) => p && existsSync(p)) || 'cloudflared';
const token = readFileSync(resolve(__dirname, '..', '.cf-tunnel-token'), 'utf8').trim();
if (!token) { console.error('[run-tunnel] .cf-tunnel-token 비어있음'); process.exit(1); }

const child = spawn(CLOUDFLARED, ['tunnel', 'run', '--token', token], { stdio: 'inherit' });
child.on('exit', (code) => { console.error(`[run-tunnel] cloudflared exit ${code}`); process.exit(code ?? 1); });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
