// Integration: Wave D touch controls. Pins the coarse-pointer visibility
// gate (matchMedia seam — happy-dom evaluates no stylesheet, so the JS
// .enabled class is the observable), the CSS belt (source pin of the
// (pointer: coarse) guard), and the input contract: button pointer events
// drive InputHandler.touchPress/touchRelease — the SAME logical paths as
// keys, autorepeat-filtered (one held finger = one jump), multi-touch safe
// (run + jump together), dash consuming exactly one air-dash.
import { test, expect, describe, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Game } from "../../js/main.js";

installGameTestScaffolding();

const DT = 1 / 60;

// --- matchMedia seam ---------------------------------------------------------
// One stub for every query: only (pointer: coarse) reports `coarseFlag`.
let coarseFlag = false;
const realMatchMedia = window.matchMedia;
window.matchMedia = (query) => ({
    matches: coarseFlag && /pointer:\s*coarse/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {}
});
afterAll(() => {
    window.matchMedia = realMatchMedia;
});

const TOUCH_HTML = `
    <div id="touch-controls">
        <div class="tc-cluster tc-left">
            <button id="tc-left-btn" aria-label="Move left">LEFT</button>
            <button id="tc-right-btn" aria-label="Move right">RIGHT</button>
        </div>
        <div class="tc-cluster tc-right">
            <button id="tc-dash-btn" aria-label="Dash">DASH</button>
            <button id="tc-jump-btn" aria-label="Jump">JUMP</button>
        </div>
    </div>`;

function mountTouchGame(coarse) {
    coarseFlag = coarse;
    mountFixture();
    document.body.insertAdjacentHTML("beforeend", TOUCH_HTML);
    return new Game();
}

// Pointer events without a real PointerEvent dependency: plain cancelable
// Events carrying the fields the handlers read (pointerId stays undefined,
// exercising the capture guard).
function firePointer(id, type) {
    const el = document.getElementById(id);
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
}
const press = (id) => firePointer(id, "pointerdown");
const lift = (id) => firePointer(id, "pointerup");

function startedGame(coarse = true) {
    const game = mountTouchGame(coarse);
    game.startGame();
    game.update(DT); // ground the spawn through one resolver tick
    expect(game.state).toBe("PLAYING");
    expect(game.player.grounded).toBe(true);
    return game;
}

describe("touch controls — visibility gate", () => {
    test("hidden under fine pointers: no .enabled class", () => {
        const game = mountTouchGame(false);
        expect(document.getElementById("touch-controls")
            .classList.contains("enabled")).toBe(false);
        game.destroy();
    });

    test("shown under coarse pointers: .enabled class added", () => {
        const game = mountTouchGame(true);
        expect(document.getElementById("touch-controls")
            .classList.contains("enabled")).toBe(true);
        game.destroy();
    });

    test("CSS belt: display flips only inside a (pointer: coarse) query", () => {
        const css = readFileSync(new URL("../../css/style.css", import.meta.url),
            "utf8");
        expect(/@media\s*\(pointer:\s*coarse\)/.test(css)).toBe(true);
        // The enabled rule lives INSIDE the coarse block (nearest preceding
        // @media header), not merely somewhere alongside it.
        const enabledAt = css.indexOf("#touch-controls.enabled");
        const coarseAt = css.lastIndexOf("@media (pointer: coarse)", enabledAt);
        const nextMediaAt = css.indexOf("@media", enabledAt);
        expect(enabledAt).toBeGreaterThan(-1);
        expect(coarseAt).toBeGreaterThan(-1);
        expect(nextMediaAt === -1 || coarseAt < nextMediaAt).toBe(true);
    });

    test("buttons are real <button>s with aria-labels (WCAG names)", () => {
        const game = mountTouchGame(true);
        for (const [id, label] of [
            ["tc-left-btn", "Move left"],
            ["tc-right-btn", "Move right"],
            ["tc-jump-btn", "Jump"],
            ["tc-dash-btn", "Dash"]
        ]) {
            const btn = document.getElementById(id);
            expect(btn.tagName).toBe("BUTTON");
            expect(btn.getAttribute("aria-label")).toBe(label);
        }
        game.destroy();
    });
});

