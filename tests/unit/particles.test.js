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

// ---------------------------------------------------------------------------
// Look-A ambient field: hard cap including climb flecks, firefly ground band,
// falling-fleck motion, and draw-gating so flecks only exist mid-ascent.
// ---------------------------------------------------------------------------
import { createMotes, stepMotes, drawMotes, MAX_MOTES } from "../../js/particles.js";

test("the mote field respects the hard cap including climb flecks", () => {
    const list = createMotes(40, 1234, 1200, 700, { fireflies: true, flecks: 14 });
    expect(list.length).toBeLessThanOrEqual(MAX_MOTES);
    expect(MAX_MOTES).toBe(40);
    expect(list.filter(m => m.fleck).length).toBe(14);
});

test("fireflies spawn in the ground band; day dust fills the air", () => {
    const night = createMotes(20, 99, 1200, 700, { fireflies: true });
    for (const m of night) expect(m.y).toBeGreaterThanOrEqual(700 * 0.58 - 1e-9);
    const day = createMotes(20, 99, 1200, 700);
    expect(day.some(m => m.y < 700 * 0.5)).toBe(true);
});

test("flecks fall (height cue), motes rise", () => {
    const list = createMotes(6, 7, 800, 600, { flecks: 4 });
    const fleck = list.find(m => m.fleck && m.y < 500);
    const mote = list.find(m => !m.fleck);
    const fy = fleck.y, my = mote.y;
    stepMotes(list, 0.1, 800, 600);
    expect(fleck.y).toBeGreaterThan(fy);
    expect(mote.y).toBeLessThan(my);
});

test("climb flecks render only while climbing", () => {
    const list = createMotes(1, 5, 800, 600, { flecks: 3 });
    let rects = 0;
    const ctx = {
        globalAlpha: 1, fillStyle: '',
        beginPath() {}, arc() {}, fill() {}, fillRect() { rects++; }
    };
    drawMotes(ctx, list, 0, 800, '#fff', false, false);
    expect(rects).toBe(0);
    drawMotes(ctx, list, 0, 800, '#fff', false, true);
    expect(rects).toBe(3);
    expect(ctx.globalAlpha).toBe(1);
});
