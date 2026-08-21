# FlowVium 蹂듭썝 + Ollama?뭌SL/vLLM ?댁쟾 ???묒뾽 ?덉뒪?좊━

?묒꽦: 2026-06-15 (UTC). ?몄뀡: remote-control. ?묒뾽 ?붾젆?곕━: `C:\Flowvium`.
???repo: `C:\Flowvium`. ?⑦궎吏: `G:\???쒕씪?대툕\0.flowvium_move`.

---

## 0. 諛곌꼍
?щ㎎????PC(RTX 4090 24GB)??flowvium.net ?먭??몄뒪???ㅽ깮??蹂듭썝.
?ъ슜?먭? ?멸퀎???곕턿)瑜?遺숈뿬?ｌ뿀怨? ?꾩쨷????媛吏 寃곗젙?쇰줈 ?곕턿??**??뼱?**:
- 濡쒖뺄 異붾줎??**Ollama ??WSL2 + vLLM** ?쇰줈 援먯껜.
- 紐⑤뜽???곕턿??`qwen3:32b` ??**`Qwen3.6-35B-A3B`** (MoE, ~3B active, 24GB AWQ fit)濡?寃⑹긽.
- 寃쎈줈: "Ollama 以묎컙?④퀎 ?놁씠 諛붾줈 vLLM". WSL ?ㅼ튂+?щ??낆? ?ъ슜?먭? 吏곸젒 (??鍮꾧텒??.

## 1. 癒몄떊 珥덇린 ?곹깭 (assessment)
- `C:\Flowvium` 鍮꾩뼱?덉쓬, `C:\Flowvium` ?놁쓬, G: ?⑦궎吏 議댁옱.
- ?ㅼ튂?? Node v24.16.0 留? ?놁쓬: git, ollama, pm2, cloudflared, memurai.
- ??**鍮꾧텒??*(SPINAI6\taesh, admin=False). winget UAC ?ㅼ튂???먮룞痍⑥냼??
- GPU: RTX 4090, ?쒕씪?대쾭 560.94 / CUDA 12.6 ?뺤긽. winget ?ъ슜媛??
- G ?⑦궎吏 寃利? secrets(.env.local/.cf-tunnel-token), data(flowvium.db+wal+shm),
  config(6 task XML + ecosystem.config.cjs + ollama-models.txt), code-backup(bundle+HEAD),
  claude-memory 41?뚯씪. HEAD=52f2344, 誘명뫖??ahead:0.

## 2. ?꾨즺???묒뾽
- git 2.54 (user scope, no-admin), pm2 (npm -g), ollama 0.30.6 (user scope) ?ㅼ튂.
  ??ollama ??vLLM ?꾪솚 ???쒓굅 ?덉젙 ???곗꽑 ?ㅼ튂留???
- repo clone (GitHub) ??HEAD `52f2344` ?쇱튂 ?뺤씤, 846 ?뚯씪. `npm install` ?꾨즺.
- G?뭨epo 蹂듭궗: `.env.local`, `.cf-tunnel-token`, `data/flowvium.db`(42.55MB)+wal+shm.
- claude-memory 41?뚯씪 ??`C:\Users\taesh\.claude\projects\C--NoAddsMakingApps-FlowVium\memory`.
- qwen3:32b pull ?쒕룄 ??74%?먯꽌 ?ㅽ듃?뚰겕 EOF ?ㅽ뙣(GPU 臾닿?). vLLM ?꾪솚?쇰줈 ?먭린.

## 3. 肄붾뱶 遺꾩꽍 (vLLM ?꾪솚 踰붿쐞)
濡쒖뺄 LLM 寃쎈줈 2媛?
1. `src/lib/llm-local.ts` `localChat()` ??Ollama ?ㅼ씠?곕툕 `/api/chat`, 紐⑤뜽
   `OLLAMA_TRANSLATE_MODEL`(湲곕낯 qwen3:8b), `think:false`. 踰덉뿭/?멸렇癒쇳듃??
   GPU ?숈떆??媛??active 2/wait 8/15s) + `hasChineseBleed`/`localChatNoBleed`
   ?뺢퇋????Ollama logit_bias 誘몄????泥?. **vLLM ?꾪솚???듭떖 ?섏젙 ?뚯씪.**
   ??OpenAI `/v1/chat/completions` 濡?蹂寃? thinking off =
     `chat_template_kwargs.enable_thinking=false`, ?뺢퇋???????ㅼ젣 `logit_bias=-100`
     (?멸뎅臾몄옄 ?좏겙 ?붿퐫?⑸떒 李⑤떒 = ?덉쭏 媛쒖꽑).
