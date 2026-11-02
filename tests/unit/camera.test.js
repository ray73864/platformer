import { test, expect } from "bun:test";
import { Camera } from "../../js/camera.js";

test("Camera follows player horizontally", () => {
    const camera = new Camera(800, 600);
    const player = { x: 500, y: 100, width: 32, height: 32 };

    camera.follow(player, 1000);

    // Follow contract (ratified deviation from the plan reference): the
    // player's top-left is placed at the view centre, so its box centre sits
    // half a sprite to the right. Tests govern this behaviour; see S27 in
    // paad/code-reviews/feature-phase1-core-engine-2026-10-31-13-00-39-cbbb3eb.md.
    expect(camera.x).toBeCloseTo(500 - 800 / 2, 0);
});

test("Camera centres a level narrower than the viewport", () => {
    const camera = new Camera(800, 600);
    const player = { x: 100, y: 100, width: 32, height: 32 };

    camera.follow(player, 500); // Level is narrower than view

    // Centred: negative offset puts equal sky on both flanks (the old
    // clamp-to-0 pinned small levels against the left edge).
    expect(camera.x).toBe((500 - 800) / 2);
});

test("Camera centres a level shorter than the viewport", () => {
    const camera = new Camera(800, 600);
    const player = { x: 200, y: 100, width: 32, height: 32 };

    camera.follow(player, 1000, 400); // Level is shorter than view

    // screen_y = world_y + camera.y: positive pushes the world down to centre.
    expect(camera.y).toBe((600 - 400) / 2);
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

test("Camera vertical clamp bounds the world-top offset by level height", () => {
    const camera = new Camera(800, 300);
    const player = { x: 500, y: 2000, width: 32, height: 32 };

    // Level is 480px tall; view top can never exceed 480 - 300 = 180.
    camera.follow(player, 1000, 480);

    expect(camera.y).toBe(-180);
});
