// Bombardier cannonballs (player request 2026-11-04): pure-state ballistics
// contract. These tests pin determinism (identical inputs replay identical
// trajectories — no rng anywhere in the simulation), terrain death with
// impact events, player-contact lethality, spike teeth NOT stopping a ball,
// off-map despawn, and the horizontal-speed fairness cap (a ball must always
// lose to a walking player). Visual dust lives in main.js/particles.js and
// is deliberately OUT of scope here.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
    ProjectileManager, ballisticLaunch,
    PROJ_MAX_VX, PROJ_GRAVITY, PROJ_RADIUS, PROJECTILE_TERMINAL_VY
} from "../../js/projectiles.js";

const T = 32;

// Open field of `cols` x `rows` tiles with extra solids at the given
// [col, row] pairs (same adapter shape Level builds over its grid).
function makeTerrain(cols = 40, rows = 12, solids = []) {
    const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const [c, r] of solids) tiles[r][c] = 1;
    return {
        tileSize: T, width: cols, height: rows,
        isSolidPx(px, py) {
            const c = Math.floor(px / T), r = Math.floor(py / T);
            if (c < 0 || c >= cols) return true;
            if (r < 0 || r >= rows) return false;
            return tiles[r][c] === 1;
        },
        tiles
    };
}

function fakePlayer(x, y) {
    return { x, y, width: 32, height: 48, vy: 0, prevY: y };
}

test("ballisticLaunch is pure and speed-capped across the whole aim space", () => {
    // Same inputs -> bitwise-same outputs (deterministic replay foundation).
    for (const [x0, y0, x1, y1] of [[0, 0, 160, 0], [500, 300, 120, 90],
        [0, 0, -256, 40], [10, 10, 11, 11], [0, 0, 0, -100]]) {
        expect(ballisticLaunch(x0, y0, x1, y1))
            .toEqual(ballisticLaunch(x0, y0, x1, y1));
    }
    // Horizontal component NEVER exceeds the cap (fairness: player runs at
    // 200 px/s, so <= 150 means walking away always outruns a shot).
    for (let dx = -400; dx <= 400; dx += 13) {
        for (let dy = -200; dy <= 200; dy += 17) {
            const v = ballisticLaunch(100, 200, 100 + dx, 200 + dy);
            expect(Math.abs(v.vx)).toBeLessThanOrEqual(PROJ_MAX_VX + 1e-9);
        }
    }
    // Long shots hit the cap exactly (the arc stretches, never the speed).
    expect(ballisticLaunch(0, 0, 300, 0).vx).toBeCloseTo(PROJ_MAX_VX);
    expect(ballisticLaunch(0, 0, -300, 0).vx).toBeCloseTo(-PROJ_MAX_VX);
    // Flat long lob RISES first: vy at launch is strongly negative (the arc
    // family is lobbbed, not laser-flat).
    expect(ballisticLaunch(0, 0, 160, 0).vy).toBeLessThan(-150);
    // Gravity constant sanity: a launched ball's apex sits ABOVE the chord.
    expect(PROJ_GRAVITY).toBeGreaterThan(0);
});

test("trajectories replay identically: same spawn + steps twice", () => {
    const run = () => {
        const mgr = new ProjectileManager(makeTerrain());
        const v = ballisticLaunch(100, 200, 260, 200);
        mgr.spawn(100, 200, v.vx, v.vy, null);
        const trace = [];
        for (let f = 0; f < 120; f++) {
            mgr.updateAll(1 / 60, null);
            const p = mgr.list[0];
            trace.push(p ? [p.x.toFixed(6), p.y.toFixed(6)] : 'dead');
        }
        return trace;
    };
    expect(run()).toEqual(run());
});

test("a ball dies on solid terrain and reports the impact point", () => {
    // Wall at column 6, rows 4..7. Fire horizontally into it from column 4
    // (short hop so gravity has not dragged the ball out of the wall band).
    const terrain = makeTerrain(40, 12,
        Array.from({ length: 4 }, (_, i) => [6, 4 + i]));
    const mgr = new ProjectileManager(terrain);
    mgr.spawn(4 * T, 5 * T, 150, -20, null);
    let impacts = [];
    for (let f = 0; f < 120; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        impacts.push(...ev.impacts);
        if (impacts.length) break;
    }
    expect(impacts.length).toBe(1);
    expect(impacts[0].x).toBeGreaterThanOrEqual(6 * T);
    expect(mgr.list.length).toBe(0); // reaped
});

test("spike teeth never stop a ball (type-2 cells are not solids)", () => {
    const terrain = makeTerrain(40, 12);
    terrain.tiles[5][6] = 2; // spike tile directly in the flight path
    const mgr = new ProjectileManager(terrain);
    mgr.spawn(5 * T, 5 * T, 150, 0, null);
    let blocked = false;
    for (let f = 0; f < 30; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        if (ev.impacts.length) blocked = true;
    }
    expect(blocked).toBe(false);
});

