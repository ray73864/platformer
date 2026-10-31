import { test, expect } from "bun:test";
import { Level, canReach, computeReachable } from "../../js/level.js";

function countType(tiles, type) {
    let n = 0;
    for (const row of tiles) {
        for (const t of row) {
            if (t === type) n++;
        }
    }
    return n;
}

// Collect every tile coordinate of the given type, in row-major order.
function tilesOfType(tiles, type) {
    const found = [];
    for (let y = 0; y < tiles.length; y++) {
        for (let x = 0; x < tiles[y].length; x++) {
            if (tiles[y][x] === type) found.push({ x, y });
        }
    }
    return found;
}

test("Level generates with correct dimensions", () => {
    const level = new Level(1, 32);

    expect(level.width).toBe(20);
    expect(level.height).toBe(15);
    expect(level.tileSize).toBe(32);
});

test("Phase 2 levels are larger; early levels keep 20x15", () => {
    for (const n of [1, 4]) {
        const level = new Level(n, 32);
        expect(level.width).toBe(20);
        expect(level.height).toBe(15);
    }
    for (const n of [5, 7, 9]) {
        const level = new Level(n, 32);
        expect(level.width).toBe(24);
        expect(level.height).toBe(18);
    }
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
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        fill: () => {},
        fillStyle: null,
        strokeStyle: null,
        lineWidth: null
    };

    expect(() => level.draw(mockCtx)).not.toThrow();
});

