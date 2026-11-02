import { test, expect } from "bun:test";
import { spawnBurst, stepParticles, drawParticles, MAX_PARTICLES } from "../../js/particles.js";

test("spawnBurst adds the requested sparks around the origin", () => {
    const list = [];
    spawnBurst(list, 100, 200, '#ffd23f', 8);
    expect(list.length).toBe(8);
    for (const p of list) {
        expect(p.x).toBeCloseTo(100, 6);
        expect(p.y).toBeCloseTo(200, 6);
        expect(p.color).toBe('#ffd23f');
        expect(p.life).toBeGreaterThan(0);
    }
});

test("the particle list is hard-capped at MAX_PARTICLES", () => {
    const list = [];
    for (let i = 0; i < 30; i++) spawnBurst(list, 0, 0, '#fff', 10); // 300 wanted
    expect(list.length).toBe(MAX_PARTICLES);
});

test("stepParticles moves, gravitates and expires particles", () => {
    const list = [];
    spawnBurst(list, 0, 0, '#fff', 4);
    const before = list.map(p => ({ x: p.x, y: p.y, vy: p.vy }));

    stepParticles(list, 0.1);

    expect(list.length).toBe(4);
    for (let i = 0; i < 4; i++) {
        expect(list[i].y).not.toBe(before[i].y);
        expect(list[i].vy).toBeGreaterThan(before[i].vy); // gravity pulls down
    }

    // Run past the maximum lifetime (0.8 s): everything is gone.
    let remaining = list.length;
    for (let i = 0; i < 10 && remaining > 0; i++) {
        stepParticles(list, 0.1);
        remaining = list.length;
    }
    expect(list.length).toBe(0);
});

test("drawParticles restores globalAlpha to 1", () => {
    const calls = [];
    const ctx = {
        globalAlpha: 1,
        fillStyle: '',
        fillRect(...args) { calls.push(args); }
    };
    const list = [];
    spawnBurst(list, 10, 10, '#abc', 3);
    drawParticles(ctx, list);
    expect(calls.length).toBe(3);
    expect(ctx.globalAlpha).toBe(1);
});
