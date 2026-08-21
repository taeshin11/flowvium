#!/usr/bin/env python3
"""thermal_policy.py — 온도 조절기의 판정 로직 (부수효과 없음).

데몬(thermal-governor.py)에서 분리한 이유: 2026-08-21 라이브 장애의 원인이
판정이 아니라 *입력이 끊겼을 때의 처리* 였는데, 데몬 안에 섞여 있어 테스트가 불가능했다.

장애 요약: 조절기가 14:30:48 에 27B 를 SIGSTOP 한 뒤 재개하지 않았다.
  `for line in p.stdout:` 가 macmon 정지로 영원히 블록됐고, 그 순간 paused=True 라
  대상이 무기한 정지 상태로 남았다. 그 시각 시작한 afternoon 보고서는 LLM 호출이 전부
  `TypeError: fetch failed`(0.0s = 연결 거부)로 떨어져 Wave1 이 통째로 폴백했다.

방어선 세 겹:
  ① 센서 상실 → 대상을 놓아준다(on_sensor_timeout). 온도를 모르는 채 서비스를 죽여 두느니
     macOS 자체 열 보호(com.apple.thermaltrap)에 맡긴다.
  ② 최대 정지시간 → 상한 아래로 안 내려가도 무기한 굶기지 않는다.
  ③ 최소 정지시간 → 초 단위 떨림 방지(종전 동작 유지).
"""
from dataclasses import dataclass
from typing import Optional

# GPU 정지 중엔 센서가 2°C 대 허수를 뱉는다 — 그 값으로 판단하지 않는다.
VALID_MIN = 20.0


@dataclass
class State:
    paused: bool
    paused_at: float


@dataclass
class Decision:
    action: Optional[str]      # 'pause' | 'resume' | None
    reason: str = ''


def _valid(v: float) -> bool:
    return v is not None and v >= VALID_MIN


def decide(state: State, gpu: float, cpu: float, now: float, *,
           ceil: float, resume: float, min_pause: float, max_pause: float) -> Decision:
    """한 샘플에 대한 판정. 부수효과 없음."""
    gpu_ok, cpu_ok = _valid(gpu), _valid(cpu)

    if not state.paused:
        hot = max(gpu if gpu_ok else 0.0, cpu if cpu_ok else 0.0)
        if hot > ceil:
            return Decision('pause', f'GPU {gpu:.1f}°C CPU {cpu:.1f}°C (상한 {ceil})')
        return Decision(None)

    held = now - state.paused_at
    if held >= max_pause:
        # 온도가 안 내려가도 서비스를 무기한 굶기지 않는다. 굶기면 그건 조절이 아니라 장애다.
        return Decision('resume', f'최대 정지 {max_pause:.0f}s 초과 — 강제 재개 (GPU {gpu:.1f}°C)')
    if held < min_pause:
        return Decision(None)
    cool = (not gpu_ok or gpu <= resume) and (not cpu_ok or cpu <= resume)
    if cool:
        return Decision('resume', f'{held:.0f}s 정지 후 · GPU {gpu:.1f}{"" if gpu_ok else "(무효)"}°C CPU {cpu:.1f}°C')
    return Decision(None)


def on_sensor_timeout(state: State, *, now: float, stale_for: float) -> Decision:
    """센서 스트림이 끊겼을 때. 정지 중이면 반드시 놓아준다."""
    if state.paused:
        return Decision('resume', f'센서 {stale_for:.0f}s 무응답 — 안전상 재개(온도 미상)')
    return Decision(None)
