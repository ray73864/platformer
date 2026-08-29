import { test, expect, afterAll } from "bun:test";

// --- Test scaffolding -------------------------------------------------------
// The Game constructor touches real DOM nodes (#game-canvas, #start-btn,
// #retry-btn) and a 2d canvas context before any state exists, so every test
// installs the same fixture. UI-owned ids self-heal via ensureElement; these
// four do not (see main.js bindEvents/handleGameOver).

globalThis.requestAnimationFrame = () => {};
globalThis.cancelAnimationFrame = () => {};

const realGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function () {
    return {
        fillStyle: null,
        strokeStyle: null,
        lineWidth: null,
        scale: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {}
    };
};

afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
});

function mountFixture() {
    window.innerWidth = 800;
    window.innerHeight = 600;
    document.body.innerHTML = `
        <canvas id="game-canvas"></canvas>
        <button id="start-btn">Start</button>
        <button id="retry-btn">Retry</button>
        <div id="final-score"></div>
    `;
}

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

test("falling past canvas.height + 100 transitions to GAME_OVER and writes the final score", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    hideOverlays(game);

    expect(document.getElementById('final-score').textContent).toBe("");

    // Teleport below the death line, then one update tick.
    game.player.y = game.canvas.height + 200;
    game.update(0.016);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('final-score').textContent).toBe(`Score: ${game.score}`);
});

test("update() is inert outside PLAYING and LEVEL_COMPLETE", () => {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();

    // Kill the run, then confirm no physics or state machine runs afterwards.
    game.player.y = game.canvas.height + 200;
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
    // startLevel() constructs the player at its fixed spawn point.
    expect(game.player.x).toBe(100);
    expect(game.player.y).toBe(100);
    expect(document.getElementById('level-complete-screen').classList.contains('hidden')).toBe(true);

    // The LEVEL_COMPLETE exit must have left a fresh, fully playable level.
    game.update(0.016);
    expect(game.state).toBe(STATE.PLAYING);
});