describe("touch controls — input contract", () => {
    test("tap JUMP launches once; a held/repeated pointerdown never doubles", () => {
        const game = startedGame();
        press("tc-jump-btn");
        expect(game.player.vy).toBeLessThan(0); // launched
        // Same-finger re-dispatch WITHOUT release: the wasDown filter must
        // swallow it entirely — no second launch AND no buffered press that
        // would silently re-jump on the next landing.
        press("tc-jump-btn");
        expect(game.player.jumpBufferTimer).toBe(0);
        game.update(DT);
        expect(game.player.vy).toBeLessThan(0); // still rising from ONE jump
        lift("tc-jump-btn");
        game.destroy();
    });

    test("release JUMP routes releaseJump (variable height, like Space)", () => {
        const game = startedGame();
        press("tc-jump-btn");
        const vyFull = game.player.vy; // rising at full launch speed
        expect(vyFull).toBeLessThan(0);
        lift("tc-jump-btn");
        // The cut applies synchronously in the callback: still rising, but
        // strictly toward zero — the same arc-shortening a Space keyup does.
        expect(game.player.vy).toBeGreaterThan(vyFull);
        expect(game.player.vy).toBeLessThan(0);
        expect(game.input.isJump()).toBe(false);
        game.destroy();
    });

    test("hold LEFT drives movement; release stops (same paths as arrows)", () => {
        const game = startedGame();
        press("tc-left-btn");
        expect(game.input.isLeft()).toBe(true);
        game.update(DT);
        expect(game.player.vx).toBeLessThan(0);
        lift("tc-left-btn");
        expect(game.input.isLeft()).toBe(false);
        // stopLeft released the drive flag: carried speed now decays through
        // the normal ground brake instead of holding (no new input).
        const vxAfterLift = game.player.vx;
        for (let f = 0; f < 8; f++) game.update(DT);
        expect(Math.abs(game.player.vx)).toBeLessThan(Math.abs(vxAfterLift));
        game.destroy();
    });

    test("multi-touch: hold LEFT while tapping JUMP — both register", () => {
        const game = startedGame();
        press("tc-left-btn");
        press("tc-jump-btn"); // simultaneous second finger
        expect(game.input.isLeft()).toBe(true);
        expect(game.player.vy).toBeLessThan(0);
        game.update(DT);
        expect(game.player.vx).toBeLessThan(0); // running while airborne
        expect(game.player.vy).toBeLessThan(0);
        lift("tc-jump-btn");
        lift("tc-left-btn");
        game.destroy();
    });

    test("DASH button consumes exactly one air-dash per arc", () => {
        const game = startedGame();
        press("tc-jump-btn"); // leave the ground
        game.update(DT);
        expect(game.player.grounded).toBe(false);
        press("tc-dash-btn");
        expect(game.player.airDashUsed).toBe(true);
        expect(game.player.dashTimer).toBeGreaterThan(0);
        const burstAfterFirst = game.player.dashTimer;
        // Release and press again WHILE STILL AIRBORNE: the arc is spent,
        // pressDash must reject — dashTimer unchanged (no recharge, no
        // second burst).
        lift("tc-dash-btn");
        // The release must clear the held dash key too: touchRelease routes
        // through the same keys.delete as keyup, so no latched dash state can
        // survive a lifted finger.
        expect(game.input.isDash()).toBe(false);
        press("tc-dash-btn");
        expect(game.player.dashTimer).toBe(burstAfterFirst);
        game.destroy();
    });

    test("pause button tap still works alongside the pad (DOM click path)", () => {
        const game = startedGame();
        document.getElementById("pause-btn").click();
        expect(game.state).toBe("PAUSED");
        document.getElementById("pause-btn").click();
        expect(game.state).toBe("PLAYING");
        game.destroy();
    });

    test("fixtures without touch nodes boot untouched (all-optional binding)", () => {
        coarseFlag = true;
        mountFixture(); // NO touch markup
        const game = new Game();
        expect(game.startGame()).toBe(true);
        game.destroy();
    });
});
