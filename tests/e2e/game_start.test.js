import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, abEvalJSON, abWaitFn, screenshot,
    elementState, closeSession
} from "./helpers.js";

const SESSION = "t11-game-start";
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

test("Game starts with menu screen", async () => {
    openGame(SESSION, server.url);

    const initial = abEvalJSON(
        SESSION,
        `{ state: window.game.state,
           canvas: !!document.getElementById('game-canvas'),
           title: document.querySelector('#menu-screen h1').textContent }`
    );
    expect(initial.state).toBe("MENU");
    expect(initial.canvas).toBe(true);
    expect(initial.title).toContain("Platformer");

    const menu = elementState(SESSION, "menu-screen");
    expect(menu.hidden).toBe(false);

    screenshot(SESSION, "task-11-menu.png");
}, 60000);

test("Start button navigates to gameplay", async () => {
    openGame(SESSION, server.url);

    startGame(SESSION);
    abWaitFn(
        SESSION,
        "window.game.state === 'PLAYING' && !!window.game.player &&" +
        " !!window.game.level"
    );

    const after = abEvalJSON(
        SESSION,
        `{ state: window.game.state,
           hasPlayer: !!window.game.player,
           hasLevel: !!window.game.level,
           hudDisplay: getComputedStyle(document.getElementById('hud')).display }`
    );
    expect(after.state).toBe("PLAYING");
    expect(after.hasPlayer).toBe(true);
    expect(after.hasLevel).toBe(true);
    expect(after.hudDisplay).not.toBe("none");

    const menu = elementState(SESSION, "menu-screen");
    expect(menu.hidden).toBe(true);

    screenshot(SESSION, "task-11-gameplay.png");
}, 60000);
