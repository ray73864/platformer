// Integration seam: Level-generated coins -> Collectibles -> score.
//
// Unit tests already pin Collectibles' scoring rules and AABB conventions on
// hand-added coins. These tests drive collection through the Collectibles
// instance a REAL Level wires up (level.getCollectibles()) over the coins the
// Level actually generated, using real Player entities as the colliding rect.
// They fail if Level stops routing its generated coins through its exposed
// Collectibles, if coin placement breaks its reachable-tile guarantee, or if
// two Level instances ever share coin arrays or score state.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { Player } from "../../js/player.js";

const TILE = 32;
const PLAYER_SPEED = 200; // Mirrors main.js constants used by startLevel()
const JUMP_FORCE = 350;
const COIN_POINTS = 10;

// A Player placed at a coin's exact origin overlaps it strictly (player is
// 32x32, coin 16x16), and cannot reach an adjacent tile's coin because the
// strict </> comparisons reject the flush-edge case at the 32px tile pitch.
function collectCoin(level, player, coin) {
    player.x = coin.x;
    player.y = coin.y;
    return level.getCollectibles().checkCollection(player);
}

test("every coin a Level generates sits on a reachable tile", () => {
    const level = new Level(1, TILE);
    const coins = level.getCoins();
    expect(coins.length).toBeGreaterThanOrEqual(5);

    // extractCoins places coins only on tiles computeReachable verified from
    // the spawn point; the pixel-space coins must map back onto that set.
    for (const coin of coins) {
        const key = (coin.y / TILE) * level.width + (coin.x / TILE);
        expect(level.reachableTiles.has(key)).toBe(true);
    }
});

test("a real Player collecting Level coins scores exactly 10 per coin and can clear the level", () => {
    const level = new Level(1, TILE);
    const collectibles = level.getCollectibles();
    const coins = level.getCoins();

    // The renderer (level.coins) and the bookkeeping must see the same coin
    // objects, so collected flags propagate to what gets drawn.
    expect(level.coins).toBe(collectibles.getCoins());

    const player = new Player(0, 0, PLAYER_SPEED, JUMP_FORCE);
    coins.forEach((coin, i) => {
        expect(collectCoin(level, player, coin)).toBe(1);
        expect(collectibles.getScore()).toBe((i + 1) * COIN_POINTS);
    });

    // Completion: nothing left to collect.
    expect(collectibles.getUncollectedCoins()).toHaveLength(0);
    expect(collectibles.getScore()).toBe(coins.length * COIN_POINTS);

    // Re-walking every collected coin's position never scores twice.
    for (const coin of coins) {
        expect(collectCoin(level, player, coin)).toBe(0);
    }
    expect(collectibles.getScore()).toBe(coins.length * COIN_POINTS);
});

test("two Level instances keep independent coins and score", () => {
    const levelA = new Level(1, TILE);
    const levelB = new Level(1, TILE);

    // Distinct bookkeeping objects over distinct coin arrays: loadCoins must
    // not adopt a shared/module-level array between generations.
    expect(levelA.getCollectibles()).not.toBe(levelB.getCollectibles());
    expect(levelA.getCoins()).not.toBe(levelB.getCoins());

    const player = new Player(0, 0, PLAYER_SPEED, JUMP_FORCE);
    for (const coin of levelA.getCoins()) {
        collectCoin(levelA, player, coin);
    }

    expect(levelA.getCollectibles().getScore()).toBe(
        levelA.getCoins().length * COIN_POINTS
    );
    // Draining level A leaves level B untouched.
    expect(levelB.getCollectibles().getScore()).toBe(0);
    expect(levelB.getCollectibles().getUncollectedCoins()).toHaveLength(
        levelB.getCoins().length
    );
});
