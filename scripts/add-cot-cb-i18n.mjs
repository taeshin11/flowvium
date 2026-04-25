#!/usr/bin/env node
// Add CotTab sentiment + CreditBalanceTab i18n keys to all 16 locale files

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, '..', 'messages');

const LOCALES = ['ko','en','ja','zh-CN','zh-TW','es','fr','de','pt','ru','ar','hi','id','th','tr','vi'];

const KEYS = {
  // ── CotTab sentiment labels ────────────────────────────────────────────────
  cotBullish: {
    ko: '강세', en: 'Bullish', ja: '強気', 'zh-CN': '看涨', 'zh-TW': '看漲',
    es: 'Alcista', fr: 'Haussier', de: 'Bullisch', pt: 'Altista', ru: 'Бычий',
    ar: 'صعودي', hi: 'तेजी', id: 'Bullish', th: 'กระทิง', tr: 'Yükseliş', vi: 'Tăng',
  },
  cotBearish: {
    ko: '약세', en: 'Bearish', ja: '弱気', 'zh-CN': '看跌', 'zh-TW': '看跌',
    es: 'Bajista', fr: 'Baissier', de: 'Bärisch', pt: 'Baixista', ru: 'Медвежий',
    ar: 'هبوطي', hi: 'मंदी', id: 'Bearish', th: 'หมี', tr: 'Düşüş', vi: 'Giảm',
  },
  cotNeutral: {
    ko: '중립', en: 'Neutral', ja: '中立', 'zh-CN': '中性', 'zh-TW': '中性',
    es: 'Neutral', fr: 'Neutre', de: 'Neutral', pt: 'Neutro', ru: 'Нейтральный',
    ar: 'محايد', hi: 'तटस्थ', id: 'Netral', th: 'เป็นกลาง', tr: 'Nötr', vi: 'Trung lập',
  },

  // ── CreditBalanceTab ───────────────────────────────────────────────────────
  cbRiskLow: {
    ko: '안전', en: 'Safe', ja: '安全', 'zh-CN': '安全', 'zh-TW': '安全',
    es: 'Seguro', fr: 'Sûr', de: 'Sicher', pt: 'Seguro', ru: 'Безопасно',
    ar: 'آمن', hi: 'सुरक्षित', id: 'Aman', th: 'ปลอดภัย', tr: 'Güvenli', vi: 'An toàn',
  },
  cbRiskMedium: {
    ko: '주의', en: 'Caution', ja: '注意', 'zh-CN': '注意', 'zh-TW': '注意',
    es: 'Precaución', fr: 'Attention', de: 'Vorsicht', pt: 'Atenção', ru: 'Осторожно',
    ar: 'تنبيه', hi: 'सावधान', id: 'Waspada', th: 'ระวัง', tr: 'Dikkat', vi: 'Thận trọng',
  },
  cbRiskHigh: {
    ko: '경계', en: 'Warning', ja: '警戒', 'zh-CN': '警戒', 'zh-TW': '警戒',
    es: 'Alerta', fr: 'Alerte', de: 'Warnung', pt: 'Alerta', ru: 'Предупреждение',
    ar: 'تحذير', hi: 'चेतावनी', id: 'Peringatan', th: 'เตือน', tr: 'Uyarı', vi: 'Cảnh báo',
  },
  cbRiskExtreme: {
    ko: '위험', en: 'Danger', ja: '危険', 'zh-CN': '危险', 'zh-TW': '危險',
    es: 'Peligro', fr: 'Danger', de: 'Gefahr', pt: 'Perigo', ru: 'Опасно',
    ar: 'خطر', hi: 'खतरा', id: 'Bahaya', th: 'อันตราย', tr: 'Tehlike', vi: 'Nguy hiểm',
  },
  cbGaugeMin: {
    ko: '최저 {v}%', en: 'Min {v}%', ja: '最低 {v}%', 'zh-CN': '最低 {v}%', 'zh-TW': '最低 {v}%',
    es: 'Mín {v}%', fr: 'Min {v}%', de: 'Min {v}%', pt: 'Mín {v}%', ru: 'Мин {v}%',
    ar: '{v}% أدنى', hi: 'न्यूनतम {v}%', id: 'Min {v}%', th: 'ต่ำสุด {v}%', tr: 'Min {v}%', vi: 'Min {v}%',
  },
  cbGaugeCurrent: {
    ko: '현재 {v}%', en: 'Now {v}%', ja: '現在 {v}%', 'zh-CN': '当前 {v}%', 'zh-TW': '目前 {v}%',
    es: 'Ahora {v}%', fr: 'Actuel {v}%', de: 'Aktuell {v}%', pt: 'Atual {v}%', ru: 'Сейчас {v}%',
    ar: '{v}% الآن', hi: 'अभी {v}%', id: 'Saat ini {v}%', th: 'ปัจจุบัน {v}%', tr: 'Şimdi {v}%', vi: 'Hiện tại {v}%',
  },
  cbGaugeMax: {
    ko: '최고 {v}%', en: 'Max {v}%', ja: '最高 {v}%', 'zh-CN': '最高 {v}%', 'zh-TW': '最高 {v}%',
    es: 'Máx {v}%', fr: 'Max {v}%', de: 'Max {v}%', pt: 'Máx {v}%', ru: 'Макс {v}%',
    ar: '{v}% أقصى', hi: 'अधिकतम {v}%', id: 'Max {v}%', th: 'สูงสุด {v}%', tr: 'Maks {v}%', vi: 'Max {v}%',
  },
  cbLoading: {
    ko: '신용잔고 데이터 로딩중...', en: 'Loading margin balance data...',
    ja: '信用残高データ読込中...', 'zh-CN': '正在加载融资余额数据...', 'zh-TW': '正在載入融資餘額資料...',
    es: 'Cargando datos de saldo de margen...', fr: 'Chargement des données de marge...',
    de: 'Marginaldaten werden geladen...', pt: 'Carregando dados de margem...', ru: 'Загрузка данных маржи...',
    ar: 'جاري تحميل بيانات الهامش...', hi: 'मार्जिन बैलेंस डेटा लोड हो रहा है...',
    id: 'Memuat data saldo margin...', th: 'กำลังโหลดข้อมูลยอดมาร์จิ้น...', tr: 'Marj verileri yükleniyor...', vi: 'Đang tải dữ liệu số dư ký quỹ...',
  },
  cbTitle: {
    ko: '국가별 신용잔고 — 시장 레버리지 지도', en: 'Margin Balance by Country — Market Leverage Map',
    ja: '国別信用残高 — 市場レバレッジマップ', 'zh-CN': '各国融资余额 — 市场杠杆地图', 'zh-TW': '各國融資餘額 — 市場槓桿地圖',
    es: 'Saldo de Margen por País — Mapa de Apalancamiento', fr: 'Solde de Marge par Pays — Carte de Levier',
    de: 'Marginbalance nach Land — Hebelkarte', pt: 'Saldo de Margem por País — Mapa de Alavancagem',
    ru: 'Маржинальный баланс по странам — Карта кредитного плеча',
    ar: 'رصيد الهامش حسب الدولة — خريطة الرافعة المالية',
    hi: 'देश के अनुसार मार्जिन बैलेंस — बाजार लीवरेज मैप',
    id: 'Saldo Margin per Negara — Peta Leverage Pasar',
    th: 'ยอดมาร์จิ้นตามประเทศ — แผนที่เลเวอเรจตลาด',
    tr: 'Ülkeye Göre Marj Bakiyesi — Piyasa Kaldıraç Haritası',
    vi: 'Số Dư Ký Quỹ theo Quốc Gia — Bản Đồ Đòn Bẩy',
  },
  cbDesc: {
    ko: '투자자들이 주식을 사기 위해 빌린 돈의 총합이에요. GDP 대비 비율과 역대 비교로 현재 시장이 얼마나 과열됐는지, 조정 리스크가 얼마나 큰지 볼 수 있어요.',
    en: 'Total amount borrowed by investors to buy stocks. GDP ratio vs. historical comparison shows how overheated the market is and how large the correction risk is.',
    ja: '投資家が株を買うために借りた資金の総額。対GDP比と歴史的比較で市場の過熱度と調整リスクを確認できます。',
    'zh-CN': '投资者借钱买股票的总额。通过与GDP的比率和历史比较，可以看出市场过热程度和回调风险。',
    'zh-TW': '投資者借錢買股票的總額。透過GDP比率與歷史比較，可以看出市場過熱程度和回調風險。',
    es: 'Total prestado por inversores para comprar acciones. La ratio sobre PIB vs. comparativa histórica muestra el sobrecalentamiento del mercado y el riesgo de corrección.',
    fr: 'Total emprunté par les investisseurs pour acheter des actions. Ratio PIB vs. historique montre la surchauffe du marché et le risque de correction.',
    de: 'Gesamtbetrag, den Anleger zum Aktienkauf geliehen haben. BIP-Verhältnis vs. historischer Vergleich zeigt Überhitzung und Korrekturrisiko.',
    pt: 'Total emprestado por investidores para comprar ações. Razão PIB vs. histórico mostra aquecimento e risco de correção.',
    ru: 'Общая сумма, взятая инвесторами в долг для покупки акций. Соотношение ВВП vs. исторические данные показывает перегрев рынка.',
    ar: 'إجمالي ما اقترضه المستثمرون لشراء الأسهم. نسبة الناتج المحلي مقارنة بالتاريخ تظهر مدى ارتفاع الحرارة ومخاطر التصحيح.',
    hi: 'निवेशकों द्वारा शेयर खरीदने के लिए उधार ली गई कुल राशि। GDP अनुपात बनाम ऐतिहासिक तुलना बाजार की गर्मी दिखाती है।',
    id: 'Total yang dipinjam investor untuk membeli saham. Rasio GDP vs. perbandingan historis menunjukkan panas pasar dan risiko koreksi.',
    th: 'ยอดรวมที่นักลงทุนกู้ยืมเพื่อซื้อหุ้น อัตราส่วน GDP เทียบกับประวัติศาสตร์แสดงความร้อนแรงของตลาด',
    tr: 'Yatırımcıların hisse senedi almak için ödünç aldığı toplam tutar. GDP oranı ve tarihsel karşılaştırma piyasa aşırı ısınmasını gösterir.',
    vi: 'Tổng số tiền nhà đầu tư vay để mua cổ phiếu. Tỷ lệ GDP so với lịch sử cho thấy mức độ nóng của thị trường.',
  },
  cbGlobalTotal: {
    ko: '글로벌 신용잔고 합산', en: 'Global Margin Balance',
    ja: 'グローバル信用残高', 'zh-CN': '全球融资余额', 'zh-TW': '全球融資餘額',
    es: 'Saldo de Margen Global', fr: 'Solde de Marge Mondial', de: 'Globale Marginbalance',
    pt: 'Saldo de Margem Global', ru: 'Глобальный маржинальный баланс',
    ar: 'رصيد الهامش العالمي', hi: 'वैश्विक मार्जिन बैलेंस', id: 'Saldo Margin Global',
    th: 'ยอดมาร์จิ้นทั่วโลก', tr: 'Küresel Marj Bakiyesi', vi: 'Số Dư Ký Quỹ Toàn Cầu',
  },
  cbGlobalGdp: {
    ko: '합산 GDP 대비', en: '% of Combined GDP',
    ja: '合算GDP比', 'zh-CN': '占合计GDP比', 'zh-TW': '占合計GDP比',
    es: '% del PIB Combinado', fr: '% du PIB Combiné', de: '% des kombinierten BIP',
    pt: '% do PIB Combinado', ru: '% совокупного ВВП',
    ar: '% من الناتج المحلي المشترك', hi: 'संयुक्त GDP का %', id: '% dari GDP Gabungan',
    th: '% ของ GDP รวม', tr: 'Birleşik GSYİH\'nin %\'si', vi: '% GDP Kết Hợp',
  },
  cbHighRiskCount: {
    ko: '경계/위험 국가 수', en: 'Warning/Danger Countries',
    ja: '警戒/危険国数', 'zh-CN': '警戒/危险国家数', 'zh-TW': '警戒/危險國家數',
    es: 'Países en Alerta/Peligro', fr: 'Pays Alerte/Danger', de: 'Warn-/Gefahrländer',
    pt: 'Países em Alerta/Perigo', ru: 'Страны в зоне риска',
    ar: 'دول التحذير/الخطر', hi: 'चेतावनी/खतरा देश', id: 'Negara Peringatan/Bahaya',
    th: 'ประเทศเตือน/อันตราย', tr: 'Uyarı/Tehlike Ülkeleri', vi: 'Quốc Gia Cảnh Báo/Nguy Hiểm',
  },
  cbFastestGrowing: {
    ko: '가장 빠른 증가', en: 'Fastest Growing',
    ja: '最速成長', 'zh-CN': '增长最快', 'zh-TW': '成長最快',
    es: 'Mayor Crecimiento', fr: 'Croissance la Plus Rapide', de: 'Schnellstes Wachstum',
    pt: 'Maior Crescimento', ru: 'Быстрейший рост',
    ar: 'الأسرع نمواً', hi: 'सबसे तेज वृद्धि', id: 'Pertumbuhan Tercepat',
    th: 'เติบโตเร็วที่สุด', tr: 'En Hızlı Büyüyen', vi: 'Tăng Trưởng Nhanh Nhất',
  },
  cbViewGdp: {
    ko: 'GDP 비율', en: 'GDP Ratio', ja: 'GDP比', 'zh-CN': 'GDP比率', 'zh-TW': 'GDP比率',
    es: 'Ratio PIB', fr: 'Ratio PIB', de: 'BIP-Verhältnis', pt: 'Razão PIB', ru: 'Соотношение ВВП',
    ar: 'نسبة الناتج المحلي', hi: 'GDP अनुपात', id: 'Rasio GDP', th: 'อัตราส่วน GDP', tr: 'GSYİH Oranı', vi: 'Tỷ Lệ GDP',
  },
  cbViewBalance: {
    ko: '금액(USD)', en: 'Amount (USD)', ja: '金額(USD)', 'zh-CN': '金额(USD)', 'zh-TW': '金額(USD)',
    es: 'Monto (USD)', fr: 'Montant (USD)', de: 'Betrag (USD)', pt: 'Valor (USD)', ru: 'Сумма (USD)',
    ar: 'المبلغ (دولار)', hi: 'राशि (USD)', id: 'Jumlah (USD)', th: 'จำนวน (USD)', tr: 'Miktar (USD)', vi: 'Số Tiền (USD)',
  },
  cbLegacyPct: {
    ko: '역대 {p}th', en: 'All-time {p}th', ja: '全期間 {p}th', 'zh-CN': '历史第{p}百分位', 'zh-TW': '歷史第{p}百分位',
    es: '{p}th histórico', fr: '{p}e historique', de: 'Historisch {p}ster', pt: '{p}th histórico', ru: 'Исторически {p}й',
    ar: 'تاريخياً {p}th', hi: 'सर्वकालिक {p}th', id: 'Sepanjang masa {p}th', th: 'ตลอดกาล {p}th', tr: 'Tüm zamanlar {p}th', vi: 'Mọi thời đại {p}th',
  },
  cbExplainTitle: {
    ko: '💡 쉬운 설명', en: '💡 Plain English', ja: '💡 わかりやすい説明', 'zh-CN': '💡 通俗解释', 'zh-TW': '💡 通俗解釋',
    es: '💡 Explicación Simple', fr: '💡 Explication Simple', de: '💡 Einfache Erklärung', pt: '💡 Explicação Simples', ru: '💡 Простое объяснение',
    ar: '💡 شرح بسيط', hi: '💡 सरल व्याख्या', id: '💡 Penjelasan Sederhana', th: '💡 คำอธิบายง่ายๆ', tr: '💡 Basit Açıklama', vi: '💡 Giải Thích Đơn Giản',
  },
  cbCurrentBalance: {
    ko: '현재 신용잔고', en: 'Current Balance', ja: '現在の信用残高', 'zh-CN': '当前融资余额', 'zh-TW': '目前融資餘額',
    es: 'Saldo Actual', fr: 'Solde Actuel', de: 'Aktueller Saldo', pt: 'Saldo Atual', ru: 'Текущий баланс',
    ar: 'الرصيد الحالي', hi: 'वर्तमान बैलेंस', id: 'Saldo Saat Ini', th: 'ยอดปัจจุบัน', tr: 'Mevcut Bakiye', vi: 'Số Dư Hiện Tại',
  },
  cbGdpRatio: {
    ko: 'GDP 대비', en: 'GDP Ratio', ja: 'GDP比', 'zh-CN': 'GDP比', 'zh-TW': 'GDP比',
    es: 'Ratio PIB', fr: 'Ratio PIB', de: 'BIP-Ratio', pt: 'Razão PIB', ru: '% ВВП',
    ar: 'نسبة GDP', hi: 'GDP अनुपात', id: 'Rasio GDP', th: 'อัตราส่วน GDP', tr: 'GSYİH Oranı', vi: 'Tỷ Lệ GDP',
  },
  cbYoY: {
    ko: 'YoY 변화', en: 'YoY Change', ja: '前年比', 'zh-CN': '同比变化', 'zh-TW': '年增變化',
    es: 'Cambio YoY', fr: 'Variation AA', de: 'Jahresvergleich', pt: 'Variação AA', ru: 'Изменение г/г',
    ar: 'تغيير سنوي', hi: 'YoY बदलाव', id: 'Perubahan YoY', th: 'การเปลี่ยนแปลง YoY', tr: 'Yıllık Değişim', vi: 'Thay Đổi YoY',
  },
  cbYoYNote: {
    ko: '전년 동기 대비', en: 'Year-over-year', ja: '前年同期比', 'zh-CN': '与去年同期相比', 'zh-TW': '與去年同期相比',
    es: 'Año contra año', fr: 'Année sur année', de: 'Jahresvergleich', pt: 'Ano a ano', ru: 'Год к году',
    ar: 'مقارنة بالعام الماضي', hi: 'साल दर साल', id: 'Tahun ke tahun', th: 'ปีต่อปี', tr: 'Yıldan yıla', vi: 'So với năm trước',
  },
  cbPeak: {
    ko: '역대 최고', en: 'All-time High', ja: '過去最高', 'zh-CN': '历史最高', 'zh-TW': '歷史最高',
    es: 'Máximo Histórico', fr: 'Record Historique', de: 'Allzeithoch', pt: 'Máximo Histórico', ru: 'Исторический максимум',
    ar: 'أعلى مستوى على الإطلاق', hi: 'सर्वकालिक उच्च', id: 'Tertinggi Sepanjang Masa', th: 'สูงสุดตลอดกาล', tr: 'Tüm Zamanların En Yükseği', vi: 'Cao Nhất Mọi Thời Đại',
  },
  cbPercentileNote: {
    ko: '현재 역대 {p}th', en: 'Currently {p}th all-time', ja: '現在は全期間で{p}th', 'zh-CN': '当前历史百分位{p}th', 'zh-TW': '目前歷史百分位{p}th',
    es: 'Actualmente {p}th histórico', fr: 'Actuellement {p}e historique', de: 'Derzeit historisch {p}ster', pt: 'Atualmente {p}th histórico', ru: 'Сейчас {p}й исторически',
    ar: 'حالياً {p}th تاريخياً', hi: 'वर्तमान में {p}th सर्वकालिक', id: 'Saat ini {p}th sepanjang masa', th: 'ปัจจุบัน {p}th ตลอดกาล', tr: 'Şu an tarihsel {p}th', vi: 'Hiện tại {p}th mọi thời đại',
  },
  cbHistTitle: {
    ko: '역사적 추이', en: 'Historical Trend', ja: '歴史的推移', 'zh-CN': '历史趋势', 'zh-TW': '歷史趨勢',
    es: 'Tendencia Histórica', fr: 'Tendance Historique', de: 'Historischer Trend', pt: 'Tendência Histórica', ru: 'Исторический тренд',
    ar: 'الاتجاه التاريخي', hi: 'ऐतिहासिक प्रवृत्ति', id: 'Tren Historis', th: 'แนวโน้มในอดีต', tr: 'Tarihsel Eğilim', vi: 'Xu Hướng Lịch Sử',
  },
  cbHistAxisGdp: {
    ko: 'GDP 대비 %', en: '% of GDP', ja: 'GDP比%', 'zh-CN': '占GDP%', 'zh-TW': '占GDP%',
    es: '% del PIB', fr: '% du PIB', de: '% des BIP', pt: '% do PIB', ru: '% ВВП',
    ar: '% من الناتج المحلي', hi: 'GDP का %', id: '% dari GDP', th: '% ของ GDP', tr: 'GSYİH\'nin %\'si', vi: '% GDP',
  },
  cbHistAxisBal: {
    ko: 'USD 십억', en: 'USD Billions', ja: '10億ドル', 'zh-CN': '亿美元', 'zh-TW': '十億美元',
    es: 'Miles de Mill. USD', fr: 'Milliards USD', de: 'Mrd. USD', pt: 'Bil. USD', ru: 'Млрд USD',
    ar: 'مليار دولار', hi: 'अरब USD', id: 'Miliar USD', th: 'พันล้าน USD', tr: 'Milyar USD', vi: 'Tỷ USD',
  },
  cbLegendPeak: {
    ko: '역대 최고', en: 'All-time High', ja: '過去最高', 'zh-CN': '历史最高', 'zh-TW': '歷史最高',
    es: 'Máximo Histórico', fr: 'Record', de: 'Allzeithoch', pt: 'Máximo', ru: 'Максимум',
    ar: 'أعلى مستوى', hi: 'सर्वकालिक उच्च', id: 'Tertinggi', th: 'สูงสุดตลอดกาล', tr: 'Tüm Zamanlar Yüksek', vi: 'Cao Nhất',
  },
  cbLegendCurrent: {
    ko: '현재', en: 'Current', ja: '現在', 'zh-CN': '当前', 'zh-TW': '目前',
    es: 'Actual', fr: 'Actuel', de: 'Aktuell', pt: 'Atual', ru: 'Текущий',
    ar: 'الحالي', hi: 'वर्तमान', id: 'Saat Ini', th: 'ปัจจุบัน', tr: 'Mevcut', vi: 'Hiện Tại',
  },
  cbLegendPast: {
    ko: '과거', en: 'Historical', ja: '過去', 'zh-CN': '历史', 'zh-TW': '歷史',
    es: 'Histórico', fr: 'Historique', de: 'Historisch', pt: 'Histórico', ru: 'Исторический',
    ar: 'تاريخي', hi: 'ऐतिहासिक', id: 'Historis', th: 'ในอดีต', tr: 'Tarihsel', vi: 'Lịch Sử',
  },
  cbRiskAnalysis: {
    ko: '리스크 분석: ', en: 'Risk Analysis: ', ja: 'リスク分析: ', 'zh-CN': '风险分析: ', 'zh-TW': '風險分析: ',
    es: 'Análisis de Riesgo: ', fr: 'Analyse des Risques: ', de: 'Risikoanalyse: ', pt: 'Análise de Risco: ', ru: 'Анализ рисков: ',
    ar: 'تحليل المخاطر: ', hi: 'जोखिम विश्लेषण: ', id: 'Analisis Risiko: ', th: 'การวิเคราะห์ความเสี่ยง: ', tr: 'Risk Analizi: ', vi: 'Phân Tích Rủi Ro: ',
  },
  cbUsHistTitle: {
    ko: '🇺🇸 미국 신용잔고 장기 역사 — 닷컴버블부터 현재까지',
    en: '🇺🇸 US Margin Balance Long History — Dot-com Bubble to Present',
    ja: '🇺🇸 米国信用残高の長期推移 — ドットコムバブルから現在まで',
    'zh-CN': '🇺🇸 美国融资余额长期历史 — 从互联网泡沫至今',
    'zh-TW': '🇺🇸 美國融資餘額長期歷史 — 從網路泡沫至今',
    es: '🇺🇸 Historial Largo del Saldo de Margen de EE.UU. — Burbuja Puntocom al Presente',
    fr: '🇺🇸 Historique Long du Solde de Marge US — De la Bulle Internet à Aujourd\'hui',
    de: '🇺🇸 US Marginbalance Langzeitgeschichte — Von der Dotcom-Blase bis heute',
    pt: '🇺🇸 Histórico Longo do Saldo de Margem EUA — Da Bolha da Internet ao Presente',
    ru: '🇺🇸 Долгосрочная история маржинального баланса США — От пузыря дот-комов до наших дней',
    ar: '🇺🇸 تاريخ طويل لرصيد هامش الولايات المتحدة — من فقاعة الإنترنت حتى الآن',
    hi: '🇺🇸 US मार्जिन बैलेंस का लंबा इतिहास — डॉट-कॉम बबल से वर्तमान तक',
    id: '🇺🇸 Sejarah Panjang Saldo Margin AS — Dari Gelembung Dotcom hingga Saat Ini',
    th: '🇺🇸 ประวัติยาวของยอดมาร์จิ้น US — จากฟองสบู่ดอทคอมถึงปัจจุบัน',
    tr: '🇺🇸 ABD Marj Bakiyesi Uzun Tarihi — Dotcom Balonundan Günümüze',
    vi: '🇺🇸 Lịch Sử Dài Số Dư Ký Quỹ Mỹ — Từ Bong Bóng Dot-com Đến Hiện Tại',
  },
  cbUsHistDesc: {
    ko: '역대 시장 버블·붕괴와 신용잔고의 관계. 현재 위치를 역사적 맥락에서 봐요.',
    en: 'Historical relationship between market bubbles/crashes and margin balance. View current position in historical context.',
    ja: '歴史的な市場バブル・崩壊と信用残高の関係。現在の位置を歴史的文脈で確認できます。',
    'zh-CN': '历史市场泡沫/崩溃与融资余额的关系。在历史背景下查看当前位置。',
    'zh-TW': '歷史市場泡沫/崩潰與融資餘額的關係。在歷史背景下查看目前位置。',
    es: 'Relación histórica entre burbujas/crashs del mercado y el saldo de margen. Vea la posición actual en contexto histórico.',
    fr: 'Relation historique entre les bulles/krachs et le solde de marge. Voir la position actuelle en contexte historique.',
    de: 'Historische Beziehung zwischen Marktblasen/-crashs und Marginbalance. Aktuelle Position im historischen Kontext.',
    pt: 'Relação histórica entre bolhas/crashes do mercado e saldo de margem. Veja a posição atual em contexto histórico.',
    ru: 'Историческая связь между рыночными пузырями/крахами и маржинальным балансом. Текущая позиция в историческом контексте.',
    ar: 'العلاقة التاريخية بين فقاعات السوق/الانهيارات ورصيد الهامش. انظر الموضع الحالي في السياق التاريخي.',
    hi: 'बाजार के बुलबुले/क्रैश और मार्जिन बैलेंस के बीच ऐतिहासिक संबंध। ऐतिहासिक संदर्भ में वर्तमान स्थिति देखें।',
    id: 'Hubungan historis antara gelembung/crash pasar dan saldo margin. Lihat posisi saat ini dalam konteks historis.',
    th: 'ความสัมพันธ์ทางประวัติศาสตร์ระหว่างฟองสบู่/การล่มสลายของตลาดและยอดมาร์จิ้น',
    tr: 'Piyasa balonları/çöküşleri ve marj bakiyesi arasındaki tarihsel ilişki.',
    vi: 'Mối quan hệ lịch sử giữa bong bóng/sụp đổ thị trường và số dư ký quỹ.',
  },
  cbTooltipFull: {
    ko: 'GDP비 {v}% · ${b}B', en: 'GDP ratio {v}% · ${b}B', ja: 'GDP比 {v}% · ${b}B',
    'zh-CN': 'GDP比 {v}% · ${b}B', 'zh-TW': 'GDP比 {v}% · ${b}B',
    es: 'Ratio PIB {v}% · ${b}B', fr: 'Ratio PIB {v}% · ${b}B', de: 'BIP-Ratio {v}% · ${b}B',
    pt: 'Razão PIB {v}% · ${b}B', ru: 'ВВП% {v}% · ${b}B',
    ar: 'نسبة GDP {v}% · ${b}B', hi: 'GDP अनुपात {v}% · ${b}B', id: 'Rasio GDP {v}% · ${b}B',
    th: 'อัตราส่วน GDP {v}% · ${b}B', tr: 'GSYİH Oranı {v}% · ${b}B', vi: 'Tỷ lệ GDP {v}% · ${b}B',
  },
  cbEra1Label: {
    ko: '닷컴버블', en: 'Dot-com Bubble', ja: 'ドットコムバブル', 'zh-CN': '互联网泡沫', 'zh-TW': '網路泡沫',
    es: 'Burbuja Puntocom', fr: 'Bulle Internet', de: 'Dotcom-Blase', pt: 'Bolha da Internet', ru: 'Пузырь дот-комов',
    ar: 'فقاعة الدوت كوم', hi: 'डॉट-कॉम बुलबुला', id: 'Gelembung Dotcom', th: 'ฟองสบู่ดอทคอม', tr: 'Dotcom Balonu', vi: 'Bong Bóng Dot-com',
  },
  cbEra1Desc: {
    ko: 'GDP비 2.7% → 1.3% 급락. 나스닥 -78% 동반.', en: 'GDP ratio 2.7% → 1.3% drop. Nasdaq -78%.',
    ja: 'GDP比 2.7% → 1.3%急落。ナスダック-78%。', 'zh-CN': 'GDP比2.7%→1.3%暴跌。纳斯达克-78%。', 'zh-TW': 'GDP比2.7%→1.3%暴跌。那斯達克-78%。',
    es: 'Ratio PIB 2.7% → 1.3%. Nasdaq -78%.', fr: 'Ratio PIB 2.7% → 1.3%. Nasdaq -78%.', de: 'BIP-Ratio 2.7% → 1.3%. Nasdaq -78%.',
    pt: 'Razão PIB 2.7% → 1.3%. Nasdaq -78%.', ru: 'ВВП% 2.7% → 1.3%. Nasdaq -78%.',
    ar: 'نسبة GDP 2.7%←1.3%. ناسداك -78%.', hi: 'GDP अनुपात 2.7%→1.3%। Nasdaq -78%।', id: 'Rasio GDP 2.7% → 1.3%. Nasdaq -78%.',
    th: 'GDP ratio 2.7% → 1.3%. Nasdaq -78%.', tr: 'GDP oranı 2.7% → 1.3%. Nasdaq -78%.', vi: 'Tỷ lệ GDP 2.7% → 1.3%. Nasdaq -78%.',
  },
  cbEra2Label: {
    ko: '금융위기', en: 'Financial Crisis', ja: '金融危機', 'zh-CN': '金融危机', 'zh-TW': '金融危機',
    es: 'Crisis Financiera', fr: 'Crise Financière', de: 'Finanzkrise', pt: 'Crise Financeira', ru: 'Финансовый кризис',
    ar: 'الأزمة المالية', hi: 'वित्तीय संकट', id: 'Krisis Keuangan', th: 'วิกฤตการเงิน', tr: 'Finansal Kriz', vi: 'Khủng Hoảng Tài Chính',
  },
  cbEra2Desc: {
    ko: 'GDP비 2.6% → 1.6%. S&P500 -57% 동반.', en: 'GDP ratio 2.6% → 1.6%. S&P500 -57%.',
    ja: 'GDP比 2.6% → 1.6%。S&P500 -57%。', 'zh-CN': 'GDP比2.6%→1.6%。S&P500-57%。', 'zh-TW': 'GDP比2.6%→1.6%。S&P500-57%。',
    es: 'Ratio PIB 2.6% → 1.6%. S&P500 -57%.', fr: 'Ratio PIB 2.6% → 1.6%. S&P500 -57%.', de: 'BIP-Ratio 2.6% → 1.6%. S&P500 -57%.',
    pt: 'Razão PIB 2.6% → 1.6%. S&P500 -57%.', ru: 'ВВП% 2.6% → 1.6%. S&P500 -57%.',
    ar: 'نسبة GDP 2.6%←1.6%. S&P500 -57%.', hi: 'GDP अनुपात 2.6%→1.6%। S&P500 -57%।', id: 'Rasio GDP 2.6% → 1.6%. S&P500 -57%.',
    th: 'GDP ratio 2.6% → 1.6%. S&P500 -57%.', tr: 'GDP oranı 2.6% → 1.6%. S&P500 -57%.', vi: 'Tỷ lệ GDP 2.6% → 1.6%. S&P500 -57%.',
  },
  cbEra3Label: {
    ko: '팬데믹 버블', en: 'Pandemic Bubble', ja: 'パンデミックバブル', 'zh-CN': '疫情泡沫', 'zh-TW': '疫情泡沫',
    es: 'Burbuja Pandémica', fr: 'Bulle Pandémique', de: 'Pandemie-Blase', pt: 'Bolha Pandêmica', ru: 'Пандемический пузырь',
    ar: 'فقاعة الوباء', hi: 'महामारी बुलबुला', id: 'Gelembung Pandemi', th: 'ฟองสบู่โรคระบาด', tr: 'Pandemi Balonu', vi: 'Bong Bóng Đại Dịch',
  },
  cbEra3Desc: {
    ko: 'GDP비 4.1%(최고) → 2.5%. 연준 긴축에 급락.', en: 'GDP ratio 4.1% (peak) → 2.5%. Fed tightening caused sharp drop.',
    ja: 'GDP比 4.1%(最高) → 2.5%。Fed引き締めで急落。', 'zh-CN': 'GDP比4.1%(峰值)→2.5%。美联储收紧导致急跌。', 'zh-TW': 'GDP比4.1%(峰值)→2.5%。Fed緊縮導致急跌。',
    es: 'Ratio PIB 4.1% (máximo) → 2.5%. Caída por Fed.', fr: 'Ratio PIB 4.1% (pic) → 2.5%. Chute Fed.', de: 'BIP-Ratio 4.1% (Höchst) → 2.5%. Fed-Straffung.',
    pt: 'Razão PIB 4.1% (pico) → 2.5%. Queda Fed.', ru: 'ВВП% 4.1% (пик) → 2.5%. Ужесточение ФРС.',
    ar: 'نسبة GDP 4.1%(ذروة)→2.5%. انهيار بسبب Fed.', hi: 'GDP अनुपात 4.1%(चरम)→2.5%। Fed कसाव से गिरावट।', id: 'Rasio GDP 4.1%(puncak)→2.5%. Pengetatan Fed.',
    th: 'GDP ratio 4.1%(สูงสุด)→2.5%. Fed ตึงตัว.', tr: 'GDP oranı 4.1%(zirve)→2.5%. Fed sıkılaştırması.', vi: 'Tỷ lệ GDP 4.1%(đỉnh)→2.5%. Fed thắt chặt.',
  },
  cbComparisonTitle: {
    ko: '국가별 비교 요약', en: 'Country Comparison Summary', ja: '国別比較サマリー', 'zh-CN': '国家对比摘要', 'zh-TW': '國家對比摘要',
    es: 'Resumen Comparativo por País', fr: 'Résumé Comparatif par Pays', de: 'Ländervergleich Zusammenfassung', pt: 'Resumo Comparativo por País', ru: 'Сводное сравнение по странам',
    ar: 'ملخص مقارنة الدول', hi: 'देश तुलना सारांश', id: 'Ringkasan Perbandingan Negara', th: 'สรุปการเปรียบเทียบตามประเทศ', tr: 'Ülke Karşılaştırma Özeti', vi: 'Tóm Tắt So Sánh Quốc Gia',
  },
  cbComparisonDesc: {
    ko: 'GDP 대비 신용잔고 비율 기준 정렬', en: 'Sorted by margin balance as % of GDP', ja: 'GDP比信用残高比率順', 'zh-CN': '按GDP融资余额比率排序', 'zh-TW': '按GDP融資餘額比率排序',
    es: 'Ordenado por saldo de margen como % del PIB', fr: 'Trié par solde de marge en % du PIB', de: 'Sortiert nach Marginbalance als % des BIP',
    pt: 'Ordenado por saldo de margem em % do PIB', ru: 'Отсортировано по маржинальному балансу как % ВВП',
    ar: 'مرتب حسب رصيد الهامش كنسبة من GDP', hi: 'GDP के % के रूप में मार्जिन बैलेंस द्वारा क्रमबद्ध', id: 'Diurutkan berdasarkan saldo margin sebagai % GDP',
    th: 'จัดเรียงตามยอดมาร์จิ้นเป็น % ของ GDP', tr: 'Marj bakiyesine göre GDP\'nin %\'si olarak sıralanmış', vi: 'Sắp xếp theo số dư ký quỹ là % GDP',
  },
  cbThCountry: {
    ko: '국가', en: 'Country', ja: '国', 'zh-CN': '国家', 'zh-TW': '國家',
    es: 'País', fr: 'Pays', de: 'Land', pt: 'País', ru: 'Страна',
    ar: 'الدولة', hi: 'देश', id: 'Negara', th: 'ประเทศ', tr: 'Ülke', vi: 'Quốc Gia',
  },
  cbThBalance: {
    ko: '신용잔고', en: 'Balance', ja: '信用残高', 'zh-CN': '融资余额', 'zh-TW': '融資餘額',
    es: 'Saldo', fr: 'Solde', de: 'Saldo', pt: 'Saldo', ru: 'Баланс',
    ar: 'الرصيد', hi: 'बैलेंस', id: 'Saldo', th: 'ยอด', tr: 'Bakiye', vi: 'Số Dư',
  },
  cbThGdpRatio: {
    ko: 'GDP비', en: 'GDP%', ja: 'GDP比', 'zh-CN': 'GDP%', 'zh-TW': 'GDP%',
    es: 'PIB%', fr: 'PIB%', de: 'BIP%', pt: 'PIB%', ru: 'ВВП%',
    ar: 'GDP%', hi: 'GDP%', id: 'GDP%', th: 'GDP%', tr: 'GSYİH%', vi: 'GDP%',
  },
  cbThPercentile: {
    ko: '역대위치', en: 'Historical', ja: '歴史的位置', 'zh-CN': '历史位置', 'zh-TW': '歷史位置',
    es: 'Histórico', fr: 'Historique', de: 'Historisch', pt: 'Histórico', ru: 'Исторически',
    ar: 'تاريخي', hi: 'ऐतिहासिक', id: 'Historis', th: 'ประวัติศาสตร์', tr: 'Tarihsel', vi: 'Lịch Sử',
  },
  cbThTrend: {
    ko: '추세', en: 'Trend', ja: 'トレンド', 'zh-CN': '趋势', 'zh-TW': '趨勢',
    es: 'Tendencia', fr: 'Tendance', de: 'Trend', pt: 'Tendência', ru: 'Тренд',
    ar: 'الاتجاه', hi: 'प्रवृत्ति', id: 'Tren', th: 'แนวโน้ม', tr: 'Eğilim', vi: 'Xu Hướng',
  },
  cbThRisk: {
    ko: '리스크', en: 'Risk', ja: 'リスク', 'zh-CN': '风险', 'zh-TW': '風險',
    es: 'Riesgo', fr: 'Risque', de: 'Risiko', pt: 'Risco', ru: 'Риск',
    ar: 'المخاطرة', hi: 'जोखिम', id: 'Risiko', th: 'ความเสี่ยง', tr: 'Risk', vi: 'Rủi Ro',
  },
  cbFootnote: {
    ko: '데이터: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 단위: USD Billions (환율 환산) · 분기별 업데이트',
    en: 'Data: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Unit: USD Billions (converted) · Quarterly update',
    ja: 'データ: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 単位: USD十億 (換算) · 四半期更新',
    'zh-CN': '数据: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 单位: 十亿美元 (换算) · 季度更新',
    'zh-TW': '資料: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · 單位: 十億美元 (換算) · 季度更新',
    es: 'Datos: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Unidad: Miles de mill. USD (convertido) · Actualización trimestral',
    fr: 'Données: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Unité: Milliards USD (converti) · Mise à jour trimestrielle',
    de: 'Daten: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Einheit: Mrd. USD (umgerechnet) · Quartalsupdate',
    pt: 'Dados: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Unidade: Bil. USD (convertido) · Atualização trimestral',
    ru: 'Данные: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Единица: Млрд USD · Квартальное обновление',
    ar: 'البيانات: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · الوحدة: مليار دولار · تحديث ربع سنوي',
    hi: 'डेटा: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · इकाई: अरब USD · तिमाही अपडेट',
    id: 'Data: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Satuan: Miliar USD · Pembaruan kuartalan',
    th: 'ข้อมูล: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · หน่วย: พันล้าน USD · อัปเดตรายไตรมาส',
    tr: 'Veriler: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Birim: Milyar USD · Üç aylık güncelleme',
    vi: 'Dữ liệu: FINRA, KRX, TSE, CSRC, ESMA, NSE/BSE · Đơn vị: Tỷ USD · Cập nhật hàng quý',
  },
};

let updated = 0;

for (const locale of LOCALES) {
  const filePath = join(MESSAGES_DIR, `${locale}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.intelligence) data.intelligence = {};

  for (const [key, translations] of Object.entries(KEYS)) {
    const val = translations[locale] ?? translations['en'];
    if (!data.intelligence[key]) {
      data.intelligence[key] = val;
      updated++;
    }
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

console.log(`Done. Added ${updated} key-value pairs across ${LOCALES.length} locales.`);
