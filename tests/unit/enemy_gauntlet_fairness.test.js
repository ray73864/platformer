// Stacked-patrol gauntlet rule (player report 2026-11-05, L30 seed
// 4104669369): individually-legal placements that JOINTLY wall a mandatory
// traverse — three stacked shelves (staging walkers, walker+SPINY+walker on
// the required middle shelf, walkers on the landing) left zero uncovered
// standable cells near the route; the kind-aware autopilot died every
// attempt. Attribution @this wave (L5..100 x 10 seeds): 101/960 maps
// (10.5%) hosted >=1 configuration; flagged-with-hostile bot clears 1/17 vs
// 3/20 control; 8/13 patrol deaths landed inside flagged boxes averaging
// 2.4% of map area. Supersedes the 3348d60 Rule-2 deferral for the MIXED
// stacked-row class (that measurement scoped hostile+hostile pairs only).
// The gate drops the last-completing site BEFORE kind rolls (terrain
// byte-identical, kinds never re-rolled). Metric: exported
// computeMustPassCells + gauntletViolations in js/level.js.
import { test, expect } from "bun:test";
import {
    Level, computeMustPassCells, gauntletViolations
} from "../../js/level.js";

const T = 32;

// Bodies as the shipped metric consumes them, read off deployed enemies.
function deployedBodies(level) {
    return level.getEnemyManager().enemies.map(e => ({
        col: Math.round(e.x / T),
        row: Math.round(e.y / T),
        left: Math.round(e.minX / T),
        right: Math.round(Math.ceil(e.maxX / T)) - 1
    }));
}
function violationsOf(level) {
    const mp = computeMustPassCells(level.tiles, level.width, level.height,
        level.spawnTile, level.portalTile, level.bridgeGap);
    return gauntletViolations(level.tiles, level.width, level.height,
        deployedBodies(level), mp, level.reachableTiles);
}

// Hand-built L30 morphology: three stacked shelves over pure void on a
// forced right-to-left route (direction 'left'), each shelf fully swept,
// no safe pocket anywhere near the crossing. Support geometry mirrors the
// repro: staging row 8 cols 11-13 (support row 9), middle row 9 cols 13-15
// (support row 10, span overlaps staging ±1 exactly like the trio did),
// landing row 10 cols 17-18 (support row 11, disjoint like the pair),
// plateau cols 0-8 carrying the portal, spawn platform cols 20-23.
function stackFixture(seed) {
    const level = new Level(30, T, seed);
    const W = 30, H = 16;
    level.width = W;
    level.height = H;
    level.direction = 'left';
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 0; c <= 8; c++) for (let r = 9; r < H; r++) tiles[r][c] = 1;
    for (let c = 11; c <= 13; c++) tiles[9][c] = 1;   // staging support
    for (let c = 14; c <= 16; c++) tiles[10][c] = 1;  // middle support
    for (let c = 17; c <= 18; c++) tiles[11][c] = 1;  // landing support
    for (let c = 20; c <= 23; c++) for (let r = 12; r < H; r++) tiles[r][c] = 1;
    tiles[8][11] = 4; tiles[8][12] = 4; tiles[8][13] = 4;
    tiles[9][14] = 4; tiles[9][15] = 4; tiles[9][16] = 4;
    tiles[10][17] = 4; tiles[10][18] = 4;
    level.tiles = tiles;
    level.spawnTile = { x: 22, y: 11 };
    level.portalTile = { x: 2, y: 8 };
    const reach = new Set();
    const addRow = (r, a, b) => { for (let c = a; c <= b; c++) reach.add(r * W + c); };
    addRow(8, 2, 8); addRow(8, 11, 13);
    addRow(9, 14, 16); addRow(10, 17, 18); addRow(11, 20, 23);
    level.reachableTiles = reach;
    return level;
}

