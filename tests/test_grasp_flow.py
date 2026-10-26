"""End-to-end grasp -> carry -> deposit flow, driven through the Bluetooth commands.

The robot is teleported next to each item (driving there is covered by the locomotion tests);
every arm and gripper action goes through the same characters the app sends.
"""

import pytest

from ecokar_sim import config
from ecokar_sim.robotic_arm.servo import angle_for_opening
from ecokar_sim.simulation import Simulation
from ecokar_sim.world.trash import TrashItem, TrashState
from helpers import connected_sim, events, hold

# A reaching pose whose grasp point is ~2 cm above the ground (reachable, above the clamp).
REACH_POSE = {"shoulder": 10.0, "elbow": -60.0}


def item_by_id(sim: Simulation, item_id: str) -> TrashItem:
    return next(item for item in sim.trash if item.id == item_id)


def place_grasp_point(sim: Simulation, x: float, z: float) -> None:
    """Teleport the robot (yaw 0, base 0) so its grasp point is above (x, z)."""
    sim.arm.set_pose(base=0.0, **REACH_POSE)
    sim.drive.pose.yaw = 0.0
    sim.drive.pose.x = x - config.ARM_MOUNT_M[0] - sim.arm.grasp_radial()
    sim.drive.pose.z = z


def grab(sim: Simulation, item: TrashItem) -> None:
    sim.arm.set_pose(gripper=config.GRIPPER_OPEN_DEG)
    place_grasp_point(sim, item.x, item.z)
    hold(sim, "L", 1.0, release=False)


def deposit(sim: Simulation) -> None:
    crate = sim.layout.crate
    place_grasp_point(sim, crate.x, crate.z)
    hold(sim, "K", 0.5)
    sim.run_for(0.6)  # fall


def test_closing_on_an_item_stalls_the_gripper_and_holds_it():
    sim = connected_sim()
    item = item_by_id(sim, "t6")  # paper ball, 36 mm wide
    grab(sim, item)

    assert sim.grasp.held is item
    assert item.state is TrashState.HELD
    assert sim.arm.gripper.angle_deg == pytest.approx(angle_for_opening(item.width))
    assert sim.arm.opening_m == pytest.approx(item.width)
    assert sim.mission.collected == 1
    assert sim.mission.deposited == 0

    state = sim.snapshot()
    assert state["arm"]["held"] == "t6"
    assert next(t for t in state["trash"] if t["id"] == "t6")["state"] == "held"
    assert [e["data"]["id"] for e in events(sim.drain_outbox(), "grasp")] == ["t6"]


def test_gripper_cannot_close_past_the_item_even_if_l_is_held():
    sim = connected_sim()
    grab(sim, item_by_id(sim, "t6"))
    hold(sim, "L", 1.0, release=False)
    assert sim.arm.opening_m == pytest.approx(0.036)
    assert sim.grasp.held is not None


def test_held_item_follows_the_grasp_point():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    sim.transmit("S")
    sim.run_for(0.1)

    hold(sim, "G", 1.0)  # swing the base 30 degrees
    sim.drive.pose.x += 0.3
    sim.drive.pose.yaw += 0.4
    sim.step()
    gx, gy, gz = sim.grasp_point()
    assert (item.x, item.z) == pytest.approx((gx, gz))
    assert item.y == pytest.approx(max(gy, item.rest_height))
    assert item.yaw == pytest.approx(sim.arm.heading(sim.drive.pose.yaw))
    assert sim.snapshot()["arm"]["held"] == "t6"


def test_opening_over_the_crate_deposits_the_item():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    sim.drain_outbox()
    deposit(sim)

    assert sim.grasp.held is None
    assert item.state is TrashState.DEPOSITED
    assert item.y == pytest.approx(sim.layout.crate.floor_y + item.rest_height)
    assert sim.layout.crate.contains_xz(item.x, item.z)
    assert sim.mission.deposited == 1
    assert sim.mission.collected == 1
    messages = sim.drain_outbox()
    assert [e["data"]["id"] for e in events(messages, "release")] == ["t6"]
    deposits = events(messages, "deposit")
    assert [e["data"]["id"] for e in deposits] == ["t6"]
    assert deposits[0]["data"]["deposited"] == 1


