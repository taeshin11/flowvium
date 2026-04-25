"""Add 'earnings' namespace (34 keys) to all 16 messages/*.json files."""
import json, pathlib, copy

ROOT = pathlib.Path(__file__).parent.parent / "messages"

EARNINGS_KO = {
    "pageTitle": "실적 캘린더",
    "pageDesc": "블룸버그 EE 대응 · Finnhub 무료 데이터 · EPS·매출 컨센서스 vs 실제 서프라이즈",
    "presetToday": "오늘",
    "presetWeek": "이번 주",
    "presetTwoweeks": "2주",
    "presetMonth": "1개월",
    "searchPlaceholder": "티커·기업명 검색 (NVDA, Apple…)",
    "sortDate": "날짜순",
    "sortSurprise": "Surprise 크기순",
    "filterMajorTitle": "S&P 100 + 주요 대형주만 표시",
    "filterMajor": "주요 종목",
    "refresh": "새로고침",
    "statTotal": "전체 건수",
    "statReported": "발표 완료",
    "statBeat": "예상 상회 (Beat)",
    "statMiss": "예상 하회 (Miss)",
    "colDate": "날짜",
    "colTime": "시간",
    "colTicker": "티커",
    "colCompany": "기업명",
    "colQuarter": "분기",
    "colEpsEst": "EPS 예상",
    "colEpsAct": "EPS 실제",
    "colEpsSurprise": "EPS Surprise",
    "colRevEst": "매출 예상",
    "colRevAct": "매출 실제",
    "colRevSurprise": "매출 Surprise",
    "colLink": "링크",
    "sessionPre": "장전",
    "sessionAfter": "장후",
    "sessionDuring": "장중",
    "emptyError": "오류: {error}",
    "emptyNone": "해당 기간 실적 발표 없음",
    "updatedAt": "업데이트: {date} · 출처: Finnhub · {cache}",
    "cacheHit": "캐시됨 (2h TTL)",
    "cacheNo": "실시간",
}

EARNINGS_EN = {
    "pageTitle": "Earnings Calendar",
    "pageDesc": "Bloomberg EE equivalent · Finnhub free data · EPS & Revenue consensus vs actual surprise",
    "presetToday": "Today",
    "presetWeek": "This Week",
    "presetTwoweeks": "2 Weeks",
    "presetMonth": "1 Month",
    "searchPlaceholder": "Search ticker or company (NVDA, Apple…)",
    "sortDate": "By Date",
    "sortSurprise": "By Surprise Size",
    "filterMajorTitle": "Show S&P 100 + major large caps only",
    "filterMajor": "Major",
    "refresh": "Refresh",
    "statTotal": "Total",
    "statReported": "Reported",
    "statBeat": "Beat",
    "statMiss": "Miss",
    "colDate": "Date",
    "colTime": "Time",
    "colTicker": "Ticker",
    "colCompany": "Company",
    "colQuarter": "Quarter",
    "colEpsEst": "EPS Est.",
    "colEpsAct": "EPS Act.",
    "colEpsSurprise": "EPS Surprise",
    "colRevEst": "Rev. Est.",
    "colRevAct": "Rev. Act.",
    "colRevSurprise": "Rev. Surprise",
    "colLink": "Link",
    "sessionPre": "Pre",
    "sessionAfter": "After",
    "sessionDuring": "During",
    "emptyError": "Error: {error}",
    "emptyNone": "No earnings in this period",
    "updatedAt": "Updated: {date} · Source: Finnhub · {cache}",
    "cacheHit": "Cached (2h TTL)",
    "cacheNo": "Live",
}

EARNINGS_JA = {
    "pageTitle": "決算カレンダー",
    "pageDesc": "Bloomberg EE 相当 · Finnhub 無料データ · EPS・売上コンセンサス vs 実績サプライズ",
    "presetToday": "今日",
    "presetWeek": "今週",
    "presetTwoweeks": "2週間",
    "presetMonth": "1ヶ月",
    "searchPlaceholder": "ティッカー・企業名検索 (NVDA, Apple…)",
    "sortDate": "日付順",
    "sortSurprise": "サプライズ規模順",
    "filterMajorTitle": "S&P 100 + 主要大型株のみ表示",
    "filterMajor": "主要銘柄",
    "refresh": "更新",
    "statTotal": "合計",
    "statReported": "発表済",
    "statBeat": "上回り (Beat)",
    "statMiss": "下回り (Miss)",
    "colDate": "日付",
    "colTime": "時間",
    "colTicker": "ティッカー",
    "colCompany": "企業名",
    "colQuarter": "四半期",
    "colEpsEst": "EPS予想",
    "colEpsAct": "EPS実績",
    "colEpsSurprise": "EPS Surprise",
    "colRevEst": "売上予想",
    "colRevAct": "売上実績",
    "colRevSurprise": "売上 Surprise",
    "colLink": "リンク",
    "sessionPre": "前場",
    "sessionAfter": "後場",
    "sessionDuring": "場中",
    "emptyError": "エラー: {error}",
    "emptyNone": "該当期間の決算発表なし",
    "updatedAt": "更新: {date} · ソース: Finnhub · {cache}",
    "cacheHit": "キャッシュ (2h TTL)",
    "cacheNo": "リアルタイム",
}

