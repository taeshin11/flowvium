# data/rag/books/ — 합법 보유 서적 (개인 로컬 학습용)

여기에 **본인이 합법적으로 구매·보유한** 투자 서적 파일(`.pdf` / `.txt` / `.md`)을 넣으면
`scripts/rag/ingest-corpus.py` 가 추출→청크→임베딩하여 심판/매수/매도 엔진의 RAG + SFT 코퍼스에 포함합니다.

- 파일명 = 출처 라벨 (예: `one-up-on-wall-street.pdf` → "One Up On Wall Street")
- 텍스트레이어 PDF = `pdftotext`, 스캔 PDF = PaddleOCR 자동 fallback
- 권장: 피터 린치 *One Up on Wall Street* / *Beating the Street*, 소로스 *The Alchemy of Finance*,
  코스톨라니 *돈, 뜨겁게 사랑하고 차갑게 다루어라* 등 (보유 사본만)

⚠️ **저작권**: 이 폴더의 파일은 `.gitignore` 로 **커밋·푸시되지 않습니다** (개인 로컬 학습 전용).
공개 저장소에 저작권 서적을 올리지 않기 위함. 해적본 사용 금지.
