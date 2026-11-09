// Wave C victory-confetti pins: hard pool cap, deterministic placement
// (no RNG drift between boots), and the reduced-motion static variant.
import { test, expect } from "bun:test";
import {
    MAX_CONFETTI, CONFETTI_LIFE, CONFETTI_STATIC_LIFE, CONFETTI_COLORS,
    spawnConfetti, stepConfetti, drawConfetti
} from "../../js/fx.js";

test("confetti pool is hard-capped at 60", () => {
    const list = [];
    for (let i = 0; i < 5; i++) spawnConfetti(list, 800, 600, true);
    expect(list.length).toBe(MAX_CONFETTI);
    expect(MAX_CONFETTI).toBeLessThanOrEqual(60);
});

test("spawn replaces the pool — repeated bursts never stack", () => {
    const list = [];
    spawnConfetti(list, 800, 600, true);
    spawnConfetti(list, 800, 600, true);
    expect(list.length).toBe(MAX_CONFETTI);
});

test("placement is deterministic: same seed renders the same burst", () => {
    const a = spawnConfetti([], 900, 640, true);
    const b = spawnConfetti([], 900, 640, true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // And every piece sits inside/above the screen with a palette colour.
    for (const p of a) {
        expect(CONFETTI_COLORS).toContain(p.color);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(900);
    }
});

test("animated pieces fall; the static variant hangs motionless", () => {
    const moving = spawnConfetti([], 800, 600, true);
    const still = spawnConfetti([], 800, 600, false);
    for (const p of still) {
        expect(p.vx).toBe(0);
        expect(p.vy).toBe(0);
        expect(p.sway).toBe(0);
    }
    const y0 = moving.map(p => p.y);
    stepConfetti(moving, 0.5);
    stepConfetti(still, 0.5);
    expect(moving.some((p, i) => p.y !== y0[i])).toBe(true);
    // Static burst: zero travel, age advances toward its shorter life.
    for (const p of still) expect(p.age).toBeCloseTo(0.5, 6);
});

test("both variants expire and empty the pool", () => {
    const moving = spawnConfetti([], 800, 600, true);
    stepConfetti(moving, CONFETTI_LIFE + 0.01);
    expect(moving.length).toBe(0);
    const still = spawnConfetti([], 800, 600, false);
    stepConfetti(still, CONFETTI_STATIC_LIFE + 0.01);
    expect(still.length).toBe(0);
});

test("drawConfetti paints rects and restores globalAlpha", () => {
    const ops = [];
    const ctx = {
        globalAlpha: 1, fillStyle: '',
        fillRect: (x, y, w, h) => ops.push([x, y, w, h])
    };
    drawConfetti(ctx, spawnConfetti([], 800, 600, false));
    expect(ops.length).toBe(MAX_CONFETTI);
    expect(ctx.globalAlpha).toBe(1);
});
