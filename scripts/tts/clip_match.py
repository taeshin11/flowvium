#!/usr/bin/env python3
"""clip_match.py — 사진이 자막과 맞는가를 **기계가** 판정한다.

왜 (2026-09-06 사용자 "실패하면 웹이든 허깅페이스든 깃허브든 좀 물어보고 어떻게든 성공시켜"):
  이틀 동안 잘못된 사진을 여덟 번 눈으로 잡아 내렸다 — 검찰총장 사진, 임시정부 청사,
  투호·지게, CU 편의점, 옛 코스피 지수. 매번 새로운 종류라 규칙을 하나씩 더해도 끝이 없었다.
  **사람이 보고 판단하던 것을 모델에게 시킨다.**

  한국어 CLIP(Bingsu/clip-vit-large-patch14-ko)은 사진과 한국어 문장을 같은 공간에 넣어
  얼마나 맞는지 점수를 낸다. 그게 정확히 우리가 눈으로 하던 일이다.

  판정은 **미끼와 견주어** 한다. 절대 점수는 사진마다 들쭉날쭉해 임계값을 못 정하고,
  장면 자막끼리 견주는 것도 안 된다 — 한 회차의 장면들은 대개 같은 사건이라 사진이
  서로 바꿔 써도 맞는다(실측: 이란 미사일 편에서 넷 다 "어긋남" 으로 나왔다. 헛경보다).

  그래서 이 회차의 주제 문장과, **무관한 미끼 문장들**을 함께 넣는다.
  미끼가 주제를 이기면 그 사진은 이 회차 것이 아니다. 실제로 내보냈다가 내린 것들 —
  방송사 로고, 기관 엠블럼, 도시 야경, 편의점 진열, 전통 놀이, 역사 건축물, 도표 — 을 미끼로 둔다.

사용: clip_match.py --pairs pairs.json  (JSON: [{"image": "경로", "topic": "이 회차 주제"}, ...])
출력: [{"index":0, "topic":0.62, "decoy":0.11, "worstDecoy":"방송사 로고", "ok":true}, ...]
"""
import argparse
import json
import sys


# 실제로 내보냈다가 내린 것들에서 뽑았다. 사진이 이쪽에 더 가까우면 그 회차 것이 아니다.
# 미끼는 **구체적인 사물·그래픽**이어야 한다.
#   2026-09-06: "한국 전통 놀이와 민속 도구" 를 넣었더니 **태극기·한복이 보이는 대통령 출국 사진**을
#   끌어당겨 멀쩡한 사진 둘을 버렸다(0.96·0.88). 한국 뉴스 사진에는 태극기가 늘 나온다.
#   사람이 찍힌 뉴스 현장과 겹치지 않는 것만 남긴다.
# 미끼는 두 종류다. 섞어 쓰면 판정이 흐려진다.
#
#   ① **형식 미끼** — 애초에 사진이 아닌 것. 방송사 배너·글자판.
#      이건 무슨 뉴스든 화면에 깔면 안 된다.
#   ② **내용 미끼** — 사진이긴 한데 이 뉴스가 아닌 것.
#
# 2026-09-06 실측으로 나눠야 할 이유가 분명해졌다. YTN 채널 배너가
#   "주제 0.5064 > 미끼 0.3344" 라서 통과해 그대로 나갔다(0MAkdWup3Xs, 내렸다).
#   그런데 진짜 기사 사진 7장을 재 보니 형식 미끼는 0.0000~0.0120 이었다.
#   배너만 0.3344 — 두 자릿수 차이다. 반면 내용 미끼는 진짜 사진도 0.4264 까지 올라간다
#   (자폐 아들 사진이 "민속 도구" 에 0.43). 그래서 **형식 미끼에만 낮은 문턱**을 둔다.
FORM_DECOYS = [
    "방송사 로고와 채널 이름이 크게 박힌 화면",
    "글자만 있는 안내 배너",
]
CONTENT_DECOYS = [
    "편의점 진열대의 상품들",
    "투호 윷놀이 장독대 같은 민속 도구만 있는 사진",
    "통계 도표와 막대그래프",
    "지도와 위성 사진",
]
DECOYS = FORM_DECOYS + CONTENT_DECOYS

