import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, elementState, closeSession, sessionName
} from "./helpers.js";

const SESSION = sessionName("t11-level-complete");
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

test("Player reaches portal to complete level", async () => {
    // Narrow viewport (480 < level width 640) so the camera clamp leaves
    // room to pan and camera-follow is observable.
    openGame(SESSION, server.url, 480, 360);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");

    // Drop the player above a reachable tile in the right half of the level
    // (position is not observable from the DOM; terrain comes from the
    // level's own reachability data so the drop cannot land in a pit).
    const drop = abEvalJSON(
        SESSION,
        `(() => { const l = window.game.level;
                  let best = null;
                  for (const key of l.reachableTiles) {
                      const px = (key % l.width) * l.tileSize;
                      if (px >= 320 && px <= l.portal.x - 96) best = px;
                  }
                  // grounded=false alongside the teleport: physics only
                  // refreshes it on the next tick, and waitLanded reads it.
                  window.game.player.grounded = false;
                  window.game.player.x = best;
                  window.game.player.y = 40;
                  return best; })()`
    );
    expect(drop).toBeGreaterThanOrEqual(320);
    waitLanded(SESSION);

    const mid = abEvalJSON(
        SESSION,
        `{ camX: Math.round(window.game.camera.x),
           state: window.game.state }`
    );
    expect(mid.state).toBe("PLAYING");
    expect(mid.camX).toBeGreaterThan(0);
    screenshot(SESSION, "task-11-camera-follow.png");

    // Step onto the portal; contact is detected by the game's own
    // collision check, not by poking at its completion flag. The portal is
    // coin-gated (70%), so meet the threshold through the real Collectibles
    // API first.
    const gateMet = abEvalJSON(
        SESSION,
        `(() => { const c = window.game.collectibles;
                  const coins = c.getCoins();
                  for (let i = 0; i < coins.length && !c.meetsPortalRequirement(); i++) c.collectCoin(i);
                  return c.meetsPortalRequirement(); })()`
    );
    expect(gateMet).toBe(true);
    abEvalJSON(
        SESSION,
        `(() => { const p = window.game.level.portal;
                  window.game.player.x = p.x;
                  window.game.player.y = p.y - 60;
                  return true; })()`
    );
    abWaitFn(SESSION, "window.game.state === 'LEVEL_COMPLETE'");

    const complete = abEvalJSON(
        SESSION,
        `{ state: window.game.state, level: window.game.currentLevel }`
    );
    expect(complete.state).toBe("LEVEL_COMPLETE");
    expect(complete.level).toBe(1);
    expect(elementState(SESSION, "level-complete-screen").hidden).toBe(false);
    screenshot(SESSION, "task-11-level-complete.png");

    // The 2s transition advances to the next level on its own via the
    // update-timer path; poll until the HUD reflects it, which happens on
    // the first PLAYING tick of level 2.
    abWaitFn(
        SESSION,
        "window.game.currentLevel === 2 && window.game.state === 'PLAYING' &&" +
        " document.getElementById('level-display').textContent === 'Level: 2'",
        30000
    );
    const advanced = abEvalJSON(
        SESSION,
        `{ state: window.game.state,
           level: window.game.currentLevel,
           hud: document.getElementById('level-display').textContent }`
    );
    expect(advanced.state).toBe("PLAYING");
    expect(advanced.level).toBe(2);
    expect(advanced.hud).toBe("Level: 2");
}, 90000);

test("LEVEL_COMPLETE overlay shows the clear-bonus breakdown (score economy ruling)", async () => {
    openGame(SESSION, server.url, 800, 600);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");

    // Force the win through the same debug seam the phase2/phase3 e2e files
    // use: meet the coin gate via the real Collectibles API, then drop the
    // player onto the live portal. Level 1 is basic tier — generation ships
    // no enemies or spikes below level 5 — so this win is flawless by
    // construction and pays the full CLEAR_BONUS_BASE of 100. Seam-collected
    // coins never touch game.score, so the breakdown's coin line is 0 here;
    // the integration suite pins the nonzero-coin breakdown instead.
    abEvalJSON(
        SESSION,
        `(() => { const g = window.game;
                  const c = g.collectibles;
                  const coins = c.getCoins();
                  for (let i = 0; i < coins.length && !c.meetsPortalRequirement(); i++) c.collectCoin(i);
                  const p = g.level.portal;
                  g.player.x = p.x; g.player.y = p.y - 60;
                  g.player.vx = 0; g.player.vy = 0; g.player.grounded = false;
                  return true; })()`
    );
    abWaitFn(
        SESSION,
        "window.game.state === 'LEVEL_COMPLETE' || window.game.state === 'GAME_OVER'"
    );
    // Freeze the 2 s auto-advance so post-completion assertions cannot race
    // it into level 2 (I10 pattern from phase2_elements.test.js).
    const outcome = abEvalJSON(
        SESSION,
        `(() => { const g = window.game;` +
        ` if (g.state === 'LEVEL_COMPLETE') g.levelCompleteTimer = 60;` +
        ` return g.state; })()`
    );
    expect(outcome).toBe("LEVEL_COMPLETE");

    const view = abEvalJSON(
        SESSION,
        `{ bonusHidden: document.getElementById('clear-bonus').hidden,
           bonusText: document.getElementById('clear-bonus').textContent,
           bestedHidden: document.getElementById('enemies-bested').hidden,
           noDamageHidden: document.getElementById('no-damage-bonus').hidden,
           noDamageText: document.getElementById('no-damage-bonus').textContent,
           secretsHidden: document.getElementById('secrets-found').hidden,
           breakdown: window.game.lastClearBreakdown }`
    );
    // Cause-and-effect copy: full bonus visible with its "+N" sign...
    expect(view.bonusHidden).toBe(false);
    expect(view.bonusText).toBe("Flawless clear +100");
    // ...and the combat line stays hidden when nothing was bested.
    expect(view.bestedHidden).toBe(true);
    // M5: a zero-death seam win pays the no-damage bonus; L1 ships no alcove
    // coins so the secrets line stays hidden (the integration suite pins the
    // carved-alcove variant).
    expect(view.noDamageHidden).toBe(false);
    expect(view.noDamageText).toBe("No-damage bonus +50");
    expect(view.secretsHidden).toBe(true);
    expect(view.breakdown).toEqual({
        coins: 0, combat: 0, clearBonus: 100, noDamageBonus: 50,
        enemiesBested: 0, deaths: 0, flawless: true,
        secretsFound: 0, secretsTotal: 0
    });
    screenshot(SESSION, "economy-level-complete-breakdown.png");

    // Zero console errors/warnings across the whole flow (same breadth as
    // phase3_pause_complete.test.js's assertConsoleClean).
    const consoleOut = ab(SESSION, "console");
    const bad = consoleOut.split("\n").filter(l => /error|warn(?:ing)?\b/i.test(l));
    expect(bad).toEqual([]);

    // Release the frozen transition so the shared session leaves no stuck
    // LEVEL_COMPLETE behind for any later reuse.
    abEvalJSON(SESSION, `(() => { window.game.levelCompleteTimer = 0; return true; })()`);
}, 90000);