2. `src/lib/ai-providers.ts` `callAI()` ?대씪?곕뱶 罹먯뒪耳?대뱶 ??**?대? OpenAI-compat vLLM
   泥???議댁옱**(`callVLLM` ??`${VLLM_URL}/chat/completions`; VLLM_URL? `/v1`濡??앸굹????.
   ?꾩옱 EXAONE 紐⑤뜽 `LGAI-EXAONE/EXAONE-3.5-2.4B-Instruct`+max500 ?섎뱶肄붾뵫 ??紐⑤뜽紐??좏겙 媛깆떊.
- LLM 李몄“ ?뚯씪 13媛?(generate-report-local.mjs ???ы븿).

`.env.local` ?꾩옱(鍮꾨? ?쒖쇅): `LLM_LOCAL_ONLY=1`(?대씪?곕뱶 罹먯뒪耳?대뱶 off, 濡쒖뺄 ?꾩슜),
`VLLM_URL="https://pac-tension-composed-toronto.trycloudflare.com"`(援?EXAONE ?곕꼸, stale ??`http://localhost:8000/v1`濡?蹂寃?, `UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079`(濡쒖뺄 shim),
OLLAMA_* ???놁쓬.

## 4. 沅뚰븳 ?ㅼ튂 ???꾨즺 (?ъ슜??UAC ?뱀씤, 10:06 UTC)
- **WSL 2.7.8**: 沅뚰븳?곸듅 `wsl --install --no-distribution` (EXIT 0), VirtualMachinePlatform ?쒖꽦.
  **?щ????湲?* ???곸슜?섎젮硫??щ????꾩닔. ?щ????????몄뀡 醫낅즺 ??硫붾え由???濡쒓렇濡??ш컻.
- **Memurai(Redis)**: `winget install Memurai.MemuraiDeveloper`(v4.1.2) 沅뚰븳?ㅼ튂 ?깃났.
  ?쒕퉬??`Memurai` Running/Automatic, `C:\Program Files\Memurai\memurai.exe`, 6379 LISTEN, PONG.
  ??**Redis blocker ?댁냼.** auto-start ?쒕퉬?ㅻ씪 ?곕턿??`pm2 start memurai.exe` ?쇱씤 遺덊븘??
    portable redis ?꾩씠?붿뼱 ?먭린. redis-rest-shim(6379??079)留??꾩슦硫???

## 5. ?щ??????ш컻 ?덉감 (RESUME)
1. WSL ?ㅼ튂 ?뺤씤: `wsl --status`.
2. `wsl --install -d Ubuntu-24.04` (no-admin). nvidia-smi WSL passthrough ?뺤씤.
3. Ubuntu: python venv + `pip install vllm`. Qwen3.6-35B-A3B 4-bit AWQ HF repo id ?뺤씤
   (HF 寃?됱쑝濡??ㅼ옱 ?뺤씤 ?꾩슂) ??`vllm serve <repo> --port 8000 --gpu-memory-utilization 0.92
   --max-model-len <fit>`. 24GB fit 寃利?
4. ?먮룞?쒖옉: Windows Task Scheduler "FlowVium-vLLM" at-logon ??`wsl -d Ubuntu-24.04 ... vllm serve`.
5. 肄붾뱶 ?ㅼ솑: llm-local.ts + ai-providers.ts ?섏젙 + .env(VLLM_URL=localhost:8000/v1,
   OLLAMA_TRANSLATE_MODEL=<repo id>) ??live :8000 ?뚯뒪????**commit+push**(cron 誘몄빱諛?wipe 洹쒖튃).
6. ollama ?쒓굅.
7. `npm run build` ??pm2(ecosystem.config.cjs) ??redis-rest-shim(Memurai ?쒕퉬???대? 6379 媛?? ??   cloudflared ?곕꼸 ??6媛?task XML import(vLLM 寃利??? ??`npm run verify` ??curl flowvium.net.
   ??cloudflared 留??꾩쭅 誘몄꽕移????щ?????portable exe ?ㅼ슫濡쒕뱶(臾닿텒??. pm2 ???ㅼ튂??

?곸꽭 ?곹깭??硫붾え由?`flowvium-vllm-migration` 李몄“ (MEMORY.md ?몃뜳?ㅻ맖).

---

## 6. 실행 결과 (재부팅 후 세션 — 이전 완료, 2026-06-15)

- vLLM: WSL2 `/opt/vllm-venv` vLLM 0.23, `stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ` :8000 (~180tok/s). 27B는 느려 폐기. 드라이버 595.97(CUDA13). cfg `/opt/vllm/model.conf`(GPU_UTIL=0.93/MAX_MODEL_LEN=52480/FLASH_ATTN+no-flashinfer+CUDA_HOME+ninja), 로그 `/var/log/flowvium-vllm.log`.
- 코드 Ollama→vLLM /v1 전부 swap. served alias `flowvium-local`(+qwen3:8b).
- repo C:\NoAddsMakingApps→**C:\Flowvium** 이전+경로수정+push. pm2 5개 from C:\Flowvium.
- 보고서 수정 3건: loadEnv→process.env 주입 / portfolio output 6144 / priceData 후보축소. API 스키마 빈배열 허용. → /api/investment-strategy source=local-qwen3:8b 정상.
- 8 Task(리포트5/백업/vLLM·pm2 autostart). Ollama 제거됨.
- 남은것: NoAddsMakingApps 빈폴더 삭제(VSCode 핸들), 자동로그인(netplwiz), 세션모니터 CronCreate, 구PC종료.
- 주의: rebuild+reload → chunk hash 변경 → 열린탭 ChunkLoadError → 하드리프레시.
