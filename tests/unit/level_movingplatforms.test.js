import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";

// Placement invariants for optional traversal decks. The law under test:
// decks are decoration-on-top — their swept volume may never touch terrain,
// teeth, patrols, spawn or portal, they are capped per map, gated to level
// 8+, and identical seeds must replay identical deck sets (retry contract).

const T = 32;
const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];

// Swept volume in tile coordinates across the ENTIRE shuttle range of one
// horizontal deck descriptor.
function sweptRange(p) {
    return {
        c0: Math.floor(p.min / T),
        c1: Math.floor((p.max + p.width - 1e-9) / T),
        r0: Math.floor(p.y / T),
        r1: Math.floor((p.y + p.height - 1e-9) / T)
    };
}

function checkDeck(level, p, where) {
    const { c0, c1, r0, r1 } = sweptRange(p);
    // Deck geometry conventions: 2 tiles wide, 1 tile collision height,
    // axis-aligned travel with at least one tile of span, sane speeds.
    expect(p.width, where).toBe(2 * T);
    expect(p.height, where).toBe(T);
    expect(p.axis, where).toBe("h"); // vertical elevators deferred this wave
    expect(p.max - p.min, where).toBeGreaterThanOrEqual(T);
    expect(p.speed, where).toBeGreaterThan(0);
    expect(p.speed, where).toBeLessThan(200); // slower than the walk
    expect(p.phase, where).toBeGreaterThanOrEqual(0);
    expect(p.phase, where).toBeLessThan(1);
    // Terrain: every cell under the sweep (and 3 clearance rows above it)
    // is air — no solids, no spikes, ever.
    for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
            expect(level.tiles[cy]?.[cx], `${where}: solid/spike ${cx},${cy}`).toBe(0);
        }
    }
    for (let cy = r0 - 3; cy < r0; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
            expect(level.tiles[cy]?.[cx], `${where}: clearance ${cx},${cy}`).toBe(0);
        }
    }
    // No patrol rect overlaps the swept volume on its rows.
    for (const e of level.enemyManager.enemies) {
        const row = Math.floor(e.y / T);
        if (row !== r0 && row !== r1) continue;
        expect(Math.floor((e.maxX - 1e-9) / T) < c0 || c1 < Math.floor(e.minX / T),
            `${where}: patrol overlaps sweep at row ${row}`).toBe(true);
    }
    // Spawn and portal cells stay outside the swept volume.
    for (const cell of [level.spawnTile, level.portalTile]) {
        const inside = cell.x >= c0 && cell.x <= c1 && cell.y >= r0 && cell.y <= r1;
        expect(inside, `${where}: covers cell ${cell.x},${cell.y}`).toBe(false);
    }
}

test("L8..60 x 10 seeds: zero illegal decks, cap 2/map, all descriptors sane", () => {
    let mapsWithDecks = 0, horizMaps = 0, totalDecks = 0;
    for (let lvl = 8; lvl <= 60; lvl++) {
        for (const s of SEEDS) {
            const seed = lvl * 1000 + s;
            const level = new Level(lvl, T, seed);
            const decks = level.getMovingPlatforms();
            const where = `L${lvl} seed ${seed}`;
            expect(decks.length, `${where}: cap`).toBeLessThanOrEqual(2);
            if (level.direction !== "vertical") {
                horizMaps++;
                if (decks.length) mapsWithDecks++;
            } else {
                // Elevators deferred: vertical maps ship none this wave.
                expect(decks.length, `${where}: vertical gate`).toBe(0);
            }
            totalDecks += decks.length;
            for (const p of decks) checkDeck(level, p, where);
        }
    }
    // Coverage sanity (tuning report lives in the wave notes): placement is
    // opportunistic, so demand visible-but-not-dominant presence.
    expect(mapsWithDecks / horizMaps).toBeGreaterThan(0.3);
    expect(mapsWithDecks / horizMaps).toBeLessThan(0.75);
    expect(totalDecks).toBeLessThanOrEqual(2 * mapsWithDecks);
});

test("levels below 8 ship no decks", () => {
    for (let lvl = 1; lvl <= 7; lvl++) {
        for (const s of SEEDS) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(level.getMovingPlatforms(), `L${lvl} seed ${s}`).toEqual([]);
        }
    }
});

test("same seed replays the identical deck set including phase", () => {
    for (const [lvl, s] of [[8, 11], [12, 44], [20, 77], [30, 99], [45, 66]]) {
        const a = new Level(lvl, T, lvl * 1000 + s).getMovingPlatforms();
        const b = new Level(lvl, T, lvl * 1000 + s).getMovingPlatforms();
        expect(b, `L${lvl} seed ${s}`).toEqual(a);
    }
});

test("deck derivation never mutates the grid", () => {
    const level = new Level(20, T, 20077);
    const before = JSON.stringify(level.tiles);
    const again = level.deriveMovingPlatforms();
    expect(JSON.stringify(level.tiles), "tiles untouched").toBe(before);
    // A re-run draws from the advanced rng stream, so it may differ in WHICH
    // gaps host decks — but the shape guarantees (cap, geometry) still hold.
    expect(Array.isArray(again)).toBe(true);
    expect(again.length).toBeLessThanOrEqual(2);
});
