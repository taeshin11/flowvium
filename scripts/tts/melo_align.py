#!/usr/bin/env python3
"""melo_align.py — 한국어 TTS(MeloTTS) + 강제정렬(whisper) → 문자 타임스탬프.

왜 MeloTTS 인가 (2026-09-13, 사용자 비교 청취 후 "좋네 앞으로 이거로"):
  실측 — 모델 적재 0.8초, 문장당 0.7~0.9초(실시간 7배). Qwen3-TTS 는 적재 7초에
  문장당 15초(실시간 0.26배)였다. 3문장 기준 44초 → 2.4초.
  한 회차 네 장면이면 1분 넘게 줄어든다.

2026-09-03 에 한 번 포기했던 엔진이다. 그때 적힌 이유는 "mecab-python3 와 python-mecab-ko 가
  같은 MeCab 모듈명을 다툰다" 였는데 그건 증상이었다. 진짜 원인은 **이 맥의 파일시스템이
  대소문자를 구분하지 않는 것** 이다 — `MeCab/` 과 `mecab/` 이 물리적으로 같은 디렉터리라
  둘을 같이 깔면 서로 덮어쓴다. 파이썬 네임스페이스 문제가 아니라 디스크 문제였다.
  한국어 g2p(g2pkk)는 python-mecab-ko 를 쓰므로 일본어 쪽(mecab-python3)을 뺀다.
  melo/text/japanese.py 의 MeCab import 도 지연으로 바꿨다 — korean → chinese_mix →
  english → japanese 체인 때문에 한국어만 써도 일본어 모듈이 뜨기 때문이다(원본 .orig 보존).

숫자는 한글로 받는 것을 전제한다. 대본 프롬프트가 이미 그렇게 요구한다(shorts-layout.mjs).
  실측: "12조 원" 을 넣으면 "1위 조언" 으로 깨지고, "십이조 원" 은 제대로 읽는다.

piper_align.py / qwen_align.py 와 **같은 반환 계약**을 지킨다 — 엔진을 갈아끼울 수 있어야 한다.
  출력 JSON: [{"path": str, "durationSec": float, "alignment": {...}, "note": str|null}, ...]
"""
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from align_common import char_times, post_process, wav_duration, word_times

import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texts-file", required=True, help="JSON 배열 파일 — 합성할 문장들")
    ap.add_argument("--out-prefix", required=True, help="s0.wav, s1.wav … 로 저장할 접두사")
    ap.add_argument("--json-out", required=True)
    ap.add_argument("--speed", type=float, default=1.15, help="엔진 자체 속도(음높이 보존)")
    ap.add_argument("--tempo", type=float, default=1.0, help="추가 배속. 보통 speed 로 충분해 1.0")
    ap.add_argument("--speaker", default="", help="비우면 첫 화자")
    ap.add_argument("--whisper", default="base")
    ap.add_argument("--lang", default="ko")
    ap.add_argument("--device", default="cpu", help="mps 는 MeloTTS 에서 불안정해 기본 cpu")
    a = ap.parse_args()

    with open(a.texts_file, encoding="utf-8") as f:
        texts = [str(t).strip() for t in json.load(f) if str(t).strip()]
    if not texts:
        print("빈 입력", file=sys.stderr)
        sys.exit(2)

    from melo.api import TTS

    tts = TTS(language="KR", device=a.device)
    spk = tts.hps.data.spk2id
    sid = spk.get(a.speaker) if a.speaker else None
    if sid is None:
        sid = list(spk.values())[0]

    results = []
    for i, txt in enumerate(texts):
        out_wav = f"{a.out_prefix}{i}.wav"
        tts.tts_to_file(txt, sid, out_wav, speed=a.speed, quiet=True)
        # 엔진 속도로 이미 조였으므로 tempo 는 보통 1.0. 무음 정리는 그래도 한다.
        post_process(out_wav, tempo=a.tempo, trim=True)
        dur = wav_duration(out_wav)
        st, en, note = char_times(txt, word_times(out_wav, a.whisper, a.lang), dur)
        results.append({
            "path": out_wav,
            "durationSec": dur,
            "alignment": {
                "characters": list(txt),
                "character_start_times_seconds": st,
                "character_end_times_seconds": en,
            },
            "note": note,
        })
        print(f"  [melo] {i + 1}/{len(texts)} {dur:.1f}초", file=sys.stderr, flush=True)

    with open(a.json_out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
