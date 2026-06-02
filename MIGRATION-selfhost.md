# FlowVium 자가호스팅 이전 런북 (Vercel → RTX 머신 + Cloudflare Tunnel)

2026-06-02: Vercel Hobby fair-use 차단(함수호출 3.6M/전송 42GB/CPU 18h40m 초과) →
요청당 과금 없는 상시 node 서버로 이전. report-gen(Ollama)이 이미 이 머신에 있어 co-locate.

**구조**: `next start`(localhost:3000) ← Cloudflare Tunnel ← Cloudflare CDN(무료 캐시) ← flowvium.net
**크론**: vercel.json 26개 → `scripts/cron-runner.mjs`(node-cron, 동일 스케줄, UTC).

---

## ✅ 사전 확인 (이미 충족)
- cloudflared 설치됨: `C:\Program Files (x86)\cloudflared\cloudflared.exe`
- `.env.local` 런타임 키 보유 (Redis/Upstash/Finnhub/Gemini/Groq/DART/FRED)
- node 24, next 14.2.35, node-cron 설치됨

## 1. 빌드 + 로컬 기동 (내가 준비 — 네가 실행)
```powershell
cd C:\NoAddsMakingApps\FlowVium
npm run build              # prod 빌드 (~수분)
# 웹 서버 (창1, 상시)
$env:NODE_ENV="production"; npm run start          # → http://localhost:3000
# 크론 러너 (창2, 상시) — Vercel UTC 스케줄 그대로
$env:CRON_TZ="Etc/UTC"; node scripts/cron-runner.mjs
```
→ 또는 `run-selfhost.bat` (두 프로세스 한 번에). 상시 운영은 **pm2** 권장:
```powershell
npm i -g pm2
pm2 start "npm run start" --name flowvium-web
pm2 start scripts/cron-runner.mjs --name flowvium-cron --interpreter node -- 
pm2 save ; pm2 startup   # 부팅 시 자동 기동
```

## 2. Cloudflare Tunnel (★네가 인증 — 브라우저 필요)
```powershell
cd "C:\Program Files (x86)\cloudflared"
cloudflared tunnel login                       # 브라우저 → CF 계정 인증 (flowvium.net 선택)
cloudflared tunnel create flowvium             # 터널 생성 → 자격증명 json 경로 출력됨
cloudflared tunnel route dns flowvium flowvium.net   # DNS CNAME 자동 생성
```
그 후 `%USERPROFILE%\.cloudflared\config.yml` 생성 (아래 `cloudflared-config.yml` 참고):
```yaml
tunnel: flowvium
credentials-file: C:\Users\gangd\.cloudflared\<터널ID>.json
ingress:
  - hostname: flowvium.net
    service: http://localhost:3000
  - service: http_status:404
```
실행 / 서비스 등록:
```powershell
cloudflared tunnel run flowvium                # 테스트 실행
cloudflared service install                    # 부팅 시 자동 (서비스)
```

## 3. Cloudflare 대시보드 — CDN 캐시 (★네가 설정, 무료)
fair-use 폭증의 핵심(봇·전송)을 CDN이 흡수하도록 **Cache Rules**:
- **Cache**: `/_next/static/*`, `/`, `/{locale}/*`, `/{locale}/company/*` → Edge TTL 1h~ (Cache Everything)
- **Bypass**: `/api/cron/*`, `/admin/*`
- **Bot Fight Mode** 켜기 (무료, 봇 차단) + robots.txt(이미 AI 스크래퍼 차단 커밋됨)
→ 이러면 반복/봇 요청이 origin(node) 안 거치고 CF edge에서 처리 = 머신 부하 최소.

## 4. 전환 + 검증
- DNS는 step2의 `route dns`가 flowvium.net → 터널로 자동 변경 (Vercel DNS 덮어씀).
- 검증: `curl https://flowvium.net/api/stock-price/AAPL` → 200 (이제 자가호스팅 origin).
- 보고서/크론: cron-runner 로그 확인 + `npm run verify` (로컬).

## 5. Vercel 정리 (선택)
- 차단 무관해짐. Vercel 프로젝트는 **삭제 or 방치**. (DNS는 CF로 넘어감)
- `vercel.json` crons 는 cron-runner 가 읽는 소스로 계속 사용 (삭제 금지).

## 트레이드오프 / 주의
- 집 전원·네트워크 끊기면 다운 → CF CDN 캐시가 정적/캐시 페이지는 계속 서빙(완충). 중요하면 소형 VPS 폴백.
- 머신은 report-gen cron 으로 어차피 상시 켜짐 → 현실적.
- 모니터: `check-stall.mjs`(로컬) + 차단 해제 후 `check-data-quality.mjs`(이제 자가 origin 핑이라 과금 없음 — 재개 가능).

## 미push 커밋 (이전 무관하게 git 보관)
- 245cb96 cron 절감 / 1c9dff7 robots / + 이번 cron-runner·런북.
  자가호스팅엔 Vercel 배포 불필요 — git push는 GitHub 백업 용도로만.
