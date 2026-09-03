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
import argparse
import json
import os
import sys
import wave

DEFAULT_INSTRUCT = "속보를 전하는 아나운서처럼 단정하고 힘있게, 문장 끝을 분명히 맺으며 읽어라."


def speed_wav(path, tempo):
    """atempo 로 배속. 음높이를 보존하므로 목소리가 변하지 않는다.
    긴 무음도 같이 줄인다 — 모델이 문장 사이에 숨 쉬는 자리를 길게 잡는다(사용자 "한숨이 많다").
    """
    import shutil
    import subprocess
    ff = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if not ff:
        print("ffmpeg 없음 — 배속 생략", file=sys.stderr)
        return
    tmp = path + ".tmp.wav"
    # silenceremove: 0.35초 넘는 무음을 0.18초로 줄인다. 완전히 없애면 붙어 읽어 알아듣기 힘들다.
    af = (f"atempo={tempo:.3f},"
          "silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-42dB")
    r = subprocess.run([ff, "-v", "error", "-i", path, "-af", af, "-y", tmp],
                       capture_output=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
    else:
        print(f"배속 실패({r.returncode}) — 원본 유지", file=sys.stderr)


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
    except Exception as e:  # noqa: BLE001
        print(f"whisper 실패: {e}", file=sys.stderr)
        return None


def char_times(text, words, total):
    """낱말 시각을 원문 글자에 편다.

    whisper 는 숫자·약어를 원문과 다르게 적는다("고대역폭"→"고대혁폭"). 그래서 인식 결과를
    자막으로 쓰지 않는다 — 자막은 언제나 원문이고 whisper 에서는 **시각만** 가져온다.
    """
    n = len(text)
    st = [0.0] * n
    en = [0.0] * n
    if not words:
        for i in range(n):
            st[i] = total * i / max(1, n)
            en[i] = total * (i + 1) / max(1, n)
        return st, en, "정렬 실패 — 균등분배"
    k = len(words)
    bounds = [round(n * i / k) for i in range(k + 1)]
    for wi in range(k):
        a, b = bounds[wi], bounds[wi + 1]
        ws, we = words[wi][1], words[wi][2]
        span = max(1, b - a)
        for i in range(a, b):
            st[i] = ws + (we - ws) * (i - a) / span
            en[i] = ws + (we - ws) * (i - a + 1) / span
    for i in range(n):
        st[i] = min(st[i], total)
        en[i] = min(en[i], total)
    return st, en, None


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
