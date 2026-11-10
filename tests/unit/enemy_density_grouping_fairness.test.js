// Enemy density/grouping fairness (owner ruling 2026-11-08, L20 seed
// 3906687302 playtest report): TWO walkers share-patrolled cols 21..22 of the
// 5-tile top shelf holding the portal (portal col 24 row 14, spike on the
// fallback terrace below-left) and a spiny + 2 walkers packed cols 10..14 of
// the run below — survivability witnesses existed only at pixel-tight patrol
// phases (precision-tax wall), and the stacked-patrol gauntlet metric was
// blind because cols 24..25 count as pockets BEHIND the sweep. Owner:
// "enemies moving too quickly and not far enough away from the edge... ensure
// enemies can't group so much, especially on smaller ledges."
// Two placement-time rules (js/level.js headers at BODIES_PER_RUN_DIVISOR /
// PORTAL_SHELF_CLEAR_COLS): (A) max(1, floor(runTiles/3)) bodies per shared
// WALKABLE run; (B) at most ONE patroller on the portal's standable run AND
// its span leaves >=1 clear cell before the portal column. Both run BEFORE
// kind rolls, consume zero rng draws beyond the established drop-before-rolls
// precedent, and never loosen an existing gate. Prevalence @8a9109f (1000
// fresh seeds s=(20261108+i*7919)>>>0, L5..100): A flagged 541 maps, B
// flagged 23 (and 14 maps still violated B after applying A alone — B does
// real work beyond the cap). Post-rule both measure ZERO.
import { test, expect } from "bun:test";
import { Level, walkRunExtent } from "../../js/level.js";

const T = 32;
const DIVISOR = 3; // BODIES_PER_RUN_DIVISOR (mirrored constant, house style)
const CLEAR = 1;   // PORTAL_SHELF_CLEAR_COLS

function bodiesOf(level) {
    return level.enemyManager.enemies.map(e => ({
        col: Math.round(e.x / T),
        row: Math.round(e.y / T),
        left: Math.round(e.minX / T),
        right: Math.ceil(e.maxX / T) - 1,
        kind: e.kind
    }));
}
function runKeyAt(level, x, y) {
    const ext = walkRunExtent(level.tiles, level.width, level.height,
        x, y, level.pathCells);
    return ext === null ? null : `${y}:${ext.left}`;
}
// Independent mirror of Rule A over deployed bodies (never imports the
// filter's bookkeeping — this is what a violation LOOKS like on screen).
function ruleAViolations(level) {
    const byKey = new Map();
    for (const b of bodiesOf(level)) {
        const k = runKeyAt(level, b.col, b.row);
        if (k === null) continue;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(b);
    }
    const out = [];
    for (const [k, list] of byKey) {
        const ext = walkRunExtent(level.tiles, level.width, level.height,
            list[0].col, list[0].row, level.pathCells);
        const cap = Math.max(1, Math.floor((ext.right - ext.left + 1) / DIVISOR));
        if (list.length > cap) out.push({ k, n: list.length, cap });
    }
    return out;
}
function ruleBViolations(level) {
    const pt = level.portalTile;
    if (!pt || level.direction === 'vertical') return [];
    const key = runKeyAt(level, pt.x, pt.y);
    if (key === null) return [];
    const onRun = bodiesOf(level).filter(b => runKeyAt(level, b.col, b.row) === key);
    const out = [];
    if (onRun.length > 1) out.push({ why: 'multiple', n: onRun.length });
    for (const b of onRun) {
        const sweeps = level.direction === 'left'
            ? b.left <= pt.x + CLEAR : b.right >= pt.x - CLEAR;
        if (sweeps) out.push({ why: 'sweep', col: b.col });
    }
    return out;
}

// --- (a) constructed-map pins on the reported seeds -------------------------

