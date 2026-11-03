// Unit seam: the pure score-economy math (owner ruling 2026-11-04).
//
// clearBonusFor is the whole "clear a level, reduced for issues" decision;
// the combat constants are the "killing/dodging pays" half. Both live as
// module-level exports in main.js beside deathScorePenalty, and the guard
// style mirrors it: never throw, always whole points, corrupt input falls
// back on the conservative side (reduced bonus, never a free flawless one).
import { test, expect } from "bun:test";
import {
    clearBonusFor,
    CLEAR_BONUS_BASE,
    CLEAR_BONUS_TIER_STEP,
    CLEAR_BONUS_REDUCED_RATE,
    STOMP_POINTS,
    CHARGER_STOMP_POINTS,
    DODGE_POINTS
} from "../../js/main.js";
import { COIN_POINTS } from "../../js/collectibles.js";

test("clearBonusFor pays the full base for zero deaths on a basic-tier level", () => {
    expect(clearBonusFor(0, 1)).toBe(100);
    expect(clearBonusFor(0, 4)).toBe(100); // still basic (levels 1-4)
});

test("clearBonusFor scales one tier step per difficulty boundary crossed", () => {
    // Boundaries from difficulty.js TIER_BOUNDARIES: 5, 10, 25, 50, 75.
    expect(clearBonusFor(0, 5)).toBe(110);   // intermediate
    expect(clearBonusFor(0, 9)).toBe(110);
    expect(clearBonusFor(0, 10)).toBe(120);  // advanced
    expect(clearBonusFor(0, 24)).toBe(120);
    expect(clearBonusFor(0, 25)).toBe(130);  // expert
    expect(clearBonusFor(0, 49)).toBe(130);
    expect(clearBonusFor(0, 50)).toBe(140);  // master
    expect(clearBonusFor(0, 74)).toBe(140);
    expect(clearBonusFor(0, 75)).toBe(150);  // legend
    expect(clearBonusFor(0, 100)).toBe(150); // FINAL_LEVEL plateaus at legend
});

test("clearBonusFor drops to the floored 40% rate for any deaths", () => {
    expect(clearBonusFor(1, 1)).toBe(40);   // floor(100 * 0.4)
    expect(clearBonusFor(2, 1)).toBe(40);
    expect(clearBonusFor(7, 1)).toBe(40);   // many deaths: same reduced floor
    expect(clearBonusFor(1, 5)).toBe(44);   // floor(110 * 0.4)
    expect(clearBonusFor(1, 10)).toBe(48);
    expect(clearBonusFor(1, 25)).toBe(52);
    expect(clearBonusFor(1, 50)).toBe(56);
    expect(clearBonusFor(1, 75)).toBe(60);
});

test("clearBonusFor guards fall back conservatively, mirroring deathScorePenalty", () => {
    // Corrupt death counts NEVER hand out the flawless payout: only the
    // exact integer 0 is flawless.
    for (const bad of [NaN, -1, 1.5, Infinity, "0", null, undefined]) {
        expect(clearBonusFor(bad, 1)).toBe(40);
    }
    // Invalid level numbers read as the basic tier (difficulty.configFor's
    // fallback) without throwing.
    for (const bad of [0, -3, 2.5, NaN, "x", null, undefined]) {
        expect(clearBonusFor(0, bad)).toBe(100);
        expect(clearBonusFor(1, bad)).toBe(40);
    }
});

test("clearBonusFor always returns whole positive points", () => {
    for (let deaths = 0; deaths <= 5; deaths++) {
        for (const level of [1, 5, 10, 25, 50, 75, 100]) {
            const bonus = clearBonusFor(deaths, level);
            expect(Number.isInteger(bonus)).toBe(true);
            expect(bonus).toBeGreaterThan(0);
        }
    }
});

test("constant table keeps its stated relationship to COIN_POINTS", () => {
    // The "not too easy" ruling expressed as arithmetic: coins stay the
    // backbone, a stomp is a skill premium, a dodge is a thank-you.
    expect(CLEAR_BONUS_BASE).toBe(10 * COIN_POINTS);
    expect(CLEAR_BONUS_TIER_STEP).toBe(COIN_POINTS);
    expect(CLEAR_BONUS_REDUCED_RATE).toBe(0.4);
    expect(STOMP_POINTS).toBe(2.5 * COIN_POINTS);
    expect(CHARGER_STOMP_POINTS).toBeGreaterThan(STOMP_POINTS); // mid-dash risk
    expect(DODGE_POINTS).toBeLessThan(COIN_POINTS);             // half a coin
});
