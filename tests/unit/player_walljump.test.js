// M1 wall jumps (capability program): slide conditions, kick vector,
// directional lockout, alternation rule, buffered-press interaction, and a
// monotonicity property pin against a frozen copy of the pre-capability
// (e2c6b2a) player policy. Constants live in player.js — nothing here
// magic-numbers the tuning values except where the value IS the contract.
import { test, expect } from "bun:test";
import {
    Player,
    WALL_SLIDE_MAX_FALL,
    WALL_JUMP_PUSH,
    WALL_INPUT_LOCK,
    wallContactSide
} from "../../js/player.js";
import { Physics } from "../../js/physics.js";
import { Entity } from "../../js/entities.js";

const DT = 1 / 60;
const SPEED = 200;
const JUMP_FORCE = 350;

function airPlayer(x = 100, y = 100) {
    const p = new Player(x, y, SPEED, JUMP_FORCE);
    p.grounded = false;
    return p;
}

// Arm the air-intent latch honestly: one airborne frame with no keys, then
// press the direction (fresh airborne decision, per the engagement rule).
function armIntent(p, dir) {
    p.update(DT, false, false);
    p.update(DT, dir === -1, dir === 1);
}

// --- constants ---------------------------------------------------------------

test("M1 constants are exported with the adjudicated values", () => {
    expect(WALL_SLIDE_MAX_FALL).toBe(120);
    expect(WALL_JUMP_PUSH).toBe(240);
    expect(WALL_INPUT_LOCK).toBe(0.15);
});

// --- probe geometry ------------------------------------------------------------

test("wallContactSide detects left/right terrain contact", () => {
    const plat = { x: 64, y: 0, width: 32, height: 320 };
    const p = airPlayer(120, 100); // clear of both faces
    expect(wallContactSide(p, [plat])).toBe(0);
    p.x = 32;  // flush against the wall's LEFT face: wall sits on the right
    expect(wallContactSide(p, [plat])).toBe(1);
    p.x = 96;  // flush against the RIGHT face: wall sits on the left
    expect(wallContactSide(p, [plat])).toBe(-1);
});

test("wallContactSide insets 4px top/bottom so lips do not read as walls", () => {
    const p = airPlayer(100, 100);
    // Horizontal span reaches the 1px sliver, vertical span stops short of
    // the probe band (which starts 4px below the head).
    const lip = { x: 90, y: 92, width: 10, height: 10 };
    expect(wallContactSide(p, [lip])).toBe(0);
    lip.height = 20; // now reaches into the probe band
    expect(wallContactSide(p, [lip])).toBe(-1);
});

test("wallContactSide tie-break prefers the wall being moved toward", () => {
    const p = airPlayer(96, 100);
    const left = { x: 64, y: 0, width: 32, height: 320 };
    const right = { x: 128, y: 0, width: 32, height: 320 };
    p.vx = 100;
    expect(wallContactSide(p, [left, right])).toBe(1);
    p.vx = -100;
    expect(wallContactSide(p, [left, right])).toBe(-1);
});

// --- slide conditions ----------------------------------------------------------

test("slide caps fall at WALL_SLIDE_MAX_FALL with all four conditions met", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.vy = 300;
    armIntent(p, -1); // airborne fresh press INTO the contacted wall
    p.vy = 300;       // armIntent's frames may have braked; re-arm the fall
    p.update(DT, true, false);
    expect(p.vy).toBe(WALL_SLIDE_MAX_FALL);
    expect(p.sliding).toBe(-1);
});

test("no slide while grounded", () => {
    const p = new Player(100, 100, SPEED, JUMP_FORCE);
    p.grounded = true;
    p.setWallContact(-1);
    p.vy = 300;
    p.update(DT, true, false);
    expect(p.vy).toBe(300);
    expect(p.sliding).toBe(0);
});

test("no slide while rising", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    armIntent(p, -1);
    p.vy = -50;
    p.update(DT, true, false);
    expect(p.vy).toBe(-50);
    expect(p.sliding).toBe(0);
});

test("no slide without pressing INTO the contacted wall", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.update(DT, false, false);
    p.update(DT, false, true); // fresh airborne press AWAY from the wall
    p.vy = 300;
    p.update(DT, false, true); // still holding away
    expect(p.vy).toBe(300);
    expect(p.sliding).toBe(0);
});

test("no slide without wall contact", () => {
    const p = airPlayer();
    p.setWallContact(0);
    armIntent(p, -1);
    p.vy = 300;
    p.update(DT, true, false);
    expect(p.vy).toBe(300);
    expect(p.sliding).toBe(0);
});

