// E2E audio smoke (real Chromium): the AudioContext boots lazily and only
// after the Start-gesture, M flips mute both ways with the HUD chip
// following, the preference survives a reload, frame rate holds up with the
// music scheduler running, and the run logs nothing to the console. One
// gameplay screenshot lands in the art-previews folder showing the chip.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { copyFileSync, mkdirSync } from "node:fs";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, closeSession, sessionName
} from "./helpers.js";

const SESSION = sessionName("audio");
const PREVIEW_PATH = "/home/ray/art-previews/game-audio-hud.png";
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
    const bad = out.split("\n").filter(l => /error|warn(?:ing)?\b/i.test(l));
    expect(bad).toEqual([]);
}

function audioState() {
    return abEvalJSON(SESSION, "window.game.audio.getState()");
}

test("AudioContext boots only from the Start gesture and runs music", () => {
    openGame(SESSION, server.url);
    // Lazy singleton: page load alone must never construct a context.
    expect(audioState().hasContext).toBe(false);

    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    const state = audioState();
    expect(state.supported).toBe(true);
    expect(state.hasContext).toBe(true);
    expect(state.contextState).toBe("running"); // gesture path must RESUME, not merely exist
    // Level 1 = day band (index 0) with its seeded variation running.
    expect(String(state.musicKey).startsWith("0:")).toBe(true);
    assertConsoleClean();
});

test("M toggles mute both ways, the chip follows, and it persists", () => {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");

    const chipText = () =>
        abEvalJSON(SESSION, "document.getElementById('mute-btn').textContent");

    expect(audioState().muted).toBe(false);
    expect(chipText()).toBe("\u{1F50A}");

    ab(SESSION, "press", "m");
    expect(audioState().muted).toBe(true);
    expect(chipText()).toBe("\u{1F507}");

    ab(SESSION, "press", "m");
    expect(audioState().muted).toBe(false);
    expect(chipText()).toBe("\u{1F50A}");

    // Persistence: mute, reload, the fresh Game boots muted; unmute again so
    // later tests (and later real sessions) start sound-on.
    ab(SESSION, "press", "m");
    openGame(SESSION, server.url);
    expect(audioState().muted).toBe(true);
    expect(chipText()).toBe("\u{1F507}");
    ab(SESSION, "press", "m");
    expect(audioState().muted).toBe(false);
    assertConsoleClean();
});

test("HUD shows the mute chip mid-gameplay (art preview)", () => {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    waitLanded(SESSION);
    const path = screenshot(SESSION, "game-audio-hud.png");
    mkdirSync("/home/ray/art-previews", { recursive: true });
    copyFileSync(path, PREVIEW_PATH);
    const chip = abEvalJSON(
        SESSION,
        `(() => { const b = document.getElementById('mute-btn');
                  const r = b.getBoundingClientRect();
                  return { visible: r.width > 0 && r.height > 0,
                           inHud: !!b.closest('#hud') }; })()`
    );
    expect(chip.visible).toBe(true);
    expect(chip.inHud).toBe(true);
    assertConsoleClean();
});

test("frame rate with music running stays within 10% of muted", async () => {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    waitLanded(SESSION);

    // Independent rAF counter installed in the page; sampled around fixed
    // windows so the game loop's own rAF chain doesn't interfere.
    const installCounter = () => abEvalJSON(
        SESSION,
        `(() => { window.__fps = { frames: 0, t0: performance.now() };
                  const tick = () => { window.__fps.frames++;
                                       requestAnimationFrame(tick); };
                  requestAnimationFrame(tick); return true; })()`
    );
    const sampleFps = () => abEvalJSON(
        SESSION,
        `(() => { const f = window.__fps.frames;
                  const s = (performance.now() - window.__fps.t0) / 1000;
                  window.__fps = { frames: 0, t0: performance.now() };
                  return Math.round(f / s); })()`
    );

    installCounter();
    await Bun.sleep(3000);
    const musicFps = sampleFps();

    ab(SESSION, "press", "m"); // scheduler stops while muted
    await Bun.sleep(3000);
    const mutedFps = sampleFps();
    ab(SESSION, "press", "m"); // leave sound on

    console.log(`audio fps check: music=${musicFps} muted=${mutedFps}`);
    expect(musicFps).toBeGreaterThanOrEqual(mutedFps * 0.9);
    assertConsoleClean();
}, 30000);
