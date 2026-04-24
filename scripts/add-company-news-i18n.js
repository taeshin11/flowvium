const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../messages');

const keys = {
  latestNews: { ko: '최신 뉴스', en: 'Latest News', ja: '最新ニュース', 'zh-CN': '最新新闻', 'zh-TW': '最新新聞', es: 'Últimas noticias', fr: 'Actualités récentes', de: 'Aktuelle Nachrichten', pt: 'Últimas notícias', ru: 'Последние новости', ar: 'آخر الأخبار', hi: 'ताज़ा खबर', id: 'Berita terkini', th: 'ข่าวล่าสุด', tr: 'Son haberler', vi: 'Tin tức mới nhất' },
  newsAiSummary: { ko: 'AI 요약', en: 'AI Summary', ja: 'AI要約', 'zh-CN': 'AI摘要', 'zh-TW': 'AI摘要', es: 'Resumen IA', fr: 'Résumé IA', de: 'KI-Zusammenfassung', pt: 'Resumo IA', ru: 'Резюме ИИ', ar: 'ملخص الذكاء الاصطناعي', hi: 'AI सारांश', id: 'Ringkasan AI', th: 'สรุปโดย AI', tr: 'AI özeti', vi: 'Tóm tắt AI' },
  loadingNews: { ko: '뉴스 로딩 중...', en: 'Loading news...', ja: 'ニュース読み込み中...', 'zh-CN': '加载新闻中...', 'zh-TW': '載入新聞中...', es: 'Cargando noticias...', fr: 'Chargement des nouvelles...', de: 'Nachrichten laden...', pt: 'Carregando notícias...', ru: 'Загрузка новостей...', ar: 'جارٍ تحميل الأخبار...', hi: 'समाचार लोड हो रहा है...', id: 'Memuat berita...', th: 'กำลังโหลดข่าว...', tr: 'Haberler yükleniyor...', vi: 'Đang tải tin tức...' },
  noNews: { ko: '뉴스를 불러올 수 없습니다', en: 'Could not load news', ja: 'ニュースを読み込めません', 'zh-CN': '无法加载新闻', 'zh-TW': '無法載入新聞', es: 'No se pudo cargar las noticias', fr: 'Impossible de charger les nouvelles', de: 'Nachrichten können nicht geladen werden', pt: 'Não foi possível carregar as notícias', ru: 'Не удалось загрузить новости', ar: 'تعذر تحميل الأخبار', hi: 'समाचार लोड नहीं हो सका', id: 'Tidak dapat memuat berita', th: 'ไม่สามารถโหลดข่าวได้', tr: 'Haberler yüklenemedi', vi: 'Không thể tải tin tức' },
  readMore: { ko: '더 보기', en: 'Read more', ja: '続きを読む', 'zh-CN': '阅读更多', 'zh-TW': '閱讀更多', es: 'Leer más', fr: 'Lire plus', de: 'Mehr lesen', pt: 'Ler mais', ru: 'Читать далее', ar: 'اقرأ المزيد', hi: 'और पढ़ें', id: 'Baca selengkapnya', th: 'อ่านเพิ่มเติม', tr: 'Daha fazla oku', vi: 'Đọc thêm' },
};

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let updated = 0;
for (const file of files) {
  const lang = file.replace('.json', '');
  const fp = path.join(dir, file);
  const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!obj.company) obj.company = {};
  let changed = false;
  for (const [key, translations] of Object.entries(keys)) {
    if (!obj.company[key]) {
      obj.company[key] = translations[lang] || translations.en;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n');
    updated++;
    process.stdout.write(lang + ' ');
  }
}
console.log('\nUpdated ' + updated + ' files');
