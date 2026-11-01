// Phase 3 integration E2E: Escape toggles PAUSED (overlay + frozen physics)
// and finishing level 15 reaches GAME_COMPLETE with the persisted high score,
// then Play Again returns to a fresh run. Console cleanliness is asserted per
// test: the game loop's catch would otherwise log per-frame errors forever
// (R26), so any console output here signals a regression.
import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, elementState, closeSession, sessionName
} from "./helpers.js";

const SESSION = sessionName("p3-pause-complete");
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

function assertConsoleClean() {
    const out = ab(SESSION, "console");
    const bad = out.split("\n").filter(l => /\b(error|warn)\b/i.test(l));
    expect(bad).toEqual([]);
}

test("Escape pauses with overlay and frozen physics, then resumes", async () => {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    waitLanded(SESSION);

    // Launch the player before pausing: a parked grounded body would stay
    // put even if update() wrongly ran while PAUSED, so motion is what makes
    // the freeze assertion bite.
    abEvalJSON(
        SESSION,
        `(() => { const p = window.game.player;
                  p.vy = -200; p.grounded = false; return true; })()`
    );
    ab(SESSION, "press", "Escape");
    abWaitFn(SESSION, "window.game.state === 'PAUSED'");
    expect(elementState(SESSION, "pause-screen").hidden).toBe(false);

    const pos1 = abEvalJSON(
        SESSION,
        `({ x: window.game.player.x, y: window.game.player.y })`
    );
    await Bun.sleep(600);
    const pos2 = abEvalJSON(
        SESSION,
        `({ x: window.game.player.x, y: window.game.player.y })`
    );
    expect(pos2).toEqual(pos1);
    screenshot(SESSION, "phase3-paused.png");

    ab(SESSION, "press", "Escape");
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    expect(elementState(SESSION, "pause-screen").hidden).toBe(true);
    assertConsoleClean();
}, 60000);

test("Winning level 15 shows GAME_COMPLETE with high score; Play Again resets", async () => {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");

    // Timer HUD is tier-gated: hidden on the basic level just started.
    expect(
        abEvalJSON(
            SESSION,
            `document.getElementById('timer-display').classList.contains('hidden')`
        )
    ).toBe(true);

    // Seed a non-zero total through the seam before jumping to the final
    // level: gate-opening via collectCoin() never touches game.score (the
    // loop scores real pickups), and a 0-score run would not exercise the
    // high-score write. Cleared storage makes the persistence check exact.
    // Seed score BEFORE startLevel so levelStartScore snapshots 250: the
    // GAME_OVER recovery below replays via retryLevel(), which rolls the
    // score back to that snapshot, and the high-score assertion must survive
    // a stray patrol winning the race.
    const summary = abEvalJSON(
        SESSION,
        `(() => { const g = window.game;
                  localStorage.removeItem('platformerHighScore');
                  g.currentLevel = 15; g.score = 250; g.startLevel();
                  return { timerHidden: document.getElementById('timer-display')
                              .classList.contains('hidden'),
                           level: g.currentLevel }; })()`
    );
    expect(summary.level).toBe(15);
    expect(summary.timerHidden).toBe(false);

    // Meet the 70% coin gate through the real Collectibles API, then drop
    // onto the live portal (same pattern as the phase-2 completeViaPortal):
    // clearance and the teleport happen in ONE eval, stale terrain
    // regenerates when a patrol is in range at the moment of the drop, and a
    // stray patrol that still kills the player mid-race is recovered via the
    // retry button — L15 is the densest enemy tier, so the compound
    // LEVEL_COMPLETE || GAME_OVER wait must not stall on a death.
    let outcome = null;
    for (let attempt = 0; attempt < 6 && outcome !== "LEVEL_COMPLETE"; attempt++) {
        if (outcome === "GAME_OVER") {
            ab(SESSION, "click", "#retry-btn");
            abWaitFn(SESSION, "window.game.state === 'PLAYING'");
        }
        const dropped = abEvalJSON(
            SESSION,
            `(() => { const g = window.game;
                      const c = g.collectibles;
                      const coins = c.getCoins();
                      for (let i = 0; i < coins.length && !c.meetsPortalRequirement(); i++) c.collectCoin(i);
                      if (!c.meetsPortalRequirement()) return false;
                      const portal = g.level.portal;
                      const clear = g.enemyManager.enemies.every(
                          e => Math.abs(e.y - portal.y) >= 64 ||
                               e.x + e.width < portal.x - 96 ||
                               e.x > portal.x + portal.width + 96);
                      if (!clear) return false;
                      const p = g.player;
                      p.x = portal.x; p.y = portal.y - 60;
                      p.vx = 0; p.vy = 0; p.grounded = false;
                      return true; })()`
        );
        if (!dropped) {
            abEvalJSON(SESSION, `(() => { window.game.startLevel(); return true; })()`);
            continue;
        }
        abWaitFn(
            SESSION,
            "window.game.state === 'LEVEL_COMPLETE' ||" +
            " window.game.state === 'GAME_OVER'"
        );
        outcome = abEvalJSON(SESSION, "window.game.state");
    }
    expect(outcome).toBe("LEVEL_COMPLETE");
    abWaitFn(SESSION, "window.game.state === 'GAME_COMPLETE'", 30000);

    const done = abEvalJSON(
        SESSION,
        `{ state: window.game.state, score: window.game.score,
           screenHidden: document.getElementById('game-complete-screen').classList.contains('hidden'),
           scoreText: document.getElementById('game-complete-score').textContent,
           highText: document.getElementById('high-score').textContent,
           stored: localStorage.getItem('platformerHighScore') }`
    );
    expect(done.state).toBe("GAME_COMPLETE");
    expect(done.screenHidden).toBe(false);
    expect(done.scoreText).toBe(`Score: ${done.score}`);
    expect(done.highText).toBe(`High Score: ${done.score}`);
    expect(done.stored).toBe(String(done.score));
    screenshot(SESSION, "phase3-game-complete.png");

    ab(SESSION, "click", "#play-again-btn");
    abWaitFn(
        SESSION,
        "window.game.state === 'PLAYING' && window.game.currentLevel === 1"
    );
    const fresh = abEvalJSON(
        SESSION,
        `{ state: window.game.state, level: window.game.currentLevel,
           score: window.game.score, timerActive: window.game.timerActive,
           screenHidden: document.getElementById('game-complete-screen').classList.contains('hidden'),
           timerHidden: document.getElementById('timer-display').classList.contains('hidden') }`
    );
    expect(fresh.score).toBe(0);
    expect(fresh.timerActive).toBe(false);
    expect(fresh.screenHidden).toBe(true);
    expect(fresh.timerHidden).toBe(true);
    assertConsoleClean();
}, 60000);
