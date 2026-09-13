#!/usr/bin/env python3
"""piper_align.py — 한국어 TTS(Piper) + 강제정렬(whisper) → 문자 단위 타임스탬프.

왜 Piper 인가 (2026-09-03):
  · Kokoro 0.9.4 는 한국어를 지원하지 않는다(영/영국/스/불/힌/이/포/일/중만).
  · ElevenLabs 는 starter 40,000자 중 104자만 남았고 갱신이 3주 뒤다.
  · MeloTTS 는 MIT 이고 한국어를 하지만 mecab-python3(일본어)와 python-mecab-ko(한국어 g2p)가
    같은 `MeCab` 모듈명을 놓고 충돌한다 — 한쪽을 깔면 다른 쪽이 깨진다.
  · Piper 는 MIT + ONNX 단일 런타임이라 그 의존성 문제가 원천적으로 없다.
    실측: 6.76초 음성을 0.50초에 합성(실시간의 13배).

kokoro_align.py 와 같은 계약을 지킨다 — 호출부(tts-korean.mjs)가 같은 모양을 기대한다.
  출력 JSON: {"durationSec": float, "alignment": {characters, character_start_times_seconds,
                                                  character_end_times_seconds}, "note": str|null}

정렬을 whisper 로 다시 듣는 이유: Piper 는 문자 시각을 주지 않는다. 만들어진 소리를 되들어
낱말 시각을 얻고 문자 단위로 편다. whisper 가 실패하면 균등분배로 떨어지되 **note 로 알린다** —
조용히 어긋난 자막이 나가는 것이 가장 나쁘다.
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from align_common import char_times, word_times  # 2026-09-13: 두 스크립트에 복제돼 있던 정렬 함수를 한 곳으로
import argparse
import json
import os
import sys
import wave


def synth(text, model, out_wav, speed):
    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(model)
    cfg = SynthesisConfig(length_scale=1.0 / speed) if speed and speed != 1.0 else None
    with wave.open(out_wav, "wb") as w:
        if cfg is not None:
            voice.synthesize_wav(text, w, syn_config=cfg)
        else:
            voice.synthesize_wav(text, w)
    with wave.open(out_wav) as f:
        return f.getnframes() / float(f.getframerate())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--json-out", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--whisper", default="base")
    ap.add_argument("--lang", default="ko")
    a = ap.parse_args()

    with open(a.text_file, encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        print("빈 텍스트", file=sys.stderr)
        sys.exit(2)
    if not os.path.exists(a.model):
        print(f"음성 모델 없음: {a.model}", file=sys.stderr)
        sys.exit(3)

    dur = synth(text, a.model, a.out, a.speed)
    words = word_times(a.out, a.whisper, a.lang)
    st, en, note = char_times(text, words, dur)

    with open(a.json_out, "w", encoding="utf-8") as f:
        json.dump({
            "durationSec": dur,
            "alignment": {
                "characters": list(text),
                "character_start_times_seconds": st,
                "character_end_times_seconds": en,
            },
            "note": note,
        }, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