test("reported map L20/3906687302: portal shelf stays clear, capped cluster stays clear", () => {
    const level = new Level(20, T, 3906687302);
    const bs = bodiesOf(level);
    // W3a RE-PINNED: L20 now lives in CAVERNS (vertical climb, up-biased
    // walk) — the reported horizontal layout became a single spiny on a
    // lower run while the portal sits high on the chimney wall. Same
    // contracts pinned: exact deterministic layout, zero rule-A/B violations,
    // and never more than ONE patroller sharing the portal's run.
    // F1 RE-PINNED 2026-11-10: the body's span is 3 walkable cols (< the
    // steady hostile bar 4 measured on the FINAL span — the old solid-run
    // metric overcounted here), so it stands down as a walker. Geometry,
    // count and both rule contracts byte-stable; only the kind swapped.
    expect(bs).toEqual([
        { col: 0, row: 12, left: 0, right: 2, kind: 'walker' }
    ]);
    expect(ruleAViolations(level)).toEqual([]);
    expect(ruleBViolations(level)).toEqual([]);
    const pt = level.portalTile;
    const shelf = bs.filter(b => runKeyAt(level, b.col, b.row) ===
        runKeyAt(level, pt.x, pt.y));
    expect(shelf.length).toBeLessThanOrEqual(1);
});

test("rule-B-only map L23/21924098: wide portal run keeps ONE patroller (cap alone would keep both)", () => {
    // BASE shipped two walkers sharing the portal's run (cols 21..22, portal
    // col 26) on a run wide enough that the width cap keeps BOTH; only the
    // one-patroller bar removes the second (mutation-checked: disabling the
    // protectPortalShelf call redeploys it and this test fails).
    const level = new Level(23, T, 21924098);
    const pt = level.portalTile;
    const shelf = bodiesOf(level).filter(b =>
        runKeyAt(level, b.col, b.row) === runKeyAt(level, pt.x, pt.y));
    // W3a RE-PINNED: L23 now lives in SKYWARD; the portal run's single
    // patroller shifted from a 2-wide walker (21..22) to a spiny on the
    // same columns of this deterministic map. The rule-B contract is
    // unchanged: exactly ONE body shares the portal's run and it keeps its
    // clearance (right 22 <= portal col 25 - 1 - CLEAR).
    // F1 RE-PINNED 2026-11-10: that span is 2 walkable cols (< the steady
    // hostile bar 4 measured on the FINAL span), so the body stands down as
    // a walker. Columns, bounds and the rule-B clearance contract are
    // byte-stable; only the kind swapped.
    expect(shelf.length).toBe(1);
    expect(shelf[0]).toEqual({ col: 21, row: 14, left: 21, right: 22, kind: 'walker' });
    expect(ruleBViolations(level)).toEqual([]);
});

// --- (b) synthetic maps ------------------------------------------------------

// Hand-built shelf: solid slab rows 6-7 spanning columns 9..(8+width) —
// inside the 'right' patrol band [9, W-6] so clamps cannot starve it — with
// a marker on EVERY slab column, portal parked off-map (no rule-B
// interaction). Deployment count therefore equals the run's capacity.
function shelfFixture(seed, shelfWidth) {
    const level = new Level(38, T, seed);
    // W3a fixture hygiene: drop construction-time bridge/shaft descriptors
    // (CANYONS makes them common) — these fixtures own their geometry.
    level.bridgeGap = null;
    level.shaftGap = null;
    const W = 24, H = 12;
    level.width = W;
    level.height = H;
    level.direction = 'right';
    level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    const reach = new Set();
    for (let c = 9; c < 9 + shelfWidth; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
        tiles[5][c] = 4;
        reach.add(5 * W + c);
    }
    level.tiles = tiles;
    level.reachableTiles = reach;
    level.spawnTile = { x: 1, y: H - 4 };
    level.portalTile = null;
    level.spawnEnemies();
    return level;
}

test("cap math: 3-wide shelf ships 1 body, 6-wide ships 2, 9-wide ships 3", () => {
    for (const [shelfWidth, expected] of [[3, 1], [6, 2], [9, 3]]) {
        const level = shelfFixture(4242, shelfWidth); // marker on every column
        const got = bodiesOf(level).length;
        expect(got, `${shelfWidth}-wide shelf`).toBe(expected);
    }
});

