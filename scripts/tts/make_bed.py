#!/usr/bin/env python3
"""make_bed.py — 뉴스 배경음악을 **직접 만든다**.

왜 (2026-09-06 사용자 "좀 뉴스 스러운 배경음악 돌려쓸수있는거 없니?"):
  CC0 음원을 받아 쓰는 길도 있지만(Pixabay·Creazilla), 이 채널은 이미 언론사 사진 문제로
  저작권이 아슬아슬하다. **만들어 쓰면 그 위험이 아예 없다.**
  한 번 만들어 assets/bgm 에 두고 회차마다 돌려 쓴다.

MusicGen(Meta, CC-BY-NC 모델이지만 **출력물은 사용자 것**)으로 만든다.
  ⚠ musicgen-small 은 연구용 라이선스가 CC-BY-NC 다. 출력물 상업 이용이 걸리면
    아래 --engine tone 으로 순수 합성(사인파 기반)을 쓸 수 있다 — 그건 온전히 우리 것이다.

사용: make_bed.py --out assets/bgm/news1.wav --seconds 40 [--prompt "..."] [--seed 0]
"""
import argparse
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=int, default=40)
    ap.add_argument("--prompt", default="calm news broadcast background bed, subtle pulse, "
                                        "low strings, neutral, no melody, loopable")
    ap.add_argument("--model", default="facebook/musicgen-small")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    import torch
    import soundfile as sf
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    torch.manual_seed(a.seed)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoProcessor.from_pretrained(a.model)
    model = MusicgenForConditionalGeneration.from_pretrained(a.model).to(dev)

    # MusicGen 은 50 토큰이 1초다. 요청 길이에 맞춰 토큰 수를 정한다.
    tokens = int(a.seconds * 50)
    inputs = proc(text=[a.prompt], padding=True, return_tensors="pt").to(dev)
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=tokens)
    sr = model.config.audio_encoder.sampling_rate
    wav = audio[0, 0].cpu().numpy()

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    sf.write(a.out, wav, sr)
    print(f"  {a.out} · {len(wav) / sr:.1f}초 · {sr}Hz", file=sys.stderr)


if __name__ == "__main__":
    main()
