from ecokar_sim.bluetooth.protocol import (
    ARM,
    ARM_JOG_BINDINGS,
    LOCOMOTION,
    STOP,
    Command,
    button_table,
    parse_bytes,
)


def test_parse_is_case_insensitive():
    assert parse_bytes("abcd") == parse_bytes("ABCD")
    assert parse_bytes("aBcD") == [
        Command.FORWARD,
        Command.BACKWARD,
        Command.SPIN_LEFT,
        Command.SPIN_RIGHT,
    ]


def test_zero_is_stop():
    assert parse_bytes("0") == [Command.STOP]
    assert parse_bytes("s0S") == [Command.STOP] * 3


def test_garbage_and_line_endings_are_ignored():
    assert parse_bytes("\r\n  x?!\t\x00\xff") == []
    assert parse_bytes("A\r\nB \n") == [Command.FORWARD, Command.BACKWARD]


def test_bytes_input_is_accepted():
    assert parse_bytes(b"A\r\nS") == [Command.FORWARD, Command.STOP]


def test_arm_letters_parse():
    assert parse_bytes("EFGHIJKL") == [
        Command.FOREARM_UP,
        Command.FOREARM_DOWN,
        Command.BASE_LEFT,
        Command.BASE_RIGHT,
        Command.ARM_FORWARD,
        Command.ARM_BACK,
        Command.GRIPPER_OPEN,
        Command.GRIPPER_CLOSE,
    ]


def test_command_groups_partition_all_commands():
    assert set(Command) == LOCOMOTION | ARM | STOP
    assert not LOCOMOTION & ARM
    assert not (LOCOMOTION | ARM) & STOP


def test_every_arm_command_has_a_joint_binding():
    assert set(ARM_JOG_BINDINGS) == ARM
    for joint, direction in ARM_JOG_BINDINGS.values():
        assert joint in {"base", "shoulder", "elbow", "gripper"}
        assert direction in (-1, 1)


def test_button_table_matches_app_order():
    table = button_table()
    assert [b["char"] for b in table] == list("ABCDEFGHIJKL")
    assert {b["group"] for b in table[:4]} == {"locomotion"}
    assert {b["group"] for b in table[4:]} == {"arm"}
