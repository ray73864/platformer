// Integration: the shipped Player + wallContactSide + Physics composed in
// the main.js frame order, exercising the M1 end-to-end claims that unit
// mocks cannot: a 2-cell chimney actually climbs via alternating wall jumps,
// and the adversarial same-wall stick-spam ladder stays starved by the
// alternation rule. Deterministic (fixed dt, no RNG), fast.
import { test, expect } from "bun:test";
import { Player, WALL_SLIDE_MAX_FALL, wallContactSide } from "../../js/player.js";
import { Physics } from "../../js/physics.js";

const T = 32;
const DT = 1 / 60;

function tilesToRects(rows) {
    const rects = [];
    rows.forEach((row, ty) => {
        [...row].forEach((c, tx) => {
            if (c === "#") rects.push({ x: tx * T, y: ty * T, width: T, height: T });
        });
    });
    return rects;
}

const CHIMNEY = tilesToRects([
    "............",
    "....####....",
    "....#..#....",
    "....#..#....",
    "....#..#....",
    "....#..#....",
    "....#..#....",
    "....#..#....",
    "....#..#....",
    "############"
]);
const WIDE_SHAFT = tilesToRects([
    "............",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "..#......#..",
    "############"
]);

function runLoop(platforms, startX, startY, policyFn, frames) {
    const physics = new Physics(980, 600);
    const p = new Player(startX, startY, 200, 350);
    let bestY = startY;
    let kicks = 0;
    for (let f = 0; f < frames; f++) {
        const inp = policyFn(p, f);
        const wasLocked = p.wallLockTimer > 0;
        if (inp.press) p.pressJump();
        if (p.wallLockTimer > 0 && !wasLocked) kicks++;
        p.prevX = p.x;
        p.prevY = p.y;
        p.update(DT, !!inp.l, !!inp.r, {});
        physics.applyGravity(p, DT);
        physics.resolveCollisions(p, physics.checkCollisions(p, platforms));
        p.setWallContact(wallContactSide(p, platforms));
        bestY = Math.min(bestY, p.y);
    }
    return { climbedRows: (startY - bestY) / T, kicks };
}

// Alternating chimney climber: hop toward a wall from the floor, steer
// FRESH toward the far face mid-air (the airborne press arms slide intent),
// kick whenever a not-yet-used face reports contact and the lock expired.
function climberPolicy() {
    return (p) => {
        if (p.grounded) return { press: true, l: false, r: true };
        const towardR = p.wallSide !== 1;
        const fresh = p._airFrames > 2;
        const press = p.wallSide !== 0 && p.wallLockTimer <= 0 &&
            p.wallSide !== p.lastKickSide;
        return {
            press,
            l: towardR ? false : fresh,
            r: towardR ? fresh : false
        };
    };
}

// Adversarial single-face ladder: hug one wall of a wide shaft and spam
// the jump key on every permissive frame.
function spamPolicy() {
    return (p) => {
        if (p.grounded) return { press: true, l: false, r: true };
        const intoLeft = p.wallSide === -1 || (p.wallSide === 0 && p.vx > 0);
        return { press: p.wallSide !== 0, l: !intoLeft, r: intoLeft };
    };
}

test("chimney: alternating wall jumps climb a 2-cell shaft to its cap", () => {
    const r = runLoop(CHIMNEY, 5 * T, 8 * T, climberPolicy(), 600);
    // Floor feet at row 9, cap underside at y=64: ~7 rows of usable height.
    // A full chain reaches the cap (climbed >= 6 rows).
    expect(r.climbedRows).toBeGreaterThanOrEqual(6);
    expect(r.kicks).toBeGreaterThanOrEqual(4);
});

test("ladder starvation: same-face kick spam gains nothing beyond one jump", () => {
    const short = runLoop(WIDE_SHAFT, 3 * T, 8 * T, spamPolicy(), 600);
    const long = runLoop(WIDE_SHAFT, 3 * T, 8 * T, spamPolicy(), 1800);
    // One ground jump apexes just under 2 rows; profit would grow with the
    // frame budget. It must not.
    expect(short.climbedRows).toBeLessThan(2.5);
    expect(long.climbedRows).toBe(short.climbedRows);
    // Occasional legitimate alternate-face bounces may occur; stick-spam
    // chaining (a kick every ~0.3 s forever) must not.
    expect(long.kicks).toBeLessThanOrEqual(6);
});

test("slide terminal velocity: the cap owns the velocity channel", () => {
    // Contract-level pin: whenever the four conditions hold at update()
    // time, vy leaves update() at WALL_SLIDE_MAX_FALL. (How a ground-grind
    // BODY reaches a wall face is the resolver's pre-existing corner
    // business — position-channel pushdowns there long predate M1 and are
    // deliberately untouched.)
    const p = airPlayerInShaft();
    p.setWallContact(-1);
    p.update(DT, false, false);
    p.update(DT, true, false); // fresh airborne press INTO the face
    for (const startV of [WALL_SLIDE_MAX_FALL + 1, 400, 600]) {
        p.vy = startV;
        p.update(DT, true, false);
        expect(p.vy).toBe(WALL_SLIDE_MAX_FALL);
        expect(p.sliding).toBe(-1);
    }
});

function airPlayerInShaft() {
    const p = new Player(5 * T, 4 * T, 200, 350);
    p.grounded = false;
    return p;
}
