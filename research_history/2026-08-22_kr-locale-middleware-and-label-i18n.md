# 2026-08-22 — KR 종목 페이지 로케일 붕괴 · 라벨 i18n · preferSmallModel 죽은 옵션

## 1. push 게이트가 막았고, 그게 진짜 버그였다

`verify-all FAIL (1)` 로 push 차단. `--no-verify` 로 넘기지 않고 audit-coverage 한 건을 팠다.

- `/api/company-news` 가 US 0.4~0.7초 vs **KR 정확히 30.1초**. *정확히* 30초라 고정 상한을 의심.
- `web.log`: `local_only_fallback durationMs:30002` / `ai-providers.ts:77 AbortSignal.timeout(…?? 30000)`
- 같은 요약을 웹 레인(:8001, 4B)에 직접 시키면 **2.5초**.
- 원인: `ai-providers.ts:36` 의 `preferSmallModel` 이 **타입 선언 1곳** 에만 있고 라우팅에 안 쓰였다.
  호출부 2곳이 "작은 모델로 충분" 이라 명시했는데 요청은 27B(:8000, 보고서 전용)로 갔다.
- **지연이 아니라 기능 부재였다** — 30초 후 summary 가 빈 값이라 한국 종목 페이지엔 AI 요약이 없었다.
- 수정 후: 2.7s/3.3s · summary 있음. audit-coverage `company-news` 3/12 → 12/12.
- 폴백 모델명 `'flowvium-local'`(mlx 가 404 로 거부하는 옛 별칭)도 `'default_model'` 로 교정.

## 2. 🔴 한국 종목 페이지가 16개 로케일 전부에서 영문이었다

눈검증(`/ko/company/005930.KS`)에서 `english_leak` 21건 → 전역 내비 라벨.

SSR 대조가 원인을 확정했다:

| 경로 | 결과 |
|---|---|
| `/ko/company/AAPL` | 한글 ✓ |
| `/ko/company/005930.KS` | **영문** ✗ |
| `/ja/company/005930.KS` | **영문** ✗ |

`src/middleware.ts` matcher 의 `.*\..*` 부정 전방탐색이 **점이 든 모든 경로를 제외**한다.
한국 티커는 `005930.KS`·`196170.KQ` 처럼 점을 갖는다 → 로케일 미들웨어를 아예 안 탐 →
`[locale]/layout.tsx:99` 의 `getMessages()`(locale 인자 없음)가 기본 로케일로 폴백.

next-intl 문서도 경고한다: *"matcher 는 점 같은 예기치 않은 문자를 포함한 동적 세그먼트까지
앱의 모든 라우트를 맞춰야 한다"*. '점 제외' 는 흔한 편법이고, 정식은 **알려진 확장자로 끝나는가** 다.

→ 확장자 기준 제외로 교체. `scripts/lib/locale-middleware.test.mjs` 가 경로 8종으로 고정.
   실측: ko/ja/zh-CN 전부 정상 렌더 · favicon/robots/sitemap 200 유지(회귀 없음).

## 3. 라벨 i18n 3종 (눈검증으로만 드러난 부류)

- **브레드크럼**: `Breadcrumbs.tsx:29` 가 `formatSegment(URL)` 로 `'company' → 'Company'` —
  타이틀케이스만 하고 번역이 없었다. JSON-LD 구조화 데이터에도 영문으로 실려 검색엔진에 노출.
  → `nav.*` 재사용(kebab→camel 변환 포함) + 누락 키 10종 × 16로케일 추가.
- **역할·관계 라벨**: `CompanyPage.tsx:1143/2117` 이 데이터의 `'supplier'` 를 **CSS `capitalize`** 로
  찍어 화면에 `'Supplier'` 로 보였다. capitalize 는 번역이 아니라 영어 표기 규칙이라
  그 자리는 영원히 영문이 된다. **소스 grep 으로는 안 잡히는 형태 — 눈검증에서만 드러난다.**
  같은 파일 693행의 `KR_REL_LABEL` 은 한국어 하드코딩이었다(다른 15개 로케일에 그대로 노출).
  → `roles.*` 9종 × 16로케일로 통합.
- `Compare` 하드코딩 → `nav.compare`.

증거: `/ko/company/005930.KS` english_leak **21 → 2 → 0**, PAGE-AUDIT OK 0 flag.

## 4. 내가 만든 모니터가 하루도 안 돼 오탐

03:53 유휴 상태에서 `조절기 가동률 0% — 열로 처리량 급락`. 그 1시간 실제 정지는 62초(참값 98.3%).
가동률을 *이벤트 사이 구간* 으로만 세어, 창 시작~첫 이벤트와 마지막 이벤트~현재를 누락했다.
**이벤트가 드물수록 틀리는 = 평온할수록 울리는** 계산이었다. 정지 횟수도 창 밖까지 셌다.
→ `computeDuty(events, windowMs, now)` 순수 함수로 분리 + 7종 검증.

정정된 실측: 오후 64% · 자정 69% · 저녁 77% · 유휴 98% · 하루(15h) 87%(정지 354회/113분).
종전 보고 "68% · 1.5배" 는 이 범위 안이다(버그는 유휴 구간만 왜곡).

## 5. 미해결

- `iv` 프로브 2/6 — 빈 결과 경로는 `src/lib/options/iv-summary.ts:281` 에서
  `errorReason:'no_valid_expiries'` 로 **명시적**(삼키지 않음). 다만 유틸리티 종목에 그 판정이
  옳은지 **검증 못 함** — Yahoo 가 429 로 제한(내 프로브가 소진시킨 것으로 보임).
- `Supplier`/`Leader` 외 `english_candidate` 는 여전히 40건대 — 후보이지 누출은 아니다.
- 전체 디스크 접근 권한(Drive 백업), 스퀴즈 산식, 팬 여력 47%, `flowvium.db` git 추적,
  PAT·터널 토큰 폐기.

## 6. 이 세션의 내 오류

- Yahoo 옵션 API 를 반복 호출해 **429 를 유발**했다. 어제는 느린 클라우드 FS 실험으로 보고서를
  6.7배 느리게 만들었다. **프로덕션이 도는 환경에서 프로브는 예산이 있는 행위다.**
- 미들웨어 matcher 시뮬레이션에서 TS 소스의 `\\.` 를 런타임 정규식으로 안 풀어 판정이 거꾸로 나왔다.
- `useMessages` import 를 빠뜨려 빌드가 한 번 깨졌다(타입 검사가 잡음).
