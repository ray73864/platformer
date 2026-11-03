// Integration: moving decks through the real Game loop. Boots the shipped
// loop on a seeded map that actually places a deck, then drives update(dt)
// directly (the game_loop_elements idiom): scripted ride across a gap with
// no mid-ride input, PAUSED freezing the shuttle schedule, and a retry
// replaying the identical trajectory.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";
import { Level } from "../../js/level.js";

const T = 32;
const DT = 1 / 60;

// Deterministic scan for a (level, seed) whose map hosts at least one deck.
// Roughly half of host-capable maps do, so this lands within a few probes.
function findDeckMap() {
    for (let lvl = 8; lvl <= 30; lvl++) {
        for (let s = 0; s < 200; s++) {
            const seed = (lvl * 7919 + s * 131 + 7) >>> 0;
            const level = new Level(lvl, T, seed);
            if (level.getMovingPlatforms().length > 0) return { lvl, seed };
        }
    }
    throw new Error("no deck-bearing map found in scan range");
}

// A Game published onto the given map: runSeed back-solved from
// main.js's seedFor (runSeed + imul(level, 0x9E3779B1)).
function bootOnMap(lvl, seed) {
    mountFixture();
    const game = new Game();
    game.runSeed = (seed - Math.imul(lvl, 0x9E3779B1)) >>> 0;
    game.currentLevel = lvl;
    game.restartCurrentLevel('menu-screen');
    return game;
}

test("publishLevel mints a live manager from the level's deck descriptors", () => {
    const { lvl, seed } = findDeckMap();
    const game = bootOnMap(lvl, seed);
    expect(game.state).toBe(STATE.PLAYING);
    const descs = game.level.getMovingPlatforms();
    expect(descs.length).toBeGreaterThan(0);
    expect(game.movingPlatforms.platforms.length).toBe(descs.length);
    // Fresh manager: elapsed reset, so the schedule starts at the descriptor
    // phase — retries of this seed replay it exactly.
    for (const p of game.movingPlatforms.platforms) expect(p.elapsed).toBe(0);
    expect(game._riding).toBe(null);
});

test("scripted ride: a passive rider is carried across the gap to the far lip", () => {
    const { lvl, seed } = findDeckMap();
    const game = bootOnMap(lvl, seed);
    // Neutralise unrelated threats: patrols never sweep the gap by
    // validation, but flank patrols near the lips would otherwise make this
    // fixture depend on enemy phase.
    game.enemyManager.clear();
    game.hazards.clear();

    const deck = game.movingPlatforms.platforms[0];
    const desc = game.level.getMovingPlatforms()[0];
    const farLipX = desc.max + desc.width; // right edge of the gap

    // Drop the rider onto wherever the deck currently is, then let the loop
    // run with NO further input: land, ride, arrive.
    game.player.x = deck.x + 16;
    game.player.y = deck.y - 64;
    game.player.prevX = game.player.x;
    game.player.prevY = game.player.y;
    game.player.vy = 0;

    let landed = false, arrived = false;
    // Tolerance covers one frame of travel: discrete sampling straddles the
    // turnaround instead of landing on it exactly.
    for (let i = 0; i < 1200 && !arrived; i++) {
        game.update(DT);
        if (!landed && game._riding === deck) landed = true;
        if (landed && game._riding === deck &&
            deck.x >= deck.max - 1 && game.player.x >= deck.max - 1) {
            arrived = true;
        }
    }
    expect(landed, "rider landed on the deck").toBe(true);
    expect(arrived, "rider carried to the far lip").toBe(true);
    expect(game.state, "ride was survivable").toBe(STATE.PLAYING);
    // Far side reached: the rider's body crosses the gap's right boundary.
    expect(game.player.x + game.player.width).toBeGreaterThan(farLipX - 2 * T);
});

test("PAUSED freezes the deck schedule; resume continues it", () => {
    const { lvl, seed } = findDeckMap();
    const game = bootOnMap(lvl, seed);
    for (let i = 0; i < 30; i++) game.update(DT);
    const before = game.movingPlatforms.platforms.map(p => [p.x, p.y, p.elapsed]);

    game.togglePause();
    expect(game.state).toBe(STATE.PAUSED);
    for (let i = 0; i < 60; i++) game.update(DT);
    const paused = game.movingPlatforms.platforms.map(p => [p.x, p.y, p.elapsed]);
    expect(paused).toEqual(before);

    game.togglePause();
    for (let i = 0; i < 10; i++) game.update(DT);
    const resumed = game.movingPlatforms.platforms.map(p => p.elapsed);
    expect(resumed.every((e, i) => e > before[i][2])).toBe(true);
});

test("retry replays the identical deck trajectory", () => {
    const { lvl, seed } = findDeckMap();
    const game = bootOnMap(lvl, seed);
    const sample = () => {
        const xs = [];
        for (let i = 0; i < 240; i++) {
            game.update(DT);
            if (i % 10 === 0) xs.push(game.movingPlatforms.platforms.map(p => p.x));
        }
        return xs;
    };
    const first = sample();
    // Same shared restart path the death retry uses (GAME_OVER screen here).
    game.restartCurrentLevel('game-over-screen');
    const second = sample();
    expect(second).toEqual(first);
    expect(first.length).toBe(24);
});
