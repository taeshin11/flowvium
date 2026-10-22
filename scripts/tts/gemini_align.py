#!/usr/bin/env python3
"""gemini_align.py — Gemini TTS 로 받은 wav 에 자막 시각을 붙인다. (2026-10-22, lib/gemini-tts.test.mjs 머리말)

Gemini 는 문자 시각을 주지 않는다 — 다른 엔진과 같이 whisper 로 되들어 낱말 시각을 얻고 자막 글자로 편다(align_common).
입력: --wavs-file(JSON 경로 배열) --display-texts-file(JSON 자막 배열, 같은 길이) --json-out
출력: [{"path","durationSec","alignment":{characters,character_start_times_seconds,character_end_times_seconds},"note"}]
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
    ap.add_argument("--wavs-file", required=True)
    ap.add_argument("--display-texts-file", required=True)
    ap.add_argument("--json-out", required=True)
    ap.add_argument("--tempo", type=float, default=1.0)
    ap.add_argument("--whisper", default="base")
    ap.add_argument("--lang", default="ko")
    a = ap.parse_args()
    wavs = json.load(open(a.wavs_file, encoding="utf-8"))
    shown = json.load(open(a.display_texts_file, encoding="utf-8"))
    if len(wavs) != len(shown):
        print(f"개수 불일치 — 소리 {len(wavs)} vs 자막 {len(shown)}", file=sys.stderr)
        sys.exit(2)
    results = []
    for i, (w, txt) in enumerate(zip(wavs, shown)):
        post_process(w, tempo=a.tempo, trim=False)
        dur = wav_duration(w)
        st, en, note = char_times(txt, word_times(w, a.whisper, a.lang), dur)
        results.append({"path": w, "durationSec": dur, "alignment": {
            "characters": list(txt), "character_start_times_seconds": st, "character_end_times_seconds": en}, "note": note})
        print(f"  [gemini-align] {i + 1}/{len(wavs)} {dur:.1f}초", file=sys.stderr, flush=True)
    json.dump(results, open(a.json_out, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
