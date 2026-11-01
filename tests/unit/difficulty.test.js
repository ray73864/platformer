import { test, expect } from "bun:test";
import { Difficulty } from "../../js/difficulty.js";

test("Difficulty returns correct level size", () => {
    const difficulty = new Difficulty();

    expect(difficulty.getLevelSize(1)).toEqual({ width: 20, height: 15 });
    expect(difficulty.getLevelSize(4)).toEqual({ width: 20, height: 15 });
    expect(difficulty.getLevelSize(5)).toEqual({ width: 24, height: 18 });
    expect(difficulty.getLevelSize(10)).toEqual({ width: 28, height: 21 });
});

test("Difficulty returns correct enemy count", () => {
    const difficulty = new Difficulty();

    // Levels 1-4 ship zero enemies (placeEnemyMarkers gates at level 5).
    expect(difficulty.getMaxEnemies(1)).toBe(0);
    expect(difficulty.getMaxEnemies(5)).toBe(5);
    expect(difficulty.getMaxEnemies(9)).toBe(5);
    expect(difficulty.getMaxEnemies(10)).toBe(8);
});

test("Difficulty determines if timer is enabled", () => {
    const difficulty = new Difficulty();

    expect(difficulty.isTimerEnabled(1)).toBe(false);
    expect(difficulty.isTimerEnabled(5)).toBe(true);
    expect(difficulty.isTimerEnabled(9)).toBe(true);
    expect(difficulty.isTimerEnabled(10)).toBe(true);
});
