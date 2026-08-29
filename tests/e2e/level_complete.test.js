import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, abEvalJSON, screenshot, elementState,
    closeSession
} from "./helpers.js";

const SESSION = "t11-level-complete";
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
    await Bun.sleep(500);

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
                  window.game.player.x = best;
                  window.game.player.y = 40;
                  return best; })()`
    );
    expect(drop).toBeGreaterThanOrEqual(320);
    await Bun.sleep(1200);

    const mid = abEvalJSON(
        SESSION,
        `{ camX: Math.round(window.game.camera.x),
           state: window.game.state }`
    );
    expect(mid.state).toBe("PLAYING");
    expect(mid.camX).toBeGreaterThan(0);
    screenshot(SESSION, "task-11-camera-follow.png");

    // Step onto the portal; contact is detected by the game's own
    // collision check, not by poking at its completion flag.
    abEvalJSON(
        SESSION,
        `(() => { const p = window.game.level.portal;
                  window.game.player.x = p.x;
                  window.game.player.y = p.y - 60;
                  return true; })()`
    );
    await Bun.sleep(400);

    const complete = abEvalJSON(
        SESSION,
        `{ state: window.game.state, level: window.game.currentLevel }`
    );
    expect(complete.state).toBe("LEVEL_COMPLETE");
    expect(complete.level).toBe(1);
    expect(elementState(SESSION, "level-complete-screen").hidden).toBe(false);
    screenshot(SESSION, "task-11-level-complete.png");

    // The 2s transition timer advances to the next level on its own.
    await Bun.sleep(2500);
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
