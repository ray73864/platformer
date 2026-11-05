import { test, expect } from "bun:test";
import { Level, canReach, computeReachable } from "../../js/level.js";
import { Hazards } from "../../js/hazards.js";

// Deterministic PRNG (mulberry32) so a generation can be replayed exactly.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Per-direction band where spike (type 2) and enemy-marker (type 4) tiles
// are allowed during generation:
// - 'right': canonical columns x ∈ [6, w-6] (spawn zone x < 6, portal band
//   x >= w-4 excluded). The one-column buffer at w-6 keeps a patrol clamped
//   to this band disjoint from the portal band; the old w-5 bound let the
//   mirrored band [4, w-7] overlap the left portal band [2, 4] at column 4.
// - 'left': the same canonical placement mirrored (x -> w-1-x), so the
//   allowed band mirrors to x ∈ [5, w-7].
// - 'vertical': rows between the bottom spawn neighborhood (y >= h-6) and
//   the top portal band (y <= 4) excluded, leaving y ∈ [5, h-7].
function allowedHazardRange(level) {
    if (level.direction === "vertical") {
        return { axis: "y", min: 5, max: level.height - 7 };
    }
    if (level.direction === "left") {
        return { axis: "x", min: 5, max: level.width - 7 };
    }
    return { axis: "x", min: 6, max: level.width - 6 };
}

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

