# FlowVium ?먭??몄뒪???댁쟾 ?곕턿 (Vercel ??RTX 癒몄떊 + Cloudflare Tunnel)

2026-06-02: Vercel Hobby fair-use 李⑤떒(?⑥닔?몄텧 3.6M/?꾩넚 42GB/CPU 18h40m 珥덇낵) ??
?붿껌??怨쇨툑 ?녿뒗 ?곸떆 node ?쒕쾭濡??댁쟾. report-gen(Ollama)???대? ??癒몄떊???덉뼱 co-locate.

**援ъ“**: `next start`(localhost:3000) ??Cloudflare Tunnel ??Cloudflare CDN(臾대즺 罹먯떆) ??flowvium.net
**?щ줎**: vercel.json 26媛???`scripts/cron-runner.mjs`(node-cron, ?숈씪 ?ㅼ?以? UTC).

---

## ???ъ쟾 ?뺤씤 (?대? 異⑹”)
- cloudflared ?ㅼ튂?? `C:\Program Files (x86)\cloudflared\cloudflared.exe`
- `.env.local` ?고?????蹂댁쑀 (Redis/Upstash/Finnhub/Gemini/Groq/DART/FRED)
- node 24, next 14.2.35, node-cron ?ㅼ튂??

## 1. 鍮뚮뱶 + 濡쒖뺄 湲곕룞 (?닿? 以鍮????ㅺ? ?ㅽ뻾)
```powershell
cd C:\Flowvium
npm run build              # prod 鍮뚮뱶 (~?섎텇)
# ???쒕쾭 (李?, ?곸떆)
$env:NODE_ENV="production"; npm run start          # ??http://localhost:3000
# ?щ줎 ?щ꼫 (李?, ?곸떆) ??Vercel UTC ?ㅼ?以?洹몃?濡?
$env:CRON_TZ="Etc/UTC"; node scripts/cron-runner.mjs
```
???먮뒗 `run-selfhost.bat` (???꾨줈?몄뒪 ??踰덉뿉). ?곸떆 ?댁쁺? **pm2** 沅뚯옣:
```powershell
npm i -g pm2
pm2 start "npm run start" --name flowvium-web
pm2 start scripts/cron-runner.mjs --name flowvium-cron --interpreter node -- 
pm2 save ; pm2 startup   # 遺?????먮룞 湲곕룞
```

## 2. Cloudflare Tunnel (?낅꽕媛 ?몄쬆 ??釉뚮씪?곗? ?꾩슂)
```powershell
cd "C:\Program Files (x86)\cloudflared"
cloudflared tunnel login                       # 釉뚮씪?곗? ??CF 怨꾩젙 ?몄쬆 (flowvium.net ?좏깮)
cloudflared tunnel create flowvium             # ?곕꼸 ?앹꽦 ???먭꺽利앸챸 json 寃쎈줈 異쒕젰??
cloudflared tunnel route dns flowvium flowvium.net   # DNS CNAME ?먮룞 ?앹꽦
```
洹???`%USERPROFILE%\.cloudflared\config.yml` ?앹꽦 (?꾨옒 `cloudflared-config.yml` 李멸퀬):
```yaml
tunnel: flowvium
credentials-file: C:\Users\gangd\.cloudflared\<?곕꼸ID>.json
ingress:
  - hostname: flowvium.net
    service: http://localhost:3000
  - service: http_status:404
```
?ㅽ뻾 / ?쒕퉬???깅줉:
```powershell
cloudflared tunnel run flowvium                # ?뚯뒪???ㅽ뻾
cloudflared service install                    # 遺?????먮룞 (?쒕퉬??
```

## 3. Cloudflare ??쒕낫????CDN 罹먯떆 (?낅꽕媛 ?ㅼ젙, 臾대즺)
fair-use ??쬆???듭떖(遊눫룹쟾????CDN???≪닔?섎룄濡?**Cache Rules**:
- **Cache**: `/_next/static/*`, `/`, `/{locale}/*`, `/{locale}/company/*` ??Edge TTL 1h~ (Cache Everything)
- **Bypass**: `/api/cron/*`, `/admin/*`
- **Bot Fight Mode** 耳쒓린 (臾대즺, 遊?李⑤떒) + robots.txt(?대? AI ?ㅽ겕?섑띁 李⑤떒 而ㅻ컠??
???대윭硫?諛섎났/遊??붿껌??origin(node) ??嫄곗튂怨?CF edge?먯꽌 泥섎━ = 癒몄떊 遺??理쒖냼.

## 4. ?꾪솚 + 寃利?
- DNS??step2??`route dns`媛 flowvium.net ???곕꼸濡??먮룞 蹂寃?(Vercel DNS ??뼱?).
- 寃利? `curl https://flowvium.net/api/stock-price/AAPL` ??200 (?댁젣 ?먭??몄뒪??origin).
- 蹂닿퀬???щ줎: cron-runner 濡쒓렇 ?뺤씤 + `npm run verify` (濡쒖뺄).

## 5. Vercel ?뺣━ (?좏깮)
- 李⑤떒 臾닿??댁쭚. Vercel ?꾨줈?앺듃??**??젣 or 諛⑹튂**. (DNS??CF濡??섏뼱媛?
- `vercel.json` crons ??cron-runner 媛 ?쎈뒗 ?뚯뒪濡?怨꾩냽 ?ъ슜 (??젣 湲덉?).

## ?몃젅?대뱶?ㅽ봽 / 二쇱쓽
- 吏??꾩썝쨌?ㅽ듃?뚰겕 ?딄린硫??ㅼ슫 ??CF CDN 罹먯떆媛 ?뺤쟻/罹먯떆 ?섏씠吏??怨꾩냽 ?쒕튃(?꾩땐). 以묒슂?섎㈃ ?뚰삎 VPS ?대갚.
- 癒몄떊? report-gen cron ?쇰줈 ?댁감???곸떆 耳쒖쭚 ???꾩떎??
- 紐⑤땲?? `check-stall.mjs`(濡쒖뺄) + 李⑤떒 ?댁젣 ??`check-data-quality.mjs`(?댁젣 ?먭? origin ?묒씠??怨쇨툑 ?놁쓬 ???ш컻 媛??.

## 誘퇼ush 而ㅻ컠 (?댁쟾 臾닿??섍쾶 git 蹂닿?)
- 245cb96 cron ?덇컧 / 1c9dff7 robots / + ?대쾲 cron-runner쨌?곕턿.
  ?먭??몄뒪?낆뿏 Vercel 諛고룷 遺덊븘????git push??GitHub 諛깆뾽 ?⑸룄濡쒕쭔.
