import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";

// The game loop must consult Difficulty.isTimerEnabled(levelNumber) as the
// single authority for whether the run clock ticks and can kill.

test("timer tier (level 5+): time-up ends the run", () => {
    mountFixture();
    const game = new Game();
    game.currentLevel = 5;
    game.startLevel();

    game.timer.timeRemaining = 0.5;
    game.update(1); // burn past zero in one tick

    expect(game.state).toBe(STATE.GAME_OVER);
});

test("basic tier (levels 1-4): the clock never ticks or kills", () => {
    mountFixture();
    const game = new Game();
    game.startLevel(); // level 1

    game.timer.timeRemaining = 0.5;
    // Small ticks: a dt=1 frame would tunnel the player through the ground
    // and die by pit fall, confounding the timer assertion.
    for (let i = 0; i < 10; i++) game.update(0.016);

    expect(game.state).toBe(STATE.PLAYING);
    expect(game.timer.timeRemaining).toBe(0.5);
});

test("retry after time-up resets the run clock (no instant re-kill)", () => {
    mountFixture();
    const game = new Game();
    game.currentLevel = 5;
    game.startLevel();

    game.timer.timeRemaining = 0.5;
    game.update(1);
    expect(game.state).toBe(STATE.GAME_OVER);

    game.retryLevel();
    expect(game.state).toBe(STATE.PLAYING);
    game.update(0.016);
    expect(game.state).toBe(STATE.PLAYING);
});
