import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";
import { Level } from "../../js/level.js";

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

test("run clock carries over a real portal win into the next level", () => {
    const game = startPlaying();

    // Jump straight to the timer tier (same entry as timer_gate.test.js):
    // publishLevel must switch the clock on for level 5 without touching it.
    game.currentLevel = 5;
    game.startLevel();
    expect(game.timerActive).toBe(true);
    expect(game.timer.timeRemaining).toBe(60);

    // Spend a known amount of the run clock through the real Timer API, so a
    // transition reset to 60 is distinguishable from ordinary ticking.
    game.timer.update(10, false);
    expect(game.timer.getTimeRemaining()).toBeCloseTo(50, 6);

    // Meet the portal's 70% coin gate via the real Collectibles API, then let
    // Game.update's own gate + AABB check fire the win — no markPortalReached
    // shortcut here, so the full Phase 3 win path is under test.
    const coins = game.level.getCoins();
    for (let i = 0; i < coins.length; i++) game.collectibles.collectCoin(i);
    expect(game.collectibles.meetsPortalRequirement()).toBe(true);

    const portal = game.level.getPortal();
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.update(0.016);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    // Snapshot after the winning tick: that tick legitimately spent its 0.016.
    const remainingAtWin = game.timer.getTimeRemaining();
    expect(remainingAtWin).toBeLessThan(50);

    let ticks = 0;
    while (game.state === STATE.LEVEL_COMPLETE && ticks < 100) {
        game.update(0.1);
        ticks++;
    }
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.currentLevel).toBe(6);

    // Carryover: the transition did not reset the clock to 60 and did not
    // spend any of it — LEVEL_COMPLETE ticks never touch the Timer.
    expect(game.timer.getTimeRemaining()).toBeCloseTo(remainingAtWin, 6);
    expect(game.timer.timeRemaining).toBeLessThan(game.timer.baseTime);

    // The new level's clock keeps running (timerActive stays on for tier 5+)
    // and the HUD shows the carried value, not a fresh minute.
    game.update(0.016);
    expect(game.timer.getTimeRemaining()).toBeLessThan(remainingAtWin);
    expect(document.getElementById('timer-display').textContent).toBe('Time: 0:49');
});

test("timer HUD visibility follows the difficulty tier", () => {
    const game = startPlaying();
    const timerEl = document.getElementById('timer-display');
    // Basic tier (level 1): the clock node stays hidden.
    expect(timerEl.classList.contains('hidden')).toBe(true);

    game.currentLevel = 5;
    game.startLevel();
    expect(timerEl.classList.contains('hidden')).toBe(false);

    // Back down to a basic tier (as Play Again does): hidden again.
    game.currentLevel = 1;
    game.startLevel();
    expect(timerEl.classList.contains('hidden')).toBe(true);
});

test("real Level constructions grow across difficulty tiers on horizontal levels", () => {
    // directionForLevel cycles right/left/vertical from level 5, so the
    // advanced tier's horizontal numbers are 11 and 12 — never 10.
    const basic = new Level(1, 32);
    const intermediate = new Level(5, 32);
    const advanced = new Level(11, 32);

    expect(basic.direction).toBe('right');
    expect(intermediate.direction).toBe('right');
    expect(advanced.direction).toBe('right');

    expect([basic.width, basic.height]).toEqual([20, 15]);
    expect([intermediate.width, intermediate.height]).toEqual([24, 18]);
    expect([advanced.width, advanced.height]).toEqual([28, 21]);

    expect(basic.width).toBeLessThan(intermediate.width);
    expect(intermediate.width).toBeLessThan(advanced.width);
    expect(basic.height).toBeLessThan(intermediate.height);
    expect(intermediate.height).toBeLessThan(advanced.height);

    // The mirrored advanced horizontal (left) keeps the same footprint.
    const advancedLeft = new Level(12, 32);
    expect(advancedLeft.direction).toBe('left');
    expect([advancedLeft.width, advancedLeft.height]).toEqual([28, 21]);
});

test("vertical levels leave the horizontal size ramp, so tier checks must use horizontal numbers", () => {
    // Level 10 is the first vertical: it climbs a fixed 15x24 grid instead of
    // the 28x21 advanced footprint, which would silently invert a naive
    // "advanced is bigger than intermediate" comparison.
    const vertical = new Level(10, 32);
    expect(vertical.direction).toBe('vertical');
    expect([vertical.width, vertical.height]).toEqual([15, 24]);
});
