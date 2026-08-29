import { test, expect } from "bun:test";
import { Camera } from "../../js/camera.js";

test("Camera follows player horizontally", () => {
    const camera = new Camera(800, 600);
    const player = { x: 500, y: 100, width: 32, height: 32 };

    camera.follow(player, 1000);

    // Camera should center on player
    expect(camera.x).toBeCloseTo(500 - 800 / 2, 0);
});

test("Camera stays within level bounds", () => {
    const camera = new Camera(800, 600);
    const player = { x: 100, y: 100, width: 32, height: 32 };

    camera.follow(player, 500); // Level is narrower than view

    // Camera should not go negative
    expect(camera.x).toBe(0);
});

test("Camera resets correctly", () => {
    const camera = new Camera(800, 600);
    const player = { x: 500, y: 100, width: 32, height: 32 };

    camera.follow(player, 1000);
    camera.reset();

    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
});

test("Camera handles vertical movement", () => {
    const camera = new Camera(800, 600);
    const player = { x: 200, y: 400, width: 32, height: 32 };

    camera.follow(player, 1000);

    // Camera should adjust for vertical movement
    expect(camera.y).toBeLessThan(0); // Player is in lower portion
});

test("Camera handles different screen sizes", () => {
    const camera1 = new Camera(800, 600);
    const camera2 = new Camera(1024, 768);

    expect(camera1.width).toBe(800);
    expect(camera1.height).toBe(600);
    expect(camera2.width).toBe(1024);
    expect(camera2.height).toBe(768);
});
