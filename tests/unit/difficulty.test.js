import { test, expect } from "bun:test";
import { Difficulty } from "../../js/difficulty.js";

test("Difficulty returns correct level size", () => {
    const difficulty = new Difficulty();

    expect(difficulty.getLevelSize(1)).toEqual({ width: 20, height: 15 });
    expect(difficulty.getLevelSize(5)).toEqual({ width: 24, height: 18 });
    expect(difficulty.getLevelSize(10)).toEqual({ width: 28, height: 21 });
});

test("Difficulty returns correct enemy count", () => {
    const difficulty = new Difficulty();

    // Shipped levels 2-4 derive enemies via min(5, floor(n/2)); the tier
    // cap must not clamp them below what generation already places.
    expect(difficulty.getMaxEnemies(1)).toBe(2);
    expect(difficulty.getMaxEnemies(5)).toBe(5);
    expect(difficulty.getMaxEnemies(10)).toBe(8);
});

test("Difficulty determines if timer is enabled", () => {
    const difficulty = new Difficulty();

    expect(difficulty.isTimerEnabled(1)).toBe(false);
    expect(difficulty.isTimerEnabled(5)).toBe(true);
    expect(difficulty.isTimerEnabled(10)).toBe(true);
});
