import { test, expect } from "bun:test";
import {
    MovingPlatform,
    MovingPlatformManager,
    applyJumpBoost,
    JUMP_BOOST_CAP
} from "../../js/movingplatforms.js";
import { Physics } from "../../js/physics.js";
import { Player } from "../../js/player.js";

const T = 32;
const DT = 1 / 60;

// Synthetic arena mirroring the shipped geometry: two flank columns of solid
// tiles (top row S) around an all-air gap, no floor in the gap. Decks shuttle
// inside the gap exactly like placed ones.
function arena({ gapCols = 3, leftTop = 8, rightTop = 8 } = {}) {
    const width = 12;
    const a = 4, b = 4 + gapCols - 1;
    const rects = [];
    for (let x = 0; x < width; x++) {
        if (x >= a && x <= b) continue;
        const top = x < a ? leftTop : rightTop;
        for (let y = top; y < top + 4; y++) {
            rects.push({ x: x * T, y: y * T, width: T, height: T });
        }
    }
    return { rects, a, b, S: Math.max(leftTop, rightTop) };
}

// One frame EXACTLY in main.js's order: advance decks -> carry rider ->
// capture history -> player update -> gravity -> terrain resolve -> one-way
// deck resolve (Y only) -> ride attachment.
function stepFrame(game, dt, input = { left: false, right: false }) {
    const { player, physics, statics, manager } = game;
    manager.updateAll(dt);
    if (game.riding && game.riding.isUnder(player)) game.riding.carry(player);
    player.prevX = player.x;
    player.prevY = player.y;
    player.update(dt, input.left, input.right);
    physics.applyGravity(player, dt);
    physics.resolveCollisions(player,
        physics.checkCollisions(player, statics));
    const decks = manager.oneWayRects(player);
    if (decks.length) physics.resolveYCollision(player, decks);
    game.riding = manager.supportUnder(player);
}

function makeGame(descriptors, statics) {
    return {
        player: new Player(0, 0, 200, 350),
        physics: new Physics(980, 600),
        statics,
        manager: new MovingPlatformManager(descriptors),
        riding: null
    };
}

function deckDesc(arenaObj, { axis = 'h', speed = 30, phase = 0 } = {}) {
    const { a, b, S } = arenaObj;
    if (axis === 'v') {
        return {
            x: a * T, y: S * T, width: 2 * T, height: T, axis: 'v',
            min: (S - 3) * T, max: S * T, speed, phase, vx: 0, vy: 0
        };
    }
    return {
        x: a * T, y: S * T, width: 2 * T, height: T, axis: 'h',
        min: a * T, max: (b + 1) * T - 2 * T, speed, phase, vx: 0, vy: 0
    };
}

// --- Kinematics -------------------------------------------------------------

test("ping-pong stays inside [min,max] and reverses at both lips", () => {
    const ar = arena();
    const p = new MovingPlatform(deckDesc(ar, { speed: 40, phase: 0.3 }));
    let dirSeen = new Set();
    for (let i = 0; i < 3000; i++) {
        p.update(DT);
        expect(p.x).toBeGreaterThanOrEqual(p.min - 1e-9);
        expect(p.x).toBeLessThanOrEqual(p.max + 1e-9);
        if (p.dx > 1e-9) dirSeen.add(1);
        if (p.dx < -1e-9) dirSeen.add(-1);
    }
    expect([...dirSeen].sort()).toEqual([-1, 1]);
});

test("position is a deterministic function of elapsed time (replay match)", () => {
    const ar = arena();
    const desc = deckDesc(ar, { speed: 33, phase: 0.42 });
    const m1 = new MovingPlatformManager([desc]);
    const m2 = new MovingPlatformManager([{ ...desc }]);
    // Same seed -> fresh managers advanced by the same dt sequence.
    const dts = [DT, DT, 0.03, DT, 0.05, DT, DT, DT];
    const seqA = [], seqB = [];
    for (let round = 0; round < 50; round++) {
        for (const dt of dts) {
            m1.updateAll(dt);
            m2.updateAll(dt);
        }
        seqA.push(m1.platforms[0].x);
        seqB.push(m2.platforms[0].x);
    }
    expect(seqA).toEqual(seqB);
});

