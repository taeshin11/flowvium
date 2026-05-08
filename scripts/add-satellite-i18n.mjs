import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGES_DIR = join(ROOT, 'messages');

const navTranslations = {
  ko: { satellite: '위성 추적', satelliteDesc: '공장 활동 모니터' },
  en: { satellite: 'Satellite', satelliteDesc: 'Factory activity monitor' },
  ja: { satellite: '衛星追跡', satelliteDesc: '工場活動モニター' },
  'zh-CN': { satellite: '卫星追踪', satelliteDesc: '工厂活动监测' },
  'zh-TW': { satellite: '衛星追蹤', satelliteDesc: '工廠活動監測' },
  es: { satellite: 'Satélite', satelliteDesc: 'Monitor de actividad fabril' },
  fr: { satellite: 'Satellite', satelliteDesc: 'Monitoring activité usine' },
  de: { satellite: 'Satellit', satelliteDesc: 'Fabrikaktivitäts-Monitor' },
  pt: { satellite: 'Satélite', satelliteDesc: 'Monitor de atividade fabril' },
  ru: { satellite: 'Спутник', satelliteDesc: 'Мониторинг заводов' },
  ar: { satellite: 'الأقمار الصناعية', satelliteDesc: 'مراقبة نشاط المصانع' },
  hi: { satellite: 'सैटेलाइट', satelliteDesc: 'फ़ैक्टरी गतिविधि मॉनिटर' },
  id: { satellite: 'Satelit', satelliteDesc: 'Monitor aktivitas pabrik' },
  th: { satellite: 'ดาวเทียม', satelliteDesc: 'ติดตามกิจกรรมโรงงาน' },
  tr: { satellite: 'Uydu', satelliteDesc: 'Fabrika aktivite monitörü' },
  vi: { satellite: 'Vệ tinh', satelliteDesc: 'Theo dõi hoạt động nhà máy' },
};

