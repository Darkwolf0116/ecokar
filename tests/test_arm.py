import math

import pytest

from ecokar_sim import config
from ecokar_sim.robotic_arm import kinematics
from ecokar_sim.robotic_arm.arm import RoboticArm
from ecokar_sim.robotic_arm.servo import angle_for_opening, opening_for_angle
from helpers import connected_sim, events, hold, serial_lines


def test_home_pose():
    arm = RoboticArm()
    assert (arm.base.angle_deg, arm.shoulder.angle_deg, arm.elbow.angle_deg) == (0, 90, 0)
    assert arm.gripper.angle_deg == config.GRIPPER_OPEN_DEG
    assert arm.steps == {"base": 0, "shoulder": 0, "elbow": 0}
    assert arm.opening_m == pytest.approx(config.GRIPPER_MAX_OPENING_M)


def test_home_grasp_point_forward_kinematics():
    arm = RoboticArm()
    gx, gy, gz = arm.grasp_point_world(0.0, 0.0, 0.0)
    reach = config.L2_M + config.GRASP_OFFSET_M[0]  # forearm horizontal + gripper offset
    assert gx == pytest.approx(config.ARM_MOUNT_M[0] + reach)
    assert gz == pytest.approx(0.0)
    height = config.PLATE_Y_M + config.SHOULDER_HEIGHT_M + config.L1_M + config.GRASP_OFFSET_M[1]
    assert gy == pytest.approx(height)


def test_grasp_point_follows_robot_yaw_and_base_angle():
    arm = RoboticArm()
    reach = arm.grasp_radial()
    mount = config.ARM_MOUNT_M[0]
    # robot facing -Z (yaw +90 deg)
    gx, _, gz = arm.grasp_point_world(1.0, 2.0, math.pi / 2)
    assert (gx, gz) == pytest.approx((1.0, 2.0 - mount - reach))
    # base turned +90 deg (CCW) on a robot at yaw 0 points the arm to -Z as well
    arm.set_pose(base=90.0)
    gx, _, gz = arm.grasp_point_world(0.0, 0.0, 0.0)
    assert (gx, gz) == pytest.approx((mount, -reach))


def test_stepper_step_counter():
    arm = RoboticArm()
    arm.set_pose(base=120.0, shoulder=70.0, elbow=35.0)
    assert arm.steps["base"] == round(120 * 2048 / 360 * 2.5) == 1707
    assert arm.steps["shoulder"] == round(-20 * 2048 / 360) == -114
    assert arm.steps["elbow"] == round(35 * 2048 / 360) == 199


def test_stepper_speed_never_exceeds_the_motor():
    arm = RoboticArm()
    for stepper in arm.steppers.values():
        assert stepper.speed_deg_s <= config.STEPPER_MAX_OUTPUT_DEG_S / stepper.spec.gear_ratio


def test_servo_opening_mapping_roundtrips():
    assert opening_for_angle(config.GRIPPER_CLOSED_DEG) == pytest.approx(0.0)
    assert opening_for_angle(config.GRIPPER_OPEN_DEG) == pytest.approx(0.058)
    assert angle_for_opening(opening_for_angle(33.3)) == pytest.approx(33.3)


def test_jog_directions_match_the_protocol():
    sim = connected_sim()
    hold(sim, "G", 0.5)
    assert sim.arm.base.angle_deg > 10  # G = base CCW (+)
    hold(sim, "H", 1.0)
    assert sim.arm.base.angle_deg < 0
    hold(sim, "E", 0.5)
    assert sim.arm.elbow.angle_deg > 5  # E = forearm up (+)
    hold(sim, "F", 1.0)
    assert sim.arm.elbow.angle_deg < 0
    hold(sim, "J", 0.5)
    assert sim.arm.shoulder.angle_deg > 90  # J = back (+)
    hold(sim, "I", 1.0)
    assert sim.arm.shoulder.angle_deg < 90  # I = forward (-)


def test_jog_speed_matches_config():
    sim = connected_sim()
    hold(sim, "G", 1.0, release=False)
    assert sim.arm.base.angle_deg == pytest.approx(config.BASE_JOINT.jog_speed_deg_s, abs=0.5)


def test_arm_does_not_move_without_jog_or_bluetooth():
    sim = connected_sim()
    sim.disconnect()
    sim.transmit("G")
    sim.run_for(1.0)
    assert sim.arm.base.angle_deg == 0.0


def test_range_limit_stops_exactly_and_prints_once():
    sim = connected_sim()
    hold(sim, "E", 4.0, release=False)
    assert sim.arm.elbow.angle_deg == config.ELBOW_JOINT.max_deg
    messages = sim.drain_outbox()
    lines = [m["line"] for m in messages if m["type"] == "serial"]
    assert lines.count("[BRAZO] Límite codo") == 1
    limit_events = events(messages, "limit")
    assert [e["data"] for e in limit_events] == [{"joint": "elbow", "reason": "range"}]


