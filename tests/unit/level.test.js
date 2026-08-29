import { test, expect } from "bun:test";
import { Level, canReach } from "../../js/level.js";

test("Level generates with correct dimensions", () => {
    const level = new Level(1, 32);

    expect(level.width).toBe(20);
    expect(level.height).toBe(15);
    expect(level.tileSize).toBe(32);
});

test("Level generates platforms", () => {
    const level = new Level(1, 32);

    // Should have some solid platforms
    const solidPlatforms = level.getPlatforms().filter(p => p.type === 'solid');

    expect(solidPlatforms.length).toBeGreaterThan(0);
});

test("Level generates coins", () => {
    const level = new Level(1, 32);

    const coins = level.getCoins();

    expect(coins.length).toBeGreaterThanOrEqual(5);
});

test("Level generates portal", () => {
    const level = new Level(1, 32);

    const portal = level.getPortal();

    expect(portal).toBeDefined();
    expect(portal.x).toBeGreaterThan(0);
    expect(portal.y).toBeGreaterThan(0);
});

test("Level generates spawn point", () => {
    const level = new Level(1, 32);

    const spawn = level.getSpawnPoint();

    expect(spawn).toBeDefined();
    expect(spawn.x).toBeGreaterThanOrEqual(0);
    expect(spawn.y).toBeGreaterThanOrEqual(0);
});

test("Level generates with pathfinding verification", () => {
    // This test verifies that the level generation includes reachability checks
    const level = new Level(1, 32);

    // The portal should be reachable from spawn
    // (Implementation would verify this with BFS/DFS)

    expect(level.hasValidPath()).toBe(true);
});

test("Level renders tiles correctly", () => {
    const level = new Level(1, 32);

    // Should be able to draw without errors
    const mockCtx = {
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        fillStyle: null,
        strokeStyle: null,
        lineWidth: null
    };

    expect(() => level.draw(mockCtx)).not.toThrow();
});

test("pathfinder rejects a walled-off portal and accepts an open route", () => {
    // Fixture grid: 12 wide x 8 tall. Bottom row (y=7) is solid so the
    // standing surface is y=6 across the whole level.
    const width = 12;
    const height = 8;

    const makeGrid = () => {
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        for (let x = 0; x < width; x++) {
            tiles[height - 1][x] = 1;
        }
        return tiles;
    };

    const spawnTile = { x: 1, y: height - 2 };
    const portalTile = { x: 9, y: height - 2 };

    // Full-height wall at column 6 blocks walking and jumping (climb <= 1).
    const walled = makeGrid();
    for (let y = 0; y < height - 1; y++) {
        walled[y][6] = 1;
    }
    expect(canReach(walled, width, height, spawnTile, portalTile)).toBe(false);

    // Same wall with a door gap at standing height: now reachable.
    const open = makeGrid();
    for (let y = 0; y < height - 3; y++) {
        open[y][6] = 1;
    }
    expect(canReach(open, width, height, spawnTile, portalTile)).toBe(true);
});

test("generated levels are always reachable across level numbers", () => {
    for (let n = 1; n <= 8; n++) {
        const level = new Level(n, 32);
        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);
    }
});
