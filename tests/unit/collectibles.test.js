import { test, expect } from "bun:test";
import { Collectibles } from "../../js/collectibles.js";
import { Level } from "../../js/level.js";

test("Collectibles starts empty with zero score", () => {
    const collectibles = new Collectibles();

    expect(collectibles.coins).toEqual([]);
    expect(collectibles.getScore()).toBe(0);
});

test("Collectibles addCoin creates a 16x16 uncollected coin", () => {
    const collectibles = new Collectibles();

    collectibles.addCoin(64, 96);

    expect(collectibles.coins.length).toBe(1);
    expect(collectibles.coins[0]).toEqual({
        x: 64,
        y: 96,
        width: 16,
        height: 16,
        collected: false
    });
});

test("Collectibles marks coin as collected", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(0, 0);
    collectibles.addCoin(32, 0);

    collectibles.collectCoin(0);

    expect(collectibles.coins[0].collected).toBe(true);
    expect(collectibles.coins[1].collected).toBe(false);
});

test("Collectibles scores 10 points per collected coin", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(0, 0);
    collectibles.addCoin(32, 0);

    collectibles.collectCoin(0);
    collectibles.collectCoin(1);

    expect(collectibles.getScore()).toBe(20); // 2 coins * 10 points
});

test("re-collecting an already collected coin does not score again", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(0, 0);

    collectibles.collectCoin(0);
    collectibles.collectCoin(0);

    expect(collectibles.getScore()).toBe(10);
});

test("collectCoin ignores out-of-range indices", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(0, 0);

    collectibles.collectCoin(-1);
    collectibles.collectCoin(5);

    expect(collectibles.coins[0].collected).toBe(false);
    expect(collectibles.getScore()).toBe(0);
});

test("getUncollectedCoins excludes collected coins", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(0, 0);
    collectibles.addCoin(32, 0);
    collectibles.addCoin(64, 0);

    collectibles.collectCoin(1);

    const remaining = collectibles.getUncollectedCoins();
    expect(remaining.length).toBe(2);
    expect(remaining.every(c => !c.collected)).toBe(true);
});

test("handles collecting every coin in the list", () => {
    const collectibles = new Collectibles();
    for (let i = 0; i < 4; i++) {
        collectibles.addCoin(i * 32, 0);
    }

    for (let i = 0; i < collectibles.coins.length; i++) {
        collectibles.collectCoin(i);
    }

    expect(collectibles.coins.every(c => c.collected)).toBe(true);
    expect(collectibles.getScore()).toBe(40);
    expect(collectibles.getUncollectedCoins().length).toBe(0);
});

test("checkCollection returns count collected and collects all overlapping coins", () => {
    const collectibles = new Collectibles();
    // Two coins overlapping the player, one clear of it.
    collectibles.addCoin(10, 10);
    collectibles.addCoin(20, 20);
    collectibles.addCoin(500, 500);

    const player = { x: 0, y: 0, width: 32, height: 48 };
    const collectedNow = collectibles.checkCollection(player);

    expect(collectedNow).toBe(2);
    expect(collectibles.getScore()).toBe(20);
    expect(collectibles.getUncollectedCoins().length).toBe(1);
});

test("checkCollection returns 0 when nothing overlaps", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(500, 500);

    const player = { x: 0, y: 0, width: 32, height: 48 };

    expect(collectibles.checkCollection(player)).toBe(0);
    expect(collectibles.getScore()).toBe(0);
});

test("checkCollection skips already collected coins", () => {
    const collectibles = new Collectibles();
    collectibles.addCoin(10, 10);

    const player = { x: 0, y: 0, width: 32, height: 48 };

    expect(collectibles.checkCollection(player)).toBe(1);
    // Same overlap again: coin is gone, no double pickup.
    expect(collectibles.checkCollection(player)).toBe(0);
    expect(collectibles.getScore()).toBe(10);
});

test("checkCollection treats touching edges as no overlap", () => {
    const collectibles = new Collectibles();
    // Coin sits immediately right of the player: coin.x === player right edge.
    collectibles.addCoin(32, 0);

    const player = { x: 0, y: 0, width: 32, height: 48 };

    expect(collectibles.checkCollection(player)).toBe(0);
});

test("loadCoins adopts externally generated coins by reference", () => {
    const collectibles = new Collectibles();
    const generated = [
        { x: 0, y: 0, width: 16, height: 16, collected: false },
        { x: 64, y: 0, width: 16, height: 16, collected: false }
    ];

    collectibles.loadCoins(generated);

    expect(collectibles.getCoins()).toBe(generated);
    collectibles.collectCoin(1);
    expect(generated[1].collected).toBe(true);
});

test("meetsPortalRequirement is false when the level has no coins", () => {
    const collectibles = new Collectibles();

    expect(collectibles.meetsPortalRequirement()).toBe(false);
});

test("meetsPortalRequirement is false at 6 of 10 coins", () => {
    const collectibles = new Collectibles();
    for (let i = 0; i < 10; i++) {
        collectibles.addCoin(i * 32, 0);
    }
    for (let i = 0; i < 6; i++) {
        collectibles.collectCoin(i);
    }

    expect(collectibles.meetsPortalRequirement()).toBe(false); // 6/10
});

test("meetsPortalRequirement is true at 7 of 10 coins", () => {
    const collectibles = new Collectibles();
    for (let i = 0; i < 10; i++) {
        collectibles.addCoin(i * 32, 0);
    }
    for (let i = 0; i < 7; i++) {
        collectibles.collectCoin(i);
    }

    expect(collectibles.meetsPortalRequirement()).toBe(true); // 7/10
});

test("meetsPortalRequirement is true at 3 of 3 coins", () => {
    const collectibles = new Collectibles();
    for (let i = 0; i < 3; i++) {
        collectibles.addCoin(i * 32, 0);
    }
    for (let i = 0; i < 3; i++) {
        collectibles.collectCoin(i);
    }

    expect(collectibles.meetsPortalRequirement()).toBe(true); // 3/3
});

test("meetsPortalRequirement is true when collected overshoots total", () => {
    const collectibles = new Collectibles();
    for (let i = 0; i < 3; i++) {
        collectibles.addCoin(i * 32, 0);
    }
    for (let i = 0; i < 3; i++) {
        collectibles.collectCoin(i);
    }
    // Force collected above total: three coins were scored, then the coin
    // list shrank to two from outside the class.
    collectibles.coins.length = 2;

    expect(collectibles.meetsPortalRequirement()).toBe(true);
});

test("Level wires generated coins through its Collectibles instance", () => {
    const level = new Level(1, 32);
    const collectibles = level.getCollectibles();

    expect(collectibles).toBeInstanceOf(Collectibles);
    // getCoins() delegates to the collectibles' list: same array, so Level
    // rendering and collection bookkeeping see the same coin objects.
    expect(level.getCoins()).toBe(collectibles.getCoins());
    expect(level.getCoins().length).toBeGreaterThanOrEqual(5);

    // Collecting through the collectibles flips the flag seen by the level.
    const coin = level.getCoins()[0];
    collectibles.collectCoin(0);
    expect(coin.collected).toBe(true);
    expect(collectibles.getScore()).toBe(10);
});
