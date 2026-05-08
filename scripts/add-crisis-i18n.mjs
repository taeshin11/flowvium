import { readFileSync, writeFileSync } from 'fs';

const langs = {
  'ja': { title: 'クライシス検知', high: '緊急', medium: '警告', low: '注意', insider: 'インサイダー売り', miss: '業績ミス', bb: 'BB過買い', inst: '機関撤退', guidance: 'ガイダンス下方修正', macro: 'マクロリスク', action: 'アクション', evidence: '根拠' },
  'zh-CN': { title: '危机预警', high: '紧急', medium: '警告', low: '注意', insider: '内部人减持', miss: '业绩不及预期', bb: 'BB超买', inst: '机构撤资', guidance: '指引下调', macro: '宏观风险', action: '操作建议', evidence: '依据' },
  'zh-TW': { title: '危機預警', high: '緊急', medium: '警告', low: '注意', insider: '內部人減持', miss: '業績不及預期', bb: 'BB超買', inst: '機構撤資', guidance: '指引下調', macro: '宏觀風險', action: '操作建議', evidence: '依據' },
  'es': { title: 'Alertas de Crisis', high: 'URGENTE', medium: 'AVISO', low: 'ATENCIÓN', insider: 'Venta Interna', miss: 'Miss en Ganancias', bb: 'BB Sobrecomprado', inst: 'Salida Institucional', guidance: 'Guía Recortada', macro: 'Riesgo Macro', action: 'Acción', evidence: 'Evidencia' },
  'fr': { title: 'Alertes de Crise', high: 'URGENT', medium: 'AVERTISSEMENT', low: 'ATTENTION', insider: 'Vente Initiée', miss: 'Résultats Décevants', bb: 'BB Suracheté', inst: 'Sortie Institutionnelle', guidance: 'Prévisions Réduites', macro: 'Risque Macro', action: 'Action', evidence: 'Preuve' },
  'de': { title: 'Krisenwarnung', high: 'DRINGEND', medium: 'WARNUNG', low: 'BEACHTEN', insider: 'Insider-Verkauf', miss: 'Gewinnverfehlung', bb: 'BB Überkauft', inst: 'Institutionaler Ausstieg', guidance: 'Prognose gesenkt', macro: 'Makrorisiko', action: 'Maßnahme', evidence: 'Nachweis' },
  'pt': { title: 'Alertas de Crise', high: 'URGENTE', medium: 'AVISO', low: 'ATENÇÃO', insider: 'Venda Interna', miss: 'Miss nos Resultados', bb: 'BB Sobrecomprado', inst: 'Saída Institucional', guidance: 'Guidance Reduzido', macro: 'Risco Macro', action: 'Ação', evidence: 'Evidência' },
  'ru': { title: 'Кризисные Сигналы', high: 'СРОЧНО', medium: 'ПРЕДУПРЕЖДЕНИЕ', low: 'ВНИМАНИЕ', insider: 'Продажа инсайдеров', miss: 'Прибыль ниже ожиданий', bb: 'BB перекуплен', inst: 'Выход институционалов', guidance: 'Снижение прогноза', macro: 'Макро риск', action: 'Действие', evidence: 'Доказательство' },
  'ar': { title: 'تنبيهات الأزمات', high: 'عاجل', medium: 'تحذير', low: 'انتبه', insider: 'بيع داخلي', miss: 'إخفاق في الأرباح', bb: 'BB مشترى بإفراط', inst: 'خروج مؤسسي', guidance: 'تخفيض التوجيه', macro: 'مخاطر الاقتصاد الكلي', action: 'الإجراء', evidence: 'الدليل' },
  'hi': { title: 'संकट चेतावनियां', high: 'जरूरी', medium: 'चेतावनी', low: 'ध्यान दें', insider: 'इनसाइडर बिक्री', miss: 'आय में कमी', bb: 'BB ओवरबॉट', inst: 'संस्थागत निकास', guidance: 'मार्गदर्शन कटौती', macro: 'मैक्रो जोखिम', action: 'कार्रवाई', evidence: 'प्रमाण' },
  'id': { title: 'Peringatan Krisis', high: 'MENDESAK', medium: 'PERINGATAN', low: 'PERHATIAN', insider: 'Penjualan Insider', miss: 'Miss Laba', bb: 'BB Overbought', inst: 'Keluar Institusional', guidance: 'Panduan Dipangkas', macro: 'Risiko Makro', action: 'Tindakan', evidence: 'Bukti' },
  'th': { title: 'สัญญาณวิกฤต', high: 'เร่งด่วน', medium: 'คำเตือน', low: 'ระวัง', insider: 'ขายโดยผู้ใน', miss: 'กำไรต่ำกว่าคาด', bb: 'BB ซื้อมากเกินไป', inst: 'สถาบันถอนตัว', guidance: 'ลดคาดการณ์', macro: 'ความเสี่ยงมหภาค', action: 'การดำเนินการ', evidence: 'หลักฐาน' },
  'tr': { title: 'Kriz Uyarıları', high: 'ACİL', medium: 'UYARI', low: 'DİKKAT', insider: 'İçeriden Satış', miss: 'Kar Beklenti Altı', bb: 'BB Aşırı Alım', inst: 'Kurumsal Çıkış', guidance: 'Rehberlik Kesildi', macro: 'Makro Risk', action: 'Eylem', evidence: 'Kanıt' },
  'vi': { title: 'Cảnh báo Khủng hoảng', high: 'KHẨN CẤP', medium: 'CẢNH BÁO', low: 'CHÚ Ý', insider: 'Bán nội bộ', miss: 'Lợi nhuận thấp hơn dự kiến', bb: 'BB mua quá mức', inst: 'Thoát thể chế', guidance: 'Cắt giảm hướng dẫn', macro: 'Rủi ro vĩ mô', action: 'Hành động', evidence: 'Bằng chứng' },
};

const marker = '"opportunitySignalsTitle"';

for (const [lang, t] of Object.entries(langs)) {
  const filepath = `messages/${lang}.json`;
  let content = readFileSync(filepath, 'utf-8');
  if (content.includes('"crisisSignalsTitle"')) { console.log(`SKIP ${lang}: already updated`); continue; }
  const idx = content.indexOf(marker);
  if (idx === -1) { console.log(`SKIP ${lang}: marker not found`); continue; }
  const lineEnd = content.indexOf('\n', idx);
  const insert = `
    "crisisSignalsTitle": "${t.title}",
    "crisisSeverityHigh": "${t.high}",
    "crisisSeverityMedium": "${t.medium}",
    "crisisSeverityLow": "${t.low}",
    "crisisTypeInsiderSelling": "${t.insider}",
    "crisisTypeEarningsMiss": "${t.miss}",
    "crisisTypeBBOverextended": "${t.bb}",
    "crisisTypeInstitutionalExit": "${t.inst}",
    "crisisTypeGuidanceCut": "${t.guidance}",
    "crisisTypeMacroRisk": "${t.macro}",
    "crisisActionLabel": "${t.action}",
    "crisisEvidenceLabel": "${t.evidence}",`;
  content = content.slice(0, lineEnd) + insert + content.slice(lineEnd);
  writeFileSync(filepath, content, 'utf-8');
  console.log(`Updated ${lang}`);
}
console.log('Done');
