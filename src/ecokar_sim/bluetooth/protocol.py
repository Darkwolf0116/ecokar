"""Bluetooth command protocol: one ASCII character per button.

The MIT App Inventor app sends the letter of the pressed button, repeats it every
``APP_REPEAT_MS`` while the button is held, and sends ``S`` when it is released.
This module is the single place that maps characters to meaning: to adapt the
protocol (for example when the real firmware gains arm letters) edit the tables
below and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

STOP_CHARS: tuple[str, ...] = ("S", "0")


class Command(StrEnum):
    """Every command the firmware understands. The value is the wire character."""

    FORWARD = "A"
    BACKWARD = "B"
    SPIN_LEFT = "C"
    SPIN_RIGHT = "D"
    FOREARM_UP = "E"
    FOREARM_DOWN = "F"
    BASE_LEFT = "G"
    BASE_RIGHT = "H"
    ARM_FORWARD = "I"
    ARM_BACK = "J"
    GRIPPER_OPEN = "K"
    GRIPPER_CLOSE = "L"
    STOP = "S"


LOCOMOTION: frozenset[Command] = frozenset(
    {Command.FORWARD, Command.BACKWARD, Command.SPIN_LEFT, Command.SPIN_RIGHT}
)
ARM: frozenset[Command] = frozenset(
    {
        Command.FOREARM_UP,
        Command.FOREARM_DOWN,
        Command.BASE_LEFT,
        Command.BASE_RIGHT,
        Command.ARM_FORWARD,
        Command.ARM_BACK,
        Command.GRIPPER_OPEN,
        Command.GRIPPER_CLOSE,
    }
)
STOP: frozenset[Command] = frozenset({Command.STOP})

# Arm letter -> (joint, jog direction). Joint names: base, shoulder, elbow, gripper.
# base: +1 = CCW (left); shoulder: +1 = main arm raised (angle grows), so ADELANTE is -1;
# elbow: +1 = forearm up; gripper: +1 = open.
ARM_JOG_BINDINGS: dict[Command, tuple[str, int]] = {
    Command.FOREARM_UP: ("elbow", +1),
    Command.FOREARM_DOWN: ("elbow", -1),
    Command.BASE_LEFT: ("base", +1),
    Command.BASE_RIGHT: ("base", -1),
    Command.ARM_FORWARD: ("shoulder", -1),
    Command.ARM_BACK: ("shoulder", +1),
    Command.GRIPPER_OPEN: ("gripper", +1),
    Command.GRIPPER_CLOSE: ("gripper", -1),
}


@dataclass(frozen=True)
class Button:
    """One app button, in the visual order of the app."""

    char: str
    label: str  # Spanish label shown in the app
    group: str  # "locomotion" | "arm"


BUTTONS: tuple[Button, ...] = (
    Button("A", "Avanzar", "locomotion"),
    Button("B", "Retroceder", "locomotion"),
    Button("C", "Girar izquierda", "locomotion"),
    Button("D", "Girar derecha", "locomotion"),
    Button("E", "Subir", "arm"),
    Button("F", "Bajar", "arm"),
    Button("G", "Girar base +", "arm"),
    Button("H", "Girar base −", "arm"),
    Button("I", "Adelante", "arm"),
    Button("J", "Atrás", "arm"),
    Button("K", "Abrir gripper", "arm"),
    Button("L", "Cerrar gripper", "arm"),
)

_CHAR_TO_COMMAND: dict[str, Command] = {}
for _command in Command:
    _CHAR_TO_COMMAND[_command.value] = _command
    _CHAR_TO_COMMAND[_command.value.lower()] = _command
_CHAR_TO_COMMAND["0"] = Command.STOP


def parse_char(char: str) -> Command | None:
    """Return the command for one received character, or None if it must be ignored."""
    return _CHAR_TO_COMMAND.get(char)


def parse_bytes(data: str | bytes) -> list[Command]:
    """Parse a received chunk into commands, in order.

    Case-insensitive; ``0`` is a synonym of ``S``; CR, LF, spaces and any unknown
    character are ignored (they never change the robot state).
    """
    text = data.decode("latin-1") if isinstance(data, bytes) else data
    commands: list[Command] = []
    for char in text:
        command = parse_char(char)
        if command is not None:
            commands.append(command)
    return commands


def button_table() -> list[dict[str, str]]:
    """Protocol table sent in the WebSocket ``hello`` message."""
    return [{"char": b.char, "label": b.label, "group": b.group} for b in BUTTONS]
