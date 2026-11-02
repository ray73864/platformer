import { test, expect } from "bun:test";
import { Physics } from "../../js/physics.js";

test("Physics applies gravity correctly", () => {
    const physics = new Physics(980, 600);

    const player = {
        y: 100,
        vy: 0,
        height: 32
    };

    physics.applyGravity(player, 0.016); // ~60 FPS

    expect(player.vy).toBeGreaterThan(0);
    expect(player.y).toBeGreaterThan(100);
});

test("Physics limits max fall speed", () => {
    const physics = new Physics(980, 600);

    const player = {
        y: 100,
        vy: 700, // Above max
        height: 32
    };

    physics.applyGravity(player, 0.016);

    expect(player.vy).toBeLessThanOrEqual(600);
});

test("Physics detects AABB collision", () => {
    const physics = new Physics(980, 600);

    const player = { x: 50, y: 100, width: 32, height: 32 };
    const platform = { x: 40, y: 120, width: 100, height: 32 };

    const collision = physics.checkAABB(player, platform);

    expect(collision).toBe(true);
});

test("Physics detects no collision when objects don't overlap", () => {
    const physics = new Physics(980, 600);

    const player = { x: 0, y: 0, width: 32, height: 32 };
    const platform = { x: 100, y: 100, width: 32, height: 32 };

    const collision = physics.checkAABB(player, platform);

    expect(collision).toBe(false);
});

test("Physics resolves collisions by separating axes", () => {
    const physics = new Physics(980, 600);

    const player = { x: 50, y: 100, width: 32, height: 32, vx: 0, vy: 0 };
    const platforms = [
        { x: 40, y: 120, width: 100, height: 32 }
    ];

    const collisions = physics.checkCollisions(player, platforms);
    physics.resolveCollisions(player, collisions);

    // Player should be stopped by platform
    expect(player.y).toBeLessThanOrEqual(120 - 32); // Top of platform
});

test("Physics handles multiple platforms", () => {
    const physics = new Physics(980, 600);

    const player = { x: 50, y: 100, width: 32, height: 32, vx: 0, vy: 0 };
    const platforms = [
        { x: 40, y: 120, width: 100, height: 32 },
        { x: 80, y: 80, width: 100, height: 32 }
    ];

    const collisions = physics.checkCollisions(player, platforms);

    expect(collisions.length).toBeGreaterThanOrEqual(1);
});

test("side contact at a gap wall is not a landing (no corner-climbing)", () => {
    const physics = new Physics(980, 600);

    // Player has sunk 12px below the far platform's top while falling into a
    // gap, then drifted right into its side: feet were NOT above the surface
    // last frame, so this must not resolve as a landing.
    const player = {
        x: 96, y: 112, width: 32, height: 32, vx: 200, vy: 300,
        prevY: 100, grounded: false
    };
    const farWall = { x: 120, y: 120, width: 32, height: 32 };

    physics.resolveCollisions(player, physics.checkCollisions(player, [farWall]));

    expect(player.grounded).toBe(false);
    // Pushed back out of the wall on X, not snapped onto its top.
    expect(player.x + player.width).toBeLessThanOrEqual(farWall.x + 0.001);
});

test("a genuine landing still grounds when prevY was above the surface", () => {
    const physics = new Physics(980, 600);

    // Resting contact: feet sat exactly on the surface before gravity nudged
    // them a fraction of a pixel into it this frame.
    const player = {
        x: 50, y: 88.3, width: 32, height: 32, vx: 0, vy: 16,
        prevY: 88, grounded: false
    };
    const floor = { x: 40, y: 120, width: 100, height: 32 };

    physics.resolveCollisions(player, physics.checkCollisions(player, [floor]));

    expect(player.grounded).toBe(true);
    expect(player.y).toBeLessThanOrEqual(88 + 0.001);
});

test("walking into a same-height platform lip is a wall, not a landing", () => {
    const physics = new Physics(980, 600);

    // Feet sat exactly at the far platform's top height last frame and only
    // entered its horizontal span this frame (1.3px clip): must be blocked
    // on X, never snapped up onto the surface.
    const player = {
        x: 89.3, y: 88.3, width: 32, height: 32, vx: 200, vy: 16,
        prevX: 86, prevY: 88, grounded: false
    };
    const farLedge = { x: 120, y: 120, width: 32, height: 32 };

    physics.resolveCollisions(player, physics.checkCollisions(player, [farLedge]));

    expect(player.grounded).toBe(false);
    expect(player.x + player.width).toBeLessThanOrEqual(farLedge.x + 0.001);
});

test("standing still on a platform keeps grounding (prev overlap intact)", () => {
    const physics = new Physics(980, 600);

    const player = {
        x: 50, y: 88.3, width: 32, height: 32, vx: 0, vy: 16,
        prevX: 50, prevY: 88, grounded: false
    };
    const floor = { x: 40, y: 120, width: 100, height: 32 };

    physics.resolveCollisions(player, physics.checkCollisions(player, [floor]));

    expect(player.grounded).toBe(true);
});