test("Phase 2 levels are larger; vertical direction uses a 15x24 grid", () => {
    // Early levels keep the shipped footprint and face right.
    for (const n of [1, 4]) {
        const level = new Level(n, 32);
        expect(level.direction).toBe("right");
        expect(level.width).toBe(20);
        expect(level.height).toBe(15);
    }
    // Phase 2 horizontal directions keep the larger footprint...
    for (const n of [5, 6, 8, 9]) {
        const level = new Level(n, 32);
        expect(["right", "left"]).toContain(level.direction);
        expect(level.width).toBe(24);
        expect(level.height).toBe(18);
    }
    // ...while vertical levels climb a taller, narrower grid.
    const vertical = new Level(7, 32);
    expect(vertical.direction).toBe("vertical");
    expect(vertical.width).toBe(15);
    expect(vertical.height).toBe(24);
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
    for (const n of [5, 6, 7, 8, 9]) {
        const level = new Level(n, 32);
        const w = level.width;
        const h = level.height;
        const range = allowedHazardRange(level);
        const spikes = tilesOfType(level.tiles, 2);

        // Vertical climbs earn difficulty from the ascent; spikes there are
        // opportunistic (fair mid-shelf spots barely exist alongside the
        // forced route) and presence is only required horizontally.
        if (level.direction !== 'vertical') {
            expect(spikes.length).toBeGreaterThan(0);
        }
        // Spec density cap: at most 10% of all tiles.
        expect(spikes.length).toBeLessThanOrEqual(Math.floor(w * h * 0.1));

        for (const s of spikes) {
            // Never inside the direction's spawn zone or portal band.
            expect(s[range.axis]).toBeGreaterThanOrEqual(range.min);
            expect(s[range.axis]).toBeLessThanOrEqual(range.max);
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

test("enemy markers sit on standable tiles and patrols stay walkable, banded, and clear of spawn/portal", () => {
    for (const n of [5, 6, 7, 8, 9]) {
        for (let build = 0; build < 5; build++) {
            const level = new Level(n, 32);
            const target = Math.min(5, Math.floor(n / 2));
            const range = allowedHazardRange(level);
            const markers = tilesOfType(level.tiles, 4);

            // The validation loop rejects zero-marker constructions at
            // level 5+, so this is deterministic, not a terrain lottery.
            expect(markers.length).toBeGreaterThan(0);
            expect(markers.length).toBeLessThanOrEqual(target);

            for (const m of markers) {
                // Never inside the direction's spawn zone or portal band.
                expect(m[range.axis]).toBeGreaterThanOrEqual(range.min);
                expect(m[range.axis]).toBeLessThanOrEqual(range.max);
                // Standable: air tile with solid ground beneath.
                expect(level.tiles[m.y + 1][m.x]).toBe(1);
            }

            const band = level.patrolBandBounds();
            const spawn = level.getSpawnTile();
            const portalCol = Math.floor(level.portal.x / 32);
            const enemies = level.getEnemyManager().enemies;
            expect(enemies.length).toBeLessThanOrEqual(markers.length);

            for (const e of enemies) {
                const y = e.y / 32;
                const leftTile = e.minX / 32;
                const rightTile = e.maxX / 32 - 1;
                expect(rightTile).toBeGreaterThanOrEqual(leftTile);
                // Patrol bounds contain the spawn position.
                expect(e.x).toBeGreaterThanOrEqual(e.minX);
                expect(e.x + e.width).toBeLessThanOrEqual(e.maxX);

                for (let c = leftTile; c <= rightTile; c++) {
                    // I4: no rock or spike anywhere along the walk row.
                    expect(level.tiles[y][c]).not.toBe(1);
                    expect(level.tiles[y][c]).not.toBe(2);
                    // And every patrolled column has real support.
                    expect(level.tiles[y + 1][c]).toBe(1);
                }

                if (level.direction !== "vertical") {
                    // I3: the band clamp keeps patrols out of the spawn
                    // column and the portal column entirely.
                    expect(leftTile).toBeGreaterThanOrEqual(band[0]);
                    expect(rightTile).toBeLessThanOrEqual(band[1]);
                    expect(leftTile <= spawn.x && spawn.x <= rightTile)
                        .toBe(false);
                    expect(leftTile <= portalCol && portalCol <= rightTile)
                        .toBe(false);
                }
            }
        }
    }
});

test("coins may sit on tiles an enemy patrol sweeps (ruling 2026-11-04)", () => {
    // The old rule excluded patrol-covered tiles ("bait for a kill"). The
    // player ruling removed it: enemies have zero interaction with coins
    // (only the player collects — see coin_enemy_coexistence.test.js for
    // the runtime proof), so coins now place anywhere terrain-valid. This
    // sweep proves the exclusion is really gone (>=1 coin inside a patrol
    // span) while the spawn/portal courtesy still holds.
    let onPatrol = 0;
    for (let seed = 1; seed <= 10; seed++) {
        for (const n of [5, 6, 8, 9]) {
            const level = new Level(n, 32, n * 1000 + seed);
            const covered = new Set();
            for (const e of level.getEnemyManager().enemies) {
                const y = e.y / 32;
                for (let c = e.minX / 32; c <= e.maxX / 32 - 1; c++) {
                    covered.add(`${c},${y}`);
                }
            }
            const spawn = level.spawnTile, portal = level.portalTile;
            for (const coin of level.getCoins()) {
                const cx = coin.x / 32, cy = coin.y / 32;
                expect(cx === spawn.x && cy === spawn.y).toBe(false);
                if (portal) expect(cx === portal.x && cy === portal.y).toBe(false);
                if (covered.has(`${cx},${cy}`)) onPatrol++;
            }
        }
    }
    expect(onPatrol).toBeGreaterThan(0);
});

test("BFS treats spike strips at the physics-verified crossing boundary", () => {
    // Fixture grid: 14 wide x 8 tall, solid bottom row so the standing
    // surface is row 6. Spikes sit on that surface (air above solid).
    // The asserted boundary comes from simulating Physics + Hazards, not
    // from the BFS itself: one core (56px sweep) crosses with margin, two
    // adjacent cores are marginal-but-survivable, three never cross.
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

    // 4-wide strip (columns 6-9): beyond the model's wall rule either way.
    expect(canReach(makeGrid([6, 7, 8, 9]), width, height, spawnTile, portalTile)).toBe(false);

    // 3-wide strip (columns 6-8): simulation shows no takeoff/timing clears
    // three adjacent lethal cores, so the strip is a wall.
    expect(canReach(makeGrid([6, 7, 8]), width, height, spawnTile, portalTile)).toBe(false);

    // 2-wide strip (columns 6-7): the verified crossing boundary — a flat
    // jump arcs both cores and lands on column 9.
    expect(canReach(makeGrid([6, 7]), width, height, spawnTile, portalTile)).toBe(true);

    // Single spike: comfortably cleared.
    expect(canReach(makeGrid([6]), width, height, spawnTile, portalTile)).toBe(true);
});

test("BFS refuses step-up jumps over a spike-capped riser", () => {
    // A spike capping a one-tile riser cannot be jumped: clearing its inset
    // core needs feet ≥60px above the launch row (max rise ~62.5px), giving
    // ~28.6px of travel against the 56px overlap sweep — simulated 0/4539
    // takeoff/timing combos survive. The dist-2 step-up check must count the
    // spike as wall height, or hasValidPath() green-lights soft-locked maps.
    const width = 12;
    const height = 8;

    const makeGrid = (withSpike) => {
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        for (let x = 0; x < width; x++) {
            tiles[height - 1][x] = 1; // bottom row: standing surface is row 6
        }
        for (let x = 6; x < width; x++) {
            tiles[6][x] = 1; // riser: columns 6+ stand one tile higher (row 5)
        }
        if (withSpike) {
            tiles[5][6] = 2; // spike capping the riser's first column
        }
        return tiles;
    };

    const spawnTile = { x: 4, y: height - 2 };
    const portalTile = { x: 9, y: height - 3 }; // on the raised surface

    // Capped riser: the only route is a dist-2 step-up over the spiked
    // column — physically impossible, so the BFS must not validate it.
    expect(canReach(makeGrid(true), width, height, spawnTile, portalTile)).toBe(false);

    // Identical grid minus the spike: the step-up is a plain one-tile climb.
    expect(canReach(makeGrid(false), width, height, spawnTile, portalTile)).toBe(true);
});

test("dist-2 step-up rejects an overhang at the intermediate column", () => {
    // The mid-column rule blocks ANY obstruction at the hop's TARGET row,
    // in both orientations. The overhang orientation — solid AT ty, air at
    // the launch row — used to pass as clear: its underside sits exactly
    // at landing height while its top is a full tile (64px) above the
    // launch floor, beyond the ~62.5px max rise, and the 32px body fills
    // the tile, so transit always ends in a head-bonk (vy zeroed mid-rise)
    // or an X-pin against the riser behind it. Simulation evidence
    // (edgecheck sweep, 440 seeded maps): all 729 claimed-but-impossible
    // step-up edges share this signature; the isolated fixture fails under
    // every one of 66 input policies and never once passes. Minimal repro
    // Level(7,32,7039) edge (11,6)->(13,5).
    const width = 6;
    const height = 6;

    const makeGrid = (overhang) => {
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        // Launch shelf: columns 0-1 stand on row 5, standing row is 4.
        tiles[5][0] = 1;
        tiles[5][1] = 1;
        // Landing block: column 3 stands on row 4, standing row is 3.
        tiles[4][3] = 1;
        if (overhang) {
            // Intermediate column 2: solid at the target row 3, AIR at the
            // launch row 4 (and no support beneath, so column 2 itself is
            // unreachable transit — the dist-2 hop is the ONLY modelled
            // route to the landing cell).
            tiles[3][2] = 1;
        }
        return tiles;
    };

    const spawnTile = { x: 1, y: 4 };
    const landingKey = 3 * width + 3; // { x: 3, y: 3 }

    // Overhang present: the fixed rule must NOT add the landing cell.
    // Asserted in both BFS modes — the mid-column rule is independent of
    // the vertical headroom flag, and fairness demands it in both.
    expect(canReach(makeGrid(true), width, height, spawnTile, { x: 3, y: 3 })).toBe(false);
    expect(computeReachable(makeGrid(true), width, height, spawnTile)
        .has(landingKey)).toBe(false);
    expect(computeReachable(makeGrid(true), width, height, spawnTile, true)
        .has(landingKey)).toBe(false);

    // Twin: mid column fully free at both rows — the plain one-tile climb
    // stays modelled exactly as before.
    expect(canReach(makeGrid(false), width, height, spawnTile, { x: 3, y: 3 })).toBe(true);
    expect(computeReachable(makeGrid(false), width, height, spawnTile)
        .has(landingKey)).toBe(true);
    expect(computeReachable(makeGrid(false), width, height, spawnTile, true)
        .has(landingKey)).toBe(true);
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

test("vertical patrols never sweep a route cell (S10)", () => {
    for (let i = 0; i < 25; i++) {
        const level = new Level(7, 32);
        expect(level.direction).toBe("vertical");
        for (const e of level.getEnemyManager().enemies) {
            const y = e.y / 32;
            for (let c = e.minX / 32; c <= e.maxX / 32 - 1; c++) {
                expect(level.pathCells.has(y * level.width + c)).toBe(false);
            }
        }
    }
});

test("generation exhaustion throws fail-fast rather than shipping a soft-locked level", () => {
    // The constructor's throw is the last line of defence against an
    // unwinnable map. If a future change swallows it, the suite must go red
    // right here instead of green-lighting soft-locks into production.
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        expect(() => new Level(5, 32)).toThrow(
            /no reachable portal position after 200 generation attempts/
        );
    } finally {
        Level.prototype.pickPortalTile = original;
    }
});

test("50 constructions of level 7 stay valid", () => {
    // Bounded stress: generation plus conservative validation must reliably
    // produce solvable levels once Phase 2 elements are in play. Level 7 is
    // 'vertical' under the direction mapping, so this hammers the vertical
    // generator specifically.
    for (let i = 0; i < 50; i++) {
        const level = new Level(7, 32);
        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);
    }
});

// --- Task 9: per-level direction ------------------------------------------

test("direction varies deterministically from level number", () => {
    // Owner decision 2026-11-01 (plan Task 9 amendment): 'right' below level 5
    // keeps the shipped Phase-1 ramp untouched, then ['right','left','vertical']
    // cycles from level 5.
    const expected = {
        1: "right", 2: "right", 3: "right", 4: "right",
        5: "right", 6: "left", 7: "vertical", 8: "right", 9: "left"
    };
    for (const [n, dir] of Object.entries(expected)) {
        expect(new Level(Number(n), 32).direction).toBe(dir);
    }
});

test("left-facing levels spawn right, portal on the left band, path valid", () => {
    for (let i = 0; i < 20; i++) {
        const level = new Level(6, 32);
        const w = level.width;
        const h = level.height;
        expect(level.direction).toBe("left");

        // Spawn mirrors the canonical {2, h-4} tile to the right side.
        expect(level.spawnTile.x).toBe(w - 3);
        expect(level.spawnTile.y).toBe(h - 4);
        expect(level.getSpawnPoint()).toEqual({ x: (w - 3) * 32, y: (h - 4) * 32 });

        // Portal candidate band mirrors to columns 2..4.
        const portalX = level.getPortal().x / 32;
        expect(portalX).toBeGreaterThanOrEqual(2);
        expect(portalX).toBeLessThanOrEqual(4);

        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);

        // Mirrored forced-flat spawn zone: the RIGHT six columns stand solid
        // from row h-3 down at the ground height.
        for (let x = w - 6; x < w; x++) {
            for (let y = h - 3; y < h; y++) {
                expect(level.tiles[y][x]).toBe(1);
            }
        }
        // Mirrored end zone: the LEFT five columns are never gap columns.
        for (let x = 0; x <= 4; x++) {
            expect(level.tiles[h - 1][x]).toBe(1);
        }
        // Pit runs never exceed the generator's cap of 3 empty columns
        // (a column with no solid tile at all).
        let run = 0;
        for (let x = 0; x < w; x++) {
            const emptyCol = level.tiles.every(row => row[x] !== 1);
            run = emptyCol ? run + 1 : 0;
            expect(run).toBeLessThanOrEqual(3);
        }
    }
});

test("requireOpenHead excludes standable cells with a solid ceiling", () => {
    // Fixture grid: 8 wide x 6 tall, solid bottom row (standing surface
    // row 4), plus one floating block at (5,3). The cell (5,4) is air over
    // solid ground — standable under the default model — but capped by the
    // block, so a 32px body there could never jump. requireOpenHead must
    // drop it from the reachable set while leaving uncapped cells intact.
    const width = 8;
    const height = 6;
    const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
    for (let x = 0; x < width; x++) {
        tiles[height - 1][x] = 1;
    }
    tiles[3][5] = 1;

    const spawnTile = { x: 1, y: height - 2 };
    const cappedKey = 4 * width + 5;
    const openKey = 4 * width + 2;

    // Default (horizontal validation): unchanged behaviour, capped cell
    // included — walking beneath the overhang stays modelled either way.
    const open = computeReachable(tiles, width, height, spawnTile);
    expect(open.has(cappedKey)).toBe(true);
    expect(open.has(openKey)).toBe(true);

    // requireOpenHead (vertical validation): capped cell excluded, the rest
    // of the floor still reachable.
    const strict = computeReachable(tiles, width, height, spawnTile, true);
    expect(strict.has(cappedKey)).toBe(false);
    expect(strict.has(openKey)).toBe(true);
});

test("vertical BFS marks zero standable cells with a ceiling", () => {
    // Headroom-aware validation (I-A): across many vertical constructions,
    // no BFS-reachable tile may have solid rock directly overhead — every
    // validated standing spot must leave the 32x32 body room to jump.
    for (let i = 0; i < 50; i++) {
        const level = new Level(7, 32);
        expect(level.direction).toBe("vertical");
        for (const key of level.reachableTiles) {
            const x = key % level.width;
            const y = Math.floor(key / level.width);
            const hasCeiling = y > 0 && level.tiles[y - 1][x] === 1;
            expect(hasCeiling).toBe(false);
        }
    }
});

test("vertical levels climb 15x24 from bottom spawn to a top-band portal", () => {
    for (let i = 0; i < 20; i++) {
        const level = new Level(7, 32);
        expect(level.direction).toBe("vertical");
        expect(level.width).toBe(15);
        expect(level.height).toBe(24);

        // Spawn near bottom-center on the ground band's standing row.
        expect(level.spawnTile).toEqual({ x: 7, y: 20 });
        expect(level.getSpawnPoint()).toEqual({ x: 7 * 32, y: 20 * 32 });
        for (let x = 0; x < 15; x++) {
            expect(level.tiles[21][x]).toBe(1);
        }

        // Portal sits in the top band: reachable tile with y <= 4.
        expect(level.getPortal().y / 32).toBeLessThanOrEqual(4);

        expect(level.hasValidPath()).toBe(true);
        expect(level.getCoins().length).toBeGreaterThanOrEqual(5);
    }
});

test("left-facing terrain is the canonical generation mirrored (seeded)", () => {
    // placeEnemyMarkers is the final canonical-space mutation before the
    // mirror flip, so snapshotting there captures the pre-flip grid of the
    // accepted attempt regardless of how many retries the constructor took.
    const realRandom = Math.random;
    const proto = Level.prototype;
    const origMarkers = proto.placeEnemyMarkers;
    try {
        Math.random = mulberry32(20261031);
        let canonical = null;
        proto.placeEnemyMarkers = function (tiles) {
            origMarkers.call(this, tiles);
            canonical = tiles.map(row => [...row]);
        };
        const level = new Level(6, 32);
        expect(level.direction).toBe("left");

        // Final grid equals the canonical grid with every column flipped.
        const mirroredBack = canonical.map(row => [...row].reverse());
        expect(level.tiles).toEqual(mirroredBack);

        // Column-solidity histogram preserved by the mirror.
        const colSolid = tiles => tiles[0].map((_, x) =>
            tiles.reduce((n, row) => n + (row[x] === 1 ? 1 : 0), 0));
        expect(colSolid(level.tiles)).toEqual(colSolid(canonical).reverse());
    } finally {
        proto.placeEnemyMarkers = origMarkers;
        Math.random = realRandom;
    }
});

test("spikes and markers respect each direction's exclusion zones", () => {
    for (const n of [5, 6, 7, 8, 9]) {
        for (let i = 0; i < 10; i++) {
            const level = new Level(n, 32);
            const range = allowedHazardRange(level);
            const placed = [
                ...tilesOfType(level.tiles, 2),
                ...tilesOfType(level.tiles, 4)
            ];
            for (const t of placed) {
                expect(t[range.axis]).toBeGreaterThanOrEqual(range.min);
                expect(t[range.axis]).toBeLessThanOrEqual(range.max);
            }
        }
    }
});

test("fall-death threshold tracks level height on vertical levels", () => {
    // main.js passes level.height * tileSize into checkPitFall; verify the
    // taller vertical grid moves the death line with it (no rewrite needed).
    const level = new Level(7, 32);
    expect(level.direction).toBe("vertical");
    const worldHeightPx = level.height * level.tileSize; // 24 * 32 = 768
    expect(worldHeightPx).toBe(768);

    const hazards = new Hazards();
    // Shipped semantics (strict >): alive exactly at height + 100 margin...
    expect(hazards.checkPitFall({ y: worldHeightPx + 100 }, worldHeightPx)).toBe(false);
    // ...dead one pixel past it.
    expect(hazards.checkPitFall({ y: worldHeightPx + 101 }, worldHeightPx)).toBe(true);
    // A fall depth that kills on the old 15-row grid stays alive inside the
    // 24-row vertical grid: the threshold genuinely tracks level.height.
    expect(hazards.checkPitFall({ y: 15 * 32 + 101 }, worldHeightPx)).toBe(false);
});

test("phase-2 generation never exhausts retries (R26/I2 stress)", { timeout: 120000 }, () => {
    // Regression guard for the R26 defect: before the keep-if-harmless spike
    // gate and the no-rise-after-wide-gap rule, ~37% of level-15
    // constructions threw "no reachable portal position" after
    // MAX_GENERATION_ATTEMPTS. Extended to ALL phase-2 levels (I2): the
    // vertical tier (7, 10, 13) was omitted here while the branch retired
    // startLevelRetrying on the claim that "R26 pins generation reliability"
    // — a claim false for vertical level 13 (~5-7% exhaustion until the spike
    // gate gained marker-site survival). Zero measured throws (0/800 at L13);
    // 30 consecutive builds per phase-2 level must all validate. A throw
    // surfaces as a test failure. Timeout raised 5s→120s (2026-11-05 soft-lock
    // fix): the generalized routeFair() physics gate runs on every horizontal
    // construction (~50-80 ms/build plus extra rejections), so 930 builds no
    // longer fit the default budget; the assertion itself is unchanged.
    // Phase 3 extension: every tier contributes horizontal + vertical
    // representatives (direction cycles right/left/vertical from level 5),
    // so the plateau caps and new tier sizes are pinned against throws too.
    const phase2Levels = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    for (const base of [25, 50, 75, 99]) {
        phase2Levels.push(base, base + 1);
    }
    phase2Levels.push(100);
    for (const n of phase2Levels) {
        for (let i = 0; i < 30; i++) {
            const level = new Level(n, 32);
            expect(level.hasValidPath()).toBe(true);
            // Presence contracts hold on every accepted construction
            // (spikes optional on vertical climbs — see placement rules).
            if (level.direction !== 'vertical') {
                expect(countType(level.tiles, 2)).toBeGreaterThan(0);
            }
            expect(countType(level.tiles, 4)).toBeGreaterThan(0);
            // Deployed spawns, not raw markers (I2): the constructor's guard
            // is deriveEnemySpawns().length > 0, and that is what ships.
            expect(level.deriveEnemySpawns().length).toBeGreaterThan(0);
        }
    }
});

test("extractCoins enforces the 20% density cap (spec §Difficulty Scaling)", () => {
    const level = new Level(1, 32);
    // Force a scenario generation cannot produce today: an oversized
    // candidate set and a coin target beyond the cap for this grid
    // (width*height*0.2). The guard must warn and trim. With the Phase 3
    // plateau the target itself caps at COIN_TARGET_CAP=30 (levelNumber 95
    // would otherwise ask for 100), so shrink the effective height until the
    // density cap (floor(20*7*0.2)=28) sits below even that.
    const reachable = new Set();
    for (let i = 0; i < 100; i++) reachable.add(3 * level.width + i); // row 3
    level.reachableTiles = reachable;
    // The synthetic pool has no safe-hub record (the constructor's hub was
    // computed for the REAL L1 grid); clearing it restores extractCoins'
    // unrestricted-pool behaviour, which is what this fixture exercises.
    level.coinSafeHub = null;
    level.spawnTile = { x: 0, y: 0 }; // key 0, outside the candidate row
    level.portalTile = null;
    level.height = 7; // density cap floor(20*7*0.2) = 28 < capped target 30
    level.levelNumber = 95; // target = min(5 + 95, 30) = 30 candidates collected

    const originalWarn = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
        const coins = level.extractCoins();
        expect(coins.length).toBe(Math.floor(level.width * level.height * 0.2));
        expect(warned).toBe(1);
    } finally {
        console.warn = originalWarn;
    }
});

test("late-level densities stay plateaued (Phase 3 caps)", () => {
    // Uncapped formulas explode past the shipped range: gapChance 2.12,
    // spike target 49, coin target 104 at L99 — the uncapped generator threw
    // on every construction from level 44 up (measured 380/380). With the
    // plateau caps, realized densities must never exceed them on any build.
    for (const n of [90, 95, 99, 100]) {
        for (let i = 0; i < 10; i++) {
            const level = new Level(n, 32);
            expect(level.getCoins().length).toBeLessThanOrEqual(30);
            expect(level.countTilesOfType(2)).toBeLessThanOrEqual(20);
            expect(level.deriveEnemySpawns().length).toBeLessThanOrEqual(14);
            expect(level.hasValidPath()).toBe(true);
        }
    }
});

test("same seed replays the identical level; different seeds differ", () => {
    const a = new Level(5, 32, 1234);
    const b = new Level(5, 32, 1234);
    const c = new Level(5, 32, 9999);

    expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
    expect(JSON.stringify(a.getCoins())).toBe(JSON.stringify(b.getCoins()));
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(c.tiles));
});

test("unseeded levels stay random", () => {
    const seen = new Set();
    for (let i = 0; i < 8; i++) seen.add(JSON.stringify(new Level(5, 32).tiles));
    expect(seen.size).toBeGreaterThan(1);
});
