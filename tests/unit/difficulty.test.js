import { test, expect } from "bun:test";
import { Difficulty } from "../../js/difficulty.js";

test("Difficulty returns correct level size", () => {
    const difficulty = new Difficulty();

    expect(difficulty.getLevelSize(1)).toEqual({ width: 20, height: 15 });
    expect(difficulty.getLevelSize(4)).toEqual({ width: 20, height: 15 });
    expect(difficulty.getLevelSize(5)).toEqual({ width: 24, height: 18 });
    expect(difficulty.getLevelSize(10)).toEqual({ width: 28, height: 21 });
});

test("Phase 3 tiers step in at their exact boundaries", () => {
    const difficulty = new Difficulty();

    // advanced holds through 24, expert starts at 25.
    expect(difficulty.getLevelSize(24)).toEqual({ width: 28, height: 21 });
    expect(difficulty.getLevelSize(25)).toEqual({ width: 32, height: 24 });
    // master starts at 50.
    expect(difficulty.getLevelSize(49)).toEqual({ width: 32, height: 24 });
    expect(difficulty.getLevelSize(50)).toEqual({ width: 36, height: 27 });
    // legend starts at 75 and holds through the final level.
    expect(difficulty.getLevelSize(74)).toEqual({ width: 36, height: 27 });
    expect(difficulty.getLevelSize(75)).toEqual({ width: 40, height: 30 });
    expect(difficulty.getLevelSize(100)).toEqual({ width: 40, height: 30 });

    // Enemy caps follow the same boundaries.
    expect(difficulty.getMaxEnemies(24)).toBe(8);
    expect(difficulty.getMaxEnemies(25)).toBe(10);
    expect(difficulty.getMaxEnemies(49)).toBe(10);
    expect(difficulty.getMaxEnemies(50)).toBe(12);
    expect(difficulty.getMaxEnemies(74)).toBe(12);
    expect(difficulty.getMaxEnemies(75)).toBe(14);
    expect(difficulty.getMaxEnemies(100)).toBe(14);

    // Run clock stays on for every Phase 2+ tier.
    for (const n of [25, 50, 75, 100]) {
        expect(difficulty.isTimerEnabled(n)).toBe(true);
        expect(difficulty.hasPhase2Content(n)).toBe(true);
    }
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