test("hand-built L30 morphology: raw site set FLAGS, deployed set passes", () => {
    // Pre-rule evidence: EVERY legal site deployed (the naive world before
    // this gate) is a gauntlet on the staging run — 6 sweeping bodies, zero
    // uncovered pockets, must-pass crossing. Post-rule evidence: the
    // shipped greedy drop removed exactly the completing site and the SAME
    // metric reads clean.
    const level = stackFixture(12345);
    const rawBodies = level.deriveEnemySpawns().map(s => ({
        col: s.x, row: s.y, left: s.left, right: s.right
    }));
    expect(rawBodies.length).toBe(8);
    const mp = computeMustPassCells(level.tiles, level.width, level.height,
        level.spawnTile, level.portalTile, level.bridgeGap);
    expect(mp.size).toBeGreaterThan(0);   // the traverse IS mandatory
    const rawViol = gauntletViolations(level.tiles, level.width, level.height,
        rawBodies, mp, level.reachableTiles);
    expect(rawViol.length).toBeGreaterThan(0);
    expect(rawViol.some(v => v.row === 8)).toBe(true);  // staging run flags

    level.spawnEnemies();
    const viol = violationsOf(level);
    expect(viol.length).toBe(0);
    // Derive order is row-major: the three staging sites complete their own
    // neighborhood legally (the middle cells are still open pockets), then
    // the FIRST middle site would cover them all (patrol bounds span the
    // whole run, not just the site column) — so every middle site drops and
    // the emptied shelf becomes the safe pocket. Landing stays (2 bodies <
    // GAUNTLET_MIN_BODIES against its own pocketed neighborhood).
    // 2026-11-08 addendum: the bodies-per-run cap then thins the SURVIVORS
    // further — the staging run is 3 walkable columns (cap 1) and the
    // landing run 2 (cap 1) — so the same gauntlet-clean verdict now ships 2
    // bodies instead of 5 (owner ruling; see BODIES_PER_RUN_DIVISOR).
    const enemies = deployedBodies(level);
    expect(enemies.length).toBe(2);
    expect(enemies.some(e => e.row === 9)).toBe(false);
    expect(enemies.filter(e => e.row === 8).length).toBe(1);
    expect(enemies.filter(e => e.row === 10).length).toBe(1);
});

test("named repro L30 seed 4104669369: gauntlet gone, purple enemy gone", () => {
    // Player report 2026-11-05. Pre-fix composition: THREE walkers on the
    // staging shelf (cols 13-15, row 16), walker+SPINY+walker on the
    // mandatory middle shelf (cols 16-18, row 17), two walkers on the
    // landing (cols 20-21, row 18) — metric flagged the staging
    // neighborhood (6 bodies, zero pockets, must-pass crossing).
    // Post-fix: the entire middle trio drops before kind rolls (it is what
    // completes the walled configuration); staging + landing stay. The
    // emptied middle shelf becomes the safe waiting pocket the traverse
    // always needed. Terrain bytes are untouched by the rule (placement
    // only), so the map shape is identical.
    // 2026-11-08 addendum: the bodies-per-run cap further thins the
    // survivors to one walker per remaining shelf (staging cols 13-15 is a
    // 3-column run, landing cols 20-21 a 2-column run — owner ruling "enemies
    // can't group so much, especially on smaller ledges"); the gauntlet
    // verdict and the no-hostile guarantee are unchanged.
    const level = new Level(30, T, 4104669369);
    expect(violationsOf(level).length).toBe(0);
    const enemies = deployedBodies(level);
    // No bodies on the middle shelf at all — and hence no spiny anywhere
    // near the traverse (the reported purple enemy).
    expect(enemies.some(e => e.row === 17)).toBe(false);
    expect(level.getEnemyManager().enemies
        .some(e => e.kind !== 'walker')).toBe(false);
    // One patrol per remaining shelf (cap 1 each): staging and landing.
    expect(enemies.filter(e => e.row === 16).length).toBe(1);
    expect(enemies.filter(e => e.row === 18).length).toBe(1);
    expect(enemies.length).toBe(2);
});

test("same seed twice: deployments, kinds and pixels replay identically", () => {
    for (const seed of [4104669369, 30099, 12345]) {
        const a = new Level(30, T, seed);
        const b = new Level(30, T, seed);
        expect(a.getEnemyManager().enemies.map(e => [e.x, e.y, e.minX, e.maxX, e.kind]))
            .toEqual(b.getEnemyManager().enemies.map(e => [e.x, e.y, e.minX, e.maxX, e.kind]));
        expect(a.tiles).toEqual(b.tiles);
    }
});

test("structural sweep L5..L60 x 10 seeds: ZERO gauntlet configurations", () => {
    // CI regression pin (pre-fix baseline measured 101/960 violating maps
    // across L5..100 x 10 seeds under this exact shipped metric).
    let checkedEnemies = 0;
    for (let lvl = 5; lvl <= 60; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(violationsOf(level).length).toBe(0);
            checkedEnemies += level.getEnemyManager().enemies.length;
        }
    }
    // Non-vacuous: patrols still deploy widely after the gate.
    expect(checkedEnemies).toBeGreaterThan(200);
}, 60000);
