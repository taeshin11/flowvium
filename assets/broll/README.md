# assets/broll — 사람이 넣는 클립

이 폴더의 `*.mp4 / *.mov / *.webm` 은 이슈 영상의 장면 배경으로 **자동 사용**된다.
파일명 키워드가 장면 검색어와 겹치면 그 장면에 깔린다 (`scripts/lib/footage.mjs: matchLocal`).

    capitol-dome-night.mp4   → "capitol", "dome" 이 들어간 장면
    nashville-crowd.mp4      → "nashville" 장면

원격 자동 소스(Openverse·Wikimedia·Pexels)는 라이선스를 코드가 검사해서 NC·ND·미상을 버린다.
이 폴더는 그 검사를 하지 않는다 — **넣는 사람이 사용 권리를 확인한 것으로 본다.**
SNS(인스타·X·페이스북) 클립을 쓰려면 여기에 넣으면 된다. 자동으로 긁어오지는 않는데,
유튜브의 재사용 콘텐츠 심사가 채널 단위로 집행돼서 자동 발행 중 한 편이 걸리면 채널 전체가 멈추기 때문이다.

Google Flow / Veo 로 만든 b-roll 도 여기에 받아두면 같은 경로로 들어간다.
