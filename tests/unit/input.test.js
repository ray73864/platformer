import { test, expect } from "bun:test";
import { InputHandler } from "../../js/input.js";

test("InputHandler tracks multiple keys simultaneously", () => {
    const input = new InputHandler();

    // Simulate key down events
    input.handleKeyDown({ code: "ArrowLeft" });
    input.handleKeyDown({ code: "Space" });

    expect(input.isLeft()).toBe(true);
    expect(input.isRight()).toBe(false);
    expect(input.isJump()).toBe(true);
});

test("InputHandler releases keys correctly", () => {
    const input = new InputHandler();

    input.handleKeyDown({ code: "ArrowLeft" });
    expect(input.isLeft()).toBe(true);

    input.handleKeyUp({ code: "ArrowLeft" });
    expect(input.isLeft()).toBe(false);
});

test("InputHandler handles multiple movement keys", () => {
    const input = new InputHandler();

    input.handleKeyDown({ code: "ArrowLeft" });
    input.handleKeyDown({ code: "ArrowRight" });

    // Both can be pressed simultaneously (diagonal movement support)
    expect(input.isLeft()).toBe(true);
    expect(input.isRight()).toBe(true);
});

test("InputHandler callbacks trigger on key events", () => {
    const input = new InputHandler();
    let leftCalled = false;
    let rightCalled = false;
    let jumpCalled = false;

    input.onMoveLeft(() => { leftCalled = true; });
    input.onMoveRight(() => { rightCalled = true; });
    input.onJump(() => { jumpCalled = true; });

    input.handleKeyDown({ code: "ArrowLeft" });
    input.handleKeyDown({ code: "ArrowRight" });
    input.handleKeyDown({ code: "Space" });

    expect(leftCalled).toBe(true);
    expect(rightCalled).toBe(true);
    expect(jumpCalled).toBe(true);
});

test("InputHandler handles WASD keys", () => {
    const input = new InputHandler();

    input.handleKeyDown({ code: "KeyA" });
    input.handleKeyDown({ code: "KeyD" });
    input.handleKeyDown({ code: "Space" });

    expect(input.isLeft()).toBe(true);
    expect(input.isRight()).toBe(true);
    expect(input.isJump()).toBe(true);
});

test("autorepeat keydowns do not re-fire callbacks", () => {
    // Regression for the dead wasPressed stub: OS autorepeat re-fires keydown
    // without an intervening keyup; only the INITIAL press may fire a
    // callback (holding Space must not re-jump on every landing).
    const input = new InputHandler();
    let jumpCount = 0;
    let leftCount = 0;
    input.onJump(() => { jumpCount++; });
    input.onMoveLeft(() => { leftCount++; });

    input.handleKeyDown({ code: "Space" });
    input.handleKeyDown({ code: "Space" }); // autorepeat
    input.handleKeyDown({ code: "ArrowLeft" });
    input.handleKeyDown({ code: "ArrowLeft" }); // autorepeat

    expect(jumpCount).toBe(1);
    expect(leftCount).toBe(1);

    // A real release + press fires again.
    input.handleKeyUp({ code: "Space" });
    input.handleKeyDown({ code: "Space" });
    expect(jumpCount).toBe(2);
});

test("key-only events (no code) resolve to physical-code spellings", () => {
    // Regression for the CDP-harness case: with event.code absent, letters
    // must map to 'KeyX' so consumers comparing 'KeyA'/'KeyD' still match.
    const input = new InputHandler();

    input.handleKeyDown({ key: "a" });
    input.handleKeyDown({ key: "d" });
    input.handleKeyDown({ key: " " });

    expect(input.isLeft()).toBe(true);
    expect(input.isRight()).toBe(true);
    expect(input.isJump()).toBe(true);

    input.handleKeyUp({ key: "a" });
    expect(input.isLeft()).toBe(false);
});

test("held keys are released when the window loses focus", () => {
    // Regression for stuck-key driving after alt-tab: blur must clear the
    // pressed-key set (browsers swallow the held key's keyup).
    const input = new InputHandler();

    input.handleKeyDown({ code: "ArrowRight" });
    expect(input.isRight()).toBe(true);

    window.dispatchEvent(new Event("blur"));
    expect(input.isRight()).toBe(false);
});

test("Shift is tracked as the walk modifier (both sides)", () => {
    const input = new InputHandler();
    expect(input.isWalk()).toBe(false);

    input.handleKeyDown({ code: "ShiftLeft" });
    expect(input.isWalk()).toBe(true);
    input.handleKeyUp({ code: "ShiftLeft" });
    input.handleKeyDown({ code: "ShiftRight" });
    expect(input.isWalk()).toBe(true);

    // Blur clears held keys like every other binding: no latched walk mode.
    window.dispatchEvent(new Event("blur"));
    expect(input.isWalk()).toBe(false);
});

test("jump keyup fires the release-jump callback (variable jump height)", () => {
    const input = new InputHandler();
    let releases = 0;
    input.onReleaseJump(() => { releases++; });

    input.handleKeyDown({ code: "Space" });
    expect(releases).toBe(0);                       // press is not a release
    input.handleKeyUp({ code: "Space" });
    expect(releases).toBe(1);
});

test("Space targeting a focused button does not fire the jump callback", () => {
    // Regression for I1: a focused <button> activates on Space at keyup (UI
    // Events spec), so firing the jump callback too made one press both jump
    // and click the button. While a control holds focus, Space belongs to it.
    const input = new InputHandler();
    let jumpCount = 0;
    input.onJump(() => { jumpCount++; });

    const button = document.createElement("button");
    input.handleKeyDown({ code: "Space", target: button });
    expect(jumpCount).toBe(0);

    // Focus back on the page (body / no target): gameplay jump as normal.
    input.handleKeyUp({ code: "Space" });
    input.handleKeyDown({ code: "Space" });
    expect(jumpCount).toBe(1);
    input.handleKeyUp({ code: "Space" });
    input.handleKeyDown({ code: "Space", target: document.body });
    expect(jumpCount).toBe(2);
});
