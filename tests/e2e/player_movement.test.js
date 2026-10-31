import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, closeSession, sessionName
} from "./helpers.js";

const SESSION = sessionName("t11-player-movement");
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

// The player spawns on the level's verified spawn ground. Poll to PLAYING,
// then until landing settles physics before measuring.
function startAndSettle() {
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    waitLanded(SESSION);
}

test("Player moves left with arrow key", () => {
    openGame(SESSION, server.url);
    startAndSettle();

    const before = abEvalJSON(SESSION, "window.game.player.x");

    // Trusted key events through the browser input pipeline; held down so
    // the game loop sees isLeft() across frames.
    ab(SESSION, "keydown", "ArrowLeft");
    Bun.sleepSync(400);
    const during = abEvalJSON(SESSION, "window.game.player.x");
    screenshot(SESSION, "task-11-movement.png");
    ab(SESSION, "keyup", "ArrowLeft");

    expect(during).toBeLessThan(before - 20);
}, 60000);

test("Player jumps with spacebar", () => {
    openGame(SESSION, server.url);
    startAndSettle();

    const before = abEvalJSON(SESSION, "window.game.player.y");

    // Sample the apex INSIDE the page. Reading y after a wall-clock sleep
    // measures wherever the CLI round-trip happened to land (~hundreds of ms
    // of jitter), not the jump's peak.
    abEvalJSON(
        SESSION,
        `(() => { window.__minY = window.game.player.y;
                  window.__sampleId = setInterval(() => {
                      window.__minY = Math.min(window.__minY, window.game.player.y);
                  }, 16);
                  return true; })()`
    );

    ab(SESSION, "press", "Space");
    // Past apex (falling), then back on the ground: both transitions complete
    // within hang time (~0.7 s), so condition waits replace fixed sleeps.
    abWaitFn(SESSION, "window.game.player.vy > 0", 10000);
    abWaitFn(SESSION, "window.game.player.grounded === true", 10000);

    const minY = abEvalJSON(
        SESSION,
        `(() => { clearInterval(window.__sampleId); return window.__minY; })()`
    );
    screenshot(SESSION, "task-11-jump.png");

    // Documented jump model: rise ~62px (JUMP_FORCE 350, GRAVITY 980).
    expect(minY).toBeLessThan(before - 20);
}, 60000);
