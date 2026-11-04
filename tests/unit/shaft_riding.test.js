// Descent stickiness for axis-'v' cabins (the elevator wave): a rider on a
// FALLING cabin must stay seated. The pre-fix kinematics flickered grounded
// every other frame at 60 Hz (gate 2 vetoed the rider because carry keeps
// player.vy ≈ g·dt below the deck's descent speed); the fix is the
// manager-owned `riding` + oneWayRects exception (see movingplatforms.js).
// These frames run EXACTLY main.js's order, attachRider included.
import { test, expect } from "bun:test";
import { MovingPlatformManager } from "../../js/movingplatforms.js";
import { Physics } from "../../js/physics.js";
import { Player } from "../../js/player.js";

const T = 32;

// One frame in main.js's order: decks -> carry rider -> history -> player
// update -> gravity -> terrain resolve -> one-way Y resolve -> attachRider.
function stepFrame(game, dt, input = { left: false, right: false, jump: false }) {
    const { player, physics, statics, manager } = game;
    manager.updateAll(dt);
    if (manager.riding && manager.riding.isUnder(player)) manager.riding.carry(player);
    player.prevX = player.x;
    player.prevY = player.y;
    player.update(dt, input.left, input.right, input.jump);
    physics.applyGravity(player, dt);
    physics.resolveCollisions(player, physics.checkCollisions(player, statics));
    const decks = manager.oneWayRects(player);
    if (decks.length) physics.resolveYCollision(player, decks);
    return manager.attachRider(player);
}

function makeGame(desc, statics = []) {
    return {
        player: new Player(0, 0, 200, 350),
        physics: new Physics(980, 600),
        statics,
        manager: new MovingPlatformManager([desc])
    };
}

// Cabin descriptor spanning rows A..B (flush-stop convention: min = A*T,
// max = B*T), dwelling at both stops, phase 0 so it starts parked at min.
function cabinDesc(A, B, speed = 22, phase = 0) {
    return {
        x: 3 * T, y: A * T, width: 2 * T, height: T, axis: 'v',
        min: A * T, max: B * T, speed, phase, dwell: 0.8, vx: 0, vy: 0
    };
}

// Seat a passive rider on the cabin at its current position.
function seatRider(game) {
    const deck = game.manager.platforms[0];
    game.player.x = deck.x + 16;
    game.player.y = deck.y - game.player.height;
    game.player.prevX = game.player.x;
    game.player.prevY = game.player.y;
    game.player.vy = 0;
}

test("full cycle: rider stays seated through rise, dwell, fall and bottom dwell", () => {
    const game = makeGame(cabinDesc(6, 14));
    seatRider(game);
    const deck = game.manager.platforms[0];
    let frames = 0, lost = 0, sawTop = false, sawBottomAgain = false, leftTop = false;
    // One full period plus slack: rise leg, top dwell, fall leg, bottom dwell.
    const period = 2 * ((deck.max - deck.min) / deck.speed + deck.dwell);
    const dt = 1 / 60;
    for (let t = 0; t < period + 0.5; t += dt) {
        const riding = stepFrame(game, dt);
        frames++;
        if (riding !== deck) lost++;
        // Feet must rest exactly on the cabin top (carry + one-way catch).
        if (Math.abs((game.player.y + game.player.height) - deck.y) > 1.5) lost++;
        if (deck.y <= deck.min + 1) sawTop = true;
        if (sawTop && deck.y > deck.min + 1) leftTop = true;
        if (leftTop && deck.y >= deck.max - 1) sawBottomAgain = true;
    }
    expect(sawTop, "rode to the top stop").toBe(true);
    expect(sawBottomAgain, "rode back to the bottom stop").toBe(true);
    expect(lost, `rider detached (${lost}/${frames} frames)`).toBe(0);
});

for (const dt of [1 / 240, 1 / 60, 0.05]) {
    test(`long descent holds at dt=${dt.toFixed(4)} (no flicker, no drop-through)`, () => {
        const game = makeGame(cabinDesc(4, 16, 22));
        const deck = game.manager.platforms[0];
        // Schedule starts parked at the TOP stop (min): seat the rider during
        // the top dwell, then watch the whole descent leg.
        seatRider(game);
        let airFrames = 0, fellOff = 0, n = 0;
        const leg = (deck.max - deck.min) / deck.speed;
        for (let t = 0; t < deck.dwell + leg - 0.05; t += dt) {
            const riding = stepFrame(game, dt);
            if (t < deck.dwell) continue; // still parked: boarding, not riding
            n++;
            if (riding !== deck) airFrames++;
            if (Math.abs((game.player.y + game.player.height) - deck.y) > 1.5) fellOff++;
        }
        expect(n).toBeGreaterThan(10);
        expect(fellOff, `feet left the cabin top (${fellOff}/${n})`).toBe(0);
        expect(airFrames, `detachments (${airFrames}/${n})`).toBe(0);
    });
}

test("jumping off a descending cabin escapes cleanly", () => {
    const game = makeGame(cabinDesc(4, 16, 22));
    const deck = game.manager.platforms[0];
    seatRider(game);
    // Ride through the top dwell + a slice of the descent leg.
    const leg = (deck.max - deck.min) / deck.speed;
    const warm = deck.dwell + leg * 0.3;
    for (let t = 0; t < warm; t += 1 / 60) stepFrame(game, 1 / 60);
    expect(game.manager.riding, "seated before the jump").toBe(deck);
    // Jump press routes through pressJump() like every real input; the
    // grounded launch drives vy negative inside the next player.update.
    game.player.pressJump();
    stepFrame(game, 1 / 60);
    expect(game.player.vy, "launched upward").toBeLessThan(0);
    // Rider reference cleared once airborne; the falling cabin cannot re-catch
    // (gate 2 stays armed: player.vy < deck.vy while rising).
    let recaught = false;
    for (let i = 0; i < 30; i++) {
        stepFrame(game, 1 / 60);
        if (game.player.vy < 0 && game.manager.riding === deck) recaught = true;
    }
    expect(recaught, "cabin re-caught a jumping rider").toBe(false);
});

test("horizontal decks are untouched by the stickiness exception (dy ≡ 0)", () => {
    const desc = {
        x: 2 * T, y: 8 * T, width: 2 * T, height: T, axis: 'h',
        min: 2 * T, max: 6 * T, speed: 30, phase: 0, dwell: 0.8, vx: 0, vy: 0
    };
    const game = makeGame(desc);
    seatRider(game);
    const deck = game.manager.platforms[0];
    let lost = 0;
    for (let i = 0; i < 600; i++) {
        const riding = stepFrame(game, 1 / 60);
        if (riding !== deck) lost++;
    }
    expect(lost, "h-deck rider detached").toBe(0);
    expect(deck.x, "rider travelled with the deck").toBeGreaterThan(2 * T);
});
