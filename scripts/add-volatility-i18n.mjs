/**
 * /volatility 페이지 i18n 키 16개 언어 추가 스크립트.
 * 기존 keys 보존, 새 key 만 삽입. 두번 실행해도 idempotent.
 */
import { readFileSync, writeFileSync } from 'fs';

const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'tr', 'vi'];

// nav.volatility (단어 1개)
const NAV = {
  ko: '내재변동성',
  en: 'Volatility',
  ja: '内在ボラティリティ',
  'zh-CN': '隐含波动率',
  'zh-TW': '隱含波動率',
  es: 'Volatilidad',
  fr: 'Volatilité',
  de: 'Volatilität',
  pt: 'Volatilidade',
  ru: 'Волатильность',
  ar: 'التقلب',
  hi: 'अंतर्निहित अस्थिरता',
  id: 'Volatilitas',
  th: 'ความผันผวน',
  tr: 'Oynaklık',
  vi: 'Biến động ngụ ý',
};

// SEO
const SEO_TITLE = {
  ko: '내재변동성 스크리너 — Flowvium',
  en: 'Implied Volatility Screener — Flowvium',
  ja: '内在ボラティリティ・スクリーナー — Flowvium',
  'zh-CN': '隐含波动率筛选器 — Flowvium',
  'zh-TW': '隱含波動率篩選器 — Flowvium',
  es: 'Buscador de Volatilidad Implícita — Flowvium',
  fr: 'Outil de Volatilité Implicite — Flowvium',
  de: 'Implizite Volatilität Screener — Flowvium',
  pt: 'Triagem de Volatilidade Implícita — Flowvium',
  ru: 'Скринер подразумеваемой волатильности — Flowvium',
  ar: 'فاحص التقلب الضمني — Flowvium',
  hi: 'अंतर्निहित अस्थिरता स्क्रीनर — Flowvium',
  id: 'Pemindai Volatilitas Tersirat — Flowvium',
  th: 'เครื่องคัดกรองความผันผวนโดยนัย — Flowvium',
  tr: 'Örtük Oynaklık Tarayıcısı — Flowvium',
  vi: 'Bộ lọc Biến động ngụ ý — Flowvium',
};

const SEO_DESC = {
  ko: 'Bloomberg 식 옵션 내재변동성: 콜-풋 패리티로 forward 추출 + Brent 역산. 30d/90d ATM IV · 25Δ skew · term slope · IV rank.',
  en: 'Bloomberg-style options implied volatility: call-put parity forward extraction + Brent inversion. 30d/90d ATM IV, 25Δ skew, term slope, IV rank.',
  ja: 'ブルームバーグ方式の内在ボラティリティ。コール・プット・パリティでフォワード抽出+ブレント逆算。30d/90d ATM IV、25デルタスキュー、期間傾斜、IVランク。',
  'zh-CN': '彭博式期权隐含波动率：通过看涨看跌平价提取远期+布伦特反演。30/90日ATM IV、25Δ偏度、期限斜率、IV排名。',
  'zh-TW': '彭博式選擇權隱含波動率：透過買權賣權平價提取遠期+布倫特反演。30/90日ATM IV、25Δ偏度、期限斜率、IV排名。',
  es: 'Volatilidad implícita estilo Bloomberg: extracción de forward por paridad call-put + inversión Brent. IV ATM 30d/90d, skew 25Δ, pendiente, rank IV.',
  fr: 'Volatilité implicite façon Bloomberg : extraction du forward par parité call-put + inversion Brent. IV ATM 30j/90j, skew 25Δ, pente de term, rang IV.',
  de: 'Implizite Volatilität nach Bloomberg-Art: Forward-Extraktion via Call-Put-Parität + Brent-Inversion. 30T/90T ATM IV, 25Δ Skew, Term-Slope, IV-Rang.',
  pt: 'Volatilidade implícita estilo Bloomberg: extração de forward por paridade call-put + inversão de Brent. IV ATM 30d/90d, skew 25Δ, inclinação, rank IV.',
  ru: 'Подразумеваемая волатильность опционов в стиле Bloomberg: извлечение форвардной цены по паритету колл-пут + инверсия Брента. 30д/90д ATM IV, 25Δ скью, наклон, IV-ранг.',
  ar: 'التقلب الضمني للخيارات بأسلوب بلومبيرغ: استخراج الفورورد من تكافؤ كول-بوت + عكس برنت. 30/90 يوم ATM IV، انحراف 25 دلتا، ميل، رتبة IV.',
  hi: 'ब्लूमबर्ग-स्टाइल विकल्प अंतर्निहित अस्थिरता: कॉल-पुट पैरिटी फॉरवर्ड एक्सट्रैक्शन + ब्रेंट इन्वर्शन। 30d/90d ATM IV, 25Δ स्क्यू, टर्म स्लोप, IV रैंक।',
  id: 'Volatilitas tersirat ala Bloomberg: ekstraksi forward via paritas call-put + inversi Brent. ATM IV 30h/90h, skew 25Δ, kemiringan, IV rank.',
  th: 'ความผันผวนโดยนัยสไตล์ Bloomberg: ดึงค่าฟอร์เวิร์ดจากสมการ call-put parity + การแยกค่า Brent. ATM IV 30/90 วัน, สกิว 25Δ, ความชันเทอม, อันดับ IV.',
  tr: 'Bloomberg tarzı opsiyon örtük oynaklığı: call-put paritesinden vadeli fiyat çıkarımı + Brent ters çevirme. 30g/90g ATM IV, 25Δ çarpıklık, vade eğimi, IV sıralaması.',
  vi: 'Biến động ngụ ý kiểu Bloomberg: trích xuất forward từ tương đồng call-put + đảo ngược Brent. ATM IV 30d/90d, skew 25Δ, độ dốc kỳ hạn, IV rank.',
};

