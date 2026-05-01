/**
 * @static-data-warning
 * 이 파일의 수치들은 정적 데이터입니다. FRED/Yahoo/Bloomberg에서 자동 update되지 않음.
 * UI에서는 live API (macro-indicators, volatility 등)가 있으면 override됩니다.
 * 수치 수동 업데이트 시 날짜 기록: @last-reviewed 2026-05-01
 */
export interface SectorContext {
  id: string;
  name: string;
  /** 현재 시장 국면 한줄 요약 */
  phase: string;
  /** 핵심 지표/데이터 포인트 */
  keyData: { label: string; value: string; trend: 'up' | 'down' | 'neutral' }[];
  /** 섹터 핵심 테마 */
  themes: string[];
  /** Google News 검색 URL */
  googleNewsUrl: string;
  /** 관련 ETF */
  etfs: string[];
  /** 다음 주요 이벤트 */
  nextCatalysts: string[];
}

export const sectorContextMap: Record<string, SectorContext> = {
  'semiconductors': {
    id: 'semiconductors',
    name: '반도체',
    phase: 'WFE(반도체 장비) 업사이클 + AI HBM 슈퍼사이클 진입',
    keyData: [
      { label: 'TSMC 가동률', value: '92%+', trend: 'up' },
      { label: 'HBM 수요 성장', value: '+180% YoY', trend: 'up' },
      { label: 'WFE 시장 규모', value: '$105B (2026E)', trend: 'up' },
      { label: '리드타임 (장비)', value: '18~24개월', trend: 'neutral' },
    ],
    themes: [
      'AI 가속기(H100/B200) 수요 공급 불균형 지속',
      'Gate-All-Around 공정 전환 → 장비 교체 사이클',
      'HBM3e/HBM4 양산 경쟁 — SK하이닉스·마이크론·삼성',
      'TSMC 애리조나/일본 fab 확장으로 장비 수요 증가',
      'CoWoS 패키징 병목 → AMAT·LRCX·KLAC 수혜',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=semiconductor+equipment+HBM+AI+chip&tbm=nws',
    etfs: ['SOXX', 'SMH', 'XSD'],
    nextCatalysts: [
      'TSMC Q2 실적 (2026.04.17)',
      'NVIDIA GB300 양산 착수 발표',
      'AMAT/LRCX/KLAC 실적 시즌 (2026.05)',
    ],
  },

  'ai-cloud': {
    id: 'ai-cloud',
    name: 'AI / 클라우드',
    phase: '하이퍼스케일러 AI 인프라 투자 급증 — 수혜 종목 선별 중요',
    keyData: [
      { label: 'AI 인프라 투자 (2026E)', value: '$320B', trend: 'up' },
      { label: 'AWS 성장률', value: '+37% YoY', trend: 'up' },
      { label: 'AI 소프트웨어 침투율', value: '18%', trend: 'up' },
      { label: 'GPU 리드타임', value: '6~9개월', trend: 'down' },
    ],
    themes: [
      'Capex 폭증 — MSFT/GOOGL/META/AMZN 합산 $200B+ (2026)',
      'Inference 수요 → 맞춤형 AI칩(MRVL·ORCL 수혜)',
      'SaaS → AI-as-a-Service 전환 가속',
      'Sovereign AI — 각국 자국 클라우드 구축 수요',
      'Power & Cooling — AI 데이터센터 전력 수요 3배 증가',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=AI+cloud+hyperscaler+capex+investment&tbm=nws',
    etfs: ['AIQ', 'BOTZ', 'CLOU', 'QQQ'],
    nextCatalysts: [
      'Meta/GOOGL/MSFT/AMZN Q1 실적 (2026.04~05)',
      'OpenAI GPT-5 출시 영향',
      'NVIDIA GB300 기반 H200 교체 사이클',
    ],
  },

  'ev-battery': {
    id: 'ev-battery',
    name: 'EV / 배터리',
    phase: '리튬 가격 바닥권 — 기관 역발상 매집, 중장기 반등 베팅',
    keyData: [
      { label: '리튬 탄산 현물가', value: '$11.5/kg', trend: 'down' },
      { label: '글로벌 EV 보급률', value: '18% → 25% (2026E)', trend: 'up' },
      { label: '배터리 팩 가격', value: '$112/kWh', trend: 'down' },
      { label: '중국 EV 수출 성장', value: '+42% YoY', trend: 'up' },
    ],
    themes: [
      '리튬 가격 52주 저점 — 과잉공급에도 기관은 ALB 집중 매집',
      'BYD 가격 전쟁 → 서방 완성차 원가 압박 심화',
      'ESS(에너지 저장장치) 수요 급증으로 리튬 중기 회복 전망',
      'IRA 세액 공제로 미국 내 배터리 공장 건설 가속',
      'LFP vs NMC 기술 경쟁 — 에너지밀도 vs 원가',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=lithium+EV+battery+market+2026&tbm=nws',
    etfs: ['LIT', 'BATT', 'DRIV'],
    nextCatalysts: [
      'ALB Q1 실적 및 리튬 생산 가이던스 (2026.05)',
      'Tesla 배터리 데이 2026',
      'IRA 보조금 검토 결과 발표',
    ],
  },

  'defense': {
    id: 'defense',
    name: '방산',
    phase: 'NATO 지출 의무화 + 우크라이나 재건 → 다년간 수주 잔고 사상 최대',
    keyData: [
      { label: '미 국방예산 (FY2026)', value: '$921B', trend: 'up' },
      { label: 'NATO 방위비 GDP 목표', value: '2% → 2.5%', trend: 'up' },
      { label: 'KTOS 수주 잔고', value: '$1.1B (+34%)', trend: 'up' },
      { label: '드론 시장 규모 (2030E)', value: '$58B', trend: 'up' },
    ],
    themes: [
      'NATO 32개국 방위비 GDP 2.5% 의무화 → 10년 수요 가시성 확보',
      'Loyal Wingman 드론 경쟁 — KTOS Valkyrie 핵심 수혜',
      '우크라이나 재건 + 방공망 현대화 수요',
      '우주/사이버 방어 예산 별도 확대',
      '방산 주문 리드타임 2~3년 → 수주잔고 = 미래 매출 가시성',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=defense+spending+NATO+drone+military+budget&tbm=nws',
    etfs: ['ITA', 'XAR', 'DFEN'],
    nextCatalysts: [
      'NOC/LMT/LHX/RTX Q1 실적 (2026.04)',
      'KTOS 국방부 드론 계약 발표',
      'NATO 정상회의 방위비 최종 합의 (2026.06)',
    ],
  },

  'pharma-biotech': {
    id: 'pharma-biotech',
    name: '제약 / 바이오',
    phase: 'GLP-1 메가트렌드 + AI 신약개발 + 저평가 바이오 기관 매집',
    keyData: [
      { label: 'GLP-1 시장 규모 (2030E)', value: '$150B', trend: 'up' },
      { label: 'mRNA 암백신 임상 성공률', value: '+49% 재발 위험 감소', trend: 'up' },
      { label: 'AI 신약개발 단계', value: '임상 2상 진입', trend: 'up' },
      { label: 'PFE/MRNA 52주 변화', value: '-30% ~ -45%', trend: 'down' },
    ],
    themes: [
      'Mounjaro/Wegovy — 비만·당뇨 넘어 심혈관·신장·NASH 적응증 확대',
      'Moderna mRNA-4157 암백신 — 흑색종 49% 재발 감소 (NEJM)',
      'REGN dupilumab 다적응증 확대 → 10조+ 매출 가시성',
      'PFE/MRNA 52주 저점 → 역발상 기관 매집 (Baillie Gifford, Fidelity)',
      'FDA 가속 심사 트랙으로 신약 허가 기간 단축',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=GLP-1+obesity+drug+pharma+biotech+2026&tbm=nws',
    etfs: ['XBI', 'IBB', 'PJP'],
    nextCatalysts: [
      'LLY Orforglipron(경구용 GLP-1) 3상 결과 (2026.Q2)',
      'MRNA 암백신 FDA BLA 제출 예정',
      'REGN EYLEA HD 유럽 허가 결과',
    ],
  },

  'healthcare': {
    id: 'healthcare',
    name: '헬스케어',
    phase: '메디케어 수가 압박 vs AI 진단 효율화 — 선별적 접근 필요',
    keyData: [
      { label: '미국 헬스케어 지출 (2026E)', value: '$4.8T', trend: 'up' },
      { label: 'AI 진단 정확도 개선', value: '+23% vs 기존', trend: 'up' },
      { label: 'UNH 의료손해율', value: '87.3%', trend: 'up' },
      { label: '약가 협상 대상 의약품', value: '20종 (IRA)', trend: 'down' },
    ],
    themes: [
      'CMS 메디케어 어드밴티지 수가 인하 → 보험사 마진 압박',
      'AI 영상진단·병리학 도입 가속 — Tempus, Veracyte 수혜',
      'GLP-1 보험 적용 확대 논의 → UNH·CVS 비용 증가 리스크',
      '로봇수술 확대 — Intuitive Surgical 플랫폼 점유율 방어',
      '미국 처방약가 협상(IRA) 2단계 — 2026년 20개 품목 적용',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=healthcare+medicare+AI+diagnostics+2026&tbm=nws',
    etfs: ['XLV', 'VHT', 'IYH'],
    nextCatalysts: [
      'CMS 메디케어 최종 수가 발표 (2026.Q2)',
      'UNH/HUM/CVS Q1 실적 (2026.04)',
      'IRA 약가 협상 2차 품목 공개',
    ],
  },

  'industrials': {
    id: 'industrials',
    name: '산업재',
    phase: '리쇼어링·국방 수요 + AI 자동화 투자 — 장기 수주잔고 사상 최고',
    keyData: [
      { label: 'ISM 제조업 PMI', value: '50.3 (확장 복귀)', trend: 'up' },
      { label: '미국 제조업 건설 지출', value: '$235B (+68% YoY)', trend: 'up' },
      { label: '항공 여객 회복', value: '103% (2019 대비)', trend: 'up' },
      { label: '화물 운임 지수 (BDI)', value: '1,450p', trend: 'neutral' },
    ],
    themes: [
      'CHIPS·IRA법 → 반도체·배터리 공장 건설 붐 — 건설기계 수요 급증',
      'GE Aerospace 엔진 납기 지연 → 보잉·에어버스 인도 차질 지속',
      '방산 수주 급증 — RTX·NOC·GD 백로그 사상 최대',
      '물류 자동화 — Dematic·Honeywell 창고 로봇 수요 확대',
      'HVAC 업그레이드 수요 — 데이터센터 냉각 시스템 교체 사이클',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=industrials+manufacturing+reshoring+aerospace+2026&tbm=nws',
    etfs: ['XLI', 'VIS', 'IYJ'],
    nextCatalysts: [
      'GE Aerospace·Honeywell·CAT Q1 실적 (2026.04)',
      '보잉 737 MAX 생산 재개 일정',
      '미국 인프라 2차 집행 예산 확정',
    ],
  },

  'energy': {
    id: 'energy',
    name: '에너지',
    phase: '유가 $70~80 박스권 — AI 전력 수요 급증이 천연가스 중장기 수혜 촉발',
    keyData: [
      { label: 'WTI 유가', value: '$78/bbl', trend: 'neutral' },
      { label: 'Henry Hub 천연가스', value: '$2.8/MMBtu', trend: 'up' },
      { label: '미국 LNG 수출', value: '14Bcf/d (사상 최대)', trend: 'up' },
      { label: 'OPEC+ 감산 준수율', value: '92%', trend: 'neutral' },
    ],
    themes: [
      'AI 데이터센터 전력 급증 → 천연가스 발전 수요 구조적 확대',
      'LNG 수출 터미널 증설 — Venture Global·Sempra 수혜',
      '유럽 에너지 안보 → 미국産 LNG 장기 계약 체결 가속',
      'OPEC+ 감산 연장 vs 비OPEC 증산 — 유가 $70~85 레인지 예상',
      '탄소포집(CCS) 투자 확대 — ExxonMobil·Occidental 선도',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=oil+gas+LNG+energy+AI+power+demand+2026&tbm=nws',
    etfs: ['XLE', 'XOP', 'AMLP'],
    nextCatalysts: [
      'OPEC+ 생산 정책 회의 (2026.06)',
      'XOM·CVX·COP Q1 실적 (2026.04)',
      'EIA 여름 에너지 수급 전망 보고서',
    ],
  },

  'utilities': {
    id: 'utilities',
    name: '유틸리티',
    phase: 'AI 전력 수요 폭증 — 수십 년 만의 수요 증가 사이클 진입',
    keyData: [
      { label: '미국 전력 수요 증가 전망', value: '+15~20% (2030E)', trend: 'up' },
      { label: '데이터센터 전력 소비 비중', value: '4% → 9% (2030E)', trend: 'up' },
      { label: '원자력 발전 가격', value: '$80~120/MWh', trend: 'up' },
      { label: '신재생 PPA 계약 단가', value: '$45/MWh', trend: 'down' },
    ],
    themes: [
      'AI 데이터센터 → 전력망 업그레이드 의무화 — Eaton·Quanta 수혜',
      '원전 재가동 트렌드 — Microsoft·Amazon 소형원전(SMR) 계약',
      '천연가스 복합화력 건설 러시 — 신규 건설 허가 30년 만에 최다',
      '태양광+ESS 비용 하락 → 기업 PPA 급증',
      '전력망 노후화 교체 수요 — $600B 투자 필요 (2035년까지)',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=utility+power+grid+AI+datacenter+nuclear+2026&tbm=nws',
    etfs: ['XLU', 'VPU', 'IDU'],
    nextCatalysts: [
      'NEE·SO·DUK Q1 실적 (2026.04)',
      'FERC 전력망 업그레이드 규정 최종안',
      'SMR 인허가 일정 업데이트 (NRC)',
    ],
  },

  'financials': {
    id: 'financials',
    name: '금융',
    phase: '금리 인하 사이클 + 자본시장 회복 — IB 수수료·대출 스프레드 동시 개선',
    keyData: [
      { label: 'Fed Funds Rate', value: '3.50~3.75%', trend: 'down' },  // 2026-03-19 50bp 인하 후
      { label: 'M&A 거래 규모 (2026Q1)', value: '$842B (+34% YoY)', trend: 'up' },
      { label: '은행 NIM (평균)', value: '2.85%', trend: 'neutral' },
      { label: '신용카드 연체율', value: '3.2% (10년 최고)', trend: 'up' },
    ],
    themes: [
      '금리 인하 → 모기지·기업대출 수요 회복 기대',
      'M&A·IPO 재개 — Goldman·Morgan Stanley IB 수수료 급증',
      '핀테크 규제 완화 기대 — Block·Affirm·Upstart 수혜',
      '은행 자본 규제(Basel III Endgame) 완화 검토 중',
      '사모펀드 Exit 창구 확대 — GP-led 거래 급증',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=banking+finance+Fed+rate+cut+M%26A+2026&tbm=nws',
    etfs: ['XLF', 'KBE', 'KRE'],
    nextCatalysts: [
      'JPM·BAC·GS·MS Q1 실적 (2026.04.14~17)',
      'Fed FOMC 회의 (2026.05, 06)',
      'Basel III Endgame 최종 규정 확정',
    ],
  },

  'consumer-discretionary': {
    id: 'consumer-discretionary',
    name: '소비재 (경기민감)',
    phase: '프리미엄 vs 가성비 양극화 — 고소득 소비 견조, 중간층 압박 심화',
    keyData: [
      { label: '미국 소매판매 증감 (MoM)', value: '+0.4%', trend: 'up' },
      { label: '소비자신뢰지수 (Conference)', value: '98.3', trend: 'down' },
      { label: '명품 시장 성장률 (글로벌)', value: '+6% YoY', trend: 'up' },
      { label: '전자상거래 침투율', value: '22%', trend: 'up' },
    ],
    themes: [
      '소비 양극화 — Amazon/LVMH 프리미엄 수요 vs Dollar General 가성비',
      'AI 개인화 추천 → 전환율 개선 — AMZN·JD 수혜',
      '중국 소비 회복 기대감 — LVMH·RMS 매출 반등 베팅',
      '여행·레저 수요 지속 — Booking·Airbnb 호텔체인 초과 수혜',
      '자동차 할부금리 고점 완화 → 신차 판매 회복 기대',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=consumer+spending+retail+luxury+ecommerce+2026&tbm=nws',
    etfs: ['XLY', 'VCR', 'RETL'],
    nextCatalysts: [
      'Amazon·Tesla Q1 실적 (2026.04~05)',
      '중국 5.4월 소매판매 데이터',
      '미국 4월 CPI·PCE 발표',
    ],
  },

  'consumer-defensive': {
    id: 'consumer-defensive',
    name: '필수소비재',
    phase: '인플레 완화 + 사재기 소멸 — 정상 수요로 복귀, 마진 회복 국면',
    keyData: [
      { label: '미국 식료품 물가 YoY', value: '+2.1%', trend: 'down' },
      { label: 'P&G 유기적 매출 성장', value: '+3% YoY', trend: 'neutral' },
      { label: '코스트코 회원 갱신율', value: '93%', trend: 'up' },
      { label: '사모라벨 침투율', value: '21%', trend: 'up' },
    ],
    themes: [
      '원재료비 안정 → 대형 FMCG 마진 회복 (PG·MDLZ·KMB)',
      '사모라벨 강세 — 월마트·코스트코 자체브랜드 점유율 확대',
      '신흥국 프리미엄화 — Nestlé·Unilever 아시아 고마진 제품 확대',
      '음료 카테고리 이원화 — 탄산음료 침체 vs 에너지드링크 고성장',
      'GLP-1 확산 → 식품 칼로리 감소 제품 트렌드 변화',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=consumer+staples+FMCG+food+beverage+2026&tbm=nws',
    etfs: ['XLP', 'VDC', 'IYK'],
    nextCatalysts: [
      'P&G·KO·PEP·WMT Q1 실적 (2026.04)',
      '미국 3월 PCE 물가 발표',
      'Nielsen 소비 트렌드 Q1 리포트',
    ],
  },

  'materials': {
    id: 'materials',
    name: '소재',
    phase: '구리·희토류 구조적 수급 타이트 — 에너지 전환·AI 인프라 장기 수혜',
    keyData: [
      { label: '구리 현물가', value: '$9,850/t', trend: 'up' },
      { label: '희토류 영구자석 가격', value: '$82/kg (NdFeB)', trend: 'up' },
      { label: '알루미늄 재고 (LME)', value: '450K t (5년 최저)', trend: 'down' },
      { label: '글로벌 철강 가동률', value: '72%', trend: 'neutral' },
    ],
    themes: [
      '구리 — EV 배선·AI 데이터센터·전력망 수요 3중 수혜 (FCX·SCCO)',
      '희토류 — 중국 수출 통제 리스크 vs 미국 국내 채굴 보조금',
      '리튬 가격 반등 신호 — 과잉공급 해소 후 2026H2 회복 전망',
      '특수화학 — 반도체 포토레지스트·CMP 슬러리 수급 타이트',
      '탄소중립 소재 — 녹색 철강·저탄소 시멘트 PPA 확대',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=copper+lithium+materials+rare+earth+mining+2026&tbm=nws',
    etfs: ['XLB', 'VAW', 'REMX'],
    nextCatalysts: [
      'FCX·NEM·ALB Q1 실적 (2026.04~05)',
      '중국 희토류 수출 쿼터 2026H1 발표',
      'LME 구리 재고 월간 업데이트',
    ],
  },

  'real-estate': {
    id: 'real-estate',
    name: '부동산 (REIT)',
    phase: '금리 인하 + AI 데이터센터 REIT 수요 폭발 — 섹터 내 양극화 심화',
    keyData: [
      { label: '10년물 국채 금리', value: '4.35%', trend: 'down' },
      { label: '데이터센터 REIT 공실률', value: '1.2% (사상 최저)', trend: 'down' },
      { label: '오피스 공실률 (미국)', value: '19.8%', trend: 'up' },
      { label: '물류창고 신규공급 (2026E)', value: '-35% YoY', trend: 'down' },
    ],
    themes: [
      '데이터센터 REIT — AMT·EQIX·DLR AI 인프라 수요로 임차 풀 소진',
      '주거용 REIT — 금리 인하 기대감으로 가격 반등 베팅 시작',
      '오피스 REIT — 재택 지속 + 공급 과잉으로 구조적 압박',
      '물류창고 REIT — 신규공급 감소 + e커머스 성장으로 임대료 회복',
      '의료 REIT — 고령화 수요 견조, 요양원·생명과학 빌딩 인기',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=REIT+data+center+real+estate+interest+rate+2026&tbm=nws',
    etfs: ['VNQ', 'IYR', 'SCHH'],
    nextCatalysts: [
      'EQIX·AMT·PLD Q1 실적 (2026.04~05)',
      'Fed 금리 결정 (2026.05)',
      '미국 3월 주택판매 데이터',
    ],
  },

  'it-software': {
    id: 'it-software',
    name: 'IT / 소프트웨어',
    phase: 'AI 코파일럿 구독 전환 가속 — 전통 SaaS 성장률 차별화 심화',
    keyData: [
      { label: 'SaaS 시장 성장률 (2026E)', value: '+18% YoY', trend: 'up' },
      { label: 'AI 코파일럿 ARR 성장', value: '+320% YoY', trend: 'up' },
      { label: '기업 IT 예산 증가율', value: '+6% (AI 재배분)', trend: 'up' },
      { label: '전통 라이선스 시장', value: '-12% YoY', trend: 'down' },
    ],
    themes: [
      'AI 에이전트 상용화 — Salesforce Agentforce·ServiceNow 수혜',
      'Microsoft Copilot M365 — 기업 시트 전환율 가속 (30% → 60%)',
      '사이버보안 AI 통합 — CrowdStrike·Palo Alto 플랫폼 공고화',
      'Oracle 클라우드 + AI 인프라 계약 급증 — OCI 성장률 50%+',
      'ERP 현대화 — SAP S/4HANA 마이그레이션 마지막 사이클',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=enterprise+software+AI+copilot+SaaS+2026&tbm=nws',
    etfs: ['IGV', 'WCLD', 'BUG'],
    nextCatalysts: [
      'Salesforce·ServiceNow·CRM Q1 실적 (2026.05)',
      'Microsoft Build 컨퍼런스 (2026.05)',
      'CrowdStrike Fal.Con 2026 발표',
    ],
  },

  'communication-services': {
    id: 'communication-services',
    name: '커뮤니케이션 서비스',
    phase: '광고 회복 + 스트리밍 수익화 + AI 검색 전환 리스크 — 옥석 가리기',
    keyData: [
      { label: '글로벌 디지털 광고 성장', value: '+11% YoY', trend: 'up' },
      { label: 'Netflix 유료 구독자', value: '3.01억 명', trend: 'up' },
      { label: 'YouTube 광고 수익 YoY', value: '+21%', trend: 'up' },
      { label: 'AI 검색 점유율 (US)', value: '11%', trend: 'up' },
    ],
    themes: [
      'AI 검색(Perplexity·ChatGPT) → Google 검색 점유율 잠식 리스크',
      'Meta AI 추천 알고리즘 → Instagram·Threads 광고 단가 급등',
      '스트리밍 수익화 — Netflix·Disney+ 광고요금제 MAU 급증',
      'Podcast·오디오 광고 — Spotify AI DJ 수익 창출',
      '통신사 5G 투자 마무리 → FCF 개선·자사주 매입 기대',
    ],
    googleNewsUrl: 'https://www.google.com/search?q=digital+advertising+streaming+AI+search+2026&tbm=nws',
    etfs: ['XLC', 'VOX', 'IYZ'],
    nextCatalysts: [
      'Alphabet·Meta·Netflix Q1 실적 (2026.04~05)',
      'Google I/O AI Search 업데이트 (2026.05)',
      'FTC·DOJ Meta·Google 반독점 판결 일정',
    ],
  },
};
