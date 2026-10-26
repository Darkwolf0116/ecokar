"""The digital twin: one robot, one street, one mission. Framework-free and deterministic.

``Simulation`` owns every part (firmware, drivetrain, arm, trash, mission, battery) and
advances them with a fixed step. The transport layer (see ``server``) only calls
:meth:`handle_client_message`, :meth:`step`, :meth:`drain_outbox` and :meth:`snapshot`.
"""

from __future__ import annotations

import math
from typing import Any

from . import config
from .bluetooth.protocol import parse_bytes
from .firmware.controller import FirmwareController
from .locomotion.drivetrain import DriveTrain, Pose
from .mission.battery import Battery
from .mission.score import Mission
from .robotic_arm.arm import STEPPER_JOINTS, RoboticArm
from .robotic_arm.grasp import GraspController
from .serialization import hello_message, round_floats, state_message
from .world.collision import OrientedRect, push_circle_out
from .world.layout import Layout, build_layout
from .world.trash import TrashItem, TrashState

MAX_TX_CHARS = 256  # a single "tx" message never needs more than this


class Simulation:
    """Runs the robot. ``seed=None`` gives the fixed street layout."""

    def __init__(self, seed: int | None = None) -> None:
        self.seed = seed
        self.bt_connected = False
        self._outbox: list[dict[str, Any]] = []
        self._build_world()

    # ---------------------------------------------------------------- lifecycle
    def _build_world(self) -> None:
        self.layout: Layout = build_layout(self.seed)
        self.time = 0.0
        spawn_x, spawn_z, spawn_yaw = self.layout.spawn
        self.drive = DriveTrain(Pose(spawn_x, spawn_z, spawn_yaw))
        self.firmware = FirmwareController()
        self.arm = RoboticArm()
        self.grasp = GraspController()
        self.trash: list[TrashItem] = [
            TrashItem(id=s.id, kind=s.kind, x=s.x, z=s.z, yaw=s.yaw) for s in self.layout.trash
        ]
        self.mission = Mission(total=len(self.trash))
        self.battery = Battery()
        self._last_collision_t = -math.inf

    def reset(self) -> None:
        """New world and mission; the Bluetooth link state is kept."""
        self._outbox.clear()
        self._build_world()
        if self.bt_connected:
            self.firmware.bt_connected()
            self._pull_serial()

    # ------------------------------------------------------------------ inputs
    def handle_client_message(self, message: dict[str, Any]) -> None:
        """Apply one client message. Unknown or malformed messages are ignored."""
        kind = message.get("type")
        if kind == "bt_connect":
            self.connect()
        elif kind == "bt_disconnect":
            self.disconnect()
        elif kind == "tx":
            data = message.get("data")
            if isinstance(data, str):
                self.transmit(data)
        elif kind == "reset":
            self.reset()

    def connect(self) -> None:
        if self.bt_connected:
            return
        self.bt_connected = True
        self.firmware.bt_connected()
        self._pull_serial()

    def disconnect(self) -> None:
        if not self.bt_connected:
            return
        self.bt_connected = False
        self.firmware.bt_disconnected()
        self._pull_serial()

    def transmit(self, text: str) -> None:
        """Characters typed in the app. Ignored while the Bluetooth link is down."""
        if not self.bt_connected:
            return
        text = text[:MAX_TX_CHARS]
        if parse_bytes(text):
            self.mission.start()
        self.firmware.feed(text)

    # -------------------------------------------------------------------- step
    def step(self, dt: float = config.SIM_DT_S) -> None:
        """Advance the whole world by ``dt`` seconds (the server uses a fixed 10 ms)."""
        self.time += dt
        fw = self.firmware
        fw.tick(max(1, round(dt * 1000)))
        self._pull_serial()

        self._step_drive(dt)
        self._step_arm(dt)
        self._step_trash(dt)

        steppers_moving = sum(self.arm.moving[name] for name in STEPPER_JOINTS)
        self.battery.step(
            dt, fw.left_pwm, fw.right_pwm, steppers_moving, self.arm.moving["gripper"]
        )
        self.mission.tick(dt)

    def run_for(self, seconds: float, dt: float = config.SIM_DT_S) -> None:
        """Advance ``seconds`` of simulated time in fixed steps (handy for scripts and tests)."""
        for _ in range(round(seconds / dt)):
            self.step(dt)

    def _step_drive(self, dt: float) -> None:
        fw = self.firmware
        reason = self.drive.step(
            dt,
            fw.left_pwm,
            fw.right_pwm,
            lambda x, z: self.layout.blocking_reason(x, z, config.COLLISION_RADIUS_M),
        )
        if reason is not None:
            self._emit_collision(reason)
        self.mission.add_distance(abs(self.drive.v) * dt)

    def _step_arm(self, dt: float) -> None:
        fw = self.firmware
        closing = fw.jog["gripper"] < 0
        floor = self.grasp.gripper_floor_deg(self.arm, self.grasp_point(), self.trash, closing)
        for hit in self.arm.step(dt, fw.jog, floor):
            fw.report_arm_limit(hit.label)
            self._emit("limit", {"joint": hit.joint, "reason": hit.reason})
        self._pull_serial()

        heading = self.arm.heading(self.drive.pose.yaw)
        for event in self.grasp.update(self.arm, self.grasp_point(), heading, closing):
            data = {"id": event.item.id, "kind": event.item.kind}
            if event.name == "grasp":
                self.mission.record_grasp(event.item.id)
            self._emit(event.name, data)

    def _step_trash(self, dt: float) -> None:
        for item in self.trash:
            if item.state is TrashState.FALLING:
                self._step_falling(item, dt)
        self._push_ground_items()

    def _step_falling(self, item: TrashItem, dt: float) -> None:
        crate = self.layout.crate
        in_crate = crate.contains_xz(item.x, item.z)
        floor_y = (crate.floor_y if in_crate else 0.0) + item.rest_height
        if not item.fall(dt, floor_y):
            return
        if not in_crate:
            item.state = TrashState.GROUND
            item.x, item.z = self.layout.resolve_circle(item.x, item.z, item.radius)
            return
        item.state = TrashState.DEPOSITED
        completed = self.mission.record_deposit(item.id)
        self._emit(
            "deposit",
            {
                "id": item.id,
                "kind": item.kind,
                "deposited": self.mission.deposited,
                "total": self.mission.total,
            },
        )
        if completed:
            self._emit(
                "mission_complete",
                {
                    "elapsed_s": self.mission.elapsed_s,
                    "distance_m": self.mission.distance_m,
                    "collected": self.mission.collected,
                    "deposited": self.mission.deposited,
                },
            )

    def _push_ground_items(self) -> None:
        """The chassis shoves loose trash aside so it is never inside the robot."""
        pose = self.drive.pose
        chassis = OrientedRect(
            pose.x,
            pose.z,
            pose.yaw,
            config.CHASSIS_FOOTPRINT_LENGTH_M,
            config.CHASSIS_FOOTPRINT_WIDTH_M,
        )
        for item in self.trash:
            if item.state is not TrashState.GROUND:
                continue
            x, z = push_circle_out(item.x, item.z, item.radius, chassis)
            if (x, z) != (item.x, item.z):
                item.x, item.z = self.layout.resolve_circle(x, z, item.radius)

    # ------------------------------------------------------------------ queries
    def grasp_point(self) -> tuple[float, float, float]:
        pose = self.drive.pose
        return self.arm.grasp_point_world(pose.x, pose.z, pose.yaw)

    def hello(self) -> dict[str, Any]:
        return hello_message(self)

    def snapshot(self) -> dict[str, Any]:
        """The full ``state`` message."""
        return state_message(self)

    def drain_outbox(self) -> list[dict[str, Any]]:
        """Serial lines and events produced since the last call, in chronological order."""
        messages, self._outbox = self._outbox, []
        return messages

    # ----------------------------------------------------------------- internals
    def _pull_serial(self) -> None:
        for line in self.firmware.drain_serial():
            self._outbox.append(
                round_floats({"type": "serial", "t": line.t_ms / 1000.0, "line": line.text})
            )

    def _emit(self, name: str, data: dict[str, Any]) -> None:
        self._outbox.append(
            round_floats({"type": "event", "t": self.time, "name": name, "data": data})
        )

    def _emit_collision(self, reason: str) -> None:
        if self.time - self._last_collision_t < config.COLLISION_EVENT_PERIOD_S:
            return
        self._last_collision_t = self.time
        pose = self.drive.pose
        self._emit("collision", {"with": reason, "x": pose.x, "z": pose.z})