# 형식 미끼가 이만큼을 가져가면 그건 사진이 아니라 배너다.
#   진짜 사진 최대 0.0120 · 배너 0.3344 사이에서 잡았다.
FORM_LIMIT = 0.20


def image_similarity(model, proc, dev, images):
    """사진끼리 얼마나 비슷한가 (0~1). 같은 행사를 다른 매체가 찍은 사진은 URL·픽셀이 달라
    해시로는 못 잡지만, 보는 사람에게는 같은 화면이다.

    2026-09-06 실측: 이재명 대통령 편에서 1·2·3·5번이 전부 같은 자리·같은 옷이었다.
    31초 내내 거의 정지 화면이 됐다.
    """
    import torch
    with torch.no_grad():
        inputs = proc(images=images, return_tensors="pt")
        inputs = {k: v.to(dev) for k, v in inputs.items()}
        feats = model.get_image_features(**inputs)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        return (feats @ feats.T).cpu().tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--image-sim", action="store_true",
                    help="자막 대신 **사진끼리** 비슷한 정도를 낸다")
    ap.add_argument("--model", default="Bingsu/clip-vit-large-patch14-ko")
    ap.add_argument("--json-out", required=True)
    a = ap.parse_args()

    with open(a.pairs, encoding="utf-8") as f:
        pairs = json.load(f)
    if not pairs:
        json.dump([], open(a.json_out, "w"))
        return

    from PIL import Image
    import torch
    from transformers import AutoModel, AutoProcessor

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoProcessor.from_pretrained(a.model)
    model = AutoModel.from_pretrained(a.model).to(dev).eval()

    images = [Image.open(p["image"]).convert("RGB") for p in pairs]

    if a.image_sim:
        sim = image_similarity(model, proc, dev, images)
        json.dump(sim, open(a.json_out, "w"))
        for i, row in enumerate(sim):
            near = [f"{j + 1}:{row[j]:.2f}" for j in range(len(row)) if j != i and row[j] >= 0.9]
            print(f"  사진{i + 1}: {'매우 비슷 ' + ', '.join(near) if near else '고유'}", file=sys.stderr)
        return

    res = []
    for i, p in enumerate(pairs):
        topic = str(p.get("topic") or p.get("text") or "")[:160]
        texts = [topic] + DECOYS
        with torch.no_grad():
            inputs = proc(text=texts, images=[images[i]], return_tensors="pt",
                          padding=True, truncation=True)
            inputs = {k: v.to(dev) for k, v in inputs.items()}
            row = model(**inputs).logits_per_image.softmax(dim=1).cpu()[0]
        topic_score = float(row[0])
        worst_j = int(row[1:].argmax()) + 1
        decoy_score = float(row[worst_j])
        # 형식 미끼(배너·글자판)가 가져간 몫. 주제를 못 이겨도 이게 크면 사진이 아니다.
        form_score = max(float(row[1 + DECOYS.index(d)]) for d in FORM_DECOYS)
        res.append({
            "index": i,
            "topic": round(topic_score, 4),
            "decoy": round(decoy_score, 4),
            "worstDecoy": DECOYS[worst_j - 1],
            "formDecoy": round(form_score, 4),
            # 두 가지로 거른다.
            #   ① 미끼가 주제를 이기면 이 회차 사진이 아니다.
            #   ② 주제를 이기지 못해도 **배너로 보이면** 화면에 깔 수 없다.
            "ok": bool(topic_score >= decoy_score and form_score < FORM_LIMIT),
        })

    json.dump(res, open(a.json_out, "w", encoding="utf-8"))
    for r in res:
        if r["ok"]:
            mark = "✓"
        elif r["formDecoy"] >= FORM_LIMIT:
            mark = f"✗ 배너로 보인다({r['formDecoy']:.2f})"
        else:
            mark = f"✗ '{r['worstDecoy']}' 에 더 가깝다"
        print(f"  장면{r['index'] + 1}: 주제 {r['topic']:.3f} / 미끼 {r['decoy']:.3f}  {mark}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
