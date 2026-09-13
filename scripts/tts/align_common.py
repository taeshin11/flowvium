"""align_common.py — TTS 엔진이 공유하는 정렬·후처리. (2026-09-13 분리)

왜 분리했나: word_times / char_times 가 piper_align.py 와 qwen_align.py 에 **글자 하나 차이로
  복제**돼 있었다. 엔진을 하나 더 붙이면 세 번째 사본이 생긴다. 이 저장소가 이미 적어 둔 말 그대로다 —
  "같은 산식을 두 곳에 두면 조용히 어긋난다"(squeeze-reconcile.mjs).

정렬을 whisper 로 다시 듣는 이유: TTS 엔진은 문자 시각을 주지 않는다. 만들어진 소리를 되들어
  낱말 시각을 얻고 문자 단위로 편다. 실패하면 균등분배로 떨어지되 **note 로 알린다** —
  조용히 틀린 자막을 내보내지 않는다.
"""
import os
import sys


def post_process(path, tempo=1.0, trim=True):
    """배속(선택) + 긴 무음 줄이기(기본). 둘 다 필요 없으면 아무것도 하지 않는다.

    배속과 무음 정리를 나눈 이유: 엔진에 자체 속도 인자가 있으면(MeloTTS 의 speed)
    그쪽이 더 깨끗하다. 그때도 무음 정리는 여전히 필요하다.
    """
    import shutil
    import subprocess
    parts = []
    if tempo and abs(tempo - 1.0) > 0.01:
        parts.append(f"atempo={tempo:.3f}")
    if trim:
        parts.append("silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-42dB")
    if not parts:
        return
    ff = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if not ff:
        print("ffmpeg 없음 — 후처리 생략", file=sys.stderr)
        return
    tmp = path + ".tmp.wav"
    r = subprocess.run([ff, "-v", "error", "-i", path, "-af", ",".join(parts), "-y", tmp],
                       capture_output=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
    else:
        print(f"후처리 실패({r.returncode}) — 원본 유지", file=sys.stderr)


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
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 균등분배로 살린다
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


def wav_duration(path):
    import wave
    with wave.open(path) as f:
        return f.getnframes() / float(f.getframerate())
