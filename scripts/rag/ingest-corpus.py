#!/usr/bin/env python3
"""ingest-corpus.py — 버크셔 서한 + 투자 지혜/doctrine → 청크 → bge-m3 임베딩 → corpus.ndjson (2026-06-18)

추출: PDF=pdftotext -layout (텍스트레이어), 부족하면 PaddleOCR fallback. HTML=태그 제거.
청크: ~900자, 150자 overlap. 임베딩: BAAI/bge-m3 (normalize). 출력: data/rag/corpus.ndjson.
"""
import os, re, sys, json, glob, html, subprocess

REPO = "/mnt/d/Flowvium"
LETTERS = os.path.expanduser("~/rag-data/letters")
OUT = os.path.join(REPO, "data/rag/corpus.ndjson")
CHUNK, OVERLAP, MIN_CHUNK = 900, 150, 120

def log(*a): print("[ingest]", *a, flush=True)

def pdftotext(path):
    try:
        r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, timeout=60)
        return r.stdout.decode("utf-8", "ignore")
    except Exception as e:
        log("pdftotext fail", path, e); return ""

_ocr = None
def ocr_pdf(path):
    """PaddleOCR fallback (사용자 선호) — 텍스트레이어 없는 스캔 PDF."""
    global _ocr
    try:
        from pdf2image import convert_from_path
        from paddleocr import PaddleOCR
        if _ocr is None:
            _ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        pages = convert_from_path(path, dpi=150)
        out = []
        for img in pages:
            import numpy as np
            res = _ocr.ocr(np.array(img), cls=True)
            for line in (res[0] or []):
                out.append(line[1][0])
        return "\n".join(out)
    except Exception as e:
        log("paddleocr unavailable/fail", e); return ""

def strip_html(raw):
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?is)</p>", "\n\n", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return html.unescape(raw)

def clean(t):
    t = t.replace("\r", "\n")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def chunk_text(t):
    paras = [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if len(buf) + len(p) + 1 <= CHUNK:
            buf = (buf + "\n" + p) if buf else p
        else:
            if buf: chunks.append(buf)
            if len(p) > CHUNK:  # 단일 문단이 너무 길면 슬라이딩
                i = 0
                while i < len(p):
                    chunks.append(p[i:i+CHUNK]); i += CHUNK - OVERLAP
                buf = ""
            else:
                tail = buf[-OVERLAP:] if buf else ""
                buf = (tail + "\n" + p) if tail else p
    if buf: chunks.append(buf)
    return [c for c in chunks if len(c) >= MIN_CHUNK]

def load_letters():
    rows = []
    for f in sorted(glob.glob(os.path.join(LETTERS, "*"))):
        year = re.sub(r"\D", "", os.path.basename(f))[:4]
        ext = f.rsplit(".", 1)[-1].lower()
        if ext == "pdf":
            txt = pdftotext(f)
            if len(txt.strip()) < 400:
                log(f"{year} thin text-layer → OCR"); txt = ocr_pdf(f) or txt
        elif ext in ("html", "htm"):
            txt = strip_html(open(f, encoding="utf-8", errors="ignore").read())
        else:
            continue
        txt = clean(txt)
        cs = chunk_text(txt)
        log(f"{year}.{ext}: {len(txt)} chars → {len(cs)} chunks")
        for i, c in enumerate(cs):
            rows.append({"id": f"buffett-{year}-{i}", "source": "버크셔 주주서한", "year": year, "text": c})
    return rows

def load_curated():
    rows = []
    for rel, src in [("data/investor-wisdom.json", "투자 지혜"), ("data/judgment-doctrine.json", "심판 doctrine")]:
        try:
            d = json.load(open(os.path.join(REPO, rel), encoding="utf-8"))
        except Exception:
            continue
        items = d if isinstance(d, list) else d.get("principles", [])
        for it in items:
            txt = " ".join(str(it.get(k, "")) for k in ("rule", "apply", "description", "theme") if it.get(k)).strip()
            if len(txt) >= 20:
                rows.append({"id": f"{src}-{it.get('id','x')}", "source": src, "year": "", "text": txt})
    log(f"curated: {len(rows)} chunks")
    return rows

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    rows = load_letters() + load_curated()
    log(f"total chunks: {len(rows)} — embedding with bge-m3...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("BAAI/bge-m3")
    embs = model.encode([r["text"] for r in rows], normalize_embeddings=True,
                         batch_size=16, show_progress_bar=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        for r, e in zip(rows, embs):
            r["embedding"] = [round(float(x), 6) for x in e]
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"wrote {OUT} ({len(rows)} chunks, dim={len(embs[0])})")

if __name__ == "__main__":
    main()
