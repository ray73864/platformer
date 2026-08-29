import { test, expect, afterAll } from "bun:test";
import { Game, STATE } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { Player } from "../../js/player.js";

// --- Test scaffolding (mirrors state_transitions.test.js; see its header) ---

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

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

test("starting from the menu produces a fully wired, playable level", () => {
    const game = startPlaying();

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.level).toBeInstanceOf(Level);
    expect(game.player).toBeInstanceOf(Player);
    expect(game.level.getPortal()).not.toBeNull();
    expect(game.level.hasValidPath()).toBe(true);
    expect(game.level.getCoins().length).toBeGreaterThanOrEqual(5);

    // One PLAYING tick pushes score and level through the real UI module.
    game.update(0.016);
    expect(document.getElementById('score-display').textContent).toBe('Score: 0');
    expect(document.getElementById('level-display').textContent).toBe('Level: 1');

    // The whole draw pipeline (Game -> Camera transform -> Level + Player) runs.
    expect(() => game.draw()).not.toThrow();
});

test("keyboard events drive the player through physics", () => {
    const game = startPlaying();

    // Stand the player on the forced flat spawn ground so motion is not
    // immediately eaten by collision resolution.
    const spawn = game.level.getSpawnPoint();
    game.player.x = spawn.x;
    game.player.y = spawn.y - game.player.height;

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    expect(game.input.isRight()).toBe(true);

    const startX = game.player.x;
    for (let i = 0; i < 30; i++) {
        game.update(1 / 60);
    }
    // ~0.5s at PLAYER_SPEED=200 minus collision settling: assert real travel,
    // not an exact pixel figure, since level layout is random per instance.
    expect(game.player.x).toBeGreaterThan(startX + 40);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(game.player.vy).toBeLessThan(0);

    const yBeforeJump = game.player.y;
    for (let i = 0; i < 10; i++) {
        game.update(1 / 60);
    }
    // Gravity resolves against the jump every tick, but a fresh upward launch
    // must still be climbing after ~0.17s of hang time.
    expect(game.player.y).toBeLessThan(yBeforeJump);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
});

test("autorepeat Space keydowns in flight cannot extend the jump", () => {
    const game = startPlaying();

    // Stand the player on its spawn ground and let physics run until it is
    // actually grounded, so the single-press baseline jump is legitimate.
    const spawn = game.level.getSpawnPoint();
    game.player.x = spawn.x;
    game.player.y = spawn.y - game.player.height;
    for (let i = 0; i < 120 && !game.player.grounded; i++) {
        game.update(1 / 60);
    }
    expect(game.player.grounded).toBe(true);

    // A single Space press from the ground must still launch the player.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(game.player.vy).toBeLessThan(0);
    expect(game.player.grounded).toBe(false);

    // Fall until vy is positive (apex passed, genuinely airborne and sinking).
    for (let i = 0; i < 300 && game.player.vy <= 0; i++) {
        game.update(1 / 60);
    }
    expect(game.player.vy).toBeGreaterThan(0);

    // Autorepeat keydowns (wasPressed never suppresses them) must not reset
    // vy upward: the grounded gate at the input wiring rejects them.
    const vyBefore = game.player.vy;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(game.player.vy).toBe(vyBefore);

    // And gravity keeps winning: flight is not extended, the player falls.
    game.update(1 / 60);
    expect(game.player.vy).toBeGreaterThan(vyBefore);
});

test("dying and retrying through #retry-btn restarts play on a fresh level instance", () => {
    const game = startPlaying();

    game.player.y = game.canvas.height + 200;
    game.update(0.016);
    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);

    document.getElementById('retry-btn').click();

    expect(game.state).toBe(STATE.PLAYING);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(true);
    // retryLevel() -> startLevel(): new level object and a player at the fixed spawn.
    expect(game.level).toBeInstanceOf(Level);
    expect(game.player.x).toBe(100);
    expect(game.player.y).toBe(100);

    game.update(0.016);
    expect(game.state).toBe(STATE.PLAYING);
});

test("completing a level advances the HUD to the next level via the update-timer path", () => {
    const game = startPlaying();

    // Reach the portal on its actual generated position.
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();

    game.update(0.016);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    // Progress on the deterministic dt path only; handleWin has no parallel
    // setTimeout, so the update-timer path is the sole advance mechanism.
    let ticks = 0;
    while (game.state === STATE.LEVEL_COMPLETE && ticks < 100) {
        game.update(0.1);
        ticks++;
    }

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.currentLevel).toBe(2);
    expect(ticks * 0.1).toBeGreaterThan(2 - 0.1); // the timer genuinely gated progression

    game.update(0.016);
    expect(document.getElementById('level-display').textContent).toBe('Level: 2');
});

test("a completed level is itself playable to another portal", () => {
    const game = startPlaying();

    const firstPortal = game.level.portal;
    game.player.x = firstPortal.x;
    game.player.y = firstPortal.y;
    game.player.markPortalReached();
    game.update(0.016);
    for (let i = 0; i < 30 && game.state === STATE.LEVEL_COMPLETE; i++) {
        game.update(0.1);
    }

    // Second level: real generated content, reachable portal, and the flow can
    // complete again end-to-end through Game.update().
    expect(game.currentLevel).toBe(2);
    expect(game.level.hasValidPath()).toBe(true);
    const secondPortal = game.level.portal;
    expect(secondPortal).not.toBeNull();

    game.player.x = secondPortal.x;
    game.player.y = secondPortal.y;
    game.player.markPortalReached();
    game.update(0.016);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    // Exit LEVEL_COMPLETE deterministically (mirrors state_transitions.test.js)
    // so the armed 2s transition timer can never cross into a later file.
    game.update(2.1);
});
