#!/usr/bin/env python3
"""온도 상한 조절기 — 상한 초과 시 LLM 일시정지(SIGSTOP), 냉각 후 재개(SIGCONT).

2026-08-21 전면 재작성. 판정은 thermal_policy.py 로 분리했다(테스트 대상).

■ 왜 다시 짰나 — 실제 장애
  14:30:48 에 27B(:8000)를 정지시킨 뒤 재개하지 않았다. 같은 시각 시작한 afternoon 보고서의
  LLM 호출이 전부 `TypeError: fetch failed`(0.0s = 연결 거부)로 떨어져 Wave1 이 통째로 폴백했다.
  종전 구현은 `for line in p.stdout:` 로 macmon 출력을 읽는다. macmon 이 출력을 멈추면
  (실측: 29시간 가동된 인스턴스가 정지. 같은 바이너리의 새 인스턴스는 초당 정상 출력)
  그 루프가 영원히 블록되고, 그 순간 paused=True 였으므로 대상은 무기한 정지로 남는다.
  읽기 타임아웃도 최대 정지시간도 하트비트도 없어서 멈춘 것 자체를 알 방법이 없었다.

■ 방어선
  ① 읽기 타임아웃 — 샘플이 SAMPLE_TIMEOUT 동안 없으면 센서 상실로 본다.
     정지 중이면 *반드시 재개한다*. 온도를 모르는 채 서비스를 죽여 두느니
     macOS 자체 열 보호(com.apple.thermaltrap)에 맡기는 편이 낫다.
  ② macmon 재기동 — 죽었거나 멈추면 새로 띄운다. 블록되지 않는다.
  ③ 최대 정지시간(MAX_PAUSE) — 온도가 안 내려가도 무기한 굶기지 않는다.
  ④ 하트비트 — 살아있음을 주기적으로 남긴다. 조용히 멈춘 걸 다음엔 로그로 안다.
  ⑤ 기동/종료 시 SIGCONT — 이전 인스턴스가 정지시킨 채 죽어도 반드시 풀린다(종전 유지).
"""
import json
import os
import select
import signal
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thermal_policy import State, decide, on_sensor_timeout   # noqa: E402

CEIL       = float(os.environ.get("TEMP_CEIL", "90"))
RESUME     = float(os.environ.get("TEMP_RESUME", str(CEIL - 8)))
MIN_PAUSE  = float(os.environ.get("TEMP_MIN_PAUSE", "15"))
# 온도가 안 내려가도 이 시간을 넘기면 놓아준다. 조절이 서비스 중단이 되면 안 된다.
MAX_PAUSE  = float(os.environ.get("TEMP_MAX_PAUSE", "180"))
# macmon 간격(2s)의 여러 배 — 일시적 지연으로 재기동하지 않도록 넉넉히.
SAMPLE_TIMEOUT = float(os.environ.get("TEMP_SAMPLE_TIMEOUT", "20"))
HEARTBEAT  = float(os.environ.get("TEMP_HEARTBEAT", "900"))

# 대상을 포트로 특정한다. 종전에 "mlx_lm server" 를 pgrep -f 로 매칭해 웹 레인(:8001,
#   소형·사용자 대면)까지 함께 정지시킨 적이 있다. GPU 열의 주범은 보고서 모델(:8000)이다.
TARGET_PORT = os.environ.get("TEMP_TARGET_PORT", "8000")
TARGET      = os.environ.get("TEMP_TARGET_PROC", f"mlx_lm server .*--port {TARGET_PORT}")
MACMON      = os.path.expanduser(os.environ.get("TEMP_MACMON", "~/.local/bin/macmon"))
LOG         = os.path.expanduser("~/flowvium_runtime/thermal.log")


def log(m):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass   # 로그를 못 써도 조절은 계속한다


def pids():
    out = subprocess.run(["pgrep", "-f", TARGET], capture_output=True, text=True).stdout
    return [int(x) for x in out.split()]


def send(sig):
    for pid in pids():
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def bail(signum, frame):
    send(signal.SIGCONT)
    log(f"종료 — 재개 신호 보내고 나감 (signal {signum})")
    sys.exit(0)


for s in (signal.SIGTERM, signal.SIGINT):
    signal.signal(s, bail)


def spawn_macmon():
    return subprocess.Popen([MACMON, "pipe", "-s", "0", "-i", "2000"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)


def apply(dec, state):
    """판정을 실제 신호로. 상태는 여기서만 바뀐다."""
    if dec.action == 'pause':
        send(signal.SIGSTOP)
        state.paused, state.paused_at = True, time.time()
        log(f"일시정지 — {dec.reason}")
    elif dec.action == 'resume':
        send(signal.SIGCONT)
        state.paused = False
        log(f"재개 — {dec.reason}")


send(signal.SIGCONT)                     # ★ 기동 즉시 무조건 해제
log(f"기동 — 상한 {CEIL}°C / 복귀 {RESUME}°C / 최소정지 {MIN_PAUSE}s / 최대정지 {MAX_PAUSE}s "
    f"/ 센서타임아웃 {SAMPLE_TIMEOUT}s · 잔여 정지 해제 완료")

state = State(paused=False, paused_at=0.0)
proc = spawn_macmon()
last_sample = time.time()
last_beat = time.time()

while True:
    ready, _, _ = select.select([proc.stdout], [], [], 1.0)
    now = time.time()

    if ready:
        line = proc.stdout.readline()
        if not line:                       # EOF — macmon 이 죽었다
            apply(on_sensor_timeout(state, now=now, stale_for=now - last_sample), state)
            log("macmon 종료 감지 — 재기동")
            try:
                proc.kill()
            except OSError:
                pass
            proc = spawn_macmon()
            last_sample = now
            continue
        line = line.strip()
        if line.startswith("{"):
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue                   # 부분 라인 — 다음 샘플에서
            last_sample = now
            t = d.get("temp") or {}
            gpu = t.get("gpu_temp_avg") or 0.0
            cpu = t.get("cpu_temp_avg") or 0.0
            if not pids():                 # 대상이 사라졌다 — 상태만 되돌린다
                state.paused = False
                continue
            apply(decide(state, gpu, cpu, now, ceil=CEIL, resume=RESUME,
                         min_pause=MIN_PAUSE, max_pause=MAX_PAUSE), state)
    else:
        stale = now - last_sample
        if stale > SAMPLE_TIMEOUT:
            # 여기가 이번 장애의 정확한 지점이다. 종전엔 이 분기가 없어 영원히 블록됐다.
            apply(on_sensor_timeout(state, now=now, stale_for=stale), state)
            log(f"센서 {stale:.0f}s 무응답 — macmon 재기동")
            try:
                proc.kill()
            except OSError:
                pass
            proc = spawn_macmon()
            last_sample = now

    if now - last_beat >= HEARTBEAT:
        last_beat = now
        log(f"정상 — 정지상태={state.paused} · 마지막 샘플 {now - last_sample:.0f}s 전")