const satellitePage = {
  ko: {
    title: '위성 공급망 추적',
    subtitle: 'ESA Sentinel-2 위성사진 + Claude Vision으로 전 세계 주요 반도체·EV 공장의 활동 지수를 모니터링합니다.',
    noDataTitle: '아직 스캔 데이터가 없습니다',
    noDataDesc: 'Copernicus 무료 계정으로 12개 공장을 한번에 스캔할 수 있습니다. 5일마다 새 위성사진이 제공됩니다.',
    setupSteps: '설정 방법',
    methodologyTitle: '분석 방법론',
    methodologyDesc: 'Sentinel-2 L2A (10m 해상도) 이미지를 Claude Vision으로 주차장 밀도·하역 활동·신규 공사 여부를 분석합니다. 활동 지수 70+ = 활발, 30 이하 = 조용.',
  },
  en: {
    title: 'Satellite Supply Chain Tracker',
    subtitle: 'Monitor factory activity at key semiconductor & EV plants worldwide using ESA Sentinel-2 imagery + Claude Vision AI.',
    noDataTitle: 'No scan data yet',
    noDataDesc: 'Run a satellite scan with your free Copernicus account to monitor 12 factories. New imagery every 5 days.',
    setupSteps: 'Setup Steps',
    methodologyTitle: 'Methodology',
    methodologyDesc: 'Sentinel-2 L2A (10m resolution) analyzed by Claude Vision for parking density, loading dock activity, and construction. Score 70+ = elevated, 30- = quiet.',
  },
  ja: {
    title: '衛星サプライチェーン追跡',
    subtitle: 'ESA Sentinel-2衛星画像とClaude Visionで主要半導体・EV工場の活動指数をモニタリング。',
    noDataTitle: 'スキャンデータがありません',
    noDataDesc: 'Copernicusの無料アカウントで12工場をスキャンできます。5日ごとに新しい衛星画像。',
    setupSteps: '設定手順',
    methodologyTitle: '分析手法',
    methodologyDesc: 'Sentinel-2 L2A（10m）画像をClaude Visionで駐車場密度・荷積み・建設を分析。70+=活発、30以下=静止。',
  },
  'zh-CN': {
    title: '卫星供应链追踪',
    subtitle: '使用ESA Sentinel-2卫星图像和Claude Vision AI监控全球主要半导体和电动车工厂活动指数。',
    noDataTitle: '暂无扫描数据',
    noDataDesc: '使用免费Copernicus账户可扫描12个工厂。每5天提供新卫星图像。',
    setupSteps: '设置步骤',
    methodologyTitle: '分析方法',
    methodologyDesc: 'Sentinel-2 L2A（10m）图像由Claude Vision分析停车密度、装卸活动和建设情况。70+=活跃，30以下=安静。',
  },
  'zh-TW': {
    title: '衛星供應鏈追蹤',
    subtitle: '使用ESA Sentinel-2衛星圖像和Claude Vision AI監控全球主要半導體和電動車工廠活動指數。',
    noDataTitle: '暫無掃描數據',
    noDataDesc: '使用免費Copernicus帳戶可掃描12個工廠。每5天提供新衛星圖像。',
    setupSteps: '設定步驟',
    methodologyTitle: '分析方法',
    methodologyDesc: 'Sentinel-2 L2A（10m）圖像由Claude Vision分析停車密度、裝卸活動和建設情況。70+=活躍，30以下=安靜。',
  },
  es: {
    title: 'Rastreador Satelital de Cadena de Suministro',
    subtitle: 'Monitorea la actividad de fábricas clave de semiconductores y VE con imágenes ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Sin datos de escaneo',
    noDataDesc: 'Ejecuta un escaneo satelital con tu cuenta gratuita de Copernicus para 12 fábricas.',
    setupSteps: 'Pasos de configuración',
    methodologyTitle: 'Metodología',
    methodologyDesc: 'Imágenes Sentinel-2 L2A (10m) analizadas por Claude Vision para densidad de estacionamiento, carga y construcción.',
  },
  fr: {
    title: 'Suivi Satellitaire de la Chaîne d\'Approvisionnement',
    subtitle: 'Surveillez l\'activité des usines clés avec les images ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Aucune donnée de scan',
    noDataDesc: 'Lancez un scan avec votre compte Copernicus gratuit pour 12 usines.',
    setupSteps: 'Étapes de configuration',
    methodologyTitle: 'Méthodologie',
    methodologyDesc: 'Images Sentinel-2 L2A (10m) analysées par Claude Vision pour la densité de stationnement, chargement et construction.',
  },
  de: {
    title: 'Satelliten-Lieferkettenüberwachung',
    subtitle: 'Überwachen Sie die Fabrikaktivität mit ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Keine Scandaten vorhanden',
    noDataDesc: 'Starten Sie einen Scan mit Ihrem kostenlosen Copernicus-Konto für 12 Fabriken.',
    setupSteps: 'Einrichtungsschritte',
    methodologyTitle: 'Methodik',
    methodologyDesc: 'Sentinel-2 L2A (10m) Bilder werden von Claude Vision auf Parkhausdichte, Laden und Bau analysiert.',
  },
  pt: {
    title: 'Rastreador Satelital da Cadeia de Suprimentos',
    subtitle: 'Monitore a atividade de fábricas com imagens ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Sem dados de varredura',
    noDataDesc: 'Execute uma varredura com sua conta gratuita Copernicus para 12 fábricas.',
    setupSteps: 'Etapas de configuração',
    methodologyTitle: 'Metodologia',
    methodologyDesc: 'Imagens Sentinel-2 L2A (10m) analisadas pelo Claude Vision para estacionamento, carga e construção.',
  },
  ru: {
    title: 'Спутниковое отслеживание цепочки поставок',
    subtitle: 'Мониторинг активности заводов с помощью снимков ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Нет данных сканирования',
    noDataDesc: 'Запустите сканирование с бесплатным аккаунтом Copernicus для 12 заводов.',
    setupSteps: 'Шаги настройки',
    methodologyTitle: 'Методология',
    methodologyDesc: 'Снимки Sentinel-2 L2A (10м) анализируются Claude Vision для парковки, погрузки и строительства.',
  },
  ar: {
    title: 'تتبع سلسلة التوريد بالأقمار الصناعية',
    subtitle: 'مراقبة نشاط المصانع الرئيسية باستخدام صور Sentinel-2 + Claude Vision.',
    noDataTitle: 'لا توجد بيانات مسح',
    noDataDesc: 'قم بتشغيل مسح بحساب Copernicus المجاني لـ 12 مصنعاً.',
    setupSteps: 'خطوات الإعداد',
    methodologyTitle: 'المنهجية',
    methodologyDesc: 'صور Sentinel-2 L2A (10م) يحللها Claude Vision لمواقف السيارات والتحميل والبناء.',
  },
  hi: {
    title: 'सैटेलाइट सप्लाई चेन ट्रैकर',
    subtitle: 'ESA Sentinel-2 इमेजरी + Claude Vision से प्रमुख फैक्ट्रियों की गतिविधि मॉनिटर करें।',
    noDataTitle: 'कोई स्कैन डेटा नहीं',
    noDataDesc: '12 फैक्ट्रियों के लिए मुफ्त Copernicus अकाउंट से स्कैन चलाएं।',
    setupSteps: 'सेटअप चरण',
    methodologyTitle: 'पद्धति',
    methodologyDesc: 'Sentinel-2 L2A (10m) को Claude Vision पार्किंग, लोडिंग और निर्माण के लिए विश्लेषण करता है।',
  },
  id: {
    title: 'Pelacak Rantai Pasokan Satelit',
    subtitle: 'Pantau aktivitas pabrik utama dengan citra ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Belum ada data pemindaian',
    noDataDesc: 'Jalankan pemindaian dengan akun Copernicus gratis untuk 12 pabrik.',
    setupSteps: 'Langkah penyiapan',
    methodologyTitle: 'Metodologi',
    methodologyDesc: 'Citra Sentinel-2 L2A (10m) dianalisis Claude Vision untuk parkir, bongkar muat, dan konstruksi.',
  },
  th: {
    title: 'ติดตามห่วงโซ่อุปทานด้วยดาวเทียม',
    subtitle: 'ติดตามกิจกรรมโรงงานหลักด้วยภาพ ESA Sentinel-2 + Claude Vision',
    noDataTitle: 'ยังไม่มีข้อมูลการสแกน',
    noDataDesc: 'เรียกใช้การสแกนด้วยบัญชี Copernicus ฟรีสำหรับ 12 โรงงาน',
    setupSteps: 'ขั้นตอนการตั้งค่า',
    methodologyTitle: 'วิธีการวิเคราะห์',
    methodologyDesc: 'ภาพ Sentinel-2 L2A (10m) วิเคราะห์โดย Claude Vision สำหรับที่จอดรถ การขนส่ง และการก่อสร้าง',
  },
  tr: {
    title: 'Uydu Tedarik Zinciri Takipçisi',
    subtitle: 'Önemli fabrikaların aktivitesini ESA Sentinel-2 + Claude Vision ile izleyin.',
    noDataTitle: 'Tarama verisi yok',
    noDataDesc: '12 fabrika için ücretsiz Copernicus hesabıyla tarama çalıştırın.',
    setupSteps: 'Kurulum adımları',
    methodologyTitle: 'Metodoloji',
    methodologyDesc: 'Sentinel-2 L2A (10m) görüntüleri Claude Vision tarafından otopark, yükleme ve inşaat için analiz edilir.',
  },
  vi: {
    title: 'Theo dõi Chuỗi Cung ứng Vệ tinh',
    subtitle: 'Theo dõi hoạt động nhà máy quan trọng bằng hình ảnh ESA Sentinel-2 + Claude Vision.',
    noDataTitle: 'Chưa có dữ liệu quét',
    noDataDesc: 'Chạy quét với tài khoản Copernicus miễn phí cho 12 nhà máy.',
    setupSteps: 'Các bước cài đặt',
    methodologyTitle: 'Phương pháp',
    methodologyDesc: 'Hình ảnh Sentinel-2 L2A (10m) được Claude Vision phân tích bãi đậu xe, bốc dỡ và xây dựng.',
  },
};

