import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, closeSession
} from "./helpers.js";

const SESSION = "t11-player-movement";
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

// The player spawns at (100, 100) and falls onto the flat spawn ground.
// Poll to PLAYING, then until landing settles physics before measuring.
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

    ab(SESSION, "press", "Space");
    const launch = abEvalJSON(SESSION, "window.game.player.vy");
    expect(launch).toBeLessThan(0);

    Bun.sleepSync(150);
    const peak = abEvalJSON(SESSION, "window.game.player.y");
    screenshot(SESSION, "task-11-jump.png");

    expect(peak).toBeLessThan(before - 10);
}, 60000);