test("slide does not engage for a direction key held since the ground", () => {
    // Monotonicity engagement rule: legacy hug arcs (key held from a
    // grounded run across the takeoff frame) keep their ballistic fall.
    const p = new Player(100, 100, SPEED, JUMP_FORCE);
    p.grounded = true;
    p.setWallContact(0);
    p.update(DT, true, false);          // grounded frame pressing left
    p.grounded = false;                 // walked off the ledge pressing on
    p.setWallContact(-1);
    p.vy = 300;
    p.update(DT, true, false);
    expect(p.sliding).toBe(0);
    expect(p.vy).toBe(300);
    p.update(DT, true, false);
    expect(p.sliding).toBe(0);
});

test("slide engages on a fresh airborne press and disarms on release", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.update(DT, false, false);         // airborne, no keys
    p.update(DT, true, false);          // fresh press -> intent latched
    p.vy = 300;
    p.update(DT, true, false);
    expect(p.sliding).toBe(-1);
    expect(p.vy).toBe(WALL_SLIDE_MAX_FALL);
    p.vy = 300;
    p.update(DT, false, false);         // released: intent drops
    expect(p.sliding).toBe(0);
    expect(p.vy).toBe(300);
});

test("walk mode is irrelevant to the airborne slide cap", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    armIntent(p, -1);
    p.vy = 300;
    p.update(DT, true, false, { walk: true });
    expect(p.vy).toBe(WALL_SLIDE_MAX_FALL);
    expect(p.vx).toBe(-SPEED); // walk caps ground speed only, never arcs
});

// --- wall jump vector ------------------------------------------------------------

test("wall jump launches exact vector away from the left wall", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.vy = 200;
    p.pressJump();
    expect(p.vx).toBe(WALL_JUMP_PUSH);
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.grounded).toBe(false);
    expect(p.wallLockTimer).toBe(WALL_INPUT_LOCK);
    expect(p.wallLockDir).toBe(-1);
    expect(p.lastKickSide).toBe(-1);
    expect(p.jumpCutAvailable).toBe(true);
});

test("wall jump launches exact vector away from the right wall", () => {
    const p = airPlayer();
    p.setWallContact(1);
    p.vy = 200;
    p.pressJump();
    expect(p.vx).toBe(-WALL_JUMP_PUSH);
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.wallLockDir).toBe(1);
});

test("wall jump kills forgiveness windows (no coyote re-fire, no buffer)", () => {
    const p = airPlayer();
    p.coyoteTimer = 0.5; // artificially large to observe the clear
    p.setWallContact(-1);
    p.pressJump();
    expect(p.coyoteTimer).toBe(0);
    expect(p.jumpBufferTimer).toBe(0);
});

// --- no wall jump while grounded / coyote ----------------------------------------

test("grounded press next to a wall is a normal jump (no push, no lock)", () => {
    const p = new Player(100, 100, SPEED, JUMP_FORCE);
    p.grounded = true;
    p.setWallContact(-1);
    p.pressJump();
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.vx).toBe(0);
    expect(p.wallLockTimer).toBe(0);
    expect(p.lastKickSide).toBe(0);
});

test("coyote launch next to a wall stays a normal jump", () => {
    const p = airPlayer();
    p.coyoteTimer = 0.05;
    p.vy = 50; // inside the guarded window
    p.setWallContact(-1);
    p.pressJump();
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.vx).toBe(0);
    expect(p.wallLockTimer).toBe(0);
    expect(p.lastKickSide).toBe(0);
});

// --- buffered-press interaction ----------------------------------------------------

test("airborne press without contact buffers and fires on landing (legacy)", () => {
    const p = airPlayer();
    p.setWallContact(0);
    p.pressJump();
    expect(p.jumpBufferTimer).toBeGreaterThan(0);
    expect(p.vy).toBe(0);
    p.grounded = true; // resolver-style landing next to a wall
    p.setWallContact(-1);
    p.update(DT, false, false);
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.vx).toBe(0); // buffered consumption never converts to a kick
    expect(p.jumpBufferTimer).toBe(0);
});

test("wall-adjacent airborne press becomes a kick, not a buffer", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump();
    expect(p.jumpBufferTimer).toBe(0);
    expect(p.vx).toBe(WALL_JUMP_PUSH);
});

// --- lockout + alternation -----------------------------------------------------------

test("lockout commits: holding toward the abandoned wall cannot cancel the push", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump(); // off the left wall, vx = +PUSH
    p.update(DT, true, false); // panic-hold toward the wall just left
    expect(p.vx).toBe(WALL_JUMP_PUSH); // still flying away at push speed
});

test("lockout permits cross-shaft steering (away key steers normally)", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump();
    p.update(DT, false, true); // steer toward the far wall
    expect(p.vx).toBe(SPEED); // positive: still crossing
});

