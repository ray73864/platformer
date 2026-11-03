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

    // Baseline the overlay as hidden first: an ensureElement-created element
    // never had the class, so asserting "not hidden" straight after
    // showOverlay() could never fail (vacuous assertion).
    ui.hideOverlay('menu-screen');
    expect(document.getElementById('menu-screen')).toHaveClass('hidden');

    ui.showOverlay('menu-screen');
    expect(document.getElementById('menu-screen')).not.toHaveClass('hidden');

    ui.hideOverlay('menu-screen');
    expect(document.getElementById('menu-screen')).toHaveClass('hidden');
});

test("UI shows game over screen", () => {
    const ui = new UI();

    expect(() => ui.showGameOver(100)).not.toThrow();
});

test("showGameOver renders the death penalty line when charged, hides it otherwise", () => {
    // The penalty node is structural in index.html; guarantee it for the
    // shared unit-test window regardless of file execution order.
    let penaltyEl = document.getElementById('score-penalty');
    if (!penaltyEl) {
        penaltyEl = document.createElement('p');
        penaltyEl.id = 'score-penalty';
        penaltyEl.hidden = true;
        document.body.appendChild(penaltyEl);
    }
    const ui = new UI();

    ui.showGameOver(93, 'pit', 30);
    expect(ui.finalScoreElement.textContent).toBe('Score: 93');
    expect(penaltyEl.hidden).toBe(false);
    expect(penaltyEl.textContent).toBe('-30 points');

    // Old call shape (no penalty argument): nothing lost, nothing shown.
    ui.showGameOver(0, 'pit');
    expect(penaltyEl.hidden).toBe(true);
    expect(ui.finalScoreElement.textContent).toBe('Score: 0');
});

test("UI shows level complete screen", () => {
    const ui = new UI();

    expect(() => ui.showLevelComplete()).not.toThrow();
});

test("score/level writers log once per HUD-failure episode (spec §Score Tracking)", () => {
    const ui = new UI();
    const scoreEl = document.getElementById('score-display');
    const levelEl = document.getElementById('level-display');
    const originalError = console.error;
    let logged = 0;
    console.error = () => { logged++; };
    try {
        scoreEl.remove();
        ui.updateScore(5);
        ui.updateScore(6); // every-frame writer: must not log twice
        expect(logged).toBe(1);

        levelEl.remove();
        ui.updateLevel(2);
        expect(logged).toBe(2); // separate episode per display element

        // Restoring the element re-arms the flag for a future episode.
        document.body.appendChild(scoreEl);
        ui.updateScore(7);
        expect(logged).toBe(2);
        expect(ui.getScore()).toBe(7);
        scoreEl.remove();
        ui.updateScore(8);
        expect(logged).toBe(3);
    } finally {
        console.error = originalError;
        document.body.appendChild(scoreEl);
        document.body.appendChild(levelEl);
    }
});

test("updateTimer logs once per HUD-failure episode (S3)", () => {
    const ui = new UI();
    const timerEl = document.getElementById('timer-display');
    const originalError = console.error;
    let logged = 0;
    console.error = () => { logged++; };
    try {
        timerEl.remove();
        ui.updateTimer(30);
        ui.updateTimer(29); // every-frame writer: must not log twice
        expect(logged).toBe(1);

        // Restoring the element re-arms the flag and writes again.
        document.body.appendChild(timerEl);
        ui.updateTimer(28);
        expect(logged).toBe(1);
        expect(timerEl.textContent).toBe('Time: 0:28');
    } finally {
        console.error = originalError;
        document.body.appendChild(timerEl);
    }
});

test("showErrorMessage reveals the alert and hides it again", async () => {
    const ui = new UI();

    ui.showErrorMessage('boom', 50);
    const el = document.getElementById('error-message');
    expect(el.textContent).toBe('boom');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el).not.toHaveClass('hidden');

    await Bun.sleep(80);
    expect(el).toHaveClass('hidden');

    // hideErrorMessage is safe to call again and clears any pending timer.
    ui.showErrorMessage('boom again', 5000);
    ui.hideErrorMessage();
    expect(el).toHaveClass('hidden');
});
