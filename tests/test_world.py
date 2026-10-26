import math

import pytest

from ecokar_sim import config
from ecokar_sim.world.collision import (
    Bounds,
    OrientedRect,
    circle_overlaps_rect,
    push_circle_out,
)
from ecokar_sim.world.layout import build_layout
from ecokar_sim.world.trash import KIND_SPECS, TrashItem, TrashState


def test_default_layout_is_deterministic_and_has_eight_items():
    first, second = build_layout(), build_layout()
    assert first == second
    assert len(first.trash) == 8
    assert {t.kind for t in first.trash} == {"bottle", "can", "paper"}
    assert len({t.id for t in first.trash}) == 8


def test_layout_matches_the_spec():
    layout = build_layout()
    assert (layout.road.x_min, layout.road.x_max) == (-6.0, 6.0)
    assert (layout.road.z_min, layout.road.z_max) == (-3.0, 3.0)
    assert layout.curb_height == 0.15
    kinds = sorted(o.kind for o in layout.obstacles)
    assert kinds == ["car", "cone", "cone", "cone"]
    car = next(o for o in layout.obstacles if o.kind == "car")
    assert (car.w, car.d, car.h) == (4.2, 1.8, 1.45)
    assert car.z == 2.0
    crate = layout.crate
    assert (crate.x, crate.z) == (4.5, -2.2)
    assert (crate.w, crate.d, crate.h, crate.wall) == (0.32, 0.32, 0.10, 0.01)
    assert layout.spawn == (-4.5, 0.0, 0.0)


@pytest.mark.parametrize("seed", [None, 0, 1, 7, 42, 2024])
def test_trash_is_never_inside_a_solid_or_off_the_road(seed):
    layout = build_layout(seed)
    for item in layout.trash:
        radius = KIND_SPECS[item.kind].length / 2
        assert layout.blocking_reason(item.x, item.z, radius) is None, (seed, item.id)


def test_seed_changes_positions_but_is_reproducible():
    assert build_layout(3) == build_layout(3)
    assert build_layout(3).trash != build_layout(4).trash
    assert build_layout(3).trash != build_layout().trash


def test_spawn_and_crate_are_reachable():
    layout = build_layout()
    x, z, _ = layout.spawn
    assert layout.blocking_reason(x, z, config.COLLISION_RADIUS_M) is None
    assert layout.blocking_reason(layout.crate.x - 0.4, layout.crate.z, 0.15) is None
    assert layout.blocking_reason(layout.crate.x, layout.crate.z, 0.15) == "crate"


def test_blocking_reasons():
    layout = build_layout()
    assert layout.blocking_reason(5.95, 0.0, 0.15) == "road"
    assert layout.blocking_reason(0.0, -2.95, 0.15) == "road"
    assert layout.blocking_reason(0.5, 1.5, 0.15) == "car-1"
    assert layout.blocking_reason(-3.0, 0.9, 0.15) == "cone-1"


def test_crate_inner_footprint():
    crate = build_layout().crate
    assert crate.contains_xz(crate.x, crate.z)
    assert crate.contains_xz(crate.x + 0.14, crate.z - 0.14)
    assert not crate.contains_xz(crate.x + 0.155, crate.z)  # over the wall
    assert not crate.contains_xz(crate.x + 1.0, crate.z)


def test_circle_vs_axis_aligned_rect():
    rect = OrientedRect(0.0, 0.0, 0.0, 2.0, 1.0)
    assert circle_overlaps_rect(1.1, 0.0, 0.2, rect)
    assert not circle_overlaps_rect(1.3, 0.0, 0.2, rect)
    assert circle_overlaps_rect(1.05, 0.55, 0.2, rect)  # corner region, inside the radius
    assert not circle_overlaps_rect(1.2, 0.7, 0.2, rect)  # corner region, outside


def test_circle_vs_rotated_rect():
    rect = OrientedRect(0.0, 0.0, math.pi / 2, 2.0, 1.0)  # long side now along world -Z
    assert circle_overlaps_rect(0.0, -1.1, 0.2, rect)  # beyond the old short side
    assert not circle_overlaps_rect(1.1, 0.0, 0.2, rect)
    assert circle_overlaps_rect(0.6, 0.0, 0.2, rect)


@pytest.mark.parametrize("yaw", [0.0, 0.7, math.pi / 2, 2.4])
@pytest.mark.parametrize("start", [(0.2, 0.1), (1.0, 0.2), (0.0, 0.45), (-0.9, -0.3), (0.05, 0.0)])
def test_push_circle_out_resolves_the_overlap(yaw, start):
    rect = OrientedRect(0.3, -0.2, yaw, 1.6, 0.8)
    x, z = push_circle_out(0.3 + start[0], -0.2 + start[1], 0.15, rect)
    assert not circle_overlaps_rect(x, z, 0.15 - 1e-9, rect)


def test_push_circle_out_leaves_free_circles_alone():
    rect = OrientedRect(0.0, 0.0, 0.3, 1.0, 1.0)
    assert push_circle_out(3.0, 3.0, 0.2, rect) == (3.0, 3.0)


def test_bounds_clamp_and_contain():
    bounds = Bounds(-1.0, 1.0, -1.0, 1.0)
    assert bounds.contains_circle(0.0, 0.0, 0.5)
    assert not bounds.contains_circle(0.6, 0.0, 0.5)
    assert bounds.clamp_circle(5.0, -5.0, 0.5) == (0.5, -0.5)


def test_trash_item_gravity_lands_on_the_floor():
    item = TrashItem("x", "can", 0.0, 0.0, 0.0, y=0.3, state=TrashState.FALLING)
    steps = 0
    while not item.fall(0.01, item.rest_height):
        steps += 1
    assert item.y == item.rest_height
    expected = math.sqrt(2 * (0.3 - item.rest_height) / config.GRAVITY_MPS2)
    assert steps * 0.01 == pytest.approx(expected, abs=0.02)


def test_trash_item_defaults_to_resting_on_the_ground():
    item = TrashItem("x", "bottle", 1.0, 2.0, 0.0)
    assert item.state is TrashState.GROUND
    assert item.y == KIND_SPECS["bottle"].rest_height
