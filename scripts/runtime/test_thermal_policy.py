#!/usr/bin/env python3
"""test_thermal_policy.py — 온도 조절기 판정 로직.

배경(2026-08-21 라이브 장애): 조절기가 14:30:48 에 27B(:8000)를 SIGSTOP 한 뒤
  재개하지 않았다. 그 시각 afternoon 보고서가 시작해 LLM 호출이 전부
  `TypeError: fetch failed`(0.0s = 연결 거부)로 떨어졌고 Wave1 이 통째로 폴백했다.

원인: 종전 구현은 `for line in p.stdout:` 로 macmon 출력을 읽는다.
  macmon 이 출력을 멈추면(실측: 29시간 가동된 인스턴스가 정지. 새 인스턴스는 정상)
  이 루프가 영원히 블록되고, 그 순간 paused=True 였으므로 대상은 무기한 정지 상태로 남는다.
  읽기 타임아웃도, 최대 정지 시간도, 하트비트도 없었다 — 멈춘 걸 알 방법이 없었다.

원칙: 센서를 잃으면 *대상을 놓아준다*. 온도를 모르는 채 서비스를 죽여 두는 것보다
  macOS 자체 열 보호(com.apple.thermaltrap)에 맡기는 편이 낫다.
"""
import unittest
from thermal_policy import decide, Decision, State

# MAX_PAUSE 는 데몬 기본값과 같은 900. 루틴 상한이 아니라 '예상 못 한 경로의 마지막 그물'이다.
#   실측: 재개 1,241건 중 180s 이상 6건(0.5%) 최대 540s — 전부 정상 냉각 대기였다.
#   180 으로 두면 그 6건에서 90°C 인 GPU 를 강제 재개시킨다.
CEIL, RESUME, MIN_PAUSE, MAX_PAUSE = 90.0, 82.0, 15.0, 900.0


def d(state, gpu, cpu, now):
    return decide(state, gpu, cpu, now, ceil=CEIL, resume=RESUME,
                  min_pause=MIN_PAUSE, max_pause=MAX_PAUSE)


class TestDecide(unittest.TestCase):
    def test_hot_pauses(self):
        s = State(paused=False, paused_at=0.0)
        self.assertEqual(d(s, 91.0, 60.0, 100.0).action, 'pause')

    def test_cool_stays_running(self):
        s = State(paused=False, paused_at=0.0)
        self.assertIsNone(d(s, 70.0, 50.0, 100.0).action)

    def test_min_pause_respected(self):
        """초 단위 떨림 방지 — 최소 정지시간 전에는 재개하지 않는다."""
        s = State(paused=True, paused_at=100.0)
        self.assertIsNone(d(s, 50.0, 40.0, 105.0).action)

    def test_resume_when_cool(self):
        s = State(paused=True, paused_at=100.0)
        self.assertEqual(d(s, 70.0, 50.0, 120.0).action, 'resume')

    def test_still_hot_stays_paused(self):
        s = State(paused=True, paused_at=100.0)
        self.assertIsNone(d(s, 89.0, 60.0, 120.0).action)

    def test_max_pause_forces_resume(self):
        """상한 아래로 안 내려가도 무기한 굶기지 않는다 — 이번 장애의 두 번째 방어선."""
        s = State(paused=True, paused_at=100.0)
        r = d(s, 95.0, 70.0, 100.0 + MAX_PAUSE + 1)
        self.assertEqual(r.action, 'resume')
        self.assertIn('최대 정지', r.reason)

    def test_invalid_sensor_ignored_when_running(self):
        """GPU 정지 중엔 센서가 2°C 대 허수를 뱉는다 — 그걸로 판단하지 않는다."""
        s = State(paused=False, paused_at=0.0)
        self.assertIsNone(d(s, 2.4, 45.0, 100.0).action)

    def test_invalid_sensor_allows_resume(self):
        """정지 중 GPU 센서가 무효면 CPU 만으로 판단해 재개할 수 있어야 한다."""
        s = State(paused=True, paused_at=100.0)
        self.assertEqual(d(s, 2.4, 45.0, 120.0).action, 'resume')

    def test_cpu_ceiling_also_pauses(self):
        s = State(paused=False, paused_at=0.0)
        self.assertEqual(d(s, 50.0, 95.0, 100.0).action, 'pause')


class TestSensorLoss(unittest.TestCase):
    def test_sensor_loss_resumes(self):
        """센서를 잃으면 대상을 놓아준다 — 이번 장애의 근본 방어선."""
        from thermal_policy import on_sensor_timeout
        s = State(paused=True, paused_at=100.0)
        r = on_sensor_timeout(s, now=130.0, stale_for=25.0)
        self.assertEqual(r.action, 'resume')
        self.assertIn('센서', r.reason)

    def test_sensor_loss_while_running_is_noop(self):
        from thermal_policy import on_sensor_timeout
        s = State(paused=False, paused_at=0.0)
        self.assertIsNone(on_sensor_timeout(s, now=130.0, stale_for=25.0).action)


if __name__ == '__main__':
    unittest.main(verbosity=2)
