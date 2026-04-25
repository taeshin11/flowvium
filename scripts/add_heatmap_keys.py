"""Add 'heatmap' namespace to all 16 messages/*.json files."""
import json, pathlib, copy

ROOT = pathlib.Path(__file__).parent.parent / "messages"

HEATMAP_KO = {
    "pageTitle": "시장 히트맵",
    "pageDesc": "박스 크기 = 시가총액 · 색상 = 등락률 · {count}개 종목",
    "loading": "시장 데이터 수신 중...",
    "error": "데이터를 불러올 수 없습니다",
    "statsUp": "▲ {count}종목",
    "statsDown": "▼ {count}종목",
    "refresh": "갱신",
    "viewSectors": "섹터별",
    "viewOverview": "전체보기",
    "colorSpectrum": "색상 스펙트럼:",
    "totalMarket": "전체 시장 ({count}종목)",
    "sourceBase": "출처: {source}",
    "sourceDate": "{date} 세션",
    "sourceCache": "15분 캐시",
    "cKR": "한국",
    "cJP": "일본",
    "cCN": "중국",
    "cEU": "유럽",
    "cIN": "인도",
    "cTW": "대만",
}

HEATMAP_EN = {
    "pageTitle": "Market Heatmap",
    "pageDesc": "Box size = Market cap · Color = % change · {count} stocks",
    "loading": "Loading market data...",
    "error": "Could not load data",
    "statsUp": "▲ {count} up",
    "statsDown": "▼ {count} down",
    "refresh": "Refresh",
    "viewSectors": "By Sector",
    "viewOverview": "Overview",
    "colorSpectrum": "Color scale:",
    "totalMarket": "All Market ({count} stocks)",
    "sourceBase": "Source: {source}",
    "sourceDate": "{date} session",
    "sourceCache": "15min cache",
    "cKR": "Korea",
    "cJP": "Japan",
    "cCN": "China",
    "cEU": "Europe",
    "cIN": "India",
    "cTW": "Taiwan",
}

HEATMAP_JA = {
    "pageTitle": "市場ヒートマップ",
    "pageDesc": "ボックスサイズ = 時価総額 · 色 = 騰落率 · {count}銘柄",
    "loading": "市場データを取得中...",
    "error": "データを読み込めません",
    "statsUp": "▲ {count}銘柄",
    "statsDown": "▼ {count}銘柄",
    "refresh": "更新",
    "viewSectors": "セクター別",
    "viewOverview": "全体表示",
    "colorSpectrum": "カラースケール:",
    "totalMarket": "全市場 ({count}銘柄)",
    "sourceBase": "出典: {source}",
    "sourceDate": "{date}セッション",
    "sourceCache": "15分キャッシュ",
    "cKR": "韓国",
    "cJP": "日本",
    "cCN": "中国",
    "cEU": "欧州",
    "cIN": "インド",
    "cTW": "台湾",
}

HEATMAP_ZH_CN = {
    "pageTitle": "市场热力图",
    "pageDesc": "方块大小 = 市值 · 颜色 = 涨跌幅 · {count}只股票",
    "loading": "正在加载市场数据...",
    "error": "无法加载数据",
    "statsUp": "▲ {count}只上涨",
    "statsDown": "▼ {count}只下跌",
    "refresh": "刷新",
    "viewSectors": "按板块",
    "viewOverview": "全览",
    "colorSpectrum": "颜色范围:",
    "totalMarket": "全部市场 ({count}只)",
    "sourceBase": "来源: {source}",
    "sourceDate": "{date} 交易日",
    "sourceCache": "15分钟缓存",
    "cKR": "韩国",
    "cJP": "日本",
    "cCN": "中国",
    "cEU": "欧洲",
    "cIN": "印度",
    "cTW": "台湾",
}

OVERRIDES = {
    "zh-TW": {
        "pageTitle": "市場熱力圖",
        "pageDesc": "方塊大小 = 市值 · 顏色 = 漲跌幅 · {count}支股票",
        "loading": "正在載入市場資料...",
        "error": "無法載入資料",
        "statsUp": "▲ {count}支上漲",
        "statsDown": "▼ {count}支下跌",
        "refresh": "重新整理",
        "viewSectors": "依板塊",
        "viewOverview": "總覽",
        "colorSpectrum": "顏色範圍:",
        "totalMarket": "全部市場 ({count}支)",
        "sourceBase": "來源: {source}",
        "sourceDate": "{date} 交易日",
        "sourceCache": "15分鐘快取",
        "cKR": "韓國",
        "cJP": "日本",
        "cCN": "中國",
        "cEU": "歐洲",
        "cIN": "印度",
        "cTW": "台灣",
    }
}

LOCALE_MAP = {
    "ko": HEATMAP_KO,
    "en": HEATMAP_EN,
    "ja": HEATMAP_JA,
    "zh-CN": HEATMAP_ZH_CN,
}

def get_heatmap(locale: str) -> dict:
    if locale in LOCALE_MAP:
        return LOCALE_MAP[locale]
    if locale in OVERRIDES:
        base = copy.deepcopy(HEATMAP_EN)
        base.update(OVERRIDES[locale])
        return base
    return HEATMAP_EN

total_written = 0
for fpath in sorted(ROOT.glob("*.json")):
    locale = fpath.stem
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "heatmap" not in data:
        data["heatmap"] = get_heatmap(locale)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  OK {fpath.name}: {len(data['heatmap'])} keys")
        total_written += 1
    else:
        print(f"  SKIP {fpath.name}: 'heatmap' already exists")

print(f"Done. {total_written} files updated.")