test("per-frame dx sums to net displacement (carry bookkeeping)", () => {
    const ar = arena();
    const p = new MovingPlatform(deckDesc(ar, { speed: 37, phase: 0.1 }));
    const x0 = p.x;
    let sum = 0;
    for (let i = 0; i < 500; i++) { p.update(DT); sum += p.dx; }
    expect(sum).toBeCloseTo(p.x - x0, 6);
});

test("start position sits on the schedule, honoring phase", () => {
    const ar = arena();
    const desc = deckDesc(ar, { speed: 30, phase: 0.25 });
    const p = new MovingPlatform(desc);
    expect(p.x).toBeCloseTo(p.positionAt(0), 9);
});

// --- One-way collision semantics ---------------------------------------------

test("rising player passes straight through a deck from below (no bonk)", () => {
    const ar = arena();
    const g = makeGame([deckDesc(ar)], ar.rects);
    const control = makeGame([], ar.rects); // identical world, no deck
    const setup = (game) => {
        game.player.x = ar.a * T + 16;
        game.player.y = (ar.S + 2) * T;
        game.player.vy = -500; // rise 127 px: carries feet past the deck top
    };
    setup(g);
    setup(control);
    let clearedDeck = false;
    for (let i = 0; i < 30 && !clearedDeck; i++) {
        stepFrame(g, DT);
        stepFrame(control, DT);
        expect(g.player.grounded, `frame ${i}`).toBe(false);
        // Same arc as the deckless control while rising through: gravity
        // only, never zeroed by a bonk. (Past the apex it legitimately
        // lands — that's outside this test's window.)
        expect(g.player.y).toBeCloseTo(control.player.y, 9);
        if (g.player.y + g.player.height < g.manager.platforms[0].y) {
            clearedDeck = true; // body fully above the deck top, still flying
        }
    }
    expect(clearedDeck, "rose clean through the deck band").toBe(true);
});

test("horizontal transit at deck level while rising sees no side push", () => {
    const ar = arena();
    const g = makeGame([deckDesc(ar, { speed: 0.0001 })], ar.rects);
    const control = makeGame([], ar.rects);
    const setup = (game) => {
        // Inside the gap span so terrain flanks stay out of it too; the body
        // overlaps the deck band while vy keeps the one-way filter rejecting.
        game.player.x = ar.a * T + 8;
        game.player.y = ar.S * T - 20;
        game.player.prevY = game.player.y;
        game.player.vy = -100;
        game.player.vx = 200;
    };
    setup(g);
    setup(control);
    for (let i = 0; i < 8; i++) {
        stepFrame(g, DT);
        stepFrame(control, DT);
        expect(g.player.x, `frame ${i}`).toBeCloseTo(control.player.x, 9);
        expect(g.riding).toBe(null);
    }
});

