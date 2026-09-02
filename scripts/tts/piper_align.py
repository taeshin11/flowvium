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


def word_times(wav, model_size, lang):
    """whisper 로 낱말 시각. 실패하면 None — 호출부가 균등분배로 떨어진다."""
    try:
        from faster_whisper import WhisperModel
        m = WhisperModel(model_size, device="cpu", compute_type="int8")
        segs, _ = m.transcribe(wav, language=lang, word_timestamps=True)
        out = []
        for s in segs:
            for w in (s.words or []):
                out.append((w.word.strip(), float(w.start), float(w.end)))
        return out or None
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 균등분배로 살린다
        print(f"whisper 실패: {e}", file=sys.stderr)
        return None


def char_times(text, words, total):
    """낱말 시각을 **원문 글자**에 편다.

    whisper 는 숫자·약어를 원문과 다르게 적는다("고대역폭"→"곧이어폭"). 그래서 인식 결과를
    자막으로 쓰지 않는다 — 자막은 언제나 원문이고, whisper 에서는 **시각만** 가져온다.
    낱말을 원문에 맞추려 들면 그 오인식 때문에 어긋나므로, 낱말 경계 비율로 편다.
    """
    n = len(text)
    st = [0.0] * n
    en = [0.0] * n
    if not words:
        # 균등분배. 정확하지 않지만 자막이 아예 없는 것보다 낫다(note 로 알린다).
        for i in range(n):
            st[i] = total * i / max(1, n)
            en[i] = total * (i + 1) / max(1, n)
        return st, en, "정렬 실패 — 균등분배"

    # 원문을 낱말 수만큼 조각내고 각 조각에 그 낱말의 구간을 준다.
    k = len(words)
    bounds = [round(n * i / k) for i in range(k + 1)]
    for wi in range(k):
        a, b = bounds[wi], bounds[wi + 1]
        ws, we = words[wi][1], words[wi][2]
        span = max(1, b - a)
        for i in range(a, b):
            st[i] = ws + (we - ws) * (i - a) / span
            en[i] = ws + (we - ws) * (i - a + 1) / span
    # 마지막 글자가 음성 끝을 넘지 않게 한다.
    for i in range(n):
        en[i] = min(en[i], total)
        st[i] = min(st[i], total)
    return st, en, None


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
