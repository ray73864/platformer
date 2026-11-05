// Narrow-shelf deploy ban (player ruling 2026-11-04): "Enemies that are on a
// single tile wide block just bounce back and forth really super fast, I
// don't think they should be able to spawn on a single wide block." The
// vibration arithmetic: a 32px body inside bounds [x*32,(x+1)*32] has zero
// travel, so _patrolStep clamp-flips its heading every frame. Pre-fix sweep
// (L5..100 x 10 seeds at HEAD f18725e): 419/3268 deployed enemies (12.8%)
// across 409/960 maps ended with sub-tile travel; leak paths were the shaft
// approach-window clamps (165), isMarkerSite's route-adjacent fallback
// accepting raw one-column markers (146), bridge-lip clamps (70) and patrol-
// band clamps of canonically-validated sites (38). The fix filters EVERY
// deployment (walker included) in spawnEnemies: support run >= ENEMY_MIN_RUN
// under the spawn column AND >= one full tile of travel between the FINAL
// bounds, dropped BEFORE kind rolls. These tests pin the fixture behaviour,
// one named repro per leak class, a bounded structural sweep, determinism,
// and the drop-before-roll stream discipline.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { ENEMY_WIDTH } from "../../js/enemies.js";

const T = 32;

// Hand-built floating-pillar fixture: support rows 6-7 spanning columns
// 10..10+pillarWidth-1, marker on top at the pillar's left column. Level 38
// is right-facing with plateaued kind chances; band [9, w-6] contains the
// columns used. Tiles/reachability are replaced AFTER construction (same
// technique as enemy_shelf_fairness.test.js): spawnEnemies re-derives
// everything from the current grid, and the rng state entering the roll loop
// is identical for every fixture built from the same seed.
function fixture(seed, markers, shelfCols) {
    const level = new Level(38, T, seed);
    const W = 26;
    const H = 10;
    level.width = W;
    level.height = H;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (const [c0, c1] of shelfCols) {
        for (let c = c0; c <= c1; c++) {
            tiles[6][c] = 1;
            tiles[7][c] = 1;
        }
    }
    for (const [mx, my] of markers) tiles[my][mx] = 4;
    level.tiles = tiles;
    level.reachableTiles = new Set(markers.map(([mx, my]) => my * W + mx));
    // The synthetic grid knows nothing about the real construction's forced
    // crossings: clear the descriptors so fairness-window clamps cannot
    // bite shelves that do not exist in this fixture.
    level.bridgeGap = null;
    level.shaftGap = null;
    level.pathCells = null;
    level.spawnEnemies();
    return level;
}
const narrowFixture = (seed) => fixture(seed, [[10, 5]], [[10, 10]]);
const wideFixture = (seed) => fixture(seed, [[10, 5]], [[10, 13]]);
// Narrow pillar at column 10 scanned FIRST (column order), legal 4-wide
// shelf at 16..19 second: what the survivor's kind roll sees distinguishes
// drop-before-roll from roll-then-deploy-nothing.
const mixedFixture = (seed) =>
    fixture(seed, [[10, 5], [17, 5]], [[10, 10], [16, 19]]);

function runW(level, x, y) {
    const row = level.tiles[y + 1];
    if (!row || row[x] !== 1) return 0;
    let l = x;
    while (l > 0 && row[l - 1] === 1) l--;
    let r = x;
    while (r < level.width - 1 && row[r + 1] === 1) r++;
    return r - l + 1;
}
function violations(level) {
    return level.getEnemyManager().enemies.filter(e =>
        e.maxX - e.minX - ENEMY_WIDTH < T ||
        runW(level, Math.round(e.x / T), Math.round(e.y / T)) < 2);
}

test("repro pin: a marker on a single-column shelf deploys NO enemy", () => {
    // The site still DERIVES (the constructor's validity guard must keep
    // seeing it, or tight-grid constructions would start throwing) — it
    // simply never deploys, for any seed and therefore any rolled kind.
    for (let s = 1; s <= 15; s++) {
        const level = narrowFixture(s * 7);
        expect(level.deriveEnemySpawns().length).toBe(1);
        expect(level.getEnemyManager().enemies.length).toBe(0);
    }
});

