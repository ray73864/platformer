import { test, expect, afterEach } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Collectibles } from "../../js/collectibles.js";

installGameTestScaffolding();

import { Game, STATE, FINAL_LEVEL } from "../../js/main.js";

const HIGH_SCORE_KEY = "platformerHighScore";
const DT = 0.016;

// localStorage outlives this file on the shared happy-dom Window: no test may
// leave a high score behind for later files' assertions (every reachGameComplete
// run writes one).
afterEach(() => {
    localStorage.removeItem(HIGH_SCORE_KEY);
});

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

function hideOverlays(game) {
    game.ui.hideOverlay('menu-screen');
    game.ui.hideOverlay('game-over-screen');
    game.ui.hideOverlay('level-complete-screen');
    game.ui.hideOverlay('pause-screen');
    game.ui.hideOverlay('game-complete-screen');
}

// Neutralises generator-produced enemies/spikes so only the elements a test
// injects can kill the player (same recipe as game_loop_elements.test.js).
function clearGeneratedThreats(game) {
    game.enemyManager.clear();
    game.hazards.clear();
}

// A real Collectibles instance holding n coins stacked at the player's
// current position: one checkCollection call collects all n.
function coinsAtPlayer(game, n) {
    const collectibles = new Collectibles();
    for (let i = 0; i < n; i++) {
        collectibles.addCoin(game.player.x, game.player.y);
    }
    return collectibles;
}

function pressEscape() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
}

// Level generation reliability is pinned by the permanent R26 construction
// stress guard (0/1000 throws per level), so tests construct levels directly:
// a throw here is a generator regression and must fail loudly, not be
// silently retried away.
function startLevelAt(game, levelNumber) {
    game.currentLevel = levelNumber;
    game.startLevel();
}

// Wins the current level through the real coin gate + portal AABB path
// (same entry as level_progression.test.js). Direct collectCoin calls satisfy
// the gate without touching Game.score, keeping the final score deterministic.
function winCurrentLevel(game) {
    const coins = game.level.getCoins();
    for (let i = 0; i < coins.length; i++) game.collectibles.collectCoin(i);
    const portal = game.level.getPortal();
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
}

// Drives the LEVEL_COMPLETE transition timer past its 2s budget.
function finishTransition(game) {
    for (let i = 0; i < 3 && game.state === STATE.LEVEL_COMPLETE; i++) {
        game.update(0.8);
    }
}

// A run parked at GAME_COMPLETE with score 250 on the final level.
function reachGameComplete() {
    const game = startPlaying();
    hideOverlays(game);
    startLevelAt(game, FINAL_LEVEL);
    clearGeneratedThreats(game);
    game.score = 250;
    winCurrentLevel(game);
    finishTransition(game);
    expect(game.state).toBe(STATE.GAME_COMPLETE);
    return game;
}

test("coin pickups add exactly 2s per coin to the run clock while it is active", () => {
    const game = startPlaying();
    hideOverlays(game);
    game.currentLevel = 5;
    game.startLevel();
    clearGeneratedThreats(game);
    expect(game.timerActive).toBe(true);

    game.collectibles = coinsAtPlayer(game, 2);
    const before = game.timer.getTimeRemaining();
    game.update(DT); // ticks DT, then banks the coin bonus
    expect(game.timer.getTimeRemaining()).toBeCloseTo(before - DT + 4, 6);
});

test("coin pickups bank clock time even before the tier starts ticking it", () => {
    const game = startPlaying(); // level 1: basic tier, clock not ticking
    hideOverlays(game);
    clearGeneratedThreats(game);
    expect(game.timerActive).toBe(false);

    game.collectibles = coinsAtPlayer(game, 2);
    const before = game.timer.getTimeRemaining();
    game.update(DT);
    expect(game.score).toBe(20); // the coins still score
    // Spec: +2 s per coin unconditionally — one run clock across all levels,
    // so pre-tier coins are already on it when level 5 starts the ticking.
    expect(game.timer.getTimeRemaining()).toBe(before + 4);
});

