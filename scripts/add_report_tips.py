"""Add tooltip keys to 'report' namespace in all 16 messages/*.json files."""
import json, pathlib, copy

ROOT = pathlib.Path(__file__).parent.parent / "messages"

TIPS_KO = {
    "tipFg": "공포탐욕지수 (0-100). 25이하=극단적 공포, 75이상=극단적 탐욕. 투자 심리를 나타내며 역발상 신호로 사용.",
    "tipSpy": "S&P 500 ETF 최근 1주일 수익률. 미국 대형주 시장의 단기 방향성.",
    "tipCurve": "10년-2년 국채 금리 차이(bp). 음수(역전)는 역사적으로 경기침체 선행 신호. 양수=정상.",
    "tipHyOas": "하이일드 채권 위험 프리미엄. 5%↑=신용 위기, 4-5%=주의, 4%이하=안전. 높을수록 신용 스트레스.",
    "tipVix": "시장 공포지수. 20이하=안정, 20-25=보통, 25-30=주의, 30↑=극단적 공포 구간.",
    "tipFomc": "CME FedWatch 기준 다음 FOMC 회의 금리 인하 확률. 시장이 예측하는 연준 정책 방향.",
    "tipCycle": "GDP 성장률과 CPI 물가 기반 경기 사이클. Goldilocks=최적, Stagflation=저성장+고물가, Overheating=과열, Recession=침체.",
}
TIPS_EN = {
    "tipFg": "Fear & Greed Index (0-100). ≤25=extreme fear, ≥75=extreme greed. Contrarian signal for market sentiment.",
    "tipSpy": "S&P 500 ETF 1-week return. Short-term direction of the US large-cap market.",
    "tipCurve": "10Y minus 2Y Treasury yield spread (bp). Negative (inverted) historically signals recession. Positive=normal.",
    "tipHyOas": "High-yield bond risk premium. >5%=credit stress, 4-5%=caution, <4%=safe. Higher = more credit risk.",
    "tipVix": "Market fear index. <20=calm, 20-25=normal, 25-30=caution, >30=extreme fear zone.",
    "tipFomc": "CME FedWatch probability of a rate cut at the next FOMC meeting. Market's bet on Fed policy.",
    "tipCycle": "Business cycle based on GDP growth & CPI. Goldilocks=ideal, Stagflation=low growth+high inflation, Overheating=hot, Recession=contraction.",
}
TIPS_JA = {
    "tipFg": "恐怖貪欲指数 (0-100). 25以下=極度の恐怖, 75以上=極度の貪欲. 逆張りシグナルとして使用。",
    "tipSpy": "S&P 500 ETFの直近1週間リターン。米国大型株市場の短期方向性。",
    "tipCurve": "10年-2年国債利回り差 (bp). マイナス(逆転)は過去に景気後退の先行指標。プラス=正常。",
    "tipHyOas": "ハイイールド債リスクプレミアム。5%超=信用危機、4-5%=注意、4%未満=安全。",
    "tipVix": "市場恐怖指数。20未満=安定、20-25=普通、25-30=注意、30超=極度の恐怖。",
    "tipFomc": "CME FedWatchによる次回FOMC会合での利下げ確率。",
    "tipCycle": "GDP成長率とCPIに基づく景気サイクル。Goldilocks=最適、Stagflation=低成長+高インフレ。",
}
TIPS_ZH_CN = {
    "tipFg": "恐惧贪婪指数 (0-100). ≤25=极度恐惧, ≥75=极度贪婪. 用作逆向投资信号。",
    "tipSpy": "S&P 500 ETF近1周收益率。美国大盘股市场短期方向。",
    "tipCurve": "10年-2年国债收益率利差(bp). 负值(倒挂)历史上是衰退领先指标。正值=正常。",
    "tipHyOas": "高收益债券风险溢价。>5%=信用危机，4-5%=注意，<4%=安全。",
    "tipVix": "市场恐惧指数。<20=平静，20-25=普通，25-30=注意，>30=极度恐惧。",
    "tipFomc": "CME FedWatch下次FOMC会议降息概率。",
    "tipCycle": "基于GDP增长和CPI的经济周期。Goldilocks=理想，Stagflation=低增长+高通胀。",
}

OVERRIDES = {
    "zh-TW": {
        "tipFg": "恐懼貪婪指數 (0-100). ≤25=極度恐懼, ≥75=極度貪婪. 逆向投資信號。",
        "tipSpy": "S&P 500 ETF近1週漲幅。美國大型股市場短期方向。",
        "tipCurve": "10年-2年公債利差(bp). 負值(倒掛)為衰退領先指標。正值=正常。",
        "tipHyOas": "高收益債券風險溢價。>5%=信用危機，4-5%=注意，<4%=安全。",
        "tipVix": "市場恐慌指數。<20=平靜，25-30=注意，>30=極度恐慌。",
        "tipFomc": "CME FedWatch下次FOMC降息機率。",
        "tipCycle": "基於GDP與CPI的景氣循環。Goldilocks=理想，Stagflation=停滯性通膨。",
    }
}

LOCALE_MAP = {"ko": TIPS_KO, "en": TIPS_EN, "ja": TIPS_JA, "zh-CN": TIPS_ZH_CN}

def get_tips(locale):
    if locale in LOCALE_MAP:
        return LOCALE_MAP[locale]
    if locale in OVERRIDES:
        base = copy.deepcopy(TIPS_EN)
        base.update(OVERRIDES[locale])
        return base
    return TIPS_EN

total = 0
for fpath in sorted(ROOT.glob("*.json")):
    locale = fpath.stem
    with open(fpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "report" not in data:
        print(f"SKIP {fpath.name}: no report namespace")
        continue
    tips = get_tips(locale)
    updated = False
    for k, v in tips.items():
        if k not in data["report"]:
            data["report"][k] = v
            updated = True
    if updated:
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"OK {fpath.name}")
        total += 1
    else:
        print(f"SKIP {fpath.name}: already has tips")
print(f"Done. {total} files updated.")