test("cap math caps at the WALKABLE run: a tooth-split mass is two runs", () => {
    // Solid cols 9..16 (8 wide -> cap 2 as one run) with a spike at col 13
    // splitting the STANDABLE surface into 9..12 (4 wide -> 1) and 14..16
    // (3 wide -> 1): two markers per half deploy ONE per half, proving the
    // denominator is the ledge players walk, not the rock beneath it.
    const level = new Level(38, T, 4243);
    // W3a fixture hygiene: drop construction-time bridge/shaft descriptors
    // (CANYONS makes them common) — this fixture owns its geometry.
    level.bridgeGap = null;
    level.shaftGap = null;
    const W = 24, H = 12;
    level.width = W; level.height = H; level.direction = 'right';
    level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 9; c <= 16; c++) { tiles[6][c] = 1; tiles[7][c] = 1; }
    tiles[5][13] = 2;             // the tooth splits the walkable run
    tiles[5][10] = 4; tiles[5][11] = 4;   // left half 9..12
    tiles[5][14] = 4; tiles[5][15] = 4;   // right half 14..16
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 10, 5 * W + 11, 5 * W + 14, 5 * W + 15]);
    level.spawnTile = { x: 1, y: H - 4 };
    level.portalTile = null;
    level.spawnEnemies();
    const bs = bodiesOf(level);
    const left = bs.filter(b => runKeyAt(level, b.col, b.row) ===
        runKeyAt(level, 10, 5));
    const right = bs.filter(b => runKeyAt(level, b.col, b.row) ===
        runKeyAt(level, 14, 5));
    expect(left.length).toBe(1);
    expect(right.length).toBe(1);
    expect(ruleAViolations(level)).toEqual([]);
});

// Portal-shelf fixture: slab cols 9..21 (walk run 13 wide, cap 4), portal
// placed by the caller ON the slab at row 5. The 'right' band clamps every
// sweep at col 18, which is what makes the clearance boundary testable:
// portal col 20 leaves exactly one clear cell (19) -> legal; portal col 19
// puts the sweep against the approach cell -> offender; portal col 14 sits
// INSIDE every span -> the sweep crosses the goal tile.
function portalShelfFixture(seed, markerCols, pcol) {
    const level = new Level(38, T, seed);
    // W3a fixture hygiene: drop construction-time bridge/shaft descriptors
    // (CANYONS makes them common) — these fixtures own their geometry.
    level.bridgeGap = null;
    level.shaftGap = null;
    const W = 24, H = 12;
    level.width = W; level.height = H; level.direction = 'right';
    level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 9; c <= 21; c++) { tiles[6][c] = 1; tiles[7][c] = 1; }
    const reach = new Set();
    for (const x of markerCols) { tiles[5][x] = 4; reach.add(5 * W + x); }
    level.tiles = tiles;
    level.reachableTiles = reach;
    level.spawnTile = { x: 1, y: H - 4 };
    level.portalTile = { x: pcol, y: 5 };
    level.spawnEnemies();
    return level;
}

test("portal shelf: span CROSSING the portal column is demoted outright", () => {
    // One marker at col 12; its span 9..18 covers portal col 14 -> the only
    // body on the shelf goes, shelf ships empty (skipped placement, no
    // re-roll elsewhere).
    const level = portalShelfFixture(4300, [12], 14);
    expect(bodiesOf(level)).toEqual([]);
});

test("portal shelf: sweep ending ON the approach cell demotes; one cell further back survives", () => {
    // Identical deployment (marker col 12, span clamped to 18); only the
    // portal column moves. Col 19: the sweep ends AT the portal-adjacent
    // cell -> offender. Col 20: one clear cell (19) remains -> legal.
    const tight = portalShelfFixture(4301, [12], 19);
    expect(bodiesOf(tight)).toEqual([]);
    const clear = portalShelfFixture(4301, [12], 20);
    const bs = bodiesOf(clear);
    expect(bs.length).toBe(1);
    expect(bs[0].right).toBe(18); // == portalX - 1 - CLEAR
});

