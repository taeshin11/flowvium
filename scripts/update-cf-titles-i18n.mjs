import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const msgDir = join(__dirname, '../messages');

// Per-language title patterns with {tf} parameter
const TITLE_UPDATES = {
  'ko': {
    cfRotationTitle: '자금 로테이션 ({tf} 기준)',
    cfCountryTitle: '국가별 시장 자금 흐름 ({tf} 기준)',
    cfFactorTitle: '스마트베타 팩터 성과 ({tf} 기준)',
    cfSectorTitle: '미국 섹터 로테이션 ({tf} 기준)',
    cfGoldDollarTitle: '금 vs 달러 ({tf} 기준)',
    cfAssetReturnTitle: '자산군별 {tf} 수익률 (자금 유입 방향)',
    cfTopInflow: '자금 유입 TOP 5 ({tf})',
    cfTopOutflow: '자금 이탈 TOP 5 ({tf})',
    cfGoldTfLabel: '금 ({tf})',
    cfDollarTfLabel: '달러 ({tf})',
  },
  'en': {
    cfRotationTitle: 'Capital Rotation ({tf})',
    cfCountryTitle: 'Country Capital Flows ({tf})',
    cfFactorTitle: 'Smart Beta Factor Performance ({tf})',
    cfSectorTitle: 'US Sector Rotation ({tf})',
    cfGoldDollarTitle: 'Gold vs Dollar ({tf})',
    cfAssetReturnTitle: 'Asset Returns ({tf}, Capital Flow Direction)',
    cfTopInflow: 'Top 5 Inflows ({tf})',
    cfTopOutflow: 'Top 5 Outflows ({tf})',
    cfGoldTfLabel: 'Gold ({tf})',
    cfDollarTfLabel: 'Dollar ({tf})',
  },
  'ja': {
    cfRotationTitle: '資金ローテーション ({tf})',
    cfCountryTitle: '国別マーケット資金フロー ({tf})',
    cfFactorTitle: 'スマートベータファクター ({tf})',
    cfSectorTitle: '米国セクターローテーション ({tf})',
    cfGoldDollarTitle: '金 vs ドル ({tf})',
    cfAssetReturnTitle: 'アセット別リターン ({tf})',
    cfTopInflow: '資金流入 TOP 5 ({tf})',
    cfTopOutflow: '資金流出 TOP 5 ({tf})',
    cfGoldTfLabel: '金 ({tf})',
    cfDollarTfLabel: 'ドル ({tf})',
  },
  'zh-CN': {
    cfRotationTitle: '资金轮动 ({tf})',
    cfCountryTitle: '各国市场资金流向 ({tf})',
    cfFactorTitle: '智能贝塔因子表现 ({tf})',
    cfSectorTitle: '美国行业轮动 ({tf})',
    cfGoldDollarTitle: '黄金 vs 美元 ({tf})',
    cfAssetReturnTitle: '各资产类别收益 ({tf})',
    cfTopInflow: '资金流入 TOP 5 ({tf})',
    cfTopOutflow: '资金流出 TOP 5 ({tf})',
    cfGoldTfLabel: '黄金 ({tf})',
    cfDollarTfLabel: '美元 ({tf})',
  },
  'zh-TW': {
    cfRotationTitle: '資金輪動 ({tf})',
    cfCountryTitle: '各國市場資金流向 ({tf})',
    cfFactorTitle: '智慧貝塔因子表現 ({tf})',
    cfSectorTitle: '美國行業輪動 ({tf})',
    cfGoldDollarTitle: '黃金 vs 美元 ({tf})',
    cfAssetReturnTitle: '各資產類別收益 ({tf})',
    cfTopInflow: '資金流入 TOP 5 ({tf})',
    cfTopOutflow: '資金流出 TOP 5 ({tf})',
    cfGoldTfLabel: '黃金 ({tf})',
    cfDollarTfLabel: '美元 ({tf})',
  },
  'es': {
    cfRotationTitle: 'Rotación de Capital ({tf})',
    cfCountryTitle: 'Flujos de Capital por País ({tf})',
    cfFactorTitle: 'Rendimiento de Factores Smart Beta ({tf})',
    cfSectorTitle: 'Rotación de Sectores EE.UU. ({tf})',
    cfGoldDollarTitle: 'Oro vs Dólar ({tf})',
    cfAssetReturnTitle: 'Rendimientos por Activo ({tf})',
    cfTopInflow: 'Top 5 Entradas ({tf})',
    cfTopOutflow: 'Top 5 Salidas ({tf})',
    cfGoldTfLabel: 'Oro ({tf})',
    cfDollarTfLabel: 'Dólar ({tf})',
  },
  'fr': {
    cfRotationTitle: 'Rotation des Capitaux ({tf})',
    cfCountryTitle: 'Flux de Capitaux par Pays ({tf})',
    cfFactorTitle: 'Performance Facteurs Smart Beta ({tf})',
    cfSectorTitle: 'Rotation Sectorielle US ({tf})',
    cfGoldDollarTitle: 'Or vs Dollar ({tf})',
    cfAssetReturnTitle: 'Rendements par Actif ({tf})',
    cfTopInflow: 'Top 5 Entrées ({tf})',
    cfTopOutflow: 'Top 5 Sorties ({tf})',
    cfGoldTfLabel: 'Or ({tf})',
    cfDollarTfLabel: 'Dollar ({tf})',
  },
  'de': {
    cfRotationTitle: 'Kapitalrotation ({tf})',
    cfCountryTitle: 'Kapitalflüsse nach Land ({tf})',
    cfFactorTitle: 'Smart Beta Faktor Performance ({tf})',
    cfSectorTitle: 'US-Sektorrotation ({tf})',
    cfGoldDollarTitle: 'Gold vs. Dollar ({tf})',
    cfAssetReturnTitle: 'Renditen nach Anlageklasse ({tf})',
    cfTopInflow: 'Top 5 Zuflüsse ({tf})',
    cfTopOutflow: 'Top 5 Abflüsse ({tf})',
    cfGoldTfLabel: 'Gold ({tf})',
    cfDollarTfLabel: 'Dollar ({tf})',
  },
  'pt': {
    cfRotationTitle: 'Rotação de Capital ({tf})',
    cfCountryTitle: 'Fluxos de Capital por País ({tf})',
    cfFactorTitle: 'Desempenho de Fatores Smart Beta ({tf})',
    cfSectorTitle: 'Rotação Setorial EUA ({tf})',
    cfGoldDollarTitle: 'Ouro vs Dólar ({tf})',
    cfAssetReturnTitle: 'Retornos por Ativo ({tf})',
    cfTopInflow: 'Top 5 Entradas ({tf})',
    cfTopOutflow: 'Top 5 Saídas ({tf})',
    cfGoldTfLabel: 'Ouro ({tf})',
    cfDollarTfLabel: 'Dólar ({tf})',
  },
  'ru': {
    cfRotationTitle: 'Ротация Капитала ({tf})',
    cfCountryTitle: 'Потоки Капитала по Странам ({tf})',
    cfFactorTitle: 'Эффективность Факторов Smart Beta ({tf})',
    cfSectorTitle: 'Ротация Секторов США ({tf})',
    cfGoldDollarTitle: 'Золото vs Доллар ({tf})',
    cfAssetReturnTitle: 'Доходность по Активам ({tf})',
    cfTopInflow: 'Топ-5 Притоков ({tf})',
    cfTopOutflow: 'Топ-5 Оттоков ({tf})',
    cfGoldTfLabel: 'Золото ({tf})',
    cfDollarTfLabel: 'Доллар ({tf})',
  },
  'ar': {
    cfRotationTitle: 'تدوير رأس المال ({tf})',
    cfCountryTitle: 'تدفقات رأس المال حسب البلد ({tf})',
    cfFactorTitle: 'أداء عوامل Smart Beta ({tf})',
    cfSectorTitle: 'دوران القطاعات الأمريكية ({tf})',
    cfGoldDollarTitle: 'الذهب مقابل الدولار ({tf})',
    cfAssetReturnTitle: 'عوائد الأصول ({tf})',
    cfTopInflow: 'أعلى 5 تدفقات وافدة ({tf})',
    cfTopOutflow: 'أعلى 5 تدفقات صادرة ({tf})',
    cfGoldTfLabel: 'الذهب ({tf})',
    cfDollarTfLabel: 'الدولار ({tf})',
  },
  'hi': {
    cfRotationTitle: 'पूंजी रोटेशन ({tf})',
    cfCountryTitle: 'देशवार पूंजी प्रवाह ({tf})',
    cfFactorTitle: 'स्मार्ट बीटा फैक्टर प्रदर्शन ({tf})',
    cfSectorTitle: 'यूएस सेक्टर रोटेशन ({tf})',
    cfGoldDollarTitle: 'सोना बनाम डॉलर ({tf})',
    cfAssetReturnTitle: 'परिसंपत्ति रिटर्न ({tf})',
    cfTopInflow: 'शीर्ष 5 अंतर्प्रवाह ({tf})',
    cfTopOutflow: 'शीर्ष 5 बहिर्प्रवाह ({tf})',
    cfGoldTfLabel: 'सोना ({tf})',
    cfDollarTfLabel: 'डॉलर ({tf})',
  },
  'id': {
    cfRotationTitle: 'Rotasi Modal ({tf})',
    cfCountryTitle: 'Aliran Modal per Negara ({tf})',
    cfFactorTitle: 'Kinerja Faktor Smart Beta ({tf})',
    cfSectorTitle: 'Rotasi Sektor AS ({tf})',
    cfGoldDollarTitle: 'Emas vs Dolar ({tf})',
    cfAssetReturnTitle: 'Imbal Hasil Aset ({tf})',
    cfTopInflow: 'Top 5 Arus Masuk ({tf})',
    cfTopOutflow: 'Top 5 Arus Keluar ({tf})',
    cfGoldTfLabel: 'Emas ({tf})',
    cfDollarTfLabel: 'Dolar ({tf})',
  },
  'th': {
    cfRotationTitle: 'การหมุนเวียนทุน ({tf})',
    cfCountryTitle: 'กระแสทุนตามประเทศ ({tf})',
    cfFactorTitle: 'ผลการดำเนินงานปัจจัย Smart Beta ({tf})',
    cfSectorTitle: 'การหมุนเวียนภาคสหรัฐ ({tf})',
    cfGoldDollarTitle: 'ทองคำ vs ดอลลาร์ ({tf})',
    cfAssetReturnTitle: 'ผลตอบแทนสินทรัพย์ ({tf})',
    cfTopInflow: '5 อันดับเงินไหลเข้า ({tf})',
    cfTopOutflow: '5 อันดับเงินไหลออก ({tf})',
    cfGoldTfLabel: 'ทองคำ ({tf})',
    cfDollarTfLabel: 'ดอลลาร์ ({tf})',
  },
  'tr': {
    cfRotationTitle: 'Sermaye Rotasyonu ({tf})',
    cfCountryTitle: 'Ülkeye Göre Sermaye Akışı ({tf})',
    cfFactorTitle: 'Smart Beta Faktör Performansı ({tf})',
    cfSectorTitle: 'ABD Sektör Rotasyonu ({tf})',
    cfGoldDollarTitle: 'Altın vs Dolar ({tf})',
    cfAssetReturnTitle: 'Varlık Getirileri ({tf})',
    cfTopInflow: 'En İyi 5 Giriş ({tf})',
    cfTopOutflow: 'En İyi 5 Çıkış ({tf})',
    cfGoldTfLabel: 'Altın ({tf})',
    cfDollarTfLabel: 'Dolar ({tf})',
  },
  'vi': {
    cfRotationTitle: 'Luân Chuyển Vốn ({tf})',
    cfCountryTitle: 'Dòng Vốn Theo Quốc Gia ({tf})',
    cfFactorTitle: 'Hiệu Suất Nhân Tố Smart Beta ({tf})',
    cfSectorTitle: 'Luân Chuyển Ngành Mỹ ({tf})',
    cfGoldDollarTitle: 'Vàng vs Đô la ({tf})',
    cfAssetReturnTitle: 'Lợi Nhuận Tài Sản ({tf})',
    cfTopInflow: 'Top 5 Dòng Vào ({tf})',
    cfTopOutflow: 'Top 5 Dòng Ra ({tf})',
    cfGoldTfLabel: 'Vàng ({tf})',
    cfDollarTfLabel: 'Đô la ({tf})',
  },
};

const LOCALES = Object.keys(TITLE_UPDATES);

let updated = 0;
for (const locale of LOCALES) {
  const filePath = join(msgDir, `${locale}.json`);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.warn(`SKIP: ${locale}.json not found`);
    continue;
  }
  const data = JSON.parse(content);
  if (!data.intelligence) data.intelligence = {};
  const updates = TITLE_UPDATES[locale];
  for (const [key, val] of Object.entries(updates)) {
    data.intelligence[key] = val;
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Updated ${locale}.json (+${Object.keys(updates).length} keys)`);
  updated++;
}
console.log(`\nDone. ${updated} files updated.`);