// 페이지 namespace (volatility.*)
const PAGE = {
  ko: {
    title: '내재변동성 스크리너',
    subtitle: '옵션 시장이 가격책정 중인 변동성 — 30d/90d ATM IV · 25Δ skew · term slope',
    loading: '체인 fetch + IV 역산 중...',
    methodologyTitle: '계산 방법:',
    methodologyParity: '콜-풋 패리티로 expiry 별 forward 추출 (r·q 가정 불필요)',
    methodologyBrent: "Brent's method 로 Black-76 시장가 → σ 역산 (bid/ask wide 환경에 robust)",
    methodologyInterp: 'variance-space 시간가중 보간으로 30d/90d ATM IV 산출',
    methodologyQuality: 'spread/OI/lastTradeDate 기반 stale quote 필터링 + quality score',
    errorBanner: '옵션 체인 fetch 실패 — Yahoo 차단 또는 일시적 오류. 캐시 만료 후 재시도.',
    colTicker: '티커',
    colSpot: '주가',
    colAtm30d: '30d ATM IV',
    colIvRank: 'IV 순위',
    colTermSlope: 'Term Slope (90d-30d)',
    colSkew: '25Δ Skew',
    colPcr: 'P/C',
    colQuality: '품질',
    colLink: '상세',
    colLinkLabel: '기업',
    empty: '표시할 데이터 없음',
    legendIvRank: 'IV 순위: 데이터셋 내 상대순위 (역사적 1y rank 아님)',
    legendSkew: 'Skew > 0 = 하방 두려움 (put 비싸짐)',
    legendTermSlope: 'Term slope < 0 = backwardation (단기 스트레스)',
    source: '소스',
    generatedAt: '생성',
    seoTitle: SEO_TITLE.ko,
    seoDescription: SEO_DESC.ko,
  },
  en: {
    title: 'Implied Volatility Screener',
    subtitle: 'What options markets price as volatility — 30d/90d ATM IV, 25Δ skew, term slope',
    loading: 'Fetching chain + inverting IV...',
    methodologyTitle: 'Methodology:',
    methodologyParity: 'Call-put parity extracts per-expiry forward (no r/q assumption)',
    methodologyBrent: 'Brent inversion on Black-76 mid prices (robust to wide bid/ask)',
    methodologyInterp: 'Variance-space time-weighted interpolation for 30d/90d ATM IV',
    methodologyQuality: 'Spread/OI/lastTradeDate filters + quality score',
    errorBanner: 'Options chain fetch failed — Yahoo block or transient error. Retry after cache expiry.',
    colTicker: 'Ticker',
    colSpot: 'Spot',
    colAtm30d: '30d ATM IV',
    colIvRank: 'IV Rank',
    colTermSlope: 'Term Slope (90d-30d)',
    colSkew: '25Δ Skew',
    colPcr: 'P/C',
    colQuality: 'Quality',
    colLink: 'Detail',
    colLinkLabel: 'Company',
    empty: 'No data to display',
    legendIvRank: 'IV Rank: relative position within dataset (not historical 1y rank)',
    legendSkew: 'Skew > 0 = downside fear (puts richer)',
    legendTermSlope: 'Term slope < 0 = backwardation (short-term stress)',
    source: 'Source',
    generatedAt: 'Generated',
    seoTitle: SEO_TITLE.en,
    seoDescription: SEO_DESC.en,
  },
};

