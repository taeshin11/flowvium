#!/usr/bin/env python3
"""
kokoro_align.py — 로컬 TTS(Kokoro) + 강제정렬(whisper) → 문자 단위 타임스탬프.

왜 만드는가: ElevenLabs Starter 는 월 4만 자다. 6분 영상 1편이 약 5,800자라 월 7편이고,
  하루 5편(월 87만 자)은 어떤 등급으로도 감당이 안 된다(2026-08-28 실측: 남은 104자).
  Kokoro 는 Apache-2.0 이고 이 기계에서 실시간의 6~13배로 돈다.

왜 정렬이 필요한가: 자막은 **문자 단위 시각**으로 만든다(subtitle.mjs 의 cuesFromAlignment).
  ElevenLabs 는 그걸 같이 주지만 로컬 TTS 는 소리만 준다.
  그래서 만들어진 소리를 whisper 로 다시 들어 낱말 시각을 얻고, 문자 단위로 편다.

출력(JSON 파일, --json-out): {"path", "durationSec", "alignment":{characters,
  character_start_times_seconds, character_end_times_seconds}}
  — ElevenLabs 응답과 **같은 모양**이라 호출부가 그대로 쓴다.

  stdout 으로 안 내보낸다. kokoro/HF 라이브러리가 경고를 stdout 에 찍어 JSON 을 오염시킨다
  (2026-08-28: "WARNING: Defaulting repo_id..." 가 앞에 붙어 파싱이 깨졌다).
"""
import argparse, json, os, sys, warnings

warnings.filterwarnings("ignore")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def synth(text, voice, speed, out_wav):
    import numpy as np, soundfile as sf, torch
    from kokoro import KPipeline
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = KPipeline(lang_code="a", device=dev)
    chunks = [a for _, _, a in pipe(text, voice=voice, speed=speed)]
    if not chunks:
        raise RuntimeError("Kokoro 가 오디오를 만들지 못했다")
    wav = np.concatenate(chunks)
    sr = 24000
    os.makedirs(os.path.dirname(out_wav) or ".", exist_ok=True)
    sf.write(out_wav, wav, sr)
    return len(wav) / sr, dev