def test_each_new_hit_prints_again_after_release():
    sim = connected_sim()
    hold(sim, "G", 5.0)  # hit +120 and release
    hold(sim, "G", 0.5)  # still at the limit: a new hit
    lines = serial_lines(sim)
    assert lines.count("[BRAZO] Límite base") == 2
    assert sim.arm.base.angle_deg == config.BASE_JOINT.max_deg


def test_coupling_blocks_the_main_arm_before_its_own_limit():
    sim = connected_sim()
    hold(sim, "I", 5.0, release=False)  # shoulder goes down towards 25 (90 - 0 = coupling min)
    spread = sim.arm.shoulder.angle_deg - sim.arm.elbow.angle_deg
    assert spread >= config.COUPLING_MIN_DEG
    assert spread == pytest.approx(config.COUPLING_MIN_DEG, abs=0.5)
    messages = sim.drain_outbox()
    assert [e["data"]["reason"] for e in events(messages, "limit")] == ["coupling"]
    lines = [m["line"] for m in messages if m["type"] == "serial"]
    assert lines.count("[BRAZO] Límite hombro") == 1


def test_coupling_blocks_the_other_direction_too():
    sim = connected_sim()
    sim.arm.set_pose(shoulder=100.0, elbow=-60.0)  # spread 160
    hold(sim, "F", 3.0, release=False)  # forearm down widens the spread beyond 165
    spread = sim.arm.shoulder.angle_deg - sim.arm.elbow.angle_deg
    assert spread <= config.COUPLING_MAX_DEG
    assert spread == pytest.approx(config.COUPLING_MAX_DEG, abs=0.5)


def test_ground_clamp_blocks_the_forearm():
    sim = connected_sim()
    sim.arm.set_pose(shoulder=5.0, elbow=-20.0)
    sim.drain_outbox()
    hold(sim, "F", 4.0, release=False)
    elbow = sim.arm.elbow.angle_deg
    assert elbow > config.ELBOW_JOINT.min_deg  # stopped by the ground, not by its range
    grasp_y = kinematics.grasp_height(sim.arm.shoulder.angle_deg, elbow)
    assert grasp_y >= config.GROUND_MIN_GRASP_Y_M
    assert grasp_y == pytest.approx(config.GROUND_MIN_GRASP_Y_M, abs=0.003)
    messages = sim.drain_outbox()
    lines = [m["line"] for m in messages if m["type"] == "serial"]
    assert lines.count("[BRAZO] Límite suelo") == 1
    assert [e["data"]["reason"] for e in events(messages, "limit")] == ["ground"]


def test_ground_clamp_lets_the_arm_move_away():
    sim = connected_sim()
    sim.arm.set_pose(shoulder=5.0, elbow=-20.0)
    hold(sim, "F", 4.0)
    low = sim.arm.elbow.angle_deg
    hold(sim, "E", 1.0)
    assert sim.arm.elbow.angle_deg > low + 10


def test_ground_clamp_blocks_the_shoulder_too():
    sim = connected_sim()
    sim.arm.set_pose(shoulder=40.0, elbow=-60.0)  # spread 100, grasp ~ 5 cm
    hold(sim, "I", 5.0, release=False)
    assert kinematics.grasp_height(sim.arm.shoulder.angle_deg, sim.arm.elbow.angle_deg) >= (
        config.GROUND_MIN_GRASP_Y_M
    )


def test_set_pose_rejects_unreachable_poses():
    arm = RoboticArm()
    with pytest.raises(ValueError, match="ground"):
        arm.set_pose(shoulder=0.0, elbow=-75.0)
    with pytest.raises(ValueError, match="coupling"):
        arm.set_pose(shoulder=20.0, elbow=10.0)


def test_gripper_closes_and_opens_at_jog_rate():
    sim = connected_sim()
    hold(sim, "L", 0.3, release=False)
    expected = config.GRIPPER_OPEN_DEG - config.GRIPPER_JOG_DEG_S * 0.3
    assert sim.arm.gripper.angle_deg == pytest.approx(expected, abs=1.5)
    hold(sim, "L", 1.0)
    assert sim.arm.gripper.angle_deg == config.GRIPPER_CLOSED_DEG
    assert sim.arm.opening_m == pytest.approx(0.0)
    hold(sim, "K", 1.0)
    assert sim.arm.gripper.angle_deg == config.GRIPPER_OPEN_DEG


def test_gripper_end_stop_reports_a_limit():
    sim = connected_sim()
    sim.drain_outbox()
    hold(sim, "K", 0.5)  # already fully open
    assert "[BRAZO] Límite pinza" in serial_lines(sim)


def test_released_button_stops_the_arm():
    sim = connected_sim()
    hold(sim, "G", 0.5)
    angle = sim.arm.base.angle_deg
    sim.run_for(1.0)
    assert sim.arm.base.angle_deg == angle


def test_arm_timeout_without_repeats():
    sim = connected_sim()
    sim.transmit("G")  # a single letter, no repeats, no release
    sim.run_for(1.0)
    stopped_at = sim.arm.base.angle_deg
    assert 10 < stopped_at < 14  # ~0.41 s at 30 deg/s
    assert "[SEG] Timeout de comando: parada" in serial_lines(sim)
