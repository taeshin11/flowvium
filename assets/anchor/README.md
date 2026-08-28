# 앵커 클립

우측 앵커 박스에 들어가는 영상. **파일은 구글드라이브에 둔다** —
`내 드라이브/FlowVium-media/anchor/`

- `anchor-en.mp4` / `anchor-ko.mp4` — 로케일별. 없으면 `anchor.mp4` 를 공용으로 쓴다.
- 다른 로케일 전용 파일은 쓰지 않는다(영어 편에 한국어 앵커가 나오지 않게).
- 정면·상반신·8초 이상. 3:4 중앙 크롭해서 얹으므로 좌우 여백은 잘린다.
  Veo 워터마크(우하단)는 이 크롭에서 자동으로 잘려 나간다.

Flow 로 새로 만들려면:

    node scripts/flow-clip.mjs --prompt "..." \
      --out "$MEDIA/anchor/anchor-en.mp4"

이 폴더(`assets/anchor/`)는 하위호환으로 계속 읽지만, 드라이브 쪽이 우선이다.
