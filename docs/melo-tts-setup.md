# MeloTTS 한국어 설치 메모 (2026-09-13)

이 기계에서 실제로 한 일. 다른 맥에 다시 깔 때 그대로 따라간다.

## 막혔던 진짜 이유
macOS 기본 파일시스템은 **대소문자를 구분하지 않는다**.
  `MeCab/`  ← mecab-python3 (일본어)
  `mecab/`  ← python-mecab-ko (한국어)
둘이 물리적으로 같은 디렉터리라 같이 깔면 서로 덮어쓴다.
파이썬 네임스페이스 문제가 아니라 디스크 문제였다.
(2026-09-03 기록의 "모듈명 충돌"은 증상이었다.)

## 절차
    PY=~/.flowvium-tools/melo-venv/bin/python
    $PY -m pip uninstall -y mecab-python3 python-mecab-ko mecab-ko-dic python-mecab-ko-dic
    rm -rf <site-packages>/MeCab <site-packages>/mecab <site-packages>/mecab_ko_dic   # uninstall 이 놓친다
    $PY -m pip install python-mecab-ko python-mecab-ko-dic soxr

  · 사전은 `mecab-ko-dic` 이 아니라 **`python-mecab-ko-dic`** 이다(같은 이름 충돌이 여기도 있다).
  · `soxr` 는 transformers 4.57 의 audio_utils 가 요구한다. 없으면
    "Could not import module 'BertForMaskedLM'" 로 엉뚱하게 나온다.

## 소스 패치 (~/.flowvium-tools/melo-src)
  melo/text/cleaner.py    언어 모듈 지연 import (2026-09-03, 원본 .orig)
  melo/text/japanese.py   MeCab import 를 지연으로 (2026-09-13, 원본 .orig)
    korean → chinese_mix → english → japanese 체인 때문에 한국어만 써도 일본어가 뜬다.
    distribute_phone 은 MeCab 과 무관한 순수 함수인데 모듈 수준 import 가 막고 있었다.

## 확인
    $PY -c "import mecab; print(mecab.MeCab().pos('코스피가 반등했습니다'))"
    node scripts/lib/tts-melo.test.mjs

## 되돌리기
    KO_TTS_ENGINE=qwen        환경변수 하나로 Qwen3-TTS 로 복귀
    KO_TTS_MELO_SPEED=1.15    말 속도(엔진 자체 인자, 음높이 보존)
