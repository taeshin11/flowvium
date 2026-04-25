#!/usr/bin/env python3
"""Add AI Investment Strategy report keys to all 16 locale message files."""
import json, sys, pathlib, copy
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = pathlib.Path(__file__).parent.parent / 'messages'

# Keys to add in 'report' namespace
KEYS: dict[str, dict[str, str]] = {
    'pageTitle': {
        'ko': 'AI 투자 전략 리포트',
        'en': 'AI Investment Strategy Report',
        'ja': 'AI投資戦略レポート',
        'zh-CN': 'AI投资策略报告',
        'zh-TW': 'AI投資策略報告',
        'es': 'Informe de Estrategia de Inversión IA',
        'de': 'KI-Investitionsstrategie-Bericht',
        'fr': 'Rapport de stratégie d\'investissement IA',
        'pt': 'Relatório de Estratégia de Investimento IA',
        'ru': 'Отчёт об инвестиционной стратегии ИИ',
        'ar': 'تقرير استراتيجية الاستثمار بالذكاء الاصطناعي',
        'hi': 'AI निवेश रणनीति रिपोर्ट',
        'id': 'Laporan Strategi Investasi AI',
        'th': 'รายงานกลยุทธ์การลงทุน AI',
        'tr': 'AI Yatırım Stratejisi Raporu',
        'vi': 'Báo cáo chiến lược đầu tư AI',
    },
    'pageDesc': {
        'ko': '모든 지표를 종합한 AI 기반 매수 전략 및 포트폴리오',
        'en': 'AI-driven buy strategy and portfolio combining all market indicators',
        'ja': 'すべての指標を統合したAIベースの買い戦略とポートフォリオ',
        'zh-CN': '结合所有市场指标的AI驱动买入策略和投资组合',
        'zh-TW': '結合所有市場指標的AI驅動買入策略和投資組合',
        'es': 'Estrategia de compra impulsada por IA que combina todos los indicadores del mercado',
        'de': 'KI-gesteuerte Kaufstrategie und Portfolio mit allen Marktindikatoren',
        'fr': 'Stratégie d\'achat IA combinant tous les indicateurs de marché',
        'pt': 'Estratégia de compra orientada por IA combinando todos os indicadores de mercado',
        'ru': 'Стратегия покупки на основе ИИ с учётом всех рыночных индикаторов',
        'ar': 'استراتيجية شراء مدعومة بالذكاء الاصطناعي تجمع جميع مؤشرات السوق',
        'hi': 'सभी बाजार संकेतकों को जोड़ने वाली AI-संचालित खरीद रणनीति',
        'id': 'Strategi beli berbasis AI yang menggabungkan semua indikator pasar',
        'th': 'กลยุทธ์การซื้อที่ขับเคลื่อนด้วย AI รวมตัวชี้วัดตลาดทั้งหมด',
        'tr': 'Tüm piyasa göstergelerini birleştiren AI destekli alım stratejisi',
        'vi': 'Chiến lược mua do AI điều khiển kết hợp tất cả các chỉ báo thị trường',
    },
    'portfolioTitle': {
        'ko': 'AI 추천 포트폴리오',
        'en': 'AI-Recommended Portfolio',
        'ja': 'AIおすすめポートフォリオ',
        'zh-CN': 'AI推荐投资组合',
        'zh-TW': 'AI推薦投資組合',
        'es': 'Portafolio recomendado por IA',
        'de': 'KI-empfohlenes Portfolio',
        'fr': 'Portefeuille recommandé par IA',
        'pt': 'Portfólio recomendado pela IA',
        'ru': 'Портфель, рекомендованный ИИ',
        'ar': 'المحفظة الموصى بها من قِبل الذكاء الاصطناعي',
        'hi': 'AI-अनुशंसित पोर्टफोलियो',
        'id': 'Portofolio yang Direkomendasikan AI',
        'th': 'พอร์ตโฟลิโอที่แนะนำโดย AI',
        'tr': 'AI Tarafından Önerilen Portföy',
        'vi': 'Danh mục được AI khuyến nghị',
    },
    'sectorTitle': {
        'ko': '섹터별 배분 전략',
        'en': 'Sector Allocation Strategy',
        'ja': 'セクター別配分戦略',
        'zh-CN': '行业配置策略',
        'zh-TW': '行業配置策略',
        'es': 'Estrategia de asignación por sector',
        'de': 'Sektorallokationsstrategie',
        'fr': 'Stratégie d\'allocation sectorielle',
        'pt': 'Estratégia de alocação setorial',
        'ru': 'Стратегия секторного распределения',
        'ar': 'استراتيجية تخصيص القطاعات',
        'hi': 'क्षेत्र आवंटन रणनीति',
        'id': 'Strategi Alokasi Sektor',
        'th': 'กลยุทธ์การจัดสรรตามภาคส่วน',
        'tr': 'Sektör Dağılım Stratejisi',
        'vi': 'Chiến lược phân bổ theo ngành',
    },
    'riskEventsTitle': {
        'ko': '주요 리스크 이벤트',
        'en': 'Key Risk Events',
        'ja': '主要リスクイベント',
        'zh-CN': '主要风险事件',
        'zh-TW': '主要風險事件',
        'es': 'Eventos de riesgo clave',
        'de': 'Wesentliche Risikoereignisse',
        'fr': 'Événements de risque clés',
        'pt': 'Principais eventos de risco',
        'ru': 'Ключевые рисковые события',
        'ar': 'أحداث المخاطر الرئيسية',
        'hi': 'मुख्य जोखिम घटनाएं',
        'id': 'Peristiwa Risiko Utama',
        'th': 'เหตุการณ์ความเสี่ยงสำคัญ',
        'tr': 'Temel Risk Olayları',
        'vi': 'Sự kiện rủi ro chính',
    },
    'disclaimer': {
        'ko': '본 리포트는 AI가 공개 데이터를 기반으로 생성한 참고용 자료입니다. 투자 결정의 책임은 본인에게 있으며, 투자 손실을 보장하지 않습니다.',
        'en': 'This report is AI-generated reference material based on public data. Investment decisions are solely your responsibility; returns are not guaranteed.',
        'ja': '本レポートはAIが公開データをもとに生成した参考資料です。投資判断の責任はご自身にあり、投資損失を保証するものではありません。',
        'zh-CN': '本报告是AI基于公开数据生成的参考资料。投资决策由您负责，不保证投资回报。',
        'zh-TW': '本報告是AI基於公開數據生成的參考資料。投資決策由您負責，不保證投資回報。',
        'es': 'Este informe es material de referencia generado por IA basado en datos públicos. Las decisiones de inversión son de su exclusiva responsabilidad.',
        'de': 'Dieser Bericht ist KI-generiertes Referenzmaterial basierend auf öffentlichen Daten. Investitionsentscheidungen liegen in Ihrer alleinigen Verantwortung.',
        'fr': 'Ce rapport est un matériel de référence généré par IA basé sur des données publiques. Les décisions d\'investissement relèvent de votre seule responsabilité.',
        'pt': 'Este relatório é material de referência gerado por IA com base em dados públicos. As decisões de investimento são de sua exclusiva responsabilidade.',
        'ru': 'Этот отчёт — справочный материал, созданный ИИ на основе публичных данных. Ответственность за инвестиционные решения лежит на вас.',
        'ar': 'هذا التقرير مادة مرجعية تم إنشاؤها بالذكاء الاصطناعي استناداً إلى البيانات العامة. قرارات الاستثمار هي مسؤوليتك الكاملة.',
        'hi': 'यह रिपोर्ट सार्वजनिक डेटा पर आधारित AI-जनित संदर्भ सामग्री है। निवेश निर्णय की जिम्मेदारी केवल आपकी है।',
        'id': 'Laporan ini adalah materi referensi yang dihasilkan AI berdasarkan data publik. Keputusan investasi sepenuhnya menjadi tanggung jawab Anda.',
        'th': 'รายงานนี้เป็นเอกสารอ้างอิงที่สร้างโดย AI บนพื้นฐานข้อมูลสาธารณะ ความรับผิดชอบในการตัดสินใจลงทุนเป็นของคุณ',
        'tr': 'Bu rapor, kamuya açık verilere dayalı AI tarafından oluşturulan başvuru materyalidir. Yatırım kararlarının sorumluluğu size aittir.',
        'vi': 'Báo cáo này là tài liệu tham khảo do AI tạo ra dựa trên dữ liệu công khai. Quyết định đầu tư hoàn toàn thuộc trách nhiệm của bạn.',
    },
    'error': {
        'ko': '리포트 로딩 실패 — 잠시 후 다시 시도해주세요',
        'en': 'Failed to load report — please try again later',
        'ja': 'レポートの読み込みに失敗しました — しばらくしてから再試行してください',
        'zh-CN': '加载报告失败 — 请稍后再试',
        'zh-TW': '載入報告失敗 — 請稍後再試',
        'es': 'Error al cargar el informe — inténtelo de nuevo más tarde',
        'de': 'Bericht konnte nicht geladen werden — bitte später erneut versuchen',
        'fr': 'Échec du chargement du rapport — réessayez plus tard',
        'pt': 'Falha ao carregar o relatório — tente novamente mais tarde',
        'ru': 'Не удалось загрузить отчёт — повторите попытку позже',
        'ar': 'فشل تحميل التقرير — يرجى المحاولة مرة أخرى لاحقاً',
        'hi': 'रिपोर्ट लोड करने में विफल — कृपया बाद में पुनः प्रयास करें',
        'id': 'Gagal memuat laporan — coba lagi nanti',
        'th': 'โหลดรายงานล้มเหลว — โปรดลองอีกครั้งในภายหลัง',
        'tr': 'Rapor yüklenemedi — lütfen daha sonra tekrar deneyin',
        'vi': 'Không tải được báo cáo — vui lòng thử lại sau',
    },
}

LOCALE_MAP = {
    'ko': 'ko', 'en': 'en', 'ja': 'ja', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
    'es': 'es', 'de': 'de', 'fr': 'fr', 'pt': 'pt', 'ru': 'ru',
    'ar': 'ar', 'hi': 'hi', 'id': 'id', 'th': 'th', 'tr': 'tr', 'vi': 'vi',
}

added = 0
skipped = 0
for loc_code, file_loc in LOCALE_MAP.items():
    path = ROOT / f'{file_loc}.json'
    if not path.exists():
        print(f'  SKIP {path} not found')
        continue
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    if 'report' not in data:
        data['report'] = {}
    changed = False
    for key, translations in KEYS.items():
        if key not in data['report']:
            val = translations.get(loc_code, translations['en'])
            data['report'][key] = val
            changed = True
            added += 1
        else:
            skipped += 1
    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'  Updated {file_loc}.json')

print(f'Done: {added} added, {skipped} already existed')