test("portal shelf: two otherwise-legal patrollers reduce to one", () => {
    // Wide run (cap 4) and a portal leaving clearance for both spans (col
    // 20): the ONE-PATROLLER bar still keeps only the first in derive order
    // — mutation-checked: disabling protectPortalShelf redeploys the second.
    const level = portalShelfFixture(4302, [9, 10], 20);
    const bs = bodiesOf(level);
    expect(bs.length).toBe(1);
    expect(bs[0].col).toBe(9);
    expect(ruleBViolations(level)).toEqual([]);
});

// --- rng discipline: terrain bytes are untouched ----------------------------

// Terrain fingerprints (tiles + spikes + coins ONLY, captured from BASE
// 8a9109f before any of this task's code existed in the tree): the rules run
// after extractCoins, consume no draws of their own, and write no grid cell,
// so every hash must match byte-for-byte while enemy sets shrink.
// W3a RE-BASELINED 2026-11-10: world profiles legitimately change terrain on
// every non-meadow level; these pins guard FUTURE drift (enemy-rule work must
// not move tiles/spikes/coins), so the hashes were re-recorded from the new
// deterministic bytes — L12 CANYONS, L20 CAVERNS, L23 SKYWARD, L30 RUINS,
// L45 CAVERNS, L77 RUINS-rotation (motif-chain coupling).
// W6 RE-RECORDED 2026-11-10: the RUINS retune moves exactly its two
// RUIN-window pins (L30, L77); the four non-RUIN hashes are byte-equal to
// their W3a capture (re-verified), so this still guards FUTURE enemy-rule
// drift on stable terrain.
const TERRAIN_PINS = [
    [20, 3906687302, "7771cdb0"],
    [23, 95830402, "41c765de"],
    [30, 4104669369, "1a09ba88"],
    [12, 20308622, "7e867c24"],
    [45, 20545163, "72605ec1"],
    [77, 20797493, "4a535429"]
];
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
function terrainFp(level) {
    return fnv1a(JSON.stringify({
        tiles: level.tiles,
        coins: level.getCoins().map(c => [c.x, c.y]),
        spikes: level.getHazards().getSpikes().map(p => [p.x, p.y])
    }));
}

test("terrain byte-identity: tiles/spikes/coins unchanged on demotion seeds", () => {
    for (const [lvl, seed, fp] of TERRAIN_PINS) {
        const level = new Level(lvl, T, seed);
        expect(terrainFp(level), `L${lvl} seed=${seed}`).toBe(fp);
    }
});

test("demotions consume no extra rng: repeated builds replay identically", () => {
    for (const [lvl, seed] of [[20, 3906687302], [23, 21924098], [30, 4104669369]]) {
        const a = bodiesOf(new Level(lvl, T, seed));
        const b = bodiesOf(new Level(lvl, T, seed));
        expect(a).toEqual(b);
    }
});

// --- (c) property sweep ------------------------------------------------------

test("property sweep L5..100 x 200 seeds: zero cap or portal-shelf violations ship",
    { timeout: 300000 }, () => {
        let maps = 0, droppedSites = 0;
        for (let i = 0; i < 200; i++) {
            const lvl = 5 + (i % 96);
            const seed = (20261108 + i * 7919) >>> 0;
            const level = new Level(lvl, T, seed);
            maps++;
            expect(ruleAViolations(level), `A L${lvl} s${seed}`).toEqual([]);
            expect(ruleBViolations(level), `B L${lvl} s${seed}`).toEqual([]);
            // Non-vacuity: count sites the pipeline skipped (raw legal-ish
            // derive results minus deployments). The cap/gates must actually
            // bite somewhere across the sweep.
            droppedSites += Math.max(0,
                level.deriveEnemySpawns().length -
                level.enemyManager.enemies.length);
        }
        expect(maps).toBe(200);
        // Measured @this wave: 1000-seed mean deployment fell 3.26 -> 1.55;
        // a 200-seed slice therefore always loses >= 100 sites to ALL
        // pre-roll filters combined. Floor sits far below observation.
        expect(droppedSites).toBeGreaterThan(100);
    });