test("lockout blocks an immediate second kick, even off the opposite face", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump(); // vx = +240
    p.setWallContact(1); // magically on the other face within the window
    p.pressJump();
    expect(p.vx).toBe(WALL_JUMP_PUSH); // NOT reversed to -PUSH
    expect(p.wallLockTimer).toBe(WALL_INPUT_LOCK); // unchanged: no re-arm
    expect(p.jumpBufferTimer).toBeGreaterThan(0); // fell back to buffering
});

test("alternation: same face re-kicks only after ground contact", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump();
    for (let i = 0; i < 12; i++) p.update(DT, false, false); // drain lock
    expect(p.wallLockTimer).toBeLessThanOrEqual(0);
    p.setWallContact(-1); // back on the SAME face, no ground since
    p.pressJump();
    expect(p.vx).not.toBe(WALL_JUMP_PUSH);
    expect(p.jumpBufferTimer).toBeGreaterThan(0);
    for (let i = 0; i < 9; i++) p.update(DT, false, false); // buffer expires mid-air
    expect(p.jumpBufferTimer).toBeLessThanOrEqual(0);
    p.grounded = true; // touch down: faces re-arm
    p.update(DT, false, false);
    p.grounded = false;
    // Leave the coyote window honestly (a press inside it is a normal
    // jump by design): drain the timer airborne, as after a real step-off.
    while (p.coyoteTimer > 0) p.update(DT, false, false);
    p.setWallContact(-1);
    p.pressJump();
    expect(p.vx).toBe(WALL_JUMP_PUSH);
});

test("alternation: opposite face kicks freely once the lock expires", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump();
    for (let i = 0; i < 12; i++) p.update(DT, false, false);
    p.setWallContact(1);
    p.pressJump();
    expect(p.vx).toBe(-WALL_JUMP_PUSH);
    expect(p.lastKickSide).toBe(1);
});

// --- monotonicity property pin vs frozen BASE policy -------------------------
//
// Frozen verbatim from game/js/player.js @ e2c6b2a (pre-capability era):
// the physics-relevant surface of the old Player. Any scripted input set
// WITHOUT wallward air presses must produce BIT-IDENTICAL trajectories
// through the shipped Player + probes and this reference. If a future
// change to player.js/physics conventions breaks this, the sacred gate has
// been violated.
const BASE_STOP_DECEL = 2400;
const BASE_AIR_BRAKE = 900;
const BASE_BUFFER = 0.12;
const BASE_COYOTE = 0.1;
const BASE_COYOTE_MAX_FALL = 120;
const BASE_CUT_FACTOR = 0.45;
const BASE_WALK = 110;
const BASE_LEDGE_SEED = 140;

class BaseRefPlayer extends Entity {
    constructor(x, y, speed, jumpForce) {
        super(x, y, 32, 32);
        this.speed = speed;
        this.jumpForce = jumpForce;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.jumpCutAvailable = false;
    }

    update(dt, left = false, right = false, opts = {}) {
        super.update(dt, left, right);
        const walk = !!opts.walk && this.grounded;
        if (left && !right) {
            this.vx = -(walk ? BASE_WALK : this.speed);
        } else if (right && !left) {
            this.vx = walk ? BASE_WALK : this.speed;
        } else if (this.grounded) {
            const drop = BASE_STOP_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        } else {
            const drop = BASE_AIR_BRAKE * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        }
        if (this.grounded) {
            this.coyoteTimer = BASE_COYOTE;
        } else if (this.coyoteTimer > 0) {
            this.coyoteTimer -= dt;
            if (this.coyoteTimer <= 0 && this.vy >= 0) {
                this.vy = Math.max(this.vy, BASE_LEDGE_SEED);
            }
        }
        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            if (this.grounded) this.jump();
        }
    }

    pressJump() {
        if (this.grounded ||
            (this.coyoteTimer > 0 && this.vy < BASE_COYOTE_MAX_FALL)) {
            this.jump();
        } else {
            this.jumpBufferTimer = BASE_BUFFER;
        }
    }

    jump() {
        this.vy = -this.jumpForce;
        this.grounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.jumpCutAvailable = true;
    }

    releaseJump() {
        if (this.vy < 0 && this.jumpCutAvailable) {
            this.vy *= BASE_CUT_FACTOR;
            this.jumpCutAvailable = false;
        }
    }
}

const T = 32;
function tilesToRects(rows) {
    const rects = [];
    rows.forEach((row, ty) => {
        [...row].forEach((c, tx) => {
            if (c === "#") rects.push({ x: tx * T, y: ty * T, width: T, height: T });
        });
    });
    return rects;
}