// 나머지 14 언어는 영어 baseline 사용 (financial 전문용어는 영어 그대로 가는 게 일반적)
const FALLBACK_PAGE = (locale) => ({
  ...PAGE.en,
  title: { ja: '内在ボラティリティ・スクリーナー', 'zh-CN': '隐含波动率筛选器', 'zh-TW': '隱含波動率篩選器', es: 'Buscador de Volatilidad Implícita', fr: 'Volatilité Implicite', de: 'Implizite Volatilität', pt: 'Triagem de Volatilidade', ru: 'Скринер волатильности', ar: 'فاحص التقلب الضمني', hi: 'अंतर्निहित अस्थिरता स्क्रीनर', id: 'Pemindai Volatilitas', th: 'เครื่องคัดกรองความผันผวน', tr: 'Oynaklık Tarayıcısı', vi: 'Bộ lọc Biến động' }[locale] || PAGE.en.title,
  subtitle: PAGE.en.subtitle,
  loading: { ja: 'チェーン取得 + IV計算中...', 'zh-CN': '正在获取期权链 + 反演 IV...', 'zh-TW': '正在獲取選擇權鏈 + 反演 IV...', es: 'Obteniendo cadena + invirtiendo IV...', fr: 'Récupération de la chaîne + inversion de la VI...', de: 'Chain abrufen + IV invertieren...', pt: 'Buscando cadeia + invertendo IV...', ru: 'Получение цепочки + расчёт IV...', ar: 'جلب السلسلة + عكس IV...', hi: 'चेन प्राप्त + IV उलट रहा है...', id: 'Mengambil chain + inversi IV...', th: 'กำลังดึงเชน + คำนวณ IV...', tr: 'Zinciri çekiliyor + IV ters çevriliyor...', vi: 'Đang tải chain + tính IV...' }[locale] || PAGE.en.loading,
  seoTitle: SEO_TITLE[locale] ?? SEO_TITLE.en,
  seoDescription: SEO_DESC[locale] ?? SEO_DESC.en,
});

for (const locale of LOCALES) {
  const path = `messages/${locale}.json`;
  const raw = readFileSync(path, 'utf8');
  const obj = JSON.parse(raw);

  // nav.volatility
  obj.nav = obj.nav ?? {};
  obj.nav.volatility = NAV[locale] ?? NAV.en;

  // seo.volatilityTitle / volatilityDescription
  obj.seo = obj.seo ?? {};
  obj.seo.volatilityTitle = SEO_TITLE[locale] ?? SEO_TITLE.en;
  obj.seo.volatilityDescription = SEO_DESC[locale] ?? SEO_DESC.en;

  // volatility.*
  obj.volatility = PAGE[locale] ?? FALLBACK_PAGE(locale);

  // navDesc (Navbar 의 desc 표시용 — 다른 항목과 패턴 맞춰서)
  obj.nav.volatilityDesc = obj.nav.volatilityDesc ?? {
    ko: '옵션 IV·skew·term',
    en: 'Options IV · skew · term',
    ja: 'オプションIV・スキュー',
    'zh-CN': '期权IV·偏度·期限',
    'zh-TW': '選擇權IV·偏度·期限',
    es: 'Opciones IV · skew',
    fr: 'Options IV · skew',
    de: 'Optionen IV · Skew',
    pt: 'Opções IV · skew',
    ru: 'Опционы IV · скью',
    ar: 'خيارات IV · انحراف',
    hi: 'विकल्प IV · स्क्यू',
    id: 'Opsi IV · skew',
    th: 'ออปชั่น IV · skew',
    tr: 'Opsiyon IV · çarpıklık',
    vi: 'Quyền chọn IV · skew',
  }[locale] ?? 'Options IV · skew';

  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`✓ ${locale}`);
}
console.log('\nDone. 16 locales updated.');
