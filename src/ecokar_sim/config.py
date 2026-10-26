"""Physical constants and tunables of the EcoKar digital twin.

Units: metres, seconds and radians internally. A name ending in ``_DEG`` is in
degrees, ``_MS`` in milliseconds, ``_PWM`` in raw 0..255 PWM counts, ``_MPS`` in
metres per second, ``_A`` in amperes. Degrees only leave the core in snapshot
fields whose names end in ``_deg``.

World axes follow Three.js: Y is up, the ground plane is XZ. A robot with yaw
``psi`` looks along ``(cos psi, 0, -sin psi)``; positive yaw is a left turn.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------- #
# Simulation clock / transport
# --------------------------------------------------------------------------- #
PROTOCOL_VERSION = 1
SIM_DT_S = 0.01  # fixed physics step (10 ms)
STATE_RATE_HZ = 30  # "state" frames per second sent to the browser
MAX_CATCHUP_STEPS = 10  # max physics steps per scheduler tick when running late

# --------------------------------------------------------------------------- #
# Firmware (mirror of arduino/carrito_bt_mega/carrito_bt_mega.ino)
# --------------------------------------------------------------------------- #
PWM_MAX = 255  # sketch: PWM_MAX
DRIVE_PWM = 200  # sketch: VEL_AVANCE (forward / backward)
SPIN_PWM = 170  # sketch: VEL_GIRO (spin in place)
TRIM_LEFT_PWM = 0  # sketch: TRIM_IZQ
TRIM_RIGHT_PWM = 0  # sketch: TRIM_DER
INVERT_LEFT = False  # sketch: INVERTIR_IZQ
INVERT_RIGHT = False  # sketch: INVERTIR_DER
RAMP_STEP_PWM = 15  # sketch: RAMPA_PASO
RAMP_INTERVAL_MS = 10  # sketch: RAMPA_INTERVALO_MS
COMMAND_TIMEOUT_MS = 400  # sketch: TIMEOUT_COMANDO_MS (dead-man)
APP_REPEAT_MS = 100  # the MIT App Inventor app re-sends the held letter this often
SETUP_BANNER = "Carrito BT listo. Comandos: A B C D S"  # sketch: setup()

# --------------------------------------------------------------------------- #
# Chassis and drive
# --------------------------------------------------------------------------- #
PLATE_LENGTH_M = 0.26  # along chassis X (forward)
PLATE_WIDTH_M = 0.15
PLATE_Y_M = 0.062  # height of the top of the plate above the ground
WHEEL_RADIUS_M = 0.0325
WHEEL_WIDTH_M = 0.026
TRACK_M = 0.17  # distance between left and right wheel centres
WHEELBASE_M = 0.15  # distance between front and rear axles
COLLISION_RADIUS_M = 0.15  # circle used against curbs, obstacles and the crate
# Oriented rectangle used to push loose trash out of the chassis (plate + wheels).
CHASSIS_FOOTPRINT_LENGTH_M = PLATE_LENGTH_M
CHASSIS_FOOTPRINT_WIDTH_M = TRACK_M + WHEEL_WIDTH_M

V_MAX_MPS = 0.55  # ground speed of a side at PWM 255
SKID_FACTOR = 1.9  # skid-steer: effective track = TRACK_M * SKID_FACTOR
COLLISION_EVENT_PERIOD_S = 0.5  # throttle of "collision" events


# --------------------------------------------------------------------------- #
# Robotic arm (EEZYbotARM MK3)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class JointSpec:
    """One stepper-driven joint. Angles in degrees."""

    name: str
    home_deg: float
    min_deg: float
    max_deg: float
    jog_speed_deg_s: float  # speed while a jog button is held
    gear_ratio: float  # motor-output revolutions per joint revolution (approximation)


STEPS_PER_OUTPUT_REV = 2048  # 28BYJ-48 in full-step mode, after its internal gearbox
STEPPER_MAX_OUTPUT_DEG_S = 90.0  # about 15 rpm at the output shaft (safe limit)

# base_deg: 0 = chassis forward, + = CCW (left).
BASE_JOINT = JointSpec("base", 0.0, -120.0, 120.0, 30.0, 2.5)
# shoulder_deg: main arm angle from horizontal-forward, 90 = vertical.
# NOTE: the nominal range [40, 125] cannot reach the ground from the shoulder height
# (plate 0.062 + 0.085 above it), so the lower bound is opened to 0 degrees.
SHOULDER_JOINT = JointSpec("shoulder", 90.0, 0.0, 125.0, 25.0, 1.0)
# elbow_deg: forearm ABSOLUTE angle from horizontal-forward (parallelogram linkage).
ELBOW_JOINT = JointSpec("elbow", 0.0, -75.0, 35.0, 25.0, 1.0)
# Mechanical coupling between both links: SHOULDER - ELBOW must stay inside this band.
COUPLING_MIN_DEG = 25.0
COUPLING_MAX_DEG = 165.0

ARM_MOUNT_M = (0.06, PLATE_Y_M, 0.0)  # base pivot in chassis-local (x fwd, y up, z right)
SHOULDER_HEIGHT_M = 0.085  # shoulder pivot above the plate
L1_M = 0.135  # main arm length
L2_M = 0.147  # forearm length
GRASP_OFFSET_M = (0.055, -0.02)  # (forward, up) from the wrist to the point between the fingers

GROUND_MIN_GRASP_Y_M = 0.012  # the grasp point may not go below this height
GROUND_MIN_FINGERTIP_Y_M = 0.004  # nor the fingertips below this one
FINGERTIP_DROP_M = 0.008  # fingertips hang this far below the grasp point

# Gripper: SG90 servo.
GRIPPER_CLOSED_DEG = 10.0
GRIPPER_OPEN_DEG = 80.0
GRIPPER_JOG_DEG_S = 120.0  # speed while K / L are held
GRIPPER_MAX_DEG_S = 600.0  # physical SG90 speed (about 0.1 s / 60 deg); jog is below it
GRIPPER_MAX_OPENING_M = 0.058

# Grasping.
GRASP_RADIUS_M = 0.03  # item centre must be this close to the grasp point
RELEASE_MARGIN_M = 0.004  # opening beyond item width + margin releases the item
GRAVITY_MPS2 = 9.81

# --------------------------------------------------------------------------- #
# Battery: 2S LiPo, 2200 mAh
# --------------------------------------------------------------------------- #
BATTERY_CAPACITY_AH = 2.2
BATTERY_IDLE_A = 0.15
BATTERY_DRIVE_A = 0.9  # at full PWM on both sides
BATTERY_STEPPER_A = 0.24  # per moving stepper (28BYJ-48 + ULN2003)
BATTERY_SERVO_A = 0.15  # while the gripper servo moves
# (percent, volts) breakpoints of the 2S pack, linearly interpolated.
BATTERY_CURVE: tuple[tuple[float, float], ...] = (
    (0.0, 6.60),
    (5.0, 7.00),
    (10.0, 7.36),
    (20.0, 7.48),
    (30.0, 7.56),
    (40.0, 7.64),
    (50.0, 7.72),
    (60.0, 7.82),
    (70.0, 7.92),
    (80.0, 8.04),
    (90.0, 8.18),
    (100.0, 8.40),
)

# --------------------------------------------------------------------------- #
# World
# --------------------------------------------------------------------------- #
ROAD_X_M = (-6.0, 6.0)
ROAD_Z_M = (-3.0, 3.0)
SIDEWALK_WIDTH_M = 2.5  # rendered beyond |z| > 3, up to 5.5 (not drivable)
CURB_HEIGHT_M = 0.15
SPAWN = (-4.5, 0.0, 0.0)  # x, z, yaw
CRATE_FLOOR_THICKNESS_M = 0.01