// Representative corpus: a shaft map (walls everywhere a legacy arc could
// brush), a chimney, and gapped flats. Scripts NEVER press a direction INTO
// a contacted wall while airborne-falling and never press jump while
// airborne next to a wall — the exact exemption the feature is built around.
const MAP_SHAFT = tilesToRects([
    "............",
    "............",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "############"
]);
const MAP_CHIMNEY = tilesToRects([
    "............",
    "....####....",
    "...#....#...",
    "...#....#...",
    "...#....#...",
    "...#....#...",
    "...#....#...",
    "...#....#...",
    "...#....#...",
    "############"
]);
const MAP_GAPS = tilesToRects([
    "............",
    "............",
    "..###....##.",
    "............",
    "#####.......",
    "........####",
    "............",
    "############"
]);

function runTrajectory(Ctor, platforms, startX, startY, scriptFn, frames) {
    const physics = new Physics(980, 600);
    const p = new Ctor(startX, startY, SPEED, JUMP_FORCE);
    const out = [];
    for (let f = 0; f < frames; f++) {
        const inp = scriptFn(p, f);
        if (inp.press) p.pressJump();
        if (inp.release) p.releaseJump();
        p.prevX = p.x;
        p.prevY = p.y;
        p.update(DT, !!inp.l, !!inp.r, { walk: !!inp.walk });
        physics.applyGravity(p, DT);
        const collisions = physics.checkCollisions(p, platforms);
        physics.resolveCollisions(p, collisions);
        if (p.setWallContact) p.setWallContact(wallContactSide(p, platforms));
        out.push(`${p.x},${p.y},${p.vx},${p.vy},${p.grounded ? 1 : 0}`);
    }
    return out.join(";");
}

// Grounded-only jump policies: presses fire exclusively on grounded frames
// and direction reversals happen ONLY on grounded frames — a mid-air key
// flip next to a wall would be exactly the fresh airborne press the new
// mechanic engages on, which this corpus must never produce. Factories hand
// each engine run its own fresh closure state.
function groundedHopPolicy(dirFn) {
    return () => (p, f) => {
        const dir = dirFn(f);
        return {
            l: dir === -1,
            r: dir === 1,
            press: p.grounded && f % 23 === 0,
            walk: f % 97 === 0
        };
    };
}

function groundedFlipPolicy(dir0) {
    return () => {
        let dir = dir0;
        return (p, f) => {
            if (p.grounded && f % 29 === 0) dir = -dir;
            return {
                l: dir === -1,
                r: dir === 1,
                press: p.grounded && f % 23 === 0
            };
        };
    };
}

const PROPERTY_CASES = [
    ["shaft hold-right hops", MAP_SHAFT, 4 * T, 8 * T, groundedHopPolicy(() => 1)],
    ["shaft grounded-only reversal", MAP_SHAFT, 4 * T, 8 * T, groundedFlipPolicy(1)],
    ["shaft hug-wall hops (key held from ground)", MAP_SHAFT, 3 * T + 4, 8 * T,
        () => (p, f) => ({ l: true, press: p.grounded && f % 23 === 0 })],
    ["chimney drift hops", MAP_CHIMNEY, 4 * T, 6 * T, groundedFlipPolicy(1)],
    ["gaps traverse with coyote presses", MAP_GAPS, 1 * T, 2 * T,
        () => (p, f) => ({ r: true, press: p.grounded && f % 19 === 5 })],
    ["idle fall into shaft", MAP_SHAFT, 5 * T, 0, () => () => ({})]
];

for (const [name, map, sx, sy, policyFactory] of PROPERTY_CASES) {
    test(`monotonicity: ${name} is bit-identical to the frozen base model`, () => {
        const base = runTrajectory(BaseRefPlayer, map, sx, sy, policyFactory(), 420);
        const mod = runTrajectory(Player, map, sx, sy, policyFactory(), 420);
        expect(mod).toBe(base);
    });
}

test("monotonicity guard: corpus really exercises airborne wall contact", () => {
    // Sanity: if the probe never fired anywhere in the corpus the property
    // test above would pass vacuously. Count airborne-contact frames.
    let contactFrames = 0;
    for (const [, map, sx, sy, policyFactory] of PROPERTY_CASES) {
        const physics = new Physics(980, 600);
        const p = new Player(sx, sy, SPEED, JUMP_FORCE);
        const scriptFn = policyFactory();
        for (let f = 0; f < 420; f++) {
            const inp = scriptFn(p, f);
            if (inp.press) p.pressJump();
            p.prevX = p.x; p.prevY = p.y;
            p.update(DT, !!inp.l, !!inp.r, {});
            physics.applyGravity(p, DT);
            physics.resolveCollisions(p, physics.checkCollisions(p, map));
            p.setWallContact(wallContactSide(p, map));
            if (!p.grounded && p.wallSide !== 0) contactFrames++;
        }
    }
    expect(contactFrames).toBeGreaterThan(100);
});