test("falling player lands on a mid-sweep deck and is carried with it", () => {
    const ar = arena();
    const g = makeGame([deckDesc(ar, { speed: 30, phase: 0.5 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    // Drop from above the deck's mid-travel position.
    p.x = ar.a * T + 32;
    p.y = (ar.S - 4) * T;
    p.vy = 120;
    let landed = -1;
    for (let i = 0; i < 120 && landed < 0; i++) {
        stepFrame(g, DT);
        if (p.grounded && g.riding === deck) landed = i;
    }
    expect(landed, "landed on the deck").toBeGreaterThanOrEqual(0);
    expect(p.y + p.height).toBeCloseTo(deck.y, 6);
    // No input: the rider glides with the deck, keeping their deck-relative
    // offset (carry applies the frame delta before history capture).
    const rel = p.x - deck.x;
    for (let i = 0; i < 60; i++) {
        stepFrame(g, DT);
        expect(p.x - deck.x, `frame ${i}`).toBeCloseTo(rel, 6);
        expect(p.grounded).toBe(true);
    }
});

test("vertical elevator catches a falling rider but never overtakes a rising one", () => {
    const ar = arena();
    // Catch: deck rising (vy<0), player falling (vy>0) onto it.
    const g1 = makeGame([deckDesc(ar, { axis: 'v', speed: 40, phase: 0 })], ar.rects);
    const elev = g1.manager.platforms[0];
    const p1 = g1.player;
    p1.x = elev.x + 16;
    p1.y = elev.y - 60;
    p1.vy = 100;
    let caught = false;
    for (let i = 0; i < 120 && !caught; i++) {
        stepFrame(g1, DT);
        caught = p1.grounded && g1.riding === elev;
    }
    expect(caught, "falling player caught by rising elevator").toBe(true);

    // No overtake while the player still out-rises the deck: vy < deck vy
    // keeps the one-way filter rejecting the rect. (Once gravity bleeds the
    // rise below the deck's climb speed, catching them is legitimate — same
    // relative-fall rule as landing on any floor.)
    const g2 = makeGame([deckDesc(ar, { axis: 'v', speed: 40, phase: 0.5 })], ar.rects);
    const elev2 = g2.manager.platforms[0];
    const p2 = g2.player;
    p2.x = elev2.x + 16;
    p2.y = elev2.y - 10;
    p2.vy = -300;
    for (let i = 0; i < 8; i++) {
        stepFrame(g2, DT);
        expect(p2.vy).toBeLessThan(elev2.vy - 1e-6); // still out-rising
        expect(g2.riding, `frame ${i}`).toBe(null);
        expect(p2.grounded).toBe(false);
    }
});

test("walking into a flush arriving deck cannot knock the player sideways", () => {
    const ar = arena();
    const g = makeGame([deckDesc(ar, { speed: 30, phase: 0 })], ar.rects);
    const p = g.player;
    // Stand on the left flank at deck-top level and walk right into the gap
    // as the deck arrives: any interaction is either a forgiving land (feet
    // within tolerance) or free fall — never an X-push away from travel.
    p.x = (ar.a - 1) * T;
    p.y = ar.S * T - 32;
    p.grounded = true;
    let pushedBack = false;
    for (let i = 0; i < 90; i++) {
        const xPrev = p.x;
        stepFrame(g, DT, { left: false, right: true });
        if (p.x < xPrev - 1e-9) pushedBack = true;
        if (!Number.isFinite(p.x)) break;
    }
    expect(pushedBack, "deck never shoved the player backwards").toBe(false);
});

test("rider at journey end against a taller flank stays bounded (no jitter/tunnel)", () => {
    // Right flank one row higher than the deck line: a rider parked at the
    // deck's right end face-braces the flank wall every frame the carry
    // pushes — terrain resolves it back within one frame's delta.
    const ar = arena({ gapCols: 3, leftTop: 8, rightTop: 7 });
    const g = makeGame([deckDesc(ar, { speed: 40, phase: 0.5 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    p.x = deck.x + deck.width - 32;
    p.y = deck.y - 32;
    p.vy = 0;
    for (let i = 0; i < 600; i++) stepFrame(g, DT);
    // Never tunnelled into/through the flank mass, never fell out of the
    // world, everything finite.
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(p.x + p.width).toBeLessThanOrEqual((ar.b + 1) * T + 1e-9);
    expect(p.x).toBeGreaterThanOrEqual(ar.a * T - 1e-9);
    expect(p.y).toBeLessThan((ar.S + 4) * T);
});

// --- Jump-off inheritance -----------------------------------------------------

test("applyJumpBoost adds deck velocity additively, capped", () => {    const p = new Player(0, 0, 200, 350);
    applyJumpBoost(p, { vx: 30, vy: 0 });
    expect(p.vx).toBe(30);
    p.vx = 0;
    applyJumpBoost(p, { vx: 500, vy: -500 });
    expect(p.vx).toBe(JUMP_BOOST_CAP);
    expect(p.vy).toBe(-JUMP_BOOST_CAP);
    p.vx = 0; p.vy = 0;
    applyJumpBoost(p, null); // not riding: untouched
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
});

test("jumping off a ridden deck inherits its motion", () => {
    const ar = arena();
    const g = makeGame([deckDesc(ar, { speed: 30, phase: 0.5 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    p.x = ar.a * T + 32;
    p.y = (ar.S - 4) * T;
    p.vy = 120;
    for (let i = 0; i < 120 && g.riding !== deck; i++) stepFrame(g, DT);
    expect(g.riding).toBe(deck);
    // Simulate the launch path: jump() then the boost main.js applies.
    p.jump();
    const vxAfterJump = p.vx;
    applyJumpBoost(p, deck);
    expect(Math.abs(p.vx)).toBeGreaterThanOrEqual(Math.abs(vxAfterJump));
    expect(Math.abs(p.vx - vxAfterJump)).toBeLessThanOrEqual(JUMP_BOOST_CAP + 1e-9);
});

// --- Dwell schedule (deck-bridge wave, required crossings) ---------------------
// The bridge ruling demands a fair boarding window: the deck HOLDS flush at
// each lip for `dwell` seconds. The wave stays closed-form and piecewise —
// determinism preserved — with zero deltas during the holds.

const DWELL = 0.8;

function bridgeDesc(arenaObj, { speed = 30, phase = 0, dwell = DWELL } = {}) {
    return { ...deckDesc(arenaObj, { speed, phase }), dwell };
}

test("dwell wave shape: holds at both bounds, monotone legs, continuous", () => {
    const ar = arena({ gapCols: 6 });
    const p = new MovingPlatform(bridgeDesc(ar, { speed: 40, phase: 0 }));
    const leg = p.traverseSeconds();
    const period = p.periodSeconds();
    expect(leg).toBeCloseTo((p.max - p.min) / 40, 9);
    expect(period).toBeCloseTo(2 * (leg + DWELL), 9);
    // Named sample points across one period (phase 0 starts in the min hold).
    expect(p.positionAt(0)).toBe(p.min);
    expect(p.positionAt(DWELL * 0.5)).toBe(p.min);
    expect(p.positionAt(DWELL + leg * 0.5)).toBeCloseTo(p.min + (p.max - p.min) / 2, 9);
    expect(p.positionAt(DWELL + leg + DWELL * 0.5)).toBe(p.max);
    expect(p.positionAt(2 * DWELL + leg + leg * 0.5))
        .toBeCloseTo(p.max - (p.max - p.min) / 2, 9);
    // Continuity + speed bound everywhere (piecewise-linear, slope <= speed).
    let prev = p.positionAt(0);
    const H = 0.001;
    for (let t = H; t <= period; t += H) {
        const v = p.positionAt(t);
        expect(Math.abs(v - prev)).toBeLessThanOrEqual(40 * H + 1e-9);
        prev = v;
    }
    // Monotone segment signature over one period: hold(+0), rise(+), hold(0),
    // fall(-) — exactly two sign changes plus the two zero plateaus.
    const signs = [];
    for (let t = 0; t < period - H; t += H) {
        const d = Math.sign(p.positionAt(t + H) - p.positionAt(t));
        if (signs[signs.length - 1] !== d) signs.push(d);
    }
    expect(signs).toEqual([0, 1, 0, -1]);
});

test("dwell windows carry zero deltas and set the dwelling flag", () => {
    const ar = arena({ gapCols: 6 });
    const p = new MovingPlatform(bridgeDesc(ar, { speed: 40, phase: 0 }));
    // First hold spans elapsed [0, DWELL): every update inside moves nothing.
    // Stop two frames short of the boundary: float accumulation makes the
    // exact-dwell frame's flag value representation-dependent.
    let sawDwelling = false, sawMoving = false;
    for (let i = 0; i < Math.floor((DWELL - 2 * DT) / DT); i++) {
        p.update(DT);
        expect(Math.abs(p.dx), `hold frame ${i}`).toBeLessThan(1e-9);
        expect(p.dwelling).toBe(true);
        sawDwelling = true;
    }
    expect(sawDwelling).toBe(true);
    // Through a full period: some frames move (dwelling false), and the two
    // holds are detected by isDwellingAt at their nominal centers.
    const leg = p.traverseSeconds();
    expect(p.isDwellingAt(DWELL * 0.5)).toBe(true);
    expect(p.isDwellingAt(DWELL + leg * 0.5)).toBe(false);
    expect(p.isDwellingAt(DWELL + leg + DWELL * 0.5)).toBe(true);
    let movingFrames = 0;
    for (let i = 0; i < Math.floor((DWELL + leg) / DT); i++) {
        p.update(DT);
        if (!p.dwelling && Math.abs(p.dx) > 1e-9) movingFrames++;
        sawMoving = sawMoving || !p.dwelling;
    }
    expect(sawMoving).toBe(true);
    expect(movingFrames).toBeGreaterThan(0);
});

test("rider on a dwelling deck stands still (carry deltas zero)", () => {
    const ar = arena({ gapCols: 6 });
    const g = makeGame([bridgeDesc(ar, { speed: 40, phase: 0 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    // Drop onto the deck while it holds at the left bound.
    p.x = deck.x + 16;
    p.y = deck.y - 32 - 40;
    p.vy = 60;
    let landed = -1;
    for (let i = 0; i < 60 && landed < 0; i++) {
        stepFrame(g, DT);
        if (p.grounded && g.riding === deck) landed = i;
    }
    expect(landed, "landed on the dwelling deck").toBeGreaterThanOrEqual(0);
    const xAt = p.x;
    for (let i = 0; i < 20; i++) {
        stepFrame(g, DT);
        expect(g.riding).toBe(deck);
        expect(Math.abs(p.x - xAt), `parked rider drift ${i}`).toBeLessThan(1e-6);
    }
});

// --- One-way credibility vs the deck's PREVIOUS top (review Minor 1 fix) -------
// Pinned scenario (horizontal-only-wave review): a riser at 240 px/s must catch
// a near-stationary player. The old gate compared the CURRENT (already-risen)
// top, vetoed on the crossing frame whenever the per-frame rise outran the
// feet-to-top distance, and phased through forever after. No v-decks deploy
// yet; this pins the fix ahead of the elevator wave.

test("240 px/s rising deck catches a slow-falling player (prev-top gate)", () => {
    const ar = arena({ gapCols: 3 });
    const desc = {
        x: ar.a * T, y: ar.S * T, width: 2 * T, height: T, axis: 'v',
        min: (ar.S - 6) * T, max: ar.S * T, speed: 240, phase: 0.5, vx: 0, vy: 0
        // phase 0.5 starts the riser at its BOTTOM bound moving up: the
        // rider is caught on the first sweep instead of being hammered down
        // by an opening downward pass (head-hit is correct behaviour, just
        // not the one under test).
    };
    const g = makeGame([desc], ar.rects);
    const elev = g.manager.platforms[0];
    const p = g.player;
    // Hover the rider inside the riser's full stroke with a steady slow
    // descent. The deck sweeps the feet line every period, so a correct
    // one-way gate MUST catch on an upward pass. The old gate compared the
    // CURRENT (already-risen) top, vetoed every crossing frame where the
    // per-frame rise (4 px) outran the feet-to-top distance, and phased
    // through forever after. No v-decks deploy yet; this pins the fix ahead
    // of the elevator wave.
    p.x = elev.x + 16;
    p.y = (ar.S - 4) * T; // feet mid-stroke
    let caught = -1;
    for (let i = 0; i < 900 && caught < 0; i++) {
        p.vy = 30; // pinned slow fall (~0.5 px/frame)
        stepFrame(g, DT);
        if (g.riding === elev && p.grounded) caught = i;
    }
    expect(caught, "riser caught the slow faller").toBeGreaterThanOrEqual(0);
    expect(elev.dy, "deck rose on the catch frame").toBeLessThan(0);
    expect(p.grounded, "grounded on the catch frame").toBe(true);
    expect(Math.abs((p.y + p.height) - elev.y)).toBeLessThan(1.5);
    // Known scope note (NOT pinned): at the stroke apex the gate legitimately
    // releases the rider, and a 240 px/s riser cannot meet a rider already
    // past it — smooth elevator reversals are a carry/glue design question
    // for the future 'axis:v' wave, outside this fix's one-way credibility
    // contract.
});

test("horizontal decks keep prevY === y (behavior provably unchanged)", () => {
    const ar = arena({ gapCols: 6 });
    const p = new MovingPlatform(bridgeDesc(ar, { speed: 37, phase: 0.2 }));
    for (let i = 0; i < 600; i++) {
        p.update(DT);
        expect(p.prevY).toBe(p.y);
        expect(p.dy).toBe(0);
    }
});

// --- Rider safety edge cases (required-crossing fairness) -----------------------

test("walking off a flush lip onto a dwelling deck lands (boarding feel)", () => {
    const ar = arena({ gapCols: 6 });
    // Phase so the deck holds at the LEFT bound first: park it there.
    const g = makeGame([bridgeDesc(ar, { speed: 40, phase: 0 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    p.x = (ar.a - 1) * T;
    p.y = ar.S * T - 32;
    p.grounded = true;
    let boarded = false;
    for (let i = 0; i < Math.floor(DWELL / DT) && !boarded; i++) {
        stepFrame(g, DT, { left: false, right: true });
        boarded = g.riding === deck;
    }
    expect(boarded, "stepped onto the dwelling deck as a landing").toBe(true);
    expect(p.grounded).toBe(true);
});

test("riding into the far flank parks flush; a hop lands on solid ground", () => {
    const ar = arena({ gapCols: 6 });
    const g = makeGame([bridgeDesc(ar, { speed: 40, phase: 0 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    p.x = deck.x + 8;
    p.y = deck.y - 32;
    p.vy = 0;
    // Ride until the deck completes its journey and dwells at max.
    const rideFrames = Math.ceil((DWELL + deck.traverseSeconds()) / DT);
    for (let i = 0; i < rideFrames; i++) stepFrame(g, DT);
    expect(deck.x).toBeCloseTo(deck.max, 6);
    // Flush-seam ruling: WALKING off a deck into a same-height terrain lip
    // is physics.js resolveYCollision rule 2 (level-corner clip) — a wall,
    // not a floor, by design (removing it would let players glide across
    // 1-2 tile gaps everywhere else). Egress is therefore a HOP: press jump
    // from the parked deck and land on the flank.
    let steppedOff = false, hopped = false;
    for (let i = 0; i < 90 && !steppedOff; i++) {
        if (p.grounded && !hopped) {
            // A measured hop (~10 px rise, ~55 px reach): the full jump
            // arc would sail clean off the two-column flank.
            p.vy = -140;
            p.grounded = false;
            hopped = true;
        }
        stepFrame(g, DT, { left: false, right: true });
        steppedOff = p.x >= (ar.b + 1) * T && g.riding === null && p.grounded;
    }
    expect(steppedOff, "hopped from the parked deck onto the far flank")
        .toBe(true);
    expect(Math.abs((p.y + p.height) - ar.S * T)).toBeLessThan(1.5);
});

test("stepping off mid-corridor drops the rider into the void (fair, visible)", () => {
    const ar = arena({ gapCols: 6 });
    const g = makeGame([bridgeDesc(ar, { speed: 40, phase: 0 })], ar.rects);
    const deck = g.manager.platforms[0];
    const p = g.player;
    // Stand on the deck's trailing edge while it dwells at min.
    p.x = deck.x + deck.width - 32;
    p.y = deck.y - 32;
    p.vy = 0;
    stepFrame(g, DT);
    expect(g.riding).toBe(deck);
    // Walk right off the plank before the deck travels: no support -> falls.
    let fell = false;
    for (let i = 0; i < 45; i++) {
        stepFrame(g, DT, { left: false, right: true });
        if (!p.grounded && p.vy > 0 && p.y > deck.y + deck.height) fell = true;
    }
    expect(fell, "left the deck early: falls into the pit").toBe(true);
});
