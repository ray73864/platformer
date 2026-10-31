import { test, expect } from "bun:test";
import { Hazards } from "../../js/hazards.js";
import { Level } from "../../js/level.js";

// Spike tiles are 32x32; collision uses a 24x24 hitbox inset 4px on every
// side, so a spike at (100, 200) is lethal only within (104..128, 204..228).
const SPIKE_X = 100;
const SPIKE_Y = 200;

function spikeHazards() {
    const hazards = new Hazards();
    hazards.addSpike(SPIKE_X, SPIKE_Y);
    return hazards;
}

test("Hazards starts with no spikes", () => {
    const hazards = new Hazards();

    expect(hazards.getSpikes()).toEqual([]);
});

test("addSpike stores the full 32x32 tile rect", () => {
    const hazards = new Hazards();

    hazards.addSpike(64, 96);

    expect(hazards.getSpikes()).toEqual([
        { x: 64, y: 96, width: 32, height: 32 }
    ]);
});

test("checkSpikeCollision detects an overlapping player", () => {
    const hazards = spikeHazards();

    // Player centre-deep into the spike tile: overlaps the inset hitbox.
    const player = { x: SPIKE_X + 5, y: SPIKE_Y + 5, width: 32, height: 32 };

    expect(hazards.checkSpikeCollision(player, hazards.getSpikes()[0])).toBe(true);
});

test("checkSpikeCollision returns false for a separated player", () => {
    const hazards = spikeHazards();

    const player = { x: 0, y: 0, width: 32, height: 32 };

    expect(hazards.checkSpikeCollision(player, hazards.getSpikes()[0])).toBe(false);
});

test("checkSpikeCollision treats touching edges as no collision", () => {
    const hazards = spikeHazards();

    // Player right edge sits exactly on the inset hitbox left edge (104).
    const player = { x: 72, y: SPIKE_Y + 10, width: 32, height: 10 };

    expect(hazards.checkSpikeCollision(player, hazards.getSpikes()[0])).toBe(false);
});

test("overlapping only the outer 4px ring of a spike tile does not kill", () => {
    const hazards = spikeHazards();
    const spike = hazards.getSpikes()[0];

    // Strips inside the left and top insets: they touch the tile but stay
    // clear of the 24x24 lethal core.
    const leftRing = { x: SPIKE_X, y: SPIKE_Y, width: 3, height: 32 };
    const topRing = { x: SPIKE_X + 10, y: SPIKE_Y, width: 10, height: 3 };

    expect(hazards.checkSpikeCollision(leftRing, spike)).toBe(false);
    expect(hazards.checkSpikeCollision(topRing, spike)).toBe(false);

    // Sensitivity check: one pixel deeper crosses the inset boundary.
    const crossingLeftInset = { x: SPIKE_X, y: SPIKE_Y, width: 5, height: 32 };

    expect(hazards.checkSpikeCollision(crossingLeftInset, spike)).toBe(true);
});

test("checkPlayerSpikes returns a single true for multiple contacts", () => {
    const hazards = new Hazards();
    // Two adjacent spike tiles; a wide player overlaps both cores at once.
    hazards.addSpike(100, 200);
    hazards.addSpike(132, 200);

    const player = { x: 105, y: 205, width: 40, height: 10 };

    // Boolean signal: two contacts still yield exactly one death trigger.
    expect(hazards.checkPlayerSpikes(player)).toBe(true);
});

test("checkPlayerSpikes returns false when no spike overlaps", () => {
    const hazards = spikeHazards();

    const player = { x: 0, y: 0, width: 32, height: 32 };

    expect(hazards.checkPlayerSpikes(player)).toBe(false);
});

test("checkPitFall returns true below the death line", () => {
    const hazards = new Hazards();

    // Death line: levelHeightPx (480) + 100 margin = 580.
    expect(hazards.checkPitFall({ y: 581 }, 480)).toBe(true);
});

test("checkPitFall is false exactly at the death line", () => {
    const hazards = new Hazards();

    // Matches main.js shipped semantics (strict >): the exact threshold
    // value is still alive.
    expect(hazards.checkPitFall({ y: 580 }, 480)).toBe(false);
});

test("checkPitFall is false while the player is on screen", () => {
    const hazards = new Hazards();

    expect(hazards.checkPitFall({ y: 100 }, 480)).toBe(false);
});

test("Level wires a Hazards instance and exposes it via getHazards", () => {
    const level = new Level(1, 32);
    const hazards = level.getHazards();

    expect(hazards).toBeInstanceOf(Hazards);
    // The tile generator does not emit type-2 spike tiles until Task 5, so
    // extraction finds none today; the wiring itself must still hold.
    expect(hazards.getSpikes()).toEqual([]);
});

test("extractHazards picks up type-2 spike tiles from the grid", () => {
    const level = new Level(1, 32);

    // Plant spike tiles directly and re-extract: (3, 5) and (7, 9) become
    // pixel-space spike rects at the tile origin.
    level.tiles[5][3] = 2;
    level.tiles[9][7] = 2;
    level.extractHazards();

    expect(level.getHazards().getSpikes()).toEqual([
        { x: 3 * 32, y: 5 * 32, width: 32, height: 32 },
        { x: 7 * 32, y: 9 * 32, width: 32, height: 32 }
    ]);
});
