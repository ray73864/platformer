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

test("invalid level numbers warn and default to the basic tier", () => {
    const difficulty = new Difficulty();
    const originalConsole = console.warn;
    let logged = 0;
    console.warn = () => { logged++; };
    try {
        for (const invalid of [NaN, -1, 0, 2.5, '5', undefined, null]) {
            expect(difficulty.getLevelSize(invalid)).toEqual({ width: 20, height: 15 });
            expect(difficulty.getMaxEnemies(invalid)).toBe(0);
            expect(difficulty.isTimerEnabled(invalid)).toBe(false);
            // Same validity contract on the generation gate: an invalid level
            // must not report Phase 2 content while the tier lookups above
            // answered basic.
            expect(difficulty.hasPhase2Content(invalid)).toBe(false);
        }
        // One warning per tier lookup (3 per invalid value).
        expect(logged).toBe(21);
    } finally {
        console.warn = originalConsole;
    }
});
