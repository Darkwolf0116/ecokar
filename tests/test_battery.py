import pytest

from ecokar_sim import config
from ecokar_sim.mission.battery import Battery, voltage_for_percent
from ecokar_sim.simulation import Simulation
from helpers import connected_sim, hold


def test_voltage_curve_endpoints_and_monotonicity():
    assert voltage_for_percent(100.0) == pytest.approx(8.4)
    assert voltage_for_percent(0.0) == pytest.approx(6.6)
    assert voltage_for_percent(150.0) == pytest.approx(8.4)
    assert voltage_for_percent(-5.0) == pytest.approx(6.6)
    samples = [voltage_for_percent(p) for p in range(0, 101)]
    assert samples == sorted(samples)


def test_fresh_battery_is_full():
    battery = Battery()
    assert battery.percent == 100.0
    assert battery.voltage == pytest.approx(8.4)


def test_current_model():
    battery = Battery()
    assert battery.step(0.01, 0, 0, 0, False) == pytest.approx(0.15)
    assert battery.step(0.01, 255, 255, 0, False) == pytest.approx(0.15 + 0.9)
    assert battery.step(0.01, 255, -255, 2, True) == pytest.approx(0.15 + 0.9 + 0.48 + 0.15)
    assert battery.step(0.01, 100, 0, 0, False) == pytest.approx(0.15 + 0.9 * 100 / 510)


def test_charge_integrates_current_over_time():
    battery = Battery()
    for _ in range(3600):  # 3600 steps of 1 s at 0.15 A = one hour idle
        battery.step(1.0, 0, 0, 0, False)
    assert battery.used_ah == pytest.approx(0.15)
    assert battery.percent == pytest.approx(100 * (1 - 0.15 / config.BATTERY_CAPACITY_AH))


def test_battery_decreases_while_driving_more_than_idle():
    idle = Simulation()
    idle.run_for(20.0)

    driving = connected_sim()
    for _ in range(20):
        driving.drive.pose.x = -4.5  # keep it on the road for the whole test
        hold(driving, "A", 1.0, release=False)

    assert driving.battery.percent < 100.0
    assert driving.battery.percent < idle.battery.percent
    assert driving.battery.voltage < 8.4
    assert driving.battery.current_a > config.BATTERY_IDLE_A


def test_arm_motion_draws_current():
    sim = connected_sim()
    hold(sim, "G", 0.5, release=False)
    moving = sim.battery.current_a
    sim.transmit("S")
    sim.run_for(0.1)
    assert moving == pytest.approx(config.BATTERY_IDLE_A + config.BATTERY_STEPPER_A)
    assert sim.battery.current_a == pytest.approx(config.BATTERY_IDLE_A)


def test_snapshot_exposes_battery():
    sim = Simulation()
    battery = sim.snapshot()["battery"]
    assert battery == {"voltage": 8.4, "percent": 100.0}