test("a ball touching the player reports hitPlayer once and dies", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const player = fakePlayer(200, 180);
    mgr.spawn(190, 185, 60, 0, null); // just short of the box, closing
    let hit = false;
    for (let f = 0; f < 30 && !hit; f++) hit = mgr.updateAll(1 / 60, player).hitPlayer;
    expect(hit).toBe(true);
    expect(mgr.list.length).toBe(0);
    // Next frame nothing left to hit.
    expect(mgr.updateAll(1 / 60, player).hitPlayer).toBe(false);
});

test("balls despawn below the map instead of living forever", () => {
    const mgr = new ProjectileManager(makeTerrain(40, 12));
    mgr.spawn(200, 11 * T, 0, 300, null); // straight down out of the world
    let alive = true;
    for (let f = 0; f < 300 && alive; f++) {
        mgr.updateAll(1 / 60, null);
        alive = mgr.list.length > 0;
    }
    expect(alive).toBe(false);
});

test("map edges block: a shot leaving sideways dies at the border", () => {
    const mgr = new ProjectileManager(makeTerrain(10, 12));
    mgr.spawn(9 * T, 5 * T, 150, 0, null); // heading out of a 10-col map
    let died = false;
    for (let f = 0; f < 60 && !died; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        died = ev.impacts.length > 0 || mgr.list.length === 0;
    }
    expect(died).toBe(true);
});

test("fired events drain exactly once per updateAll", () => {
    const mgr = new ProjectileManager(makeTerrain());
    mgr.spawn(100, 100, 0, -10, null);
    mgr.spawn(120, 100, 0, -10, null);
    expect(mgr.updateAll(1 / 60, null).fired).toBe(2);
    expect(mgr.updateAll(1 / 60, null).fired).toBe(0);
});

test("pause safety: dt=0 freezes everything (motion is purely dt-driven)", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const v = ballisticLaunch(100, 200, 260, 200);
    mgr.spawn(100, 200, v.vx, v.vy, null);
    const before = JSON.stringify(mgr.list.map(p => [p.x, p.y, p.vx, p.vy]));
    for (let i = 0; i < 30; i++) mgr.updateAll(0, fakePlayer(500, 500));
    expect(JSON.stringify(mgr.list.map(p => [p.x, p.y, p.vx, p.vy])))
        .toBe(before);
});

test("NO RNG EVER in the bombardier simulation sources (grep gate)", () => {
    // The projectile AND enemy state machines must be pure: replays and the
    // playbot depend on it. Particle visuals (Math.random) live elsewhere.
    // Comments are stripped first — the headers MENTION Math.random to
    // document where it is NOT allowed.
    const stripComments = src => src
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const rel of ["../../js/projectiles.js", "../../js/enemies.js"]) {
        const src = stripComments(
            readFileSync(new URL(rel, import.meta.url), "utf8"));
        expect(src.includes("Math.random")).toBe(false);
    }
});

test("PROJ constants honour the fairness contract", () => {
    expect(PROJ_MAX_VX).toBeLessThan(200); // player run speed (main.js)
    expect(PROJ_RADIUS).toBeGreaterThan(0);
    expect(PROJ_RADIUS).toBeLessThan(T / 2);
});

// --- Review M1 regression pins (2026-11-04) ---------------------------------
// Uncapped gravity reached vy ~1092 px/s in the reviewer's probe: at the
// main.js dt cap of 0.05 s that is a 55 px step — clean through a 1-tile
// floor, and a position-sampled hitPlayer could even kill someone
// sheltering UNDER that floor. PROJECTILE_TERMINAL_VY = 600 keeps every
// vertical step under one tile (600 * 0.05 = 30 < 32). These two tests pin
// the whole bug class: the exact parabola below terminal, and zero floor
// crossings at the worst legal frame size.

test("M1 pin: exact g*dt^2 parabola while unclamped; vy never exceeds terminal", () => {
    const dt = 1 / 60;
    // Tall open shaft: the fall runs long enough to REACH terminal, so the
    // test sees both regimes (pure parabola, then the clamp holding).
    const mgr = new ProjectileManager(makeTerrain(40, 60));
    const p = mgr.spawn(200, 8, 0, 0, null);
    let yPrev = p.y, dyPrev = null;
    let maxVy = -Infinity, sawTerminal = false;
    for (let f = 0; f < 500 && mgr.list.length; f++) {
        mgr.updateAll(dt, null);
        if (!mgr.list.length) break;
        expect(p.vy).toBeLessThanOrEqual(PROJECTILE_TERMINAL_VY + 1e-9);
        const dy = p.y - yPrev;
        if (dyPrev !== null && p.vy < PROJECTILE_TERMINAL_VY - 1e-9) {
            // Constant second difference == g*dt^2 EXACTLY while unclamped
            // (discrete solution of free fall; any integration-order slip
            // or stray damping breaks this identity immediately).
            expect(dy - dyPrev).toBeCloseTo(PROJ_GRAVITY * dt * dt, 10);
        }
        yPrev = p.y;
        dyPrev = dy;
        maxVy = Math.max(maxVy, p.vy);
        if (p.vy === PROJECTILE_TERMINAL_VY) sawTerminal = true;
    }
    // Non-vacuous: this fall actually hit the clamp and rode it exactly.
    expect(sawTerminal).toBe(true);
    expect(maxVy).toBe(PROJECTILE_TERMINAL_VY);
});

