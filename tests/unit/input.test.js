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