test("completing the final level ends the run in GAME_COMPLETE with overlay and persisted high score", () => {
    localStorage.removeItem(HIGH_SCORE_KEY); // start from clean storage (exact persistence check)
    const game = reachGameComplete();

    expect(game.currentLevel).toBe(FINAL_LEVEL);
    expect(document.getElementById('game-complete-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('game-complete-score').textContent).toBe('Score: 250');
    expect(document.getElementById('high-score').textContent).toBe('High Score: 250');
    expect(localStorage.getItem(HIGH_SCORE_KEY)).toBe('250');
});

test("winning the level before the final one advances into FINAL_LEVEL and starts it", () => {
    // The FINAL_LEVEL=100 win flow is only reachable if 99→100 actually
    // constructs and publishes: this drives the real LEVEL_COMPLETE
    // transition into the last level (direction cycles to 'vertical', so it
    // climbs the fixed 15x24 grid — the constructor guard is what matters).
    const game = startPlaying();
    hideOverlays(game);
    startLevelAt(game, FINAL_LEVEL - 1);
    clearGeneratedThreats(game);
    winCurrentLevel(game);
    finishTransition(game);

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.currentLevel).toBe(FINAL_LEVEL);
    expect(game.level.direction).toBe('vertical');
    expect([game.level.width, game.level.height]).toEqual([15, 24]);
    expect(game.level.hasValidPath()).toBe(true);
});

test("a lower finishing score keeps the stored high score", () => {
    localStorage.setItem(HIGH_SCORE_KEY, '9999');
    reachGameComplete();

    expect(localStorage.getItem(HIGH_SCORE_KEY)).toBe('9999');
    expect(document.getElementById('high-score').textContent).toBe('High Score: 9999');
});

// Spec §Error Handling (high score): storage failures warn and continue —
// the run must still land on GAME_COMPLETE showing its own score as the high
// score, never stall in LEVEL_COMPLETE re-entering handleGameComplete.
// Without these tests, deleting the try/catch in main.js keeps the suite
// green and reintroduces the soft-lock (prior review S13). handleGameComplete
// is the only storage consumer in game code, so patching before
// reachGameComplete() aims the throw precisely at it. Returns a restore fn.
function installThrowingStorage(method) {
    const original = localStorage[method];
    Object.defineProperty(localStorage, method, {
        value: () => { throw new Error(`${method} unavailable`); },
        configurable: true,
        writable: true,
    });
    return () => {
        Object.defineProperty(localStorage, method, {
            value: original,
            configurable: true,
            writable: true,
        });
    };
}

function assertStorageFailureCompletesRun(game) {
    expect(game.state).toBe(STATE.GAME_COMPLETE);
    expect(document.getElementById('game-complete-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('high-score').textContent).toBe('High Score: 250');
    // No soft-lock: further updates must not re-enter the completion path.
    game.update(DT);
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_COMPLETE);
}

test("a getItem failure still completes the run, warning and showing the run score as high score", () => {
    let warned = 0;
    const originalWarn = console.warn;
    console.warn = () => { warned++; };
    try {
        const restore = installThrowingStorage('getItem');
        try {
            const game = reachGameComplete();
            assertStorageFailureCompletesRun(game);
            expect(warned).toBe(1);
        } finally {
            restore();
        }
    } finally {
        console.warn = originalWarn;
    }
});

test("a setItem failure still completes the run, warning and showing the run score as high score", () => {
    let warned = 0;
    const originalWarn = console.warn;
    console.warn = () => { warned++; };
    try {
        localStorage.setItem(HIGH_SCORE_KEY, '100'); // lower than 250: forces the setItem path
        const restore = installThrowingStorage('setItem');
        try {
            const game = reachGameComplete();
            assertStorageFailureCompletesRun(game);
            expect(warned).toBe(1);
        } finally {
            restore();
        }
    } finally {
        console.warn = originalWarn;
    }
});

test("Play Again starts a clean run: score 0, level 1, fresh inactive clock", () => {
    const game = reachGameComplete();
    game.timer.update(30); // burn the old clock so "fresh" is observable

    document.getElementById('play-again-btn').click();

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.score).toBe(0);
    expect(game.currentLevel).toBe(1);
    expect(game.timerActive).toBe(false);
    expect(game.timer.getTimeRemaining()).toBe(game.timer.baseTime);
    expect(document.getElementById('game-complete-screen').classList.contains('hidden')).toBe(true);
});

test("escape from GAME_COMPLETE returns to MENU", () => {
    const game = reachGameComplete();

    pressEscape();

    expect(game.state).toBe(STATE.MENU);
    expect(document.getElementById('game-complete-screen').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
});