test("M1 pin: dt-cap 0.05 — a lobbed ball always IMPACTS a full-width 1-tile floor, never tunnels (rows 6..20)", () => {
    const dt = 0.05; // main.js's dt cap: the worst legal frame
    const cols = 30, rows = 24;
    for (let floorRow = 6; floorRow <= 20; floorRow++) {
        const terrain = makeTerrain(cols, rows,
            Array.from({ length: cols }, (_, c) => [c, floorRow]));
        const top = floorRow * T, bottom = (floorRow + 1) * T;
        // Gentle lob from row 4 drifting right; far floors receive the ball
        // at the worst-case accumulated (terminal) fall speed.
        const shoot = player => {
            const mgr = new ProjectileManager(terrain);
            mgr.spawn(2 * T, 4 * T + 16, PROJ_MAX_VX, -120, null);
            const out = { impacts: [], hit: false, crossed: false };
            for (let f = 0; f < 200 && mgr.list.length; f++) {
                const ev = mgr.updateAll(dt, player);
                out.impacts.push(...ev.impacts);
                out.hit = out.hit || ev.hitPlayer;
                const p = mgr.list[0];
                // A live centre standing BELOW the floor's bottom edge is a
                // PASS -> floor-interior -> below segment crossing: exactly
                // what a sub-tile step makes geometrically impossible.
                if (p && p.y > bottom) out.crossed = true;
            }
            return out;
        };
        const dry = shoot(null);
        expect(dry.crossed).toBe(false);
        expect(dry.impacts.length).toBe(1);
        expect(dry.impacts[0].y).toBeGreaterThanOrEqual(top);
        expect(dry.impacts[0].y).toBeLessThan(bottom);
        // Shelter check: re-run with a player crouched directly UNDER the
        // impact column — the ball must die on the deck, never reach them.
        const wet = shoot(fakePlayer(dry.impacts[0].x - 16, (floorRow + 2) * T));
        expect(wet.hit).toBe(false);
        expect(wet.impacts.length).toBe(1);
    }
});

test("M1 pin: terminal-speed entry into a 1-tile floor impacts within two steps (dt=0.05)", () => {
    const dt = 0.05;
    for (let floorRow = 6; floorRow <= 20; floorRow++) {
        // Entry just above the tile top, mid-tile-height, and one pixel shy
        // of a full tile above: the tightest approaches a clamped ball can
        // present to the point sample.
        for (const startAbove of [2, 18, 31]) {
            const terrain = makeTerrain(30, 24,
                Array.from({ length: 30 }, (_, c) => [c, floorRow]));
            const mgr = new ProjectileManager(terrain);
            mgr.spawn(10 * T, floorRow * T - startAbove, 0,
                PROJECTILE_TERMINAL_VY, null);
            let impacts = [];
            for (let f = 0; f < 2 && !impacts.length; f++) {
                impacts.push(...mgr.updateAll(dt, null).impacts);
            }
            expect(impacts.length).toBe(1);
            expect(impacts[0].y).toBeGreaterThanOrEqual(floorRow * T);
            expect(impacts[0].y).toBeLessThan((floorRow + 1) * T);
        }
    }
});

// --- Review n6 pin (2026-11-04) ---------------------------------------------

test("n6 pin: fire sfx counts visible shots only — a wall-choked spawn is silent", () => {
    const terrain = makeTerrain(40, 12, [[5, 5]]);
    const mgr = new ProjectileManager(terrain);
    // Muzzle pressed into rock: the ball dies inside its spawn step.
    mgr.spawn(5 * T + 8, 5 * T + 8, 10, 0, null);
    const ev = mgr.updateAll(1 / 60, null);
    expect(ev.impacts.length).toBe(1); // died unseen, in the wall
    expect(ev.fired).toBe(0);          // ...and audio plays NOTHING for it
    // An open-air shot still earns exactly one thump, drained once.
    mgr.spawn(100, 100, 0, -10, null);
    expect(mgr.updateAll(1 / 60, null).fired).toBe(1);
    expect(mgr.updateAll(1 / 60, null).fired).toBe(0);
});
