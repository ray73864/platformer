import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { Player } from "../../js/player.js";

// Puts an overlay in a known-hidden baseline so that "shown" assertions prove
// showOverlay actually removed the class rather than observing initial state.
function hideOverlays(game) {
    game.ui.hideOverlay('menu-screen');
    game.ui.hideOverlay('game-over-screen');
    game.ui.hideOverlay('level-complete-screen');
}

test("a new Game starts in MENU with no active level", () => {
    mountFixture();
    const game = new Game();

    expect(game.state).toBe(STATE.MENU);
    expect(game.level).toBeNull();
    expect(game.player).toBeNull();
    expect(game.score).toBe(0);
    expect(game.currentLevel).toBe(1);
});

test("startGame() transitions MENU to PLAYING and resets progress", () => {
    mountFixture();
    const game = new Game();
    hideOverlays(game);

    // Simulate leftover progress from a previous run.
    game.score = 42;
    game.currentLevel = 3;

    game.startGame();

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.score).toBe(0);
    expect(game.currentLevel).toBe(1);
    expect(game.level).toBeInstanceOf(Level);
    expect(game.player).toBeInstanceOf(Player);
    expect(game.player.hasReachedPortal()).toBe(false);
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(true);
});

test("clicking #start-btn starts the game through the bound DOM listener", () => {
    mountFixture();
    const game = new Game();

    document.getElementById('start-btn').click();

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.level).toBeInstanceOf(Level);
});

test("falling past the world bottom transitions to GAME_OVER and writes the final score", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    hideOverlays(game);

    expect(document.getElementById('final-score').textContent).toBe("");

    // Teleport below the death line, then one update tick. The bound is an
    // independent world-space number (level height + margin), NOT derived
    // from canvas.height — anchoring to canvas.height made the assertion
    // tautological and blind to device-pixel/CSS-pixel confusion.
    const worldBottom = game.level.height * game.level.tileSize;
    expect(game.player.y).toBeLessThan(worldBottom); // sanity: alive above it
    game.player.y = worldBottom + 200;
    game.update(0.016);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('final-score').textContent).toBe(`Score: ${game.score}`);
});

test("the death line stays in world pixels when devicePixelRatio doubles", () => {
    // Regression for the device-pixel backing-store bug: at dpr=2 the canvas
    // height doubles but the death threshold must not, so a player just past
    // the world bottom dies even though it is far above canvas.height.
    mountFixture();
    Object.defineProperty(window, 'devicePixelRatio', {
        value: 2, configurable: true, writable: true
    });
    try {
        const game = new Game();
        document.getElementById('start-btn').click();
        hideOverlays(game);

        expect(game.canvas.height).toBe(1200); // device pixels (600 * 2)

        const worldBottom = game.level.height * game.level.tileSize;
        game.player.y = worldBottom + 140; // > threshold, < old canvas-based line
        game.update(0.016);

        expect(game.state).toBe(STATE.GAME_OVER);
    } finally {
        delete window.devicePixelRatio;
    }
});

test("update() is inert outside PLAYING and LEVEL_COMPLETE", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();

    // Kill the run, then confirm no physics or state machine runs afterwards.
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(0.016);
    expect(game.state).toBe(STATE.GAME_OVER);

    const frozenX = game.player.x;
    const frozenY = game.player.y;
    for (let i = 0; i < 5; i++) {
        game.update(0.016);
    }

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(game.player.x).toBe(frozenX);
    expect(game.player.y).toBe(frozenY);
});

test("reaching the portal transitions to LEVEL_COMPLETE and arms the transition timer", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    hideOverlays(game);

    // Teleport onto the level's actual portal and signal contact through the
    // Player API main.js checks each tick. (No automatic collision-to-portal
    // wiring exists in js/ yet; markPortalReached is its public seam.)
    const portal = game.level.portal;
    expect(portal).not.toBeNull();
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();

    game.update(0.016);

    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
    expect(game.levelCompleteTimer).toBeGreaterThan(1);
    expect(game.levelCompleteTimer).toBeLessThanOrEqual(2);
    expect(document.getElementById('level-complete-screen').classList.contains('hidden')).toBe(false);

    // Exit LEVEL_COMPLETE deterministically so the armed update-timer
    // transition can never fire against a live state in a later test.
    game.update(2.1);
});

test("from LEVEL_COMPLETE, more than 2s of update time advances to the next level and back to PLAYING", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    hideOverlays(game);

    const previousLevel = game.level;
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();
    game.update(0.016);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    // Drive the update-timer path deterministically (never real time): 3 x 0.8s > 2s.
    for (let i = 0; i < 3; i++) {
        game.update(0.8);
    }

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.currentLevel).toBe(2);
    expect(game.level).not.toBe(previousLevel);
    expect(game.level).toBeInstanceOf(Level);
    // startLevel() constructs the player at the level's verified spawn point.
    expect(game.player.x).toBe(game.level.spawnPoint.x);
    expect(game.player.y).toBe(game.level.spawnPoint.y);
    expect(document.getElementById('level-complete-screen').classList.contains('hidden')).toBe(true);

    // The LEVEL_COMPLETE exit must have left a fresh, fully playable level.
    game.update(0.016);
    expect(game.state).toBe(STATE.PLAYING);
});