const locales = ['ar','de','en','es','fr','hi','id','ja','ko','pt','ru','th','tr','vi','zh-CN','zh-TW'];
let updated = 0;

for (const locale of locales) {
  const filePath = join(MESSAGES_DIR, locale + '.json');
  if (!existsSync(filePath)) { console.log('SKIP ' + locale); continue; }

  const json = JSON.parse(readFileSync(filePath, 'utf8'));

  const navTrans = navTranslations[locale] ?? navTranslations.en;
  json.nav = json.nav ?? {};
  json.nav.satellite = navTrans.satellite;
  json.nav.satelliteDesc = navTrans.satelliteDesc;

  json.satellite = satellitePage[locale] ?? satellitePage.en;

  json.seo = json.seo ?? {};
  if (locale === 'ko') {
    json.seo.satelliteTitle = '위성 공급망 추적 | FlowVium';
    json.seo.satelliteDescription = 'ESA Sentinel-2 위성사진으로 반도체·EV 공장 활동 지수를 모니터링합니다.';
  } else if (locale === 'ja') {
    json.seo.satelliteTitle = '衛星サプライチェーン追跡 | FlowVium';
    json.seo.satelliteDescription = 'ESA Sentinel-2衛星画像で半導体・EV工場の活動指数をモニタリング。';
  } else {
    json.seo.satelliteTitle = 'Satellite Supply Chain Tracker | FlowVium';
    json.seo.satelliteDescription = 'Monitor factory activity at key semiconductor & EV plants using ESA Sentinel-2 satellite imagery + AI analysis.';
  }

  writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('OK ' + locale);
  updated++;
}

console.log('\nDone: ' + updated + '/' + locales.length + ' locales updated');