test("Phase 2 level renders spikes and enemies without errors", () => {
    const level = new Level(7, 32);

    // Spikes draw as triangles (moveTo/lineTo) and enemies delegate through
    // EnemyManager.drawAll; the mock must survive both paths.
    const mockCtx = {
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
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

test("pathfinder crosses a 2-wide bottomless pit but not one beyond jump range", () => {
    // Two ground shelves over a solid floor row, separated by a bottomless
    // pit (columns with no tiles at all). Standing surface is y=6.
    const width = 18;
    const height = 8;

    const makeShelves = (pitStart, pitEnd) => {
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        for (let x = 0; x < width; x++) {
            if (x >= pitStart && x <= pitEnd) continue; // bottomless columns
            tiles[height - 1][x] = 1;
        }
        return tiles;
    };

    const spawnTile = { x: 3, y: height - 2 };
    const portalTile = { x: 14, y: height - 2 };

    // Pit spanning columns 7-8 (width 2): jumpable within the scan bound.
    expect(canReach(makeShelves(7, 8), width, height, spawnTile, portalTile)).toBe(true);

    // Pit spanning columns 6-10 (width 5): nearest landing is 6 columns from
    // the last standable edge tile, beyond the ~4-tile physical jump range.
    expect(canReach(makeShelves(6, 10), width, height, spawnTile, portalTile)).toBe(false);
});

test("generated levels are always reachable across level numbers", () => {
    for (let n = 1; n <= 9; n++) {
        const level = new Level(n, 32);
        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);
    }
});

test("levels 1-4 emit no spike or enemy marker tiles", () => {
    // Phase 2 elements appear only at level >= 5: the early-game ramp and
    // existing E2E flows stay untouched.
    for (let n = 1; n <= 4; n++) {
        for (let i = 0; i < 5; i++) {
            const level = new Level(n, 32);
            expect(countType(level.tiles, 2)).toBe(0);
            expect(countType(level.tiles, 4)).toBe(0);
            expect(level.getHazards().getSpikes()).toEqual([]);
            expect(level.getEnemyManager().enemies).toEqual([]);
        }
    }
});

test("Phase 2 levels place surface spikes within density and safe zones", () => {
    for (const n of [5, 7, 9]) {
        const level = new Level(n, 32);
        const w = level.width;
        const h = level.height;
        const spikes = tilesOfType(level.tiles, 2);

        expect(spikes.length).toBeGreaterThan(0);
        // Spec density cap: at most 10% of all tiles.
        expect(spikes.length).toBeLessThanOrEqual(Math.floor(w * h * 0.1));

        for (const s of spikes) {
            // Never inside the spawn zone (x < 6) or portal band (x >= w-4).
            expect(s.x).toBeGreaterThanOrEqual(6);
            expect(s.x).toBeLessThanOrEqual(w - 5);
            // Surface hazard only: air tile directly above solid ground.
            expect(s.y).toBeLessThan(h - 1);
            expect(level.tiles[s.y + 1][s.x]).toBe(1);
        }

        // Extraction mirrors the grid exactly: one pixel-space rect per
        // type-2 tile at the tile origin.
        const rects = level.getHazards().getSpikes();
        expect(rects.length).toBe(spikes.length);
        for (const s of spikes) {
            expect(rects).toContainEqual({
                x: s.x * 32,
                y: s.y * 32,
                width: 32,
                height: 32
            });
        }
    }
});

test("enemy markers sit on standable tiles atop runs at least 3 wide", () => {
    for (const n of [5, 7, 9]) {
        const level = new Level(n, 32);
        const target = Math.min(5, Math.floor(n / 2));
        const markers = tilesOfType(level.tiles, 4);

        expect(markers.length).toBeGreaterThan(0);
        expect(markers.length).toBeLessThanOrEqual(target);

        for (const m of markers) {
            // Standable: air tile with solid ground beneath.
            expect(level.tiles[m.y + 1][m.x]).toBe(1);
            // Patrol exists: contiguous solid run under the walk row >= 3.
            let left = m.x;
            while (level.tiles[m.y + 1][left - 1] === 1) left--;
            let right = m.x;
            while (level.tiles[m.y + 1][right + 1] === 1) right++;
            expect(right - left + 1).toBeGreaterThanOrEqual(3);
        }

        // Spawned enemies never exceed the validated markers on the grid.
        expect(level.getEnemyManager().enemies.length)
            .toBeLessThanOrEqual(markers.length);
    }
});

test("BFS treats a spike strip wider than jump range as a barrier, and jumps shorter strips", () => {
    // Fixture grid: 14 wide x 8 tall, solid bottom row so the standing
    // surface is row 6. Spikes sit on that surface (air above solid).
    const width = 14;
    const height = 8;

    const makeGrid = (spikeCols) => {
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        for (let x = 0; x < width; x++) {
            tiles[height - 1][x] = 1;
        }
        for (const sx of spikeCols) {
            tiles[height - 2][sx] = 2;
        }
        return tiles;
    };

    const spawnTile = { x: 1, y: height - 2 };
    const portalTile = { x: 12, y: height - 2 };

    // 4-wide strip (columns 6-9): every landing column within the 4-column
    // scan bound is either a spike tile (never standable, breaks the
    // downward scan) or unreachable; the strip cannot be crossed.
    expect(canReach(makeGrid([6, 7, 8, 9]), width, height, spawnTile, portalTile)).toBe(false);

    // 3-wide strip (columns 6-8): a flat jump clears it onto column 9
    // (distance 4), so the route survives.
    expect(canReach(makeGrid([6, 7, 8]), width, height, spawnTile, portalTile)).toBe(true);
});

test("BFS never marks spike tiles or their tips as reachable", () => {
    const width = 14;
    const height = 8;
    const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
    for (let x = 0; x < width; x++) {
        tiles[height - 1][x] = 1;
    }
    for (const sx of [6, 7, 8]) {
        tiles[height - 2][sx] = 2;
    }

    const reachable = computeReachable(
        tiles,
        width,
        height,
        { x: 1, y: height - 2 }
    );

    for (const sx of [6, 7, 8]) {
        // Inside the spike tile: death, never a standing position.
        expect(reachable.has((height - 2) * width + sx)).toBe(false);
        // Standing on the spike tip: the spike provides no support.
        expect(reachable.has((height - 3) * width + sx)).toBe(false);
    }
});

test("50 constructions of level 7 stay valid", () => {
    // Bounded stress: generation plus conservative validation must reliably
    // produce solvable levels once Phase 2 elements are in play.
    for (let i = 0; i < 50; i++) {
        const level = new Level(7, 32);
        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);
    }
});
