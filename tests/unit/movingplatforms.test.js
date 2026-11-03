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

test("applyJumpBoost adds deck velocity additively, capped", () => {
    const p = new Player(0, 0, 200, 350);
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