test("a two-column shelf is the new floor: exactly one patrolling enemy", () => {
    for (let s = 1; s <= 15; s++) {
        const level = wideFixture(s * 7);
        const enemies = level.getEnemyManager().enemies;
        expect(enemies.length).toBe(1);
        const e = enemies[0];
        expect(e.maxX - e.minX - ENEMY_WIDTH).toBeGreaterThanOrEqual(T);
        expect(runW(level, Math.round(e.x / T), Math.round(e.y / T)))
            .toBeGreaterThanOrEqual(2);
    }
});

test("mixed map: the illegal site drops and the legal neighbour still deploys", () => {
    for (let s = 1; s <= 15; s++) {
        const enemies = mixedFixture(s * 7).getEnemyManager().enemies;
        expect(enemies.length).toBe(1);
        expect(enemies[0].x).toBe(17 * T);
        expect(violations(mixedFixture(s * 7))).toEqual([]);
    }
});

test("stream discipline: dropping happens BEFORE the kind roll", () => {
    // Drop-before-roll means the mixed map consumes exactly ONE roll (for
    // its one survivor) from the same rng entry state as the wide-only
    // fixture, so the surviving kinds must match seed-for-seed. A
    // roll-then-deploy-nothing implementation would hand the narrow site
    // roll #1 and shift the survivor onto roll #2 — over 25 seeds of L38
    // kind chances (~43% hostile) any mismatch would expose that.
    for (let s = 1; s <= 25; s++) {
        const mixed = mixedFixture(s * 31).getEnemyManager().enemies;
        const alone = wideFixture(s * 31).getEnemyManager().enemies;
        expect(mixed.length).toBe(1);
        expect(mixed[0].kind).toBe(alone[0].kind);
    }
}, 30_000); // suite-timeout hygiene 2026-11-06: ~3.2s solo (reviewer-reproduced 5.27s timeout under parallel load)

test("named repros (one per pre-fix leak class): no vibrating deployments", () => {
    // Captured from the pre-fix sweep at HEAD f18725e:
    //   L6/6007   cell (14,13) raw span [14,17] -> band-clamped to [14,14]
    //   L7/7001   cell (3,13)  raw one-column marker (route-adj fallback)
    //   L13/13002 cell (14,11) raw span [10,14] -> shaft-window clamp
    //   L26/26003 cell (25,17) raw span [22,25] -> bridge-lip clamp
    const repros = [
        [6, 6007, 14, 13], [7, 7001, 3, 13],
        [13, 13002, 14, 11], [26, 26003, 25, 17]
    ];
    for (const [lvl, seed, cx, cy] of repros) {
        const level = new Level(lvl, T, seed);
        for (const e of level.getEnemyManager().enemies) {
            expect(Math.round(e.x / T) === cx && Math.round(e.y / T) === cy,
                `L${lvl} seed ${seed}: enemy redeployed at ${cx},${cy}`)
                .toBe(false);
        }
        expect(violations(level), `L${lvl} seed ${seed}`).toEqual([]);
    }
});

test("structural sweep L5..60 x 10 seeds: ZERO sub-tile patrols anywhere", () => {
    let checked = 0;
    for (let lvl = 5; lvl <= 60; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(violations(level), `L${lvl} seed ${lvl * 1000 + s}`)
                .toEqual([]);
            checked += level.getEnemyManager().enemies.length;
        }
    }
    // Non-vacuous: the filter removes cramped sites, not enemies.
    expect(checked).toBeGreaterThan(100);
}, 120_000);

test("determinism: same seed replays the filtered deployment identically", () => {
    for (const [lvl, seed] of [[6, 6007], [7, 7001], [13, 13002], [26, 26003],
        [38, 38001], [55, 55007]]) {
        const snap = l => l.getEnemyManager().enemies
            .map(e => [e.x, e.y, e.minX, e.maxX, e.kind]);
        expect(snap(new Level(lvl, T, seed)))
            .toEqual(snap(new Level(lvl, T, seed)));
    }
});
