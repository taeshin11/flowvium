# ?넊 癒몄떊 ?щ쭩 ???ㅻⅨ 而댄벂???몄닔?멸퀎 runbook (2026-06-12 ?좎꽕)

> 諛곌꼍: 2026-06-07 ?섎뱶 freeze 濡?4???ㅼ슫. ??癒몄떊???ㅼ떆 二쎌쑝硫??꾨옒 ?덉감濡??ㅻⅨ Windows 癒몄떊?먯꽌 ?ш???

## ?ъ쟾 以鍮꾨뤌 ?덈뒗 寃?(??癒몄떊??留ㅼ씪 ?먮룞 ?섑뻾)

1. **肄붾뱶/?ㅼ젙**: ?꾨? GitHub `taeshin11/flowvium` master (紐⑤뱺 fix ??而ㅻ컠+?몄떆 ?섎Т ??CLAUDE.md).
2. **濡쒖뺄 ?곹깭 諛깆뾽**: `G:\???쒕씪?대툕\FlowVium-backup\` ??Task Scheduler `FlowVium-Backup` (留ㅼ씪 04:35, `scripts/backup-takeover.mjs`)
   - `flowvium-{?좎쭨}.db` ??SQLite ?뺥빀 諛깆뾽 (異붿쿇/outcome/hallucination ?숈뒿?대젰, 理쒓렐 7?쇱튂)
   - `secrets/.env.local` + `secrets/.cf-tunnel-token` ??API ??+ Cloudflare ?곕꼸 ?먭꺽
   - `reports/`, `research_history/` 誘몃윭
3. **?ъ씠???쇱씠釉??곹깭**: Upstash Redis(?대씪?곕뱶) ??癒몄떊 二쎌뼱??留덉?留?諛쒓컙 蹂닿퀬?쒕뒗 ?쒕튃 ?좎? (stale ?붾쭔 吏꾪뻾).

## ??癒몄떊 蹂듦뎄 ?덉감 (~30遺?

```powershell
# 0. ?붽뎄?ы빆: Windows + Node 20+ + git + Ollama ?ㅼ튂, Google Drive 濡쒓렇??
# 1. 肄붾뱶
git clone https://github.com/taeshin11/flowvium C:\Flowvium
cd C:\Flowvium; npm install
# 2. 濡쒖뺄 ?곹깭 蹂듭썝 (Google Drive 諛깆뾽?먯꽌)
copy "G:\???쒕씪?대툕\FlowVium-backup\secrets\.env.local" .
copy "G:\???쒕씪?대툕\FlowVium-backup\secrets\.cf-tunnel-token" .
copy "G:\???쒕씪?대툕\FlowVium-backup\flowvium-<理쒖떊?좎쭨>.db" data\flowvium.db
copy "G:\???쒕씪?대툕\FlowVium-backup\company-profiles.json" data\company-profiles.json
robocopy "G:\???쒕씪?대툕\FlowVium-backup\reports" reports /E
robocopy "G:\???쒕씪?대툕\FlowVium-backup\research_history" research_history /E
# 3. LLM
ollama pull qwen3:8b
ollama pull exaone3.5:7.8b
setx OLLAMA_KV_CACHE_TYPE q8_0
setx OLLAMA_FLASH_ATTENTION 1
# 4. ?쒕퉬??(pm2: web 3000 + cron-runner + cloudflare tunnel)
npm install -g pm2; npm run build
pm2 start npm --name flowvium-web -- start
pm2 start scripts/cron-runner.mjs --name flowvium-cron
pm2 start scripts/run-tunnel.cjs --name flowvium-tunnel   # .cf-tunnel-token ?ъ슜 ??DNS 蹂寃?遺덊븘??
pm2 save
# 5. Task Scheduler ?깅줉 (蹂닿퀬??5????+ 諛깆뾽) ???쒓컖: 06:40/11:40/15:40/21:10/23:40 KST
#    run-report.bat ?몄텧 + StartWhenAvailable=True (HANDOFF ?섎떒 11??李몄“, ?먮뒗 ?꾨옒 ??以꾩뵫)
#    schtasks /create /tn FlowVium-Morning /tr C:\Flowvium\scripts\run-report.bat /sc daily /st 06:40
#    (Noon 11:40 / Afternoon 15:40 / Evening 21:10 / Midnight 23:40 ?숈씪 ?⑦꽩 + StartWhenAvailable ?쒖꽦??
# 6. 寃利?
npm run verify
node scripts/check-uncommitted-risk.mjs
```

二쇱쓽: ?댁쟾 癒몄떊???댁븘?덈뒗 梨꾨줈 ??癒몄떊???꾩슦硫?**?곕꼸/cron ?댁쨷 媛??* ??諛섎뱶???쒖そ留?

## ??癒몄떊??Claude Code ?먭쾶 以??멸퀎 ?꾨＼?꾪듃 (蹂듬텤??

> ???대줈?쒕뒗 ?댁쟾 癒몄떊 ?대줈?쒖쓽 硫붾え由???붽? ?녿떎. ??μ냼 臾몄꽌媛 ?좎씪??而⑦뀓?ㅽ듃 ???꾨옒瑜?洹몃?濡?遺숈뿬?ｊ린:

```
FlowVium ?먭??몄뒪???쒕쾭 癒몄떊??二쎌뼱????而댄벂?곕줈 ?몄닔?쒕떎. ?덈뒗 ?댁쟾 癒몄떊???대줈??硫붾え由ш? ?놁쑝??
??μ냼 臾몄꽌濡?而⑦뀓?ㅽ듃瑜?蹂듭썝?대씪. ?쒖꽌:

1. CLAUDE.md (?꾨줈?앺듃 洹쒖튃 ???뱁엳 "而ㅻ컠+?몄떆 ?섎Т", "verify ?섎Т", "?뺤쟻 ?대갚 湲덉?") ?숈?.
2. HANDOFF.md 理쒖긽??"?몄닔?멸퀎 runbook" 洹몃?濡??ㅽ뻾???쒕퉬??蹂듦뎄
   (諛깆뾽: G:\???쒕씪?대툕\FlowVium-backup ??理쒖떊 flowvium-*.db, secrets/.env.local, .cf-tunnel-token).
   ?좑툘 援?癒몄떊???뱀떆 ?댁븘?덉쑝硫??곕꼸/cron ?댁쨷媛??湲덉? ??癒쇱? 援?癒몄떊 pm2/Task Scheduler ?뺤? ?뺤씤.
