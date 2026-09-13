#!/usr/bin/env python3
"""qwen_align.py — 한국어 TTS(Qwen3-TTS CustomVoice) + 강제정렬(whisper) → 문자 타임스탬프.

왜 Qwen3-TTS 인가 (2026-09-03, 사용자 "tts가 너무 ai톤이다"):
  Piper(kss-medium)는 단일 화자 VITS 라 억양이 평평하다. 실측 음높이 변화 4.54반음 —
  사람 낭독의 아래쪽이다. Qwen3-TTS 는 9.87반음으로 두 배 넓고, 중앙 음높이도
  295Hz → 211Hz 로 낮아 덜 째진다.
  Apache-2.0 이라 상용 가능하고, **내장 화자 Sohee(Warm Korean female)** 를 쓰므로
  음성 복제가 필요 없다(사용자가 복제는 제외했다).

말투 지시(instruct):
  사용자가 네 가지를 듣고 'brief' 를 골랐다 — "속보를 전하는 아나운서처럼 단정하고 힘있게".
  실측 억양 7.86반음으로 넷 중 가장 절제돼 있다. 아나운서 톤은 표현력보다 **일정한 통제**다.

왜 한 번에 묶어 합성하나:
  모델 적재가 캐시 상태에서도 7초다. 장면마다 프로세스를 띄우면 4장면에 28초를 적재에만 쓴다.
  텍스트 배열을 받아 한 프로세스에서 전부 만든다.

piper_align.py / kokoro_align.py 와 **같은 반환 계약**을 지킨다 — 엔진을 갈아끼울 수 있어야 한다.
  출력 JSON: [{"durationSec": float, "alignment": {...}, "note": str|null}, ...]  (입력 순서대로)
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from align_common import char_times, speed_wav, word_times  # 2026-09-13: 두 스크립트에 복제돼 있던 정렬 함수를 한 곳으로
import argparse
import json
import os
import sys
import wave

DEFAULT_INSTRUCT = "속보를 전하는 아나운서처럼 단정하고 힘있게, 문장 끝을 분명히 맺으며 읽어라."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texts-file", required=True, help="JSON 배열 파일 — 합성할 문장들")
    ap.add_argument("--out-prefix", required=True, help="s0.wav, s1.wav … 로 저장할 접두사")
    ap.add_argument("--json-out", required=True)
    ap.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")
    ap.add_argument("--speaker", default="Sohee")
    ap.add_argument("--instruct", default=DEFAULT_INSTRUCT)
    ap.add_argument("--whisper", default="base")
    ap.add_argument("--lang", default="ko")
    ap.add_argument("--tempo", type=float, default=1.0)
    a = ap.parse_args()

    with open(a.texts_file, encoding="utf-8") as f:
        texts = json.load(f)
    texts = [str(t).strip() for t in texts if str(t).strip()]
    if not texts:
        print("빈 입력", file=sys.stderr)
        sys.exit(2)

    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(a.model, device_map=dev)

    results = []
    for i, txt in enumerate(texts):
        out_wav = f"{a.out_prefix}{i}.wav"
        # 한 문장씩 부른다. 배열로 한꺼번에 넣으면 실패 시 어느 문장인지 못 가린다.
        wavs, sr = model.generate_custom_voice(
            text=[txt], speaker=a.speaker, language=["korean"],
            **({"instruct": [a.instruct]} if a.instruct else {}),
        )
        sf.write(out_wav, wavs[0], sr)
        # 2026-09-03 사용자 "너무 느리고 한숨이 많다".
        #   모델에 속도 인자가 없다. 지시문으로 조이고, 남는 만큼 여기서 마저 조인다.
        #   atempo 는 **음높이를 바꾸지 않는다** — 단순 배속은 목소리가 높아져 못 쓴다.
        #   그리고 앞뒤·중간의 긴 무음을 잘라 낸다(모델이 숨 쉬는 자리를 길게 잡는다).
        if a.tempo and abs(a.tempo - 1.0) > 0.01:
            speed_wav(out_wav, a.tempo)
        with wave.open(out_wav) as f:
            dur = f.getnframes() / float(f.getframerate())
        st, en, note = char_times(txt, word_times(out_wav, a.whisper, a.lang), dur)
        results.append({
            "path": out_wav, "durationSec": dur,
            "alignment": {
                "characters": list(txt),
                "character_start_times_seconds": st,
                "character_end_times_seconds": en,
            },
            "note": note,
        })
        print(f"  [qwen] {i + 1}/{len(texts)} {dur:.1f}초", file=sys.stderr, flush=True)

    with open(a.json_out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
