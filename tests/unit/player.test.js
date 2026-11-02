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
    // Stopping is a ground behaviour: airborne coast is ballistic by design.
    player.grounded = true;
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

test("grounded coast brakes to a full stop quickly (no ice slide)", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.vx = 200;

    let slides = 0;
    let t = 0;
    const dt = 1 / 60;
    while (player.vx > 0 && t < 1) {
        const x0 = player.x;
        player.update(dt, false, false);
        slides += Math.abs(player.x - x0);
        t += dt;
    }

    // Crisp stop: under 0.1 s and under 12 px of world travel from full
    // speed (the old exponential decay drifted ~0.5 s / ~20 px).
    expect(t).toBeLessThan(0.1);
    expect(slides).toBeLessThan(12);
});

test("airborne coast keeps ballistic drift (release does not slam)", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vx = 200;

    player.update(1 / 60, false, false);

    // Still carrying most horizontal speed one frame after release.
    expect(player.vx).toBeGreaterThan(190);
});
