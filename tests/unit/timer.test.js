import { test, expect } from "bun:test";
import { Timer } from "../../js/timer.js";

test("Timer counts down correctly", () => {
    const timer = new Timer(60); // 60 seconds

    timer.update(0.016); // ~60 FPS frame

    expect(timer.timeRemaining).toBeLessThan(60);
});

test("Coin bonus adds time to timer", () => {
    const timer = new Timer(60);
    const initialTime = timer.getTimeRemaining();

    timer.addCoinBonus();

    expect(timer.getTimeRemaining()).toBe(initialTime + 2); // +2 seconds
});

test("Timer handles zero time (game over)", () => {
    const timer = new Timer(1);

    timer.update(1.5); // Exceed time limit

    expect(timer.isTimeUp()).toBe(true);
});

// Spec §Error Handling (timer integrity): clamp to 0–9999 s and fall back to
// the default on a corrupt value instead of running a clock that never
// expires or displays nonsense.
test("timeRemaining clamps at the 9999 s ceiling", () => {
    const timer = new Timer(9998);

    timer.addCoinBonus();
    timer.addCoinBonus();
    timer.addCoinBonus();

    expect(timer.getTimeRemaining()).toBe(9999);
});

test("a corrupt timeRemaining recovers to the default on the next tick", () => {
    const timer = new Timer(60);
    timer.timeRemaining = NaN;

    timer.update(1);

    expect(Number.isFinite(timer.getTimeRemaining())).toBe(true);
    expect(timer.getTimeRemaining()).toBeCloseTo(59, 6);
});

test("a corrupt baseTime cannot reinstate the corruption it repairs (S5)", () => {
    const timer = new Timer(60);
    timer.baseTime = 'sixty';
    timer.timeRemaining = NaN;

    timer.update(1);

    // Without validating the fallback, timeRemaining would stay NaN and
    // isTimeUp() false forever: a clock that never expires, warning-free.
    expect(Number.isFinite(timer.getTimeRemaining())).toBe(true);
    expect(timer.getTimeRemaining()).toBeCloseTo(59, 6);
});

test("negative timeRemaining clamps to zero", () => {
    const timer = new Timer(60);
    timer.timeRemaining = -5;

    timer.update(0);

    expect(timer.getTimeRemaining()).toBe(0);
    expect(timer.isTimeUp()).toBe(true);
});
