// Wiring smoke tests: the Game <-> audio.js seams under happy-dom, where
// WebAudio does not exist. The point is that every gameplay event site
// (start, pause duck, death stop, M key, HUD chip) runs its audio calls
// unconditionally and the module absorbs their absence silently — plus the
// observable non-audio state (ducked flag, mute label) stays in sync.
import { test, expect, describe } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Game } from "../../js/main.js";
import * as audio from "../../js/audio.js";

installGameTestScaffolding();

describe("audio wiring", () => {
    test("startGame drives the audio init path without throwing", () => {
        mountFixture();
        const game = new Game();
        expect(game.startGame()).toBe(true);
        // No AudioContext exists under happy-dom, so the singleton must
        // still report context-free after the full publishLevel chain
        // (init + startMusic + unduck) ran.
        expect(audio.getState().hasContext).toBe(false);
        expect(audio.getState().supported).toBe(false);
        game.destroy();
    });

    test("M key toggles mute both ways and updates the HUD chip", () => {
        mountFixture();
        const game = new Game();
        const btn = document.getElementById("mute-btn");
        expect(btn.textContent).toBe("\uD83D\uDD0A"); // 🔊
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
        expect(audio.isMuted()).toBe(true);
        expect(btn.textContent).toBe("\uD83D\uDD07"); // 🔇
        expect(btn.getAttribute("aria-pressed")).toBe("true");
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
        expect(audio.isMuted()).toBe(false);
        expect(btn.textContent).toBe("\uD83D\uDD0A");
        expect(btn.getAttribute("aria-pressed")).toBe("false");
        game.destroy();
    });

    test("autorepeat M keydowns do not strobe the mute state", () => {
        mountFixture();
        const game = new Game();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", repeat: true }));
        expect(audio.isMuted()).toBe(false);
        game.destroy();
    });

    test("mute button click toggles audio state and label", () => {
        mountFixture();
        const game = new Game();
        const btn = document.getElementById("mute-btn");
        btn.click();
        expect(audio.isMuted()).toBe(true);
        expect(btn.textContent).toBe("\uD83D\uDD07");
        btn.click();
        expect(audio.isMuted()).toBe(false);
        game.destroy();
    });

    test("pause ducks and resume unducks (observable via getState)", () => {
        mountFixture();
        const game = new Game();
        game.startGame();
        game.togglePause();
        expect(audio.getState().ducked).toBe(true);
        game.togglePause();
        expect(audio.getState().ducked).toBe(false);
        game.destroy();
    });

    test("death, menu exit and level flow stay inert without WebAudio", () => {
        mountFixture();
        const game = new Game();
        expect(() => {
            game.startGame();
            game.handleGameOver("pit");
            game.retryLevel();
            game.handleWin();
            game.handleGameComplete();
            game.returnToMenu();
        }).not.toThrow();
        expect(audio.getState().musicKey).toBeNull();
        game.destroy();
    });

    test("boot reflects a persisted mute preference", () => {
        mountFixture();
        localStorage.setItem("platformerMuted", "true");
        const game = new Game();
        expect(audio.isMuted()).toBe(true);
        expect(document.getElementById("mute-btn").textContent).toBe("\uD83D\uDD07");
        // Neutralise for any file that runs after us on this shared window.
        audio.setMuted(false);
        localStorage.setItem("platformerMuted", "false");
        game.destroy();
    });
});
