import math

import pytest

from ecokar_sim import config
from ecokar_sim.locomotion.drivetrain import DriveTrain, Pose, body_velocity
from ecokar_sim.world.collision import OrientedRect, circle_overlaps_rect
from helpers import connected_sim, events, hold, serial_lines


def test_equal_sides_go_straight():
    v, omega = body_velocity(200, 200)
    assert v == pytest.approx(200 / 255 * config.V_MAX_MPS)
    assert omega == 0.0


def test_spin_has_no_translation_and_positive_omega_is_left():
    v, omega = body_velocity(-170, 170)
    assert v == pytest.approx(0.0)
    assert omega > 0
    assert body_velocity(170, -170)[1] == pytest.approx(-omega)


def test_omega_uses_skid_factor():
    _, omega = body_velocity(0, 255)
    expected = config.V_MAX_MPS / (config.TRACK_M * config.SKID_FACTOR)
    assert omega == pytest.approx(expected)


def test_forward_at_yaw_zero_increases_x():
    sim = connected_sim()
    x0, z0 = sim.drive.pose.x, sim.drive.pose.z
    hold(sim, "A", 1.0, release=False)
    assert sim.drive.pose.x > x0 + 0.3
    assert sim.drive.pose.z == pytest.approx(z0)
    assert sim.drive.pose.yaw == pytest.approx(0.0)
    assert sim.drive.v == pytest.approx(200 / 255 * config.V_MAX_MPS)


def test_backward_decreases_x():
    sim = connected_sim()
    sim.drive.pose.x = 0.0
    hold(sim, "B", 1.0, release=False)
    assert sim.drive.pose.x < -0.3


def test_left_spin_increases_yaw_and_right_decreases():
    sim = connected_sim()
    hold(sim, "C", 0.5)
    assert sim.drive.pose.yaw > 0.5
    left_yaw = sim.drive.pose.yaw
    sim.run_for(0.5)
    hold(sim, "D", 0.5)
    assert sim.drive.pose.yaw < left_yaw


def test_spin_in_place_does_not_translate():
    sim = connected_sim()
    x0, z0 = sim.drive.pose.x, sim.drive.pose.z
    hold(sim, "C", 1.0, release=False)
    assert math.hypot(sim.drive.pose.x - x0, sim.drive.pose.z - z0) < 0.05


def test_forward_after_left_turn_moves_towards_negative_z():
    sim = connected_sim()
    sim.drive.pose.yaw = math.pi / 2  # facing -Z (Three.js rotation.y = +90 deg)
    z0 = sim.drive.pose.z
    hold(sim, "A", 0.5, release=False)
    assert sim.drive.pose.z < z0 - 0.1
    assert sim.drive.pose.x == pytest.approx(config.SPAWN[0], abs=1e-6)


def test_road_boundary_blocks_and_emits_throttled_collision():
    sim = connected_sim()
    limit = config.ROAD_X_M[1] - config.COLLISION_RADIUS_M
    sim.drive.pose.x = limit - 0.05
    sim.drain_outbox()
    hold(sim, "A", 2.0, release=False)
    messages = sim.drain_outbox()
    assert sim.drive.pose.x <= limit + 1e-9
    assert sim.drive.v == 0.0
    collisions = events(messages, "collision")
    assert 1 <= len(collisions) <= 5  # at most one per 0.5 s over 2 s
    assert collisions[0]["data"]["with"] == "road"
    times = [c["t"] for c in collisions]
    gaps = [b - a for a, b in zip(times, times[1:], strict=False)]
    assert all(gap >= config.COLLISION_EVENT_PERIOD_S - 2e-4 for gap in gaps)  # t is rounded


def test_obstacle_blocks_the_robot():
    sim = connected_sim()
    car = sim.layout.obstacles[0]
    assert car.kind == "car"
    sim.drive.pose.x, sim.drive.pose.z = 0.5, 0.5
    sim.drive.pose.yaw = -math.pi / 2  # facing +Z, towards the parked car
    sim.drain_outbox()
    hold(sim, "A", 2.0, release=False)
    stop_z = (car.z - car.d / 2) - config.COLLISION_RADIUS_M
    assert sim.drive.pose.z <= stop_z + 1e-6
    assert sim.drive.pose.z > stop_z - 0.05
    assert events(sim.drain_outbox(), "collision")[0]["data"]["with"] == car.id


def test_robot_can_back_away_after_a_collision():
    sim = connected_sim()
    limit = config.ROAD_X_M[1] - config.COLLISION_RADIUS_M
    sim.drive.pose.x = limit
    hold(sim, "A", 0.5)
    sim.run_for(0.3)
    hold(sim, "B", 0.5, release=False)
    assert sim.drive.pose.x < limit - 0.05


def test_drivetrain_rejects_blocked_translation_but_still_turns():
    train = DriveTrain(Pose(0.0, 0.0, 0.0))
    reason = train.step(0.01, 100, 150, lambda x, z: "wall")
    assert reason == "wall"
    assert (train.pose.x, train.pose.z) == (0.0, 0.0)
    assert train.v == 0.0
    assert train.pose.yaw > 0.0


def test_loose_trash_is_pushed_out_of_the_chassis():
    sim = connected_sim()
    paper = next(t for t in sim.trash if t.id == "t6")  # at (0.9, -0.3)
    sim.drive.pose.x, sim.drive.pose.z, sim.drive.pose.yaw = 0.2, paper.z, 0.0
    start_x = paper.x
    sim.drain_outbox()
    for index in range(300):
        if index % 10 == 0:
            sim.transmit("A")
        sim.step()
        pose = sim.drive.pose
        chassis = OrientedRect(
            pose.x,
            pose.z,
            pose.yaw,
            config.CHASSIS_FOOTPRINT_LENGTH_M,
            config.CHASSIS_FOOTPRINT_WIDTH_M,
        )
        assert not circle_overlaps_rect(paper.x, paper.z, paper.radius - 1e-6, chassis)
    assert paper.x > start_x + 0.2  # it was shoved ahead of the robot
    assert any(line.startswith("[CMD]") for line in serial_lines(sim))
