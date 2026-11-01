// Loop-error state recovery (spec §General Error Handling, backlog 2c3859d1):
// a persistent failure streak inside a run rebuilds the current level and
// shows an on-screen notice; errors persisting through a second equal window
// hand off to MENU. Errors outside a run only log. Forced failures are driven
// through Game.loop() with synthetic timestamps (rAF is stubbed by setup.js),
// so recovery engages deterministically without real frames.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";

const FRAME_MS = 16;
// Must match LOOP_ERROR_RECOVERY_FRAMES in main.js.
const RECOVERY_FRAMES = 30;

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

// Runs `frames` loop ticks with update() throwing, console.error silenced.
function failFrames(game, frames) {
    const originalError = console.error;
    console.error = () => {};
    try {
        for (let i = 1; i <= frames; i++) game.loop(i * FRAME_MS);
    } finally {
        console.error = originalError;
    }
}

function errorMessageVisible() {
    return !document.getElementById('error-message').classList.contains('hidden');
}

test("a persistent error streak recovers by rebuilding the level and showing the notice", () => {
    const game = startPlaying();
    const levelBefore = game.level;
    const playerBefore = game.player;
    game.update = () => { throw new Error('injected failure'); };
    try {
        failFrames(game, RECOVERY_FRAMES - 1);
        // Below threshold: still the same run, no notice yet.
        expect(game.level).toBe(levelBefore);
        expect(errorMessageVisible()).toBe(false);

        failFrames(game, 1); // the 30th consecutive failure -> recovery
        expect(game.state).toBe(STATE.PLAYING);
        expect(game.level).not.toBe(levelBefore); // rebuilt fresh
        expect(game.player).not.toBe(playerBefore);
        expect(errorMessageVisible()).toBe(true);
    } finally {
        game.ui.hideErrorMessage();
    }
});

test("errors persisting through the second window hand off to MENU", () => {
    const game = startPlaying();
    game.update = () => { throw new Error('injected failure'); };
    try {
        failFrames(game, 2 * RECOVERY_FRAMES);
        expect(game.state).toBe(STATE.MENU);
        expect(errorMessageVisible()).toBe(true);
    } finally {
        game.ui.hideErrorMessage();
    }
});

test("a clean frame ends the episode so a later streak can recover again", () => {
    const game = startPlaying();
    let failing = true;
    game.update = () => { if (failing) throw new Error('injected failure'); };
    try {
        failFrames(game, RECOVERY_FRAMES); // recovery engages
        expect(game.state).toBe(STATE.PLAYING);
        game.ui.hideErrorMessage();

        failing = false;
        game.loop((RECOVERY_FRAMES + 1) * FRAME_MS); // clean frame resets streak
        failing = true;
        failFrames(game, RECOVERY_FRAMES - 1);
        expect(game.state).toBe(STATE.PLAYING); // second episode still allowed
        expect(errorMessageVisible()).toBe(false);
    } finally {
        game.ui.hideErrorMessage();
    }
});

test("loop errors outside a run log but never trigger recovery", () => {
    mountFixture();
    const game = new Game(); // MENU
    game.update = () => { throw new Error('injected failure'); };
    failFrames(game, 2 * RECOVERY_FRAMES);
    expect(game.state).toBe(STATE.MENU);
    expect(errorMessageVisible()).toBe(false);
});
