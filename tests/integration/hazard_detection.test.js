// Integration seam: Level tile grid -> Hazards -> Player death signals.
//
// Unit tests already pin the inset hitbox, aggregation, and pit threshold
// semantics on hand-built spikes. These tests run hazards extracted from a
// REAL generated Level's grid (the generator does not emit type-2 tiles until
// Task 5, so they are injected here) and anchor the pit death line to the
// Level's own dimensions rather than a magic canvas height. They fail if
// Level stops delegating hazard extraction to its exposed Hazards instance,
// if the grid->pixel translation drifts, or if callers pass anything other
// than world-pixel level height for the pit check.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { Hazards } from "../../js/hazards.js";
import { Player } from "../../js/player.js";

const TILE = 32;
const PLAYER_SPEED = 200; // Mirrors main.js constants used by startLevel()
const JUMP_FORCE = 350;
// PIT_DEATH_MARGIN_PX in hazards.js: the grace distance below the bottom of
// the level grid before a falling player dies.
const PIT_GRACE_PX = 100;

// Place a spike tile on the forced flat spawn ground (columns 0-5 are solid
// from row height-3 down) and let the Level re-extract hazards from its grid.
function injectGroundSpike(level, tileX) {
    const tileY = level.height - 3;
    expect(level.tiles[tileY][tileX]).toBe(1);
    level.tiles[tileY][tileX] = 2;
    level.extractHazards();
    return level.getHazards().getSpikes().find(
        spike => spike.x === tileX * TILE && spike.y === tileY * TILE
    );
}

test("Level extracts injected type-2 tiles into pixel-space spikes on its exposed Hazards instance", () => {
    const level = new Level(1, TILE);
    level.tiles[level.height - 3][4] = 2;
    level.extractHazards();

    const hazards = level.getHazards();
    expect(hazards).toBeInstanceOf(Hazards);

    // The spike must land at the tile's pixel position with the full tile
    // rect stored (the inset applies at collision time, not storage). Located
    // by position rather than total count so Task 5's generator spikes cannot
    // break this seam assertion.
    const spike = hazards.getSpikes().find(
        s => s.x === 4 * TILE && s.y === (level.height - 3) * TILE
    );
    expect(spike).toBeDefined();
    expect(spike.width).toBe(TILE);
    expect(spike.height).toBe(TILE);
});

test("a real Player brushing only the decorative ring of a Level-extracted spike survives; entering the core kills", () => {
    const level = new Level(1, TILE);
    const hazards = level.getHazards();
    const spike = injectGroundSpike(level, 4);
    expect(spike).toBeDefined();

    const player = new Player(0, 0, PLAYER_SPEED, JUMP_FORCE);

    // Standing on the spawn ground far from the injected spike: alive.
    const spawn = level.getSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    expect(hazards.checkPlayerSpikes(player)).toBe(false);

    // Flush against the inset hitbox's left edge (4px inset per side): the
    // strict comparisons make an edge-touch survive while the body still
    // overlaps the decorative outer ring of the tile.
    player.x = spike.x - (player.width - 4);
    player.y = spike.y;
    expect(hazards.checkPlayerSpikes(player)).toBe(false);

    // One pixel into the lethal core: death signal.
    player.x += 1;
    expect(hazards.checkPlayerSpikes(player)).toBe(true);
});

test("pit death line is anchored to the real Level's dimensions, not a canvas height", () => {
    const level = new Level(1, TILE);
    const hazards = level.getHazards();
    // Contract from hazards.js: callers pass level.height * tileSize in
    // world/CSS pixels. Derived from the actual Level instance here.
    const levelHeightPx = level.height * level.tileSize;

    const player = new Player(0, 0, PLAYER_SPEED, JUMP_FORCE);

    // A player standing at the level's spawn point is nowhere near death.
    const spawn = level.getSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    expect(hazards.checkPitFall(player, levelHeightPx)).toBe(false);

    // Exactly at the threshold survives (strict `>`); one pixel past it dies.
    player.y = levelHeightPx + PIT_GRACE_PX;
    expect(hazards.checkPitFall(player, levelHeightPx)).toBe(false);
    player.y = levelHeightPx + PIT_GRACE_PX + 1;
    expect(hazards.checkPitFall(player, levelHeightPx)).toBe(true);
});
