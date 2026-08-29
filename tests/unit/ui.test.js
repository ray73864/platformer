import { test, expect } from "bun:test";
import { UI } from "../../js/ui.js";

expect.extend({
    toHaveClass(received, className) {
        const has = received?.classList?.contains(className) ?? false;
        return {
            pass: has,
            message: () => `expected element ${has ? "not " : ""}to have class '${className}'`,
        };
    },
});

test("UI shows HUD elements", () => {
    const ui = new UI();

    // Should be able to show HUD without errors
    expect(() => ui.showHUD()).not.toThrow();
});

test("UI updates score display", () => {
    const ui = new UI();

    ui.updateScore(100);

    // Verify score was updated (implementation would check DOM)
    expect(ui.getScore()).toBe(100);
});

test("UI updates level display", () => {
    const ui = new UI();

    ui.updateLevel(3);

    // Verify level was updated
    expect(ui.getLevel()).toBe(3);
});

test("UI shows and hides overlays", () => {
    const ui = new UI();

    ui.showOverlay('menu-screen');
    expect(document.getElementById('menu-screen')).not.toHaveClass('hidden');

    ui.hideOverlay('menu-screen');
    expect(document.getElementById('menu-screen')).toHaveClass('hidden');
});

test("UI shows game over screen", () => {
    const ui = new UI();

    expect(() => ui.showGameOver(100)).not.toThrow();
});

test("UI shows level complete screen", () => {
    const ui = new UI();

    expect(() => ui.showLevelComplete()).not.toThrow();
});
