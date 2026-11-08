// Unit: pushable crates (M3). Pins the physics contract from crates.js:
// push kinematics at exactly CRATE_PUSH_SPEED, engagement geometry (side
// contact only — standing on top never pushes), gravity landing, containment
// walls stopping a pushed crate flush with the world edge, the SPLIT-axis
// resolution regression (full-height side walls must never read as a Y
// landing — the 256 px teleport bug found during development), pad immunity,
// and non-stompability by type.
import { test, expect } from "bun:test";
import {
    Crate, CRATE_SIZE, CRATE_PUSH_SPEED, PUSH_CONTACT_EPS,
    cratePushDirection, stepCrate, crateContainmentWalls
} from "../../js/crates.js";
import { Physics } from "../../js/physics.js";
import { Enemy } from "../../js/enemies.js";

const DT = 1 / 60;
const G = 980;
const FLOOR = [{ x: -2000, y: 576, width: 8000, height: 64 }];

const mkCrate = (x = 300, y = 576 - CRATE_SIZE) =>
    new Crate({ x, y, col: x / 32, row: (y - 576 + CRATE_SIZE) / 32 });
const phys = () => new Physics(G, 600);

test("size mirror equals the shipped TILE_SIZE", async () => {
    const { TILE_SIZE } = await import("../../js/main.js");
    expect(CRATE_SIZE).toBe(TILE_SIZE);
});

test("push-walk advances exactly CRATE_PUSH_SPEED*dt per frame", () => {
    const physics = phys();
    const c = mkCrate();
    const x0 = c.x;
    for (let f = 0; f < 30; f++) stepCrate(c, physics, FLOOR, DT, 1);
    expect(c.x - x0).toBeCloseTo(30 * CRATE_PUSH_SPEED * DT, 10);
    expect(c.pushed).toBe(true);
});

test("no push direction without grounded side contact", () => {
    const c = mkCrate();
    const flushRight = {
        grounded: true, prevX: c.x - 24, prevY: c.y + 8, width: 24, height: 48
    };
    expect(cratePushDirection(flushRight, c, 1)).toBe(1);
    // Airborne into the face: no push (you cannot shove it mid-flight).
    expect(cratePushDirection({ ...flushRight, grounded: false }, c, 1)).toBe(0);
    // A gap beyond the contact epsilon: walking beside, not touching.
    expect(cratePushDirection(
        { ...flushRight, prevX: c.x - 24 - PUSH_CONTACT_EPS - 0.5 }, c, 1)).toBe(0);
    // Standing ON TOP (feet flush with crate top): strict vertical overlap
    // fails — riding never drags the crate.
    const rider = {
        grounded: true, prevX: c.x + 4, prevY: c.y - 48, width: 24, height: 48
    };
    expect(cratePushDirection(rider, c, 1)).toBe(0);
    expect(cratePushDirection(rider, c, -1)).toBe(0);
});

test("crate falls under gravity and rests grounded on terrain", () => {
    const physics = phys();
    const c = mkCrate(300, 300);
    for (let f = 0; f < 120; f++) stepCrate(c, physics, FLOOR, DT, 0);
    expect(c.grounded).toBe(true);
    expect(c.y).toBe(576 - CRATE_SIZE);
    expect(c.vy).toBe(0);
});

test("containment walls stop a pushed crate flush with the world edge", () => {
    const physics = phys();
    const W = 24 * 32;
    const walls = crateContainmentWalls(W, 15 * 32);
    const c = mkCrate(W - 64);
    for (let f = 0; f < 120; f++) stepCrate(c, physics, FLOOR, DT, 1, walls);
    expect(c.x).toBe(W - CRATE_SIZE);   // right face exactly at the edge
    expect(c.grounded).toBe(true);       // and still resting on the floor
});

test("REGRESSION: tall side walls never teleport the crate vertically", () => {
    // resolveYCollision compares body centres against candidate rects; a full-
    // height wall rect sitting beside a grounded crate reads as a bogus
    // landing and used to snap the crate 256 px off its feet. Walls may join
    // the X pass ONLY — this pins that split.
    const physics = phys();
    const W = 24 * 32;
    const walls = crateContainmentWalls(W, 15 * 32);
    const c = mkCrate(W - CRATE_SIZE - 2); // already against the right wall
    const y0 = 576 - CRATE_SIZE;
    c.y = y0;
    for (let f = 0; f < 30; f++) stepCrate(c, physics, FLOOR, DT, 1, walls);
    expect(c.y).toBe(y0);                // no vertical jump…
    expect(c.x).toBe(W - CRATE_SIZE);    // …while X still clamps at the wall
});

test("a crate crossing a pad cell stays put — pads read the player only", async () => {
    const { LaunchPad } = await import("../../js/pads.js");
    const physics = phys();
    const c = mkCrate(300);
    new LaunchPad(300, 576 - 32); // a pad sitting right under the crate's feet
    for (let f = 0; f < 20; f++) stepCrate(c, physics, FLOOR, DT, 1);
    // Immunity is structural: stepCrate never consults pads, so no impulse
    // can enter the crate channel however the pocket is dressed.
    expect(c.vy).toBe(0);
    expect(c.grounded).toBe(true);
});

test("a crate is not an Enemy: stomp machinery cannot see it", () => {
    expect(mkCrate() instanceof Enemy).toBe(false);
});
