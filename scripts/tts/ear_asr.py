#!/usr/bin/env python3
"""ear_asr.py — 만든 소리를 받아쓴다(귀검증). 2026-09-25.

scripts/lib/ear-check.mjs 가 부른다. 입력: wav 경로 JSON 배열 파일, 출력: 같은 순서의 받아쓴 문장 JSON 배열.
모델은 faster-whisper small(한국어 고정, CPU int8). base 는 약해서 유령 오독이 섞였다(kr-number 되들음 기록).
"""
import json
import sys

from faster_whisper import WhisperModel


def main():
    src, dst = sys.argv[1], sys.argv[2]
    paths = json.load(open(src, encoding="utf-8"))
    model = WhisperModel("small", device="cpu", compute_type="int8")
    out = []
    for p in paths:
        segs, _ = model.transcribe(p, language="ko", beam_size=5)
        out.append("".join(s.text for s in segs).strip())
    json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
