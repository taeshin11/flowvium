const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../messages');

const navTranslations = {
  ko: '관심 종목',
  en: 'Watchlist',
  ja: 'ウォッチリスト',
  'zh-CN': '自选股',
  'zh-TW': '自選股',
  es: 'Lista de seguimiento',
  fr: 'Liste de suivi',
  de: 'Watchlist',
  pt: 'Lista de observação',
  ru: 'Список наблюдения',
  ar: 'قائمة المتابعة',
  hi: 'वॉचलिस्ट',
  id: 'Daftar pantau',
  th: 'รายการติดตาม',
  tr: 'İzleme listesi',
  vi: 'Danh sách theo dõi',
};

const watchlistNS = {
  ko: { title: '관심 종목', addPlaceholder: '티커 입력 (예: AAPL, NVDA)', add: '추가', remove: '삭제', empty: '관심 종목이 없습니다', emptyDesc: '위에서 종목을 추가해 실시간 주가를 확인하세요', price: '현재가', change: '변동', market: '시장', preMarket: '프리마켓', postMarket: '애프터마켓', regular: '정규장', invalidTicker: '유효하지 않은 티커입니다', maxItems: '최대 30개까지 추가 가능', refreshAll: '모두 갱신', retry: '재시도' },
  en: { title: 'Watchlist', addPlaceholder: 'Enter ticker (e.g. AAPL, NVDA)', add: 'Add', remove: 'Remove', empty: 'No stocks yet', emptyDesc: 'Add tickers above to track live prices', price: 'Price', change: 'Change', market: 'Market', preMarket: 'Pre-market', postMarket: 'After-hours', regular: 'Regular', invalidTicker: 'Invalid ticker', maxItems: 'Up to 30 tickers allowed', refreshAll: 'Refresh all', retry: 'Retry' },
  ja: { title: 'ウォッチリスト', addPlaceholder: 'ティッカー入力 (例: AAPL, NVDA)', add: '追加', remove: '削除', empty: '銘柄がありません', emptyDesc: '上でティッカーを追加してリアルタイム価格を確認', price: '現在値', change: '変動', market: '市場', preMarket: 'プレマーケット', postMarket: '時間外', regular: '通常取引', invalidTicker: '無効なティッカー', maxItems: '最大30銘柄まで', refreshAll: '全て更新', retry: '再試行' },
  'zh-CN': { title: '自选股', addPlaceholder: '输入代码 (如: AAPL, NVDA)', add: '添加', remove: '删除', empty: '暂无自选股', emptyDesc: '在上方添加代码查看实时价格', price: '现价', change: '涨跌', market: '市场', preMarket: '盘前', postMarket: '盘后', regular: '盘中', invalidTicker: '代码无效', maxItems: '最多30只', refreshAll: '全部刷新', retry: '重试' },
  'zh-TW': { title: '自選股', addPlaceholder: '輸入代碼 (如: AAPL, NVDA)', add: '新增', remove: '刪除', empty: '尚無自選股', emptyDesc: '在上方新增代碼查看即時價格', price: '現價', change: '漲跌', market: '市場', preMarket: '盤前', postMarket: '盤後', regular: '盤中', invalidTicker: '代碼無效', maxItems: '最多30檔', refreshAll: '全部刷新', retry: '重試' },
  es: { title: 'Lista de seguimiento', addPlaceholder: 'Símbolo (ej: AAPL, NVDA)', add: 'Agregar', remove: 'Eliminar', empty: 'Sin acciones aún', emptyDesc: 'Agrega tickers arriba para seguir precios en vivo', price: 'Precio', change: 'Cambio', market: 'Mercado', preMarket: 'Pre-mercado', postMarket: 'Post-mercado', regular: 'Regular', invalidTicker: 'Ticker inválido', maxItems: 'Máx. 30 tickers', refreshAll: 'Actualizar todo', retry: 'Reintentar' },
  fr: { title: 'Liste de suivi', addPlaceholder: 'Symbole (ex: AAPL, NVDA)', add: 'Ajouter', remove: 'Supprimer', empty: 'Aucune action', emptyDesc: 'Ajoutez des tickers ci-dessus pour suivre les prix', price: 'Prix', change: 'Variation', market: 'Marché', preMarket: 'Pré-marché', postMarket: 'Après-bourse', regular: 'Régulier', invalidTicker: 'Ticker invalide', maxItems: '30 tickers max', refreshAll: 'Tout actualiser', retry: 'Réessayer' },
  de: { title: 'Watchlist', addPlaceholder: 'Symbol eingeben (z.B. AAPL, NVDA)', add: 'Hinzufügen', remove: 'Entfernen', empty: 'Keine Aktien', emptyDesc: 'Ticker oben hinzufügen für Live-Kurse', price: 'Kurs', change: 'Änderung', market: 'Markt', preMarket: 'Vormarkt', postMarket: 'Nachmarkt', regular: 'Regulär', invalidTicker: 'Ungültiger Ticker', maxItems: 'Max. 30 Ticker', refreshAll: 'Alle aktualisieren', retry: 'Wiederholen' },
  pt: { title: 'Lista de observação', addPlaceholder: 'Código (ex: AAPL, NVDA)', add: 'Adicionar', remove: 'Remover', empty: 'Sem ações', emptyDesc: 'Adicione tickers acima para acompanhar preços ao vivo', price: 'Preço', change: 'Variação', market: 'Mercado', preMarket: 'Pré-mercado', postMarket: 'Pós-mercado', regular: 'Regular', invalidTicker: 'Ticker inválido', maxItems: 'Máx. 30 tickers', refreshAll: 'Atualizar tudo', retry: 'Tentar novamente' },
  ru: { title: 'Список наблюдения', addPlaceholder: 'Тикер (напр. AAPL, NVDA)', add: 'Добавить', remove: 'Удалить', empty: 'Нет акций', emptyDesc: 'Добавьте тикеры выше для отслеживания цен', price: 'Цена', change: 'Изменение', market: 'Рынок', preMarket: 'До открытия', postMarket: 'После закрытия', regular: 'Основная сессия', invalidTicker: 'Неверный тикер', maxItems: 'Макс. 30 тикеров', refreshAll: 'Обновить всё', retry: 'Повторить' },
  ar: { title: 'قائمة المتابعة', addPlaceholder: 'أدخل الرمز (مثال: AAPL)', add: 'إضافة', remove: 'حذف', empty: 'لا توجد أسهم', emptyDesc: 'أضف الرموز أعلاه لمتابعة الأسعار', price: 'السعر', change: 'التغيير', market: 'السوق', preMarket: 'ما قبل السوق', postMarket: 'بعد السوق', regular: 'التداول العادي', invalidTicker: 'رمز غير صالح', maxItems: 'حد أقصى 30 رمزاً', refreshAll: 'تحديث الكل', retry: 'إعادة المحاولة' },
  hi: { title: 'वॉचलिस्ट', addPlaceholder: 'टिकर दर्ज करें (जैसे: AAPL, NVDA)', add: 'जोड़ें', remove: 'हटाएं', empty: 'कोई स्टॉक नहीं', emptyDesc: 'लाइव कीमतें देखने के लिए ऊपर टिकर जोड़ें', price: 'मूल्य', change: 'बदलाव', market: 'बाज़ार', preMarket: 'प्री-मार्केट', postMarket: 'आफ्टर-आवर्स', regular: 'नियमित', invalidTicker: 'अमान्य टिकर', maxItems: 'अधिकतम 30 टिकर', refreshAll: 'सब अपडेट करें', retry: 'पुनः प्रयास' },
  id: { title: 'Daftar pantau', addPlaceholder: 'Masukkan ticker (mis: AAPL, NVDA)', add: 'Tambah', remove: 'Hapus', empty: 'Belum ada saham', emptyDesc: 'Tambahkan ticker di atas untuk memantau harga', price: 'Harga', change: 'Perubahan', market: 'Pasar', preMarket: 'Pra-pasar', postMarket: 'Pasca-pasar', regular: 'Reguler', invalidTicker: 'Ticker tidak valid', maxItems: 'Maks. 30 ticker', refreshAll: 'Perbarui semua', retry: 'Coba lagi' },
  th: { title: 'รายการติดตาม', addPlaceholder: 'ใส่ Ticker (เช่น AAPL, NVDA)', add: 'เพิ่ม', remove: 'ลบ', empty: 'ยังไม่มีหุ้น', emptyDesc: 'เพิ่ม Ticker ด้านบนเพื่อติดตามราคา', price: 'ราคา', change: 'เปลี่ยนแปลง', market: 'ตลาด', preMarket: 'ก่อนตลาด', postMarket: 'หลังตลาด', regular: 'ปกติ', invalidTicker: 'Ticker ไม่ถูกต้อง', maxItems: 'สูงสุด 30 ticker', refreshAll: 'อัปเดตทั้งหมด', retry: 'ลองอีกครั้ง' },
  tr: { title: 'İzleme listesi', addPlaceholder: 'Ticker girin (örn: AAPL, NVDA)', add: 'Ekle', remove: 'Kaldır', empty: 'Henüz hisse yok', emptyDesc: 'Canlı fiyatları takip etmek için ticker ekleyin', price: 'Fiyat', change: 'Değişim', market: 'Piyasa', preMarket: 'Piyasa öncesi', postMarket: 'Piyasa sonrası', regular: 'Normal', invalidTicker: 'Geçersiz ticker', maxItems: 'Maks. 30 ticker', refreshAll: 'Hepsini yenile', retry: 'Tekrar dene' },
  vi: { title: 'Danh sách theo dõi', addPlaceholder: 'Nhập mã (vd: AAPL, NVDA)', add: 'Thêm', remove: 'Xóa', empty: 'Chưa có cổ phiếu', emptyDesc: 'Thêm mã cổ phiếu ở trên để theo dõi giá', price: 'Giá', change: 'Thay đổi', market: 'Thị trường', preMarket: 'Trước giờ', postMarket: 'Sau giờ', regular: 'Bình thường', invalidTicker: 'Mã không hợp lệ', maxItems: 'Tối đa 30 mã', refreshAll: 'Làm mới tất cả', retry: 'Thử lại' },
};

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let updated = 0;
for (const file of files) {
  const lang = file.replace('.json', '');
  const fp = path.join(dir, file);
  const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!obj.nav.watchlist) {
    obj.nav.watchlist = navTranslations[lang] || navTranslations.en;
  }
  if (!obj.watchlist) {
    obj.watchlist = watchlistNS[lang] || watchlistNS.en;
  }
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n');
  updated++;
  process.stdout.write(lang + ' ');
}
console.log('\nUpdated ' + updated + ' files');
