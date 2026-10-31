import { test, expect } from "bun:test";
import { Entity } from "../../js/entities.js";

test("Entity has required properties", () => {
    const entity = new Entity(100, 100, 32, 32);

    expect(entity.x).toBe(100);
    expect(entity.y).toBe(100);
    expect(entity.width).toBe(32);
    expect(entity.height).toBe(32);
    expect(entity.vx).toBe(0);
    expect(entity.vy).toBe(0);
});

test("Entity updates position correctly", () => {
    const entity = new Entity(100, 100, 32, 32);

    entity.vx = 50;
    entity.vy = 30;

    entity.update(0.016); // ~60 FPS
    expect(entity.x).toBeCloseTo(100 + 50 * 0.016, 2);
    // Single-integration contract: y is owned by Physics.applyGravity. If
    // Entity.update integrated y too, every gravity/jump displacement would
    // double once both run on the same frame in Game.update().
    expect(entity.y).toBe(100);
});