3. research_history/ 瑜??좎쭨 ??닚?쇰줈 理쒓렐 5媛??쎄퀬 留덉?留??묒뾽 ?곹깭 ?뚯븙
   (?뱁엳 2026-06-12_crash-detection-overhaul-and-takeover.txt = 留덉?留??몄뀡 湲곕줉).
4. 蹂듦뎄 ?꾨즺 湲곗? (happy-path 留뚯쑝濡?遺덉셿猷?:
   - npm run verify ?먯꽌 fail 0
   - node scripts/check-uncommitted-risk.mjs OK
   - 蹂닿퀬??1???섎룞 諛쒓컙 ?깃났 (scripts/run-report.bat) + flowvium.net/ko/report ??fresh 諛섏쁺
   - Task Scheduler 5媛?蹂닿퀬?? + FlowVium-Backup ?깅줉 + StartWhenAvailable=True ?뺤씤
5. 蹂듦뎄 ??research_history/{?좎쭨}_takeover-recovery.txt ???몄닔 湲곕줉 ?④린怨?而ㅻ컠+?몄떆.

?섍꼍 ?붿빟: RTX GPU + Ollama qwen3:8b(蹂닿퀬??/exaone3.5(踰덉뿭), pm2(web 3000/cron-runner/tunnel),
Task Scheduler 媛 run-report.bat 瑜??섎（ 5??06:40/11:40/15:40/21:10/23:40 KST) ?ㅽ뻾.
GPU ?⑥씪 ?먯썝 ??蹂닿퀬??lock(logs/report-pipeline.lock) 以?臾닿굅??LLM ?묒뾽 湲덉?.
cloud LLM ?대갚? GROQ ??臾댄슚(401) ?곹깭??濡쒖뺄 Ollama 媛 ?좎씪??LLM ??Ollama ?ъ뒪 理쒖슦??
```

---

# ?뱥 FlowVium ?멸퀎????2026-05-31 21:30 KST

> **?ㅼ쓬 ?몄뀡??泥섏쓬 ?쎈뒗?ㅻ뒗 媛??*?쇰줈 ?묒꽦. 肄붾뱶 ?꾩튂 + ?섎룄 + ?쒕룄??寃?+ 留됲삍????紐⑤몢 湲곕줉.
> ?곸꽭 commit-by-commit: `research_history/2026-05-31_session-handoff.txt`

---

## 0. ?꾨줈?앺듃 媛쒖슂 (30珥?

**FlowVium** ??Windows 濡쒖뺄 LLM (qwen3:8b via Ollama) ?쇰줈 留ㅼ씪 3??(07:00 / 15:50 / 21:20 KST) 二쇱떇 留ㅼ닔/留ㅻ룄 異붿쿇 蹂닿퀬???앹꽦 + flowvium.net ?먮룞 寃뚯떆.

- **?곗씠??source**: SEC EDGAR / Yahoo Finance / Stooq / FRED / DART / Naver finance / CNN F&G / SEIBRO / Investing.com RSS
- **DB**: `data/flowvium.db` (better-sqlite3 WAL) ??recommendations / sell_recommendations / buy_candidates / hallucination_history / news_archive ??~20 ?뚯씠釉?
- **deploy**: Vercel (Next.js 14 App Router), domain flowvium.net
- **i18n**: 16 ?몄뼱 (ko/en/ja/zh-CN/...)
- **?ъ슜??*: Daehan (taeshin11@gmail.com) ??Korean, 留ㅼ씪 cron 寃곌낵 紐⑤땲?곕쭅, 源먭퉸??硫뷀? 鍮꾪뙋媛

---

## 1. ?쒖뒪???먮쫫 (?꾩껜 洹몃┝)

```
?뚢? Windows Task Scheduler (KST 07:00 / 15:50 / 21:20)
??
?붴???scripts/run-report.bat
      ??
      ?쒋? git fetch + checkout origin/master -- scripts/ src/ ... (cron lag 諛⑹?)
      ?쒋? audit-data-sources (Stooq/Yahoo/SEC/FRED/CNN ?ъ뒪)
      ?쒋? ollama qwen3:8b ?ъ뒪
      ?붴???scripts/generate-report-local.mjs --auto-upload
            ??
            ?쒋? [0/7] /api/cron/update-all (16 API 媛깆떊)
            ?쒋? [1/7] gatherContext (16 API 蹂묐젹 fetch)
            ?쒋? [1.5/7] buildBuyCandidates 4-stage scoring (1,210 ??top 30)
            ?쒋? [2/7] Wave1 LLM 5 蹂묐젹 (portfolio/macro/regional/opportunity/narrative)
            ??    ??F19/F22/F26 anti-pattern + sessionFocus prompt inject
            ?쒋? portfolio retry 0-2 (US/KR 12 誘몃떖 ??
            ?쒋? [3/7] postProcessPortfolio (4以??덉쟾留?
            ??    ??candidate-tickers meta override (sector/name ?섍컖 李⑤떒)
            ??    ??livePrices null ?꾪꽣
            ??    ??validateEntryZones cutoff 짹15%
            ??    ??ENTRY_CALIBRATION ?묒そ ?섍컖 catch
            ??    ??KR cap 6 媛뺤젣
            ?쒋? [4/7] Wave2 LLM (risk/companyChanges/stockDetail/sellRationale)
            ?쒋? [5/7] F23 fact-check (catalysts/fundamentalBasis ?ъ깮??
            ?쒋? [5.5/7] hallucination strip + dedupCrossTickerCatalysts + final-cap
            ?쒋? [6/7] reports/report-{date}-{session}-ko.json ???
            ?쒋? [DB] saveReport / saveRecommendations / saveSellRecommendations / saveBuyCandidates
            ?쒋? [DB] saveNewsArchive / saveMacroSnapshot / saveDomainArchives / saveFearGreedArchive
            ?쒋? snapshotAllEndpoints (24 + portfolio ticker financials)
            ?쒋? [verify-loop] verifyReport(file, silent) ??saveHallucinationHistory
            ??    ??reports/verify/verify-{ts}.json ?먮룞 ???
            ?쒋? [7/7] ?덉쭏 寃뚯씠??+ Redis upload (flowvium:investment-strategy:v8:...)
            ?붴? exit 0
```

---

## 2. ?듭떖 ?깃낵 (5/29 ~ 5/31)

### Karpathy ?숈뒿 怨≪꽑 (8 cycles ?뺣웾 ?낆쬆)

```
Cycle              寃고븿  二쇱슂 蹂??
5/29 morning       13嫄? ??baseline (F26 ?좎꽕)
5/30 afternoon      6嫄? -54%  (sector_mismatch 7??)
5/30 evening        5嫄? -62%
5/30 morning        5嫄?
5/31 morning        6嫄?
5/31 afternoon      2嫄? -85%  ??ohlcv-split fix 泥??곸슜
5/31 evening        3嫄? -77%  ???덉젙 ?좎? (52w/ma 0嫄?
```

### Defect type 蹂??숈뒿 ?④낵

| Type | 5/29 m | 5/31 e | 吏꾨떒 |
|---|---|---|---|
| `sector_mismatch` | 7 | 1 (case only) | ??**F26 prompt inject 100% ?숈뒿** |
| `52w_halluc` | 3 | 0 | ??ohlcv-split guard (data source fix) |
| `ma_halluc` | 1 | 0 | ???숈씪 |
| `sector_keyword_mismatch` | 0 | 1 | ?좑툘 F23 fact-check 媛뺥솕 ?꾩슂 |
| `fact_check_incomplete` | 0 | 1 | ?좑툘 F23 紐⑤뱺 醫낅ぉ ?곸슜 ?꾩슂 |

??**LLM-level ?섍컖 = F26 prompt inject ?④낵 100%**
??**Data source ?섍컖 = 肄붾뱶 fix 留?媛??* (prompt inject 臾댁슜)

---

## 3. ?쒖뒪??蹂寃?(5/29 ~ 5/31 commit ?쒓컙??

| commit | 蹂寃?| ?섎룄 / 寃곌낵 |
|---|---|---|
| `51a3693` | 4以??덉쟾留?+ Probe [7][8] | LLM portfolio ?섍컖 李⑤떒 (sector/52二?MA/ticker) |
| `9d4e921` | cleanup ?섍컖 5 row | ?곸옱??056100~130 + NVDA $288 retroactive ?쒓굅 |
| `67beebd` | KR sector + ?뚯궗紐?+ ?몃옓?덉퐫???쒓굅 | candidate-tickers meta 媛뺤젣 override |
| `7f1a984` | DB NULL 3 fix | quality_score / news pub_date / earnings op_margin |
| `142f5fe` | ohlcv-split guard | Yahoo OHLCV ratio >3x reject (52w/ma ?섍컖 source) |
| `a0c7eea` | **Karpathy 留덉?留?3?④퀎** | hallucination_history + F26 inject + Probe [9] |
| `ec7213c` | KR ?댁뒪 踰덉뿭 cron 6h + identity detect | ?곸뼱 ?댁뒪 踰덉뿭 ?????ш굔 fix |
| `8756ed4` | /company 404 + 11 endpoint audit | dimension sparse ?ш굔 (?ъ슜??鍮꾪뙋) |
| `24f09f7` | KR Naver finance scraping | KR company-news unavailable fix (Vercel 李⑤떒 ?섏떖 ??寃利??꾩슂) |
| `d039155` | 616/137+ ??{count} dynamic | 醫낅ぉ??hardcoded i18n |
| `852c2fe` | **npm run verify** (verify-all.mjs) | 6 寃利??듯빀 entry |
| `668ba09` | silent false pass 李⑤떒 + 蹂묐젹 spawn | 寃利??먯껜???섍컖 李⑤떒 |
| `a7e69c6` | GitHub Actions + dimension 留ㅽ듃由?뒪 ?먮룞 | CI ?먮룞??|
| `95df96e` | GitHub Actions CI 紐⑤뱶 | DB schema init + reports dir |
| `0b24333` | pre-push hook + cron ?먮룞 verify | 4以??먮룞???꾩꽦 |
| `2d3996c` | HANDOFF.md (???붾㈃) | ?멸퀎??|

---

## 4. ?먮룞??4以?(紐⑤몢 ?묐룞 ?뺤씤)

### A. git pre-push hook
- **?ㅼ튂**: `npm run setup:hooks` (??踰?
- **?꾩튂**: `scripts/git-hooks/pre-push` ??`.git/hooks/pre-push` 蹂듭궗
- **?숈옉**: push ??`node scripts/verify-all.mjs` ?ㅽ뻾 ??exit 1 ??push 李⑤떒
- **?고쉶**: `git push --no-verify` (湲닿툒 ?쒕쭔)

### B. GitHub Actions
- **?뚯씪**: `.github/workflows/verify.yml`
- **?몃━嫄?*: push/PR/留ㅼ씪 03:00 UTC
- **CI 紐⑤뱶**: `VERIFY_CI=1` env ??audit-coverage / verify-latest-report ??non-critical (CI ?섍꼍 DB 鍮꾩뼱?덉쓬)
- **?꾩옱 ?곹깭**: 泥??ㅽ뻾 ?ㅽ뙣 ??`95df96e` 濡?DB schema init step 異붽? ??**?ㅼ쓬 push ??寃곌낵 ?뺤씤 ?꾩슂**
- **artifact**: verify-output.txt 14??蹂닿?

### C. cron ??verify-loop
- **?꾩튂**: `scripts/generate-report-local.mjs:5861-5891`
- **?숈옉**: 蹂닿퀬??諛쒓컙 ??`verifyReport(filepath, { silent: true })` ??`saveHallucinationHistory` ??`reports/verify/verify-{ts}.json` ?먮룞 ???
- **trail**: `reports/verify/` ?붾젆?좊━ (5/31 ?꾩옱 2 ?뚯씪)
- **?뺤씤**: `ls -t reports/verify/ | head -1 | xargs -I {} cat reports/verify/{}`

### D. Probe [9] severity escalate
- **?꾩튂**: `scripts/audit-coverage.mjs:466-483`
- **3???좑툘 warn** ("異붿꽭 愿李?)
- **5????critical** ("anti-pattern ?숈뒿 ?ㅽ뙣 ??肄붾뱶 fix ?꾩닔")
- **?섎?**: 5??= data source 寃고븿 ?좏샇 (prompt inject 臾댁슜)

---

## 5. Karpathy Closed Loop ?곸꽭

### 5?④퀎 紐⑤몢 肄붾뱶 ?꾩튂

```javascript
// Stage 1: detect
// scripts/verify-report.mjs:35
export function verifyReport(file, { silent = false } = {}) {
  // sector ??meta cross-check
  // sector keyword mismatch (諛섎룄泥?+ "嫄댁꽕" ??
  // 52二?ratio >3x
  // 50MA-200MA gap >50%
  // fact_check_incomplete (technicalBasis/riskNote)
  return { defects, total };
}

// Stage 2: persist
// scripts/lib/db.mjs:930
export function saveHallucinationHistory(reportId, defects) {
  // hallucination_history ?뚯씠釉?(id/ticker/defect_type/llm_value/correct_value/severity/injected_count)
}

// Stage 3: inject (?ㅼ쓬 蹂닿퀬??
// scripts/lib/db.mjs:962
export function getRecentHallucinationsForPromptInject(days=7, maxItems=15) {
  // 理쒓렐 7??(ticker, defect_type, llm_value) 洹몃９ + injected_count ?먮룞 利앷?
}

// scripts/generate-report-local.mjs:4106 (buildPortfolioPrompt)
const halluc = getRecentHallucinationsForPromptInject(7, 15);
antiPatternBlock = `[?좑툘 AVOID ??理쒓렐 7???섍컖 ${halluc.length}嫄? 諛섎났 湲덉?]
  ??000660.KS sector_mismatch: "Construction" ???뺣떟 "Semiconductors"
  ??...
???꾩? 媛숈? ?⑦꽩 異쒕젰 ???꾩쿂由ъ뿉??reject ?? 泥섏쓬遺???뺥솗??媛??ъ슜.`

// Stage 4: learn (LLM 媛 prompt 蹂닿퀬 ?숈뒿)
// ??sector_mismatch 7嫄?(5/29) ??0嫄?(5/31)
// ??100% learning curve ?낆쬆

// Stage 5: track
// scripts/audit-coverage.mjs:Probe [9]
// 3??/ 5??escalate + reports/verify/ trail
```

### hallucination_history ?뚯씠釉?schema

```sql
CREATE TABLE hallucination_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  ticker TEXT,                          -- 寃고븿 ticker (?덉쑝硫?
  defect_type TEXT NOT NULL,            -- sector_mismatch / 52w_halluc / ma_halluc / sector_keyword_mismatch / fact_check_incomplete
  llm_value TEXT,                       -- LLM 媛 異쒕젰???섎せ??媛?
  correct_value TEXT,                   -- meta ?먮뒗 sanity check ???뺣떟
  severity TEXT NOT NULL,               -- low / medium / high
  injected_count INTEGER NOT NULL DEFAULT 0, -- ?ㅼ쓬 prompt ??inject ?잛닔
  details_json TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
```

---

## 6. 寃利??명봽???곸꽭

### `npm run verify` (verify-all.mjs) ???듯빀 entry

```bash
$ npm run verify
?먥븧??Verify-All ??紐⑤뱺 寃利?蹂묐젹 ?ㅽ뻾 ?먥븧??
??6 script 蹂묐젹 ?ㅽ뻾 ?쒖옉...
??6 script ?꾨즺 ??140.0s

???좑툘/??audit-data-sources    (1s)    ?몃? source ?ъ뒪
???좑툘/??audit-coverage        (140s)  DB Probe 10媛?
???좑툘/??audit-company-pages   (74s)   1,210 횞 9 endpoint sample
??     check-static-fallbacks (0.1s) ?뺤쟻 ?대갚 李⑤떒
??     check-cron-cost        (0.1s) Vercel 鍮꾩슜
???좑툘/??verify-latest-report   (0.1s) 理쒖떊 蹂닿퀬??LLM ?섍컖

?먥븧??醫낇빀 ?먥븧??+ 寃곌낵 ??+ dimension 留ㅽ듃由?뒪 + 寃고븿 ?곸꽭 紐낅졊
```

### audit-coverage 10 Probe (`scripts/audit-coverage.mjs`)

| Probe | dimension | ?먮룞 detect |
|---|---|---|
| [1] | 紐⑤뱺 ?뚯씠釉?NULL 鍮꾩쑉 (??0% column) | ??|
| [2] | endpoint manifest (intelligence/signals/volatility/heatmap/news/company) | ??|
| [3] | domain archive ?곸옱??| ??|
| [3a] | S&P 500 / KOSPI / KOSDAQ candidate 而ㅻ쾭 | ??|
| [3b] | endpoint HTTP status 4XX/5XX 遺꾪룷 + body "error":" pattern | ??|
| [3c] | portfolio?봲napshot ?뺥빀 | ??|
| [4] | ?묐떟 drift (stale ?섏떖) | ??|
| [4a] | invalid value range (return_yoy [-100,1000] ?? | ??|
| [5] | buy/sell rule 7 移댄뀒怨좊━ ?移?(31猷?/ 19猷? | ??|
| [6] | buy_candidates ?곸옱 + matched_rules JSON | ??|
| [7] | entryZone gap (mid/price_at_gen) 짹5% 珥덇낵 | ??|
| [8] | KR ticker ? cross-check (?섍컖 6?먮━ 肄붾뱶 catch) | ??|
| [9] | Karpathy ?숈뒿 ?④낵 (諛섎났 ?? ?좑툘 / ?? ?? | ??|
| [10] | company API 源딆씠 sample (12 ticker 횞 4 API) | ??|

### audit-company-pages.mjs ??1,210 醫낅ぉ 횞 9 endpoint

```javascript
const validators = {
  'company-financials': b => b?.revenueUSD > 0,
  'company-kr':         b => b?.annuals?.length > 0,
  'company-news':       b => b?.news?.length > 0,           // ??5/31 fix: ??'news' (?댁쟾 'articles' false positive)
  'company-recs':       b => b?.recs?.length > 0,            // ??5/31 fix: ??'recs'
  'stock-price':        b => typeof b?.price === 'number' && b.price > 0,
  'market-caps':        b => b?.bands && Object.values(b.bands).some(v => v),  // ??5/31 fix: bands[ticker]
  'price-history':      b => b?.points?.length > 0 || b?.history?.length > 0,
  'analyst-target':     b => typeof b?.targetMean === 'number',  // ??5/31 fix: targetMean
  'iv':                 b => typeof b?.iv === 'number' || b?.atmIv30d,
};
```

### dimension cover 留ㅽ듃由?뒪 (verify-all ?먮룞)

```
| dimension                                       | script              | status |
|------------------------------------------------|---------------------|--------|
| ?몃? source ?ъ뒪                                  | audit-data-sources  | ?? |
| DB NULL 而щ읆                                    | audit-coverage      | ?? |
| endpoint manifest                              | audit-coverage      | ?? |
| domain archive ?곸옱??                           | audit-coverage      | ?? |
| HTTP status 4XX/5XX                            | audit-coverage      | ?? |
| portfolio?봲napshot                             | audit-coverage      | ?? |
| buy/sell rule 7移댄뀒怨좊━                          | audit-coverage      | ?? |
| buy_candidates Karpathy source                | audit-coverage      | ?? |
| entryZone gap (NE ?섍컖)                         | audit-coverage      | ?? |
| KR ticker ?                                    | audit-coverage      | ?? |
| Karpathy ?숈뒿 ?④낵 (3???좑툘 / 5????              | audit-coverage      | ?? |
| company API 源딆씠                                | audit-coverage      | ?? |
| 1,210 횞 9 endpoint body                       | audit-company-pages | ?좑툘  |
| LLM ?섍컖 (sector/52w/MA/fact-check)             | verify-report       | ?? |
| ?뺤쟻 ?곗씠???대갚                                   | check-static-fallbacks | ?? |
| Vercel cron 鍮꾩슜                                | check-cron-cost     | ?? |

cover: 2/16 pass (13%)
```

**以묒슂**: audit-coverage 媛 fail ??嫄??щ윭 Probe 以??쇰?媛 ???쇰뒗 ?섎?. 紐⑤뱺 12 Probe 媛 ?듦낵??嫄??꾨떂. ?먯꽭??蹂대젮硫?吏곸젒 ?ㅽ뻾 `node scripts/audit-coverage.mjs`.

---

## 7. ?붿뿬 寃고븿 6媛?(利됱떆 fix 媛?? ?곗꽑?쒖쐞 ??

### #1 sector case mismatch ??5遺?
- **利앹긽**: FISV `"It-software"` / ALNY `"Pharma-biotech"` / GEN `"It-software"` (meta ??lowercase)
- **?먯씤**: `postProcessPortfolio` ??sector override ??case sensitive 鍮꾧탳
- **?꾩튂**: `scripts/generate-report-local.mjs:4575-4595` (CANDIDATE_META ?곸슜)
- **fix**: meta.sector 吏곸젒 ?ъ슜 ????긽 `.toLowerCase()` ?먮뒗 case-insensitive 鍮꾧탳 (?대? ?쇰? ?곸슜?먮뒗??final 寃곌낵 case ?ㅻ쫫 ??meta ?먯껜媛 `it-software` ? `Construction & Engineering` ???ㅼ뼇??
- **?쒕룄??寃?*: 5/30 `[sector-fix]` 濡쒓렇 異붽? ??lowercase 鍮꾧탳???덉?留? sector 媛믪쓣 meta 洹몃?濡??ъ슜 ??meta 媛 mixed case ?대?濡?final sector ??mixed
- **吏꾩쭨 fix**: sector ??standard canonical form (lowercase + hyphen) ???먮뒗 i18n ?쒖떆 layer ?먯꽌 capitalize

### #2 fact_check_incomplete ??30遺?
- **利앹긽**: 000270.KS / MDB / PINS 媛숈? 醫낅ぉ??`technicalBasis` / `riskNote` undefined
- **?먯씤**: F23 fact-check 媛 紐⑤뱺 buy 醫낅ぉ ?곸슜 ????(?쇰? skip)
- **?꾩튂**: `scripts/generate-report-local.mjs:5032` (F23/fact-check 濡쒖쭅)
- **fix**: F23 媛 `dedupedPortfolio` ??紐⑤뱺 buy 醫낅ぉ?????catalysts/fundamentalBasis/technicalBasis/riskNote 紐⑤몢 梨꾩슦?붿? ?뺤씤
- **?쒕룄??寃?*: 11/11 ??12/12 ?곸슜 濡쒓렇 ?덈뒗???쇰? 醫낅ぉ 寃곌낵 still undefined ???묐떟 parse ?ㅽ뙣 媛?μ꽦

### #3 sector keyword mismatch ??1?쒓컙
- **利앹긽**: NAVER (IT Services) rationale ??"嫄댁꽕" ?⑥뼱 / 005380.KS (Automotive) ??"AI" ?⑥뼱
- **?먯씤**: F23 fact-check 媛 sector ??rationale keyword cross-check ????
- **?꾩튂**: `scripts/verify-report.mjs:80-93` (SECTOR_FORBID 留ㅽ븨)
- **fix**: F23 prompt ??sector forbid keyword 紐낆떆 + rationale ?ъ깮????寃利?
- **?쒕룄??寃?*: verify-report ?먯꽌 detect ?섍퀬 hallucination_history ?곸옱. F26 prompt inject ?먯?留?LLM 媛 臾댁떆 (data source 媛 ?꾨땶 LLM 臾댁? ??F22/F23 inject 媛뺥솕 媛??

### #4 BRK.B / TSM company-financials 404 ??1-2?쒓컙
- **利앹긽**: `/api/company-financials/BRK.B` 404, body `{"error":"not-found","ticker":"BRK.B"}` (dot 蹂??????
- **?먯씤**: Next.js dynamic route `[ticker]` ?먯꽌 dot 泥섎━ ???댁쟾 fix `ae04cb7` ?먯꽌 `rawTicker.replace(/\./g, '-')` 異붽??덉?留?production ?묐떟 ?ъ쟾 BRK.B
- **?꾩튂**: `src/app/api/company-financials/[ticker]/route.ts:25-32`
- **?쒕룄??寃?*: 
  - 5/30 commit `ae04cb7` ?먯꽌 `const ticker = rawTicker.replace(/\./g, '-')` 異붽?
  - 吏곸젒 `https://flowvium.net/api/company-financials/BRK-B` ?몄텧 ???뺤긽 ($371B)
  - 洹몃윭??`BRK.B` ?몄텧 ???ъ쟾 404 + `ticker: "BRK.B"` (蹂??臾댁떆??
  - Vercel Age=0 (??肄붾뱶 鍮뚮뱶 ?? ?몃뜲??蹂??????
- **?ㅼ쓬 吏꾨떒 諛⑺뼢**:
  - `params.ticker` 媛 Vercel ?섍꼍?먯꽌 URL-decoded ?섎뒗吏 (`decodeURIComponent`)
  - middleware 媛 dot escape ?섎뒗吏
  - Next.js 14 `[ticker]` 留ㅺ컻蹂?섏쓽 default 泥섎━ (Next.js 14.2.x 蹂寃??뺤씤)
  - `params.ticker` 瑜?紐낆떆??log ??raw 媛??뺤씤

### #5 KR Naver news Vercel 李⑤떒 ?섏떖 ??1-3?쒓컙
- **利앹긽**: `commit 24f09f7` push ??`production /api/company-news?ticker=005930.KS` ?묐떟 ?ъ쟾 `{"news":[],"error":"unavailable"}`
- **?먯씤**: Naver finance HTML scraping ??Vercel ?섍꼍?먯꽌 李⑤떒 (?먮뒗 cron 罹먯떆)
- **?꾩튂**: `src/app/api/company-news/route.ts:80-122` (fetchNaverNews)
- **?쒕룄??寃?*:
  - 5/31 fetchNaverNews ?좎꽕 ??finance.naver.com/item/news_news.naver scraping
  - 濡쒖뺄?먯꽌 吏곸젒 ?몄텧 ??10嫄??쒓? ?댁뒪 ?뺤긽 異붿텧
  - Vercel build (Age=0) ?꾩뿉??production ?묐떟 unavailable
  - Daum 湲덉쑖 API ???쒕룄 ??500 Internal Server Error
- **?ㅼ쓬 吏꾨떒 諛⑺뼢**:
  - Vercel function ?섍꼍?먯꽌 Naver fetch 吏곸젒 ?쒕룄 (debug endpoint 異붽?)
  - User-Agent / Referer / Origin header 異붽?
  - ???source: NAVER Datalab Open API (?몄쬆 ?꾩슂) / ?고빀?댁뒪 RSS / Yahoo finance KR ?ъ씠??(kr.finance.yahoo.com)
  - ?먮뒗 紐낆떆??"KR ?댁뒪 蹂꾨룄 source ?꾩슂" 硫붿떆吏 ?쒖떆 (?깅뒫蹂대떎 ?뺤쭅)

### #6 stock-price / price-history `.KS` 誘몄?????1?쒓컙
- **利앹긽**: `/api/stock-price/005930.KS` ??`{"error":"unavailable"}`. `/api/price-history?ticker=005930.KS` ??`{"ticker":"005930.K","points":[]}` (`.KS` 媛 `.K` 濡??섎┝!)
- **?먯씤**:
  - stock-price: route ??KR 遺꾧린 ?놁쓬 (Yahoo only)
  - price-history: ticker ?몄옄?먯꽌 `.KS` 媛 `.K` 濡?truncate ??dynamic route or Vercel encoding 臾몄젣
- **?꾩튂**: `src/app/api/stock-price/[ticker]/route.ts` / `src/app/api/price-history/route.ts`
- **fix 諛⑺뼢**:
  - stock-price: KR ticker 遺꾧린 異붽? ??Naver finance ?먮뒗 Yahoo v8 吏곸젒 (?꾩옱 livePrices 媛 ?ъ슜?섎뒗 Stooq/Yahoo v8 KR 濡쒖쭅 ?ъ궗??
  - price-history: ticker ?몄옄 泥섎━ ?먭? (encodeURIComponent? Vercel cache?)

---

## 8. ?ъ슜??硫뷀? 鍮꾪뙋 ?⑦꽩 (?щ컻 諛⑹? ??媛??以묒슂)

### 媛숈? root cause: "auto detect dimension sparse"

| 鍮꾪뙋 | dimension 異붽? |
|---|---|
| "??寃利앹씠 ?덈릺怨좎엳?덈땲?" | audit-coverage Probe [10] 異붽? |
| "1,210 醫낅ぉ ???뺥솗???ㅼ뼱媛?덉뼱?" | audit-company-pages ?좎꽕 (routing 200 OK ??body validator) |
| "??怨좎튂怨?寃利앺븷???쇨큵?곸쑝濡? | verify-all.mjs (6 寃利?spawn ?듯빀) |
| "?닿쾶 理쒖꽑?멸??" | silent false pass 李⑤떒 + 蹂묐젹 + 留ㅽ듃由?뒪 媛?쒗솕 |
| "/company/ 404?" | /company index page ?좎꽕 |
| "移댄뙆??鍮좎쭊寃??덉뼱?" | Karpathy closed loop 5?④퀎 (?댁쟾 ?듦퀎 inject 留? |
| "醫낅ぉ???섏뿀?붾뜲 616?" | i18n hardcoded ?レ옄 ??`{count}` dynamic placeholder |

### ?묐? 諛⑸쾿 (?숈뒿)

1. **利됱떆 ?몄젙** ???ъ슜??硫뷀? 鍮꾪뙋? 嫄곗쓽 ??긽 留욎쓬. 蹂紐?X.
2. **dimension 留ㅽ듃由?뒪 ?뺤옣** ??`verify-all.mjs` ??`checks[].dimensions[]` ??cell 異붽?
3. **?먯껜 寃利?* ??fix 肄붾뱶 ?묒꽦 ??grep + curl 濡?吏곸젒 ?뺤씤 (sample 1+ ticker)
4. **?ъ슜??紐낆떆 list** ??N媛???ぉ ?섏뿴 ??checklist + grep self-check (媛寃?湲곗닠/嫄곗떆/湲곕낯/援щ（/?뚯쟾/誘몄떆 ?ш굔)
5. **遺遺?fix ???꾩껜 verify ?섎Т** ??npm run verify

---

## 9. ?덈? ?섏? 留?寃?(?ㅼ닔 history)

| # | ?ㅼ닔 | ?ш굔 |
|---|---|---|
| 1 | **寃利?肄붾뱶 ?먯껜???섍컖** | 5/31 `bands[ticker]` vs `band` ?⑥닔 ??validator 18% false ??63% (寃利앹쓽 ?섍컖) |
| 2 | **silent mode false pass** | 5/31 verify-report 媛 stdout 0 ??verify-all 0 err 蹂닿퀬 (false ??pass) |
| 3 | **routing 200 OK = 寃利??꾨즺** | /company/AAPL 200 ?몃뜲 KR news 100% unavailable |
| 4 | **?쒕㈃ metric ?쇰줈 ?앸궡湲?* | NE 0/15 / ?덉쭏 100/100 留?蹂닿퀬 SK?섏씠?됱뒪 sector="Construction" 紐??≪쓬 |
| 5 | **?ъ슜??紐낆떆 list ?꾨씫** | "媛寃?湲곗닠/嫄곗떆/湲곕낯/援щ（/?뚯쟾/誘몄떆 ??怨좊젮?" ??buy rule "媛寃? ?꾨씫??梨??쒖텧 |
| 6 | **DB direct ?섏젙** | cleanup ? `scripts/cleanup-hallucinations.mjs` ?ъ슜 (FK + retroactive) |
| 7 | **node --check 留뚯쑝濡?push** | 5/29 sectorPe TypeError ??runtime check ?꾩슂. CLAUDE.md "smoke test ?섎Т" |
| 8 | **?몃? ?묐떟 ?좊ː** | Yahoo OHLCV split-adjusted ????/ Naver bot 李⑤떒 / SEC ADR 誘몄닔濡?|

---

## 10. 以묒슂 ?뚯씪 ?꾩튂 (?먯깋??

### 肄붾뱶
- `scripts/generate-report-local.mjs` (5,900以? ??蹂닿퀬???앹꽦 硫붿씤
  - `:4106` buildPortfolioPrompt + F26 inject
  - `:4575` postProcessPortfolio (4以??덉쟾留?
  - `:5032` F23 fact-check
  - `:5125` finalReport 媛앹껜 ?앹꽦
  - `:5664` final-cap (KR 6+US 6 ?ъ쟻??
  - `:5861` verify-loop ?먮룞 ?몄텧
- `scripts/lib/db.mjs` (1,100以? ??DB schema + save ?⑥닔
  - `:325` hallucination_history ?뚯씠釉?
  - `:930` saveHallucinationHistory
  - `:962` getRecentHallucinationsForPromptInject
- `scripts/verify-report.mjs` ??蹂닿퀬??寃利?(silent false pass 李⑤떒)
- `scripts/verify-all.mjs` ???듯빀 entry (6 spawn 蹂묐젹)
- `scripts/audit-coverage.mjs` ??10 Probe
- `scripts/audit-company-pages.mjs` ??1,210 횞 9 endpoint
- `scripts/cleanup-hallucinations.mjs` ??retroactive DB cleanup

### ?곗씠??
- `data/flowvium.db` (26MB, gitignored) ??紐⑤뱺 DB
- `data/candidate-tickers.json` (1,210 醫낅ぉ + meta) ??**single source of truth**
- `data/buy-rules-tuned.json` (31 猷?7 移댄뀒怨좊━)
- `data/sell-rules-tuned.json` (19 猷?7 移댄뀒怨좊━)
- `data/dart-corp-codes.json` (3,967 醫낅ぉ mapping)

### ?ㅼ젙
- `package.json` ??`npm run verify` / `verify:report` / `verify:coverage` / `verify:company` / `setup:hooks`
- `vercel.json` ??Vercel cron schedule
- `.github/workflows/verify.yml` ??GitHub Actions CI
- `CLAUDE.md` (理쒖긽?? ??"紐⑤뱺 fix ???듯빀 寃利??섎Т" + 8媛?異붽? 洹쒖튃

### 臾몄꽌
- `FEATURES.md` ??UI 湲곕뒫 移댄깉濡쒓렇 (?꾩닔 ?좎?)
- `METRICS.md` ??吏??泥댄겕由ъ뒪??(?꾩닔 ?좎?)
- `HANDOFF.md` ?????뚯씪
- `research_history/2026-05-31_session-handoff.txt` ???곸꽭 history

---

## 11. ?섍꼍蹂??/ ?섏〈??

### ?꾩닔
- `data/.env.local` (gitignored) ??API keys
  - `CRON_SECRET` ??cron ?몄쬆
  - `ANTHROPIC_API_KEY` ??fallback LLM
  - `GROQ_API_KEY` ??fallback LLM
  - `GEMINI_API_KEY` ??fallback LLM
  - `OPENROUTER_API_KEY` ??Qwen3 cloud
  - `UPSTASH_REDIS_REST_URL` / `_TOKEN`
  - `DART_API_KEY` ??KR ?щТ
  - `SEIBRO_API_KEY` ??KR 怨듬ℓ???李?
  - `FRED_API_KEY` ??嫄곗떆
  - `COPERNICUS_EMAIL/PASSWORD` ???꾩꽦 (???곕뒗 以?

### ?쒖뒪??
- Ollama (qwen3:8b 紐⑤뜽 pull ?꾩슂)
- Node 20+
- better-sqlite3 (native ??Windows MinGW or prebuild)
- `OLLAMA_KV_CACHE_TYPE=q8_0` + `OLLAMA_FLASH_ATTENTION=1`

### Windows Task Scheduler
- FlowVium-Morning (06:50 KST = 21:50 UTC ?꾨궇)
- FlowVium-Afternoon (15:50 KST = 06:50 UTC)
- FlowVium-Evening (21:20 KST = 12:20 UTC)
- FlowVium-DART-CorpCodes (02:00 KST)
- FlowVium-DART-Prefetch (03:00 KST)
- FlowVium-Tune-Sell-Rules (Sun 04:00 KST)
- FlowVium-Tune-Buy-Rules (Sun 04:15 KST)

---

## 12. ?ㅼ쓬 ?몄뀡 利됱떆 ?ㅽ뻾 泥댄겕由ъ뒪??

```bash
# Step 1: ?꾩옱 ?곹깭 (140珥?
cd C:/Flowvium
npm run verify

# Step 2: 理쒖떊 cron verify trail
ls -t reports/verify/ | head -3
cat reports/verify/$(ls -t reports/verify/ | head -1)

# Step 3: Karpathy ?숈뒿 異붿꽭 (理쒓렐 10 cycles)
node -e "
const D = require('better-sqlite3');
const db = new D('data/flowvium.db', {readonly:true});
const r = db.prepare(\`SELECT substr(generated_at,1,16) g, session,
  (SELECT COUNT(*) FROM hallucination_history WHERE report_id=reports.id) h
  FROM reports ORDER BY generated_at DESC LIMIT 10\`).all();
for (const x of r) console.log(x.g, x.session.padEnd(10), 'h=' + x.h);
const t = db.prepare(\`SELECT defect_type, COUNT(*) c, AVG(injected_count) avg
  FROM hallucination_history WHERE detected_at >= datetime('now','-2 days')
  GROUP BY defect_type\`).all();
console.log('\\n24h type:');
for (const x of t) console.log(' ', x.defect_type, x.c, 'avg_inj=' + x.avg.toFixed(1));
db.close();
"

# Step 4: GitHub Actions 寃곌낵 (留덉?留?push ??
# https://github.com/taeshin11/flowvium/actions

# Step 5: ?ㅼ쓬 cron 源뚯? ?쒓컙
node -e "
const k = new Date(Date.now()+9*3600000);
const m = new Date(k); m.setUTCHours(7,0,0,0); if (m<k) m.setUTCDate(m.getUTCDate()+1);
const a = new Date(k); a.setUTCHours(15,50,0,0); if (a<k) a.setUTCDate(a.getUTCDate()+1);
const e = new Date(k); e.setUTCHours(21,20,0,0); if (e<k) e.setUTCDate(e.getUTCDate()+1);
console.log('KST', k.toISOString().slice(0,16));
console.log('morning:', Math.round((m-k)/60000), '遺?);
console.log('afternoon:', Math.round((a-k)/60000), '遺?);
console.log('evening:', Math.round((e-k)/60000), '遺?);
"

# Step 6: ?ъ슜???붿껌 紐낇솗??????紐낆떆?섎㈃ ?붿뿬 寃고븿 6媛?以?#1 (sector lowercase) 遺???쒖옉
```

---

## 13. ?몃윭釉붿뒋??

### "verify-all fail / cron 蹂닿퀬????留뚮뱾?댁쭚"
1. Ollama ?ㅽ뻾 以묒씤吏 ?뺤씤 (`ollama list`)
2. `logs/report.log` tail 50 ??error ?⑦꽩 grep
3. 留덉?留?commit ??broken syntax ??媛?μ꽦 ??`node --check scripts/generate-report-local.mjs`
4. Windows Task Scheduler ??LastTaskResult ?뺤씤

### "媛먯???寃고븿???ъ슜?먭? 蹂?寃껉낵 ?ㅻ쫫"
1. `verify-report` ??validator key 媛 ?묐떟 schema ? ?쇱튂?섎뒗吏 吏곸젒 curl ?묐떟 鍮꾧탳
2. silent mode ??寃쎌슦 `console.log` 異쒕젰 0 ??grep ??0 ??false pass ?섏떖
3. `process.exit(1)` 紐낆떆?섏뼱 ?덈뒗吏

### "Karpathy ?숈뒿 ????/ 媛숈? ?섍컖 諛섎났"
1. Probe [9] 媛 ????detect 硫???critical ??**data source 寃고븿** 媛?μ꽦. 肄붾뱶 fix ?꾩슂
2. F26 inject ?먮뒗吏 logs ??`[F26/AntiPattern]` ?쇱씤 ?뺤씤
3. `hallucination_history.injected_count` 媛 利앷??섎뒗吏

### "Vercel build fail"
1. `vercel logs` ?뺤씤
2. TypeScript error (node_modules `Intl.ListFormat` ??臾댁떆 媛??
3. `vercel.json` ??ignoreCommand (`scripts/vercel-should-build.sh`) 媛 ?덈Т ?곴레 skip ?섎뒗吏

---

## 14. ?섎룄??誘명빐寃?(?닿굔 fix ???대룄 ??

1. **node.exe 4媛?(4/30 / 5/6 ?쒖옉)** ??Cursor/Ollama ??dev env ?곸＜. ?곕━ 肄붾뱶 ?꾨떂
2. **GitHub Actions 泥??ㅽ뻾 fail** ??`95df96e` 濡?fix ?덉?留??꾩쭅 寃利????? ?ㅼ쓬 push ???뺤씤
3. **`asset_flow_archive.return_1d` 99% NULL** ??5/31 sparkline 怨꾩궛 fix ???좉퇋 ?곸옱留? retroactive backfill ????(?꾩슂 ??helper 異붽?)
4. **`reports.quality_score` 83% NULL** ???좉퇋??梨꾩썙吏吏留?怨쇨굅 backfill ????
5. **trackRecord hero card ?쒓굅** ???ъ슜???붿껌. `portfolioOutcomes` JSON ?꾨뱶???숈뒿 source 濡??좎?

---

## 15. 留덉?留?sanity check (commit ???섎Т)

```bash
# 1. syntax
node --check scripts/generate-report-local.mjs
node --check scripts/audit-coverage.mjs
node --check scripts/verify-report.mjs

# 2. smoke (60珥?
timeout 60 node scripts/generate-report-local.mjs --model=qwen3:8b 2>&1 | grep -E "TypeError|FATAL|\[1\.5"

# 3. ?듯빀 (140珥?
npm run verify

# 4. FEATURES.md + METRICS.md 媛숈? commit ??諛섏쁺?덈뒗吏 ?뺤씤

# 5. research_history/{date}_{topic}.txt 湲곕줉 ?덈뒗吏

# 6. CLAUDE.md 洹쒖튃 ?꾨컲 ???덈뒗吏
```

?섍퀬?섏뀲?댁슂. ?ㅼ쓬 ?몄뀡?먯꽌 ?댁뼱媛?몄슂 ?솋