def test_item_falls_with_gravity_before_landing():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    crate = sim.layout.crate
    place_grasp_point(sim, crate.x, crate.z)
    sim.arm.set_pose(shoulder=60.0, elbow=0.0)  # lift well above the crate
    sim.step()
    start_y = item.y
    hold(sim, "K", 0.2, release=False)
    assert item.state is TrashState.FALLING
    heights = []
    for _ in range(30):
        sim.step()
        heights.append(item.y)
        if item.state is not TrashState.FALLING:
            break
    assert start_y > 0.15
    assert heights[0] > heights[-1]
    assert item.state is TrashState.DEPOSITED


def test_release_outside_the_crate_drops_it_on_the_ground():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    place_grasp_point(sim, 0.0, -2.0)
    hold(sim, "K", 0.5)
    sim.run_for(0.5)

    assert item.state is TrashState.GROUND
    assert item.y == pytest.approx(item.rest_height)
    assert sim.mission.deposited == 0
    assert sim.mission.collected == 1


def test_a_dropped_item_can_be_grasped_again_and_counts_once():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    place_grasp_point(sim, 0.0, -2.0)
    hold(sim, "K", 0.5)
    sim.run_for(0.5)
    grab(sim, item)
    assert sim.grasp.held is item
    assert sim.mission.collected == 1  # unique items only


def test_a_deposited_item_cannot_be_grasped_again():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    grab(sim, item)
    deposit(sim)
    assert item.state is TrashState.DEPOSITED
    sim.arm.set_pose(gripper=config.GRIPPER_OPEN_DEG)
    place_grasp_point(sim, item.x, item.z)
    hold(sim, "L", 1.0, release=False)
    assert sim.grasp.held is None
    assert item.state is TrashState.DEPOSITED
    assert sim.arm.opening_m == pytest.approx(0.0)  # closed on nothing


def test_far_item_is_not_grasped():
    sim = connected_sim()
    item = item_by_id(sim, "t6")
    place_grasp_point(sim, item.x + 0.1, item.z)  # 10 cm away
    hold(sim, "L", 1.0, release=False)
    assert sim.grasp.held is None
    assert item.state is TrashState.GROUND
    assert sim.arm.gripper.angle_deg == config.GRIPPER_CLOSED_DEG


def test_item_wider_than_the_opening_is_not_grasped():
    sim = connected_sim()
    item = item_by_id(sim, "t1")  # bottle, 40 mm
    sim.arm.set_pose(gripper=angle_for_opening(0.030))  # opened only 30 mm
    place_grasp_point(sim, item.x, item.z)
    hold(sim, "L", 0.5, release=False)
    assert sim.grasp.held is None


def test_whole_mission_completes_once():
    sim = connected_sim()
    crate_events = []
    for item in list(sim.trash):
        grab(sim, item)
        assert sim.grasp.held is item, item.id
        deposit(sim)
        assert item.state is TrashState.DEPOSITED, item.id
        crate_events.extend(sim.drain_outbox())

    assert sim.mission.collected == sim.mission.deposited == sim.mission.total == 8
    assert sim.mission.complete
    assert len(events(crate_events, "grasp")) == 8
    assert len(events(crate_events, "deposit")) == 8
    completions = events(crate_events, "mission_complete")
    assert len(completions) == 1
    assert completions[0]["data"]["deposited"] == 8

    elapsed = sim.mission.elapsed_s
    distance = sim.mission.distance_m
    sim.run_for(2.0)
    assert sim.mission.elapsed_s == elapsed  # the clock stops when complete
    assert sim.mission.distance_m == distance
    assert sim.snapshot()["mission"]["complete"] is True
