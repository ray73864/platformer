// Physics-sim guard for the spike rules baked into computeReachable (C1/S1).
// The BFS treats surface spikes as arc-able up to two adjacent cores and
// treats a spike capping a riser as wall height. Those boundaries are
// properties of the SHIPPED Physics + Hazards integration, not of the BFS, so
// they are pinned here by driving Player through Physics exactly like the
// game loop does (player.update → applyGravity → resolveCollisions, then the
// hazard death check) across a sweep of takeoff positions and frame rates.
import { test, expect } from "bun:test";
import { Player } from "../../js/player.js";
import { Physics } from "../../js/physics.js";
import { Hazards } from "../../js/hazards.js";

const TS = 32;

// Fixture grids mirror the level.test.js BFS fixtures so a divergence
// between what the BFS validates and what the physics can fly fails here.
function buildFixture(kind) {
    // 'capped'/'uncapped': riser at columns 6+, optional spike capping col 6.
    // 'stripN': flat ground with an N-wide surface spike strip at column 6.
    const width = 14, height = 8;
    const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
    for (let x = 0; x < width; x++) tiles[height - 1][x] = 1;
    if (kind === "capped" || kind === "uncapped") {
        for (let x = 6; x < width; x++) tiles[6][x] = 1;
        if (kind === "capped") tiles[5][6] = 2;
    } else {
        const n = Number(kind.slice(5));
        for (let i = 0; i < n; i++) tiles[height - 2][6 + i] = 2;
    }
    const platforms = [];
    const hazards = new Hazards();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (tiles[y][x] === 1) {
                platforms.push({ x: x * TS, y: y * TS, width: TS, height: TS });
            } else if (tiles[y][x] === 2) {
                hazards.addSpike(x * TS, y * TS);
            }
        }
    }
    return { platforms, hazards };
}

// One trial: run right along the standing row (row 6), jump once when
// grounded past takeoffX. Mirrors main.js update() ordering exactly.
function trial(fixture, dt, startX, takeoffX, goalFn) {
    const physics = new Physics();
    const p = new Player(startX, 6 * TS, 200, 350);
    p.grounded = true;
    p.vx = 200;
    let jumped = false;
    for (let i = 0; i < Math.ceil(3 / dt); i++) {
        if (!jumped && p.grounded && p.x >= takeoffX) {
            p.jump();
            jumped = true;
        }
        p.update(dt, false, true);
        physics.applyGravity(p, dt);
        physics.resolveCollisions(
            p,
            physics.checkCollisions(p, fixture.platforms)
        );
        if (fixture.hazards.checkPlayerSpikes(p)) return "died";
        if (goalFn(p)) return "crossed";
    }
    return "timeout";
}

// Sweep takeoff columns along the run-up and common frame rates. Returns the
// number of trials that reached the goal alive.
function crossings(kind, goalFn) {
    const fixture = buildFixture(kind);
    let crossed = 0;
    for (const dt of [1 / 60, 1 / 90, 1 / 120, 1 / 240]) {
        for (let takeoffX = 128; takeoffX <= 190; takeoffX += 2) {
            if (trial(fixture, dt, 100, takeoffX, goalFn) === "crossed") {
                crossed++;
            }
        }
    }
    return crossed;
}

const riserGoal = p =>
    p.grounded && Math.abs(p.y - 5 * TS) < 1 && p.x >= 7 * TS;
const flatGoal = x => p => p.grounded && p.x >= x;

test("no takeoff or frame rate crosses a spike-capped riser (C1)", () => {
    // The BFS step-up check must treat this as wall height: if these ever
    // start crossing, the BFS rule needs re-deriving, not this test.
    expect(crossings("capped", riserGoal)).toBe(0);
    // Control: the identical grid minus the spike is a plain one-tile climb.
    expect(crossings("uncapped", riserGoal)).toBeGreaterThan(0);
});

test("surface spike strips cross at ≤2 wide and never at 3 (S1)", () => {
    expect(crossings("strip1", flatGoal(8 * TS))).toBeGreaterThan(0);
    expect(crossings("strip2", flatGoal(9 * TS))).toBeGreaterThan(0);
    expect(crossings("strip3", flatGoal(10 * TS))).toBe(0);
});
