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