EARNINGS_ZH_CN = {
    "pageTitle": "财报日历",
    "pageDesc": "Bloomberg EE 对标 · Finnhub 免费数据 · EPS及营收预期vs实际超预期",
    "presetToday": "今日",
    "presetWeek": "本周",
    "presetTwoweeks": "两周",
    "presetMonth": "一个月",
    "searchPlaceholder": "搜索股票代码或公司名 (NVDA, Apple…)",
    "sortDate": "按日期",
    "sortSurprise": "按超预期幅度",
    "filterMajorTitle": "仅显示S&P 100 + 主要大盘股",
    "filterMajor": "主要股票",
    "refresh": "刷新",
    "statTotal": "总计",
    "statReported": "已发布",
    "statBeat": "超预期 (Beat)",
    "statMiss": "低于预期 (Miss)",
    "colDate": "日期",
    "colTime": "时间",
    "colTicker": "代码",
    "colCompany": "公司",
    "colQuarter": "季度",
    "colEpsEst": "EPS预期",
    "colEpsAct": "EPS实际",
    "colEpsSurprise": "EPS超预期",
    "colRevEst": "营收预期",
    "colRevAct": "营收实际",
    "colRevSurprise": "营收超预期",
    "colLink": "链接",
    "sessionPre": "盘前",
    "sessionAfter": "盘后",
    "sessionDuring": "盘中",
    "emptyError": "错误: {error}",
    "emptyNone": "该时段无财报发布",
    "updatedAt": "更新时间: {date} · 来源: Finnhub · {cache}",
    "cacheHit": "缓存 (2h TTL)",
    "cacheNo": "实时",
}

OVERRIDES = {
    "zh-TW": {
        "pageTitle": "財報日曆",
        "pageDesc": "Bloomberg EE 對標 · Finnhub 免費數據 · EPS及營收預期vs實際超預期",
        "presetToday": "今日",
        "presetWeek": "本週",
        "presetTwoweeks": "兩週",
        "presetMonth": "一個月",
        "searchPlaceholder": "搜尋股票代碼或公司名 (NVDA, Apple…)",
        "sortDate": "依日期",
        "sortSurprise": "依超預期幅度",
        "filterMajorTitle": "僅顯示S&P 100 + 主要大盤股",
        "filterMajor": "主要股票",
        "refresh": "重新整理",
        "statTotal": "總計",
        "statReported": "已發布",
        "statBeat": "超預期 (Beat)",
        "statMiss": "低於預期 (Miss)",
        "colDate": "日期",
        "colTime": "時間",
        "colTicker": "代碼",
        "colCompany": "公司",
        "colQuarter": "季度",
        "colEpsEst": "EPS預期",
        "colEpsAct": "EPS實際",
        "colEpsSurprise": "EPS超預期",
        "colRevEst": "營收預期",
        "colRevAct": "營收實際",
        "colRevSurprise": "營收超預期",
        "colLink": "連結",
        "sessionPre": "盤前",
        "sessionAfter": "盤後",
        "sessionDuring": "盤中",
        "emptyError": "錯誤: {error}",
        "emptyNone": "該時段無財報發布",
        "updatedAt": "更新時間: {date} · 來源: Finnhub · {cache}",
        "cacheHit": "快取 (2h TTL)",
        "cacheNo": "即時",
    }
}

LOCALE_MAP = {
    "ko": EARNINGS_KO,
    "en": EARNINGS_EN,
    "ja": EARNINGS_JA,
    "zh-CN": EARNINGS_ZH_CN,
}

def get_earnings(locale: str) -> dict:
    if locale in LOCALE_MAP:
        return LOCALE_MAP[locale]
    if locale in OVERRIDES:
        base = copy.deepcopy(EARNINGS_EN)
        base.update(OVERRIDES[locale])
        return base
    return EARNINGS_EN  # fallback for other locales

total_written = 0
for fpath in sorted(ROOT.glob("*.json")):
    locale = fpath.stem  # e.g., "ko", "en", "zh-CN"
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "earnings" not in data:
        data["earnings"] = get_earnings(locale)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  OK {fpath.name}: {len(data['earnings'])} keys added")
        total_written += 1
    else:
        print(f"  SKIP {fpath.name}: 'earnings' already exists")

print(f"\nDone. {total_written} files updated.")