def align(out_wav, text, model_size):
    """whisper 로 낱말 시각을 얻는다. 실패하면 None — 호출부가 균등분배로 떨어진다."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    m = WhisperModel(model_size, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(out_wav, word_timestamps=True, language="en", vad_filter=False)
    words = []
    for s in segs:
        for w in (s.words or []):
            words.append({"w": w.word.strip(), "s": float(w.start), "e": float(w.end)})
    return words or None


def _words_with_spans(text):
    """원문을 낱말 단위로 쪼개고 각 낱말의 글자 범위를 기억한다."""
    out, i, n = [], 0, len(text)
    while i < n:
        while i < n and not text[i].isalnum():
            i += 1
        j = i
        while j < n and (text[j].isalnum() or text[j] in "'’"):
            j += 1
        if j > i:
            out.append({"norm": "".join(c for c in text[i:j].lower() if c.isalnum()), "s": i, "e": j})
        i = max(j, i + 1)
    return out


def char_alignment(text, words, duration):
    """
    낱말 시각 → 문자 시각.

    ⚠ 처음엔 원문을 글자 단위로 훑으며 순서대로 붙였는데, **한 번 어긋나면 그 뒤가 전부
      안 붙었다**(2026-08-28: 6분 편에서 자막이 통째로 다른 대목을 보여주고
      "volatility." 한 낱말이 몇 초씩 떠 있었다).
      whisper 는 숫자·약어·고유명사를 원문과 다르게 적는다 — 어긋남은 정상이고,
      **어긋난 뒤에도 다시 붙는 것**이 정렬기의 일이다.

    그래서 두 가지를 바꿨다:
      ① 낱말 단위로 맞춘다. 안 맞으면 **앞을 조금 내다보며**(window) 다음 일치를 찾는다.
      ② 못 맞춘 구간은 앞뒤 앵커 사이를 **선형 보간**한다. 직전 값으로 얼어붙이면
         그 구간 전체가 같은 시각이 되어 자막이 한 덩어리로 뭉친다.
    """
    n = len(text)
    if n == 0:
        return [], []
    if not words:
        return ([duration * i / n for i in range(n)],
                [duration * (i + 1) / n for i in range(n)])

    src = _words_with_spans(text)
    heard = [{"norm": "".join(c for c in w["w"].lower() if c.isalnum()),
              "s": w["s"], "e": w["e"]} for w in words]
    heard = [h for h in heard if h["norm"]]

    # ① 낱말 정렬 — 못 맞추면 최대 WINDOW 개까지 내다본다.
    WINDOW = 6
    anchors = []                       # (원문 낱말 index, 시작초, 끝초)
    hi = 0
    for si, sw in enumerate(src):
        found = -1
        for k in range(hi, min(len(heard), hi + WINDOW)):
            if heard[k]["norm"] == sw["norm"]:
                found = k
                break
        if found < 0:
            continue                   # 이 낱말은 못 들었다 — 보간으로 메운다
        anchors.append((si, heard[found]["s"], heard[found]["e"]))
        hi = found + 1

    starts = [None] * n
    ends = [None] * n
    for si, s0, e0 in anchors:
        a, b = src[si]["s"], src[si]["e"]
        span = max(1, b - a)
        for t in range(a, b):
            f0, f1 = (t - a) / span, (t - a + 1) / span
            starts[t] = s0 + (e0 - s0) * f0
            ends[t] = s0 + (e0 - s0) * f1

    # ② 빈 구간 선형 보간. 앞뒤 앵커 사이를 글자 수에 비례해 나눈다.
    known = [i for i in range(n) if starts[i] is not None]
    if not known:
        return ([duration * i / n for i in range(n)],
                [duration * (i + 1) / n for i in range(n)])
    first, last = known[0], known[-1]
    for i in range(first):             # 앞머리
        starts[i] = ends[i] = starts[first] * i / max(1, first)
    for i in range(last + 1, n):       # 꼬리
        f = (i - last) / max(1, n - last)
        ends[i] = starts[i] = ends[last] + (duration - ends[last]) * f
    ki = 0
    while ki < len(known) - 1:
        a, b = known[ki], known[ki + 1]
        if b > a + 1:
            t0, t1 = ends[a], starts[b]
            gap = b - a
            for t in range(a + 1, b):
                f0, f1 = (t - a) / gap, (t - a + 1) / gap
                starts[t] = t0 + (t1 - t0) * f0
                ends[t] = t0 + (t1 - t0) * f1
        ki += 1

    # 단조 증가 보정(보간이 미세하게 역전될 수 있다)
    for i in range(1, n):
        if starts[i] < ends[i - 1]:
            starts[i] = ends[i - 1]
        if ends[i] < starts[i]:
            ends[i] = starts[i]
    ends[-1] = max(ends[-1], min(duration, ends[-1]))
    return starts, ends


def alignment_quality(starts, ends):
    """붙은 정도. 시각이 얼어붙은 글자 비율이 높으면 자막이 뭉친다."""
    n = len(starts)
    frozen = sum(1 for i in range(n) if ends[i] - starts[i] <= 1e-6)
    return frozen / max(1, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="am_michael")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--whisper", default="base.en")
    ap.add_argument("--json-out", required=True)
    args = ap.parse_args()

    text = open(args.text_file, encoding="utf-8").read()
    if not text.strip():
        raise SystemExit("빈 대본")

    dur, dev = synth(text, args.voice, args.speed, args.out)
    words = align(args.out, text, args.whisper)
    log(f"[kokoro] {args.voice} {dur:.1f}초 device={dev} 정렬={'낱말 ' + str(len(words)) + '개' if words else '실패→균등분배'}")
    starts, ends = char_alignment(text, words, dur)
    frozen = alignment_quality(starts, ends)
    log(f"[kokoro] 정렬 품질: 시각 고정 글자 {frozen*100:.1f}%")
    if frozen > 0.25:
        log("[kokoro] ⚠ 4분의 1 넘는 글자가 시각을 못 얻었다 — 자막이 뭉칠 수 있다")

    with open(args.json_out, "w", encoding="utf-8") as fh:
        json.dump({
            "path": args.out,
            "durationSec": dur,
            "alignment": {
                "characters": list(text),
                "character_start_times_seconds": starts,
                "character_end_times_seconds": ends,
            },
        }, fh)


if __name__ == "__main__":
    main()
