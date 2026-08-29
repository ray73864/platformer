import { test, expect } from "bun:test";
import { Player } from "../../js/player.js";

test("Player moves left", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveLeft();
    player.update(0.016, true, false);

    expect(player.vx).toBeLessThan(0);
});

test("Player moves right", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveRight();
    player.update(0.016, false, true);

    expect(player.vx).toBeGreaterThan(0);
});

test("Player jumps", () => {
    const player = new Player(100, 100, 200, 350);

    player.jump();

    expect(player.vy).toBeLessThan(0); // Negative vy = upward
});

test("Player stops when no keys pressed", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveRight();
    player.update(0.016, false, true);

    const initialVx = player.vx;

    player.stopLeft();
    player.stopRight();
    player.update(0.016, false, false);

    // Velocity should decrease due to deceleration
    expect(player.vx).toBeLessThan(initialVx);
});

test("Player has state tracking", () => {
    const player = new Player(100, 100, 200, 350);

    expect(player.isGrounded()).toBe(false);

    player.grounded = true;
    expect(player.isGrounded()).toBe(true);
});

test("Player has portal reachability flag", () => {
    const player = new Player(100, 100, 200, 350);

    expect(player.hasReachedPortal()).toBe(false);

    player.reachedPortal = true;
    expect(player.hasReachedPortal()).toBe(true);
});
